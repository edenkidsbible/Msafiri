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
import { stopVoice } from "@/utils/sound";
import { speakPhrase, prewarmRouteAudio, prebuildRouteAudio, cancelPrewarm, isNavVoicePlaying } from "@/utils/tts";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import NetInfo from "@react-native-community/netinfo";
import { SPEED_ZONES, SpeedZone } from "@/data/speedZones";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError, API_BASE } from "@/utils/apiClient";
import {
  startBackgroundShareTask,
  stopBackgroundShareTask,
  requestBackgroundLocationPermission,
} from "@/utils/backgroundShare";
import {
  startBackgroundNavTask,
  stopBackgroundNavTask,
} from "@/utils/backgroundNavLocation";
import { resolveIncidentType } from "@/constants/incidentTypes";
import { VehicleTypeId, DEFAULT_VEHICLE_TYPE, getVehicleTypeDef, capSpeedLimit } from "@/data/vehicleTypes";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CommunityReport {
  id: string;
  type: "camera" | "police" | "alcoblow" | "accident" | "pothole" | "roadblock" | "roadworks" | "clear" | "hazard" | "closure" | "weather" | "debris" | "breakdown" | "traffic";
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

export interface ArrivedInfo {
  destName: string;
  distM: number;
  durationS: number;
  maxSpeedKmh: number;
  alertsCount: number;
}

export interface NavDestination {
  name: string;
  lat: number;
  lng: number;
  /** Set when the destination was chosen via the "Go" button on a POI card */
  poiType?: "fuel" | "food" | "shopping" | "hospital" | "nightlife";
}

export interface RouteCoord { latitude: number; longitude: number }

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
}

/** A single hazard/checkpoint located along the active route — merges static
 *  speed-camera/police zones with live community reports into one shape so
 *  the UI can render them as a unified, sorted "what's ahead" list. */
export interface RouteIncident {
  id: string;
  source: "static" | "report";
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

/** Unified alert shown in DriveAlertOverlay — covers both static speed
 *  zones/cameras and live community reports so either can trigger the
 *  full-screen panel. */
export interface DriveAlert {
  id: string;
  source: "zone" | "report";
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
}

interface AppContextValue {
  locationGranted: boolean;
  requestLocationPermission: () => Promise<void>;
  requestNotificationPermission: () => Promise<boolean>;
  currentLat: number | null;
  currentLng: number | null;
  currentSpeed: number;
  activeAlert: DriveAlert | null;
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
  addReport: (type: CommunityReport["type"], lat: number, lng: number, speedLimit?: number) => string;
  confirmReport: (id: string) => Promise<void>;
  denyReport: (id: string) => Promise<{ ok: boolean; message?: string }>;
  deleteReport: (id: string) => Promise<void>;
  flagReport: (id: string, reason?: string) => Promise<boolean>;
  updateReport: (id: string, speedLimit: number) => Promise<void>;
  deviceId: string | null;
  currentTrip: Partial<TripData> | null;
  tripHistory: TripData[];
  clearTripHistory: () => void;
  hydrated: boolean;
  onboardingComplete: boolean;
  completeOnboarding: () => void;
  isOffline: boolean;
  /** True when GPS signal has been absent for >5 s during active navigation.
   *  Dead reckoning is used to project position during this window (max 15 s). */
  gpsLost: boolean;
  vehicleType: VehicleTypeId;
  setVehicleType: (v: VehicleTypeId) => void;
  // Navigation
  navDestination: NavDestination | null;
  setNavDestination: (d: NavDestination | null) => void;
  activeRoute: AppRoute | null;
  altRoutes: AppRoute[];
  selectRoute: (r: AppRoute) => void;
  navigationActive: boolean;
  /** True while route voice clips are being pre-fetched before navigation starts.
   *  The UI shows a "Preparing voice guidance…" spinner during this window. */
  voicePreparing: boolean;
  startNavigation: () => Promise<void>;
  stopNavigation: () => void;
  isSharingTrip: boolean;
  shareToken: string | null;
  shareLink: string | null;
  driverName: string;
  setDriverName: (name: string) => void;
  startSharingTrip: () => Promise<string | null>;
  stopSharingTrip: () => Promise<void>;
  currentStepIdx: number;
  distToNextM: number | null;
  distanceRemainingM: number | null;
  durationRemainingS: number | null;
  routeLoading: boolean;
  showTraffic: boolean;
  setShowTraffic: (v: boolean) => void;
  zonesOnRoute: SpeedZone[];
  routeIncidentsAhead: RouteIncident[];
  routeTrafficDelayS: number;
  /** On-demand road-condition check from the driver's current location to an
   *  arbitrary destination (used by Saved Places / Planned Trips), independent
   *  of the active navigation route. Returns null if location isn't available
   *  or no route could be found. */
  checkRouteStatus: (destLat: number, destLng: number) => Promise<RouteCheckResult | null>;
  routeIncidentsExpanded: boolean;
  setRouteIncidentsExpanded: (v: boolean) => void;
  arrivedInfo: ArrivedInfo | null;
  clearArrival: () => void;
  pendingConfirmationReport: CommunityReport | null;
  setPendingConfirmationReport: (r: CommunityReport | null) => void;
  pendingConfirmationSource: "proximity" | "recent" | null;
  setPendingConfirmationSource: (s: "proximity" | "recent" | null) => void;
  hasVotedOnReport: (id: string) => boolean;
  pendingFocusCoords: { lat: number; lng: number } | null;
  setPendingFocusCoords: (coords: { lat: number; lng: number } | null) => void;
  markReportPrompted: (id: string) => void;
  isReportPrompted: (id: string) => boolean;
  /** Driver heading in degrees (0–360°), derived from consecutive GPS fixes.
   *  Null until at least two fixes are available or if movement is below the
   *  noise threshold (< 5 m). Used by the map to fade pins that are behind
   *  the driver (angle > 90° from the heading vector). */
  driverHeading: number | null;
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
  SHARE: "sdk_share",  // active sharing session — persisted so it survives backgrounding
  DRIVER_NAME: "sdk_driver_name",  // display name shown to live-share recipients
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

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
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
  toLat: number, toLng: number
): Promise<AppRoute[]> {
  type ServerStep = {
    instruction: string;
    distanceM: number;
    lat: number;
    lng: number;
    maneuverType: string;
    maneuverModifier: string;
    roadName: string;
  };
  type ServerRoute = {
    index: number;
    distanceM: number;
    durationS: number;
    coords: RouteCoord[];
    steps: ServerStep[];
  };

  const data = await apiGet<{ routes: ServerRoute[] }>(
    `/routing/route?fromLat=${fromLat}&fromLng=${fromLng}&toLat=${toLat}&toLng=${toLng}`,
    15000
  );
  if (!data.routes?.length) return [];

  return data.routes.map((r, idx) => {
    // Build coords first so we can compute cumulative distances and project
    // each step's location onto the polyline (giving stepAlongRouteM).
    const coords: RouteCoord[] = r.coords; // already {latitude, longitude}
    const cumDist = buildCumulativeDistances(coords);

    const steps: RouteStep[] = r.steps.map((s) => {
      const stepLoc: RouteCoord = { latitude: s.lat, longitude: s.lng };
      const proj = projectOntoRoute(coords, cumDist, stepLoc.latitude, stepLoc.longitude);
      return {
        instruction:     s.instruction,
        distanceM:       s.distanceM,
        location:        stepLoc,
        maneuverType:    s.maneuverType,
        roadName:        s.roadName,
        stepAlongRouteM: proj?.alongRouteM ?? 0,
      };
    });

    return {
      id: `route-${idx}-${Date.now()}`,
      distanceM: r.distanceM,
      durationS: r.durationS,
      coords,
      cumDist,
      steps,
    };
  });
}

function getZonesOnRoute(route: AppRoute, zones: SpeedZone[]): SpeedZone[] {
  return zones.filter((z) =>
    route.coords.some((c) => haversine(c.latitude, c.longitude, z.lat, z.lng) < 250)
  );
}

const ROUTE_CORRIDOR_M = 250; // matches getZonesOnRoute's "on this route" threshold

/** Cumulative distance (metres) from the route start to each coordinate. */
function buildCumulativeDistances(coords: RouteCoord[]): number[] {
  const dists = [0];
  for (let i = 1; i < coords.length; i++) {
    dists.push(
      dists[i - 1] + haversine(coords[i - 1].latitude, coords[i - 1].longitude, coords[i].latitude, coords[i].longitude)
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
  const base = { name: z.name, road: z.road ?? "", speedLimit: z.speedLimit, type, description: z.description ?? "", verified: z.verified ?? false };
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
const TRAFFIC_DELAY_WEIGHTS_MIN: Record<string, number> = {
  closure: 15,
  accident: 12,
  roadblock: 10,
  traffic: 8,
  roadworks: 5,
  breakdown: 4,
  weather: 3,
};
const MAX_TRAFFIC_DELAY_MIN = 45;

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

/** Speak navigation guidance via ElevenLabs (Keli voice) using bundled tokens
 *  for structural phrases and on-demand cached clips for road names. */
function speakText(text: string) {
  speakPhrase(text).catch((e) => console.warn("[speakText]", e));
}

// ─── Notification setup ───────────────────────────────────────────────────────

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

async function requestNotificationPermissionInternal(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

async function fireZoneNotification(zone: SpeedZone, distM: number) {
  if (Platform.OS === "web") return;
  const typeLabel = zone.type === "camera" ? "Speed Camera" : zone.type === "police" ? "Police Checkpoint" : "Speed Zone";
  const d = distM < 1000 ? `${Math.round(distM)} m` : `${(distM / 1000).toFixed(1)} km`;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `⚠️ ${typeLabel} Ahead — ${zone.speedLimit} km/h`,
      body: `${zone.name} is ${d} away on ${zone.road}.`,
      data: { zoneId: zone.id },
    },
    trigger: null,
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

const ALERT_DIST = 1000, IN_ZONE_DIST = 250, MIN_TRIP_DIST = 200, STOP_TIMEOUT_MS = 180000;
const STEP_ADVANCE_DIST = 50;  // m — advance step index when past maneuver point
// Minimum gap between ANNOUNCE voice cues (the "In 300 metres, turn left…" cue).
// Prevents rapid-fire repeats when: (a) consecutive short steps advance in one GPS burst,
// (b) off-route detection resets lastSpokenRef and re-triggers the cue before the
// rerouted route arrives.  REMIND and NOW cues are NOT gated by this — they must
// fire quickly right before a turn.
const MIN_NAV_ANNOUNCE_GAP_MS = 5000;

// ─── Navigation voice timing ─────────────────────────────────────────────────
// Fixed trigger distances break at both ends: 350 m at 30 km/h = 42 s
// (too early); 350 m at 100 km/h = 12.6 s (too late for a highway turn).
// Google Maps and Bolt solve this with two ideas combined:
//
//   1. Speed-adaptive spoken distance
//      Target ~8 seconds of travel time, snapped to available token grid.
//      e.g. at 50 km/h → 100 m token; at 100 km/h → 250 m token.
//
//   2. Audio pre-compensation (the formula they actually use)
//      triggerM = spokenDistM + speed × clipDuration
//      This advances the trigger so the SPOKEN distance is still accurate
//      when the driver HEARS it, after 4-5 s of clip playback have elapsed.
//
//   3. Three-cue system (industry standard)
//      ANNOUNCE — "In [N] metres, turn left onto Ngong Road"  (~8 s of travel)
//      REMIND   — "Turn left onto Ngong Road"                 (~2.5 s of travel)
//      NOW      — "Turn left"  (maneuver only, driver is at the junction)
//
// Clip duration estimates (Keli, Flash v2.5):
const CLIP_DUR_ANNOUNCE_S = 4.5; // "In 300 metres, turn left onto Ngong Road"
const CLIP_DUR_REMIND_S   = 2.5; // "Turn left onto Ngong Road"
const CLIP_DUR_NOW_S      = 1.2; // "Turn left"
const AUDIO_STARTUP_S     = 0.5; // token load + speaker warm-up

/**
 * Returns speed-adaptive trigger thresholds and the pre-compensated spoken
 * distance word for the ANNOUNCE cue.
 *
 * @param speedKmh  Current GPS speed (km/h)
 * @param distM     Current distance to next maneuver point (metres)
 */
function stepTriggers(speedKmh: number, distM: number) {
  const s = Math.max(5, speedKmh) / 3.6; // m/s; floor prevents division issues at 0

  // ── ANNOUNCE ─────────────────────────────────────────────────────────────
  // Target spoken distance: ~8 s of travel, snapped to 50 m token grid (100–350 m)
  const spokenAnnounceM = Math.min(350, Math.max(100, Math.round(s * 8 / 50) * 50));
  const announceM       = spokenAnnounceM + s * (CLIP_DUR_ANNOUNCE_S + AUDIO_STARTUP_S);

  // Actual spoken distance at trigger time = where driver will be when audio ends.
  // Differs from spokenAnnounceM when nav starts inside the bubble or speed changed.
  const actualSpokenM = Math.max(0, Math.round((distM - s * CLIP_DUR_ANNOUNCE_S) / 50) * 50);
  const distWord      = actualSpokenM >= 100 ? `In ${actualSpokenM} metres, ` : "";

  // ── REMIND ───────────────────────────────────────────────────────────────
  // Spoken distance not needed; just need trigger threshold.
  const spokenRemindM = Math.min(100, Math.max(30, Math.round(s * 2.5 / 10) * 10));
  const remindM       = spokenRemindM + s * (CLIP_DUR_REMIND_S + AUDIO_STARTUP_S);

  // ── NOW ──────────────────────────────────────────────────────────────────
  // Must fire BEFORE STEP_ADVANCE_DIST (50 m) or the step advances first and
  // the cue is silently skipped. Minimum is therefore STEP_ADVANCE_DIST + 10 = 60 m.
  const nowM = Math.max(60, 20 + s * (CLIP_DUR_NOW_S + AUDIO_STARTUP_S));

  return { announceM, remindM, nowM, distWord };
}

/** Strip "onto [road]" for the NOW cue — driver is at the junction, no road name needed. */
function maneuverOnly(instruction: string): string {
  return instruction.replace(/\s+onto\s+.+$/i, "").replace(/\s+on\s+.+$/i, "").trim();
}
const ARRIVAL_DIST = 30;        // m — trigger arrival voice + advance final step
const APPROACHING_DIST = 65;   // m — one early "approaching your destination" cue
// Tighter than IN_ZONE_DIST: this gates the persistent "current road limit"
// readout, so we only claim confidence in a posted limit when squarely
// inside the admin-defined corridor — not just "somewhere nearby".
const STRETCH_CORRIDOR_M = 80;
// Minimum gap between spoken *supplementary* hazard alerts (zone/camera/
// police-ahead, community reports, repeat speeding warning). On corridors
// with several zones or reports packed close together this previously let
// the voice guide talk almost continuously; the visual banner + haptic buzz
// still fire immediately and unthrottled, only the voice is paced. Turn-by-
// turn navigation instructions and the arrival announcement are core
// wayfinding and are intentionally NOT subject to this cooldown.
const GENERAL_ALERT_COOLDOWN_MS = 20000;

// ─── Provider ────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [locationGranted, setLocationGranted] = useState(false);
  const [currentLat, setCurrentLat] = useState<number | null>(null);
  const [currentLng, setCurrentLng] = useState<number | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [activeAlert, setActiveAlert] = useState<DriveAlert | null>(null);
  const [currentSpeedLimit, setCurrentSpeedLimit] = useState<number | null>(null);
  const [nearbyZones, setNearbyZones] = useState<Array<SpeedZone & { distance: number }>>([]);
  const [hudMode, setHudModeState] = useState(false);
  const [themeOverride, setThemeOverrideState] = useState<"system" | "light" | "dark">("system");
  const [sosContact, setSosContactState] = useState<SOSContact | null>(null);
  const [communityReports, setCommunityReports] = useState<CommunityReport[]>([]);
  const [currentTrip, setCurrentTrip] = useState<Partial<TripData> | null>(null);
  const [tripHistory, setTripHistory] = useState<TripData[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [vehicleType, setVehicleTypeState] = useState<VehicleTypeId>(DEFAULT_VEHICLE_TYPE);
  const vehicleTypeRef = useRef<VehicleTypeId>(DEFAULT_VEHICLE_TYPE);
  const currentLatRef = useRef<number | null>(null);
  const currentLngRef = useRef<number | null>(null);
  // Extra navigation refs used by the share-trip ping interval so it can read
  // fresh values inside setInterval without stale closure captures.
  const currentSpeedRef      = useRef(0);
  const currentSpeedLimitRef = useRef<number | null>(null);
  const distToNextMRef       = useRef<number | null>(null);
  const durationRemainingRef = useRef<number | null>(null);
  const distanceRemainingRef = useRef<number | null>(null);
  // Share-trip
  const shareTokenRef        = useRef<string | null>(null);
  const sharePingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Navigation
  const [navDestination, setNavDestState] = useState<NavDestination | null>(null);
  const [activeRoute, setActiveRoute] = useState<AppRoute | null>(null);
  const [altRoutes, setAltRoutes] = useState<AppRoute[]>([]);
  const [navigationActive, setNavigationActive] = useState(false);
  const [voicePreparing, setVoicePreparing] = useState(false);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [distToNextM, setDistToNextM] = useState<number | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [showTraffic, setShowTrafficState] = useState(false);
  const [zonesOnRoute, setZonesOnRoute] = useState<SpeedZone[]>([]);
  const [routeIncidentsExpanded, setRouteIncidentsExpanded] = useState(false);
  const [dbZones, setDbZones] = useState<SpeedZone[]>([]);
  const [suppressedStaticIds, setSuppressedStaticIds] = useState<string[]>([]);
  const [dbStretches, setDbStretches] = useState<SpeedStretch[]>([]);
  const [driverHeading, setDriverHeading] = useState<number | null>(null);
  const allZonesRef = useRef<SpeedZone[]>(SPEED_ZONES);
  const dbStretchesRef = useRef<SpeedStretch[]>([]);

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [driverName, setDriverNameState] = useState<string>("");
  const driverNameRef = useRef<string>("");
  const isOfflineRef = useRef(false);
  const deviceIdRef = useRef<string | null>(null);
  const pollLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareCode,  setShareCode]  = useState<string | null>(null); // short code for the public share URL

  const [arrivedInfo, setArrivedInfo] = useState<ArrivedInfo | null>(null);
  const [pendingConfirmationReport, setPendingConfirmationReport] = useState<CommunityReport | null>(null);
  const [pendingConfirmationSource, setPendingConfirmationSource] = useState<"proximity" | "recent" | null>(null);
  const [pendingFocusCoords, setPendingFocusCoords] = useState<{ lat: number; lng: number } | null>(null);
  const votedReportIdsRef = useRef<Set<string>>(new Set());
  const hasVotedOnReport = useCallback((id: string) => votedReportIdsRef.current.has(id), []);

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
  // Distance to the active alert zone at the last GPS fix — used to detect
  // when the driver is moving away so we can dismiss the alert early.
  const alertZoneLastDistRef = useRef<number | null>(null);
  // Consecutive GPS fixes where distance to the active alert zone increased;
  // when this reaches 2 we dismiss (driver has passed or turned away).
  const alertZoneIncreasingCountRef = useRef(0);
  // Per-zone cooldown after auto-dismiss (ms timestamp). Prevents an alert that
  // was just dismissed from immediately re-triggering due to the heading
  // activation window (60°) being wider than the dismissal window (90°).
  // Maps dismissed alert id → { expiry, peakDistM }.
  // peakDistM starts at the distance when the alert was dismissed and is
  // updated upward on every GPS tick while in cooldown.  When the driver
  // re-approaches to within (peakDistM − 300 m) the cooldown is cancelled
  // early — a genuine U-turn or loop will have built enough peak distance for
  // the threshold to be reachable; brief GPS jitter never will.
  const alertDismissCooldownRef = useRef<Map<string, { expiry: number; peakDistM: number }>>(new Map());
  const lastSpeedingWarnRef = useRef<number>(0);
  const tripRef = useRef<Partial<TripData> | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifGranted = useRef(false);
  const routeRef = useRef<AppRoute | null>(null);
  const stepIdxRef = useRef(0);
  const lastSpokenRef = useRef<string>("");
  const navActiveRef = useRef(false);
  const lastLocationAtRef = useRef(0);
  const lastFixRef = useRef<{ lat: number; lng: number; t: number } | null>(null);
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
  // Proximity voice refs
  const communityReportsRef = useRef<CommunityReport[]>([]);
  const navDestRef = useRef<NavDestination | null>(null);
  const announcedReportsRef = useRef<Set<string>>(new Set());
  const destAnnouncedRef = useRef(false);
  // When the current turn-by-turn session started — used to auto-end a
  // navigation session that's run far longer than the route could ever
  // reasonably take (see the staleness check in handleLocation below).
  const navStartRef = useRef<number | null>(null);
  // Shared cooldown gate for supplementary hazard voice alerts — see
  // GENERAL_ALERT_COOLDOWN_MS above.
  const lastGeneralAlertAtRef = useRef<number>(0);
  // Tracks server IDs seen in the previous poll — used to detect reports that
  // were removed (expired / denied) while the driver is en route.
  const prevPollServerIdsRef = useRef<Set<string>>(new Set());
  // Timestamp of the last speed-driven nav-notification update (Android only).
  // Throttles high-frequency GPS-speed writes to at most once every 3 seconds.
  // Forwards to the memoized `stopNavigation` below so handleLocation (a
  // stable useCallback defined earlier in this component) can trigger a
  // full stop without needing it in its dependency array.
  const stopNavigationRef = useRef<() => void>(() => {});
  // Consecutive GPS fixes where the driver was off-route; triggers auto-reroute.
  const offRouteCountRef = useRef(0);
  const isReroutingRef   = useRef(false);
  // Timestamp (ms) until which off-route detection is suppressed after a
  // reroute fires.  Prevents the reroute-loop where GPS jitter at a complex
  // junction immediately triggers another reroute before the new route arrives.
  const rerouteGraceUntilRef = useRef<number>(0);
  // Timestamp of the last ANNOUNCE voice cue (the "In N metres, turn…" cue).
  // Used to enforce MIN_NAV_ANNOUNCE_GAP_MS so rapid step chains and reroute
  // resets don't cause the same instruction to be spoken every second.
  const lastAnnounceCueAtRef = useRef<number>(0);
  // ── GPS signal-loss detection + dead reckoning ────────────────────────────
  // When navigating, we track the time of the last real GPS fix. If fixes stop
  // arriving for >5 s (tunnel, underpass, parking structure) we set gpsLost and
  // begin projecting position along the route polyline using the last known
  // speed and heading (dead reckoning), for up to 15 s before freezing.
  const [gpsLost, setGpsLost] = useState(false);
  const gpsLostRef      = useRef(false);   // stable ref for interval callbacks
  const gpsLostSinceRef = useRef<number | null>(null); // when loss started
  const lastNavFixAtRef = useRef(0);       // last real fix while navActive
  const lastHeadingRef  = useRef<number | null>(null); // last known heading (°)
  const drStateRef      = useRef<{ lat: number; lng: number; speedMps: number; heading: number } | null>(null);
  const triggerRerouteRef = useRef<((lat: number, lng: number) => void) | null>(null);
  // Tracks whether we've already spoken the "approaching destination" cue this
  // navigation session so it fires exactly once per trip.
  const approachingAnnouncedRef = useRef(false);
  // Timeout handle for the delayed opening-step cue in startNavigation.
  // Stored in a ref so stopNavigation (and a rapid re-start) can cancel it
  // before it fires, preventing a stale instruction from bleeding into a
  // new session or playing after the driver has already stopped.
  const openingCueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonically-incrementing session ID — incremented on every startNavigation
  // and stopNavigation call.  The opening-cue callback captures its value at
  // schedule time and bails out if the session has advanced since then.
  const navSessionGenRef = useRef(0);
  const alertSourceRef = useRef<"zone" | "report" | null>(null);
  // Forwards to syncReportToServer (defined later, alongside addReport) so
  // the reconnect-retry sweep above can call it without an ordering issue.
  const syncReportToServerRef = useRef<((localId: string, type: CommunityReport["type"], lat: number, lng: number, speedLimit?: number) => void) | null>(null);

  // ── Startup load ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [trips, reports, hud, sos, onboarded, storedDeviceId, storedTheme, storedVehicleType, savedShare, storedDriverName] = await Promise.all([
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
      ]);
      if (storedVehicleType) {
        const v = storedVehicleType as VehicleTypeId;
        setVehicleTypeState(v);
        vehicleTypeRef.current = v;
      }
      if (trips) setTripHistory(JSON.parse(trips));
      if (reports) {
        const parsed: CommunityReport[] = JSON.parse(reports);
        setCommunityReports(parsed.filter((r) => Date.now() - r.timestamp < 86400000));
      }
      if (hud) setHudModeState(JSON.parse(hud));
      if (sos) setSosContactState(JSON.parse(sos));
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

    })();
  }, []);

  // ── Keep voice refs in sync with state ───────────────────────────────────
  useEffect(() => { communityReportsRef.current = communityReports; }, [communityReports]);
  useEffect(() => { vehicleTypeRef.current = vehicleType; }, [vehicleType]);
  useEffect(() => { currentLatRef.current = currentLat; }, [currentLat]);
  useEffect(() => { currentLngRef.current = currentLng; }, [currentLng]);
  useEffect(() => { currentSpeedRef.current = currentSpeed; }, [currentSpeed]);
  useEffect(() => { currentSpeedLimitRef.current = currentSpeedLimit; }, [currentSpeedLimit]);
  useEffect(() => { distToNextMRef.current = distToNextM; }, [distToNextM]);

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
      if (nowOnline && isOfflineRef.current) retrySyncQueue();
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
    const { status } = await Location.requestForegroundPermissionsAsync();
    setLocationGranted(status === "granted");
  }, []);

  // ── Notification permission ───────────────────────────────────────────────
  const requestNotificationPermission = useCallback(async () => {
    notifGranted.current = await requestNotificationPermissionInternal();
    return notifGranted.current;
  }, []);

  // ── Core location handler ─────────────────────────────────────────────────
  const handleLocation = useCallback((lat: number, lng: number, speedMs: number | null, accuracyM: number | null = null) => {
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
    // Real GPS fix arrived — stamp it and clear any signal-loss state so
    // off-route detection and step tracking operate on the actual position.
    if (navActiveRef.current) lastNavFixAtRef.current = now;
    if (gpsLostRef.current) {
      gpsLostRef.current = false;
      gpsLostSinceRef.current = null;
      setGpsLost(false);
    }
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

    setCurrentLat(lat);
    setCurrentLng(lng);
    setCurrentSpeed(kmh);

    // Speed zones
    const vehicle = getVehicleTypeDef(vehicleTypeRef.current);
    const withDist = allZonesRef.current
      .map((z) => ({ ...z, speedLimit: capSpeedLimit(z.speedLimit, vehicle), distance: haversine(lat, lng, z.lat, z.lng) }))
      .sort((a, b) => a.distance - b.distance);
    setNearbyZones(withDist.filter((z) => z.distance < 5000));
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
    setCurrentSpeedLimit(activeLimitZone?.speedLimit ?? null);

    // Supplementary hazard alerts (zone/camera/police-ahead, community
    // reports, repeat speeding warning) share this cooldown so back-to-back
    // triggers — e.g. several zones packed within a km on the same corridor
    // — don't make the voice guide talk almost continuously. The visual
    // banner and haptic buzz below are NOT gated by this — only the spoken
    // line is paced.
    const canSpeakGeneralAlert = () => Date.now() - lastGeneralAlertAtRef.current >= GENERAL_ALERT_COOLDOWN_MS;
    const speakGeneralAlert = (text: string) => { lastGeneralAlertAtRef.current = Date.now(); speakText(text); };

    const isDriving = kmh > 5;

    // ── Repeat voice warning when speeding inside a zone (every 25 s) ──────
    if (activeLimitZone && kmh > activeLimitZone.speedLimit) {
      const warnNow = Date.now();
      if (warnNow - lastSpeedingWarnRef.current > 25000) {
        lastSpeedingWarnRef.current = warnNow;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        if (canSpeakGeneralAlert()) {
          speakGeneralAlert("You are exceeding the speed limit.");
        }
      }
    } else {
      lastSpeedingWarnRef.current = 0;
    }

    // Driver heading derived from the displacement since the previous fix.
    // Null when there is no prior fix or movement is below the noise threshold
    // — in that case all direction checks degrade to distance-only behaviour.
    const driverHeading = driverHeadingDeg(prevFix, lat, lng);
    setDriverHeading(driverHeading);
    // Update dead reckoning baseline — used by the DR interval when signal is lost.
    lastHeadingRef.current = driverHeading ?? lastHeadingRef.current;
    drStateRef.current = { lat, lng, speedMps: Math.max(0, kmh / 3.6), heading: lastHeadingRef.current ?? 0 };

    // ── Unified alert panel: zones + community reports ────────────────────────
    //
    // (1) Zone candidate — tight 45° forward cone to avoid alerting on cameras
    //     the driver has just passed or turned away from.
    //     Camera-type zones only appear if the driver is actually over the limit
    //     (camera alerts during legal-speed driving would be pure noise).
    //     Additionally, items the driver is already moving away from (distance
    //     increasing vs the previous fix) are suppressed so a passed item never
    //     re-activates even if GPS jitter briefly puts it inside the cone.
    const inRangeZones = withDist.filter((z) => z.distance > IN_ZONE_DIST && z.distance <= ALERT_DIST);
    const zoneCandidate = (() => {
      const fwd = driverHeading != null
        ? inRangeZones.filter((z) => {
            if (angleDiffDeg(driverHeading, bearingDeg(lat, lng, z.lat, z.lng)) > 45) return false;
            // Suppress if the driver is moving away from this item (already passed it).
            if (prevFix) {
              const prevDist = haversine(prevFix.lat, prevFix.lng, z.lat, z.lng);
              if (prevDist < z.distance) return false;
            }
            return true;
          })
        : inRangeZones;
      for (const z of fwd) {
        if (z.type === "camera" && z.speedLimit != null && kmh <= z.speedLimit) continue;
        return z;
      }
      return null;
    })();

    // (2) Report candidate — nearest forward-cone (≤45°) active report < 2 h old.
    //     Items the driver is already moving away from are suppressed (same
    //     passed-point rule as zone candidates above).
    const reportCandidate = (() => {
      if (!isDriving) return null;
      let best: (typeof communityReportsRef.current)[0] | null = null;
      let bestDist = Infinity;
      for (const r of communityReportsRef.current) {
        if (r.status === "expired" || r.status === "denied" || r.type === "clear") continue;
        if (now - r.timestamp > 7200000) continue;
        const d = haversine(lat, lng, r.lat, r.lng);
        if (d <= IN_ZONE_DIST || d > ALERT_DIST || d >= bestDist) continue;
        if (driverHeading != null && angleDiffDeg(driverHeading, bearingDeg(lat, lng, r.lat, r.lng)) > 45) continue;
        // Suppress if driver is moving away (already passed the report).
        if (prevFix) {
          const prevDist = haversine(prevFix.lat, prevFix.lng, r.lat, r.lng);
          if (prevDist < d) continue;
        }
        best = r;
        bestDist = d;
      }
      return best ? { report: best, dist: bestDist } : null;
    })();

    // (3) Pick winner: closer of zone vs report
    const zoneDist   = zoneCandidate?.distance ?? Infinity;
    const reportDist = reportCandidate?.dist   ?? Infinity;
    const winner: DriveAlert | null =
      zoneDist === Infinity && reportDist === Infinity
        ? null
        : zoneDist <= reportDist
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
          : {
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
            };

    // (4) Dismiss active alert if it has moved out of range, the driver has
    //     turned away (> 75°), or the driver has passed it (2 consecutive fixes
    //     of increasing distance).
    if (alertZoneRef.current && !alertDismissed.current) {
      const curZone   = withDist.find((z) => z.id === alertZoneRef.current);
      const curReport = curZone ? null : communityReportsRef.current.find((r) => r.id === alertZoneRef.current);
      const curItemLat = curZone?.lat ?? curReport?.lat;
      const curItemLng = curZone?.lng ?? curReport?.lng;
      const curDist    = curZone?.distance
        ?? (curItemLat != null && curItemLng != null ? haversine(lat, lng, curItemLat, curItemLng) : null);

      const shouldDismiss = (() => {
        if (curDist == null || curDist > ALERT_DIST) return true;
        // 75° heading threshold — wide enough to absorb GPS heading jitter and
        // road curves, while still dismissing when the driver clearly turns away.
        // Hysteresis: activation requires ≤45°, dismissal triggers at >75°.
        if (driverHeading != null && curItemLat != null && curItemLng != null) {
          if (angleDiffDeg(driverHeading, bearingDeg(lat, lng, curItemLat, curItemLng)) > 75) return true;
        }
        const lastDist = alertZoneLastDistRef.current;
        if (lastDist != null && curDist > lastDist) {
          alertZoneIncreasingCountRef.current += 1;
          if (alertZoneIncreasingCountRef.current >= 2) return true;
        } else {
          alertZoneIncreasingCountRef.current = 0;
        }
        // Always keep the last-distance up to date so the increasing counter
        // only fires when the distance genuinely grows over multiple fixes.
        alertZoneLastDistRef.current = curDist;
        return false;
      })();

      if (shouldDismiss) {
        const dismissedId = alertZoneRef.current!;
        // 60-second cooldown. peakDistM starts at the dismiss distance and is
        // updated upward each GPS tick so the early-cancel check can tell whether
        // the driver has made a genuine detour (built up enough distance) vs jitter.
        alertDismissCooldownRef.current.set(dismissedId, {
          expiry: Date.now() + 60_000,
          peakDistM: curDist ?? 0,
        });
        alertZoneRef.current = null;
        alertSourceRef.current = null;
        alertDismissed.current = false;
        alertZoneLastDistRef.current = null;
        alertZoneIncreasingCountRef.current = 0;
        lastSetAlertRef.current = null;
        setActiveAlert(null);
      }
    }

    // Suppress new overlay popups while the driver is stationary (jitter
    // near a zone while parked should not trigger the panel).
    const isStationary = stationaryStreakRef.current >= 3;

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
        if (alertZoneRef.current === k) alertZoneRef.current = null;
      }
    }

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

      // Activate a new alert (only when not in cooldown).
      if (!alertDismissCooldownRef.current.has(winner.id) && winner.id !== alertZoneRef.current) {
        alertZoneRef.current = winner.id;
        alertSourceRef.current = winner.source;
        alertZoneLastDistRef.current = winner.distance;
        alertZoneIncreasingCountRef.current = 0;
        alertDismissed.current = false;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        if (canSpeakGeneralAlert()) {
          const isClose = winner.distance <= 600;
          if (winner.source === "zone") {
            if (winner.type === "camera") speakGeneralAlert(isClose ? "Speed camera ahead. Reduce your speed." : "Speed camera ahead.");
            else if (winner.type === "police") speakGeneralAlert(isClose ? "Police checkpoint ahead. Reduce your speed." : "Police checkpoint ahead.");
            else {
              // #33: Speak the actual speed limit when entering a zone
              const limit = winner.speedLimit;
              if (limit != null) speakGeneralAlert(`${limit} kilometre per hour zone.`);
              else speakGeneralAlert("Speed zone ahead.");
            }
          } else {
            // #33: Include distance (rounded to nearest 50 m) in community report cues
            const roundedDist = Math.round(winner.distance / 50) * 50;
            const distText = roundedDist >= 1000 ? "one kilometre" : `${roundedDist} metres`;
            const REPORT_TEXT_MAP: Partial<Record<string, string>> = {
              accident:  `Accident in ${distText}.`,
              pothole:   `Pothole in ${distText}.`,
              roadblock: `Road block in ${distText}.`,
              police:    `Police checkpoint in ${distText}.`,
              alcoblow:  `Alcoblow checkpoint in ${distText}.`,
              roadworks: `Road works in ${distText}.`,
              camera:    `Speed camera in ${distText}.`,
              traffic:   `Traffic congestion in ${distText}.`,
              hazard:    `Road hazard in ${distText}.`,
              debris:    `Debris on road, ${distText}.`,
              breakdown: `Vehicle breakdown in ${distText}.`,
              weather:   `Weather hazard in ${distText}.`,
              closure:   `Road closure in ${distText}.`,
            };
            const alertText = REPORT_TEXT_MAP[winner.type];
            if (alertText) speakGeneralAlert(alertText);
          }
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
          setActiveAlert(winner);
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
          alertZoneRef.current = null;
          alertSourceRef.current = null;
          alertDismissed.current = false;
          alertZoneLastDistRef.current = null;
          alertZoneIncreasingCountRef.current = 0;
          lastSetAlertRef.current = null;
          setActiveAlert(null);
        }
      }
    }

    // ── Community report proximity voice alerts (1 km) ──────────────────────
    // Only announce while actually driving (same moving threshold used for
    // trip tracking below) — otherwise a driver parked/at home who merely has
    // the app open with location permission would get spoken alerts for
    // reports near their static position, which is exactly the annoyance we
    // want to avoid. Reports aren't marked as announced while not driving, so
    // they'll still be announced once the driver starts moving near them.
    const REPORT_ANNOUNCE_DIST = 1000;
    for (const report of isDriving ? communityReportsRef.current : []) {
      if (announcedReportsRef.current.has(report.id)) continue;
      if (now - report.timestamp > 7200000) continue; // ignore reports > 2 h old
      const distToReport = haversine(lat, lng, report.lat, report.lng);
      if (distToReport > REPORT_ANNOUNCE_DIST || distToReport <= IN_ZONE_DIST) continue;
      // Only announce when the report is ahead of the driver. If heading is
      // unknown (first fix) we fall back to distance-only and announce anyway.
      // Do NOT add to announcedReportsRef when skipping direction: the driver
      // may later turn toward the report and should hear the announcement then.
      const bearingToReport = bearingDeg(lat, lng, report.lat, report.lng);
      const reportIsAhead = driverHeading == null || angleDiffDeg(driverHeading, bearingToReport) <= 90;
      if (!reportIsAhead) continue;
      announcedReportsRef.current.add(report.id);
      // #33: Include distance (rounded to nearest 50 m) in the spoken cue
      const roundedAnnDist = Math.round(distToReport / 50) * 50;
      const annDistText = roundedAnnDist >= 1000 ? "one kilometre" : `${roundedAnnDist} metres`;
      const REPORT_TEXT: Partial<Record<string, string>> = {
        accident:  `Accident in ${annDistText}.`,
        pothole:   `Pothole in ${annDistText}.`,
        roadblock: `Road block in ${annDistText}.`,
        police:    `Police checkpoint in ${annDistText}.`,
        alcoblow:  `Alcoblow checkpoint in ${annDistText}.`,
        roadworks: `Road works in ${annDistText}.`,
        camera:    `Speed camera in ${annDistText}.`,
        traffic:   `Traffic congestion in ${annDistText}.`,
        hazard:    `Road hazard in ${annDistText}.`,
        debris:    `Debris on road, ${annDistText}.`,
        breakdown: `Vehicle breakdown in ${annDistText}.`,
        weather:   `Weather hazard in ${annDistText}.`,
        closure:   `Road closure in ${annDistText}.`,
      };
      const reportText = REPORT_TEXT[report.type];
      if (reportText && canSpeakGeneralAlert()) {
        speakGeneralAlert(reportText);
      }
    }

    // ── POI destination proximity announcement ───────────────────────────────
    const dest = navDestRef.current;
    if (dest?.poiType && !destAnnouncedRef.current) {
      const distToDest = haversine(lat, lng, dest.lat, dest.lng);
      if (distToDest <= 1500 && distToDest > 50) {
        destAnnouncedRef.current = true;
        const distText = distToDest >= 1000
          ? `${(distToDest / 1000).toFixed(1)} kilometres`
          : `${Math.round(distToDest / 50) * 50} metres`;
        const typeWord =
          dest.poiType === "fuel"      ? "fuel station" :
          dest.poiType === "shopping"  ? "shopping centre" :
          dest.poiType === "hospital"  ? "hospital" :
          dest.poiType === "nightlife" ? "venue" : "restaurant";
        const shortName = dest.name.split(",")[0].trim();
        speakText(`${shortName} ${typeWord} is approximately ${distText} ahead. Prepare to turn.`);
      }
    }

    // Safety net: if a navigation session has been running far longer than
    // the route could realistically take, silently end it instead of
    // continuing to announce turns toward a trip abandoned long ago (e.g.
    // the app stayed alive in the background for hours after the driver
    // gave up or switched away without tapping the in-app "Stop" button).
    if (navActiveRef.current && navStartRef.current && routeRef.current) {
      const maxDurationMs = Math.min(
        Math.max((routeRef.current.durationS ?? 0) * 1000 * 2.5, 45 * 60 * 1000),
        4 * 60 * 60 * 1000,
      );
      if (Date.now() - navStartRef.current > maxDurationMs) {
        stopNavigationRef.current();
      }
    }

    // ── Navigation step tracking ─────────────────────────────────────────────
    if (navActiveRef.current && routeRef.current) {
      const route = routeRef.current;
      const steps = route.steps;
      const idx   = stepIdxRef.current;

      if (idx < steps.length) {
        const step       = steps[idx];
        const isLastStep = idx === steps.length - 1;

        // ── Along-route distance to next maneuver ──────────────────────────
        // Project the driver's GPS fix onto the route polyline and measure
        // distance-along-the-road to the next maneuver point.  This eliminates
        // the "signals early on curves" bug that straight-line haversine caused:
        // a tight bend could read 80 m haversine while 200 m of road remain.
        // Falls back to haversine when cumDist is unavailable (edge case).
        let driverAlongM: number | null = null;
        if (route.cumDist?.length) {
          const prior  = routeProjIdxRef.current;
          const wStart = Math.max(0, prior - 5);
          const wEnd   = Math.min(route.coords.length - 1, prior + 40);
          const proj   = projectOntoRoute(route.coords, route.cumDist, lat, lng, wStart, wEnd)
                      ?? projectOntoRoute(route.coords, route.cumDist, lat, lng);
          if (proj) routeProjIdxRef.current = proj.matchedIdx;
          driverAlongM = proj?.alongRouteM ?? null;
        }
        const dist = driverAlongM != null
          ? Math.max(0, step.stepAlongRouteM - driverAlongM)
          : haversine(lat, lng, step.location.latitude, step.location.longitude);

        setDistToNextM(Math.round(dist));

        const key     = `step_${idx}`;
        const nearKey = `step_${idx}_near`;
        const nowKey  = `step_${idx}_now`;

        const { announceM, remindM, nowM, distWord } = stepTriggers(kmh, dist);

        // ── Compound instruction ───────────────────────────────────────────
        // When the next maneuver is < 100 m after this one (tight chicanes,
        // compact junctions), fold both into a single spoken instruction so
        // the driver has the full picture before committing to the first turn.
        const nextStep      = idx + 1 < steps.length ? steps[idx + 1] : null;
        const useCompound   = !isLastStep
          && nextStep != null
          && step.distanceM > 0
          && step.distanceM < 100
          && nextStep.maneuverType !== "arrive";
        const remindText    = useCompound && nextStep
          ? `${step.instruction}, then ${maneuverOnly(nextStep.instruction).toLowerCase()}`
          : step.instruction;
        const announceText  = useCompound && nextStep
          ? `${step.instruction}, then ${nextStep.instruction.charAt(0).toLowerCase() + nextStep.instruction.slice(1)}`
          : step.instruction;

        if (isDriving && dist < announceM
            && lastSpokenRef.current !== key
            && lastSpokenRef.current !== nearKey
            && lastSpokenRef.current !== nowKey
            && Date.now() - lastAnnounceCueAtRef.current > MIN_NAV_ANNOUNCE_GAP_MS) {
          // ── Cue 1: Announce — "In 300 metres, turn left onto Ngong Road" ──
          // distWord is pre-compensated: it reflects where the driver will BE
          // when they hear the distance word, not where they were when we fired.
          // Gated on isDriving: if the driver is stopped (red light, traffic jam)
          // we skip the cue WITHOUT advancing lastSpokenRef — so it fires
          // automatically the moment they start moving again.
          lastAnnounceCueAtRef.current = Date.now();
          lastSpokenRef.current = key;
          speakText(distWord + announceText);
          // Protect the clip chain (~5–6 s) from supplementary hazard alerts.
          const protect6s = Date.now() - (GENERAL_ALERT_COOLDOWN_MS - 6000);
          if (lastGeneralAlertAtRef.current < protect6s) lastGeneralAlertAtRef.current = protect6s;

        } else if (isDriving && !isLastStep && dist < remindM
            && lastSpokenRef.current === key
            && !isNavVoicePlaying()) {
          // ── Cue 2: Remind — "Turn left onto Ngong Road" ────────────────────
          // Gated on !isNavVoicePlaying() so we never interrupt the ANNOUNCE
          // clip mid-sentence.  If Cue 1 is still playing we wait for the next
          // GPS tick (≈ 1 s) — by then the clip will have finished naturally.
          lastSpokenRef.current = nearKey;
          speakText(remindText);
          const protect4s = Date.now() - (GENERAL_ALERT_COOLDOWN_MS - 4000);
          if (lastGeneralAlertAtRef.current < protect4s) lastGeneralAlertAtRef.current = protect4s;

        } else if (isDriving && !isLastStep && dist < nowM && lastSpokenRef.current === nearKey) {
          // ── Cue 3: Now — "Turn left" ───────────────────────────────────────
          // Driver is at the junction. Maneuver word only — no distance, no road
          // name. Allowed to preempt a still-playing REMIND clip because the
          // driver is physically at the turn and needs the instruction now.
          lastSpokenRef.current = nowKey;
          speakText(maneuverOnly(step.instruction));
          const protect2s = Date.now() - (GENERAL_ALERT_COOLDOWN_MS - 2000);
          if (lastGeneralAlertAtRef.current < protect2s) lastGeneralAlertAtRef.current = protect2s;
        }

        // The final step gets a wider arrival radius than intermediate turns:
        // urban GPS drift in dense areas can easily bias a fix by 30-40 m.
        const dest = navDestRef.current;
        const distToDest = dest ? haversine(lat, lng, dest.lat, dest.lng) : dist;

        // One-shot "approaching your destination" cue
        if (isLastStep && !approachingAnnouncedRef.current
            && distToDest < APPROACHING_DIST && distToDest >= ARRIVAL_DIST) {
          approachingAnnouncedRef.current = true;
          speakText("Approaching your destination");
        }

        const arrived = isLastStep
          ? (dist < ARRIVAL_DIST || distToDest < ARRIVAL_DIST)
          : dist < STEP_ADVANCE_DIST;

        if (arrived) {
          const nextIdx = idx + 1;
          stepIdxRef.current = nextIdx;
          setCurrentStepIdx(nextIdx);

          if (nextIdx >= steps.length) {
            speakText("You have arrived at your destination.");
            navActiveRef.current = false;
            navStartRef.current = null;
            approachingAnnouncedRef.current = false;
            setNavigationActive(false);
            const trip = tripRef.current;
            setArrivedInfo({
              destName: navDestRef.current?.name.split(",")[0] ?? "your destination",
              distM: trip?.distance ?? routeRef.current?.distanceM ?? 0,
              durationS: Math.round((Date.now() - (trip?.startTime ?? Date.now())) / 1000),
              maxSpeedKmh: trip?.maxSpeed ?? 0,
              alertsCount: trip?.alertsCount ?? 0,
            });
            if (deviceIdRef.current) {
              apiPost("/push/trip-complete", { deviceId: deviceIdRef.current }).catch(() => {});
            }
          } else {
            // ── Post-turn confirmation ───────────────────────────────────────
            // After completing a maneuver, confirm the driver is on the right
            // road: "Continue on Ngong Road."  Then go silent until the next
            // decision point approaches.
            // Only fires when the next leg is long enough (≥ 250 m) — short legs
            // will immediately trigger an ANNOUNCE cue for the next turn and a
            // confirmation would stack on top.  Also skipped when voice is still
            // playing (the NOW clip may still be in progress at the exact moment
            // of step advance), and when the road is unnamed.
            const confirmedStep = steps[nextIdx];
            if (!isNavVoicePlaying()
                && confirmedStep.roadName
                && confirmedStep.distanceM >= 250
                && confirmedStep.maneuverType !== "arrive") {
              speakText(`Continue on ${confirmedStep.roadName}`);
            }
          }
        }
      }
    }

    // ── Off-route detection → auto-reroute ───────────────────────────────────
    // Scan a window of route coords around the last projected index.  If the
    // driver is > 50 m from the nearest point for 3 consecutive fixes, the
    // reroute callback fetches a fresh route from the current position.
    // Suppressed during dead reckoning and during the post-reroute grace period
    // (10 s) to prevent the reroute-loop at complex junctions where GPS jitter
    // can immediately re-trigger another reroute before the new route settles.
    if (navActiveRef.current && routeRef.current && !gpsLostRef.current
        && Date.now() > rerouteGraceUntilRef.current) {
      const coords  = routeRef.current.coords;
      const prior   = Math.max(0, Math.min(routeProjIdxRef.current, coords.length - 1));
      const wStart  = Math.max(0, prior - 10);
      const wEnd    = Math.min(coords.length - 1, prior + 30);
      let minOff    = Infinity;
      for (let i = wStart; i <= wEnd; i++) {
        const d = haversine(lat, lng, coords[i].latitude, coords[i].longitude);
        if (d < minOff) minOff = d;
      }
      if (minOff > 50) {
        offRouteCountRef.current += 1;
        if (offRouteCountRef.current >= 3 && !isReroutingRef.current) {
          offRouteCountRef.current = 0;
          // Suppress off-route for 10 s after triggering a reroute so GPS
          // jitter at complex junctions doesn't immediately loop back here.
          rerouteGraceUntilRef.current = Date.now() + 10_000;
          speakText("Rerouting.");
          lastAnnounceCueAtRef.current = Date.now();
          triggerRerouteRef.current?.(lat, lng);
        }
      } else {
        offRouteCountRef.current = 0;
      }
    }

    // Trip tracking
    if (kmh > 5) {
      if (stopTimer.current) { clearTimeout(stopTimer.current); stopTimer.current = null; }
      if (!tripRef.current) {
        const t: Partial<TripData> = { id: genId(), startTime: Date.now(), distance: 0, maxSpeed: kmh, avgSpeed: kmh, alertsCount: 0, positions: [{ lat, lng, speed: kmh, time: Date.now() }] };
        tripRef.current = t;
        setCurrentTrip({ ...t });
      } else {
        const t = tripRef.current;
        const positions = t.positions ?? [];
        const last = positions[positions.length - 1];
        const added = last ? haversine(last.lat, last.lng, lat, lng) : 0;
        const newPos = [...positions, { lat, lng, speed: kmh, time: Date.now() }];
        const trimmed = newPos.length > 300 ? newPos.slice(-150) : newPos;
        const updated: Partial<TripData> = { ...t, distance: (t.distance ?? 0) + added, maxSpeed: Math.max(t.maxSpeed ?? 0, kmh), avgSpeed: trimmed.reduce((s, p) => s + p.speed, 0) / trimmed.length, positions: trimmed };
        tripRef.current = updated;
        setCurrentTrip({ ...updated });
      }
    } else if (tripRef.current) {
      if (!stopTimer.current) {
        stopTimer.current = setTimeout(() => {
          const t = tripRef.current;
          if (t && (t.distance ?? 0) >= MIN_TRIP_DIST) {
            const done: TripData = { id: t.id ?? genId(), startTime: t.startTime ?? Date.now(), endTime: Date.now(), distance: t.distance ?? 0, maxSpeed: t.maxSpeed ?? 0, avgSpeed: t.avgSpeed ?? 0, alertsCount: t.alertsCount ?? 0, positions: t.positions ?? [] };
            setTripHistory((prev) => { const u = [done, ...prev].slice(0, 50); AsyncStorage.setItem(KEYS.TRIPS, JSON.stringify(u)); return u; });
          }
          tripRef.current = null; setCurrentTrip(null); stopTimer.current = null;
        }, STOP_TIMEOUT_MS);
      }
    }
  }, []);

  // ── GPS watch ─────────────────────────────────────────────────────────────
  // Some devices/OS versions silently pause `watchPositionAsync` after the
  // first fix (e.g. iOS throttling high-accuracy updates without background
  // location entitlements, or the screen dimming during a drive). A watchdog
  // below detects a stalled subscription and transparently resubscribes so
  // position/speed/turn-instructions keep advancing instead of freezing.
  useEffect(() => {
    if (!locationGranted) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let liveSub: { remove: () => void } | null = null;

    const teardown = () => {
      liveSub?.remove();
      liveSub = null;
    };

    const subscribe = async () => {
      if (cancelled) return;
      teardown();
      // Reset the freshness baseline on every (re)subscribe attempt so the
      // watchdog also catches a subscription that never delivers a fix.
      lastLocationAtRef.current = Date.now();
      try {
        if (Platform.OS !== "web") {
          const sub = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.Highest, timeInterval: 1000, distanceInterval: 10 },
            (loc) => {
              lastLocationAtRef.current = Date.now();
              handleLocation(loc.coords.latitude, loc.coords.longitude, loc.coords.speed, loc.coords.accuracy);
            }
          );
          if (cancelled) { sub.remove(); return; }
          liveSub = sub;
        } else if ("geolocation" in navigator) {
          const id = navigator.geolocation.watchPosition(
            (pos) => {
              lastLocationAtRef.current = Date.now();
              handleLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.speed, pos.coords.accuracy);
            },
            (err) => console.warn("Geo:", err),
            { enableHighAccuracy: true }
          );
          liveSub = { remove: () => navigator.geolocation.clearWatch(id) };
        }
      } catch (e) {
        console.warn("Location watch failed to start, retrying:", e);
        if (!cancelled) retryTimer = setTimeout(subscribe, 4000);
      }
    };

    subscribe();

    const watchdog = setInterval(() => {
      if (cancelled) return;
      if (Date.now() - lastLocationAtRef.current > 8000) {
        console.warn("GPS watch stalled — resubscribing");
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

  // ── Dead reckoning interval ────────────────────────────────────────────────
  // Polls every second while the GPS subscription is active. When navigation
  // is running and real fixes stop arriving for >5 s, this detects the gap,
  // sets gpsLost, and projects the driver's position forward along the last
  // known heading at the last known speed — for up to 15 s before freezing.
  // This keeps distanceRemainingM / durationRemainingS counting down smoothly
  // during short signal outages (tunnels, underpasses, parking structures).
  useEffect(() => {
    if (!locationGranted) return;
    const id = setInterval(() => {
      if (!navActiveRef.current) return;
      const now = Date.now();
      const sinceLastFix = now - lastNavFixAtRef.current;

      // Detect signal loss (first time only — don't keep re-setting state)
      if (sinceLastFix > 5000 && !gpsLostRef.current) {
        gpsLostRef.current = true;
        gpsLostSinceRef.current = now;
        setGpsLost(true);
      }

      if (!gpsLostRef.current) return;

      // Freeze after 15 s — dead reckoning error compounds too quickly beyond that
      const lostFor = now - (gpsLostSinceRef.current ?? now);
      if (lostFor > 15000) return;

      const dr = drStateRef.current;
      if (!dr || dr.speedMps < 0.5 || lastHeadingRef.current == null) return;

      // Project one second of travel in the last known heading direction.
      // Simple flat-earth formula — accurate to <0.1 m error per 1 s step.
      const distM      = dr.speedMps; // metres in 1 second
      const headingRad = (dr.heading * Math.PI) / 180;
      const newLat     = dr.lat + (distM * Math.cos(headingRad)) / 111320;
      const newLng     = dr.lng + (distM * Math.sin(headingRad)) / (111320 * Math.cos(dr.lat * Math.PI / 180));

      // Push the projected position into React state so currentRouteDistanceM
      // (and therefore distanceRemainingM / durationRemainingS) keep updating.
      setCurrentLat(newLat);
      setCurrentLng(newLng);
      drStateRef.current = { ...dr, lat: newLat, lng: newLng };
    }, 1000);
    return () => clearInterval(id);
  }, [locationGranted]);

  // Keep the screen awake while actively navigating so the OS doesn't dim/
  // lock the display and throttle GPS callbacks mid-trip.
  useEffect(() => {
    if (!navigationActive) return;
    activateKeepAwakeAsync("msafiri-navigation").catch(() => {});
    return () => { deactivateKeepAwake("msafiri-navigation").catch(() => {}); };
  }, [navigationActive]);

  // ── Route fetching ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!navDestination || !currentLat || !currentLng) return;
    let cancelled = false;
    setRouteLoading(true);
    setActiveRoute(null);
    setAltRoutes([]);
    setZonesOnRoute([]);
    routeRef.current = null;
    stepIdxRef.current = 0;
    setCurrentStepIdx(0);
    routeProjIdxRef.current = 0;

    fetchGoogleRoute(currentLat, currentLng, navDestination.lat, navDestination.lng)
      .then((routes) => {
        if (cancelled || !routes.length) return;
        const [primary, ...alts] = routes;
        setActiveRoute(primary);
        routeRef.current = primary;
        setAltRoutes(alts);
        const vehicle = getVehicleTypeDef(vehicleTypeRef.current);
        setZonesOnRoute(getZonesOnRoute(primary, allZonesRef.current).map((z) => ({ ...z, speedLimit: capSpeedLimit(z.speedLimit, vehicle) })));
        // Pre-warm road-name audio for every step so first-play latency is zero.
        prewarmRouteAudio(primary.steps);
      })
      .catch((e) => { if (!cancelled) console.warn("Routing:", e); })
      .finally(() => { if (!cancelled) setRouteLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navDestination?.lat, navDestination?.lng]);

  // ── Auto-reroute callback ─────────────────────────────────────────────────
  // handleLocation fires this when the driver is consistently off-route.
  // Fetches a fresh OSRM route from the current position and replaces the
  // active route in-place, resetting the step index transparently.
  useEffect(() => {
    triggerRerouteRef.current = (lat: number, lng: number) => {
      if (!navDestRef.current || isReroutingRef.current) return;
      const dest = navDestRef.current;
      isReroutingRef.current = true;
      setRouteLoading(true);
      // Immediately play the bundled "Recalculating route." token so the driver
      // hears Keli's voice the instant rerouting is triggered — before the new
      // OSRM route has even arrived.
      speakText("Recalculating route.");
      fetchGoogleRoute(lat, lng, dest.lat, dest.lng)
        .then((routes) => {
          if (!routes.length) return;
          const [primary, ...alts] = routes;
          setActiveRoute(primary);
          routeRef.current = primary;
          stepIdxRef.current = 0;
          setCurrentStepIdx(0);
          routeProjIdxRef.current = 0;
          lastSpokenRef.current = "";
          approachingAnnouncedRef.current = false;
          setAltRoutes(alts);
          const vehicle = getVehicleTypeDef(vehicleTypeRef.current);
          setZonesOnRoute(
            getZonesOnRoute(primary, allZonesRef.current).map((z) => ({
              ...z, speedLimit: capSpeedLimit(z.speedLimit, vehicle),
            }))
          );
          // Pre-warm road-name segments for the new route.
          prewarmRouteAudio(primary.steps);
          // Pre-build full-sentence clips — first steps are fetched first so
          // the driver hears Keli seamlessly as soon as the new route settles.
          // Fire-and-forget; any step that isn't ready yet falls back to the
          // bundled-token-only path (maneuver without road name) — still Keli.
          void prebuildRouteAudio(primary.steps);
        })
        .catch((e) => console.warn("[reroute] Routing:", e))
        .finally(() => { setRouteLoading(false); isReroutingRef.current = false; });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync isOffline to a ref so callbacks can read it without re-rendering
  useEffect(() => { isOfflineRef.current = isOffline; }, [isOffline]);

  // Keep the poll-location ref fresh (used by the 60s polling effect)
  useEffect(() => {
    if (currentLat != null && currentLng != null) {
      pollLocationRef.current = { lat: currentLat, lng: currentLng };
    }
  }, [currentLat, currentLng]);

  // Remote report polling — fetch all active reports every 60 s when online.
  // No radius filter: show every incident on the map regardless of location.
  useEffect(() => {
    if (!locationGranted) return;
    const poll = async () => {
      if (isOfflineRef.current || !deviceIdRef.current) return;
      try {
        const data = await apiGet<{ reports: Array<{
          id: string; type: string; lat: number; lng: number;
          status: string; confirmCount: number; denyCount: number;
          createdAt: number; expiresAt: number | null;
          speedLimit: number | null; roadName: string | null; adminVerified: boolean;
        }> }>(`/reports`);
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
        }));
        // #32: Detect reports that vanished (expired / denied) while the driver
        // is navigating and the report was within the alert window.
        if (navActiveRef.current && prevPollServerIdsRef.current.size > 0) {
          const newIds = new Set(remote.map((r) => r.id));
          const loc = pollLocationRef.current;
          for (const prev of communityReportsRef.current) {
            if (!prev.serverId) continue;
            if (newIds.has(prev.serverId)) continue; // still active on server
            if (!announcedReportsRef.current.has(prev.id)) continue; // not spoken to driver
            if (!loc) continue;
            const dist = haversine(loc.lat, loc.lng, prev.lat, prev.lng);
            // Only if report is still ahead (not yet passed, not too far)
            if (dist < IN_ZONE_DIST || dist > ALERT_DIST * 3) continue;
            const CLEARED_TEXT: Partial<Record<string, string>> = {
              police:    "Police checkpoint cleared.",
              alcoblow:  "Checkpoint cleared.",
              accident:  "Accident cleared.",
              roadblock: "Road block cleared.",
              roadworks: "Road works cleared.",
              hazard:    "Hazard cleared.",
              pothole:   "Hazard cleared.",
              camera:    "Speed camera report cleared.",
              traffic:   "Traffic cleared.",
              debris:    "Hazard cleared.",
              breakdown: "Incident cleared.",
              weather:   "Hazard cleared.",
              closure:   "Road closure cleared.",
            };
            speakText(CLEARED_TEXT[prev.type] ?? "Incident ahead cleared.");
            break; // one cue per poll cycle
          }
        }
        prevPollServerIdsRef.current = new Set(remote.map((r) => r.id));

        setCommunityReports((prev) => {
          const owned = prev.filter((r) => r.isOwn);
          const remoteNew = remote.filter((rem) => !owned.some((o) => o.serverId === rem.id));
          const ownedUpdated = owned.map((o) => {
            const match = remote.find((r) => r.id === o.serverId);
            return match
              ? { ...o, status: match.status, confirmCount: match.confirmCount, denyCount: match.denyCount, adminVerified: match.adminVerified }
              : o;
          });
          return [...ownedUpdated, ...remoteNew].filter(
            (r) => r.status !== "expired" && r.status !== "denied"
          );
        });
      } catch { /* network error — keep local copy */ }
    };
    poll(); // immediate on mount
    const handle = setInterval(poll, 60000);
    return () => clearInterval(handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationGranted]);

  // Admin-managed speed zones — fetch ALL DB zones every 5 min when online,
  // merged with the built-in static list (see allZones below).
  // No radius filter: show every camera and zone on the map regardless of location.
  useEffect(() => {
    if (!locationGranted) return;
    const poll = async () => {
      if (isOfflineRef.current) return;
      try {
        const data = await apiGet<{ zones: ApiSpeedZone[]; suppressedStaticIds?: string[] }>(`/speed-zones`);
        setDbZones(data.zones.flatMap(apiZoneToStaticZones));
        setDbStretches(data.zones.map(apiZoneToStretch).filter((s): s is SpeedStretch => s !== null));
        setSuppressedStaticIds(data.suppressedStaticIds ?? []);
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
    return dbZones.length ? [...filtered, ...dbZones] : filtered;
  }, [dbZones, suppressedStaticIds]);
  useEffect(() => { allZonesRef.current = allZones; }, [allZones]);
  useEffect(() => { dbStretchesRef.current = dbStretches; }, [dbStretches]);

  // ── Route incidents (unified static zones + community reports along the route) ─
  const routeCumDist = useMemo(
    () => (activeRoute ? buildCumulativeDistances(activeRoute.coords) : null),
    [activeRoute]
  );

  const routeIncidents = useMemo<RouteIncident[]>(() => {
    if (!activeRoute || !routeCumDist) return [];
    const vehicle = getVehicleTypeDef(vehicleType);
    const list: RouteIncident[] = [];
    for (const z of allZones) {
      const proj = projectOntoRoute(activeRoute.coords, routeCumDist, z.lat, z.lng);
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
          confirmCount: r.confirmCount,
          timestamp: r.timestamp,
        });
      }
    }
    return list.sort((a, b) => a.distanceAlongRouteM - b.distanceAlongRouteM);
  }, [activeRoute, routeCumDist, communityReports, vehicleType, allZones]);

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
    if (proj) routeProjIdxRef.current = proj.matchedIdx;
    return proj ? proj.alongRouteM : null;
  }, [activeRoute, routeCumDist, currentLat, currentLng]);

  const routeIncidentsAhead = useMemo(() => {
    const withAhead = (list: RouteIncident[]) =>
      list.map((inc) => ({
        ...inc,
        aheadDistanceM: Math.max(0, inc.distanceAlongRouteM - (currentRouteDistanceM ?? 0)),
      }));
    if (!navigationActive || currentRouteDistanceM == null) return withAhead(routeIncidents);
    // Only keep incidents that are still ahead of the driver. A 15 m rearward
    // tolerance absorbs GPS jitter at the exact crossing point without keeping
    // an already-passed camera visible in the "ahead" list for tens of seconds.
    return withAhead(
      routeIncidents.filter((inc) => inc.distanceAlongRouteM >= currentRouteDistanceM - 15)
    );
  }, [routeIncidents, navigationActive, currentRouteDistanceM]);

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
    const routes = await fetchGoogleRoute(lat, lng, destLat, destLng);
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
    if (!activeRoute) return null;
    if (currentRouteDistanceM == null) return activeRoute.distanceM;
    return Math.max(0, activeRoute.distanceM - currentRouteDistanceM);
  }, [activeRoute, currentRouteDistanceM]);

  const durationRemainingS = useMemo(() => {
    if (!activeRoute || distanceRemainingM == null) return null;
    const totalWithDelay = activeRoute.durationS + routeTrafficDelayS;
    if (activeRoute.distanceM <= 0) return totalWithDelay;
    return Math.round((distanceRemainingM / activeRoute.distanceM) * totalWithDelay);
  }, [activeRoute, distanceRemainingM, routeTrafficDelayS]);
  // Keep refs in sync so the share-trip ping interval always reads fresh values
  useEffect(() => { durationRemainingRef.current = durationRemainingS; }, [durationRemainingS]);
  useEffect(() => { distanceRemainingRef.current = distanceRemainingM; }, [distanceRemainingM]);

  // ── Navigation actions ────────────────────────────────────────────────────
  const setNavDestination = useCallback((d: NavDestination | null) => {
    setNavDestState(d);
    navDestRef.current = d;
    destAnnouncedRef.current = false;
    approachingAnnouncedRef.current = false;
    offRouteCountRef.current = 0;
    if (!d) {
      setActiveRoute(null);
      setAltRoutes([]);
      setZonesOnRoute([]);
      routeRef.current = null;
      setRouteIncidentsExpanded(false);
    }
    setNavigationActive(false);
    navActiveRef.current = false;
    navStartRef.current = null;
    stepIdxRef.current = 0;
    setCurrentStepIdx(0);
    lastSpokenRef.current = "";
    setDistToNextM(null);
  }, []);

  const selectRoute = useCallback((r: AppRoute) => {
    setAltRoutes((prev) => {
      const others = (activeRoute ? [activeRoute, ...prev] : prev).filter((x) => x.id !== r.id);
      return others;
    });
    setActiveRoute(r);
    routeRef.current = r;
    const vehicle = getVehicleTypeDef(vehicleTypeRef.current);
    setZonesOnRoute(getZonesOnRoute(r, allZonesRef.current).map((z) => ({ ...z, speedLimit: capSpeedLimit(z.speedLimit, vehicle) })));
    stepIdxRef.current = 0;
    setCurrentStepIdx(0);
    lastSpokenRef.current = "";
    setDistToNextM(null);
    routeProjIdxRef.current = 0;
    // Pre-warm road-name audio for the selected route (cancels any prior prewarm).
    prewarmRouteAudio(r.steps);
  }, [activeRoute]);

  // ── Trip sharing ─────────────────────────────────────────────────────────────

  const stopSharingTrip = useCallback(async () => {
    if (sharePingIntervalRef.current) {
      clearInterval(sharePingIntervalRef.current);
      sharePingIntervalRef.current = null;
    }
    // Also stop any active background location task
    void stopBackgroundShareTask();
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
          if (distToNextMRef.current != null) pingBody.distToNextM = distToNextMRef.current;
          const route = routeRef.current;
          const stepIdx = stepIdxRef.current;
          if (route?.steps[stepIdx]?.instruction) pingBody.nextInstruction = route.steps[stepIdx].instruction;
          if (navDestRef.current?.name) pingBody.destinationName = navDestRef.current.name.split(",")[0];
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
      void requestBackgroundLocationPermission();
      return `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}/live/${code}`;
    } catch (e) {
      console.warn("startSharingTrip failed:", e);
      return null;
    }
  }, []);

  const startNavigation = useCallback(async () => {
    if (!activeRoute) return;

    // ── Phase 2: Pre-build full-sentence Keli clips before starting ─────────
    // Fetches each step's instruction as ONE complete MP3 so REMIND cues play
    // as a single seamless clip rather than a stitched token + road-name pair.
    // Cap at 8 s so a slow connection doesn't block the driver indefinitely;
    // any un-fetched instructions fall back to the token+segment path at drive time.
    setVoicePreparing(true);
    try {
      await Promise.race([
        prebuildRouteAudio(activeRoute.steps),
        new Promise<void>(r => setTimeout(r, 8000)),
      ]);
    } catch { /* ignore */ }
    setVoicePreparing(false);

    // If the user tapped Cancel during prebuild (route was cleared), abort.
    if (!routeRef.current) return;

    stepIdxRef.current = 0;
    setCurrentStepIdx(0);
    lastSpokenRef.current = "";
    routeProjIdxRef.current = 0;
    navActiveRef.current = true;
    navStartRef.current = Date.now();
    setNavigationActive(true);
    // Start the iOS background location task so GPS keeps flowing when the
    // driver locks the screen. Fire-and-forget — failure is non-fatal (the
    // foreground watcher still works; the bg task just adds resilience).
    void startBackgroundNavTask();
    // Advance the session generation so any timer from a previous session
    // (rapid stop → start scenario) knows it is stale.
    const mySession = ++navSessionGenRef.current;
    // Cancel any leftover opening-cue timer from a previous session.
    if (openingCueTimerRef.current != null) {
      clearTimeout(openingCueTimerRef.current);
      openingCueTimerRef.current = null;
    }

    speakText("Navigation started.");
    // Protect "Navigation started." from being cut off by the first GPS tick,
    // which would otherwise see lastSpokenRef="" and immediately fire ANNOUNCE.
    lastAnnounceCueAtRef.current = Date.now();
    const firstInstruction = activeRoute.steps[0]?.instruction;
    if (firstInstruction) {
      // Fire the opening step cue ~2.2 s after "Navigation started." finishes.
      // Guard against three races:
      //   (a) User tapped Stop within 2.2 s — navActiveRef will be false.
      //   (b) User tapped Stop then Start again within 2.2 s — navSessionGenRef
      //       will have advanced past mySession so the stale callback bails.
      //   (c) Driver was already within STEP_ANNOUNCE_DIST of step 0 when they
      //       tapped Start, so the GPS handler announced it first and set
      //       lastSpokenRef to "step_0".  A second call would cut in mid-clip.
      openingCueTimerRef.current = setTimeout(() => {
        openingCueTimerRef.current = null;
        if (navActiveRef.current &&
            navSessionGenRef.current === mySession &&
            !lastSpokenRef.current) {
          speakText(firstInstruction);
        }
      }, 2200);
    }
  }, [activeRoute]);

  const stopNavigation = useCallback(() => {
    // Silence the voice guide first and foremost — everything else is state
    // cleanup. Stop TTS (with a trailing follow-up to catch any narrowly-missed
    // utterance that slipped through on some Android TTS engines).
    stopVoice();
    // Abandon any in-flight prewarm/prebuild fetches for the route being discarded.
    cancelPrewarm();
    // Clear the "Preparing voice guidance" spinner if the user cancelled mid-prebuild.
    setVoicePreparing(false);

    // Cancel any pending opening-cue timer so it cannot fire in a subsequent
    // session (e.g. driver stops then immediately starts a new route within 2.2 s).
    if (openingCueTimerRef.current != null) {
      clearTimeout(openingCueTimerRef.current);
      openingCueTimerRef.current = null;
    }
    navSessionGenRef.current++;

    navActiveRef.current = false;
    navStartRef.current = null;
    setNavigationActive(false);
    // Stop the background nav task — no longer needed once navigation ends.
    void stopBackgroundNavTask();
    setDistToNextM(null);
    setNavDestState(null);
    navDestRef.current = null;
    destAnnouncedRef.current = false;
    setActiveRoute(null);
    setAltRoutes([]);
    setZonesOnRoute([]);
    routeRef.current = null;
    stepIdxRef.current = 0;
    setCurrentStepIdx(0);
    lastSpokenRef.current = "";
    routeProjIdxRef.current = 0;
    setRouteIncidentsExpanded(false);
    // Stop any active trip-sharing session when navigation ends
    if (sharePingIntervalRef.current) {
      clearInterval(sharePingIntervalRef.current);
      sharePingIntervalRef.current = null;
    }
    void stopBackgroundShareTask();
    const _tok = shareTokenRef.current;
    shareTokenRef.current = null;
    setShareToken(null);
    setShareCode(null);
    void AsyncStorage.removeItem(KEYS.SHARE);
    if (_tok && deviceIdRef.current) {
      apiDelete(`/share/${_tok}`, { deviceId: deviceIdRef.current }).catch(() => {});
    }
  }, []);

  // Let handleLocation (defined earlier as a stable, empty-deps useCallback)
  // reach the latest stopNavigation without needing it as a dependency.
  useEffect(() => {
    stopNavigationRef.current = stopNavigation;
  }, [stopNavigation]);

  // ── Background nav: keep GPS flowing when the screen is locked (iOS) ────────
  // When navigation is active and the driver backgrounds the app (locks screen,
  // switches away), iOS throttles watchPositionAsync. The TaskManager background
  // location task keeps the OS location engine alive so fixes keep arriving.
  // We mirror the share-task pattern: start on background, stop on foreground.
  useEffect(() => {
    if (Platform.OS !== "ios") return;

    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (!navActiveRef.current) return;
      if (nextState === "background" || nextState === "inactive") {
        void startBackgroundNavTask();
      } else if (nextState === "active") {
        void stopBackgroundNavTask();
      }
    };

    const sub = AppState.addEventListener("change", handleAppStateChange);
    return () => sub.remove();
  // navActiveRef is a ref — stable across renders, no dep needed
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const isSharing = shareTokenRef.current != null;
      if (!isSharing) return;

      if (nextState === "background" || nextState === "inactive") {
        // App leaving foreground — hand off location pings to the bg task.
        // First ensure we have "always" / background location permission;
        // if the driver hasn't granted it yet, silently request it now
        // (the OS shows the prompt; if denied we skip the bg task and the
        // foreground interval resumes the moment they return to the app).
        await requestBackgroundLocationPermission();
        void startBackgroundShareTask();
      } else if (nextState === "active") {
        // App returned to foreground — foreground interval resumes, so the
        // background task is no longer needed.
        void stopBackgroundShareTask();
      }
    };

    const sub = AppState.addEventListener("change", handleAppStateChange);
    return () => sub.remove();
  // shareTokenRef is a ref — stable; no deps needed beyond mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearArrival = useCallback(() => { setArrivedInfo(null); setRouteIncidentsExpanded(false); }, []);




  // ── Other actions ─────────────────────────────────────────────────────────
  const dismissAlert = useCallback(() => {
    alertDismissed.current = true;
    lastSetAlertRef.current = null;
    setActiveAlert(null);
  }, []);
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

  const clearAllData = useCallback(async () => {
    await AsyncStorage.multiRemove([
      KEYS.TRIPS, KEYS.REPORTS, KEYS.HUD, KEYS.SOS,
      KEYS.ONBOARDING, KEYS.DEVICE_ID, KEYS.THEME, KEYS.VEHICLE_TYPE,
    ]);
    setTripHistory([]);
    setCommunityReports([]);
    setHudModeState(false);
    setSosContactState(null);
    setThemeOverrideState("system");
    setVehicleTypeState(DEFAULT_VEHICLE_TYPE);
    vehicleTypeRef.current = DEFAULT_VEHICLE_TYPE;
    if (Platform.OS !== "web") Appearance.setColorScheme(null);
    const newId = genId() + genId();
    await AsyncStorage.setItem(KEYS.DEVICE_ID, newId);
    deviceIdRef.current = newId;
    setDeviceId(newId);
  }, []);
  const setSosContact = useCallback((c: SOSContact | null) => { setSosContactState(c); c ? AsyncStorage.setItem(KEYS.SOS, JSON.stringify(c)) : AsyncStorage.removeItem(KEYS.SOS); }, []);
  // Posts a locally-created (not-yet-synced) report to the API. Shared by
  // addReport's initial attempt and the reconnect-triggered retry sweep below.
  const syncReportToServer = useCallback((localId: string, type: CommunityReport["type"], lat: number, lng: number, speedLimit?: number) => {
    apiPost<{ id: string; status: string; confirmCount: number; action: string; clearedCount?: number }>(
      "/reports", { type, lat, lng, deviceId: deviceIdRef.current, speedLimit }
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
              ? { ...rep, serverId: result.id, status: result.status as CommunityReport["status"], confirmCount: result.confirmCount }
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

  const addReport = useCallback((type: CommunityReport["type"], lat: number, lng: number, speedLimit?: number) => {
    const localId = genId();
    const r: CommunityReport = {
      id: localId, type, lat, lng, timestamp: Date.now(), confirmed: 1,
      status: "active", confirmCount: 1, denyCount: 0, isOwn: true,
      speedLimit,
    };
    setCommunityReports((prev) => { const u = [r, ...prev]; AsyncStorage.setItem(KEYS.REPORTS, JSON.stringify(u)); return u; });
    if (tripRef.current) tripRef.current.alertsCount = (tripRef.current.alertsCount ?? 0) + 1;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    speakText("Report submitted.");
    // Submit to API; keep local copy as offline fallback (retried on reconnect)
    if (!isOfflineRef.current && deviceIdRef.current) {
      syncReportToServer(localId, type, lat, lng, speedLimit);
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
    // Track that this device has voted on this report
    votedReportIdsRef.current.add(id);
    if (report.serverId) votedReportIdsRef.current.add(report.serverId);
    // Optimistic: increment denyCount — report stays visible until we hear back
    // from the server (which may remove it or queue it for admin review).
    const originalDenyCount = report.denyCount ?? 0;
    setCommunityReports((prev) =>
      prev.map((r) =>
        r.id === id || r.serverId === id ? { ...r, denyCount: originalDenyCount + 1 } : r
      )
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const result = await apiPost<{ denyCount: number; status: string }>(
        `/reports/${serverId}/deny`,
        { deviceId: deviceIdRef.current }
      );
      if (result.status === "denied") {
        // Non-camera report hit the deny threshold — remove it from the local map
        // immediately so the driver sees a clean map without waiting for the next poll.
        setCommunityReports((prev) => {
          const u = prev.filter((r) => r.id !== id && r.serverId !== serverId);
          AsyncStorage.setItem(KEYS.REPORTS, JSON.stringify(u));
          return u;
        });
      } else {
        // Camera (admin_review) or below-threshold: just sync the authoritative count.
        setCommunityReports((prev) =>
          prev.map((r) =>
            r.id === id || r.serverId === id
              ? { ...r, denyCount: result.denyCount, status: result.status as CommunityReport["status"] }
              : r
          )
        );
      }
      return { ok: true };
    } catch (err) {
      // Roll back optimistic increment
      setCommunityReports((prev) =>
        prev.map((r) =>
          r.id === id || r.serverId === id ? { ...r, denyCount: originalDenyCount } : r
        )
      );
      if (warnIfBlockedDevice(err)) return { ok: false }; // alert already shown
      if (err instanceof ApiError) {
        if (err.status === 404) {
          // Gone on the server (expired or admin-removed) — clean up locally.
          setCommunityReports((prev) => {
            const u = prev.filter((r) => r.id !== id && r.serverId !== serverId);
            AsyncStorage.setItem(KEYS.REPORTS, JSON.stringify(u));
            return u;
          });
          return { ok: false, message: "This report was already removed from the map." };
        }
        // Surface the server's real reason (own-report protection, already voted…)
        return { ok: false, message: err.message };
      }
      return { ok: false, message: "Check your connection and try again." };
    }
  }, []);

  const setDriverName = useCallback((name: string) => {
    const trimmed = name.trim();
    driverNameRef.current = trimmed;
    setDriverNameState(trimmed);
    void AsyncStorage.setItem(KEYS.DRIVER_NAME, trimmed);
  }, []);

  // ─── Admin mode ──────────────────────────────────────────────────────────────
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const adminTokenRef = useRef<string | null>(null);
  useEffect(() => { adminTokenRef.current = adminToken; }, [adminToken]);

  // Restore a valid admin token from AsyncStorage on mount
  useEffect(() => {
    void AsyncStorage.getItem("admin_mobile_token").then((t) => {
      if (t && isAdminTokenValid(t)) setAdminToken(t);
      else if (t) void AsyncStorage.removeItem("admin_mobile_token");
    });
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
          ? { ...r, adminVerified: true, status: "confirmed" as const, confirmCount: 999 }
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
    await adminApiFetch("PATCH", `/admin-mobile/zones/${id}/location`, body);
    setDbZones((prev) => {
      const exists = prev.some((z) => z.id === id);
      if (exists) return prev.map((z) => z.id === id ? { ...z, lat, lng } : z);
      // First promotion — add to dbZones so the static entry gets suppressed immediately
      return staticZone ? [...prev, { ...staticZone, lat, lng }] : prev;
    });
    if (staticZone) {
      setSuppressedStaticIds((prev) => prev.includes(id) ? prev : [...prev, id]);
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
    await adminApiFetch("DELETE", `/admin-mobile/zones/${id}`, body);
    setDbZones((prev) => prev.filter((z) => z.id !== id));
    if (staticZone) {
      setSuppressedStaticIds((prev) => prev.includes(id) ? prev : [...prev, id]);
    }
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
    await adminApiFetch("POST", `/admin-mobile/zones/${id}/verify`, body);
    // Optimistic update — mark the zone as verified locally
    setDbZones((prev) =>
      prev.map((z) => z.id === id ? { ...z, verified: true } : z)
    );
    // Also mark static zones that were verified via their sz-id
    if (staticZone) {
      setDbZones((prev) =>
        prev.map((z) => z.id === staticZone.id ? { ...z, verified: true } : z)
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AppContext.Provider value={{
      locationGranted, requestLocationPermission, requestNotificationPermission,
      currentLat, currentLng, currentSpeed,
      activeAlert, currentSpeedLimit, nearbyZones, allZones, stretchZones: dbStretches, dismissAlert,
      hudMode, setHudMode,
      themeOverride, setThemeOverride,
      clearAllData,
      sosContact, setSosContact,
      communityReports, addReport, confirmReport, denyReport, deleteReport, flagReport, updateReport, deviceId,
      currentTrip, tripHistory, clearTripHistory,
      hydrated, onboardingComplete, completeOnboarding,
      isOffline,
      vehicleType, setVehicleType,
      navDestination, setNavDestination,
      activeRoute, altRoutes, selectRoute,
      navigationActive, voicePreparing, startNavigation, stopNavigation,
      isSharingTrip: shareToken !== null,
      shareToken,
      shareLink: (shareCode || shareToken) ? `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}/live/${shareCode ?? shareToken}` : null,
      driverName,
      setDriverName,
      startSharingTrip,
      stopSharingTrip,
      currentStepIdx, distToNextM, distanceRemainingM, durationRemainingS, routeLoading,
      showTraffic, setShowTraffic,
      zonesOnRoute,
      routeIncidentsAhead, routeTrafficDelayS, checkRouteStatus, routeIncidentsExpanded, setRouteIncidentsExpanded,
      arrivedInfo, clearArrival,
      pendingConfirmationReport, setPendingConfirmationReport,
      pendingConfirmationSource, setPendingConfirmationSource,
      hasVotedOnReport,
      pendingFocusCoords, setPendingFocusCoords,
      markReportPrompted, isReportPrompted,
      gpsLost,
      driverHeading,
      isAdmin, adminLogin, adminLogout, adminVerifyReport, adminDenyReport, adminUpdateReportLocation,
      adminUpdateZoneLocation, adminRemoveZone, adminVerifyZone,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
