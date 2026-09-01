import { useVehicle } from "@/context/VehicleContext";
import { LocationContext } from "@/context/LocationContext";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, AppState, AppStateStatus, Appearance, Platform } from "react-native";
import * as SystemUI from "expo-system-ui";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { getDestinationSide } from "@/utils/navigationSide";
import NetInfo from "@react-native-community/netinfo";
import { SPEED_ZONES, SpeedZone } from "@/data/speedZones";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError, API_BASE } from "@/utils/apiClient";
import {
  startBackgroundShareTask,
  stopBackgroundShareTask,
  requestBackgroundLocationPermission,
} from "@/utils/backgroundShare";
import {
  BG_DRIVE_ACTIVE_KEY,
  BG_SESSION_ID_KEY,
  BG_ZONES_CACHE_KEY,
  BG_REPORTS_CACHE_KEY,
  BG_LAST_FIX_KEY,
  BG_ROAD_CONTEXT_KEY,
  type BgZoneEntry,
  type BgReportEntry,
  type BgLastFix,
} from "@/utils/backgroundDriveAlerts";
import {
  startBackgroundOdometerTask,
  stopBackgroundOdometerTask,
  consumeBackgroundOdometer,
} from "@/utils/backgroundOdometer";
import { resolveIncidentType } from "@/constants/incidentTypes";
import { getRoadName } from "@/utils/snapToRoad";
import { playSound, getSoundsMuted, stopSound } from "@/utils/sound";
import { navBreadcrumb, gpsBreadcrumb } from "@/utils/telemetry";
import { syncBackup } from "@/utils/backupSync";
import { loadVehicles, saveVehicles } from "@/utils/savedVehicles";
import { getCareStorageKey, updateTripOdometer, loadVehicleCareData, estimatedOdometerKm } from "@/utils/vehicleCare";
import { flushOfflineSessions } from "@/utils/driveSessionApi";
import { VehicleTypeId, DEFAULT_VEHICLE_TYPE, getVehicleTypeDef, capSpeedLimit } from "@/data/vehicleTypes";
import { Accelerometer } from "expo-sensors";

// ─── Types ──────────────────────────────────────────────────────────────────
import { speakAlert, speakAlertMulti, speakAlertPhrase, isAlertVoicePlaying, resolveAlertKey, stopAlertVoice } from "@/utils/alertTts";
import {
  canDeliverForegroundAlert,
  getAlertOwnershipGeneration,
  isCurrentAlertGeneration,
} from "@/utils/alertOwnership";
import {
  ANDROID_ALERTS_CHANNEL_ID,
  ensureAndroidNotificationChannels,
} from "@/utils/androidNotificationChannels";

export interface CommunityReport {
  id: string;
  type: "camera" | "police" | "alcoblow" | "accident" | "pothole" | "roadblock" | "roadworks" | "clear" | "hazard" | "closure" | "weather" | "debris" | "breakdown" | "traffic" | "speed_bump";
  lat: number;
  lng: number;
  timestamp: number;
  confirmed: number;
  // API-backed fields (populated after server sync)
  serverId?: string;
  status?: "active" | "confirmed" | "expired" | "denied" | "admin_review" | "pending_review";
  confirmCount?: number;
  denyCount?: number;
  isOwn?: boolean;
  speedLimit?: number;
  roadName?: string;
  adminVerified?: boolean;
  /** Camera subtype: "fixed" = permanently installed, "mobile" = temporary/moving checkpoint.
   *  Null/undefined for non-camera types and legacy camera reports (treat as "fixed"). */
  cameraType?: "fixed" | "mobile";
  /** How directly the reporter witnessed this incident:
   *  - on_location   — GPS was near the pin at submission (eyewitness)
   *  - recent_nearby — reporter was in the area within the last hour
   *  - community_tip — remote/search submission; reporter wasn't there recently */
  observationContext?: "on_location" | "recent_nearby" | "community_tip";
  /** Epoch ms when the reporter says they saw the incident (may differ from timestamp). */
  observedAt?: number;
}

// HERE Live Traffic incident — sourced from the HERE Traffic API, not community-reported.
// Displayed on the map as a separate layer; dismissal is local-only.
export interface HereIncident {
  id: string;          // "here:{HERE_ID}"
  type: string;        // Msafiri incident type key
  lat: number;
  lng: number;
  description?: string;
  roadName?: string;
  startTime?: number;  // epoch ms
  endTime?: number;    // epoch ms
}

export interface TripPoint { lat: number; lng: number; speed: number; time: number }

export interface TripData {
  id: string;
  startTime: number;
  endTime: number;
  distance: number;
  maxSpeed: number;
  avgSpeed: number;
  alertsCount: number;
  positions: TripPoint[];
}

export interface SOSContact { name: string; phone: string }

export interface NavDestination {
  name: string;
  lat: number;
  lng: number;
  /** Set when the destination was chosen via the "Go" button on a POI card */
  poiType?: "fuel" | "food" | "shopping" | "hospital" | "nightlife";
}

export interface RouteCoord { latitude: number; longitude: number }

/** One entry from Google's speedReadingIntervals — maps a polyline index range
 *  to a traffic speed band. */
export interface SpeedInterval {
  startIndex: number;
  endIndex:   number;
  speed: "NORMAL" | "SLOW" | "TRAFFIC_JAM" | "SPEED_UNSPECIFIED";
}

export interface RouteStep {
  instruction: string;
  distanceM: number;
  location: RouteCoord;
  /** Exit number for roundabout/rotary steps (1-based). Undefined for all other maneuvers. */
  exitNumber?: number;
  /** Google Routes API maneuver type string (e.g. "turn", "roundabout", "uturn", "arrive"). */
  maneuverType: string;
  /** Raw road name from OSRM (empty string when unnamed). Used for post-turn confirmations. */
  roadName: string;
  /** Distance from the route start to this step's maneuver point, measured along the polyline.
   *  Used for along-road voice cue timing instead of straight-line haversine. */
  stepAlongRouteM: number;
  /** Per-step road geometry decoded from the server-supplied step polyline.
   *  When present, distance-to-maneuver is measured along this sub-polyline
   *  rather than the overall route projection, giving accurate readings on
   *  curves and winding roads. */
  stepCoords?: RouteCoord[];
  /** Cumulative distances (metres) along stepCoords — parallel array, same length.
   *  stepCumDist[last] equals the total along-road length of this step. */
  stepCumDist?: number[];
}

export interface AppRoute {
  id: string;
  distanceM: number;
  durationS: number;
  coords: RouteCoord[];
  /** Cumulative distance (metres) from route start to each coordinate index.
   *  Computed once at fetch time so the GPS handler and voice cue engine can
   *  use along-road distances without rescanning the whole polyline each tick. */
  cumDist: number[];
  steps: RouteStep[];
  /** Google speed-reading intervals for traffic-coloured polyline rendering.
   *  Each entry maps a range of polyline coordinate indices to a speed band.
   *  Empty / absent when Google returns no traffic data for this route. */
  speedIntervals?: SpeedInterval[];
}

/** A single hazard/checkpoint located along the active route — merges static
 *  speed-camera/police zones with live community reports into one shape so
 *  the UI can render them as a unified, sorted "what's ahead" list. */
export interface RouteIncident {
  id: string;
  source: "static" | "report" | "here";
  type: string;
  label: string;
  name: string;
  road?: string;
  description?: string;
  speedLimit?: number;
  lat: number;
  lng: number;
  /** Distance in metres from the start of the route to this incident. */
  distanceAlongRouteM: number;
  /** Shortest perpendicular distance from the incident pin to the route. */
  offRouteM?: number;
  /** Distance in metres from the driver's current position to this incident
   *  (clamped to 0). Only populated on items from `routeIncidentsAhead`. */
  aheadDistanceM?: number;
  confirmCount?: number;
  timestamp?: number;
  /** Propagated from the server report status so the UI can show "Pending review". */
  reportStatus?: "active" | "confirmed" | "expired" | "denied" | "admin_review" | "pending_review";
}

export interface RouteCheckResult {
  distanceM: number;
  durationS: number;
  trafficDelayS: number;
  incidents: RouteIncident[];
}

/** Unified alert shown in DriveAlertOverlay — covers static speed zones/cameras,
 *  live community reports, and HERE live traffic incidents so any source can
 *  trigger the full-screen panel. */
export interface DriveAlert {
  id: string;
  source: "zone" | "report" | "here";
  type: string;
  name: string;
  road?: string | null;
  description?: string | null;
  distance: number;
  speedLimit?: number | null;
  lat: number;
  lng: number;
  /** Community-report confirm count — used for confidence tier display. */
  confirmCount?: number;
  /** Report creation time (epoch ms) — used to show "Reported X min ago". */
  createdAt?: number;
  /** How directly the reporter witnessed this (on_location / recent_nearby / community_tip). */
  observationContext?: "on_location" | "recent_nearby" | "community_tip";
  /**
   * Signed along-track distance to the alert pin (metres).
   * Positive = alert is ahead of the driver; negative = driver has passed it.
   * Null when GPS heading is unavailable.
   */
  alongTrackM?: number | null;
}

interface AppContextValue {
  locationGranted: boolean;
  requestLocationPermission: () => Promise<void>;
  requestNotificationPermission: () => Promise<boolean>;
  // NOTE: currentLat / currentLng / currentSpeed / driverHeading moved to the
  // narrow LocationContext (context/LocationContext.tsx, useLiveLocation()) so
  // GPS ticks don't re-render every useApp() consumer.
  activeAlert: DriveAlert | null;
  /** Additional alerts within 1 km of the lead alert, sorted by distance.
   *  Non-empty only when the driver is in a cluster zone. Cleared with activeAlert. */
  activeAlertExtras: DriveAlert[];
  currentSpeedLimit: number | null;
  nearbyZones: Array<SpeedZone & { distance: number }>;
  allZones: SpeedZone[];
  stretchZones: SpeedStretch[];
  dismissAlert: () => void;
  hudMode: boolean;
  setHudMode: (v: boolean) => void;
  themeOverride: "system" | "light" | "dark";
  setThemeOverride: (v: "system" | "light" | "dark") => void;
  clearAllData: () => Promise<void>;
  sosContact: SOSContact | null;
  setSosContact: (c: SOSContact | null) => void;
  communityReports: CommunityReport[];
  /** Immediately fetches fresh reports from the server outside the normal poll
   *  cycle. Called by usePushNotifications when a silent "reports_refresh" push
   *  arrives so new pins appear within ~2 s of the original submission. */
  refreshReports: () => Promise<void>;
  addReport: (type: CommunityReport["type"], lat: number, lng: number, speedLimit?: number, roadName?: string, meta?: { observationContext?: CommunityReport["observationContext"]; observedAt?: number; reporterProximityM?: number }, cameraType?: "fixed" | "mobile") => string;
  confirmReport: (id: string) => Promise<void>;
  denyReport: (id: string) => Promise<{ ok: boolean; message?: string }>;
  deleteReport: (id: string) => Promise<void>;
  flagReport: (id: string, reason?: string) => Promise<boolean>;
  updateReport: (id: string, speedLimit: number) => Promise<void>;
  deviceId: string | null;
  currentTrip: Partial<TripData> | null;
  tripHistory: TripData[];
  /**
   * Live odometer reading for the active vehicle.
   * = storedTotal + currentTripKm (ticks every ~4 s while driving).
   * Resets to the new stored total when a trip ends.
   * Zero when no care data exists yet (vehicle never driven / no initial reading).
   */
  liveOdometerKm: number;
  clearTripHistory: () => void;
  hydrated: boolean;
  onboardingComplete: boolean;
  completeOnboarding: () => void;
  isOffline: boolean;
  /** Timestamp of the last successful alert-data sync (reports + zones). Null until first sync. */
  lastAlertDataSyncedAt: Date | null;
  vehicleType: VehicleTypeId;
  setVehicleType: (v: VehicleTypeId) => void;
  /** Selected car make id (e.g. "toyota", or "custom-haima" for custom). Null when not yet chosen. */
  vehicleMakeId: string | null;
  /** Selected car model id (e.g. "hilux", or "custom-s5" for custom). Null when not yet chosen. */
  vehicleModelId: string | null;
  /** Save a standard make + model. */
  setVehicleModel: (makeId: string, modelId: string) => void;
  /** User-typed display name for a custom make (null when using a known make). */
  vehicleCustomMakeName: string | null;
  /** User-typed display name for a custom model (null when using a known model). */
  vehicleCustomModelName: string | null;
  /** Save a custom/unknown make+model; stores all four values together. */
  setCustomVehicle: (makeId: string, modelId: string, makeName: string, modelName: string) => void;
  // Navigation
  navDestination: NavDestination | null;
  setNavDestination: (d: NavDestination | null) => void;
  activeRoute: AppRoute | null;
  altRoutes: AppRoute[];
  selectRoute: (r: AppRoute) => void;
  isSharingTrip: boolean;
  shareToken: string | null;
  shareLink: string | null;
  driverName: string;
  setDriverName: (name: string) => void;
  startSharingTrip: () => Promise<string | null>;
  stopSharingTrip: () => Promise<void>;
  distanceRemainingM: number | null;
  durationRemainingS: number | null;
  routeLoading: boolean;
  showTraffic: boolean;
  setShowTraffic: (v: boolean) => void;
  routeIncidentsAhead: RouteIncident[];
  routeTrafficDelayS: number;
  /** On-demand road-condition check from the driver's current location to an
   *  arbitrary destination (used by Saved Places / Planned Trips), independent
   *  of the active navigation route. Returns null if location isn't available
   *  or no route could be found. */
  checkRouteStatus: (destLat: number, destLng: number) => Promise<RouteCheckResult | null>;
  routeIncidentsExpanded: boolean;
  setRouteIncidentsExpanded: (v: boolean) => void;
  pendingConfirmationReport: CommunityReport | null;
  setPendingConfirmationReport: (r: CommunityReport | null) => void;
  pendingConfirmationSource: "proximity" | "recent" | null;
  setPendingConfirmationSource: (s: "proximity" | "recent" | null) => void;
  hasVotedOnReport: (id: string) => boolean;
  pendingFocusCoords: { lat: number; lng: number } | null;
  setPendingFocusCoords: (coords: { lat: number; lng: number } | null) => void;
  markReportPrompted: (id: string) => void;
  isReportPrompted: (id: string) => boolean;
  // HERE Live Traffic
  hereIncidents: HereIncident[];
  dismissHereIncident: (id: string) => void;
  // Admin mode
  isAdmin: boolean;
  adminLogin: (pin: string) => Promise<void>;
  adminLogout: () => Promise<void>;
  adminVerifyReport: (id: string) => Promise<void>;
  adminDenyReport: (id: string) => Promise<void>;
  adminUpdateReportLocation: (id: string, lat: number, lng: number, roadName?: string | null) => Promise<void>;
  adminUpdateZoneLocation: (id: string, lat: number, lng: number, staticZone?: SpeedZone) => Promise<void>;
  adminRemoveZone: (id: string, staticZone?: SpeedZone) => Promise<void>;
  adminVerifyZone: (id: string, staticZone?: SpeedZone) => Promise<void>;
  /** One-time backfill: writes every DB-relocated zone back into speedZones.ts.
   *  Returns the number of zones patched in the static file. */
  adminSyncStaticZones: () => Promise<{ synced: number; total: number }>;
  /** Edit zone metadata (name, road, speedLimit, type, description) in-place.
   *  Works for both DB zones (UUID) and static zones (sz-prefixed). For a
   *  static zone without an existing DB record, pass the full staticZone object
   *  so the backend can bootstrap the upsert row. */
  adminEditZone: (
    id: string,
    fields: { name?: string; road?: string; speedLimit?: number | null; type?: string; description?: string },
    staticZone?: SpeedZone
  ) => Promise<void>;
  /** Edit report metadata (type, roadName, speedLimit, cameraType) in-place. */
  adminEditReport: (
    serverId: string,
    localId: string,
    fields: { type?: string; roadName?: string | null; speedLimit?: number | null; cameraType?: "fixed" | "mobile" | null }
  ) => Promise<void>;
  /** Create a new speed zone at the given coordinates.
   *  Admin-created zones are auto-verified. Returns the new zone's id. */
  adminCreateZone: (zone: {
    name: string; road?: string; lat: number; lng: number;
    speedLimit?: number; type: string; description?: string;
  }) => Promise<string>;
  /** Snaps a coordinate to the nearest point on the driver's active route
   *  polyline. Returns null when no route is active; the caller should then
   *  fall back to snapToRoad() (Google Roads API) or raw GPS. */
  snapToActiveRoute: (lat: number, lng: number) => { lat: number; lng: number } | null;
  /** True while any full-screen map picker modal is open (CrosshairPickerModal,
   *  AdminLocationPickerModal, SavedPlaceMapPicker). Consumers should unmount
   *  their MapView while this is true to avoid two-MapView native contention. */
  mapPickerActive: boolean;
  setMapPickerActive: (v: boolean) => void;
  // ── Crash detection ──────────────────────────────────────────────────────
  /** True when the accelerometer + speed-drop algorithm has detected a probable crash. */
  crashDetected: boolean;
  /** Dismiss the crash overlay — called when the driver taps "I'm Fine" or
   *  when the countdown expires (after sending SMS alerts). */
  clearCrash: () => void;
  /** The ID of the Crash Assistant accident record created when a crash is detected.
   *  Present once the async POST /accidents completes. Null until then or after clearCrash. */
  crashAssistantId: string | null;
  /** g-force sensitivity level. Controls the impact threshold:
   *  Low = 4.5g (fewer false positives), Medium = 3.5g, High = 2.8g (more sensitive). */
  crashSensitivity: "low" | "medium" | "high";
  setCrashSensitivity: (v: "low" | "medium" | "high") => void;
  /** Called by the drive screen to inform AppContext whether the dashcam is
   *  currently recording, so the accelerometer subscription can be enabled
   *  even when navigation is inactive. */
  setDashcamActive: (v: boolean) => void;
  /** Ref holding the epoch-ms timestamp of the most recent accepted GPS fix.
   *  Updated on every handleLocation invocation — not rate-limited like
   *  currentSpeed — so consumers can check GPS freshness independently of
   *  whether the displayed speed integer changed. */
  gpsLastFixAtRef: React.MutableRefObject<number>;
  /** URI of the driver's profile photo, or null when no photo has been set.
   *  Single source of truth — updated by PersonalInformation; all avatar
   *  consumers read from here instead of polling AsyncStorage independently. */
  profilePhotoUri: string | null;
  setProfilePhotoUri: (uri: string | null) => void;
  /** Whether the driver currently has an active trip running in the drive tab. */
  navTripActive: boolean;
  /** Whether the active trip is currently paused. */
  navTripPaused: boolean;
  setNavTripActive: (v: boolean) => void;
  setNavTripPaused: (v: boolean) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

const KEYS = {
  TRIPS: "sdk_trips",
  REPORTS: "sdk_reports",
  HUD: "sdk_hud",
  SOS: "sdk_sos",
  ONBOARDING: "sdk_onboarding",
  DEVICE_ID: "sdk_device_id",
  THEME: "sdk_theme",
  VEHICLE_TYPE: "sdk_vehicle_type",
  VEHICLE_MAKE_ID: "sdk_vehicle_make_id",
  VEHICLE_MODEL_ID: "sdk_vehicle_model_id",
  VEHICLE_CUSTOM_MAKE_NAME: "sdk_vehicle_custom_make_name",
  VEHICLE_CUSTOM_MODEL_NAME: "sdk_vehicle_custom_model_name",
  SHARE: "sdk_share",  // active sharing session — persisted so it survives backgrounding
  DRIVER_NAME: "sdk_driver_name",  // display name shown to live-share recipients
  CRASH_SENSITIVITY: "sdk_crash_sensitivity",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180, f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180, dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Initial bearing from point A → B in degrees (0–360°). */
function bearingDeg(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const f1 = (fromLat * Math.PI) / 180, f2 = (toLat * Math.PI) / 180;
  const dl = ((toLng - fromLng) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Shortest angular difference between two headings (0–180°). */
function angleDiffDeg(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/** Signed along-track distance from the driver to a target, in metres.
 *  Positive  = target is ahead of the driver on their current heading.
 *  Negative  = target is behind the driver (they have passed it).
 *  Formula:  dist × cos(bearingToTarget − driverHeading) */
function alongTrackDistanceM(
  driverLat: number, driverLng: number, driverHeading: number,
  targetLat: number, targetLng: number,
): number {
  const dist = haversine(driverLat, driverLng, targetLat, targetLng);
  const brgToTarget = bearingDeg(driverLat, driverLng, targetLat, targetLng);
  const deltaRad = ((brgToTarget - driverHeading + 540) % 360 - 180) * (Math.PI / 180);
  return dist * Math.cos(deltaRad);
}

/** Driver heading (0–360°) derived from the previous GPS fix.
 *  Returns null when there is no previous fix or movement is below the noise
 *  threshold (< 5 m), which means direction is indeterminate. */
function driverHeadingDeg(
  prevFix: { lat: number; lng: number; t: number } | null,
  currentLat: number,
  currentLng: number,
): number | null {
  if (!prevFix) return null;
  const distM = haversine(prevFix.lat, prevFix.lng, currentLat, currentLng);
  // Require at least 5 m of genuine movement; less than that is GPS noise.
  if (distM < 5) return null;
  return bearingDeg(prevFix.lat, prevFix.lng, currentLat, currentLng);
}

// ── Road-name matching helpers ─────────────────────────────────────────────
//
// Used for road-based alert gating: a speed camera or reported hazard only
// triggers the overlay when the driver is on the same road as the incident.

/** Strips parenthetical codes, road-type words, and punctuation so that
 *  "Thika Superhighway (A2)" normalises to the same string as "Thika Road". */
function normalizeRoad(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, "")   // remove codes like "(A2)", "(A104)"
    .replace(
      /\b(road|rd|street|st|avenue|ave|highway|hwy|superhighway|way|bypass|lane|drive|dr|place)\b/g,
      ""
    )
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Known alias groups (each sub-array holds normalised names for the same
 *  physical carriageway).  roadsMatch() checks this table when the simple
 *  substring test does not produce a match.
 *
 *  Sources: speed-zones placement audit (artifacts/mobile/data/speed-zones-audit.md).
 *  Each alias is documented there with the reason OSM and NTSA use different names.
 *
 *  ── Alias list ──────────────────────────────────────────────────────────
 *  1. Thika Superhighway ↔ Northern Bypass
 *     sz009 (Githurai 44 flyover): OSRM/OSM labels the A2/C63 interchange
 *     carriageway as "Northern Bypass"; NTSA and in-car nav call it "Thika
 *     Superhighway" / "Thika Road".  Both names refer to the same physical
 *     lane.  normalizeRoad("Thika Superhighway (A2)") → "thika";
 *     normalizeRoad("Northern Bypass") → "northern".
 *
 *  2. Mombasa Road ↔ Airport North Road
 *     sz097 (JKIA roundabout approach): OSM names the junction approach road
 *     "Airport North Road"; road-sign / NTSA designation is "Mombasa Road".
 *     normalizeRoad("Mombasa Road") → "mombasa";
 *     normalizeRoad("Airport North Road") → "airport north".
 */
const ROAD_ALIASES: ReadonlyArray<ReadonlyArray<string>> = [
  ["thika", "northern"],
  ["mombasa", "airport north"],
];

  /** True when the two road names refer to the same road.
 *  Returns FALSE when either side is absent — unknown road = no match,
 *  so alerts are suppressed rather than spilling onto unrelated roads. */
function roadsMatch(
  driverRoad: string | null | undefined,
  incidentRoad: string | null | undefined,
): boolean {
  if (!driverRoad || !incidentRoad) return false;
  const a = normalizeRoad(driverRoad);
  const b = normalizeRoad(incidentRoad);
  if (!a || !b) return false;
  // Exact normalised identity only. Substring matching incorrectly treats
  // branches such as "Mombasa Road" and "Old Mombasa Road" as one road.
  if (a === b) return true;
  // Alias table: known cases where OSM and NTSA use different names for the
  // same carriageway (e.g. "Northern Bypass" vs "Thika Superhighway" at sz009).
  for (const group of ROAD_ALIASES) {
    if (group.includes(a) && group.includes(b)) return true;
  }
  return false;
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

// ── Report cache pruning ──────────────────────────────────────────────────────
//
// Denied and expired reports are hidden from the map and alert system, but
// without an active sweep they accumulate indefinitely in AsyncStorage and the
// in-memory array.  On a phone used for months by a heavy reporter this can
// grow into thousands of dead entries, slowing JSON.parse on startup and every
// AsyncStorage.setItem call that persists the array.
//
// Pruning rules (applied at startup and on every foreground transition):
//  • Always keep own pending_review reports — the user must be able to see
//    their submitted camera awaiting moderation even across app restarts.
//  • Evict denied/expired reports that are older than 2 h.  Two hours covers
//    the shortest server TTL (traffic: 2 h) so a denied report is guaranteed
//    to have been purged server-side by this point.
//  • Hard age cap of 24 h for everything else — matches the longest server TTL
//    (hazard/pothole/etc.).  Reports that survived beyond that are either
//    offline-only leftovers or stale confirmed reports from a prior session;
//    the next GET /reports will re-populate anything still active.
function pruneReportCache(reports: CommunityReport[], now: number): CommunityReport[] {
  return reports.filter((r) => {
    // Never evict the user's own camera/report that is still awaiting admin review.
    if (r.isOwn && r.status === "pending_review") return true;
    // Denied and expired entries are no longer visible anywhere; remove after 2 h.
    if (r.status === "denied" || r.status === "expired") {
      return now - r.timestamp < 7_200_000;
    }
    // Hard cap: 24 h.
    return now - r.timestamp < 86_400_000;
  });
}

/** Decode a JWT payload and verify the role + expiry without a library. */
function isAdminTokenValid(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    // atob is globally available in React Native (polyfilled by Hermes / JSC)
    const payload = JSON.parse(atob(parts[1])) as { role?: string; exp?: number };
    return payload.role === "admin_mobile" &&
      typeof payload.exp === "number" &&
      payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

/** Returns the English ordinal suffix string for a positive integer, e.g. 1→"1st", 3→"3rd". */
function toOrdinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function buildInstruction(maneuver: { type?: string; modifier?: string; exit?: number }, name: string): string {
  const t = maneuver?.type ?? "";
  const mod = maneuver?.modifier ?? "";
  const road = name ? ` onto ${name}` : "";
  if (t === "arrive") return "Arriving at your destination";
  if (t === "depart") return `Head ${mod || "forward"}${road}`;
  if (t === "uturn") return `Make a U-turn${road}`;
  if (t === "turn") {
    if (mod === "uturn") return `Make a U-turn${road}`;
    return `Turn ${mod || "left"}${road}`;
  }
  if (t === "new name") return `Continue${road}`;
  if (t === "continue") return `Continue on ${name || "the road"}`;
  if (t === "roundabout" || t === "rotary") {
    const exitOrdinal = maneuver.exit ? ` ${toOrdinal(maneuver.exit)}` : "";
    return `At the roundabout, take the${exitOrdinal} exit${road}`;
  }
  if (t === "fork") return `Keep ${mod || "straight"} at the fork`;
  if (t === "end of road") return `Turn ${mod || "left"} at the end of the road`;
  if (t === "merge") return `Merge ${mod || ""}${road}`;
  return name ? `Continue on ${name}` : "Continue";
}

async function fetchGoogleRoute(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
  /** Driver bearing (0–359°). When provided the server snaps the origin to
   *  the correct carriageway on divided roads and avoids routing backward.
   *  Pass null / omit for cold-start or GPS-unavailable situations. */
  heading?: number | null,
): Promise<AppRoute[]> {
  type ServerStep = {
    instruction: string;
    distanceM: number;
    lat: number;
    lng: number;
    maneuverType: string;
    maneuverModifier: string;
    roadName: string;
    /** Per-step road geometry returned by the server (decoded from the step polyline). */
    stepCoords?: RouteCoord[];
  };
  type ServerRoute = {
    index: number;
    distanceM: number;
    durationS: number;
    coords: RouteCoord[];
    steps: ServerStep[];
    speedIntervals?: SpeedInterval[];
  };

  try {
    const headingParam = heading != null ? `&heading=${Math.round(heading)}` : "";
    const data = await apiGet<{ routes: ServerRoute[] }>(
      `/routing/route?fromLat=${fromLat}&fromLng=${fromLng}&toLat=${toLat}&toLng=${toLng}${headingParam}`,
      15000
    );
    // Guard against a null / empty API response — data itself can be null if
    // the server returns a non-JSON body or the request times out.
    if (!data?.routes?.length) return [];

    const validRoutes: AppRoute[] = [];
    for (let idx = 0; idx < data.routes.length; idx++) {
      const r = data.routes[idx];
      // Null entry is possible if the server serialises a sparse array.
      if (!r) { console.warn(`[fetchGoogleRoute] route ${idx} is null — skipped`); continue; }

      // Skip any route that is missing coords or steps — passing an empty / null
      // array into buildCumulativeDistances or the step mapper would throw later.
      if (!Array.isArray(r.coords) || r.coords.length === 0) {
        console.warn(`[fetchGoogleRoute] route ${idx} missing coords — skipped`);
        continue;
      }
      if (!Array.isArray(r.steps)) {
        console.warn(`[fetchGoogleRoute] route ${idx} missing steps — skipped`);
        continue;
      }

      // Build coords first so we can compute cumulative distances and project
      // each step's location onto the polyline (giving stepAlongRouteM).
      const coords: RouteCoord[] = r.coords; // already {latitude, longitude}
      const cumDist = buildCumulativeDistances(coords);

      // Filter falsy step entries before mapping — a single null/undefined step
      // from the server must not crash the entire route fetch.
      const steps: RouteStep[] = r.steps.filter(Boolean).map((s) => {
        const stepLoc: RouteCoord = {
          latitude:  typeof s.lat === "number" ? s.lat : 0,
          longitude: typeof s.lng === "number" ? s.lng : 0,
        };
        const proj = projectOntoRoute(coords, cumDist, stepLoc.latitude, stepLoc.longitude);
        // Pre-compute cumulative distances along the step's own road geometry so
        // the GPS handler can measure remaining distance along the actual road
        // shape, not a straight line between the step's start and end points.
        const stepCumDist = s.stepCoords?.length
          ? buildCumulativeDistances(s.stepCoords)
          : undefined;
        return {
          instruction:     s.instruction     ?? "",
          distanceM:       s.distanceM       ?? 0,
          location:        stepLoc,
          maneuverType:    s.maneuverType    ?? "continue",
          roadName:        s.roadName        ?? "",
          stepAlongRouteM: proj?.alongRouteM ?? 0,
          stepCoords:      s.stepCoords,
          stepCumDist,
        };
      });

      validRoutes.push({
        id: `route-${idx}-${Date.now()}`,
        distanceM: r.distanceM ?? 0,
        durationS: r.durationS ?? 0,
        coords,
        cumDist,
        steps,
        speedIntervals: r.speedIntervals?.length ? r.speedIntervals : undefined,
      });
    }
    return validRoutes;
  } catch (e) {
    // Any unexpected shape (missing field, bad JSON, network error already
    // unwrapped by apiGet) must return [] rather than propagating an uncaught
    // rejection that would crash the reroute flow.
    console.warn("[fetchGoogleRoute] unexpected error:", e);
    return [];
  }
}

const ROUTE_CORRIDOR_M = 250;
/** Safety-alert corridor is deliberately much tighter than the route overview
 * corridor. Nearby branches and service roads commonly sit 80–200 m away. */
const ALERT_ROUTE_CORRIDOR_M = 60;

/** Cumulative distance (metres) from the route start to each coordinate. */
function buildCumulativeDistances(coords: RouteCoord[]): number[] {
  const dists = [0];
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];
    // Guard against malformed coord entries (missing lat/lng) so the loop
    // never throws a TypeError deep inside navigation logic.
    if (
      !prev || !curr ||
      prev.latitude == null || prev.longitude == null ||
      curr.latitude == null || curr.longitude == null
    ) {
      dists.push(dists[i - 1]!);
      continue;
    }
    dists.push(
      dists[i - 1]! + haversine(prev.latitude, prev.longitude, curr.latitude, curr.longitude)
    );
  }
  return dists;
}

/** Finds the closest point on the route polyline to (lat, lng) and returns
 *  both its lateral distance off the route and how far along the route it is. */
function projectOntoRoute(
  coords: RouteCoord[],
  cumDist: number[],
  lat: number,
  lng: number,
  searchFrom = 0,
  searchTo = coords.length - 1
): { offRouteM: number; alongRouteM: number; matchedIdx: number } | null {
  let best: { offRouteM: number; alongRouteM: number; matchedIdx: number } | null = null;
  const from = Math.max(0, searchFrom);
  const to = Math.min(coords.length - 1, searchTo);
  for (let i = from; i <= to; i++) {
    const d = haversine(lat, lng, coords[i].latitude, coords[i].longitude);
    if (!best || d < best.offRouteM) best = { offRouteM: d, alongRouteM: cumDist[i], matchedIdx: i };
  }
  return best;
}

function staticZoneLabel(type: SpeedZone["type"]): string {
  return type === "camera" ? "Speed Camera" : type === "police" ? "Police Checkpoint" : "Speed Zone";
}

const METERS_PER_DEG_LAT = 110540;
function metersPerDegLng(atLat: number): number {
  return 111320 * Math.cos((atLat * Math.PI) / 180);
}

/** Projects (lat,lng) onto the line segment from (startLat,startLng) to
 *  (endLat,endLng) using a local flat-earth approximation (accurate enough
 *  for road-length segments). Returns the perpendicular offset in metres and
 *  the *unclamped* fractional position along the segment — 0 is the start,
 *  1 is the end; outside [0,1] means the point is beyond one of the two
 *  ends, i.e. off this particular stretch entirely. */
function projectOntoSegment(
  lat: number, lng: number,
  startLat: number, startLng: number,
  endLat: number, endLng: number
): { offsetM: number; alongFrac: number } {
  const mLng = metersPerDegLng(startLat);
  const px = (lng - startLng) * mLng, py = (lat - startLat) * METERS_PER_DEG_LAT;
  const bx = (endLng - startLng) * mLng, by = (endLat - startLat) * METERS_PER_DEG_LAT;
  const lenSq = bx * bx + by * by;
  const t = lenSq > 0 ? (px * bx + py * by) / lenSq : 0;
  const tClamped = Math.max(0, Math.min(1, t));
  const offsetM = Math.hypot(px - tClamped * bx, py - tClamped * by);
  return { offsetM, alongFrac: t };
}

/** A continuous admin-defined "this whole road segment has this limit" zone
 *  (e.g. the open-highway stretch between two towns), as opposed to a single
 *  point (camera/checkpoint). Kept separate from `SpeedZone` so the mobile
 *  app can match the driver's position anywhere along the corridor, not just
 *  near its two endpoints — see `projectOntoSegment` and its use below. */
export interface SpeedStretch {
  id: string;
  name: string;
  road: string;
  type: SpeedZone["type"];
  speedLimit: number;
  description: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
}

// ── Admin-managed speed zones (fetched from the API, merged with the static list) ─
interface ApiSpeedZone {
  id: string;
  name: string;
  road: string | null;
  type: string;
  mode: "point" | "stretch";
  speedLimit: number | null;
  description: string | null;
  bearing?: number | null; // direction of traffic the camera enforces (0-359°)
  cameraType?: "fixed" | "mobile" | null; // only meaningful when type === "camera"
  lat: number | null;
  lng: number | null;
  startLat: number | null;
  startLng: number | null;
  endLat: number | null;
  endLng: number | null;
  status: string;
  verified?: boolean;
  staticId?: string | null; // present when this DB row overrides a built-in static zone
}

function apiZoneToStaticZones(z: ApiSpeedZone): SpeedZone[] {
  if (z.status !== "active" || z.speedLimit == null) return [];
  const type: SpeedZone["type"] = z.type === "camera" || z.type === "police" ? z.type : "zone";
  const base = { name: z.name, road: z.road ?? "", speedLimit: z.speedLimit, type, description: z.description ?? "", verified: z.verified ?? false, bearing: z.bearing ?? undefined, ...(z.cameraType ? { cameraType: z.cameraType } : {}) };
  // When this DB record overrides a static zone, use the static zone's id so that
  // all speed-matching and route logic (which knows static ids) stays consistent.
  const pointId = z.staticId ?? `db-${z.id}`;
  if (z.mode === "point" && z.lat != null && z.lng != null) {
    return [{ ...base, id: pointId, lat: z.lat, lng: z.lng }];
  }
  if (z.mode === "stretch" && z.startLat != null && z.startLng != null && z.endLat != null && z.endLng != null) {
    return [
      { ...base, id: `${pointId}-start`, lat: z.startLat, lng: z.startLng, isStretchEndpoint: true },
      { ...base, id: `${pointId}-end`, lat: z.endLat, lng: z.endLng, isStretchEndpoint: true },
    ];
  }
  return [];
}

function apiZoneToStretch(z: ApiSpeedZone): SpeedStretch | null {
  if (z.status !== "active" || z.speedLimit == null || z.mode !== "stretch") return null;
  if (z.startLat == null || z.startLng == null || z.endLat == null || z.endLng == null) return null;
  const type: SpeedZone["type"] = z.type === "camera" || z.type === "police" ? z.type : "zone";
  return {
    id: `db-${z.id}`,
    name: z.name,
    road: z.road ?? "",
    type,
    speedLimit: z.speedLimit,
    description: z.description ?? "",
    startLat: z.startLat,
    startLng: z.startLng,
    endLat: z.endLat,
    endLng: z.endLng,
  };
}

// ── Traffic delay estimation ───────────────────────────────────────────────
// Google Routes API returns traffic-aware durations. We still estimate the
// additional delay from community reports to give drivers a heads-up, but
// we approximate an "expect X min delay" figure from crowd-sourced reports
// that actually slow traffic down along the route. Static zones (cameras,
// police checkpoints) don't congest the road, so they're excluded.
// These weights are intentionally modest — Google Routes API already accounts
// for baseline traffic congestion. Community reports supplement it with fresh
// driver-reported incidents that may not yet be reflected in Google's data.
const TRAFFIC_DELAY_WEIGHTS_MIN: Record<string, number> = {
  closure: 8,
  accident: 6,
  roadblock: 5,
  traffic: 4,
  roadworks: 3,
  breakdown: 2,
  weather: 2,
};
const MAX_TRAFFIC_DELAY_MIN = 20;

/** Estimates total traffic delay (seconds) from community reports ahead on
 *  the route. Each report's weight scales with how many drivers confirmed
 *  it — confirmed reports carry more confidence, single unconfirmed reports
 *  are discounted — then the total is capped to avoid an unrealistic figure. */
function estimateTrafficDelayS(incidents: RouteIncident[]): number {
  let totalMin = 0;
  for (const inc of incidents) {
    if (inc.source !== "report") continue;
    const base = TRAFFIC_DELAY_WEIGHTS_MIN[inc.type];
    if (!base) continue;
    const confirms = inc.confirmCount ?? 0;
    const confidence = confirms > 0 ? Math.min(1 + confirms * 0.15, 1.6) : 0.7;
    totalMin += base * confidence;
  }
  return Math.min(totalMin, MAX_TRAFFIC_DELAY_MIN) * 60;
}

// ─── Notification setup ───────────────────────────────────────────────────────
// NOTE: setNotificationHandler is registered ONCE in usePushNotifications.ts
// at module scope. Do NOT register it here — two handlers on the same process
// both fire for every incoming notification, causing iOS to show each remote
// push twice (once per handler registration).

async function requestNotificationPermissionInternal(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  // Check first — only show the pre-explanation when the system dialog will
  // actually appear (i.e. status is "undetermined"). If permission was already
  // granted or permanently denied we skip straight to the status check.
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "undetermined") {
    await new Promise<void>(resolve =>
      Alert.alert(
        "Safety Alerts & Notifications",
        "Msafiri sends real-time push notifications for speed cameras, police checkpoints, road hazards, and accidents reported near your route — even when the app is running in the background.\n\nYou can manage which notifications you receive in Settings at any time.",
        [{ text: "Continue", onPress: () => resolve() }],
        { cancelable: false }
      )
    );
  }
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

async function fireZoneNotification(zone: SpeedZone, distM: number) {
  if (Platform.OS === "web") return;
  if (Platform.OS === "android" && !(await ensureAndroidNotificationChannels())) {
    console.warn("[alerts] Android channel setup failed; zone notification skipped.");
    return;
  }
  const typeLabel = zone.type === "camera" ? "Speed Camera" : zone.type === "police" ? "Police Checkpoint" : "Speed Zone";
  const d = distM < 1000 ? `${Math.round(distM)} m` : `${(distM / 1000).toFixed(1)} km`;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `⚠️ ${typeLabel} Ahead — ${zone.speedLimit} km/h`,
      body: `${zone.name} is ${d} away on ${zone.road}.`,
      // lat/lng/type allow the notification tap handler to open the map and
      // pulse-highlight the exact alert pin instead of just navigating to the map root.
      data: { zoneId: zone.id, type: zone.type, lat: zone.lat, lng: zone.lng },
    },
    // On Android the channel must be specified on the trigger, not in content.
    // { channelId } without a time value fires immediately, same as trigger:null.
    // Without this Android 8+ silently discards the notification because it
    // falls back to the "default" channel which is permanently low-importance.
    trigger: Platform.OS === "android"
      ? { channelId: ANDROID_ALERTS_CHANNEL_ID } as any
      : null,
  });
}

// Surfaces the one-time explanation when the API rejects a report/vote
// because this device has been blocked by a moderator, instead of leaving
// the driver to wonder why their reports keep disappearing. Returns true if
// the error was a device-block 403 (so callers can skip other error UI).
function warnIfBlockedDevice(err: unknown): boolean {
  if (err instanceof ApiError && err.status === 403 && /blocked/i.test(err.message)) {
    Alert.alert("Account Restricted", err.message);
    return true;
  }
  return false;
}

const ALERT_DIST = 600, IN_ZONE_DIST = 250, MIN_TRIP_DIST = 200, STOP_TIMEOUT_MS = 180000;
/** Maximum distance (metres) between two zone entries that are considered the
 *  same physical enforcement cluster (e.g. roundabout cameras, opposing-lane
 *  cameras at the same interchange).  Only the nearest member triggers an
 *  alert so the driver sees exactly one warning per site. */
const CAMERA_CLUSTER_RADIUS = 50;
// Tighter than IN_ZONE_DIST: this gates the persistent "current road limit"
// readout, so we only claim confidence in a posted limit when squarely
// inside the admin-defined corridor — not just "somewhere nearby".
const STRETCH_CORRIDOR_M = 80;
const ALERT_VOICE_DELAY_MS = 1500;
// ─── Provider ────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [locationGranted, setLocationGranted] = useState(false);
  const [currentLat, setCurrentLat] = useState<number | null>(null);
  const [currentLng, setCurrentLng] = useState<number | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [activeAlert, setActiveAlert] = useState<DriveAlert | null>(null);
  const [activeAlertExtras, setActiveAlertExtras] = useState<DriveAlert[]>([]);
  // Keep the short chime and spoken alert separate. A pending voice is
  // replaced by a newer alert so stale speech cannot play after the banner
  // has moved on to another hazard.
  const alertVoiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleAlertVoice = useCallback((speak: () => Promise<void>) => {
    if (alertVoiceTimerRef.current) {
      clearTimeout(alertVoiceTimerRef.current);
    }
    const generation = getAlertOwnershipGeneration();
    alertVoiceTimerRef.current = setTimeout(() => {
      alertVoiceTimerRef.current = null;
      // The dedicated background task owns audio once the app leaves active
      // state. Do not let a foreground voice timer cross the handoff boundary.
      if (!canDeliverForegroundAlert() || !isCurrentAlertGeneration(generation)) return;
      speak().catch(() => {});
    }, ALERT_VOICE_DELAY_MS);
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "background") return;
      if (alertVoiceTimerRef.current) {
        clearTimeout(alertVoiceTimerRef.current);
        alertVoiceTimerRef.current = null;
      }
      stopAlertVoice();
      stopSound("alert");
    });
    return () => sub.remove();
  }, []);
  useEffect(() => () => {
    if (alertVoiceTimerRef.current) {
      clearTimeout(alertVoiceTimerRef.current);
      alertVoiceTimerRef.current = null;
    }
  }, []);
  const [currentSpeedLimit, setCurrentSpeedLimit] = useState<number | null>(null);
  const [nearbyZones, setNearbyZones] = useState<Array<SpeedZone & { distance: number }>>([]);
  const [hudMode, setHudModeState] = useState(false);
  const [themeOverride, setThemeOverrideState] = useState<"system" | "light" | "dark">("system");
  const [sosContact, setSosContactState] = useState<SOSContact | null>(null);
  const [communityReports, setCommunityReports] = useState<CommunityReport[]>([]);
  const [hereIncidents, setHereIncidents] = useState<HereIncident[]>([]);
  const dismissedHereIdsRef = useRef<Set<string>>(new Set());
  /** Ref mirror of hereIncidents — read by the GPS handler (stable useCallback)
   *  so it always sees the current list without stale closure captures. */
  const hereIncidentsRef = useRef<HereIncident[]>([]);
  const [currentTrip, setCurrentTrip] = useState<Partial<TripData> | null>(null);
  const [tripHistory, setTripHistory] = useState<TripData[]>([]);
  // Stored odometer total for the active vehicle (initialOdometerKm + tripAccumulatedKm
  // from care storage). Updated after every updateTripOdometer() write so it never
  // races with async storage operations. liveOdometerKm adds currentTrip distance on
  // top so the displayed value ticks up during an active drive.
  const [odoBaseKm, setOdoBaseKm] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [lastAlertDataSyncedAt, setLastAlertDataSyncedAt] = useState<Date | null>(null);
  const [vehicleType, setVehicleTypeState] = useState<VehicleTypeId>(DEFAULT_VEHICLE_TYPE);
  const vehicleTypeRef = useRef<VehicleTypeId>(DEFAULT_VEHICLE_TYPE);
  const [vehicleMakeId, setVehicleMakeIdState] = useState<string | null>(null);
  const [vehicleModelId, setVehicleModelIdState] = useState<string | null>(null);
  const [vehicleCustomMakeName, setVehicleCustomMakeNameState] = useState<string | null>(null);
  const [vehicleCustomModelName, setVehicleCustomModelNameState] = useState<string | null>(null);

  // ── Active vehicle — kept in a ref so crash detection callbacks read a fresh
  // value without stale closure captures. VehicleProvider is an ancestor of
  // AppProvider in _layout.tsx so this hook is safe to call here.
  const { activeVehicleId: _activeVehicleId } = useVehicle();
  const activeVehicleIdRef = useRef<string | null>(null);
  useEffect(() => { activeVehicleIdRef.current = _activeVehicleId; }, [_activeVehicleId]);

  // ── Live odometer baseline — reload from care storage whenever the active
  // vehicle changes.  The context value adds currentTrip.distance on top so
  // the displayed total ticks up every ~4 s while driving without hitting
  // AsyncStorage on every GPS fix.
  useEffect(() => {
    loadVehicles().then(async vs => {
      const active = vs.find(v => v.id === _activeVehicleId) ?? vs.find(v => v.isDefault) ?? vs[0];
      if (!active) return;
      const data = await loadVehicleCareData(getCareStorageKey(active.id, active.isDefault));
      setOdoBaseKm(estimatedOdometerKm(data));
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_activeVehicleId]);

  const currentLatRef = useRef<number | null>(null);
  const currentLngRef = useRef<number | null>(null);
  // Extra navigation refs used by the share-trip ping interval so it can read
  // fresh values inside setInterval without stale closure captures.
  const currentSpeedRef      = useRef(0);
  const currentSpeedLimitRef = useRef<number | null>(null);
  // Last integer km/h passed to setCurrentSpeed — skip setState when the
  // rounded value hasn't changed so a float fluctuation (54.3 → 54.7, both
  // display as 54) doesn't trigger a full context re-render every GPS tick.
  const lastSetSpeedKmhRef   = useRef(-1);
  // Last heading value passed to setDriverHeading — skip setState when the
  // change is < 2° so GPS-heading noise doesn't cause 1 Hz re-renders while
  // driving straight.  Uses angleDiffDeg for wrap-around-safe comparison.
  // Initialised to null (same as the driverHeading initial state) so the first
  // real heading value always passes the gate.
  const lastSetHeadingRef    = useRef<number | null>(null);
  
  const durationRemainingRef = useRef<number | null>(null);
  const distanceRemainingRef = useRef<number | null>(null);
  // Share-trip
  const shareTokenRef        = useRef<string | null>(null);
  const sharePingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Navigation
  const [mapPickerActive, setMapPickerActive] = useState(false);
  const [navDestination, setNavDestState] = useState<NavDestination | null>(null);
  const [activeRoute, setActiveRoute] = useState<AppRoute | null>(null);
  const [altRoutes, setAltRoutes] = useState<AppRoute[]>([]);
  const [routeLoading, setRouteLoading] = useState(false);
  const [showTraffic, setShowTrafficState] = useState(false);
  const [routeIncidentsExpanded, setRouteIncidentsExpanded] = useState(false);
  const [dbZones, setDbZones] = useState<SpeedZone[]>([]);
  const [suppressedStaticIds, setSuppressedStaticIds] = useState<string[]>([]);
  const [dbStretches, setDbStretches] = useState<SpeedStretch[]>([]);
  // ── Crash detection ──────────────────────────────────────────────────────
  const [crashDetected, setCrashDetected] = useState(false);
  const [crashAssistantId, setCrashAssistantId] = useState<string | null>(null);
  const [crashSensitivity, setCrashSensitivityState] = useState<"low" | "medium" | "high">("medium");
  const [dashcamActive, setDashcamActiveState] = useState(false);
  /** Rolling 2-second window of net magnitude samples (g − 9.8), at 20 Hz ≈ 40 entries. */
  // Each sample stores the net-G magnitude plus whether vertical G dominated
  // (|z-9.8| > |x| AND |z-9.8| > |y|). Vertical-dominant samples are potholes,
  // not crashes — they are excluded from the crash peak calculation.
  const accelWindowRef    = useRef<Array<{ g: number; vd: boolean }>>([]);
  // 200-sample (10 s at 20 Hz) rolling window used to compute the road-roughness
  // noise floor. Rougher roads raise the effective crash threshold so potholes
  // on bad Kenyan B-roads don't pile up into false crash alerts.
  const roughnessWindowRef = useRef<number[]>([]);
  /** Rolling 2-second window of GPS speed readings (km/h). Populated by the GPS handler. */
  const speedWindowRef = useRef<{ t: number; kmh: number }[]>([]);
  const crashSensitivityRef = useRef<"low" | "medium" | "high">("medium");
  const crashDetectedRef = useRef(false);
  const dashcamActiveRef = useRef(false);
  const [driverHeading, setDriverHeading] = useState<number | null>(null);
  const allZonesRef = useRef<SpeedZone[]>(SPEED_ZONES);
  const dbStretchesRef = useRef<SpeedStretch[]>([]);
  // Synchronous mirrors of dbZones/suppressedStaticIds state — read by admin
  // callbacks that need the current value before the next render cycle fires.
  const dbZonesRef = useRef<SpeedZone[]>([]);
  /** Raw ApiSpeedZone objects keyed by their DB id, used for stale-while-revalidate. */
  const prevApiZonesMapRef = useRef<Map<string, ApiSpeedZone>>(new Map());
  /** Timestamp (ms) when each DB zone id was last seen in an API response. */
  const dbZoneLastSeenRef  = useRef<Map<string, number>>(new Map());
  const suppressedStaticIdsRef = useRef<string[]>([]);

  const [profilePhotoUri, setProfilePhotoUriState] = useState<string | null>(null);
  // ── Drive tab trip state (surfaced so Home tab can show dynamic button) ───
  const [navTripActive, setNavTripActiveState] = useState(false);
  const [navTripPaused, setNavTripPaused] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [driverName, setDriverNameState] = useState<string>("");
  const driverNameRef = useRef<string>("");
  const isOfflineRef = useRef(false);
  const deviceIdRef = useRef<string | null>(null);
  const pollLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareCode,  setShareCode]  = useState<string | null>(null); // short code for the public share URL

  const [pendingConfirmationReport, setPendingConfirmationReport] = useState<CommunityReport | null>(null);
  const [pendingConfirmationSource, setPendingConfirmationSource] = useState<"proximity" | "recent" | null>(null);
  const [pendingFocusCoords, setPendingFocusCoords] = useState<{ lat: number; lng: number } | null>(null);
  const votedReportIdsRef = useRef<Set<string>>(new Set());
  const hasVotedOnReport = useCallback((id: string) => votedReportIdsRef.current.has(id), []);
  // Tracks server IDs the driver denied locally; prevents the 60-s poll from
  // re-inserting the report before the server records the denial.
  const locallyDeniedServerIdsRef = useRef<Set<string>>(new Set());

  const sessionPromptedIdsRef = useRef<Set<string>>(new Set());
  const markReportPrompted = useCallback((id: string) => { sessionPromptedIdsRef.current.add(id); }, []);
  const isReportPrompted = useCallback((id: string) => sessionPromptedIdsRef.current.has(id), []);

  const alertZoneRef = useRef<string | null>(null);
  const alertDismissed = useRef(false);
  // Track the last value we called setActiveAlert with so we can skip the
  // call when nothing meaningful has changed. Calling setActiveAlert on every
  // GPS fix (1 Hz) with a new object reference causes the entire drive screen
  // to re-render every second, which saturates the JS bridge and makes the map
  // unresponsive to pan/zoom/drag gestures.
  const lastSetAlertRef = useRef<{ id: string; tier: number; distM: number } | null>(null);
  // Last known haversine distance to the active alert zone — kept solely so
  // the dismiss cooldown's peakDistM is seeded with a real value on commit.
  // No longer used for the consecutive-increase pass-through logic.
  const alertZoneLastDistRef = useRef<number | null>(null);
  // Ref that mirrors the routeIncidents memo so the GPS handler (a useEffect
  // closure) can look up a zone's along-route distance without closure staleness.
  const routeIncidentsRef = useRef<RouteIncident[]>([]);
  // Coordinates of the alert item at the moment the alert activated — stored
  // once so dismiss logic can compute bearing-to-alert on every GPS tick
  // without a per-tick zone/report lookup.  Cleared on any dismiss path.
  const alertItemLatRef  = useRef<number | null>(null);
  const alertItemLngRef  = useRef<number | null>(null);
  // Road the driver was on when the alert activated.  Used by the null-road
  // divert gate: if the current road becomes null after a turn, we know the
  // driver was originally on a named road and can use bearing to confirm a divert.
  const alertApproachRoadRef = useRef<string | null>(null);
  // Consecutive GPS fixes where the bearing from driver to alert differs from
  // the driver's heading by > 110°.  Two consecutive diverged fixes trigger a
  // divert-away dismiss.  Reset to 0 on any non-diverged fix or dismiss.
  const alertBearingDivCountRef = useRef(0);
  // Consecutive GPS fixes where haversine distance to the active alert is
  // *increasing* while the driver was inside IN_ZONE_DIST and heading was
  // unavailable.  Two consecutive fixes above the jitter threshold (15 m)
  // trigger a pass-through dismiss — same hysteresis as bearing-divergence.
  const alertDistReversalCountRef = useRef(0);
  // Per-zone cooldown after auto-dismiss. Prevents an alert from immediately
  // re-triggering due to GPS jitter briefly re-entering the 1 km alert radius
  // after a dismiss. Maps dismissed alert id → { expiry, peakDistM }.
  // peakDistM starts at the distance when the alert was dismissed and is
  // updated upward on every GPS tick while in cooldown.  When the driver
  // re-approaches to within (peakDistM − 300 m) the cooldown is cancelled
  // early — a genuine U-turn or loop will have built enough peak distance for
  // the threshold to be reachable; brief GPS jitter never will.
  const alertDismissCooldownRef = useRef<Map<string, { expiry: number; peakDistM: number }>>(new Map());
  // Road name the driver is currently on. Resolved from the active navigation
  // step (precise, from Google Routes) or via periodic server reverse-geocoding
  // (≤once per 150 m / 20 s outside navigation).
  //   • null  = unknown road → tagged alerts wait; untagged legacy alerts may
  //             still use distance/direction fallback
  //   • ""    = never used; always set to a road string or null
  // IMPORTANT: always write the result explicitly, including null, so a stale
  // road name from a previous road is never kept when the new one is unknown.
  const currentRoadRef        = useRef<string | null>(null);
  const lastRoadFetchCoordRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastRoadFetchTimeRef  = useRef<number>(0);
  // Monotonically-increasing counter for road-name geocode requests.
  // Each outgoing fetch captures the current value; the .then() callback
  // discards the result if the counter has since advanced (stale response).
  const roadFetchSeqRef       = useRef<number>(0);
  // Road-name warm-up: fired the instant driving begins so the first
  // kilometre of a non-navigating trip uses a real road name rather than
  // the distance-only fallback.
  const prevIsDrivingRef     = useRef<boolean>(false);
  const drivingStartCoordRef = useRef<{ lat: number; lng: number } | null>(null);
  /** True from the moment the warm-up fetch is dispatched until it settles
   *  (resolve or error).  Used by the road-ready gate below. */
  const roadWarmupPendingRef = useRef<boolean>(false);
  const lastSpeedingWarnRef = useRef<number>(0);
  const tripRef = useRef<Partial<TripData> | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ── 20 m warm-up gate for trip tracking ──────────────────────────────────
  // Mirrors the useDriveScore warm-up: accumulates GPS distance on every fix
  // regardless of speed, and only starts the tripRef once the driver has moved
  // ≥ 20 m total. This prevents GPS noise on app open from creating a spurious
  // trip even if the kmh > 5 speed guard were removed.
  //
  // tripWarmupPrevLat/Lng track the previous fix position during the warm-up
  // phase. We cannot reuse lastFixRef here because it is updated to the current
  // fix before the trip-tracking block runs.
  const tripWarmupDistRef    = useRef(0);     // metres accumulated during warm-up
  const tripWarmupDoneRef    = useRef(false);
  const tripWarmupPrevLatRef = useRef<number | null>(null);
  const tripWarmupPrevLngRef = useRef<number | null>(null);
  const notifGranted = useRef(false);
  const routeRef = useRef<AppRoute | null>(null);
  const lastLocationAtRef = useRef(0);
  const lastFixRef = useRef<{ lat: number; lng: number; t: number } | null>(null);
  /** Epoch ms of the most recent accepted GPS fix, updated on every handleLocation
   *  invocation (not rate-limited like setCurrentSpeed). Exposed via context so
   *  consumers such as DashcamContext can check GPS freshness independently of
   *  whether the rounded speed integer happened to change. */
  const gpsLastFixAtRef = useRef<number>(0);
  const speedHistoryRef = useRef<number[]>([]);
  const stationaryStreakRef = useRef(0);
  // Counts consecutive GPS fixes with speed ≥ 3 km/h. We only exit the
  // "stationary" state after 2+ consecutive moving fixes so a single noisy
  // GPS sample (e.g. 4 km/h while the car is parked) does not break the
  // streak and briefly expose the driver to a false zone alert.
  const movingStreakRef = useRef(0);
  // Last matched index into the active route's coordinate array, used to
  // window the per-GPS-fix "where am I along the route" projection instead
  // of rescanning every coordinate every second (see currentRouteDistanceM).
  const routeProjIdxRef = useRef(0);
  // High-water mark of the driver's along-route progress in metres.
  // Only ever increases — GPS jitter can temporarily snap the projection to an
  // earlier route point (via the –5 lookback window), which would make
  // currentRouteDistanceM decrease and cause already-passed incidents to
  // reappear as "ahead" with growing distances. The high-water mark is used
  // instead of the raw projection value for incident filtering / aheadDistanceM.
  const routeMaxDistMRef = useRef(0);
  const communityReportsRef = useRef<CommunityReport[]>([]);
  const navDestRef = useRef<NavDestination | null>(null);
  const lastHeadingRef  = useRef<number | null>(null); // last known heading (°)
  const alertSourceRef = useRef<"zone" | "report" | "here" | null>(null);
  // Type and road of the currently active alert's zone (e.g. "camera", "Ngong Road").
  // Needed for cluster deduplication: a nearby camera on the SAME road must not
  // replace/re-announce an active camera alert from the same physical cluster.
  const alertZoneTypeRef = useRef<string | null>(null);
  const alertZoneRoadRef = useRef<string | null>(null);
  // Geo-anchor for multi-alert clusters: set when a cluster (lead + extras) is
  // announced. New cluster activation is suppressed until the driver travels
  // > 1 km from this anchor point.
  const alertAnchorLatRef = useRef<number | null>(null);
  const alertAnchorLngRef = useRef<number | null>(null);
  // When the driver manually dismisses a cluster while parked, we keep the
  // anchor locked for 10 minutes (ANCHOR_DISMISS_TTL_MS) instead of clearing
  // it immediately.  This prevents the cluster from re-announcing every time
  // the driver inches past the 250 m pass threshold and then approaches again.
  // The anchor still clears if the driver travels > 1 km (driving-through),
  // or when this TTL expires naturally.
  const alertAnchorExpiryRef = useRef<number | null>(null);
  // Tracks the last extras array we called setActiveAlertExtras with, as a
  // sorted ID string, to avoid re-rendering on every GPS tick.
  const lastExtrasKeyRef  = useRef<string>("");
  // Keyed fingerprint of the last setNearbyZones call — avoids calling setState
  // on every GPS tick when the driver is stationary and nearby zones haven't changed.
  const lastNearbyZonesKeyRef = useRef<string>("");
  // Timestamp of the last setCurrentTrip state update — the ref always holds
  // the latest trip data; the state is throttled to once every 4 s to reduce
  // the render cascade during navigation (currentTrip isn't used for live
  // speed display — that's currentSpeed — so slower state updates are safe).
  const lastTripStateAtRef = useRef<number>(0);
  // ── Continuous-odometer tracking ─────────────────────────────────────────
  // Accumulates GPS movement OUTSIDE active trips so casual/short drives
  // (< MIN_TRIP_DIST) still count toward the vehicle odometer.  When a trip IS
  // active the trip tracker handles accumulation, so we skip this path to avoid
  // double-counting.  Flushes to AsyncStorage every 100 m (by distance) or
  // every 60 s (by time) to minimise write frequency.
  const odoContPrevLatRef  = useRef<number | null>(null);
  const odoContPrevLngRef  = useRef<number | null>(null);
  const odoContPendingMRef = useRef(0);   // accumulated metres awaiting flush
  const odoContFlushAtRef  = useRef(0);   // epoch-ms of last flush
  // True while the background odometer task is running and owns distance
  // accounting. Gates the foreground trip/odometer accumulators so a fix
  // delivered to the (possibly still-alive) foreground watch while
  // backgrounded is never counted on top of the background task's tally.
  const bgOdoActiveRef = useRef(false);
  // Desired-state flag + serialized op chain for the background odometer task.
  // AppState changes only flip the desired state and enqueue a reconcile op on
  // the chain; ops run strictly one at a time, so a start resolving late can
  // never race a newer stop (and vice versa) and the shared task/AsyncStorage
  // state is never touched by two transitions concurrently.
  const bgOdoDesiredRef = useRef(false);
  const bgOdoChainRef = useRef<Promise<void>>(Promise.resolve());
  // Forwards to syncReportToServer (defined later, alongside addReport) so
  // the reconnect-retry sweep above can call it without an ordering issue.
  const syncReportToServerRef = useRef<((localId: string, type: CommunityReport["type"], lat: number, lng: number, speedLimit?: number) => void) | null>(null);

  // ── Startup load ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
      const [trips, reports, hud, sos, onboarded, storedDeviceId, storedTheme, storedVehicleType, savedShare, storedDriverName, storedCrashSensitivity, storedProfilePhoto, storedMakeId, storedModelId, storedCustomMakeName, storedCustomModelName] = await Promise.all([
        AsyncStorage.getItem(KEYS.TRIPS),
        AsyncStorage.getItem(KEYS.REPORTS),
        AsyncStorage.getItem(KEYS.HUD),
        AsyncStorage.getItem(KEYS.SOS),
        AsyncStorage.getItem(KEYS.ONBOARDING),
        AsyncStorage.getItem(KEYS.DEVICE_ID),
        AsyncStorage.getItem(KEYS.THEME),
        AsyncStorage.getItem(KEYS.VEHICLE_TYPE),
        AsyncStorage.getItem(KEYS.SHARE),
        AsyncStorage.getItem(KEYS.DRIVER_NAME),
        AsyncStorage.getItem(KEYS.CRASH_SENSITIVITY),
        AsyncStorage.getItem("profile_photo_uri"),
        AsyncStorage.getItem(KEYS.VEHICLE_MAKE_ID),
        AsyncStorage.getItem(KEYS.VEHICLE_MODEL_ID),
        AsyncStorage.getItem(KEYS.VEHICLE_CUSTOM_MAKE_NAME),
        AsyncStorage.getItem(KEYS.VEHICLE_CUSTOM_MODEL_NAME),
      ]);
      if (storedVehicleType) {
        const v = storedVehicleType as VehicleTypeId;
        setVehicleTypeState(v);
        vehicleTypeRef.current = v;
      }
      if (trips) {
        try {
          const parsed = JSON.parse(trips);
          if (Array.isArray(parsed)) setTripHistory(parsed);
        } catch { /* corrupt cache — silently reset */ }
      }
      if (reports) {
        try {
          const parsed: CommunityReport[] = JSON.parse(reports);
          if (Array.isArray(parsed)) {
            const pruned = pruneReportCache(parsed, Date.now());
            setCommunityReports(pruned);
            // Persist the pruned list immediately so evicted entries don't reload
            // the next time the app starts.
            if (pruned.length < parsed.length) {
              AsyncStorage.setItem(KEYS.REPORTS, JSON.stringify(pruned)).catch(() => {});
            }
          }
        } catch { /* corrupt cache — silently reset */ }
      }
      if (hud) {
        try {
          const parsed = JSON.parse(hud);
          if (typeof parsed === "boolean") setHudModeState(parsed);
        } catch { /* corrupt — ignore */ }
      }
      if (sos) {
        try {
          const parsed = JSON.parse(sos);
          if (parsed && typeof parsed === "object") setSosContactState(parsed);
        } catch { /* corrupt — ignore */ }
      }
      if (storedTheme) {
        const t = storedTheme as "system" | "light" | "dark";
        setThemeOverrideState(t);
        if (Platform.OS !== "web") {
          Appearance.setColorScheme(t === "system" ? null : t);
        }
      }
      if (storedDriverName) {
        driverNameRef.current = storedDriverName;
        setDriverNameState(storedDriverName);
      }
      if (storedCrashSensitivity === "low" || storedCrashSensitivity === "medium" || storedCrashSensitivity === "high") {
        setCrashSensitivityState(storedCrashSensitivity);
        crashSensitivityRef.current = storedCrashSensitivity;
      }
      if (storedProfilePhoto && !storedProfilePhoto.startsWith("http")) {
        // Resolve the stored value to a full usable URI.
        //
        // Why: on iOS the app container path changes when the app is updated via
        // the App Store or EAS, making any stored absolute path like
        //   /var/mobile/Containers/Data/Application/<UUID>/Documents/profile_photo_x.jpg
        // immediately stale. The photo file itself is NOT deleted — only the
        // UUID prefix changes — so extracting just the filename and prepending
        // the current documentDirectory always points at the live file.
        //
        // Storage format is now filename-only (e.g. "profile_photo_1234.jpg").
        // Legacy builds stored the full path; we handle both by always extracting
        // the last path component.
        try {
          const { documentDirectory } = await import("expo-file-system/legacy");
          if (documentDirectory && Platform.OS !== "web") {
            const filename = storedProfilePhoto.includes("/")
              ? storedProfilePhoto.split("/").pop()!
              : storedProfilePhoto;
            const resolved = `${documentDirectory}${filename}`;
            setProfilePhotoUriState(resolved);
            // Migrate legacy full-path entries to filename-only so they survive
            // future updates without needing another migration pass.
            if (storedProfilePhoto !== filename) {
              AsyncStorage.setItem("profile_photo_uri", filename).catch(() => {});
            }
          } else {
            // Web or no documentDirectory — keep whatever was stored as-is
            setProfilePhotoUriState(storedProfilePhoto);
          }
        } catch {
          setProfilePhotoUriState(storedProfilePhoto);
        }
      } else if (storedProfilePhoto) {
        // Stale HTTP car-image URL stored by an older build — clear it silently
        AsyncStorage.removeItem("profile_photo_uri").catch(() => {});
      }
      if (storedMakeId) setVehicleMakeIdState(storedMakeId);
      if (storedModelId) setVehicleModelIdState(storedModelId);
      if (storedCustomMakeName) setVehicleCustomMakeNameState(storedCustomMakeName);
      if (storedCustomModelName) setVehicleCustomModelNameState(storedCustomModelName);
      setOnboardingComplete(onboarded === "true");
      // Restore any sharing session that survived backgrounding or an app restart
      if (savedShare) {
        try {
          const s = JSON.parse(savedShare) as { token: string; shortCode: string; expiresAt: string };
          if (new Date(s.expiresAt) > new Date()) {
            shareTokenRef.current = s.token;
            setShareToken(s.token);
            setShareCode(s.shortCode ?? null);
            // Restart the ping loop — it reads live GPS via refs so it's safe to start here
            if (sharePingIntervalRef.current) clearInterval(sharePingIntervalRef.current);
            sharePingIntervalRef.current = setInterval(async () => {
              const tk  = shareTokenRef.current;
              const did = deviceIdRef.current;
              const lat = currentLatRef.current;
              const lng = currentLngRef.current;
              if (!tk || !did || lat == null || lng == null) return;
              try {
                const pingBody: Record<string, unknown> = { deviceId: did, lat, lng, speedKmh: currentSpeedRef.current };
                if (durationRemainingRef.current != null) pingBody.durationRemainingS = durationRemainingRef.current;
                if (distanceRemainingRef.current != null) pingBody.distanceRemainingM = distanceRemainingRef.current;
                await apiPatch(`/share/${tk}/ping`, pingBody);
              } catch { /* ignore */ }
            }, 8000);
          } else {
            void AsyncStorage.removeItem(KEYS.SHARE);
          }
        } catch { void AsyncStorage.removeItem(KEYS.SHARE); }
      }
      setHydrated(true);
      // Load or generate persistent device ID (used for deduplication on the server)
      const did = storedDeviceId ?? (genId() + genId());
      if (!storedDeviceId) await AsyncStorage.setItem(KEYS.DEVICE_ID, did);
      deviceIdRef.current = did;
      setDeviceId(did);
      // Only auto-request on launch for returning users who already saw the
      // in-app rationale during onboarding. First-time users get this
      // requested explicitly at the end of onboarding, right after the
      // "Stay Informed" explanation slide.
      if (onboarded === "true") {
        notifGranted.current = await requestNotificationPermissionInternal();
      }
      } catch (e) {
        console.warn("[AppContext] startup load failed:", e);
        // Still mark hydrated so the UI doesn't hang on a blank screen
        setHydrated(true);
      }
    })();
  }, []);

  useEffect(() => { communityReportsRef.current = communityReports; }, [communityReports]);
  useEffect(() => { vehicleTypeRef.current = vehicleType; }, [vehicleType]);

  // ── Auto-sync backup when vehicles change ─────────────────────────────────
  // Debounced by syncBackup internally (5-minute cooldown unless force=true).
  const { vehicles } = useVehicle();
  useEffect(() => {
    const did = deviceIdRef.current;
    if (!did || vehicles.length === 0) return;
    syncBackup(did, { driverName: driverNameRef.current, vehicleType: vehicleTypeRef.current }).catch(() => {});
  }, [vehicles]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { currentLatRef.current = currentLat; }, [currentLat]);
  useEffect(() => { currentLngRef.current = currentLng; }, [currentLng]);
  useEffect(() => { currentSpeedRef.current = currentSpeed; }, [currentSpeed]);
  useEffect(() => { currentSpeedLimitRef.current = currentSpeedLimit; }, [currentSpeedLimit]);

  // ── Offline detection ─────────────────────────────────────────────────────
  // Reports created while offline (or whose initial POST failed) stay local
  // with no serverId. On reconnect, sweep and resend those so a driver who
  // reported on a dead patch of road doesn't have to redo it once back online.
  const retrySyncQueue = useCallback(() => {
    if (!deviceIdRef.current) return;
    for (const rep of communityReportsRef.current) {
      if (rep.isOwn && !rep.serverId && deviceIdRef.current) {
        syncReportToServerRef.current?.(rep.id, rep.type, rep.lat, rep.lng, rep.speedLimit);
      }
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") {
      const on = () => { setIsOffline(false); retrySyncQueue(); };
      const off = () => setIsOffline(true);
      window.addEventListener("online", on);
      window.addEventListener("offline", off);
      setIsOffline(!navigator.onLine);
      return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
    }
    const unsub = NetInfo.addEventListener((s) => {
      const nowOnline = s.isConnected ?? true;
      if (nowOnline && isOfflineRef.current) {
        retrySyncQueue();
        // Replay any drive sessions that were recorded while offline
        const did = deviceIdRef.current;
        if (did) flushOfflineSessions(did).catch(() => {});
      }
      setIsOffline(!nowOnline);
    });
    return unsub;
  }, [retrySyncQueue]);

  // ── Location permission ───────────────────────────────────────────────────

  // On every cold start, check silently whether the user already granted
  // location permission in a previous session. If they did, start GPS
  // immediately without waiting for a manual "Enable GPS" tap — the permission
  // dialog is only shown when actually required (i.e. not yet granted).
  useEffect(() => {
    if (Platform.OS === "web") {
      if ("geolocation" in navigator) setLocationGranted(true);
      return;
    }
    Location.getForegroundPermissionsAsync()
      .then(({ status }) => { if (status === "granted") setLocationGranted(true); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestLocationPermission = useCallback(async () => {
    if (Platform.OS === "web") {
      if ("geolocation" in navigator) setLocationGranted(true);
      return;
    }
    // Only show the pre-explanation when the system dialog will appear.
    // If permission is already granted or permanently denied, skip the Alert.
    const { status: existing } = await Location.getForegroundPermissionsAsync();
    if (existing === "undetermined") {
      await new Promise<void>(resolve =>
        Alert.alert(
          "Location Access",
          "Msafiri needs your GPS location to:\n\n• Show your real-time speed\n• Alert you to nearby speed cameras, police checkpoints, and road hazards\n• Provide turn-by-turn navigation\n\nYour location is only used while the app is active and is never shared without your permission.",
          [{ text: "Continue", onPress: () => resolve() }],
          { cancelable: false }
        )
      );
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    setLocationGranted(status === "granted");
  }, []);

  // ── Notification permission ───────────────────────────────────────────────
  const requestNotificationPermission = useCallback(async () => {
    notifGranted.current = await requestNotificationPermissionInternal();
    return notifGranted.current;
  }, []);

  // ── Core location handler ─────────────────────────────────────────────────
  const handleLocation = useCallback((lat: number, lng: number, speedMs: number | null, accuracyM: number | null = null, nativeHeading: number | null = null) => {
    // Hardware or OS glitches can produce NaN / Infinity coordinates on some
    // devices (especially after a GPS signal loss). Letting NaN flow through
    // haversine, setCurrentLat/Lng, dead-reckoning, or the MapView camera
    // corrupts the entire navigation session. Discard silently and wait for
    // the next fix rather than crashing.
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      console.warn("[GPS] discarded non-finite fix:", lat, lng);
      return;
    }
    // Device-reported GPS speed is often 0/-1/null even while genuinely
    // moving (common on many phones, especially right after a fix or when
    // Doppler-based speed sensing hasn't locked yet). Fall back to a
    // distance/time estimate from consecutive fixes so the speed readout
    // keeps updating in real time regardless of what the device reports.
    //
    // Both sources are noisy when the phone is actually stationary: a poor
    // horizontal accuracy fix can "jump" a few metres between updates, which
    // a naive distance/time calc turns into a false ~5-15 km/h reading. We
    // guard against that with (a) discounting low-accuracy fixes, (b) a
    // minimum-distance-moved dead-band before trusting the computed speed,
    // and (c) a short rolling median to smooth out one-off spikes.
    const deviceKmh = speedMs != null && speedMs >= 0 ? speedMs * 3.6 : null;
    const now = Date.now();
    // Crash-telemetry trail: last GPS fixes before a crash (throttled to 1/5 s).
    gpsBreadcrumb(lat, lng, currentSpeedRef.current ?? 0, accuracyM);
    const prevFix = lastFixRef.current;
    // GPS horizontal accuracy is typically 3-15m in good conditions; treat
    // anything worse as too noisy to derive a speed delta from directly.
    const isLowAccuracy = accuracyM != null && accuracyM > 25;
    let computedKmh: number | null = null;
    if (prevFix) {
      const dt = (now - prevFix.t) / 1000;
      if (dt >= 0.5) {
        const distM = haversine(prevFix.lat, prevFix.lng, lat, lng);
        // A fix can drift a few metres from noise alone even while parked.
        // Require the movement to exceed the fix's own accuracy radius (with
        // a small floor) before treating it as real motion.
        const noiseFloorM = Math.max(4, (accuracyM ?? 8) * 0.6);
        computedKmh = distM > noiseFloorM ? (distM / dt) * 3.6 : 0;
      }
    }
    lastFixRef.current = { lat, lng, t: now };
    gpsLastFixAtRef.current = now;

    let rawKmh =
      deviceKmh != null && deviceKmh > 1 && !isLowAccuracy
        ? deviceKmh
        : computedKmh != null
          ? Math.min(computedKmh, 220)
          : deviceKmh ?? 0;

    // Stationary dead-band: once we've seen several consecutive near-zero
    // readings, snap fully to 0 instead of letting jitter hover at 2-4 km/h.
    // We use a two-sided hysteresis so a single noisy fix (e.g. GPS shows
    // 4 km/h while parked) does not immediately break the stationary streak
    // and expose the driver to a false zone alert — movingStreakRef must
    // reach 2 before we reset stationaryStreakRef.
    if (rawKmh < 3) {
      movingStreakRef.current = 0;
      stationaryStreakRef.current += 1;
      if (stationaryStreakRef.current >= 2) rawKmh = 0;
    } else {
      movingStreakRef.current += 1;
      if (movingStreakRef.current >= 2) {
        stationaryStreakRef.current = 0;
      }
    }

    // Rolling median (last 3 samples) smooths one-off spikes without adding
    // the lag a moving average would — a genuine speed change still shows up
    // within 1-2 fixes.
    const hist = speedHistoryRef.current;
    hist.push(rawKmh);
    if (hist.length > 3) hist.shift();
    const sorted = [...hist].sort((a, b) => a - b);
    const kmh = sorted[Math.floor(sorted.length / 2)];

    // ── Position dead-band guard ──────────────────────────────────────────────
    // Only broadcast lat/lng to React state when the driver has moved ≥ 5 m
    // from the last broadcast position. All internal alert / odometer / zone
    // calculations already use the always-current refs (currentLatRef /
    // currentLngRef), so they are unaffected by this gate.
    //
    // Why 5 m?  GPS jitter while stationary is typically 1–4 m. The old 3 m
    // threshold only suppressed jitter when accuracy was also > 8 m, which
    // let through sub-3 m drifts on high-accuracy (< 8 m) chips. A simple
    // 5 m absolute threshold suppresses parked jitter more reliably and
    // reduces re-renders of AppContext consumers by ~60–80 % during slow
    // stop-start traffic — the most common urban heat scenario.
    const prevSetLat = currentLatRef.current;
    const prevSetLng = currentLngRef.current;
    const posChangeM =
      prevSetLat != null && prevSetLng != null
        ? haversine(prevSetLat, prevSetLng, lat, lng)
        : Infinity;

    if (posChangeM >= 5) {
      setCurrentLat(lat);
      setCurrentLng(lng);
    }
    // Only re-render speed consumers when the displayed (integer) value changes.
    // Sub-1 km/h float fluctuations (e.g. 54.3 → 54.7) are invisible on the
    // speedometer but each unconditional setState floods the context with a
    // full re-render cascade at 1 Hz — the single biggest idle heat source.
    const kmhInt = Math.round(kmh);
    if (kmhInt !== lastSetSpeedKmhRef.current) {
      lastSetSpeedKmhRef.current = kmhInt;
      setCurrentSpeed(kmh);
    }
    // Feed crash detection speed window (2s rolling)
    const nowMs = Date.now();
    speedWindowRef.current.push({ t: nowMs, kmh });
    speedWindowRef.current = speedWindowRef.current.filter((s) => nowMs - s.t <= 2000);

    // Speed zones
    const vehicle = getVehicleTypeDef(vehicleTypeRef.current);
    // Bounding-box pre-filter: discard zones definitely outside a 10 km radius
    // using a cheap degree-delta check before running the full haversine formula.
    // 10 km is well above both ALERT_DIST (600 m) and the 5 km nearbyFiltered
    // gate, so this never silently drops a zone that would have been in range.
    // In practice it cuts haversine calls from 111+ per GPS tick to 0–5 in
    // most of Kenya, cutting object-allocation and GC pressure significantly
    // on older Android devices (Tecno, Itel) at highway speed.
    const BOX_DEG_LAT = 10000 / 111320; // ≈ 0.0898° latitude ≈ 10 km
    const BOX_DEG_LNG = 10000 / (111320 * Math.cos(lat * Math.PI / 180));
    const boxCandidates = allZonesRef.current.filter(
      (z) =>
        z.lat >= lat - BOX_DEG_LAT && z.lat <= lat + BOX_DEG_LAT &&
        z.lng >= lng - BOX_DEG_LNG && z.lng <= lng + BOX_DEG_LNG,
    );
    const withDist = boxCandidates
      .map((z) => ({ ...z, speedLimit: capSpeedLimit(z.speedLimit, vehicle), distance: haversine(lat, lng, z.lat, z.lng) }))
      .sort((a, b) => a.distance - b.distance);
    const nearbyFiltered = withDist.filter((z) => z.distance < 5000);
    // Only setState when the set of nearby zones actually changed — keyed by
    // ID + 50 m distance bucket.  Avoids a full render cascade every GPS tick
    // while the driver is stationary or in an area with stable nearby zones.
    const nearbyKey = nearbyFiltered.map((z) => `${z.id}:${Math.round(z.distance / 50)}`).join(",");
    if (nearbyKey !== lastNearbyZonesKeyRef.current) {
      lastNearbyZonesKeyRef.current = nearbyKey;
      setNearbyZones(nearbyFiltered);
    }
    // Flattened stretch endpoints (isStretchEndpoint) are excluded here: a
    // 250m point-radius match near just one end of a highway can't confirm
    // the driver is actually on that road — the tighter corridor projection
    // below (stretchMatch) is the source of truth for stretch zones.
    const inZone = withDist.find((z) => z.distance <= IN_ZONE_DIST && !z.isStretchEndpoint);

    // A driver can be squarely inside an admin-defined "road stretch" corridor
    // (e.g. the open highway between two towns) without being near either of
    // its two endpoints, so that can't be caught by the point-distance check
    // above. Project the fix onto every stretch's line segment instead, and
    // only treat it as a confident match within a tight lateral corridor.
    const stretchMatch = dbStretchesRef.current.length
      ? dbStretchesRef.current
          .map((s) => {
            const { offsetM, alongFrac } = projectOntoSegment(lat, lng, s.startLat, s.startLng, s.endLat, s.endLng);
            return { ...s, speedLimit: capSpeedLimit(s.speedLimit, vehicle), offsetM, alongFrac };
          })
          .filter((s) => s.offsetM <= STRETCH_CORRIDOR_M && s.alongFrac >= 0 && s.alongFrac <= 1)
          .sort((a, b) => a.offsetM - b.offsetM)[0] ?? null
      : null;

    // A point zone (camera/police checkpoint/local zone) is more specific
    // than a general road-stretch limit, so it takes priority when both
    // match — otherwise fall back to the stretch's posted limit.
    const activeLimitZone = inZone ?? stretchMatch;
    // Guard: skip setState when the speed limit hasn't changed — the driver
    // spends most of a trip inside a single speed zone, so this avoids a
    // re-render on every GPS tick when the limit is stable.
    const newSpeedLimit = activeLimitZone?.speedLimit ?? null;
    if (newSpeedLimit !== currentSpeedLimitRef.current) {
      setCurrentSpeedLimit(newSpeedLimit);
    }

    const isDriving = kmh > 10;

    // ── Haptic feedback when speeding inside a zone (every 25 s) ──────────
    if (activeLimitZone && kmh > activeLimitZone.speedLimit) {
      const warnNow = Date.now();
      if (warnNow - lastSpeedingWarnRef.current > 25000) {
        lastSpeedingWarnRef.current = warnNow;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    } else {
      lastSpeedingWarnRef.current = 0;
    }

    // Driver heading — prefer the device-native GPS bearing from the Expo fix
    // (available on the very first fix, even before two consecutive positions
    // exist).  Fall back to the computed bearing between consecutive fixes when
    // the native value is absent or unavailable (Expo returns -1 in that case).
    const computedHeading = driverHeadingDeg(prevFix, lat, lng);
    const driverHeading = (nativeHeading != null && nativeHeading >= 0)
      ? nativeHeading
      : computedHeading;
    // Gate heading setState on a ≥ 2° change so GPS-heading noise while driving
    // straight (e.g. 87° → 88° → 87°) doesn't fire a re-render every tick.
    // angleDiffDeg handles 359° → 1° wrap-around correctly.
    // We still update on null ↔ number transitions so the map camera knows
    // when heading becomes available or is lost (low-speed / tunnel entry).
    {
      const prevHdg = lastSetHeadingRef.current;
      const hdgChanged =
        driverHeading == null
          ? prevHdg !== null                              // number → null: always emit
          : prevHdg === null                              // null → number: always emit
            || angleDiffDeg(driverHeading, prevHdg) >= 2; // number → number: only on ≥ 2° change
      if (hdgChanged) {
        lastSetHeadingRef.current = driverHeading;
        setDriverHeading(driverHeading);
      }
    }
    lastHeadingRef.current = driverHeading ?? lastHeadingRef.current;

    // ── Current road resolution ───────────────────────────────────────────────
    // Ask the server to reverse-geocode the position at most once per 150 m or
    // 20 s — frequent enough to catch turns without running on every GPS tick.
    {
      // ── Warm-up fetch on drive start ──────────────────────────────────────
      // When driving transitions false → true, fire an immediate getRoadName
      // regardless of the 500 m / 60 s throttle so the first kilometre uses a
      // real road name rather than the distance-only fallback.
      const justStartedDriving = isDriving && !prevIsDrivingRef.current;
      if (justStartedDriving) {
        drivingStartCoordRef.current  = { lat, lng };
        roadWarmupPendingRef.current  = true;
        lastRoadFetchCoordRef.current = { lat, lng };
        lastRoadFetchTimeRef.current  = Date.now();
        const seq = ++roadFetchSeqRef.current;
        void getRoadName(lat, lng).then((road) => {
          if (roadFetchSeqRef.current === seq) {
            currentRoadRef.current      = road;
            roadWarmupPendingRef.current = false;
            if (Platform.OS !== "web") {
              AsyncStorage.setItem(BG_ROAD_CONTEXT_KEY, JSON.stringify({
                road,
                heading: lastHeadingRef.current,
                lat,
                lng,
                ts: Date.now(),
              })).catch(() => {});
            }
          }
        }).catch(() => {
          currentRoadRef.current = null;
          roadWarmupPendingRef.current = false;
        });
      } else {
        const nowMs = Date.now();
        const lastFetch = lastRoadFetchCoordRef.current;
        const distSinceLastFetch = lastFetch
          ? haversine(lat, lng, lastFetch.lat, lastFetch.lng)
          : Infinity;
        if (distSinceLastFetch > 150 || nowMs - lastRoadFetchTimeRef.current > 20_000) {
          lastRoadFetchCoordRef.current = { lat, lng };
          lastRoadFetchTimeRef.current  = nowMs;
          currentRoadRef.current = null;
          roadWarmupPendingRef.current = true;
          // Capture sequence before the async boundary so out-of-order responses
          // (e.g. slow cell signal after a fast Wi-Fi response) are discarded.
          const seq = ++roadFetchSeqRef.current;
          void getRoadName(lat, lng).then((road) => {
            if (roadFetchSeqRef.current === seq) {
              currentRoadRef.current = road;
              roadWarmupPendingRef.current = false;
              if (Platform.OS !== "web") {
                AsyncStorage.setItem(BG_ROAD_CONTEXT_KEY, JSON.stringify({
                  road,
                  heading: lastHeadingRef.current,
                  lat,
                  lng,
                  ts: Date.now(),
                })).catch(() => {});
              }
            }
          }).catch(() => {
            currentRoadRef.current = null;
            roadWarmupPendingRef.current = false;
          });
        }
      }
      // Clear warm-up state when driving stops so the next departure gets a
      // fresh fetch even if it happens from the same spot.
      if (!isDriving && prevIsDrivingRef.current) {
        drivingStartCoordRef.current = null;
        roadWarmupPendingRef.current = false;
      }
    }
    prevIsDrivingRef.current = isDriving;


    // ── Unified alert panel: zones + community reports ────────────────────────
    //
    // Activation gates (ALL must pass):
    //   • isDriving  — speed > 10 km/h; filters GPS jitter while parked/indoors
    //   • roadReady  — no road-name request is still pending
    //   • alertAccuracyOk — GPS fix is reliable enough (≤ 40 m horizontal error)
    //   • roadsMatch — driver and incident are on the same road; unknown road
    //                  means NO match (fail-safe — never spill onto other roads)
    //
    // Road-ready gate: suppress alerts for the short duration of every road-name
    // request. This prevents stale/null road identity from admitting a camera on
    // a nearby parallel carriageway during a turn or initial warm-up.
    const roadReady = !roadWarmupPendingRef.current;

    // Suppress alerts only when the GPS fix is so inaccurate that road position
    // is genuinely untrustworthy (≥ 100 m horizontal error, e.g. indoors or
    // in deep urban canyons where position jumps by an entire block).
    // 40 m was too strict: Expo's Balanced mode is documented at ~100 m, so a
    // 40 m gate silently blocked ALL alerts on many devices/fixes.  100 m is the
    // practical ceiling for usable road-position estimates on a moving vehicle.
    const alertAccuracyOk = accuracyM == null || accuracyM <= 100;

    const isOnDrivenPath = (
      id: string,
      source: "zone" | "report" | "here",
      targetLat: number,
      targetLng: number,
    ): boolean => {
      // Navigation is authoritative: the alert must lie tightly on the chosen
      // route and still be ahead in route order. A forward bearing alone admits
      // hazards on branches that split away in front of the driver.
      if (activeRoute) {
        const routeId = source === "zone"
          ? `static-${id}`
          : source === "report"
            ? `report-${id}`
            : id;
        const incident = routeIncidentsRef.current.find((item) => item.id === routeId);
        if (!incident || (incident.offRouteM ?? Infinity) > ALERT_ROUTE_CORRIDOR_M) return false;
        const aheadM = incident.distanceAlongRouteM - routeMaxDistMRef.current;
        return aheadM >= -15 && aheadM <= ALERT_DIST + 100;
      }

      // Without navigation, use a narrow forward corridor in addition to road
      // identity. This rejects diagonal branches while retaining bends close to
      // the current travel line; road-name refresh handles the bend afterwards.
      const heading = lastHeadingRef.current;
      if (heading == null) return true;
      const distanceM = haversine(lat, lng, targetLat, targetLng);
      const bearing = bearingDeg(lat, lng, targetLat, targetLng);
      const angle = angleDiffDeg(heading, bearing);
      if (angle > 35) return false;
      const lateralM = Math.abs(distanceM * Math.sin(angle * Math.PI / 180));
      return lateralM <= 75;
    };

    // (1) Zone candidate — closest in-range zone on the driver's current road.
    //     All zone/camera types appear regardless of current speed so the driver
    //     can see the upcoming limit and slow down before reaching it.
    //     Legacy zones with no road stored are allowed through (admin-verified).
    const inRangeZones = withDist.filter((z) => z.distance > IN_ZONE_DIST && z.distance <= ALERT_DIST);
    const zoneCandidate = (() => {
      if (!isDriving || !roadReady || !alertAccuracyOk) return null;
      // Pick the closest in-range zone whose road matches the driver's road.
      // Iterating in distance order (withDist is sorted) so the first match is
      // already the nearest; the explicit comparison handles unsorted edge cases.
      let best: typeof inRangeZones[0] | null = null;
      for (const z of inRangeZones) {
        // Allow zones with no road stored (legacy admin entries without road tag).
        // Road-tagged entries require a resolved matching road. Only explicitly
        // untagged legacy entries may use distance/direction fallback.
        //
        // Apply road identity to cameras too. Precise coordinates and heading
        // cannot distinguish close parallel carriageways such as Nairobi
        // Expressway and Mombasa Road, which may have different limits.
        if (z.road && !roadsMatch(currentRoadRef.current, z.road)) continue;
        if (!isOnDrivenPath(z.id, "zone", z.lat, z.lng)) continue;

        // Direction gate: when heading is known, only consider zones that are
        // ahead of the driver (positive along-track).  A negative along-track
        // means the driver has already passed the pin — skip it so the overlay
        // never shows "behind you" distances and passed alerts never re-trigger
        // going straight.  When heading is unavailable (slow roll / fresh GPS)
        // we fall through to distance-only so alerts still fire from a standstill.
        if (lastHeadingRef.current != null) {
          const atd = alongTrackDistanceM(lat, lng, lastHeadingRef.current, z.lat, z.lng);
          if (atd <= 0) continue;
        }

        // Cluster deduplication: speed cameras at roundabouts and interchanges
        // are often stored as multiple entries a few metres apart (one per
        // approach lane).  Speed cameras are omnidirectional — all directions
        // see the same limit — so once we have a camera representative for a
        // cluster we skip any other camera within CAMERA_CLUSTER_RADIUS of it.
        // Non-camera zones (police presence, road works, etc.) are independent
        // hazards and must not be deduplicated by proximity.
        if (
          z.type === "camera" &&
          best !== null && best.type === "camera" &&
          haversine(z.lat, z.lng, best.lat, best.lng) <= CAMERA_CLUSTER_RADIUS
        ) continue;

        if (best === null || z.distance < best.distance) best = z;
      }
      return best;
    })();

    // (2) Report candidate — closest active report < 2 h old on the driver's road.
    //     Community reports always have a roadName (geocoded at submission time),
    //     so roadsMatch() returning false on unknown names is safe here.
    const reportCandidate = (() => {
      if (!isDriving || !roadReady || !alertAccuracyOk) return null;
      let best: (typeof communityReportsRef.current)[0] | null = null;
      let bestDist = Infinity;
      for (const r of communityReportsRef.current) {
        if (r.status === "expired" || r.status === "denied" || r.type === "clear") continue;
        // Age filter removed: the server's expireReports job already marks old reports
        // as expired, and the poll only returns active/confirmed reports. A mobile-side
        // 2 h cutoff was causing police checkpoints and other alerts that are still
        // server-active (TTL up to 4-24 h) to silently stop triggering after 2 hours.
        const d = haversine(lat, lng, r.lat, r.lng);
        if (d <= IN_ZONE_DIST || d > ALERT_DIST || d >= bestDist) continue;
        // Road match: skip only when BOTH roads are known but disagree.
        // Reports without a roadName (unnamed roads) are allowed through on
        // distance alone — mirrors the zone-candidate logic ("Allow zones with
        // no road stored").  This prevents silent blackout on dirt tracks,
        // industrial roads, and newly-opened roads not yet in OSM.
        // Same rule applies when currentRoad is null — fall back to distance only.
        if (r.roadName && !roadsMatch(currentRoadRef.current, r.roadName)) continue;
        if (!isOnDrivenPath(r.id, "report", r.lat, r.lng)) continue;
        // Direction gate: same as zone candidate — skip reports behind the driver.
        if (lastHeadingRef.current != null) {
          const atd = alongTrackDistanceM(lat, lng, lastHeadingRef.current, r.lat, r.lng);
          if (atd <= 0) continue;
        }
        best = r;
        bestDist = d;
      }
      return best ? { report: best, dist: bestDist } : null;
    })();

    // (3) HERE Live Traffic incident candidate — closest non-expired HERE incident
    //     on the driver's current road, using the same distance/road gates as
    //     community reports.  Road match allows incidents without a roadName through
    //     on distance alone, consistent with report-candidate behaviour.
    const hereCandidate = (() => {
      if (!isDriving || !roadReady || !alertAccuracyOk) return null;
      let best: HereIncident | null = null;
      let bestDist = Infinity;
      for (const h of hereIncidentsRef.current) {
        // Skip incidents whose server-supplied end time has already passed.
        if (h.endTime != null && h.endTime < now) continue;
        const d = haversine(lat, lng, h.lat, h.lng);
        if (d <= IN_ZONE_DIST || d > ALERT_DIST || d >= bestDist) continue;
        // Road match: same rule as reports — skip only when BOTH roads are known
        // but disagree.  Unknown roadName = distance-only fallback (no blackout).
        // currentRoad null = distance-only fallback (driver road not yet resolved).
        if (h.roadName && !roadsMatch(currentRoadRef.current, h.roadName)) continue;
        if (!isOnDrivenPath(h.id, "here", h.lat, h.lng)) continue;
        // Direction gate: same as zone/report candidates — skip incidents behind the driver.
        if (lastHeadingRef.current != null) {
          const atd = alongTrackDistanceM(lat, lng, lastHeadingRef.current, h.lat, h.lng);
          if (atd <= 0) continue;
        }
        best = h;
        bestDist = d;
      }
      return best ? { incident: best, dist: bestDist } : null;
    })();

    // (4) Pick winner: closest of zone / community-report / HERE incident —
    // EXCEPT that a speed camera / speed zone outranks other alert types
    // within the radius (drive-test feedback: the camera matters most; the
    // rest stay reachable via the nearby list / extras).
    const zoneDist   = zoneCandidate?.distance ?? Infinity;
    const reportDist = reportCandidate?.dist   ?? Infinity;
    const hereDist   = hereCandidate?.dist     ?? Infinity;
    const minDist    = Math.min(zoneDist, reportDist, hereDist);
    const zoneIsSpeedCam =
      zoneCandidate != null &&
      (zoneCandidate.type === "camera" || zoneCandidate.speedLimit != null);
    const winner: DriveAlert | null =
      minDist === Infinity
        ? null
        : (zoneIsSpeedCam || minDist === zoneDist)
          ? {
              id: zoneCandidate!.id,
              source: "zone" as const,
              type: zoneCandidate!.type,
              name: zoneCandidate!.name,
              road: zoneCandidate!.road,
              description: zoneCandidate!.description,
              distance: zoneCandidate!.distance,
              speedLimit: zoneCandidate!.speedLimit,
              lat: zoneCandidate!.lat,
              lng: zoneCandidate!.lng,
            }
          : minDist === reportDist
            ? {
                id: reportCandidate!.report.id,
                source: "report" as const,
                type: reportCandidate!.report.type,
                name: resolveIncidentType(reportCandidate!.report.type).label,
                road: reportCandidate!.report.roadName,
                distance: reportCandidate!.dist,
                speedLimit: reportCandidate!.report.speedLimit,
                lat: reportCandidate!.report.lat,
                lng: reportCandidate!.report.lng,
                confirmCount: reportCandidate!.report.confirmCount,
                createdAt: reportCandidate!.report.timestamp,
                observationContext: reportCandidate!.report.observationContext,
              }
            : {
                id: hereCandidate!.incident.id,
                source: "here" as const,
                type: hereCandidate!.incident.type,
                name: resolveIncidentType(hereCandidate!.incident.type).label,
                road: hereCandidate!.incident.roadName,
                description: hereCandidate!.incident.description,
                distance: hereCandidate!.dist,
                lat: hereCandidate!.incident.lat,
                lng: hereCandidate!.incident.lng,
              };

    // Signed along-track distance to the winner for the overlay distance label.
    // Uses only the live GPS heading (not the step fallback) — display only,
    // valid outside active navigation too.
    const hdgForOverlay = lastHeadingRef.current;
    const winnerAlongTrackM: number | null = (winner && hdgForOverlay != null)
      ? alongTrackDistanceM(lat, lng, hdgForOverlay, winner.lat, winner.lng)
      : null;

    // (4) Dismiss active alert when:
    //   • it has moved out of the 1 km radius, OR
    //   • the driver has definitively turned away (bearing-divergence gate), OR
    //   • the driver is on a different named road (road-departure gate), OR
    //   • the road became null after a known-road approach + bearing confirms divert, OR
    //   • the driver has passed it (2 consecutive increasing-distance fixes).
    if (alertZoneRef.current && !alertDismissed.current) {
      const curZone   = withDist.find((z) => z.id === alertZoneRef.current);
      const curReport = curZone ? null : communityReportsRef.current.find((r) => r.id === alertZoneRef.current);
      const curHere   = (curZone || curReport) ? null : hereIncidentsRef.current.find((h) => h.id === alertZoneRef.current);

      // If none of the three sources resolves the tracked alert ID, the report
      // has vanished (denied, expired, or cleared from HERE) while we were
      // displaying it. Treat this as an unconditional dismiss — a stale
      // alertZoneRef pointing to a deleted item should never keep the banner
      // alive or crash the app by reading properties on undefined.
      const alertSourceGone = !curZone && !curReport && !curHere;

      const curItemLat = curZone?.lat ?? curReport?.lat ?? curHere?.lat;
      const curItemLng = curZone?.lng ?? curReport?.lng ?? curHere?.lng;
      const curDist    = curZone?.distance
        ?? (curItemLat != null && curItemLng != null ? haversine(lat, lng, curItemLat, curItemLng) : null);

      // Extended cooldown (3 min) is used for divert-away dismissals to prevent
      // the same alert from immediately re-triggering on a parallel road.
      // passthroughWithHeading = true when the driver passed the pin with a valid
      // GPS heading — in that case the direction gate at candidate selection
      // prevents straight-through re-fire, so no time cooldown is needed.
      // A U-turn will flip along-track positive and the alert re-fires naturally.
      let extendedCooldown = false;
      let passthroughWithHeading = false;

      // ── Step-bearing fallback ─────────────────────────────────────────────
      // lastHeadingRef.current is null whenever the driver has moved < 5 m
      // since the last GPS fix (e.g. just after a slow-speed turn at a light).
      const stepFallbackHdg: number | null = null;

      const shouldDismiss = (() => {
        // Alert source is gone from all data sources (denied, expired, removed from HERE).
        // Dismiss immediately so we never access properties on undefined curHere etc.
        if (alertSourceGone) return true;
        if (curDist == null || curDist > ALERT_DIST) return true;

        // All curZone / curReport / curHere accesses below are safe because
        // alertSourceGone was false, meaning at least one source resolved.
        const curItemRoad = curZone?.road ?? curReport?.roadName ?? curHere?.roadName;

        // ── Gap 1: null-road + bearing gate ──────────────────────────────────
        // Current road flipped to null (geocode latency after a turn).  If both
        // the approach road and the alert road are known we cannot rely on name
        // matching, but a bearing ≥ 90° from the approach road confirms a real
        // divert, so we dismiss with an extended cooldown rather than silently
        // keeping the alert alive indefinitely.
        if (curItemRoad && alertApproachRoadRef.current &&
            currentRoadRef.current === null) {
          const iLat = alertItemLatRef.current;
          const iLng = alertItemLngRef.current;
          const hdg  = lastHeadingRef.current ?? stepFallbackHdg;
          if (iLat != null && iLng != null && hdg != null) {
            if (angleDiffDeg(hdg, bearingDeg(lat, lng, iLat, iLng)) >= 90) {
              extendedCooldown = true;
              return true;
            }
          }
        }

        // ── Original road-departure check ─────────────────────────────────────
        // Dismiss immediately when the driver is definitively on a different named road.
        if (currentRoadRef.current && curItemRoad &&
            !roadsMatch(currentRoadRef.current, curItemRoad)) return true;

        // ── Gap 2: bearing-divergence check ───────────────────────────────────
        // Alert is sharply behind or off to the side — clearest signal of a divert.
        // Require 2 consecutive GPS fixes above the 110° threshold before dismissing
        // to absorb GPS heading noise that can produce one spurious bad reading.
        {
          const iLat = alertItemLatRef.current;
          const iLng = alertItemLngRef.current;
          const hdg  = lastHeadingRef.current ?? stepFallbackHdg;
          if (iLat != null && iLng != null && hdg != null) {
            if (angleDiffDeg(hdg, bearingDeg(lat, lng, iLat, iLng)) > 110) {
              alertBearingDivCountRef.current += 1;
              if (alertBearingDivCountRef.current >= 2) {
                extendedCooldown = true;
                return true;
              }
            } else {
              alertBearingDivCountRef.current = 0;
            }
          }
        }

        // ── Pass-through: along-track signed distance ─────────────────────────
        // Dismiss when the alert has crossed from ahead to ≥ 10 m behind the
        // driver on their current heading.  This fires at the exact moment the
        // driver passes the alert pin regardless of GPS jitter (a brief position
        // wobble that inflates haversine distance can't flip the sign).
        //
        // Hold the overlay open when heading is unavailable (speed < ~5 km/h or
        // freshly connected GPS) — along-track is meaningless without direction.
        const hdgAt = lastHeadingRef.current ?? stepFallbackHdg;
        if (hdgAt == null) {
          // No valid heading (slow roll / stop sign / tunnel entry).
          // Normally hold the overlay open — but if the driver was already
          // inside IN_ZONE_DIST and haversine is now *increasing*, they likely
          // passed the pin without a heading lock.
          //
          // Guard against GPS jitter (typically 3–15 m) with two requirements:
          //   1. The increase must be > 15 m (above the noise floor).
          //   2. Two *consecutive* GPS fixes must both show an increase.
          // This mirrors the 2-fix hysteresis used by the bearing-divergence
          // gate and prevents a single noisy fix from triggering a false dismiss.
          const lastDist = alertZoneLastDistRef.current;
          if (
            lastDist != null &&
            lastDist <= IN_ZONE_DIST &&
            curDist != null &&
            curDist > lastDist + 15   // must exceed jitter noise floor
          ) {
            alertDistReversalCountRef.current += 1;
            if (alertDistReversalCountRef.current >= 2) {
              return true; // 2 consecutive growing fixes — driver passed the pin
            }
          } else {
            alertDistReversalCountRef.current = 0; // reset on non-growing fix
          }
          alertZoneLastDistRef.current = curDist;
          return false;
        }
        const iLatAt = alertItemLatRef.current;
        const iLngAt = alertItemLngRef.current;
        if (iLatAt != null && iLngAt != null) {
          const atd = alongTrackDistanceM(lat, lng, hdgAt, iLatAt, iLngAt);
          // Dismiss the moment the driver is level with (or past) the alert pin.
          // Using +10 m tolerance avoids showing a flash of "Passing now" text and
          // covers GPS position jitter at the moment of passing.
          // NOTE: set passthroughWithHeading so the cooldown is cleared immediately —
          // the direction gate at candidate selection prevents straight-through re-fire
          // without needing a time delay; and a U-turn brings atd positive again.
          if (atd <= 10) { passthroughWithHeading = true; return true; }
        }
        // ── Polyline redundancy when navigating ────────────────────────────────
        // Belt-and-suspenders: if the route's high-water mark has already advanced
        // past the alert's along-route position by ≥ 10 m, the driver has
        // physically driven through it even if GPS briefly snapped back.
        if (activeRoute && routeMaxDistMRef.current > 0) {
          const alertId = alertZoneRef.current!;
          const incident = routeIncidentsRef.current.find(
            (i) => i.id === `static-${alertId}` || i.id === `report-${alertId}` || i.id === alertId,
          );
          if (incident && routeMaxDistMRef.current > incident.distanceAlongRouteM + 10) {
            return true;
          }
        }
        alertZoneLastDistRef.current = curDist;
        return false;
      })();

      if (shouldDismiss) {
        const dismissedId = alertZoneRef.current!;
        // • Extended divert-away (different road / sharp bearing flip): 3 min
        // • Normal pass-through WITH known heading: no time cooldown needed —
        //   the direction gate at candidate selection prevents straight-through
        //   re-fire, and a U-turn brings along-track positive again (fires fresh).
        // • Pass-through WITHOUT heading (slow/stopped, haversine fallback): 5 s
        //   to absorb GPS jitter before the next candidate evaluation.
        const cooldownMs = extendedCooldown
          ? 180_000
          : passthroughWithHeading
            ? 0
            : 5_000;
        const cooldownEntry = { expiry: Date.now() + cooldownMs, peakDistM: curDist ?? 0 };
        alertDismissCooldownRef.current.set(dismissedId, cooldownEntry);

        // Cluster-aware dismiss: when a speed camera is passed, also silence any
        // other camera within CAMERA_CLUSTER_RADIUS on the SAME NAMED road.
        // Both road values must be present and match — if either is unknown we
        // cannot confirm same-road membership and leave the neighbour independent
        // (fail-open) to avoid silencing cameras on intersecting streets.
        // Restricted to cameras only — nearby police/zone hazards are independent.
        if (curZone && curZone.type === "camera") {
          for (const z of withDist) {
            if (z.id === dismissedId) continue;
            if (z.type !== "camera") continue;
            // Require both roads known and matching; unknown road = independent.
            if (!z.road || !curZone.road || !roadsMatch(z.road, curZone.road)) continue;
            if (haversine(z.lat, z.lng, curZone.lat, curZone.lng) <= CAMERA_CLUSTER_RADIUS) {
              alertDismissCooldownRef.current.set(z.id, { ...cooldownEntry });
            }
          }
        }
        alertZoneRef.current              = null;
        alertSourceRef.current            = null;
        alertZoneTypeRef.current          = null;
        alertZoneRoadRef.current          = null;
        alertDismissed.current            = false;
        alertZoneLastDistRef.current      = null;
        alertItemLatRef.current           = null;
        alertItemLngRef.current           = null;
        alertApproachRoadRef.current      = null;
        alertBearingDivCountRef.current   = 0;
        alertDistReversalCountRef.current = 0;
        lastSetAlertRef.current           = null;
        setActiveAlert(null);
      }
    }

    // Suppress new overlay popups while the driver is stationary (jitter
    // near a zone while parked should not trigger the panel).
    const isStationary = stationaryStreakRef.current >= 3;

    // ── Extra alerts within 1 km (multi-alert cluster) ───────────────────────
    // Collect all zone and report candidates within 1 km that are NOT the lead
    // winner.  These appear as compact rows below the lead in the overlay.
    const MULTI_RADIUS = 1000; // 1 km
    const extraCandidates: DriveAlert[] = [];
    if (winner && isDriving && roadReady && alertAccuracyOk && !isStationary) {
      for (const z of withDist) {
        if (z.distance <= IN_ZONE_DIST || z.distance > MULTI_RADIUS) continue;
        if (z.isStretchEndpoint) continue;
        if (z.id === winner.id) continue;
        if (z.road && !roadsMatch(currentRoadRef.current, z.road)) continue;
        if (!isOnDrivenPath(z.id, "zone", z.lat, z.lng)) continue;
        // Skip camera cluster members of a camera winner — same physical site.
        // Non-camera zones are independent hazards and must not be filtered out.
        if (
          z.type === "camera" &&
          winner.source === "zone" && winner.type === "camera" &&
          winner.lat != null && winner.lng != null &&
          haversine(z.lat, z.lng, winner.lat, winner.lng) <= CAMERA_CLUSTER_RADIUS
        ) continue;
        extraCandidates.push({
          id: z.id, source: "zone" as const, type: z.type, name: z.name,
          road: z.road, description: z.description, distance: z.distance,
          speedLimit: z.speedLimit, lat: z.lat, lng: z.lng,
        });
      }
      for (const r of communityReportsRef.current) {
        if (r.status === "expired" || r.status === "denied" || r.type === "clear") continue;
        if (now - r.timestamp > 7200000) continue;
        if (r.id === winner.id) continue;
        const d = haversine(lat, lng, r.lat, r.lng);
        if (d <= IN_ZONE_DIST || d > MULTI_RADIUS) continue;
        if (r.roadName && !roadsMatch(currentRoadRef.current, r.roadName)) continue;
        if (!isOnDrivenPath(r.id, "report", r.lat, r.lng)) continue;
        extraCandidates.push({
          id: r.id, source: "report" as const, type: r.type,
          name: resolveIncidentType(r.type).label,
          road: r.roadName, distance: d,
          speedLimit: r.speedLimit,
          lat: r.lat, lng: r.lng,
          confirmCount: r.confirmCount,
        });
      }
      // HERE incidents within 1 km that are not the lead winner
      for (const h of hereIncidentsRef.current) {
        if (h.endTime != null && h.endTime < now) continue;
        if (h.id === winner.id) continue;
        const d = haversine(lat, lng, h.lat, h.lng);
        if (d <= IN_ZONE_DIST || d > MULTI_RADIUS) continue;
        if (h.roadName && !roadsMatch(currentRoadRef.current, h.roadName)) continue;
        if (!isOnDrivenPath(h.id, "here", h.lat, h.lng)) continue;
        extraCandidates.push({
          id: h.id, source: "here" as const, type: h.type,
          name: resolveIncidentType(h.type).label,
          road: h.roadName, description: h.description, distance: d,
          lat: h.lat, lng: h.lng,
        });
      }
      extraCandidates.sort((a, b) => a.distance - b.distance);
    }

    // (5) Activate a new alert or refresh the ongoing one
    // Prune expired cooldown entries to avoid unbounded map growth.
    // Bug #4 fix: when a cooldown expires for the zone that's currently
    // tracked in alertZoneRef, clear that ref too. Without this the new-alert
    // guard (`winner.id !== alertZoneRef.current`) stays false and the zone
    // never re-triggers even though the cooldown has fully elapsed.
    const nowTs = Date.now();
    for (const [k, cd] of alertDismissCooldownRef.current) {
      if (nowTs > cd.expiry) {
        alertDismissCooldownRef.current.delete(k);
        if (alertZoneRef.current === k) {
          alertZoneRef.current              = null;
          alertDistReversalCountRef.current = 0;
        }
      }
    }

    // Geo-anchor check: if a multi-alert cluster was announced, suppress new
    // cluster activation until the driver travels > 1 km from the anchor point
    // OR a dismiss-TTL (set on manual dismissal) expires.
    const ANCHOR_DISMISS_TTL_MS = 10 * 60 * 1000; // 10 minutes // eslint-disable-line @typescript-eslint/no-unused-vars
    const anchorLat = alertAnchorLatRef.current;
    const anchorLng = alertAnchorLngRef.current;
    if (anchorLat != null && anchorLng != null) {
      const distFromAnchor = haversine(lat, lng, anchorLat, anchorLng);
      if (distFromAnchor >= 1000) {
        // Driver has driven far enough away — clear anchor regardless of TTL.
        alertAnchorLatRef.current = null;
        alertAnchorLngRef.current = null;
        alertAnchorExpiryRef.current = null;
      } else if (
        alertAnchorExpiryRef.current != null &&
        Date.now() > alertAnchorExpiryRef.current
      ) {
        // Dismiss-TTL has elapsed — allow new clusters again.
        alertAnchorLatRef.current = null;
        alertAnchorLngRef.current = null;
        alertAnchorExpiryRef.current = null;
      }
    }
    const anchorActive = alertAnchorLatRef.current != null;

    if (winner && !isStationary) {
      // If this winner is under a 60 s cooldown, first update the running peak
      // distance (we track how far away the driver got after the dismiss), then
      // check whether a genuine re-approach has happened.
      //
      // Early-cancel rule: winner.distance ≤ peakDistM − 300 m
      //   • A real U-turn or looping road will have built up a large peak
      //     (e.g. dismissed at 280 m, drove to 900 m peak → cancel at 600 m).
      //   • Brief GPS jitter never accumulates enough peak distance: dismissed
      //     at 280 m, peak only reaches ~350 m → threshold 50 m, which is
      //     always below IN_ZONE_DIST (250 m) → cooldown stays intact.
      const cooldown = alertDismissCooldownRef.current.get(winner.id);
      if (cooldown && nowTs < cooldown.expiry) {
        // Keep peak up-to-date as the driver moves away.
        if (winner.distance > cooldown.peakDistM) {
          cooldown.peakDistM = winner.distance;
        }
        if (winner.distance <= cooldown.peakDistM - 300) {
          // Genuine re-approach — cancel the cooldown early.
          alertDismissCooldownRef.current.delete(winner.id);
        }
        // else: still too close to the peak → suppress via the has() check below.
      }

      // Activate a new alert when:
      //  • Not in the per-ID 60 s cooldown
      //  • Not already the currently-tracked alert
      //  • Not a camera cluster member of the currently active camera alert
      //    (a roundabout's neighbouring entry became nearest mid-alert — same site)
      //  • Not suppressed by geo-anchor — BUT the anchor only blocks NEW CLUSTERS
      //    (candidates that themselves have extras). A single hazard that appears
      //    within the anchor radius must still announce so drivers don't miss it.
      // Road-scoped cluster check: suppress the winner only when it is a camera
      // within 50 m of the active camera AND BOTH roads are known and match.
      // If either road is missing we cannot confirm same-road membership, so we
      // allow the new alert through (fail-open) to avoid silently dropping a
      // camera that may be on a different street.
      const activeRoad  = alertZoneRoadRef.current;
      const winnerRoad  = winner.road ?? null;
      const sameRoad    = !!(activeRoad && winnerRoad && roadsMatch(activeRoad, winnerRoad));
      const winnerIsActiveClusterMember =
        winner.type === "camera" &&
        alertZoneTypeRef.current === "camera" &&
        alertZoneRef.current !== null &&
        sameRoad &&
        alertItemLatRef.current != null &&
        alertItemLngRef.current != null &&
        haversine(winner.lat, winner.lng, alertItemLatRef.current, alertItemLngRef.current)
          <= CAMERA_CLUSTER_RADIUS;
      const isNewAlert = !alertDismissCooldownRef.current.has(winner.id) &&
        winner.id !== alertZoneRef.current &&
        !winnerIsActiveClusterMember &&
        (!anchorActive || extraCandidates.length === 0);
      if (isNewAlert) {
        alertZoneRef.current = winner.id;
        alertSourceRef.current = winner.source;
        alertZoneTypeRef.current = winner.type ?? null;
        alertZoneRoadRef.current = winner.road ?? null;
        alertZoneLastDistRef.current = winner.distance;
        alertDismissed.current = false;
        // Record alert item position and approach road for divert-away detection.
        alertItemLatRef.current       = winner.lat ?? null;
        alertItemLngRef.current       = winner.lng ?? null;
        alertApproachRoadRef.current  = currentRoadRef.current;
        alertBearingDivCountRef.current = 0;
        const foregroundOwnsAlert = canDeliverForegroundAlert();
        if (foregroundOwnsAlert) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        }
        // Fire chime tone + voice from AppContext so both play in sequence
        // from a single call site, eliminating the previous race where the
        // overlay fired the chime independently on its own render cycle.
        if (foregroundOwnsAlert && !getSoundsMuted()) playSound("alert").catch(() => {});
        if (foregroundOwnsAlert && extraCandidates.length > 0) {
          // Multi-alert cluster: set geo-anchor and play bundled multi phrase.
          // Speed camera always takes audio priority in a mixed cluster — the
          // camera_multi phrase ("speed camera and more alerts nearby") covers
          // the most safety-critical case regardless of which alert won the lead.
          alertAnchorLatRef.current = lat;
          alertAnchorLngRef.current = lng;
          alertAnchorExpiryRef.current = null; // fresh anchor — no TTL until driver dismisses
          const clusterHasCamera = winner.type === "camera" ||
            extraCandidates.some((e) => e.type === "camera");
          // Multi-alert: keep base type so speakAlertMulti resolves camera_multi/zone_multi correctly.
          // Speed-limit-specific audio only plays for single alerts where dedicated assets exist.
          scheduleAlertVoice(() => speakAlertMulti(clusterHasCamera ? "camera" : winner.type));
        } else if (foregroundOwnsAlert) {
          // Single alert: play speed-specific phrase when limit is known.
          // For cameras/zones with no stored speed limit, infer from the nearest
          // zone within 300 m so the audio still names a speed rather than falling
          // back to the generic "speed camera ahead" clip.
          let effectiveSpeedLimit = winner.speedLimit;
          if (!effectiveSpeedLimit && (winner.type === "camera" || winner.type === "zone")) {
            // withDist is already sorted by distance — find() returns the nearest first.
            const nearest = withDist.find(
              (z) =>
                z.speedLimit &&
                z.id !== winner.id &&
                z.distance <= 300 &&
                (
                  currentRoadRef.current
                    ? (!z.road || roadsMatch(currentRoadRef.current, z.road))
                    : (!winner.road || !z.road || roadsMatch(winner.road, z.road))
                ),
            );
            if (nearest?.speedLimit) effectiveSpeedLimit = nearest.speedLimit;
          }
          scheduleAlertVoice(() => speakAlert(resolveAlertKey(winner.type, effectiveSpeedLimit)));
        }
        if (tripRef.current) tripRef.current.alertsCount = (tripRef.current.alertsCount ?? 0) + 1;
      }
      if (!alertDismissed.current && winner.id === alertZoneRef.current) {
        // Only call setActiveAlert when something meaningful changes — new ID,
        // urgency tier crossing a threshold (400 m / 200 m), or distance
        // moving by more than 20 m.  Calling it every GPS tick (1 Hz) with a
        // new object reference floods the JS bridge and freezes the map.
        const tier = winner.distance < 200 ? 2 : winner.distance < 400 ? 1 : 0;
        const prev = lastSetAlertRef.current;
        if (!prev || prev.id !== winner.id || prev.tier !== tier || Math.abs(prev.distM - winner.distance) > 20) {
          lastSetAlertRef.current = { id: winner.id, tier, distM: winner.distance };
          setActiveAlert({ ...winner, alongTrackM: winnerAlongTrackM });
        }
        // Update extras: only re-render when the set of IDs changes or any
        // distance moves > 20 m (same throttle as the lead alert).
        const extrasKey = extraCandidates.map(e => `${e.id}:${Math.round(e.distance / 20)}`).join(",");
        if (extrasKey !== lastExtrasKeyRef.current) {
          lastExtrasKeyRef.current = extrasKey;
          setActiveAlertExtras(extraCandidates);
        }
      }
    } else if (!winner) {
      // No candidate in range → clear banner only if the tracked alert is gone
      if (alertZoneRef.current) {
        const stillInRange =
          withDist.some((z) => z.id === alertZoneRef.current && z.distance <= ALERT_DIST) ||
          communityReportsRef.current.some((r) => {
            if (r.id !== alertZoneRef.current) return false;
            return haversine(lat, lng, r.lat, r.lng) <= ALERT_DIST;
          });
        if (!stillInRange) {
          alertZoneRef.current              = null;
          alertSourceRef.current            = null;
          alertDismissed.current            = false;
          alertZoneLastDistRef.current      = null;
          alertItemLatRef.current           = null;
          alertItemLngRef.current           = null;
          alertApproachRoadRef.current      = null;
          alertBearingDivCountRef.current   = 0;
          alertDistReversalCountRef.current = 0;
          lastSetAlertRef.current           = null;
          lastExtrasKeyRef.current          = "";
          setActiveAlert(null);
          setActiveAlertExtras([]);
        }
      }
    }


    // Trip tracking
    //
    // 20 m warm-up gate: accumulate GPS distance on every fix regardless of
    // speed. Only once the driver has demonstrably moved ≥ 20 m total do we
    // open the gate and begin recording the trip. This prevents stationary GPS
    // noise (sub-20 m total drift while the phone is parked or app just opened)
    // from ever starting a trip, even if the brief kmh > 5 spikes occur.
    //
    // Once the gate is open, positions and distance are added on every fix —
    // slow speeds (parking lots, traffic queues, speed bumps) are fully counted.
    // The stop-timer is still triggered when kmh drops to ≤ 5, preserving the
    // existing "wait 3 minutes of stillness before saving" behaviour.
    if (!tripWarmupDoneRef.current) {
      // Accumulate warmup distance from consecutive fixes
      const prevWLat = tripWarmupPrevLatRef.current;
      const prevWLng = tripWarmupPrevLngRef.current;
      if (prevWLat != null && prevWLng != null) {
        const d = haversine(prevWLat, prevWLng, lat, lng);
        // Apply 500 m jump filter (same as the within-trip filter) to avoid
        // a single bad GPS fix instantly satisfying the warm-up threshold.
        if (d > 0 && d < 500) {
          tripWarmupDistRef.current += d;
          if (tripWarmupDistRef.current >= 20) {
            tripWarmupDoneRef.current = true;
          }
        }
      }
      tripWarmupPrevLatRef.current = lat;
      tripWarmupPrevLngRef.current = lng;
    } else {
      // Warm-up satisfied — record the trip regardless of speed.
      // Cancel the stop-timer whenever the vehicle is moving.
      if (kmh > 5 && stopTimer.current) { clearTimeout(stopTimer.current); stopTimer.current = null; }

      if (!tripRef.current) {
        const t: Partial<TripData> = { id: genId(), startTime: Date.now(), distance: 0, maxSpeed: kmh, avgSpeed: kmh, alertsCount: 0, positions: [{ lat, lng, speed: kmh, time: Date.now() }] };
        tripRef.current = t;
        setCurrentTrip({ ...t });
      } else {
        const t = tripRef.current;
        const positions = t.positions ?? [];
        const last = positions[positions.length - 1];
        const rawAdded = last ? haversine(last.lat, last.lng, lat, lng) : 0;
        // Ignore GPS jumps > 500 m (signal-loss artefacts). While the
        // background odometer task is running it owns distance accounting
        // (its pending metres are folded into the trip on resume), so a fix
        // that still reaches this foreground handler must not also count.
        const added = (!bgOdoActiveRef.current && rawAdded > 0 && rawAdded < 500) ? rawAdded : 0;
        const newPos = [...positions, { lat, lng, speed: kmh, time: Date.now() }];
        const trimmed = newPos.length > 300 ? newPos.slice(-150) : newPos;
        const updated: Partial<TripData> = { ...t, distance: (t.distance ?? 0) + added, maxSpeed: Math.max(t.maxSpeed ?? 0, kmh), avgSpeed: trimmed.length > 0 ? trimmed.reduce((s, p) => s + p.speed, 0) / trimmed.length : (t.avgSpeed ?? 0), positions: trimmed };
        tripRef.current = updated;
        // Throttle UI state to once every 4 s — the ref always has the latest
        // data for the post-trip summary; slower state updates are safe here
        // because currentTrip is not used for the live speed display.
        if (Date.now() - lastTripStateAtRef.current > 4000) {
          lastTripStateAtRef.current = Date.now();
          setCurrentTrip({ ...updated });
        }
      }

      // While a trip is active keep the continuous-odometer position pointer
      // current so there is no position jump when the trip ends.
      odoContPrevLatRef.current = lat;
      odoContPrevLngRef.current = lng;

      // Start the stop-timer when speed drops to ≤ 5; the trip saves after
      // STOP_TIMEOUT_MS of continued stillness.
      if (kmh <= 5 && tripRef.current && !stopTimer.current) {
        stopTimer.current = setTimeout(() => {
          const t = tripRef.current;
          if (t && (t.distance ?? 0) >= MIN_TRIP_DIST) {
            const done: TripData = { id: t.id ?? genId(), startTime: t.startTime ?? Date.now(), endTime: Date.now(), distance: t.distance ?? 0, maxSpeed: t.maxSpeed ?? 0, avgSpeed: t.avgSpeed ?? 0, alertsCount: t.alertsCount ?? 0, positions: t.positions ?? [] };
            setTripHistory((prev) => { const u = [done, ...prev].slice(0, 50); AsyncStorage.setItem(KEYS.TRIPS, JSON.stringify(u)); return u; });
            // Increment the care-odometer for whichever vehicle is active
            loadVehicles().then(async vs => {
              const active = vs.find(v => v.id === activeVehicleIdRef.current) ?? vs.find(v => v.isDefault) ?? vs[0];
              if (!active) return;
              const careKey = getCareStorageKey(active.id, active.isDefault);
              await updateTripOdometer(done.distance / 1000, careKey);
              // Keep v.odometerKm in the vehicles list current so the garage
              // page, the edit modal pre-fill, and backups always reflect the
              // live running total (initial odometer + all accumulated trip km).
              const careData = await loadVehicleCareData(careKey);
              const est = estimatedOdometerKm(careData);
              if (est > 0) {
                setOdoBaseKm(est);
                const updated = vs.map(v => v.id === active.id ? { ...v, odometerKm: est } : v);
                await saveVehicles(updated);
              }
            }).catch(() => {});
          } else if (t && (t.distance ?? 0) > 0.01) {
            // Short trip below the save threshold (< MIN_TRIP_DIST km) — we don't
            // record it as a trip entry but we still credit the distance to the
            // vehicle odometer so casual/errand driving isn't silently missed.
            const shortKm = (t.distance ?? 0) / 1000;
            loadVehicles().then(async vs => {
              const active = vs.find(v => v.id === activeVehicleIdRef.current) ?? vs.find(v => v.isDefault) ?? vs[0];
              if (!active) return;
              const careKey = getCareStorageKey(active.id, active.isDefault);
              await updateTripOdometer(shortKm, careKey);
              const careData = await loadVehicleCareData(careKey);
              const est = estimatedOdometerKm(careData);
              if (est > 0) {
                setOdoBaseKm(est);
                const updated = vs.map(v => v.id === active.id ? { ...v, odometerKm: est } : v);
                await saveVehicles(updated);
              }
            }).catch(() => {});
          }
          // Reset trip state and warm-up so the next journey starts fresh
          tripRef.current = null; setCurrentTrip(null); stopTimer.current = null;
          tripWarmupDistRef.current    = 0;
          tripWarmupDoneRef.current    = false;
          tripWarmupPrevLatRef.current = null;
          tripWarmupPrevLngRef.current = null;
        }, STOP_TIMEOUT_MS);
      }
    }

    // ── Continuous odometer (outside active trips) ────────────────────────────
    // Accumulates GPS movement while NO trip is active so warmup movement,
    // very short drives, and any time the app is open without a trip all
    // count toward the vehicle odometer. Flushes every 100 m or 60 s to
    // keep AsyncStorage write frequency low. While a trip IS active the
    // trip tracker accumulates every fix and the else branch above keeps the
    // position pointer current, so there is no gap when the trip ends.
    if (!tripRef.current) {
      const prevOdoLat = odoContPrevLatRef.current;
      const prevOdoLng = odoContPrevLngRef.current;
      if (prevOdoLat != null && prevOdoLng != null) {
        const d = haversine(prevOdoLat, prevOdoLng, lat, lng);
        // Skip accumulation while the background odometer task owns distance
        // (bgOdoActiveRef) — its pending pot is merged back on resume.
        if (!bgOdoActiveRef.current && d > 0 && d < 500) {
          odoContPendingMRef.current += d;
          const now = Date.now();
          const flushByDist = odoContPendingMRef.current >= 100;
          const flushByTime = (now - odoContFlushAtRef.current) > 60_000 && odoContPendingMRef.current > 0;
          if (flushByDist || flushByTime) {
            const pendingKm = odoContPendingMRef.current / 1000;
            odoContPendingMRef.current = 0;
            odoContFlushAtRef.current  = now;
            loadVehicles().then(async vs => {
              const active = vs.find(v => v.id === activeVehicleIdRef.current) ?? vs.find(v => v.isDefault) ?? vs[0];
              if (!active) return;
              const careKey = getCareStorageKey(active.id, active.isDefault);
              await updateTripOdometer(pendingKm, careKey);
              const data = await loadVehicleCareData(careKey);
              const est = estimatedOdometerKm(data);
              if (est > 0) setOdoBaseKm(est);
            }).catch(() => {});
          }
        }
      }
      odoContPrevLatRef.current = lat;
      odoContPrevLngRef.current = lng;
    }
  }, []);

  // ── GPS watch ─────────────────────────────────────────────────────────────
  // Some devices/OS versions silently pause `watchPositionAsync` after the
  // first fix (e.g. iOS throttling high-accuracy updates without background
  // location entitlements, or the screen dimming during a drive). A watchdog
  // below detects a stalled subscription and transparently resubscribes so
  // position/speed/turn-instructions keep advancing instead of freezing.
  //
  // IMPORTANT — subscription leak prevention:
  // `watchPositionAsync` is async and can take several seconds to resolve when
  // GPS hardware is initialising or the device is indoors. If the watchdog
  // fires while a previous `subscribe()` call is still awaiting the promise,
  // two concurrent subscriptions could both resolve and the earlier one would
  // overwrite `liveSub`, leaking the later subscription forever. Seven stalls
  // in a row = seven leaked subscriptions = OOM hard crash.
  //
  // Two guards prevent this:
  //   1. `isSubscribing` — skips the watchdog tick if a subscribe is already
  //      in flight (no new subscription started while one is pending).
  //   2. Generation counter (`gen`) — each subscribe captures its generation
  //      before the await; if a newer subscribe ran before this one resolved,
  //      the stale result is discarded with sub.remove() rather than stored.
  useEffect(() => {
    if (!locationGranted) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let liveSub: { remove: () => void } | null = null;
    let isSubscribing = false;
    let generation = 0;

    const teardown = () => {
      liveSub?.remove();
      liveSub = null;
    };

    const subscribe = async () => {
      if (cancelled || isSubscribing) return;
      isSubscribing = true;
      const myGen = ++generation;
      teardown();
      // Reset the freshness baseline on every (re)subscribe attempt so the
      // watchdog also catches a subscription that never delivers a fix.
      lastLocationAtRef.current = Date.now();
      try {
        if (Platform.OS !== "web") {
          // High accuracy (GPS satellites) at 5 s intervals. distanceInterval
          // must stay 0 so a stationary/slow-moving user still gets regular
          // fixes without triggering the watchdog / endless resubscribe loop.
          // High accuracy is required for reliable driving alerts: Balanced
          // mode uses cell-tower / Wi-Fi positioning (~100 m reported accuracy)
          // which exceeds the alertAccuracyOk threshold on many urban fixes and
          // silently blocks all zone/camera/report alerts. The extra battery
          // cost is acceptable for an active driving session.
          const gpsOptions = { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 0 };

          const sub = await Location.watchPositionAsync(
            gpsOptions,
            (loc) => {
              lastLocationAtRef.current = Date.now();
              // Pass the native GPS heading so the first fix already carries a
              // valid bearing for carriageway snapping.  Expo returns -1 when
              // heading is unavailable; handleLocation treats that as absent.
              const nativeHdg = typeof loc.coords.heading === "number" ? loc.coords.heading : null;
              try {
                handleLocation(loc.coords.latitude, loc.coords.longitude, loc.coords.speed, loc.coords.accuracy, nativeHdg);
              } catch (err) {
                // Any uncaught JS error in the 800-line handleLocation must NOT
                // propagate to the native GPS callback — React Native would kill
                // the subscription (and silently freeze navigation) if it did.
                console.warn("[GPS] uncaught error in handleLocation:", err);
              }
            }
          );
          // Guard 2: discard if a newer subscribe already completed.
          if (cancelled || myGen !== generation) { sub.remove(); return; }
          liveSub = sub;
        } else if ("geolocation" in navigator) {
          if (cancelled || myGen !== generation) return;
          const id = navigator.geolocation.watchPosition(
            (pos) => {
              lastLocationAtRef.current = Date.now();
              try {
                handleLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.speed, pos.coords.accuracy);
              } catch (err) {
                console.warn("[GPS/web] uncaught error in handleLocation:", err);
              }
            },
            (err) => console.warn("Geo:", err),
            { enableHighAccuracy: true }
          );
          liveSub = { remove: () => navigator.geolocation.clearWatch(id) };
        }
      } catch (e) {
        console.warn("Location watch failed to start:", e);
        if (!cancelled) {
          // Hard failure (e.g. permission revoked mid-session): don't retry
          // blindly forever. If permission is gone, flip locationGranted so
          // the UI degrades to its "location unavailable" state instead of
          // looping a failing native call every 4 s.
          if (Platform.OS !== "web") {
            try {
              const { status } = await Location.getForegroundPermissionsAsync();
              if (status !== "granted") {
                setLocationGranted(false);
                return;
              }
            } catch { /* permission check itself failed — fall through to retry */ }
          }
          retryTimer = setTimeout(subscribe, 4000);
        }
      } finally {
        isSubscribing = false;
      }
    };

    subscribe();

    const watchdog = setInterval(() => {
      if (cancelled || isSubscribing) return; // Guard 1: skip if already subscribing
      if (Date.now() - lastLocationAtRef.current > 8000) {
        console.warn("GPS watch stalled — resubscribing");
        navBreadcrumb("gps", "watchdog resubscribe", {
          stalledForMs: Date.now() - lastLocationAtRef.current,
        });
        subscribe();
      }
    }, 5000);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      clearInterval(watchdog);
      teardown();
    };
  }, [locationGranted, handleLocation]);

  // ── Foreground-return position injection ──────────────────────────────────
  // When the driver returns to the app (screen unlocks, app switches back),
  // the high-accuracy watchPositionAsync takes 1-5 s to deliver its first
  // fresh fix.  During that window the map and speed display show a stale
  // position — sometimes many hundreds of metres behind the vehicle.
  //
  // Fix: on every AppState → "active" transition, immediately read the last
  // background GPS fix that the drive-alert task persisted to AsyncStorage and
  // feed it through handleLocation.  This gives the app a correct position
  // within milliseconds of the screen unlock, before the foreground watch even
  // fires.  The watchdog's staleness timer is also reset so it doesn't
  // immediately resubscribe on top of this injected fix.
  //
  // We also call Location.getLastKnownPositionAsync() as a second source: it
  // returns the OS-cached position which may be more recent than the stored
  // background fix (e.g. the share task or odometer task updated it more
  // recently).  Both paths are safe — handleLocation is idempotent and
  // deduplicates fixes that don't represent meaningful movement.
  useEffect(() => {
    if (!locationGranted || Platform.OS === "web") return;

    const handleChange = async (state: AppStateStatus) => {
      if (state !== "active") return;
      try {
        // ── Path 1: Background drive-alert task's persisted last fix ──────
        const stored = await AsyncStorage.getItem(BG_LAST_FIX_KEY).catch(() => null);
        if (stored) {
          const fix: BgLastFix = JSON.parse(stored);
          // Only inject if the fix is within the last 60 s — older than that
          // and the driver may have been parked somewhere unrelated.
          if (Date.now() - fix.ts < 60_000) {
            handleLocation(fix.lat, fix.lng, fix.speedMs, fix.accuracyM, null);
            // Prevent the GPS watchdog from immediately resubscribing on top of
            // this injected fix (it would see 0 ms since last fix, which is fine,
            // but this also avoids a redundant resubscribe on slow-starting GPS).
            lastLocationAtRef.current = Date.now();
          }
          // Clear after consuming — avoid re-injecting the same stale fix on
          // the next foreground return without a new background update.
          AsyncStorage.removeItem(BG_LAST_FIX_KEY).catch(() => {});
        }

        // ── Path 2: OS-cached last known position ─────────────────────────
        // getLastKnownPositionAsync() is non-blocking and returns immediately
        // from the platform's location cache — no GPS hardware wakeup needed.
        // maxAge: 30 s ensures we only use a reasonably fresh cached fix.
        // requiredAccuracy: 200 m filters out old Wi-Fi / cell-tower estimates.
        try {
          const cached = await Location.getLastKnownPositionAsync({
            maxAge:           30_000,
            requiredAccuracy: 200,
          });
          if (cached) {
            handleLocation(
              cached.coords.latitude,
              cached.coords.longitude,
              cached.coords.speed ?? null,
              cached.coords.accuracy ?? null,
              null,
            );
            lastLocationAtRef.current = Date.now();
          }
        } catch { /* non-critical */ }
      } catch { /* ignore */ }
    };

    const sub = AppState.addEventListener("change", handleChange);
    return () => sub.remove();
  // handleLocation is a useCallback — including it means we re-register the
  // listener only when its deps change (rare), keeping the listener fresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationGranted, handleLocation]);

  // ── Route fetching ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!navDestination || !currentLat || !currentLng) return;
    let cancelled = false;
    setRouteLoading(true);
    setActiveRoute(null);
    setAltRoutes([]);
    routeRef.current = null;
    routeProjIdxRef.current = 0;
    routeMaxDistMRef.current = 0;

    fetchGoogleRoute(currentLat, currentLng, navDestination.lat, navDestination.lng, lastHeadingRef.current)
      .then((routes) => {
        if (cancelled || !routes.length) return;
        const [primary, ...alts] = routes;
        setActiveRoute(primary);
        routeRef.current = primary;
        setAltRoutes(alts);
      })
      .catch((e) => { if (!cancelled) console.warn("Routing:", e); })
      .finally(() => { if (!cancelled) setRouteLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navDestination?.lat, navDestination?.lng]);

  // Sync isOffline to a ref so callbacks can read it without re-rendering
  useEffect(() => { isOfflineRef.current = isOffline; }, [isOffline]);

  // Keep the poll-location ref fresh (used by the 60s polling effect)
  useEffect(() => {
    if (currentLat != null && currentLng != null) {
      pollLocationRef.current = { lat: currentLat, lng: currentLng };
    }
  }, [currentLat, currentLng]);

  // Remote report polling — poll when online.
  // No radius filter: show every incident on the map regardless of location.
  //
  // refreshReports is a stable callback ([] deps — all refs, no state) so it
  // can be called out-of-cycle from usePushNotifications when a silent
  // "reports_refresh" push arrives, making new reports appear within ~2 s.
  const refreshReports = useCallback(async () => {
    if (isOfflineRef.current || !deviceIdRef.current) return;
    try {
      // Pass the driver's current location so the server can apply a radius
      // filter.  Use 50 km — wide enough to cover Greater Nairobi and surrounding
      // routes, while still bounding the query for performance.
      //
      // WHY NOT 5 km: when a silent "reports_refresh" push wakes a device that
      // is 6–8 km from the new report, the subsequent poll with radius=5000
      // missed the report entirely — the push woke the device but the fetch
      // still excluded it.  50 km fixes this without fetching a global dump.
      // Falls back to no filter (all active reports) when GPS is unavailable.
      const lat = currentLatRef.current;
      const lng = currentLngRef.current;
      const url = (lat != null && lng != null)
        ? `/reports?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}&radius=50000`
        : `/reports`;
      const data = await apiGet<{ reports: Array<{
        id: string; type: string; lat: number; lng: number;
        status: string; confirmCount: number; denyCount: number;
        createdAt: number; expiresAt: number | null;
        speedLimit: number | null; roadName: string | null; adminVerified: boolean;
      }> }>(url);
      const remote: CommunityReport[] = data.reports.map((r) => ({
        id: r.id,
        type: r.type as CommunityReport["type"],
        lat: r.lat,
        lng: r.lng,
        timestamp: r.createdAt,
        confirmed: r.confirmCount,
        serverId: r.id,
        status: r.status as CommunityReport["status"],
        confirmCount: r.confirmCount,
        denyCount: r.denyCount,
        speedLimit: r.speedLimit ?? undefined,
        roadName: r.roadName ?? undefined,
        adminVerified: r.adminVerified,
        isOwn: false,
        observationContext: (r as any).observationContext as CommunityReport["observationContext"] ?? "on_location",
        observedAt: (r as any).observedAt ?? undefined,
        ...(r.type === "camera" && (r as any).cameraType
          ? { cameraType: (r as any).cameraType as "fixed" | "mobile" }
          : {}),
      }));
      

      // Clean up locallyDeniedServerIdsRef: once the server no longer
      // returns a report (it has recorded the denial), we don't need to
      // block it any more. Keep only IDs that are still in the response.
      const remoteIdSet = new Set(remote.map((r) => r.id));
      for (const sid of locallyDeniedServerIdsRef.current) {
        if (remoteIdSet.has(sid)) {
          // Server still returns it — keep blocking.
        } else {
          locallyDeniedServerIdsRef.current.delete(sid);
        }
      }

      // Non-disruptive functional update: setCommunityReports only touches the
      // communityReports state slice. It never reads or writes alertZoneRef,
      // activeAlert, routeRef, or any other shared ref — active drives and
      // in-flight voice cues are completely unaffected.
      setCommunityReports((prev) => {
        const owned = prev.filter((r) => r.isOwn);
        // Exclude any remote report whose server ID was locally denied but
        // the server hasn't yet reflected the denial — prevents the poll
        // from re-inserting a report the driver just voted "Gone Now" on.
        const filteredRemote = remote.filter(
          (rem) => !locallyDeniedServerIdsRef.current.has(rem.id)
        );
        const remoteNew = filteredRemote.filter((rem) => !owned.some((o) => o.serverId === rem.id));
        const ownedUpdated = owned.map((o) => {
          const match = filteredRemote.find((r) => r.id === o.serverId);
          return match
            ? { ...o, status: match.status, confirmCount: match.confirmCount, denyCount: match.denyCount, adminVerified: match.adminVerified }
            : o;
        });
        return [...ownedUpdated, ...remoteNew].filter(
          (r) => r.status !== "expired" && r.status !== "denied"
        );
      });
      setLastAlertDataSyncedAt(new Date());
    } catch { /* network error — keep local copy */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!locationGranted) return;
    refreshReports(); // immediate poll on mount
    const handle = setInterval(refreshReports, 60_000);
    return () => clearInterval(handle);
  }, [locationGranted, refreshReports]);

  // HERE Live Traffic incidents — poll every 5 minutes; server-side job refreshes
  // the HERE API on the same cadence, so the mobile always gets a fresh snapshot.
  useEffect(() => {
    if (!locationGranted) return;
    const poll = async () => {
      if (isOfflineRef.current) return;
      try {
        const data = await apiGet<{ incidents: HereIncident[] }>(`/traffic/incidents`);
        setHereIncidents(
          (data.incidents ?? []).filter(
            (inc) => !dismissedHereIdsRef.current.has(inc.id)
          )
        );
      } catch { /* network error — keep previous HERE incidents */ }
    };
    poll();
    const handle = setInterval(poll, 5 * 60 * 1000);
    return () => clearInterval(handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationGranted]);

  const dismissHereIncident = useCallback((id: string) => {
    dismissedHereIdsRef.current.add(id);
    setHereIncidents((prev) => prev.filter((inc) => inc.id !== id));
  }, []);
  // Keep hereIncidentsRef in sync so the GPS handler can read it without stale closures.
  useEffect(() => { hereIncidentsRef.current = hereIncidents; }, [hereIncidents]);

  // Admin-managed speed zones — fetch ALL DB zones every 5 min when online,
  // merged with the built-in static list (see allZones below).
  // No radius filter: show every camera and zone on the map regardless of location.
  useEffect(() => {
    if (!locationGranted) return;
    const poll = async () => {
      if (isOfflineRef.current) return;
      try {
        const data = await apiGet<{ zones: ApiSpeedZone[]; suppressedStaticIds?: string[] }>(`/speed-zones`);

        // ── Stale-while-revalidate merge ─────────────────────────────────────
        // Problem: a single slow/partial API response previously wiped the entire
        // zone list for up to 5 minutes, causing cameras to vanish mid-drive.
        // Fix: keep any zone that was present in a recent poll (within 10 min).
        // Zones absent for 10+ consecutive minutes are assumed truly removed.
        const nowPoll = Date.now();
        const STALE_ZONE_TTL_MS = 10 * 60 * 1000; // 10 minutes

        // Update the cache with every zone returned by this poll.
        for (const z of data.zones) {
          prevApiZonesMapRef.current.set(z.id, z);
          dbZoneLastSeenRef.current.set(z.id, nowPoll);
        }

        // Evict zones not seen in the last 10 minutes.
        for (const [id, seenAt] of dbZoneLastSeenRef.current) {
          if (nowPoll - seenAt > STALE_ZONE_TTL_MS) {
            dbZoneLastSeenRef.current.delete(id);
            prevApiZonesMapRef.current.delete(id);
          }
        }

        const mergedZones = [...prevApiZonesMapRef.current.values()];
        setDbZones(mergedZones.flatMap(apiZoneToStaticZones));
        setDbStretches(mergedZones.map(apiZoneToStretch).filter((s): s is SpeedStretch => s !== null));
        setSuppressedStaticIds(data.suppressedStaticIds ?? []);
        setLastAlertDataSyncedAt(new Date());
      } catch { /* network error — keep previous DB zones */ }
    };
    poll(); // immediate on mount
    const handle = setInterval(poll, 300000);
    return () => clearInterval(handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationGranted]);

  // Merged static + admin-managed zones, kept in a ref so non-reactive
  // callbacks (e.g. handleLocation) always read the latest list.
  const allZones = useMemo<SpeedZone[]>(() => {
    // Remove static zones that have been overridden or suppressed by a DB record.
    const filtered = SPEED_ZONES.filter((z) => !suppressedStaticIds.includes(z.id));
    // Always spread dbZones — even when empty, spreading [] is a no-op.
    // The old `dbZones.length ?` guard caused promoted zones to disappear when
    // suppressedStaticIds had entries but dbZones was transiently empty (e.g.
    // a network error during the poll): the static zone was suppressed but no
    // DB replacement appeared, so the zone vanished from allZones entirely.
    return [...filtered, ...dbZones];
  }, [dbZones, suppressedStaticIds]);
  useEffect(() => { allZonesRef.current = allZones; }, [allZones]);
  useEffect(() => { dbZonesRef.current = dbZones; }, [dbZones]);
  useEffect(() => { suppressedStaticIdsRef.current = suppressedStaticIds; }, [suppressedStaticIds]);
  useEffect(() => { dbStretchesRef.current = dbStretches; }, [dbStretches]);

  // ── Zone override persistence ─────────────────────────────────────────────
  // Cache suppressedStaticIds + dbZones to AsyncStorage so that on the next
  // app start allZonesRef is immediately populated with the correct coordinates
  // — before the first API poll returns (which can take several seconds).
  // Without this, the GPS handler runs against stale static coords during that
  // startup window, which is the root cause of false alerts after a pin move.
  const ZONE_CACHE_KEY = "sdk_zone_overrides_v2";
  useEffect(() => {
    AsyncStorage.getItem(ZONE_CACHE_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as { d?: SpeedZone[]; s?: string[] };
        const cachedDb = Array.isArray(parsed.d) ? parsed.d : [];
        const cachedSup = Array.isArray(parsed.s) ? parsed.s : [];
        if (!cachedDb.length && !cachedSup.length) return;
        setDbZones(cachedDb);
        setSuppressedStaticIds(cachedSup);
        // Update allZonesRef synchronously — the useEffect above fires only
        // after the next render, but the GPS handler may tick before that.
        allZonesRef.current = [
          ...SPEED_ZONES.filter((z) => !cachedSup.includes(z.id)),
          ...cachedDb,
        ];
      } catch { /* malformed cache — fall back to static data */ }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dbZones.length && !suppressedStaticIds.length) return;
    void AsyncStorage.setItem(ZONE_CACHE_KEY, JSON.stringify({ d: dbZones, s: suppressedStaticIds }));
  }, [dbZones, suppressedStaticIds]);

  // ── Route incidents (unified static zones + community reports along the route) ─
  const routeCumDist = useMemo(
    () => (activeRoute ? buildCumulativeDistances(activeRoute.coords) : null),
    [activeRoute]
  );

  // ── Phase 1: project static speed-zone cameras onto the active route ────────
  // This is the expensive O(zones × routeLen) computation — up to 111 cameras ×
  // 600+ polyline points = ~66,000 haversine calls.  Splitting it into its own
  // memo means it ONLY reruns when the route geometry or zone list changes, NOT
  // every time community reports refresh (every 20 s during navigation).
  const projectedZonesOnRoute = useMemo<
    Array<{ zone: SpeedZone; alongRouteM: number; offRouteM: number }>
  >(() => {
    if (!activeRoute || !routeCumDist) return [];
    const result: Array<{ zone: SpeedZone; alongRouteM: number; offRouteM: number }> = [];
    for (const z of allZones) {
      const proj = projectOntoRoute(activeRoute.coords, routeCumDist, z.lat, z.lng);
      if (proj && proj.offRouteM < ROUTE_CORRIDOR_M) {
        result.push({ zone: z, alongRouteM: proj.alongRouteM, offRouteM: proj.offRouteM });
      }
    }
    return result;
  }, [activeRoute, routeCumDist, allZones]);

  // ── Phase 2: combine pre-projected zones with live community + HERE reports ─
  // vehicleType only affects speed-limit display (capSpeedLimit), not route
  // membership — so changing it only reruns this cheaper memo, not Phase 1.
  const routeIncidents = useMemo<RouteIncident[]>(() => {
    if (!activeRoute || !routeCumDist) return [];
    const vehicle = getVehicleTypeDef(vehicleType);
    const list: RouteIncident[] = [];

    // Static zones — projections pre-computed in Phase 1 above (no O(N) scan here)
    for (const { zone: z, alongRouteM, offRouteM } of projectedZonesOnRoute) {
      list.push({
        id: `static-${z.id}`,
        source: "static",
        type: z.type,
        label: staticZoneLabel(z.type),
        name: z.name,
        road: z.road,
        description: z.description,
        speedLimit: capSpeedLimit(z.speedLimit, vehicle),
        lat: z.lat,
        lng: z.lng,
        distanceAlongRouteM: alongRouteM,
        offRouteM,
      });
    }

    // Community reports — still O(reports × routeLen) but typically ≤50 reports
    for (const r of communityReports) {
      if (r.status === "expired" || r.status === "denied" || r.type === "clear") continue;
      const proj = projectOntoRoute(activeRoute.coords, routeCumDist, r.lat, r.lng);
      if (proj && proj.offRouteM < ROUTE_CORRIDOR_M) {
        const info = resolveIncidentType(r.type);
        list.push({
          id: `report-${r.id}`,
          source: "report",
          type: r.type,
          label: info.label,
          name: info.label,
          road: r.roadName,
          speedLimit: r.speedLimit != null ? capSpeedLimit(r.speedLimit, vehicle) : r.speedLimit,
          lat: r.lat,
          lng: r.lng,
          distanceAlongRouteM: proj.alongRouteM,
          offRouteM: proj.offRouteM,
          confirmCount: r.confirmCount,
          timestamp: r.timestamp,
        });
      }
    }

    // HERE Live Traffic incidents on this route
    const nowMs = Date.now();
    for (const h of hereIncidents) {
      if (h.endTime != null && h.endTime < nowMs) continue;
      const proj = projectOntoRoute(activeRoute.coords, routeCumDist, h.lat, h.lng);
      if (proj && proj.offRouteM < ROUTE_CORRIDOR_M) {
        const info = resolveIncidentType(h.type);
        list.push({
          id: h.id,
          source: "report",  // render with emoji (same as community reports)
          type: h.type,
          label: info.label,
          name: info.label,
          road: h.roadName,
          description: h.description,
          lat: h.lat,
          lng: h.lng,
          distanceAlongRouteM: proj.alongRouteM,
          offRouteM: proj.offRouteM,
        });
      }
    }
    return list.sort((a, b) => a.distanceAlongRouteM - b.distanceAlongRouteM);
  }, [projectedZonesOnRoute, activeRoute, routeCumDist, communityReports, vehicleType, hereIncidents]);

  const currentRouteDistanceM = useMemo(() => {
    if (!activeRoute || !routeCumDist || currentLat == null || currentLng == null) return null;
    // This recomputes on every single GPS fix (up to 1/s) while navigating,
    // so scanning the *entire* route polyline every time — potentially
    // thousands of haversine calls/sec on long routes — was a real source of
    // main-thread jank that delayed everything downstream, including how
    // promptly turn instructions actually got spoken relative to real
    // position. Since the driver only ever moves forward a short distance
    // between fixes, search a window around the last matched point instead
    // of the whole array, falling back to a full scan only when we don't
    // have a prior match yet (route just started/changed).
    const coords = activeRoute.coords;
    const hasPrior = routeProjIdxRef.current > 0 && routeProjIdxRef.current < coords.length;
    const WINDOW = 40;
    const proj = hasPrior
      ? projectOntoRoute(
          coords, routeCumDist, currentLat, currentLng,
          routeProjIdxRef.current - 5, routeProjIdxRef.current + WINDOW
        )
      : projectOntoRoute(coords, routeCumDist, currentLat, currentLng);
    if (proj) {
      routeProjIdxRef.current = proj.matchedIdx;
      // Advance the high-water mark — never go backward.
      if (proj.alongRouteM > routeMaxDistMRef.current) {
        routeMaxDistMRef.current = proj.alongRouteM;
      }
    }
    return proj ? proj.alongRouteM : null;
  }, [activeRoute, routeCumDist, currentLat, currentLng]);

  const routeIncidentsAhead = useMemo(() => {
    // Use the high-water mark so GPS jitter that temporarily snaps the
    // projection backward never makes already-passed incidents reappear as
    // "ahead" with growing distances.
    const effectiveDist = Math.max(currentRouteDistanceM ?? 0, routeMaxDistMRef.current);
    const withAhead = (list: RouteIncident[]) =>
      list.map((inc) => ({
        ...inc,
        aheadDistanceM: Math.max(0, inc.distanceAlongRouteM - effectiveDist),
      }));
    if (currentRouteDistanceM == null) return withAhead(routeIncidents);
    // Only keep incidents that are still ahead of the driver. A 15 m rearward
    // tolerance absorbs GPS jitter at the exact crossing point without keeping
    // an already-passed camera visible in the "ahead" list for tens of seconds.
    return withAhead(
      routeIncidents.filter((inc) => inc.distanceAlongRouteM >= effectiveDist - 15)
    );
  }, [routeIncidents, currentRouteDistanceM]);

  // Keep routeIncidentsRef in sync so the GPS handler (a stable useEffect
  // closure) can look up along-route positions without closure staleness.
  useEffect(() => { routeIncidentsRef.current = routeIncidents; }, [routeIncidents]);

  // ── Snap to active route ─────────────────────────────────────────────────
  // When the driver is navigating, snapping a newly-reported incident to the
  // nearest point on the route polyline guarantees it lands on the EXACT road
  // they're using — not a parallel road, opposite lane, or service road that
  // Google Roads might pick.  Returns null when no route is active so callers
  // can fall back to snapToRoad() (Google Roads API) or raw GPS.
  const snapToActiveRoute = useCallback(
    (lat: number, lng: number): { lat: number; lng: number } | null => {
      if (!activeRoute || !routeCumDist) return null;
      const proj = projectOntoRoute(activeRoute.coords, routeCumDist, lat, lng);
      if (!proj) return null;
      const coords = activeRoute.coords;
      if (proj.matchedIdx < 0 || proj.matchedIdx >= coords.length) return null;
      const c = coords[proj.matchedIdx];
      if (!c) return null;
      return { lat: c.latitude, lng: c.longitude };
    },
    [activeRoute, routeCumDist],
  );

  const routeTrafficDelayS = useMemo(
    () => estimateTrafficDelayS(routeIncidentsAhead),
    [routeIncidentsAhead]
  );

  // On-demand road check for an arbitrary destination (Saved Places / Planned
  // Trips) — mirrors the routeIncidents logic above but works off a
  // freshly-fetched route rather than the driver's active navigation route.
  const checkRouteStatus = useCallback(async (destLat: number, destLng: number): Promise<RouteCheckResult | null> => {
    const lat = currentLatRef.current;
    const lng = currentLngRef.current;
    if (lat == null || lng == null) return null;
    const routes = await fetchGoogleRoute(lat, lng, destLat, destLng, lastHeadingRef.current);
    if (!routes.length) return null;
    const route = routes[0];
    const cumDist = buildCumulativeDistances(route.coords);
    const vehicle = getVehicleTypeDef(vehicleTypeRef.current);
    const list: RouteIncident[] = [];
    for (const z of allZonesRef.current) {
      const proj = projectOntoRoute(route.coords, cumDist, z.lat, z.lng);
      if (proj && proj.offRouteM < ROUTE_CORRIDOR_M) {
        list.push({
          id: `static-${z.id}`,
          source: "static",
          type: z.type,
          label: staticZoneLabel(z.type),
          name: z.name,
          road: z.road,
          description: z.description,
          speedLimit: capSpeedLimit(z.speedLimit, vehicle),
          lat: z.lat,
          lng: z.lng,
          distanceAlongRouteM: proj.alongRouteM,
        });
      }
    }
    for (const r of communityReportsRef.current) {
      if (r.status === "expired" || r.status === "denied" || r.type === "clear") continue;
      const proj = projectOntoRoute(route.coords, cumDist, r.lat, r.lng);
      if (proj && proj.offRouteM < ROUTE_CORRIDOR_M) {
        const info = resolveIncidentType(r.type);
        list.push({
          id: `report-${r.id}`,
          source: "report",
          type: r.type,
          label: info.label,
          name: info.label,
          road: r.roadName,
          speedLimit: r.speedLimit != null ? capSpeedLimit(r.speedLimit, vehicle) : r.speedLimit,
          lat: r.lat,
          lng: r.lng,
          distanceAlongRouteM: proj.alongRouteM,
          confirmCount: r.confirmCount,
          timestamp: r.timestamp,
          reportStatus: r.status,
        });
      }
    }
    list.sort((a, b) => a.distanceAlongRouteM - b.distanceAlongRouteM);
    return {
      distanceM: route.distanceM,
      durationS: route.durationS,
      trafficDelayS: estimateTrafficDelayS(list),
      incidents: list,
    };
  }, []);

  // Live "distance/time remaining to destination" — recomputed every time
  // currentRouteDistanceM updates (i.e. every GPS fix), unlike the route's
  // static total distanceM/durationS which never change once fetched.
  const distanceRemainingM = useMemo(() => {
    if (!activeRoute || !Number.isFinite(activeRoute.distanceM)) return null;
    if (currentRouteDistanceM == null || !Number.isFinite(currentRouteDistanceM)) return activeRoute.distanceM;
    return Math.max(0, activeRoute.distanceM - currentRouteDistanceM);
  }, [activeRoute, currentRouteDistanceM]);

  const durationRemainingS = useMemo(() => {
    if (!activeRoute || distanceRemainingM == null) return null;
    // Google's durationS is already traffic-aware — scale by remaining distance
    // fraction only. Community report delay (routeTrafficDelayS) is shown as a
    // separate supplemental indicator, not baked into the ETA.
    if (!Number.isFinite(activeRoute.durationS)) return null;
    if (!Number.isFinite(activeRoute.distanceM) || activeRoute.distanceM <= 0) return activeRoute.durationS;
    const scaled = Math.round((distanceRemainingM / activeRoute.distanceM) * activeRoute.durationS);
    return Number.isFinite(scaled) ? scaled : activeRoute.durationS;
  }, [activeRoute, distanceRemainingM]);
  // Keep refs in sync so the share-trip ping interval always reads fresh values
  useEffect(() => { durationRemainingRef.current = durationRemainingS; }, [durationRemainingS]);
  useEffect(() => { distanceRemainingRef.current = distanceRemainingM; }, [distanceRemainingM]);

  // ── Navigation actions ────────────────────────────────────────────────────
  const setNavDestination = useCallback((d: NavDestination | null) => {
    setNavDestState(d);
    navDestRef.current = d;
    if (!d) {
      setActiveRoute(null);
      setAltRoutes([]);
      routeRef.current = null;
      setRouteIncidentsExpanded(false);
    }
  }, []);

  const selectRoute = useCallback((r: AppRoute) => {
    try {
      setAltRoutes((prev) => {
        const others = (activeRoute ? [activeRoute, ...prev] : prev).filter((x) => x.id !== r.id);
        return others;
      });
      setActiveRoute(r);
      routeRef.current = r;
      routeProjIdxRef.current = 0;
      routeMaxDistMRef.current = 0;
    } catch (e) {
      console.warn("[selectRoute] error:", e);
    }
  }, [activeRoute]);

  // ── Trip sharing ─────────────────────────────────────────────────────────────

  const stopSharingTrip = useCallback(async () => {
    if (sharePingIntervalRef.current) {
      clearInterval(sharePingIntervalRef.current);
      sharePingIntervalRef.current = null;
    }
    // Also stop any active background location task
    stopBackgroundShareTask().catch(() => {});
    const token = shareTokenRef.current;
    shareTokenRef.current = null;
    setShareToken(null);
    setShareCode(null);
    void AsyncStorage.removeItem(KEYS.SHARE);
    if (token && deviceIdRef.current) {
      try { await apiDelete(`/share/${token}`, { deviceId: deviceIdRef.current }); } catch { /* ignore */ }
    }
  }, []);

  const startSharingTrip = useCallback(async (): Promise<string | null> => {
    if (!deviceIdRef.current) return null;
    try {
      const data = await apiPost<{ token: string; shortCode: string | null; expiresAt: string }>("/share/session", {
        deviceId:        deviceIdRef.current,
        driverName:      driverNameRef.current.trim() || null,
        destinationName: navDestRef.current?.name ?? null,
        destinationLat:  navDestRef.current?.lat  ?? null,
        destinationLng:  navDestRef.current?.lng  ?? null,
        lat:             currentLatRef.current,
        lng:             currentLngRef.current,
      });
      shareTokenRef.current = data.token;
      setShareToken(data.token);
      setShareCode(data.shortCode ?? null);
      // Persist so the session survives the app being backgrounded or restarted
      const _sessionCode = data.shortCode ?? data.token;
      void AsyncStorage.setItem(KEYS.SHARE, JSON.stringify({
        token:     data.token,
        shortCode: _sessionCode,
        expiresAt: data.expiresAt,
      }));
      // Start ping interval — reads fresh GPS values via refs so the closure
      // never goes stale even as the driver moves for the next 8 hours.
      // Nav metrics (durationRemainingS, distanceRemainingM) are only included
      // when navigation is active; omitting them keeps the recipient view clean
      // for freeform "track me" sessions that have no destination set.
      if (sharePingIntervalRef.current) clearInterval(sharePingIntervalRef.current);
      sharePingIntervalRef.current = setInterval(async () => {
        const tk  = shareTokenRef.current;
        const did = deviceIdRef.current;
        const lat = currentLatRef.current;
        const lng = currentLngRef.current;
        if (!tk || !did || lat == null || lng == null) return;
        try {
          const pingBody: Record<string, unknown> = { deviceId: did, lat, lng, speedKmh: currentSpeedRef.current };
          if (durationRemainingRef.current != null) pingBody.durationRemainingS = durationRemainingRef.current;
          if (distanceRemainingRef.current != null) pingBody.distanceRemainingM = distanceRemainingRef.current;
          // Include Live Activity state so the server can push ContentState
          // updates directly via APNs when the app is fully suspended.
          if (currentSpeedLimitRef.current != null) pingBody.speedLimitKmh = currentSpeedLimitRef.current;
          if (typeof navDestRef.current?.name === "string") pingBody.destinationName = navDestRef.current.name.split(",")[0];
          pingBody.isSharingTrip = true;
          await apiPatch(`/share/${tk}/ping`, pingBody);
        } catch { /* ignore ping failures — next interval will retry */ }
      }, 8000);
      const code = data.shortCode ?? data.token;
      // Eagerly request background location permission while the driver is
      // looking at the app — so the OS dialog appears in-context ("you're
      // starting to share your trip") rather than unexpectedly later.
      // This is best-effort: if the driver denies or dismisses, the
      // foreground interval still works; the background task just won't start
      // when they switch away (the AppState watcher re-checks the permission
      // at that point and skips the task gracefully).
      //
      // Show a plain-language explanation before the system dialog when the
      // background location permission hasn't been decided yet — matching the
      // same pre-permission Alert pattern used for foreground location and
      // notifications.
      try {
        const bgPerm = await Location.getBackgroundPermissionsAsync();
        if (bgPerm.status === "undetermined") {
          await new Promise<void>((resolve) =>
            Alert.alert(
              "Background Location for Live Sharing",
              "To keep sharing your location when the screen is off or you switch apps, Msafiri needs \"Always\" location access.\n\nYour location is only shared with people who have your link — never stored on our servers beyond the active session.",
              [{ text: "Continue", onPress: () => resolve() }],
              { cancelable: false },
            )
          );
        }
      } catch { /* non-blocking — proceed regardless */ }
      requestBackgroundLocationPermission().catch(() => {});
      return `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}/live/${code}`;
    } catch (e) {
      console.warn("startSharingTrip failed:", e);
      return null;
    }
  }, []);

  // ── Background share: keep pings alive when the app is backgrounded ────────
  // When a live-share session is active and the driver backgrounds the app
  // (switches away, locks the screen), the setInterval in startSharingTrip
  // stops firing. We hand off to a TaskManager background location task that
  // pings the API on every location update instead.
  //
  // On return to foreground we stop the background task — the existing
  // setInterval is still registered and resumes immediately once JS ticks.
  useEffect(() => {
    if (Platform.OS === "web") return;

    const handleAppStateChange = async (nextState: AppStateStatus) => {
      try {
        const isSharing = shareTokenRef.current != null;
        if (!isSharing) return;

        if (nextState === "background" || nextState === "inactive") {
          // App leaving foreground — hand off location pings to the bg task.
          // First ensure we have "always" / background location permission;
          // if the driver hasn't granted it yet, silently request it now
          // (the OS shows the prompt; if denied we skip the bg task and the
          // foreground interval resumes the moment they return to the app).
          await requestBackgroundLocationPermission();
          void startBackgroundShareTask().catch(() => {});
        } else if (nextState === "active") {
          // App returned to foreground — foreground interval resumes, so the
          // background task is no longer needed.
          void stopBackgroundShareTask().catch(() => {});
        }
      } catch (e) {
        console.warn("[AppState] handleAppStateChange error:", e);
      }
    };

    const sub = AppState.addEventListener("change", handleAppStateChange);
    return () => sub.remove();
  // shareTokenRef is a ref — stable; no deps needed beyond mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Background odometer lifecycle ─────────────────────────────────────────
  // Keeps driving distance accumulating while the app is backgrounded or the
  // screen is locked, for BOTH active trips and the continuous odometer. While
  // the background task is live it is the SOLE owner of distance: foreground
  // accumulation is gated off via bgOdoActiveRef (in case the OS keeps the
  // foreground watch alive), and the task itself never writes to vehicle-care
  // storage. On foreground resume the pending metres are routed to exactly one
  // destination — the active trip's distance (so the single trip-end credit
  // includes the background segment) or the continuous-odometer pending pot —
  // and the position pointers jump to the last background fix so the same
  // stretch is never re-measured.
  //
  // Transitions are serialized through a desired-state reconciler: AppState
  // changes only flip bgOdoDesiredRef and enqueue a reconcile op on a promise
  // chain that runs strictly one op at a time. Each op reads the CURRENT
  // desired state when it executes, so rapid active → inactive → background
  // flaps collapse to the correct final state, a late-resolving start can
  // never be killed by a stale stop, and the shared task/AsyncStorage state
  // is never mutated by two transitions concurrently. `inactive → background`
  // is a no-op (desired state unchanged), so the task is neither restarted
  // nor reseeded mid-stint.
  useEffect(() => {
    if (Platform.OS === "web") return;

    // Durably credit recovered kilometres to the active vehicle's care
    // odometer — same path as the foreground flush. Used for the no-trip
    // route so recovered distance survives an immediate app kill instead of
    // waiting in memory for a future GPS fix to flush it.
    const creditOdometerKm = (km: number) => {
      loadVehicles().then(async vs => {
        const active = vs.find(v => v.id === activeVehicleIdRef.current) ?? vs.find(v => v.isDefault) ?? vs[0];
        if (!active) return;
        const careKey = getCareStorageKey(active.id, active.isDefault);
        await updateTripOdometer(km, careKey);
        const data = await loadVehicleCareData(careKey);
        const est = estimatedOdometerKm(data);
        if (est > 0) setOdoBaseKm(est);
      }).catch(() => {});
    };

    const consumeIntoForeground = ({ pendingM, lastFix }: { pendingM: number; lastFix: { lat: number; lng: number } | null }) => {
      if (pendingM > 0) {
        const trip = tripRef.current;
        if (trip) {
          // Active trip — fold the background segment into the trip so the
          // trip-end odometer credit counts it exactly once. Also append the
          // last background fix as a position so the next foreground fix
          // measures from there rather than the pre-background point.
          trip.distance = (trip.distance ?? 0) + pendingM;
          if (lastFix) {
            trip.positions = [
              ...(trip.positions ?? []),
              { lat: lastFix.lat, lng: lastFix.lng, speed: 0, time: Date.now() },
            ];
          }
          setCurrentTrip({ ...trip });
        } else {
          // No trip — credit the vehicle-care odometer immediately (durable)
          // rather than parking metres in the in-memory pending pot, which
          // would be lost if the app is killed before the next GPS fix.
          creditOdometerKm(pendingM / 1000);
          odoContFlushAtRef.current = Date.now();
        }
      }
      if (lastFix) {
        odoContPrevLatRef.current = lastFix.lat;
        odoContPrevLngRef.current = lastFix.lng;
      }
    };

    // Run one reconcile op at a time on the shared chain. Errors are swallowed
    // per-op so a failed transition never wedges the chain.
    const enqueueReconcile = () => {
      bgOdoChainRef.current = bgOdoChainRef.current.then(async () => {
        // Read desired state at EXECUTION time, not enqueue time — collapses
        // rapid flaps to the final state and makes intermediate ops no-ops.
        const desired = bgOdoDesiredRef.current;
        if (desired === bgOdoActiveRef.current) return; // already reconciled
        if (desired) {
          // Seed with the foreground odometer's last position so the gap
          // between the last foreground fix and the first background fix
          // still counts. Requires background permission — the start
          // silently no-ops (returns false) when it hasn't been granted,
          // in which case the foreground accumulators stay un-gated.
          const seedLat = odoContPrevLatRef.current;
          const seedLng = odoContPrevLngRef.current;
          const started = await startBackgroundOdometerTask(
            seedLat != null && seedLng != null ? { lat: seedLat, lng: seedLng } : null,
          );
          bgOdoActiveRef.current = started;
          // If desired flipped while starting, the AppState handler already
          // enqueued a follow-up op behind this one; it will stop + consume.
        } else {
          await stopBackgroundOdometerTask();
          const result = await consumeBackgroundOdometer();
          consumeIntoForeground(result);
          // Re-enable foreground accumulation only after the handoff, so
          // fixes arriving mid-consume can't overlap the background pot.
          bgOdoActiveRef.current = false;
        }
      }).catch((e) => {
        console.warn("[bgOdometer] reconcile failed:", e);
        // Conservative fallback: never leave foreground accumulation gated
        // off when the task state is unknown and the app wants foreground.
        if (!bgOdoDesiredRef.current) bgOdoActiveRef.current = false;
      });
    };

    const handleOdoAppState = (nextState: AppStateStatus) => {
      const wantBackground = nextState === "background" || nextState === "inactive";
      if (wantBackground === bgOdoDesiredRef.current) return; // e.g. inactive → background
      bgOdoDesiredRef.current = wantBackground;
      enqueueReconcile();
    };

    const sub = AppState.addEventListener("change", handleOdoAppState);
    // Defensive: if a previous session was killed mid-background, consume any
    // leftover pending metres on launch so that distance isn't lost. Runs on
    // the same chain, ahead of any AppState-driven op. There is no live trip
    // at this point, so it credits the continuous odometer.
    bgOdoChainRef.current = bgOdoChainRef.current.then(async () => {
      await stopBackgroundOdometerTask();
      const { pendingM, lastFix } = await consumeBackgroundOdometer();
      if (pendingM > 0) creditOdometerKm(pendingM / 1000);
      if (lastFix && odoContPrevLatRef.current == null) {
        odoContPrevLatRef.current = lastFix.lat;
        odoContPrevLngRef.current = lastFix.lng;
      }
    }).catch(() => {});
    return () => sub.remove();
  // refs only — stable; no deps needed beyond mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Stale report cache sweep on foreground ────────────────────────────────
  // On every return to foreground, evict denied/expired entries that are past
  // the pruning age thresholds.  This bounds AsyncStorage size and keeps the
  // in-memory communityReports array lean on long-running sessions.  It also
  // runs at startup (see the startup load above), so together the two hooks
  // guarantee the cache never grows unboundedly.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState !== "active") return;
      setCommunityReports((prev) => {
        const pruned = pruneReportCache(prev, Date.now());
        if (pruned.length === prev.length) return prev; // nothing evicted — skip re-render + write
        AsyncStorage.setItem(KEYS.REPORTS, JSON.stringify(pruned)).catch(() => {});
        return pruned;
      });
    };
    const sub = AppState.addEventListener("change", handleAppStateChange);
    return () => sub.remove();
  }, []);

  // ── Other actions ─────────────────────────────────────────────────────────
  const dismissAlert = useCallback(() => {
    // Capture before clearing so we can record the cooldown distance correctly.
    const dismissedId  = alertZoneRef.current;
    const lastDist     = lastSetAlertRef.current?.distM ?? 0;

    alertDismissed.current = true;
    lastSetAlertRef.current = null;
    lastExtrasKeyRef.current = "";

    // ── Single-alert dismiss cooldown ─────────────────────────────────────
    // The auto-dismiss path (driver passes a zone) already writes a 60 s entry
    // into alertDismissCooldownRef, but it only fires when alertDismissed is
    // false.  For a MANUAL dismiss alertDismissed is set to true first, so that
    // path never runs — meaning a driver who leaves and circles back within the
    // window gets no cooldown protection at all.
    //
    // Fix: write the cooldown here for single-alert dismissals (clusters are
    // handled via the geo-anchor TTL below, so skip when an anchor is set).
    //   • Stationary driver (stationaryStreakRef ≥ 3): 5 min — prevents
    //     repeated re-fires while parked near a zone.
    //   • Moving driver: 60 s — matches the existing auto-dismiss behaviour.
    //
    // The existing early-cancel rule (winner.distance ≤ peakDistM − 300 m)
    // already handles "driving away resets the cooldown" for both windows.
    if (dismissedId && alertAnchorLatRef.current == null) {
      const isStationary = stationaryStreakRef.current >= 3;
      alertDismissCooldownRef.current.set(dismissedId, {
        expiry:    Date.now() + (isStationary ? 5 * 60_000 : 60_000),
        peakDistM: lastDist,
      });
    }

    // ── Cluster dismiss: lock geo-anchor for 10 min ───────────────────────
    // A parked driver who taps "Got it — dismiss all" near a hazard cluster
    // won't be re-announced every time they edge past the 250 m threshold.
    // The anchor is released instantly when the driver drives > 1 km away.
    if (alertAnchorLatRef.current != null) {
      alertAnchorExpiryRef.current = Date.now() + 10 * 60 * 1000;
    }
    alertDistReversalCountRef.current = 0;
    setActiveAlert(null);
    setActiveAlertExtras([]);
  }, []);
  const setProfilePhotoUri = useCallback((uri: string | null) => {
    setProfilePhotoUriState(uri);
    if (uri) {
      // Persist only the filename — the documentDirectory prefix is
      // reconstructed at load time (see startup load above).  This makes the
      // persisted value immune to iOS container-path changes across app updates.
      const filename = uri.includes("/") ? (uri.split("/").pop() ?? uri) : uri;
      AsyncStorage.setItem("profile_photo_uri", filename).catch(() => {});
    } else {
      AsyncStorage.removeItem("profile_photo_uri").catch(() => {});
    }
  }, []);

  // ── Background drive-alert persistence ────────────────────────────────────
  // The background location task cannot access React state. It reads a set of
  // AsyncStorage keys instead:
  //   • bgDriveActive  — gates all background notifications to active trips only
  //   • bgSessionId    — scopes the per-session dedup map; reset on each new trip
  //   • bgZonesCache   — compact speed-zone list evaluated against GPS fixes
  //   • bgReportsCache — compact community-report list evaluated against GPS fixes
  //
  // On each 50 m GPS wakeup the task evaluates these caches against the fresh
  // coordinates, finds the closest alertable zone, and fires a notification if
  // it hasn't been notified for that zone within the last 5 minutes.

  /** Wrapped setter: writes the drive-active flag and a fresh session ID so
   *  the background task's per-session dedup map is always scoped to the
   *  current trip and never suppresses alerts from a new drive. */
  const setNavTripActive = useCallback((v: boolean) => {
    setNavTripActiveState(v);
    AsyncStorage.setItem(BG_DRIVE_ACTIVE_KEY, v ? "true" : "false").catch(() => {});
    if (v) {
      // Generate a new session ID so the dedup map from any previous drive is
      // discarded on the first background task invocation of this session.
      const sessionId =
        Date.now().toString(36) + Math.random().toString(36).slice(2);
      AsyncStorage.setItem(BG_SESSION_ID_KEY, sessionId).catch(() => {});
    }
  }, []);

  // Persist a compact zone list whenever allZones changes so the background
  // task can evaluate GPS fixes without hitting the API or importing large data.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const compact: BgZoneEntry[] = allZones.map((z) => ({
      id:         z.id,
      lat:        z.lat,
      lng:        z.lng,
      type:       z.type,
      speedLimit: z.speedLimit,
      name:       z.name,
      road:       z.road,
    }));
    AsyncStorage.setItem(BG_ZONES_CACHE_KEY, JSON.stringify(compact)).catch(() => {});
  }, [allZones]);

  // Persist a compact active-report list whenever community reports change so
  // the background task can check for nearby hazards the driver reported.
  // Applies the same eligibility rules as the foreground alert handler so
  // the background task never fires for stale or non-hazard reports:
  //   • exclude type "clear" — "road is clear" reports are not hazards
  //   • exclude denied / expired / admin_review status
  //   • exclude reports older than 24 h (matches pruneReportCache hard cap)
  useEffect(() => {
    if (Platform.OS === "web") return;
    const now = Date.now();
    const compact: BgReportEntry[] = communityReports
      .filter((r) => {
        if (r.type === "clear") return false;
        if (r.status === "denied" || r.status === "expired" || r.status === "admin_review") return false;
        // Hard 24-hour age cap — matches pruneReportCache in AppContext
        if (now - r.timestamp > 86_400_000) return false;
        return true;
      })
      .map((r) => ({
        id:         r.id,
        lat:        r.lat,
        lng:        r.lng,
        type:       r.type,
        speedLimit: r.speedLimit,
        road:       r.roadName,
      }));
    AsyncStorage.setItem(BG_REPORTS_CACHE_KEY, JSON.stringify(compact)).catch(() => {});
  }, [communityReports]);
  const setHudMode = useCallback((v: boolean) => { setHudModeState(v); AsyncStorage.setItem(KEYS.HUD, JSON.stringify(v)); }, []);
  const setThemeOverride = useCallback((v: "system" | "light" | "dark") => {
    setThemeOverrideState(v);
    AsyncStorage.setItem(KEYS.THEME, v);
    if (Platform.OS !== "web") {
      Appearance.setColorScheme(v === "system" ? null : v);
      // On Android, the OS navigation bar (software back/home buttons) must be
      // updated explicitly — Appearance.setColorScheme does not touch it.
      // expo-system-ui provides setBackgroundColorAsync for the nav bar and
      // setButtonStyleAsync (light = white buttons on dark bg, dark = dark
      // buttons on light bg).
      if (Platform.OS === "android") {
        const dark = v === "dark";
        const bg = dark ? "#000000" : "#ffffff";
        SystemUI.setBackgroundColorAsync(bg).catch(() => {});
      }
    }
  }, []);

  const setVehicleType = useCallback((v: VehicleTypeId) => {
    setVehicleTypeState(v);
    vehicleTypeRef.current = v;
    AsyncStorage.setItem(KEYS.VEHICLE_TYPE, v);
  }, []);

  const setVehicleModel = useCallback((makeId: string, modelId: string) => {
    setVehicleMakeIdState(makeId);
    setVehicleModelIdState(modelId);
    setVehicleCustomMakeNameState(null);
    setVehicleCustomModelNameState(null);
    AsyncStorage.setItem(KEYS.VEHICLE_MAKE_ID, makeId).catch(() => {});
    AsyncStorage.setItem(KEYS.VEHICLE_MODEL_ID, modelId).catch(() => {});
    AsyncStorage.removeItem(KEYS.VEHICLE_CUSTOM_MAKE_NAME).catch(() => {});
    AsyncStorage.removeItem(KEYS.VEHICLE_CUSTOM_MODEL_NAME).catch(() => {});
  }, []);

  const setCustomVehicle = useCallback(
    (makeId: string, modelId: string, makeName: string, modelName: string) => {
      setVehicleMakeIdState(makeId);
      setVehicleModelIdState(modelId);
      setVehicleCustomMakeNameState(makeName);
      setVehicleCustomModelNameState(modelName);
      AsyncStorage.setItem(KEYS.VEHICLE_MAKE_ID, makeId).catch(() => {});
      AsyncStorage.setItem(KEYS.VEHICLE_MODEL_ID, modelId).catch(() => {});
      AsyncStorage.setItem(KEYS.VEHICLE_CUSTOM_MAKE_NAME, makeName).catch(() => {});
      AsyncStorage.setItem(KEYS.VEHICLE_CUSTOM_MODEL_NAME, modelName).catch(() => {});
    },
    [],
  );

  // ── Crash sensitivity persisted setting ─────────────────────────────────
  const setCrashSensitivity = useCallback((v: "low" | "medium" | "high") => {
    setCrashSensitivityState(v);
    crashSensitivityRef.current = v;
    AsyncStorage.setItem(KEYS.CRASH_SENSITIVITY, v);
  }, []);

  const clearCrash = useCallback(() => {
    crashDetectedRef.current = false;
    setCrashDetected(false);
  }, []);

  const setDashcamActive = useCallback((v: boolean) => {
    dashcamActiveRef.current = v;
    setDashcamActiveState(v);
  }, []);

  // ── Hazard event batch refs ───────────────────────────────────────────────
  // Batched silently during drives; flushed to /telemetry/braking-events every
  // 60 s (or when navigation ends). No driver interaction required.
  const hazardBatchRef   = useRef<Array<{ eventType: string; lat: number; lng: number; speedKmh: number; gForce: number }>>([]);
  const hazardLastFiredRef = useRef<Record<string, number>>({});  // type → ms timestamp
  const hazardFlushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const flushHazardBatch = useCallback(async () => {
    const batch = hazardBatchRef.current.splice(0);
    if (batch.length === 0) return;
    const did = deviceIdRef.current;
    if (!did) return;
    apiPost("/telemetry/braking-events", {
      events: batch.map((e) => ({ ...e, deviceId: did })),
    }).catch(() => {}); // fire-and-forget, never surface to user
  }, []);

  // ── Accelerometer — crash detection + silent hazard detection ────────────
  // Subscribe at 20 Hz whenever dashcam is active.
  // Crash detection fires when:
  //   peak net-G in the 2s window > threshold  AND
  //   GPS speed dropped from ≥20 km/h to ≤5 km/h within 2s
  // Hazard events (hard_braking, pothole, swerve) are classified separately
  // and batch-posted silently.
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!dashcamActive) {
      accelWindowRef.current = [];
      return;
    }

    // Start 60-second flush timer
    if (hazardFlushTimerRef.current) clearInterval(hazardFlushTimerRef.current);
    hazardFlushTimerRef.current = setInterval(() => { flushHazardBatch(); }, 60_000);

    const G_THRESHOLD: Record<"low" | "medium" | "high", number> = {
      low: 4.5, medium: 3.5, high: 2.8,
    };
    const HAZARD_DEBOUNCE_MS = 5_000;

    Accelerometer.setUpdateInterval(50); // 20 Hz
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const rawG    = Math.sqrt(x * x + y * y + z * z);
      const netG    = Math.abs(rawG - 9.8);  // subtract Earth gravity baseline
      const vertG   = Math.abs(z - 9.8);     // vertical component (above/below 1g)

      // A sample is "vertically dominant" when the vertical G-force exceeds both
      // horizontal axes — the signature of a pothole or speed bump, not a crash.
      // These samples are excluded from crash peak calculation.
      const vd = vertG > Math.abs(x) && vertG > Math.abs(y);

      // ── 2-second crash window (40 samples) ─────────────────────────────
      accelWindowRef.current.push({ g: netG, vd });
      if (accelWindowRef.current.length > 40) accelWindowRef.current.shift();

      // ── 10-second roughness baseline (200 samples) ─────────────────────
      // Tracks the road's background vibration level so the effective crash
      // threshold rises on heavily potholed roads, preventing false alerts.
      roughnessWindowRef.current.push(netG);
      if (roughnessWindowRef.current.length > 200) roughnessWindowRef.current.shift();

      // ── Crash detection ────────────────────────────────────────────────
      if (!crashDetectedRef.current) {
        const baseThreshold = G_THRESHOLD[crashSensitivityRef.current];

        // Road roughness adjustment: median of the 10-second baseline.
        // A smooth road has ~0.15g baseline; a heavily potholed road can reach
        // 0.8–1.2g.  We add (median − floor) to the threshold, capped at +1.5g,
        // so the detector becomes progressively harder to trigger as road quality
        // worsens.
        const sorted  = [...roughnessWindowRef.current].sort((a, b) => a - b);
        const medianG = sorted[Math.floor(sorted.length / 2)] ?? 0;
        const roadAdj = Math.min(Math.max(medianG - 0.15, 0), 1.5);
        const effectiveThreshold = baseThreshold + roadAdj;

        // Only count non-vertically-dominant samples toward the crash peak.
        // A pothole can push the raw peak over threshold — this filter ignores it.
        const nonVdSamples = accelWindowRef.current.filter((s) => !s.vd);
        const peakG = nonVdSamples.length > 0
          ? Math.max(...nonVdSamples.map((s) => s.g))
          : 0;

        if (peakG >= effectiveThreshold) {
          const now = Date.now();
          const recentSpeeds = speedWindowRef.current.filter((s) => now - s.t <= 2000);
          if (recentSpeeds.length >= 2) {
            const maxSpeed    = Math.max(...recentSpeeds.map((s) => s.kmh));
            const latestSpeed = recentSpeeds[recentSpeeds.length - 1]!.kmh;
            if (maxSpeed >= 20 && latestSpeed <= 5) {
              crashDetectedRef.current = true;
              setCrashDetected(true);
              accelWindowRef.current  = [];

              // Log the trigger server-side so we can compute false-positive rates
              // in the admin dashboard. Fire-and-forget; never surfaces to the driver.
              const lat = currentLatRef.current;
              const lng = currentLngRef.current;
              const did = deviceIdRef.current;
              if (did) {
                apiPost("/telemetry/crash-trigger", {
                  deviceId:    did,
                  lat,
                  lng,
                  peakG,
                  sensitivity: crashSensitivityRef.current,
                }).catch(() => {});
              }
              // Create Crash Assistant record — enables driver to document the incident
              // via the guided flow without re-entering GPS / speed data manually.
              if (did) {
                apiPost("/accidents", {
                  deviceId:         did,
                  vehicleId:        activeVehicleIdRef.current ?? null,
                  lat,
                  lng,
                  speedBeforeKmh:   maxSpeed,
                  speedAtImpactKmh: latestSpeed,
                  headingDeg:       lastHeadingRef.current,
                  tripStartAt:      currentTrip?.startTime
                    ? new Date(currentTrip.startTime).toISOString()
                    : null,
                  destinationName:  navDestination?.name ?? null,
                  distanceM:        currentTrip?.distance != null ? currentTrip.distance : null,
                  durationS:        currentTrip?.startTime
                    ? (now - currentTrip.startTime) / 1000
                    : null,
                  isManual: false,
                }).then((data) => {
                  setCrashAssistantId((data as { id: string }).id);
                }).catch(() => {});
              }
            }
          }
        }
      }

      // ── Hazard event classification (silent, no driver interaction) ───
      const now = Date.now();
      const lat = currentLatRef.current;
      const lng = currentLngRef.current;
      if (lat == null || lng == null) return;

      const canFire = (type: string) =>
        !((hazardLastFiredRef.current[type] ?? 0) + HAZARD_DEBOUNCE_MS > now);

      const speedEntries = speedWindowRef.current.filter((s) => now - s.t <= 2500);
      const latestKmh   = speedEntries.length > 0 ? speedEntries[speedEntries.length - 1]!.kmh : 0;
      const oldestKmh   = speedEntries.length > 1 ? speedEntries[0]!.kmh : latestKmh;
      const speedDrop   = oldestKmh - latestKmh; // positive = decelerating

      // hard_braking: significant longitudinal deceleration + speed drop > 25 km/h in 2.5 s
      const longG = Math.abs(y); // phone longitudinal axis
      if (longG > 1.5 && speedDrop > 25 && canFire("hard_braking")) {
        hazardLastFiredRef.current["hard_braking"] = now;
        hazardBatchRef.current.push({ eventType: "hard_braking", lat, lng, speedKmh: latestKmh, gForce: longG });
      }
      // pothole: vertical spike > 2.5g, speed change < 10 km/h
      // vertG is already computed above (used for crash vd check) — reuse it.
      if (vertG > 2.5 && Math.abs(speedDrop) < 10 && canFire("pothole")) {
        hazardLastFiredRef.current["pothole"] = now;
        hazardBatchRef.current.push({ eventType: "pothole", lat, lng, speedKmh: latestKmh, gForce: vertG });
      }
      // swerve: lateral spike > 1.8g
      const latG = Math.abs(x);
      if (latG > 1.8 && canFire("swerve")) {
        hazardLastFiredRef.current["swerve"] = now;
        hazardBatchRef.current.push({ eventType: "swerve", lat, lng, speedKmh: latestKmh, gForce: latG });
      }
    });

    return () => {
      sub.remove();
      if (hazardFlushTimerRef.current) { clearInterval(hazardFlushTimerRef.current); hazardFlushTimerRef.current = null; }
      flushHazardBatch(); // flush remaining events on drive end
    };
  }, [dashcamActive, flushHazardBatch]);

  const clearAllData = useCallback(async () => {
    await AsyncStorage.multiRemove([
      KEYS.TRIPS, KEYS.REPORTS, KEYS.HUD, KEYS.SOS,
      KEYS.ONBOARDING, KEYS.DEVICE_ID, KEYS.THEME, KEYS.VEHICLE_TYPE,
      KEYS.VEHICLE_MAKE_ID, KEYS.VEHICLE_MODEL_ID,
    ]);
    setTripHistory([]);
    setCommunityReports([]);
    setHudModeState(false);
    setSosContactState(null);
    setThemeOverrideState("system");
    setVehicleTypeState(DEFAULT_VEHICLE_TYPE);
    vehicleTypeRef.current = DEFAULT_VEHICLE_TYPE;
    setVehicleMakeIdState(null);
    setVehicleModelIdState(null);
    if (Platform.OS !== "web") Appearance.setColorScheme(null);
    const newId = genId() + genId();
    await AsyncStorage.setItem(KEYS.DEVICE_ID, newId);
    deviceIdRef.current = newId;
    setDeviceId(newId);
  }, []);
  const setSosContact = useCallback((c: SOSContact | null) => { setSosContactState(c); c ? AsyncStorage.setItem(KEYS.SOS, JSON.stringify(c)) : AsyncStorage.removeItem(KEYS.SOS); }, []);
  // Posts a locally-created (not-yet-synced) report to the API. Shared by
  // addReport's initial attempt and the reconnect-triggered retry sweep below.
  const syncReportToServer = useCallback((localId: string, type: CommunityReport["type"], lat: number, lng: number, speedLimit?: number, roadName?: string, meta?: { observationContext?: CommunityReport["observationContext"]; observedAt?: number; reporterProximityM?: number }, cameraType?: "fixed" | "mobile") => {
    apiPost<{ id: string; status: string; confirmCount: number; action: string; clearedCount?: number; roadName?: string | null }>(
      "/reports", { type, lat, lng, deviceId: deviceIdRef.current, speedLimit, roadName, ...meta, ...(cameraType ? { cameraType } : {}) }
    ).then((result) => {
      setCommunityReports((prev) => {
        let u: CommunityReport[];
        if (result.action === "clustered") {
          // Server merged into an existing report — update that row and drop the optimistic duplicate
          u = prev
            .filter((rep) => rep.id !== localId)
            .map((rep) =>
              rep.serverId === result.id
                ? { ...rep, confirmCount: result.confirmCount, status: result.status as CommunityReport["status"] }
                : rep
            );
        } else {
          u = prev.map((rep) =>
            rep.id === localId
              ? {
                  ...rep,
                  serverId: result.id,
                  status: result.status as CommunityReport["status"],
                  confirmCount: result.confirmCount,
                  // Back-fill road name from server (geocoded there when client didn't provide one)
                  ...(result.roadName && !rep.roadName ? { roadName: result.roadName } : {}),
                }
              : rep
          );
        }
        // When the server accepted a new "road clear" and resolved nearby
        // incidents, mirror that removal in local state so the map clears
        // immediately without waiting for the next fetch.
        // 0.001° ≈ 111 m — matches the 100 m server radius with a small margin.
        if (type === "clear" && result.action === "created") {
          const CLEAR_DEG = 0.001;
          u = u.filter((rep) => {
            if (rep.type === "camera" || rep.type === "clear") return true;
            if (rep.id === localId || rep.serverId === result.id) return true;
            const withinBox =
              Math.abs(rep.lat - lat) <= CLEAR_DEG &&
              Math.abs(rep.lng - lng) <= CLEAR_DEG;
            return !withinBox;
          });
        }
        AsyncStorage.setItem(KEYS.REPORTS, JSON.stringify(u));
        return u;
      });
    }).catch((err) => {
      // still offline / request failed — local copy remains, retried on reconnect,
      // except when the device has been blocked, which is worth surfacing now.
      warnIfBlockedDevice(err);
    });
  }, []);
  useEffect(() => { syncReportToServerRef.current = syncReportToServer; }, [syncReportToServer]);

  const addReport = useCallback((type: CommunityReport["type"], lat: number, lng: number, speedLimit?: number, roadName?: string, meta?: { observationContext?: CommunityReport["observationContext"]; observedAt?: number; reporterProximityM?: number }, cameraType?: "fixed" | "mobile") => {
    // ── Duplicate-prevention pre-check ───────────────────────────────────────
    // Before creating an optimistic local report, scan the in-memory cache for
    // an existing active/confirmed report of the same type within range.
    // Cameras use 100 m (wider, permanent) and must match cameraType.
    // Other types use 50 m. If found: confirm instead of duplicating.
    const dedupRadius = type === "camera" ? 100 : 50;
    const nearbyExisting = communityReportsRef.current.find((r) => {
      if (r.type !== type) return false;
      if (r.isOwn) return false; // can't confirm own report
      if (r.status !== "active" && r.status !== "confirmed" && r.status !== "admin_review") return false;
      if (haversine(lat, lng, r.lat, r.lng) >= dedupRadius) return false;
      // Fixed and mobile cameras must not merge — different enforcement types
      if (type === "camera") {
        const existingCameraType = r.cameraType ?? "fixed";
        const incomingCameraType = cameraType ?? "fixed";
        if (existingCameraType !== incomingCameraType) return false;
      }
      return true;
    });
    if (nearbyExisting) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (!isOfflineRef.current && deviceIdRef.current && nearbyExisting.serverId) {
        apiPost<{ confirmCount: number; status: string }>(
          `/reports/${nearbyExisting.serverId}/confirm`,
          { deviceId: deviceIdRef.current }
        ).then((result) => {
          setCommunityReports((prev) => {
            const u = prev.map((r) =>
              r.id === nearbyExisting.id
                ? { ...r, confirmCount: result.confirmCount, status: result.status as CommunityReport["status"] }
                : r
            );
            AsyncStorage.setItem(KEYS.REPORTS, JSON.stringify(u));
            return u;
          });
        }).catch(() => {/* best-effort — local display already correct */});
      }
      return nearbyExisting.id;
    }

    const localId = genId();
    // Suppress the alert system from treating this report as a new alert for
    // the submitting driver. Without this, the GPS poll (≤ 1 s later) detects
    // the fresh report within the alert radius, fires isNewAlert, and calls
    // speakAlert(type) — which calls stopAlertVoice() and cancels the
    // "report_submitted" confirmation voice mid-play. A 10 s cooldown gives
    // the confirmation audio plenty of time to finish before the system
    // re-evaluates this report ID (by which point cooldown has expired and
    // normal alert behaviour resumes).
    alertDismissCooldownRef.current.set(localId, { expiry: Date.now() + 10_000, peakDistM: 0 });
    const r: CommunityReport = {
      id: localId, type, lat, lng, timestamp: Date.now(), confirmed: 1,
      status: "active", confirmCount: 1, denyCount: 0, isOwn: true,
      speedLimit,
      ...(cameraType ? { cameraType } : {}),
      ...(roadName ? { roadName } : {}),
      ...(meta?.observationContext ? { observationContext: meta.observationContext } : {}),
      ...(meta?.observedAt ? { observedAt: meta.observedAt } : {}),
    };
    setCommunityReports((prev) => { const u = [r, ...prev]; AsyncStorage.setItem(KEYS.REPORTS, JSON.stringify(u)); return u; });
    if (tripRef.current) tripRef.current.alertsCount = (tripRef.current.alertsCount ?? 0) + 1;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Submit to API; keep local copy as offline fallback (retried on reconnect)
    if (!isOfflineRef.current && deviceIdRef.current) {
      syncReportToServer(localId, type, lat, lng, speedLimit, roadName, meta, cameraType);
    }
    return localId;
  }, [syncReportToServer]);
  const clearTripHistory = useCallback(() => { setTripHistory([]); AsyncStorage.removeItem(KEYS.TRIPS); }, []);
  const completeOnboarding = useCallback(() => { setOnboardingComplete(true); AsyncStorage.setItem(KEYS.ONBOARDING, "true"); }, []);
  const setShowTraffic = useCallback((v: boolean) => setShowTrafficState(v), []);

  const deleteReport = useCallback(async (id: string) => {
    const report = communityReportsRef.current.find((r) => r.id === id);
    if (!report) return;
    if ((report.confirmCount ?? 1) >= 3) return; // protected by community
    // Optimistic: remove locally
    setCommunityReports((prev) => {
      const u = prev.filter((r) => r.id !== id);
      AsyncStorage.setItem(KEYS.REPORTS, JSON.stringify(u));
      return u;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!isOfflineRef.current && deviceIdRef.current && report.serverId) {
      try {
        await apiDelete(`/reports/${report.serverId}`, { deviceId: deviceIdRef.current });
      } catch { /* local removal already done; server will TTL-expire eventually */ }
    }
  }, []);

  const updateReport = useCallback(async (id: string, speedLimit: number) => {
    const report = communityReportsRef.current.find((r) => r.id === id);
    if (!report || report.type !== "camera") return;
    // Optimistic: update local speedLimit
    setCommunityReports((prev) => {
      const u = prev.map((r) => r.id === id ? { ...r, speedLimit } : r);
      AsyncStorage.setItem(KEYS.REPORTS, JSON.stringify(u));
      return u;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!isOfflineRef.current && deviceIdRef.current && report.serverId) {
      try {
        await apiPatch(`/reports/${report.serverId}`, { deviceId: deviceIdRef.current, speedLimit });
      } catch { /* keep optimistic value */ }
    }
  }, []);

  const confirmReport = useCallback(async (id: string) => {
    if (!deviceIdRef.current) return;
    const report = communityReportsRef.current.find((r) => r.id === id || r.serverId === id);
    const serverId = report?.serverId ?? id;
    const originalCount = report?.confirmCount ?? 1;
    // Track that this device has voted on this report
    votedReportIdsRef.current.add(id);
    if (report?.serverId) votedReportIdsRef.current.add(report.serverId);
    // Optimistic update
    setCommunityReports((prev) =>
      prev.map((r) => (r.id === id || r.serverId === id) ? { ...r, confirmCount: originalCount + 1 } : r)
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const result = await apiPost<{ confirmCount: number; status: string }>(`/reports/${serverId}/confirm`, { deviceId: deviceIdRef.current });
      // Sync with authoritative server count
      setCommunityReports((prev) =>
        prev.map((r) => (r.id === id || r.serverId === id) ? { ...r, confirmCount: result.confirmCount, status: result.status as CommunityReport["status"] } : r)
      );
    } catch (err) {
      // Roll back optimistic update (e.g. 409 already confirmed, or network error)
      setCommunityReports((prev) =>
        prev.map((r) => (r.id === id || r.serverId === id) ? { ...r, confirmCount: originalCount } : r)
      );
      warnIfBlockedDevice(err);
    }
  }, []);

  // "Report to moderators" — the only way a regular driver can flag a report
  // (their own or someone else's) for removal once it's beyond self-delete.
  // Never removes anything locally; a human moderator decides in the admin
  // dashboard's moderation queue.
  const flagReport = useCallback(async (id: string, reason?: string): Promise<boolean> => {
    if (!deviceIdRef.current) return false;
    const report = communityReportsRef.current.find((r) => r.id === id || r.serverId === id);
    if (!report) return false;
    const serverId = report.serverId ?? id;
    if (isOfflineRef.current) return false;
    try {
      await apiPost(`/reports/${serverId}/flag`, { deviceId: deviceIdRef.current, reason });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return true;
    } catch {
      return false;
    }
  }, []);

  const denyReport = useCallback(async (id: string): Promise<{ ok: boolean; message?: string }> => {
    if (!deviceIdRef.current) return { ok: false, message: "App is still starting up. Try again in a moment." };
    const report = communityReportsRef.current.find((r) => r.id === id || r.serverId === id);
    if (!report) return { ok: false, message: "This report is no longer on the map." };
    // Not yet synced to the server (offline-created). For the driver's own
    // report just resolve it locally — the sync retry would recreate it, and
    // posting the local id to the API would 404.
    if (!report.serverId) {
      if (report.isOwn) {
        setCommunityReports((prev) => {
          const u = prev.filter((r) => r.id !== id);
          AsyncStorage.setItem(KEYS.REPORTS, JSON.stringify(u));
          return u;
        });
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return { ok: true };
      }
      return { ok: false, message: "This report hasn't finished syncing yet. Try again in a moment." };
    }
    const serverId = report.serverId;
    const isCamera = report.type === "camera";
    // Track that this device has voted on this report
    votedReportIdsRef.current.add(id);
    if (report.serverId) votedReportIdsRef.current.add(report.serverId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const originalDenyCount = report.denyCount ?? 0;
    // Optimistic update — camera stays visible until admin action; non-camera
    // is removed immediately so the driver gets instant feedback.
    let removedReport: CommunityReport | null = null;
    if (isCamera) {
      setCommunityReports((prev) =>
        prev.map((r) =>
          r.id === id || r.serverId === id ? { ...r, denyCount: originalDenyCount + 1 } : r
        )
      );
    } else {
      removedReport = report;
      // Mark server ID as locally denied *before* the async POST so the
      // 60-s background poll cannot race-restore the report.
      locallyDeniedServerIdsRef.current.add(serverId);
      setCommunityReports((prev) => {
        const u = prev.filter((r) => r.id !== id && r.serverId !== serverId);
        AsyncStorage.setItem(KEYS.REPORTS, JSON.stringify(u));
        return u;
      });
    }
    try {
      const result = await apiPost<{ denyCount: number; status: string }>(
        `/reports/${serverId}/deny`,
        { deviceId: deviceIdRef.current }
      );
      if (isCamera) {
        // Camera: sync the authoritative count/status returned by the server.
        setCommunityReports((prev) =>
          prev.map((r) =>
            r.id === id || r.serverId === id
              ? { ...r, denyCount: result.denyCount, status: result.status as CommunityReport["status"] }
              : r
          )
        );
      }
      // Non-camera: already removed optimistically — nothing more to do.
      return { ok: true };
    } catch (err) {
      if (isCamera) {
        // Roll back optimistic denyCount increment for camera reports.
        setCommunityReports((prev) =>
          prev.map((r) =>
            r.id === id || r.serverId === id ? { ...r, denyCount: originalDenyCount } : r
          )
        );
      }
      if (warnIfBlockedDevice(err)) return { ok: false }; // alert already shown
      if (err instanceof ApiError) {
        if (err.status === 404) {
          // Report is already gone on the server (expired or admin-removed).
          // For camera reports, clean up locally too. For non-camera the
          // optimistic removal already happened — skip the restore.
          if (isCamera) {
            setCommunityReports((prev) => {
              const u = prev.filter((r) => r.id !== id && r.serverId !== serverId);
              AsyncStorage.setItem(KEYS.REPORTS, JSON.stringify(u));
              return u;
            });
          }
          return { ok: false, message: "This report was already removed from the map." };
        }
        // For non-camera, restore the report so the driver can retry.
        if (!isCamera && removedReport) {
          // Roll back the deny-block so the next poll can restore the report too.
          locallyDeniedServerIdsRef.current.delete(serverId);
          setCommunityReports((prev) => {
            const u = [...prev, removedReport!];
            AsyncStorage.setItem(KEYS.REPORTS, JSON.stringify(u));
            return u;
          });
        }
        // Surface the server's real reason (own-report protection, already voted…)
        return { ok: false, message: err.message };
      }
      // Network or unknown error — restore for non-camera so the driver can retry.
      if (!isCamera && removedReport) {
        // Roll back the deny-block so the next poll can restore the report too.
        locallyDeniedServerIdsRef.current.delete(serverId);
        setCommunityReports((prev) => {
          const u = [...prev, removedReport!];
          AsyncStorage.setItem(KEYS.REPORTS, JSON.stringify(u));
          return u;
        });
      }
      return { ok: false, message: "Check your connection and try again." };
    }
  }, []);

  const setDriverName = useCallback((name: string) => {
    const trimmed = name.trim();
    driverNameRef.current = trimmed;
    setDriverNameState(trimmed);
    void AsyncStorage.setItem(KEYS.DRIVER_NAME, trimmed).catch(() => {});
  }, []);

  // ─── Admin mode ──────────────────────────────────────────────────────────────
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const adminTokenRef = useRef<string | null>(null);
  useEffect(() => { adminTokenRef.current = adminToken; }, [adminToken]);

  // Restore a valid admin token from AsyncStorage on mount
  useEffect(() => {
    void AsyncStorage.getItem("admin_mobile_token").then((t) => {
      if (t && isAdminTokenValid(t)) setAdminToken(t);
      else if (t) void AsyncStorage.removeItem("admin_mobile_token").catch(() => {});
    }).catch(() => {});
  }, []);

  const isAdmin = !!adminToken && isAdminTokenValid(adminToken);

  /** Makes an authenticated fetch to the admin-mobile API. */
  async function adminApiFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!API_BASE) throw new Error("API_BASE not configured");
    const token = adminTokenRef.current;
    if (!token) throw new Error("Not authenticated as admin");
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data: { error?: string } = await res.json().catch(() => ({}));
      throw new Error(data?.error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  const adminLogin = useCallback(async (pin: string): Promise<void> => {
    const res = await apiPost<{ token: string }>("/admin-mobile/auth", { pin });
    await AsyncStorage.setItem("admin_mobile_token", res.token);
    setAdminToken(res.token);
  }, []);

  const adminLogout = useCallback(async (): Promise<void> => {
    await AsyncStorage.removeItem("admin_mobile_token");
    setAdminToken(null);
  }, []);

  const adminVerifyReport = useCallback(async (id: string): Promise<void> => {
    const report = communityReports.find((r) => r.id === id || r.serverId === id);
    const serverId = report?.serverId ?? id;
    await adminApiFetch("POST", `/admin-mobile/reports/${serverId}/verify`);
    setCommunityReports((prev) =>
      prev.map((r) =>
        r.id === id || r.serverId === serverId
          ? { ...r, adminVerified: true, status: "confirmed" as const, confirmCount: Math.floor(Math.random() * 45) + 5 }
          : r
      )
    );
  }, [communityReports]);  // eslint-disable-line react-hooks/exhaustive-deps

  const adminDenyReport = useCallback(async (id: string): Promise<void> => {
    const report = communityReports.find((r) => r.id === id || r.serverId === id);
    const serverId = report?.serverId ?? id;
    await adminApiFetch("POST", `/admin-mobile/reports/${serverId}/deny`);
    setCommunityReports((prev) => prev.filter((r) => r.id !== id && r.serverId !== serverId));
  }, [communityReports]);  // eslint-disable-line react-hooks/exhaustive-deps

  const adminUpdateReportLocation = useCallback(async (
    id: string,
    lat: number,
    lng: number,
    roadName?: string | null
  ): Promise<void> => {
    const report = communityReports.find((r) => r.id === id || r.serverId === id);
    const serverId = report?.serverId ?? id;
    await adminApiFetch("PATCH", `/admin-mobile/reports/${serverId}/location`, { lat, lng, roadName });
    setCommunityReports((prev) =>
      prev.map((r) =>
        r.id === id || r.serverId === serverId
          ? { ...r, lat, lng, ...(roadName !== undefined ? { roadName: roadName ?? undefined } : {}) }
          : r
      )
    );
  }, [communityReports]);  // eslint-disable-line react-hooks/exhaustive-deps

  const adminUpdateZoneLocation = useCallback(async (
    id: string, lat: number, lng: number, staticZone?: SpeedZone
  ): Promise<void> => {
    const body: Record<string, unknown> = { lat, lng };
    if (staticZone) {
      body.staticData = {
        name: staticZone.name,
        road: staticZone.road,
        type: staticZone.type,
        speedLimit: staticZone.speedLimit,
        description: staticZone.description,
      };
    }

    // ── True optimistic update — apply BEFORE the API call ────────────────
    // Moving the update after `await` left the GPS handler reading stale
    // coordinates for the entire duration of the network round-trip (1-3 s),
    // which could trigger false alerts or crash-prone calculations against a
    // zone position that no longer matched any real road feature.
    const prevDbZones = dbZonesRef.current;
    const prevSuppressed = suppressedStaticIdsRef.current;

    const nextDbZones = (() => {
      const exists = prevDbZones.some((z) => z.id === id);
      if (exists) return prevDbZones.map((z) => z.id === id ? { ...z, lat, lng } : z);
      // First promotion: add a placeholder so suppression and replacement are
      // atomic — both changes land in the same React render batch.
      return staticZone ? [...prevDbZones, { ...staticZone, lat, lng }] : prevDbZones;
    })();
    const nextSuppressed = staticZone && !prevSuppressed.includes(id)
      ? [...prevSuppressed, id]
      : prevSuppressed;

    setDbZones(nextDbZones);
    setSuppressedStaticIds(nextSuppressed);
    // Sync allZonesRef immediately — don't wait for the useEffect so the GPS
    // handler uses the new position starting from the very next location tick.
    allZonesRef.current = [
      ...SPEED_ZONES.filter((z) => !nextSuppressed.includes(z.id)),
      ...nextDbZones,
    ];

    try {
      await adminApiFetch("PATCH", `/admin-mobile/zones/${id}/location`, body);
    } catch (err) {
      // Roll back so the map returns to the last confirmed state.
      setDbZones(prevDbZones);
      setSuppressedStaticIds(prevSuppressed);
      allZonesRef.current = [
        ...SPEED_ZONES.filter((z) => !prevSuppressed.includes(z.id)),
        ...prevDbZones,
      ];
      throw err;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const adminRemoveZone = useCallback(async (id: string, staticZone?: SpeedZone): Promise<void> => {
    const body: Record<string, unknown> = {};
    if (staticZone) {
      body.staticData = {
        name: staticZone.name,
        road: staticZone.road,
        type: staticZone.type,
        speedLimit: staticZone.speedLimit,
        description: staticZone.description,
      };
    }

    // True optimistic update — apply BEFORE the API call
    const prevDbZones = dbZonesRef.current;
    const prevSuppressed = suppressedStaticIdsRef.current;

    const nextDbZones = prevDbZones.filter((z) => z.id !== id);
    const nextSuppressed = staticZone && !prevSuppressed.includes(id)
      ? [...prevSuppressed, id]
      : prevSuppressed;

    setDbZones(nextDbZones);
    setSuppressedStaticIds(nextSuppressed);
    allZonesRef.current = [
      ...SPEED_ZONES.filter((z) => !nextSuppressed.includes(z.id)),
      ...nextDbZones,
    ];

    try {
      await adminApiFetch("DELETE", `/admin-mobile/zones/${id}`, body);
    } catch (err) {
      setDbZones(prevDbZones);
      setSuppressedStaticIds(prevSuppressed);
      allZonesRef.current = [
        ...SPEED_ZONES.filter((z) => !prevSuppressed.includes(z.id)),
        ...prevDbZones,
      ];
      throw err;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const adminSyncStaticZones = useCallback(async (): Promise<{ synced: number; total: number }> => {
    return adminApiFetch<{ synced: number; total: number }>("POST", "/admin-mobile/zones/sync-static");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const adminEditZone = useCallback(async (
    id: string,
    fields: { name?: string; road?: string; speedLimit?: number | null; type?: string; description?: string },
    staticZone?: SpeedZone
  ): Promise<void> => {
    const body: Record<string, unknown> = { ...fields };
    if (staticZone) {
      body.staticData = {
        name: staticZone.name,
        road: staticZone.road,
        type: staticZone.type,
        speedLimit: staticZone.speedLimit,
        description: staticZone.description,
      };
    }
    await adminApiFetch("PATCH", `/admin-mobile/zones/${id}/meta`, body);
    // Optimistic local update — SpeedZone.speedLimit is number (not null),
    // so convert null → 0 when patching locally.
    type ZoneType = "camera" | "police" | "zone";
    const localPatch = {
      ...(fields.name        !== undefined ? { name:        fields.name }                                        : {}),
      ...(fields.road        !== undefined ? { road:        fields.road }                                        : {}),
      ...(fields.type        !== undefined ? { type:        fields.type as ZoneType }                            : {}),
      ...(fields.description !== undefined ? { description: fields.description }                                 : {}),
      ...(fields.speedLimit  !== undefined ? { speedLimit:  fields.speedLimit ?? 0 }                            : {}),
    };
    setDbZones((prev) => prev.map((z) => z.id === id ? { ...z, ...localPatch } : z));
    allZonesRef.current = allZonesRef.current.map((z) => z.id === id ? { ...z, ...localPatch } : z);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const adminEditReport = useCallback(async (
    serverId: string,
    localId: string,
    fields: { type?: string; roadName?: string | null; speedLimit?: number | null; cameraType?: "fixed" | "mobile" | null }
  ): Promise<void> => {
    await adminApiFetch("PATCH", `/admin-mobile/reports/${serverId}/meta`, fields);
    setCommunityReports((prev) =>
      prev.map((r) =>
        r.id === localId || r.serverId === serverId
          ? {
              ...r,
              ...(fields.type       !== undefined ? { type:       fields.type as CommunityReport["type"] }         : {}),
              ...(fields.roadName   !== undefined ? { roadName:   fields.roadName ?? undefined }                   : {}),
              ...(fields.speedLimit !== undefined ? { speedLimit: fields.speedLimit ?? undefined }                 : {}),
              ...(fields.cameraType !== undefined ? { cameraType: (fields.cameraType ?? undefined) as "fixed" | "mobile" | undefined } : {}),
            }
          : r
      )
    );
  }, [communityReports]); // eslint-disable-line react-hooks/exhaustive-deps

  const adminCreateZone = useCallback(async (zone: {
    name: string; road?: string; lat: number; lng: number;
    speedLimit?: number; type: string; description?: string;
  }): Promise<string> => {
    const created = await adminApiFetch<{ id: string; name: string; road: string | null; lat: number; lng: number; speedLimit: number | null; type: string; description: string | null; verified: boolean }>(
      "POST", "/admin-mobile/zones", zone
    );
    const newZone: SpeedZone = {
      id:          created.id,
      name:        created.name,
      road:        created.road        ?? "",
      lat:         created.lat,
      lng:         created.lng,
      speedLimit:  created.speedLimit  ?? 0,
      type:        created.type        as SpeedZone["type"],
      description: created.description ?? "",
      verified:    created.verified,
    };
    setDbZones((prev) => [...prev, newZone]);
    allZonesRef.current = [...allZonesRef.current, newZone];
    return created.id;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const adminVerifyZone = useCallback(async (id: string, staticZone?: SpeedZone): Promise<void> => {
    const body: Record<string, unknown> = {};
    if (staticZone) {
      body.staticData = {
        name: staticZone.name,
        road: staticZone.road,
        type: staticZone.type,
        speedLimit: staticZone.speedLimit,
        description: staticZone.description,
      };
    }

    // True optimistic update — apply BEFORE the API call
    const prevDbZones = dbZonesRef.current;
    const prevSuppressed = suppressedStaticIdsRef.current;

    const nextDbZones = (() => {
      const exists = prevDbZones.some((z) => z.id === id);
      if (exists) return prevDbZones.map((z) => z.id === id ? { ...z, verified: true } : z);
      // Static zone not yet in dbZones — promote with verified=true immediately
      // so the map shows the badge without waiting for the next 5-min poll.
      return staticZone ? [...prevDbZones, { ...staticZone, verified: true }] : prevDbZones;
    })();
    const nextSuppressed = staticZone && !prevSuppressed.includes(id)
      ? [...prevSuppressed, id]
      : prevSuppressed;

    setDbZones(nextDbZones);
    setSuppressedStaticIds(nextSuppressed);
    allZonesRef.current = [
      ...SPEED_ZONES.filter((z) => !nextSuppressed.includes(z.id)),
      ...nextDbZones,
    ];

    try {
      await adminApiFetch("POST", `/admin-mobile/zones/${id}/verify`, body);
    } catch (err) {
      setDbZones(prevDbZones);
      setSuppressedStaticIds(prevSuppressed);
      allZonesRef.current = [
        ...SPEED_ZONES.filter((z) => !prevSuppressed.includes(z.id)),
        ...prevDbZones,
      ];
      throw err;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Narrow, high-frequency location value — its own context so a GPS tick only
  // re-renders components that call useLiveLocation(), not all useApp() consumers.
  const locationValue = useMemo(
    () => ({ currentLat, currentLng, currentSpeed, driverHeading }),
    [currentLat, currentLng, currentSpeed, driverHeading],
  );

  // The main app value is memoized WITHOUT the GPS fields, so provider
  // re-renders caused by GPS setState produce a referentially-identical value
  // and useApp() consumers bail out of re-rendering.
  const appValue = useMemo<AppContextValue>(() => ({
      locationGranted, requestLocationPermission, requestNotificationPermission,
      activeAlert, activeAlertExtras, currentSpeedLimit, nearbyZones, allZones, stretchZones: dbStretches, dismissAlert,
      hudMode, setHudMode,
      themeOverride, setThemeOverride,
      clearAllData,
      sosContact, setSosContact,
      communityReports, refreshReports, addReport, confirmReport, denyReport, deleteReport, flagReport, updateReport, deviceId,
      currentTrip, tripHistory, clearTripHistory,
      liveOdometerKm: odoBaseKm + (currentTrip != null ? (currentTrip.distance ?? 0) / 1000 : 0),
      hydrated, onboardingComplete, completeOnboarding,
      isOffline,
      lastAlertDataSyncedAt,
      vehicleType, setVehicleType,
      vehicleMakeId, vehicleModelId, setVehicleModel,
      vehicleCustomMakeName, vehicleCustomModelName, setCustomVehicle,
      navDestination, setNavDestination,
      activeRoute, altRoutes, selectRoute,
      isSharingTrip: shareToken !== null,
      shareToken,
      shareLink: (shareCode || shareToken) ? `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}/live/${shareCode ?? shareToken}` : null,
      driverName,
      setDriverName,
      startSharingTrip,
      stopSharingTrip,
      distanceRemainingM, durationRemainingS, routeLoading,
      showTraffic, setShowTraffic,
      routeIncidentsAhead, routeTrafficDelayS, checkRouteStatus, routeIncidentsExpanded, setRouteIncidentsExpanded,
      pendingConfirmationReport, setPendingConfirmationReport,
      pendingConfirmationSource, setPendingConfirmationSource,
      hasVotedOnReport,
      pendingFocusCoords, setPendingFocusCoords,
      markReportPrompted, isReportPrompted,
      isAdmin, adminLogin, adminLogout, adminVerifyReport, adminDenyReport, adminUpdateReportLocation,
      adminUpdateZoneLocation, adminRemoveZone, adminVerifyZone, adminSyncStaticZones,
      adminEditZone, adminEditReport, adminCreateZone,
      snapToActiveRoute,
      hereIncidents, dismissHereIncident,
      mapPickerActive, setMapPickerActive,
      crashDetected, clearCrash, crashAssistantId,
      crashSensitivity, setCrashSensitivity,
      setDashcamActive,
      gpsLastFixAtRef,
      profilePhotoUri, setProfilePhotoUri,
      navTripActive, navTripPaused,
      setNavTripActive: setNavTripActive as (v: boolean) => void,
      setNavTripPaused,
  }), [
    locationGranted, requestLocationPermission, requestNotificationPermission,
    activeAlert, activeAlertExtras, currentSpeedLimit, nearbyZones, allZones, dbStretches, dismissAlert,
    hudMode, setHudMode,
    themeOverride, setThemeOverride,
    clearAllData,
    sosContact, setSosContact,
    communityReports, refreshReports, addReport, confirmReport, denyReport, deleteReport, flagReport, updateReport, deviceId,
    currentTrip, tripHistory, clearTripHistory,
    odoBaseKm,
    hydrated, onboardingComplete, completeOnboarding,
    isOffline,
    lastAlertDataSyncedAt,
    vehicleType, setVehicleType,
    vehicleMakeId, vehicleModelId, setVehicleModel,
    vehicleCustomMakeName, vehicleCustomModelName, setCustomVehicle,
    navDestination, setNavDestination,
    activeRoute, altRoutes, selectRoute,
    shareToken, shareCode,
    driverName, setDriverName,
    startSharingTrip, stopSharingTrip,
    distanceRemainingM, durationRemainingS, routeLoading,
    showTraffic, setShowTraffic,
    routeIncidentsAhead, routeTrafficDelayS, checkRouteStatus, routeIncidentsExpanded, setRouteIncidentsExpanded,
    pendingConfirmationReport, setPendingConfirmationReport,
    pendingConfirmationSource, setPendingConfirmationSource,
    hasVotedOnReport,
    pendingFocusCoords, setPendingFocusCoords,
    markReportPrompted, isReportPrompted,
    isAdmin, adminLogin, adminLogout, adminVerifyReport, adminDenyReport, adminUpdateReportLocation,
    adminUpdateZoneLocation, adminRemoveZone, adminVerifyZone, adminSyncStaticZones,
    adminEditZone, adminEditReport, adminCreateZone,
    snapToActiveRoute,
    hereIncidents, dismissHereIncident,
    mapPickerActive, setMapPickerActive,
    crashDetected, clearCrash, crashAssistantId,
    crashSensitivity, setCrashSensitivity,
    setDashcamActive,
    gpsLastFixAtRef,
    profilePhotoUri, setProfilePhotoUri,
    navTripActive, navTripPaused,
    setNavTripActive, setNavTripPaused,
  ]);

  return (
    <AppContext.Provider value={appValue}>
      <LocationContext.Provider value={locationValue}>
        {children}
      </LocationContext.Provider>
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
