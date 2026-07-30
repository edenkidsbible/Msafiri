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
import { getRoadName } from "@/utils/snapToRoad";
import { playSound } from "@/utils/sound";
import { VehicleTypeId, DEFAULT_VEHICLE_TYPE, getVehicleTypeDef, capSpeedLimit } from "@/data/vehicleTypes";

// ─── Types ──────────────────────────────────────────────────────────────────
import { speakAlert, speakAlertMulti, speakAlertPhrase, isAlertVoicePlaying } from "@/utils/alertTts";

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
  /** Pink alternative polylines shown on the map while the driver is off-route.
   *  Populated as soon as the first diverged GPS fix is detected, cleared when the
   *  driver returns to the route or a full reroute commits. Max 2 routes. */
  divergenceRoutes: AppRoute[];
  selectRoute: (r: AppRoute) => void;
  navigationActive: boolean;
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
  /** One-time backfill: writes every DB-relocated zone back into speedZones.ts.
   *  Returns the number of zones patched in the static file. */
  adminSyncStaticZones: () => Promise<{ synced: number; total: number }>;
  /** Snaps a coordinate to the nearest point on the driver's active route
   *  polyline. Returns null when no route is active; the caller should then
   *  fall back to snapToRoad() (Google Roads API) or raw GPS. */
  snapToActiveRoute: (lat: number, lng: number) => { lat: number; lng: number } | null;
  /** A faster route found during the periodic background check while
   *  navigating. Non-null when an alternative saves ≥ 3 minutes over the
   *  remaining time on the active route. Cleared on dismiss, accept, reroute,
   *  or navigation stop. */
  fasterRoute: AppRoute | null;
  /** Switch to the suggested faster route and clear the banner. */
  acceptFasterRoute: () => void;
  /** Dismiss the faster-route banner without switching routes. The next
   *  periodic check (≈2 min) can surface a new suggestion if conditions hold. */
  dismissFasterRoute: () => void;
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
  // One name containing the other covers "Thika" ↔ "Thika Superhighway" etc.
  return a === b || a.includes(b) || b.includes(a);
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
    // On Android the channel must be specified on the trigger, not in content.
    // { channelId } without a time value fires immediately, same as trigger:null.
    // Without this Android 8+ silently discards the notification because it
    // falls back to the "default" channel which is permanently low-importance.
    trigger: Platform.OS === "android"
      ? { channelId: "msafiri_alerts" } as any
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
const STEP_ADVANCE_DIST = 50;  // m — advance step index when past maneuver point
const ARRIVAL_DIST = 30;        // m — advance final step + trigger arrival UI
// Tighter than IN_ZONE_DIST: this gates the persistent "current road limit"
// readout, so we only claim confidence in a posted limit when squarely
// inside the admin-defined corridor — not just "somewhere nearby".
const STRETCH_CORRIDOR_M = 80;
// ─── Provider ────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [locationGranted, setLocationGranted] = useState(false);
  const [currentLat, setCurrentLat] = useState<number | null>(null);
  const [currentLng, setCurrentLng] = useState<number | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [activeAlert, setActiveAlert] = useState<DriveAlert | null>(null);
  const [activeAlertExtras, setActiveAlertExtras] = useState<DriveAlert[]>([]);
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
  /** Pink "what's ahead" alternatives shown while the driver is off-route. */
  const [divergenceRoutes, setDivergenceRoutes] = useState<AppRoute[]>([]);
  /** Ref mirror so the GPS handler can check/clear without stale closure values. */
  const divergenceRoutesRef  = useRef<AppRoute[]>([]);
  /** Guard: true while a divergence fetch is in-flight to prevent concurrent calls. */
  const divergenceFetchingRef = useRef(false);
  /** Timestamp (ms) of the last completed divergence fetch — used by the reroute
   *  callback to decide whether the cached routes are still fresh enough to reuse. */
  const divergenceFetchedAtRef = useRef<number>(0);
  const [navigationActive, setNavigationActive] = useState(false);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [distToNextM, setDistToNextM] = useState<number | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [showTraffic, setShowTrafficState] = useState(false);
  const [zonesOnRoute, setZonesOnRoute] = useState<SpeedZone[]>([]);
  const [routeIncidentsExpanded, setRouteIncidentsExpanded] = useState(false);
  const [fasterRoute, setFasterRoute] = useState<AppRoute | null>(null);
  /** Ref mirror so interval callbacks can read/clear without stale closures. */
  const fasterRouteRef = useRef<AppRoute | null>(null);
  /** True once the current faster-route suggestion has been announced by voice.
   *  Prevents re-announcing on subsequent 2-min checks while the same banner
   *  is still visible. Reset whenever fasterRouteRef is cleared. */
  const fasterRouteAnnouncedRef = useRef(false);
  const [dbZones, setDbZones] = useState<SpeedZone[]>([]);
  const [suppressedStaticIds, setSuppressedStaticIds] = useState<string[]>([]);
  const [dbStretches, setDbStretches] = useState<SpeedStretch[]>([]);
  const [driverHeading, setDriverHeading] = useState<number | null>(null);
  const allZonesRef = useRef<SpeedZone[]>(SPEED_ZONES);
  const dbStretchesRef = useRef<SpeedStretch[]>([]);
  // Synchronous mirrors of dbZones/suppressedStaticIds state — read by admin
  // callbacks that need the current value before the next render cycle fires.
  const dbZonesRef = useRef<SpeedZone[]>([]);
  const suppressedStaticIdsRef = useRef<string[]>([]);

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
  // (≤once per 500 m / 60 s outside navigation).
  //   • null  = unknown road  → distance-only fallback (no alert silently dropped)
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
  const notifGranted = useRef(false);
  const routeRef = useRef<AppRoute | null>(null);
  const stepIdxRef = useRef(0);
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
  // High-water mark of the driver's along-route progress in metres.
  // Only ever increases — GPS jitter can temporarily snap the projection to an
  // earlier route point (via the –5 lookback window), which would make
  // currentRouteDistanceM decrease and cause already-passed incidents to
  // reappear as "ahead" with growing distances. The high-water mark is used
  // instead of the raw projection value for incident filtering / aheadDistanceM.
  const routeMaxDistMRef = useRef(0);
  const communityReportsRef = useRef<CommunityReport[]>([]);
  const navDestRef = useRef<NavDestination | null>(null);
  // When the current turn-by-turn session started — used to auto-end a
  // navigation session that's run far longer than the route could ever
  // reasonably take (see the staleness check in handleLocation below).
  const navStartRef = useRef<number | null>(null);
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
  const offRouteCountRef        = useRef(0);
  const isReroutingRef          = useRef(false);
  // After any reroute we block the arrival check for 5 s so that GPS drift
  // or immediate step-cascade on the new route can't trigger a false arrival.
  const rerouteSettledUntilRef  = useRef(0);
  // Ref bag for the periodic traffic-refresh interval — holds the latest
  // nav state so the fixed-schedule interval never captures stale closures.
  const trafficBagRef = useRef<{
    navActive: boolean;
    route: AppRoute | null;
    dest: NavDestination | null;
    lat: number | null;
    lng: number | null;
    remainingS: number | null;
    distanceRemainingM: number | null;
  }>({ navActive: false, route: null, dest: null, lat: null, lng: null, remainingS: null, distanceRemainingM: null });
  // Timestamp (ms) until which off-route detection is suppressed after a
  // reroute fires.  Prevents the reroute-loop where GPS jitter at a complex
  // junction immediately triggers another reroute before the new route arrives.
  const rerouteGraceUntilRef = useRef<number>(0);
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
  const alertSourceRef = useRef<"zone" | "report" | null>(null);
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
  // Forwards to syncReportToServer (defined later, alongside addReport) so
  // the reconnect-retry sweep above can call it without an ordering issue.
  const syncReportToServerRef = useRef<((localId: string, type: CommunityReport["type"], lat: number, lng: number, speedLimit?: number) => void) | null>(null);

  // ── Startup load ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
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
  const handleLocation = useCallback((lat: number, lng: number, speedMs: number | null, accuracyM: number | null = null, nativeHeading: number | null = null) => {
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
    setDriverHeading(driverHeading);
    // Update dead reckoning baseline — used by the DR interval when signal is lost.
    lastHeadingRef.current = driverHeading ?? lastHeadingRef.current;
    drStateRef.current = { lat, lng, speedMps: Math.max(0, kmh / 3.6), heading: lastHeadingRef.current ?? 0 };

    // ── Current road resolution ───────────────────────────────────────────────
    // During navigation the active step already carries a road name supplied by
    // the Google Routes API. Outside navigation we ask the server to reverse-
    // geocode the position at most once per 500 m or 60 s — never every GPS tick.
    if (navActiveRef.current && routeRef.current) {
      // Nav step carries the road name from Google Routes API.
      // Write the result unconditionally — including null for unnamed steps —
      // so a stale road from a previous leg is never kept past a turn.
      const stepRoad = routeRef.current.steps[stepIdxRef.current]?.roadName;
      currentRoadRef.current = stepRoad || null;
    } else {
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
          }
        }).catch(() => { roadWarmupPendingRef.current = false; });
      } else {
        const nowMs = Date.now();
        const lastFetch = lastRoadFetchCoordRef.current;
        const distSinceLastFetch = lastFetch
          ? haversine(lat, lng, lastFetch.lat, lastFetch.lng)
          : Infinity;
        if (distSinceLastFetch > 500 || nowMs - lastRoadFetchTimeRef.current > 60_000) {
          lastRoadFetchCoordRef.current = { lat, lng };
          lastRoadFetchTimeRef.current  = nowMs;
          // Capture sequence before the async boundary so out-of-order responses
          // (e.g. slow cell signal after a fast Wi-Fi response) are discarded.
          const seq = ++roadFetchSeqRef.current;
          void getRoadName(lat, lng).then((road) => {
            if (roadFetchSeqRef.current === seq) currentRoadRef.current = road;
          }).catch(() => {});
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
    //   • roadReady  — road name resolved or driver moved > 200 m from start
    //   • alertAccuracyOk — GPS fix is reliable enough (≤ 40 m horizontal error)
    //   • roadsMatch — driver and incident are on the same road; unknown road
    //                  means NO match (fail-safe — never spill onto other roads)
    //
    // Road-ready gate: after a drive begins, suppress all alerts until either
    //   (a) the warm-up road-name fetch resolves (pending → settled), OR
    //   (b) the driver has moved > 200 m from the departure point.
    // This prevents a parallel-road camera from firing in the first few seconds
    // while road identity is still being resolved.
    const roadReady =
      !roadWarmupPendingRef.current ||
      !drivingStartCoordRef.current ||
      haversine(lat, lng, drivingStartCoordRef.current.lat, drivingStartCoordRef.current.lng) > 200;

    // Suppress alerts when the GPS fix is too inaccurate to trust road position.
    // Indoors and low-signal positions often report 50-100 m accuracy; at that
    // level we cannot confidently say the driver is on any particular road.
    const alertAccuracyOk = accuracyM == null || accuracyM <= 40;

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
        // For zones that do have a road, require a strict match.
        if (z.road && !roadsMatch(currentRoadRef.current, z.road)) continue;
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
        if (now - r.timestamp > 7200000) continue;
        const d = haversine(lat, lng, r.lat, r.lng);
        if (d <= IN_ZONE_DIST || d > ALERT_DIST || d >= bestDist) continue;
        // Road match: skip only when BOTH roads are known but disagree.
        // Reports without a roadName (unnamed roads) are allowed through on
        // distance alone — mirrors the zone-candidate logic ("Allow zones with
        // no road stored").  This prevents silent blackout on dirt tracks,
        // industrial roads, and newly-opened roads not yet in OSM.
        if (r.roadName && !roadsMatch(currentRoadRef.current, r.roadName)) continue;
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

    // (4) Dismiss active alert when:
    //   • it has moved out of the 1 km radius, OR
    //   • the driver has definitively turned away (bearing-divergence gate), OR
    //   • the driver is on a different named road (road-departure gate), OR
    //   • the road became null after a known-road approach + bearing confirms divert, OR
    //   • the driver has passed it (2 consecutive increasing-distance fixes).
    if (alertZoneRef.current && !alertDismissed.current) {
      const curZone   = withDist.find((z) => z.id === alertZoneRef.current);
      const curReport = curZone ? null : communityReportsRef.current.find((r) => r.id === alertZoneRef.current);
      const curItemLat = curZone?.lat ?? curReport?.lat;
      const curItemLng = curZone?.lng ?? curReport?.lng;
      const curDist    = curZone?.distance
        ?? (curItemLat != null && curItemLng != null ? haversine(lat, lng, curItemLat, curItemLng) : null);

      // Extended cooldown (3 min) is used for divert-away dismissals to prevent
      // the same alert from immediately re-triggering on a parallel road.
      // Normal pass-through uses the existing 60 s window.
      let extendedCooldown = false;

      // ── Step-bearing fallback ─────────────────────────────────────────────
      // lastHeadingRef.current is null whenever the driver has moved < 5 m
      // since the last GPS fix (e.g. just after a slow-speed turn at a light).
      // During active navigation we can proxy the driver's heading from the
      // current route step's direction — from step[n].location → step[n+1].location.
      // This fallback is used ONLY inside the divert-detection checks below;
      // it never affects heading-dependent UI (speed label, map camera).
      const stepFallbackHdg: number | null = (() => {
        if (lastHeadingRef.current != null) return null; // real heading available
        if (!navActiveRef.current) return null;           // not navigating
        const steps = routeRef.current?.steps;
        if (!steps) return null;
        const idx   = stepIdxRef.current;
        const cur   = steps[idx]?.location;
        const next  = steps[idx + 1]?.location;
        if (!cur || !next) return null;
        return bearingDeg(cur.latitude, cur.longitude, next.latitude, next.longitude);
      })();

      const shouldDismiss = (() => {
        if (curDist == null || curDist > ALERT_DIST) return true;

        const curItemRoad = curZone?.road ?? curReport?.roadName;

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
          // No valid heading — keep overlay open until we can compute direction.
          alertZoneLastDistRef.current = curDist;
          return false;
        }
        const iLatAt = alertItemLatRef.current;
        const iLngAt = alertItemLngRef.current;
        if (iLatAt != null && iLngAt != null) {
          const atd = alongTrackDistanceM(lat, lng, hdgAt, iLatAt, iLngAt);
          if (atd <= -10) return true; // alert is 10 m or more behind the driver
        }
        // ── Polyline redundancy when navigating ────────────────────────────────
        // Belt-and-suspenders: if the route's high-water mark has already advanced
        // past the alert's along-route position by ≥ 10 m, the driver has
        // physically driven through it even if GPS briefly snapped back.
        if (navActiveRef.current && routeMaxDistMRef.current > 0) {
          const alertId = alertZoneRef.current!;
          const incident = routeIncidentsRef.current.find(
            (i) => i.id === `static-${alertId}` || i.id === `report-${alertId}`,
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
        const cooldownMs  = extendedCooldown ? 180_000 : 60_000;
        alertDismissCooldownRef.current.set(dismissedId, {
          expiry: Date.now() + cooldownMs,
          peakDistM: curDist ?? 0,
        });
        alertZoneRef.current            = null;
        alertSourceRef.current          = null;
        alertDismissed.current          = false;
        alertZoneLastDistRef.current    = null;
        alertItemLatRef.current         = null;
        alertItemLngRef.current         = null;
        alertApproachRoadRef.current    = null;
        alertBearingDivCountRef.current = 0;
        lastSetAlertRef.current         = null;
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
        extraCandidates.push({
          id: r.id, source: "report" as const, type: r.type,
          name: resolveIncidentType(r.type).label,
          road: r.roadName, distance: d,
          speedLimit: r.speedLimit,
          lat: r.lat, lng: r.lng,
          confirmCount: r.confirmCount,
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
        if (alertZoneRef.current === k) alertZoneRef.current = null;
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
      //  • Not suppressed by geo-anchor — BUT the anchor only blocks NEW CLUSTERS
      //    (candidates that themselves have extras). A single hazard that appears
      //    within the anchor radius must still announce so drivers don't miss it.
      const isNewAlert = !alertDismissCooldownRef.current.has(winner.id) &&
        winner.id !== alertZoneRef.current &&
        (!anchorActive || extraCandidates.length === 0);
      if (isNewAlert) {
        alertZoneRef.current = winner.id;
        alertSourceRef.current = winner.source;
        alertZoneLastDistRef.current = winner.distance;
        alertDismissed.current = false;
        // Record alert item position and approach road for divert-away detection.
        alertItemLatRef.current       = winner.lat ?? null;
        alertItemLngRef.current       = winner.lng ?? null;
        alertApproachRoadRef.current  = currentRoadRef.current;
        alertBearingDivCountRef.current = 0;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        if (extraCandidates.length > 0) {
          // Multi-alert cluster: set geo-anchor and play bundled multi phrase
          alertAnchorLatRef.current = lat;
          alertAnchorLngRef.current = lng;
          alertAnchorExpiryRef.current = null; // fresh anchor — no TTL until driver dismisses
          speakAlertMulti(winner.type).catch(() => {});
        } else {
          // Single alert: play normal bundled phrase (60 s per-ID cooldown on dismiss)
          speakAlert(winner.type).catch(() => {});
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
          alertZoneRef.current            = null;
          alertSourceRef.current          = null;
          alertDismissed.current          = false;
          alertZoneLastDistRef.current    = null;
          alertItemLatRef.current         = null;
          alertItemLngRef.current         = null;
          alertApproachRoadRef.current    = null;
          alertBearingDivCountRef.current = 0;
          lastSetAlertRef.current         = null;
          lastExtrasKeyRef.current        = "";
          setActiveAlert(null);
          setActiveAlertExtras([]);
        }
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
        // Always keep the overall-route projection up-to-date: it is used by
        // off-route detection (below) and the remaining-route corridor check
        // for community-report filtering, both of which need routeProjIdxRef.
        let driverAlongM: number | null = null;
        if (route.cumDist?.length) {
          const prior  = routeProjIdxRef.current;
          const wStart = Math.max(0, prior - 5);
          const wEnd   = Math.min(route.coords.length - 1, prior + 40);
          const proj   = projectOntoRoute(route.coords, route.cumDist, lat, lng, wStart, wEnd)
                      ?? projectOntoRoute(route.coords, route.cumDist, lat, lng);
          if (proj) {
            routeProjIdxRef.current = proj.matchedIdx;
            driverAlongM = proj.alongRouteM;
          }
        }

        // Measure remaining distance to the maneuver point along the step's
        // own road geometry (step-level polyline) when it is available.  This
        // eliminates the "signals early on curves" bug: the overall-route
        // projection underestimates on tight bends because it measures the
        // chord, not the arc.  Fall back to the overall-route projection (or
        // haversine) when the server didn't supply a step polyline.
        let dist: number;
        if (step.stepCoords?.length && step.stepCumDist?.length) {
          const stepLen = step.stepCumDist[step.stepCumDist.length - 1];
          const proj    = projectOntoRoute(step.stepCoords, step.stepCumDist, lat, lng);
          // Reject GPS outliers: if the nearest step-coord is >100 m away the fix
          // has jumped off the step polyline.  Hold the previous distance for this
          // tick rather than snapping to a misleading position.
          if (proj && proj.offRouteM > 100 && distToNextMRef.current != null) {
            dist = distToNextMRef.current;
          } else {
            dist = Math.max(0, stepLen - (proj?.alongRouteM ?? 0));
          }
        } else {
          dist = driverAlongM != null
            ? Math.max(0, step.stepAlongRouteM - driverAlongM)
            : haversine(lat, lng, step.location.latitude, step.location.longitude);
        }

        setDistToNextM(Math.round(dist));

        // The final step gets a wider arrival radius than intermediate turns:
        // urban GPS drift in dense areas can easily bias a fix by 30-40 m.
        const dest = navDestRef.current;
        const distToDest = dest ? haversine(lat, lng, dest.lat, dest.lng) : dist;

        // Suppress arrival for 5 s after any reroute: the step cascade that
        // fires immediately after a reroute (depart step at 0 m → advance →
        // next step → advance…) can land on isLastStep with a stale or drifted
        // distToDest and trigger a completely false "You have arrived" popup.
        const rerouteSettled = Date.now() > rerouteSettledUntilRef.current;
        const arrived = rerouteSettled && (
          isLastStep
            ? (dist < ARRIVAL_DIST || distToDest < ARRIVAL_DIST)
            : dist < STEP_ADVANCE_DIST
        );

        if (arrived) {
          const nextIdx = idx + 1;
          stepIdxRef.current = nextIdx;
          setCurrentStepIdx(nextIdx);

          if (nextIdx >= steps.length) {
            navActiveRef.current = false;
            navStartRef.current = null;
            setNavigationActive(false);
            playSound("confirm").catch(() => {}); // arrival tone
            const trip = tripRef.current;
            setArrivedInfo({
              destName: (typeof navDestRef.current?.name === "string" ? navDestRef.current.name.split(",")[0] : null) ?? "your destination",
              distM: trip?.distance ?? routeRef.current?.distanceM ?? 0,
              durationS: Math.round((Date.now() - (trip?.startTime ?? Date.now())) / 1000),
              maxSpeedKmh: trip?.maxSpeed ?? 0,
              alertsCount: trip?.alertsCount ?? 0,
            });
            if (deviceIdRef.current) {
              apiPost("/push/trip-complete", { deviceId: deviceIdRef.current }).catch(() => {});
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
      // A route needs at least 2 points for the window scan to be meaningful;
      // bail early so no code below ever indexes into an empty array.
      if (coords.length >= 2) {
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

        // ── Divergence preview: fetch alternatives on the FIRST bad fix ─────
        // Shows up to 2 pink polylines immediately so the driver can see what
        // roads ahead lead to their destination before the full reroute commits.
        // Gates: moving (>10 km/h), not near a maneuver (>200 m), not already
        // fetching, and driver is not heading away from the destination.
        if (offRouteCountRef.current === 1
            && !divergenceFetchingRef.current
            && !isReroutingRef.current
            && navDestRef.current
            && kmh > 10
            && (distToNextMRef.current == null || distToNextMRef.current > 200)) {
          const destBearing = bearingDeg(lat, lng, navDestRef.current.lat, navDestRef.current.lng);
          if (driverHeading == null || angleDiffDeg(driverHeading, destBearing) <= 120) {
            const _dest = navDestRef.current;
            divergenceFetchingRef.current = true;
            fetchGoogleRoute(lat, lng, _dest.lat, _dest.lng, driverHeading)
              .then((routes) => {
                const alts = routes.slice(0, 2);
                // Reject stale responses: destination may have changed since fetch fired
              if (alts.length > 0 && navActiveRef.current && navDestRef.current === _dest) {
                  setDivergenceRoutes(alts);
                  divergenceRoutesRef.current = alts;
                  divergenceFetchedAtRef.current = Date.now();
                }
              })
              .catch((e) => console.warn("[divergence] fetch failed:", e))
              .finally(() => { divergenceFetchingRef.current = false; });
          }
        }

        if (offRouteCountRef.current >= 2 && !isReroutingRef.current) {
          offRouteCountRef.current = 0;
          // Suppress off-route for 10 s after triggering a reroute so GPS
          // jitter at complex junctions doesn't immediately loop back here.
          rerouteGraceUntilRef.current = Date.now() + 10_000;
          triggerRerouteRef.current?.(lat, lng);
        }
      } else {
        offRouteCountRef.current = 0;
        // Driver returned to route — clear divergence overlays.
        if (divergenceRoutesRef.current.length > 0) {
          setDivergenceRoutes([]);
          divergenceRoutesRef.current = [];
        }
      }
      } // end: coords.length >= 2 guard
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
        const updated: Partial<TripData> = { ...t, distance: (t.distance ?? 0) + added, maxSpeed: Math.max(t.maxSpeed ?? 0, kmh), avgSpeed: trimmed.length > 0 ? trimmed.reduce((s, p) => s + p.speed, 0) / trimmed.length : (t.avgSpeed ?? 0), positions: trimmed };
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
          const sub = await Location.watchPositionAsync(
            // distanceInterval: 0 — always fire on the timeInterval tick
            // regardless of movement so the watchdog doesn't endlessly fire
            // for stationary users. Speed-gauge jitter is handled in
            // handleLocation via rolling-median + accuracy dead-band.
            { accuracy: Location.Accuracy.Highest, timeInterval: 1000, distanceInterval: 0 },
            (loc) => {
              lastLocationAtRef.current = Date.now();
              // Pass the native GPS heading so the first fix already carries a
              // valid bearing for carriageway snapping.  Expo returns -1 when
              // heading is unavailable; handleLocation treats that as absent.
              const nativeHdg = typeof loc.coords.heading === "number" ? loc.coords.heading : null;
              handleLocation(loc.coords.latitude, loc.coords.longitude, loc.coords.speed, loc.coords.accuracy, nativeHdg);
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
      } finally {
        isSubscribing = false;
      }
    };

    subscribe();

    const watchdog = setInterval(() => {
      if (cancelled || isSubscribing) return; // Guard 1: skip if already subscribing
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
    routeMaxDistMRef.current = 0;

    fetchGoogleRoute(currentLat, currentLng, navDestination.lat, navDestination.lng, lastHeadingRef.current)
      .then((routes) => {
        if (cancelled || !routes.length) return;
        const [primary, ...alts] = routes;
        setActiveRoute(primary);
        routeRef.current = primary;
        setAltRoutes(alts);
        const vehicle = getVehicleTypeDef(vehicleTypeRef.current);
        setZonesOnRoute(getZonesOnRoute(primary, allZonesRef.current).map((z) => ({ ...z, speedLimit: capSpeedLimit(z.speedLimit, vehicle) })));
      })
      .catch((e) => { if (!cancelled) console.warn("Routing:", e); })
      .finally(() => { if (!cancelled) setRouteLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navDestination?.lat, navDestination?.lng]);

  // ── Auto-reroute callback ─────────────────────────────────────────────────
  // handleLocation fires this when the driver is consistently off-route.
  // Fetches a fresh route from the current position and replaces the active
  // route in-place, resetting the step index transparently.
  useEffect(() => {
    // ── commitReroute ───────────────────────────────────────────────────────
    // Single source of truth for every state/ref mutation that must happen
    // whenever a reroute is committed — whether the route came from the
    // divergence cache or from a fresh fetchGoogleRoute call.  Keeping it in
    // one place means a future change (new ref to reset, new voice logic, etc.)
    // only needs to be made once and applies to both paths automatically.
    function commitReroute(primary: AppRoute, alts: AppRoute[]) {
      setActiveRoute(primary);
      routeRef.current = primary;
      stepIdxRef.current = 0;
      setCurrentStepIdx(0);
      routeProjIdxRef.current = 0;
      routeMaxDistMRef.current = 0;
      // Dismiss the divergence preview — the new route has been committed.
      setDivergenceRoutes([]);
      divergenceRoutesRef.current = [];
      setAltRoutes(alts);
      // Clear any faster-route suggestion — the rerouted path is already optimal.
      setFasterRoute(null);
      fasterRouteRef.current = null;
      fasterRouteAnnouncedRef.current = false;
      const vehicle = getVehicleTypeDef(vehicleTypeRef.current);
      setZonesOnRoute(
        getZonesOnRoute(primary, allZonesRef.current).map((z) => ({
          ...z, speedLimit: capSpeedLimit(z.speedLimit, vehicle),
        }))
      );
      // Block arrival detection for 5 s so the rapid depart-step cascade on
      // the new route (step 0 at 0 m → advance → step 1 …) can't trigger a
      // false "You have arrived" before the route settles.
      rerouteSettledUntilRef.current = Date.now() + 5_000;

      // ── Gap 3 fix: dismiss active alert if it's no longer on the new route ──
      // An alert from the old route polyline must not persist after a reroute.
      // Test: is the alert's stored position within 300 m of any point on the
      // new polyline?  If not, dismiss with a 3-minute cooldown so it doesn't
      // re-trigger immediately on the new road.
      if (alertZoneRef.current) {
        const iLat = alertItemLatRef.current;
        const iLng = alertItemLngRef.current;
        if (iLat != null && iLng != null) {
          const onNewRoute = primary.coords.some(
            (pt: RouteCoord) => haversine(iLat, iLng, pt.latitude, pt.longitude) < 300,
          );
          if (!onNewRoute) {
            const dismissedId = alertZoneRef.current;
            alertDismissCooldownRef.current.set(dismissedId, {
              expiry: Date.now() + 180_000,
              peakDistM: alertZoneLastDistRef.current ?? 0,
            });
            alertZoneRef.current            = null;
            alertSourceRef.current          = null;
            alertDismissed.current          = false;
            alertZoneLastDistRef.current    = null;
            alertItemLatRef.current         = null;
            alertItemLngRef.current         = null;
            alertApproachRoadRef.current    = null;
            alertBearingDivCountRef.current = 0;
            lastSetAlertRef.current         = null;
            setActiveAlert(null);
          }
        }
      }
    }

    triggerRerouteRef.current = (lat: number, lng: number) => {
      if (!navDestRef.current || isReroutingRef.current) return;
      const dest = navDestRef.current;
      isReroutingRef.current = true;
      setRouteLoading(true);

      // ── Divergence-cache fast path ─────────────────────────────────────────
      // The divergence-preview fetch (triggered on the 1st bad GPS fix) already
      // called fetchGoogleRoute from nearly the same position to the same
      // destination.  If that result is ≤10 s old, reuse it directly and skip
      // the redundant network round-trip that would otherwise follow on the 2nd
      // bad fix.  If the cache is stale or empty, fall through to a fresh fetch.
      const cachedRoutes = divergenceRoutesRef.current;
      const cacheAge     = Date.now() - divergenceFetchedAtRef.current;
      if (cachedRoutes.length > 0 && cacheAge <= 10_000) {
        const [primary, ...alts] = cachedRoutes;
        // Guard: a route with no steps cannot be committed — the step-projection
        // logic would immediately fault.  Extend grace and fall through to a
        // fresh fetch instead.
        if (!primary || primary.steps.length === 0) {
          console.warn("[reroute] cached primary has no steps — skipping cache, fetching fresh");
          rerouteGraceUntilRef.current = Date.now() + 5_000;
          // fall through to fresh fetch below
        } else {
          commitReroute(primary, alts);
          setRouteLoading(false);
          isReroutingRef.current = false;
          return;
        }
      }

      fetchGoogleRoute(lat, lng, dest.lat, dest.lng, lastHeadingRef.current)
        .then((routes) => {
          // Reject stale callbacks: destination or nav session changed while
          // the network round-trip was in flight.
          if (!navActiveRef.current || navDestRef.current !== dest) return;
          if (!routes.length) return;
          const [primary, ...alts] = routes;
          commitReroute(primary, alts);
        })
        .catch((e) => {
          console.warn("[reroute] Routing:", e);
          // On failure, push the grace window out further so a transient
          // network error doesn't cause a rapid re-trigger loop — the driver
          // will get a fresh reroute attempt once the grace period expires.
          rerouteGraceUntilRef.current = Date.now() + 30_000;
        })
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
            if (!loc) continue;
            const dist = haversine(loc.lat, loc.lng, prev.lat, prev.lng);
            if (dist < IN_ZONE_DIST || dist > ALERT_DIST * 3) continue;
            break;
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
    if (!navigationActive || currentRouteDistanceM == null) return withAhead(routeIncidents);
    // Only keep incidents that are still ahead of the driver. A 15 m rearward
    // tolerance absorbs GPS jitter at the exact crossing point without keeping
    // an already-passed camera visible in the "ahead" list for tens of seconds.
    return withAhead(
      routeIncidents.filter((inc) => inc.distanceAlongRouteM >= effectiveDist - 15)
    );
  }, [routeIncidents, navigationActive, currentRouteDistanceM]);

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
    if (!activeRoute) return null;
    if (currentRouteDistanceM == null) return activeRoute.distanceM;
    return Math.max(0, activeRoute.distanceM - currentRouteDistanceM);
  }, [activeRoute, currentRouteDistanceM]);

  const durationRemainingS = useMemo(() => {
    if (!activeRoute || distanceRemainingM == null) return null;
    // Google's durationS is already traffic-aware — scale by remaining distance
    // fraction only. Community report delay (routeTrafficDelayS) is shown as a
    // separate supplemental indicator, not baked into the ETA.
    if (activeRoute.distanceM <= 0) return activeRoute.durationS;
    return Math.round((distanceRemainingM / activeRoute.distanceM) * activeRoute.durationS);
  }, [activeRoute, distanceRemainingM]);
  // Keep refs in sync so the share-trip ping interval always reads fresh values
  useEffect(() => { durationRemainingRef.current = durationRemainingS; }, [durationRemainingS]);
  useEffect(() => { distanceRemainingRef.current = distanceRemainingM; }, [distanceRemainingM]);

  // ── Periodic traffic refresh ───────────────────────────────────────────────
  // Periodic background check fired every 2 min during active navigation.
  // Two responsibilities per tick:
  //   1. Faster-route detection — if Google's fastest route from the current
  //      position saves ≥ 3 min over the remaining ETA, surface a dismissible
  //      banner in the drive HUD so the driver can switch with one tap.
  //   2. ETA drift patch — if the active-route ETA has drifted by > 5 min due
  //      to changing traffic, silently update activeRoute.durationS so the
  //      nav-bar arrival time stays accurate (polyline/steps unchanged).
  const TRAFFIC_REFRESH_MS    = 2 * 60 * 1000; // 2 minutes between checks
  const TRAFFIC_REFRESH_THR_S = 5 * 60;          // 5 min drift triggers an ETA patch
  const FASTER_ROUTE_THR_S    = 3 * 60;          // 3 min saving triggers the banner

  // Keep the bag current after every render so the fixed-interval callback
  // always reads fresh state without being re-registered on every GPS fix.
  useEffect(() => {
    trafficBagRef.current = {
      navActive: navigationActive,
      route: activeRoute,
      dest: navDestination,
      lat: currentLat,
      lng: currentLng,
      remainingS: durationRemainingS,
      distanceRemainingM,
    };
  });

  // Registered once; reads state through the ref bag to avoid stale closures.
  useEffect(() => {
    const id = setInterval(async () => {
      const b = trafficBagRef.current;
      if (!b.navActive || !b.route || !b.dest || b.lat == null || b.lng == null) return;
      if (isReroutingRef.current) return;
      // Skip when almost arrived — savings threshold would exceed trip length.
      if (b.remainingS != null && b.remainingS < FASTER_ROUTE_THR_S + 60) return;

      try {
        const routes = await fetchGoogleRoute(b.lat, b.lng, b.dest.lat, b.dest.lng, lastHeadingRef.current);
        if (!routes.length) return;

        // routes[0].durationS is the REMAINING time from current position on
        // Google's fastest route.  Compare it against durationRemainingS (also
        // remaining) so the threshold check is apples-to-apples.
        const fastest      = routes[0];
        const currentS     = b.remainingS ?? b.route.durationS;
        const saving       = currentS - fastest.durationS;

        // ── 1. Faster-route detection ────────────────────────────────────────
        if (saving >= FASTER_ROUTE_THR_S) {
          const wasNull = fasterRouteRef.current == null;
          setFasterRoute(fastest);
          fasterRouteRef.current = fastest;
          // Announce once on first detection; skip if a turn cue is playing.
          if (wasNull && !fasterRouteAnnouncedRef.current && !isAlertVoicePlaying()) {
            fasterRouteAnnouncedRef.current = true;
            const savingMin = Math.round(saving / 60);
            const phrase = savingMin === 1
              ? "Faster route found, saving 1 minute"
              : `Faster route found, saving ${savingMin} minutes`;
            speakAlertPhrase(phrase).catch(() => {});
          }
        } else {
          // Conditions improved or route converged — clear any stale suggestion.
          if (fasterRouteRef.current != null) {
            setFasterRoute(null);
            fasterRouteRef.current = null;
            fasterRouteAnnouncedRef.current = false;
          }
        }

        // ── 2. ETA drift patch (only when NOT showing a faster-route banner) ─
        // When a faster-route banner is already visible we leave activeRoute
        // untouched so the driver can compare the two ETAs clearly.
        if (saving < FASTER_ROUTE_THR_S) {
          const drift = Math.abs(fastest.durationS - currentS);
          if (drift < TRAFFIC_REFRESH_THR_S) return;

          // activeRoute.durationS is a TOTAL baseline; durationRemainingS is
          // computed as (distanceRemainingM / totalDistanceM) * durationS.
          // Back-convert: equivalentTotal = newRemainingS * (total / remaining).
          const distRem   = b.distanceRemainingM;
          const distTotal = b.route.distanceM;
          const equivalentTotalS =
            distRem != null && distRem > 0 && distTotal > 0
              ? Math.round(fastest.durationS * (distTotal / distRem))
              : fastest.durationS; // edge-case: at trip start remaining ≈ total

          // Silently patch durationS only — polyline, steps, and route id are
          // unchanged so the driver stays on the same road without any visual jump.
          setActiveRoute((prev) => prev ? { ...prev, durationS: equivalentTotalS } : prev);
        }
      } catch { /* network error — silently keep current ETA */ }
    }, TRAFFIC_REFRESH_MS);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Navigation actions ────────────────────────────────────────────────────
  const setNavDestination = useCallback((d: NavDestination | null) => {
    setNavDestState(d);
    navDestRef.current = d;
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
    setDistToNextM(null);
    // Clear any pending faster-route suggestion when destination changes.
    setFasterRoute(null);
    fasterRouteRef.current = null;
    fasterRouteAnnouncedRef.current = false;
  }, []);

  const selectRoute = useCallback((r: AppRoute) => {
    try {
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
      setDistToNextM(null);
      routeProjIdxRef.current = 0;
      routeMaxDistMRef.current = 0;
    } catch (e) {
      console.warn("[selectRoute] error:", e);
    }
  }, [activeRoute]);

  /** Switch to the suggested faster route and clear the banner. */
  const acceptFasterRoute = useCallback(() => {
    const route = fasterRouteRef.current;
    setFasterRoute(null);
    fasterRouteRef.current = null;
    fasterRouteAnnouncedRef.current = false;
    if (route) selectRoute(route);
  }, [selectRoute]);

  /** Dismiss the banner without switching routes. */
  const dismissFasterRoute = useCallback(() => {
    setFasterRoute(null);
    fasterRouteRef.current = null;
    fasterRouteAnnouncedRef.current = false;
  }, []);

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
          if (distToNextMRef.current != null) pingBody.distToNextM = distToNextMRef.current;
          const route = routeRef.current;
          const stepIdx = stepIdxRef.current;
          if (route?.steps[stepIdx]?.instruction) pingBody.nextInstruction = route.steps[stepIdx].instruction;
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
      requestBackgroundLocationPermission().catch(() => {});
      return `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}/live/${code}`;
    } catch (e) {
      console.warn("startSharingTrip failed:", e);
      return null;
    }
  }, []);

  const startNavigation = useCallback(async () => {
    // Use routeRef.current (updated synchronously by selectRoute) instead of
    // the activeRoute closure so that a divergence-route tap — which calls
    // selectRoute(r) then immediately startNavigation() — always operates on
    // the newly selected route even before React flushes the state update.
    if (!routeRef.current) return;

    stepIdxRef.current = 0;
    setCurrentStepIdx(0);
    routeProjIdxRef.current = 0;
    navActiveRef.current = true;
    navStartRef.current = Date.now();
    setNavigationActive(true);
    // Start the iOS background location task so GPS keeps flowing when the
    // driver locks the screen. Fire-and-forget — failure is non-fatal (the
    // foreground watcher still works; the bg task just adds resilience).
    startBackgroundNavTask().catch(() => {});
  }, []); // no closure dependencies — activeRoute replaced by routeRef.current

  const stopNavigation = useCallback(() => {
    navActiveRef.current = false;
    navStartRef.current = null;
    setNavigationActive(false);
    // Stop the background nav task — no longer needed once navigation ends.
    stopBackgroundNavTask().catch(() => {});
    setDistToNextM(null);
    setNavDestState(null);
    navDestRef.current = null;
    setActiveRoute(null);
    setAltRoutes([]);
    setDivergenceRoutes([]);
    divergenceRoutesRef.current = [];
    divergenceFetchingRef.current = false;
    setZonesOnRoute([]);
    routeRef.current = null;
    stepIdxRef.current = 0;
    setCurrentStepIdx(0);
    routeProjIdxRef.current = 0;
    setRouteIncidentsExpanded(false);
    // Clear any pending faster-route suggestion when navigation stops.
    setFasterRoute(null);
    fasterRouteRef.current = null;
    fasterRouteAnnouncedRef.current = false;
    // Stop any active trip-sharing session when navigation ends
    if (sharePingIntervalRef.current) {
      clearInterval(sharePingIntervalRef.current);
      sharePingIntervalRef.current = null;
    }
    stopBackgroundShareTask().catch(() => {});
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
        startBackgroundNavTask().catch(() => {});
      } else if (nextState === "active") {
        stopBackgroundNavTask().catch(() => {});
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

  const clearArrival = useCallback(() => { setArrivedInfo(null); setRouteIncidentsExpanded(false); }, []);


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
    setActiveAlert(null);
    setActiveAlertExtras([]);
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
    // ── Duplicate-prevention pre-check ───────────────────────────────────────
    // Before creating an optimistic local report, scan the in-memory cache for
    // an existing active/confirmed report of the same type within 50 m.
    // If found: confirm the existing report instead of adding a duplicate.
    // This prevents the confusing "report flashes on map then disappears" UX
    // that happens when the server clusters the submission.  The server's own
    // 50-m deduplication (POST /reports) handles any race conditions or reports
    // not yet in the local cache.
    const nearbyExisting = communityReportsRef.current.find((r) =>
      r.type === type &&
      !r.isOwn && // can't confirm own report
      (r.status === "active" || r.status === "confirmed" || r.status === "admin_review") &&
      haversine(lat, lng, r.lat, r.lng) < 50
    );
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
    const r: CommunityReport = {
      id: localId, type, lat, lng, timestamp: Date.now(), confirmed: 1,
      status: "active", confirmCount: 1, denyCount: 0, isOwn: true,
      speedLimit,
    };
    setCommunityReports((prev) => { const u = [r, ...prev]; AsyncStorage.setItem(KEYS.REPORTS, JSON.stringify(u)); return u; });
    if (tripRef.current) tripRef.current.alertsCount = (tripRef.current.alertsCount ?? 0) + 1;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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

  return (
    <AppContext.Provider value={{
      locationGranted, requestLocationPermission, requestNotificationPermission,
      currentLat, currentLng, currentSpeed,
      activeAlert, activeAlertExtras, currentSpeedLimit, nearbyZones, allZones, stretchZones: dbStretches, dismissAlert,
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
      activeRoute, altRoutes, divergenceRoutes, selectRoute,
      navigationActive, startNavigation, stopNavigation,
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
      adminUpdateZoneLocation, adminRemoveZone, adminVerifyZone, adminSyncStaticZones,
      snapToActiveRoute,
      fasterRoute, acceptFasterRoute, dismissFasterRoute,
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
