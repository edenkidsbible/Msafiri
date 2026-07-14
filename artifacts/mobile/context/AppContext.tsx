import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Appearance, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import * as Speech from "expo-speech";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import NetInfo from "@react-native-community/netinfo";
import { SPEED_ZONES, SpeedZone } from "@/data/speedZones";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/utils/apiClient";
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
  status?: "active" | "confirmed" | "expired" | "denied";
  confirmCount?: number;
  denyCount?: number;
  isOwn?: boolean;
  speedLimit?: number;
  roadName?: string;
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
}

export interface AppRoute {
  id: string;
  distanceM: number;
  durationS: number;
  coords: RouteCoord[];
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
}

export interface RouteCheckResult {
  distanceM: number;
  durationS: number;
  trafficDelayS: number;
  incidents: RouteIncident[];
}

interface AppContextValue {
  locationGranted: boolean;
  requestLocationPermission: () => Promise<void>;
  requestNotificationPermission: () => Promise<boolean>;
  currentLat: number | null;
  currentLng: number | null;
  currentSpeed: number;
  activeAlert: (SpeedZone & { distance: number }) | null;
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
  denyReport: (id: string) => Promise<boolean>;
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
  vehicleType: VehicleTypeId;
  setVehicleType: (v: VehicleTypeId) => void;
  // Navigation
  navDestination: NavDestination | null;
  setNavDestination: (d: NavDestination | null) => void;
  activeRoute: AppRoute | null;
  altRoutes: AppRoute[];
  selectRoute: (r: AppRoute) => void;
  navigationActive: boolean;
  startNavigation: () => void;
  stopNavigation: () => void;
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
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180, f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180, dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

function buildInstruction(maneuver: { type?: string; modifier?: string }, name: string): string {
  const t = maneuver?.type ?? "";
  const mod = maneuver?.modifier ?? "";
  const road = name ? ` onto ${name}` : "";
  if (t === "arrive") return "You have arrived at your destination";
  if (t === "depart") return `Head ${mod || "forward"}${road}`;
  if (t === "turn") return `Turn ${mod || "left"}${road}`;
  if (t === "new name") return `Continue${road}`;
  if (t === "continue") return `Continue on ${name || "the road"}`;
  if (t === "roundabout" || t === "rotary") return `At the roundabout, take the exit${road}`;
  if (t === "fork") return `Keep ${mod || "straight"} at the fork`;
  if (t === "end of road") return `Turn ${mod || "left"} at the end of the road`;
  if (t === "merge") return `Merge ${mod || ""}${road}`;
  return name ? `Continue on ${name}` : "Continue";
}

async function fetchOSRM(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number
): Promise<AppRoute[]> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${fromLng},${fromLat};${toLng},${toLat}` +
    `?alternatives=true&steps=true&overview=full&geometries=geojson`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.length) return [];
  return (data.routes as any[]).map((r, idx) => ({
    id: `route-${idx}-${Date.now()}`,
    distanceM: r.distance,
    durationS: r.duration,
    coords: (r.geometry.coordinates as [number, number][]).map(([lng, lat]) => ({
      latitude: lat,
      longitude: lng,
    })),
    steps: (r.legs?.[0]?.steps ?? []).map((s: any) => ({
      instruction: buildInstruction(s.maneuver ?? {}, s.name ?? ""),
      distanceM: s.distance ?? 0,
      location: {
        latitude: s.maneuver?.location?.[1] ?? toLat,
        longitude: s.maneuver?.location?.[0] ?? toLng,
      },
    })),
  }));
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
}

function apiZoneToStaticZones(z: ApiSpeedZone): SpeedZone[] {
  if (z.status !== "active" || z.speedLimit == null) return [];
  const type: SpeedZone["type"] = z.type === "camera" || z.type === "police" ? z.type : "zone";
  const base = { name: z.name, road: z.road ?? "", speedLimit: z.speedLimit, type, description: z.description ?? "" };
  if (z.mode === "point" && z.lat != null && z.lng != null) {
    return [{ ...base, id: `db-${z.id}`, lat: z.lat, lng: z.lng }];
  }
  if (z.mode === "stretch" && z.startLat != null && z.startLng != null && z.endLat != null && z.endLng != null) {
    return [
      { ...base, id: `db-${z.id}-start`, lat: z.startLat, lng: z.startLng, isStretchEndpoint: true },
      { ...base, id: `db-${z.id}-end`, lat: z.endLat, lng: z.endLng, isStretchEndpoint: true },
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
// No live-traffic API is wired up (OSRM only returns free-flow duration), so
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

// Best TTS voice — populated once at startup via getAvailableVoicesAsync()
let _bestVoiceId: string | undefined;

function speakText(text: string) {
  if (Platform.OS === "web") return;
  Speech.stop();
  Speech.speak(text, {
    language: "en-GB",
    rate: 0.82,   // slightly slower = clearer, more deliberate
    pitch: 0.93,  // slightly lower = warmer, more human
    voice: _bestVoiceId,
  });
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

const ALERT_DIST = 1000, IN_ZONE_DIST = 250, MIN_TRIP_DIST = 200, STOP_TIMEOUT_MS = 180000;
const STEP_ANNOUNCE_DIST = 220; // m — announce next step when within this distance
const STEP_ADVANCE_DIST = 35;  // m — advance step index when past maneuver
const ARRIVAL_DIST = 60;       // m — wider than STEP_ADVANCE_DIST: tolerates GPS drift so the final "arrived" check doesn't get stuck
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
  const [activeAlert, setActiveAlert] = useState<(SpeedZone & { distance: number }) | null>(null);
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
  // Navigation
  const [navDestination, setNavDestState] = useState<NavDestination | null>(null);
  const [activeRoute, setActiveRoute] = useState<AppRoute | null>(null);
  const [altRoutes, setAltRoutes] = useState<AppRoute[]>([]);
  const [navigationActive, setNavigationActive] = useState(false);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [distToNextM, setDistToNextM] = useState<number | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [showTraffic, setShowTrafficState] = useState(false);
  const [zonesOnRoute, setZonesOnRoute] = useState<SpeedZone[]>([]);
  const [routeIncidentsExpanded, setRouteIncidentsExpanded] = useState(false);
  const [dbZones, setDbZones] = useState<SpeedZone[]>([]);
  const [dbStretches, setDbStretches] = useState<SpeedStretch[]>([]);
  const allZonesRef = useRef<SpeedZone[]>(SPEED_ZONES);
  const dbStretchesRef = useRef<SpeedStretch[]>([]);

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const isOfflineRef = useRef(false);
  const deviceIdRef = useRef<string | null>(null);
  const pollLocationRef = useRef<{ lat: number; lng: number } | null>(null);

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
  // Forwards to the memoized `stopNavigation` below so handleLocation (a
  // stable useCallback defined earlier in this component) can trigger a
  // full stop without needing it in its dependency array.
  const stopNavigationRef = useRef<() => void>(() => {});
  // Forwards to syncReportToServer (defined later, alongside addReport) so
  // the reconnect-retry sweep above can call it without an ordering issue.
  const syncReportToServerRef = useRef<((localId: string, type: CommunityReport["type"], lat: number, lng: number, speedLimit?: number) => void) | null>(null);

  // ── Startup load ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [trips, reports, hud, sos, onboarded, storedDeviceId, storedTheme, storedVehicleType] = await Promise.all([
        AsyncStorage.getItem(KEYS.TRIPS),
        AsyncStorage.getItem(KEYS.REPORTS),
        AsyncStorage.getItem(KEYS.HUD),
        AsyncStorage.getItem(KEYS.SOS),
        AsyncStorage.getItem(KEYS.ONBOARDING),
        AsyncStorage.getItem(KEYS.DEVICE_ID),
        AsyncStorage.getItem(KEYS.THEME),
        AsyncStorage.getItem(KEYS.VEHICLE_TYPE),
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
      setOnboardingComplete(onboarded === "true");
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

      // Select the most natural/human TTS voice available on this device.
      // Priority: Google neural (Android) > Apple premium (iOS) > Enhanced > any EN
      if (Platform.OS !== "web") {
        try {
          const voices = await Speech.getAvailableVoicesAsync();
          const en = voices.filter((v) => v.language?.startsWith("en"));

          // Google TTS neural voices on Android sound far more natural
          const googleNeural = en.filter((v) => {
            const id = v.identifier?.toLowerCase() ?? "";
            return id.includes("google") && (
              id.includes("female") || id.includes("male") ||
              id.includes("language") || id.includes("wavenet")
            );
          });

          // Apple Premium / Enhanced voices on iOS
          const applePremium = en.filter((v) => {
            const id = v.identifier?.toLowerCase() ?? "";
            return (
              id.includes("premium") ||
              id.includes("siri") ||
              (v as any).quality === "Enhanced" ||
              id.includes("enhanced")
            );
          });

          // Any Enhanced / Premium marked voice (any platform)
          const anyEnhanced = en.filter(
            (v) =>
              (v as any).quality === "Enhanced" ||
              v.identifier?.toLowerCase().includes("premium") ||
              v.identifier?.toLowerCase().includes("enhanced")
          );

          // Prefer GB/AU accent for Kenyan market (familiar British English)
          const preferredLocale = (list: typeof en) => [
            ...list.filter((v) => v.language?.startsWith("en-GB")),
            ...list.filter((v) => v.language?.startsWith("en-AU")),
            ...list.filter((v) => v.language?.startsWith("en-US")),
            ...list,
          ];

          const ranked = [
            ...preferredLocale(googleNeural),
            ...preferredLocale(applePremium),
            ...preferredLocale(anyEnhanced),
            ...en,
          ];

          // Deduplicate by identifier
          const seen = new Set<string>();
          for (const v of ranked) {
            if (!seen.has(v.identifier)) {
              seen.add(v.identifier);
              _bestVoiceId = v.identifier;
              break;
            }
          }
        } catch {
          // voice selection is best-effort; silence the error
        }
      }
    })();
  }, []);

  // ── Keep voice refs in sync with state ───────────────────────────────────
  useEffect(() => { communityReportsRef.current = communityReports; }, [communityReports]);
  useEffect(() => { vehicleTypeRef.current = vehicleType; }, [vehicleType]);
  useEffect(() => { currentLatRef.current = currentLat; }, [currentLat]);
  useEffect(() => { currentLngRef.current = currentLng; }, [currentLng]);

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
    if (rawKmh < 3) {
      stationaryStreakRef.current += 1;
      if (stationaryStreakRef.current >= 2) rawKmh = 0;
    } else {
      stationaryStreakRef.current = 0;
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

    // ── Repeat voice warning when speeding inside a zone (every 25 s) ──────
    if (activeLimitZone && kmh > activeLimitZone.speedLimit) {
      const warnNow = Date.now();
      if (warnNow - lastSpeedingWarnRef.current > 25000) {
        lastSpeedingWarnRef.current = warnNow;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        if (canSpeakGeneralAlert()) {
          speakGeneralAlert(`You are exceeding the speed limit. Please slow down to ${activeLimitZone.speedLimit} kilometres per hour.`);
        }
      }
    } else {
      lastSpeedingWarnRef.current = 0;
    }

    const alertCandidate = withDist.find((z) => z.distance > IN_ZONE_DIST && z.distance <= ALERT_DIST);
    if (alertCandidate) {
      if (alertCandidate.id !== alertZoneRef.current) {
        alertZoneRef.current = alertCandidate.id;
        alertDismissed.current = false;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        if (notifGranted.current) void fireZoneNotification(alertCandidate, alertCandidate.distance);
        if (canSpeakGeneralAlert()) {
          const distWord = alertCandidate.distance > 600
            ? `in ${Math.round(alertCandidate.distance / 100) * 100} metres, `
            : "just ";
          if (alertCandidate.type === "camera") {
            speakGeneralAlert(`Speed camera ahead ${distWord}on ${alertCandidate.road}. Please reduce your speed to ${alertCandidate.speedLimit} kilometres per hour.`);
          } else if (alertCandidate.type === "police") {
            speakGeneralAlert(`Police checkpoint ahead ${distWord}on ${alertCandidate.road}. Please slow down to ${alertCandidate.speedLimit} kilometres per hour and have your documents ready.`);
          } else {
            speakGeneralAlert(`Speed zone ahead. Reduce to ${alertCandidate.speedLimit} kilometres per hour.`);
          }
        }
        if (tripRef.current) tripRef.current.alertsCount = (tripRef.current.alertsCount ?? 0) + 1;
      }
      if (!alertDismissed.current) setActiveAlert(alertCandidate);
    } else {
      const stillInRange = alertZoneRef.current && withDist.find((z) => z.id === alertZoneRef.current && z.distance <= ALERT_DIST);
      if (!stillInRange) { alertZoneRef.current = null; alertDismissed.current = false; setActiveAlert(null); }
    }

    // ── Community report proximity voice alerts (1 km) ──────────────────────
    // Only announce while actually driving (same moving threshold used for
    // trip tracking below) — otherwise a driver parked/at home who merely has
    // the app open with location permission would get spoken alerts for
    // reports near their static position, which is exactly the annoyance we
    // want to avoid. Reports aren't marked as announced while not driving, so
    // they'll still be announced once the driver starts moving near them.
    const isDriving = kmh > 5;
    const REPORT_ANNOUNCE_DIST = 1000;
    for (const report of isDriving ? communityReportsRef.current : []) {
      if (announcedReportsRef.current.has(report.id)) continue;
      if (now - report.timestamp > 7200000) continue; // ignore reports > 2 h old
      const distToReport = haversine(lat, lng, report.lat, report.lng);
      if (distToReport > REPORT_ANNOUNCE_DIST || distToReport <= IN_ZONE_DIST) continue;
      announcedReportsRef.current.add(report.id);
      const ageMin = Math.round((now - report.timestamp) / 60000);
      const ageText = ageMin < 2 ? "just now" : `${ageMin} minutes ago`;
      let msg = "";
      if (report.type === "accident") {
        msg = `Caution! An accident was reported ${ageText} ahead. Please slow down and drive carefully.`;
      } else if (report.type === "pothole") {
        msg = `Warning! A pothole has been reported on the road ahead. Reduce speed and watch out.`;
      } else if (report.type === "roadblock") {
        msg = `Roadblock reported ahead ${ageText}. Be prepared to stop or find an alternative route.`;
      } else if (report.type === "police") {
        msg = `Police checkpoint reported ahead ${ageText}. Please slow down and have your documents ready.`;
      } else if (report.type === "alcoblow") {
        msg = `Alcoblow checkpoint reported ahead ${ageText}. Slow down and have your documents ready.`;
      } else if (report.type === "roadworks") {
        msg = `Road works reported ahead ${ageText}. Reduce speed and watch for workers and diversions.`;
      } else if (report.type === "camera") {
        msg = `Speed camera reported by other drivers ahead. Please maintain a safe speed.`;
      } else if (report.type === "traffic") {
        msg = `Heavy traffic reported ahead ${ageText}. Expect delays and consider an alternative route.`;
      } else if (report.type === "hazard") {
        msg = `Road hazard reported ahead ${ageText}. Reduce speed and proceed with caution.`;
      } else if (report.type === "debris") {
        msg = `Debris on the road reported ${ageText} ahead. Slow down and watch out for objects on the road.`;
      } else if (report.type === "breakdown") {
        msg = `Broken down vehicle reported on the road ahead ${ageText}. Slow down and give way.`;
      } else if (report.type === "weather") {
        msg = `Bad weather conditions reported ahead ${ageText}. Reduce speed and drive carefully.`;
      } else if (report.type === "closure") {
        msg = `Road closed ahead ${ageText}. Please find an alternative route.`;
      }
      if (msg && canSpeakGeneralAlert()) speakGeneralAlert(msg);
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

    // Navigation step tracking
    if (navActiveRef.current && routeRef.current) {
      const steps = routeRef.current.steps;
      const idx = stepIdxRef.current;
      if (idx < steps.length) {
        const step = steps[idx];
        const isLastStep = idx === steps.length - 1;
        const dist = haversine(lat, lng, step.location.latitude, step.location.longitude);
        setDistToNextM(Math.round(dist));

        const key = `step_${idx}`;
        if (dist < STEP_ANNOUNCE_DIST && lastSpokenRef.current !== key) {
          lastSpokenRef.current = key;
          const distWord = dist > 100 ? `In ${Math.round(dist / 50) * 50} metres, ` : "";
          speakText(distWord + step.instruction.toLowerCase());
        }

        // The final step gets a wider arrival radius than intermediate turns:
        // urban GPS drift in dense areas can easily bias a fix by 30-40 m, and
        // a driver who is visibly stopped at the destination but never quite
        // crosses a tight 35 m ring would otherwise be stuck "still navigating"
        // indefinitely with no further instruction to trigger a re-check.
        const dest = navDestRef.current;
        const distToDest = dest ? haversine(lat, lng, dest.lat, dest.lng) : dist;
        const arrived = isLastStep
          ? (dist < ARRIVAL_DIST || distToDest < ARRIVAL_DIST)
          : dist < STEP_ADVANCE_DIST;

        if (arrived) {
          const nextIdx = idx + 1;
          stepIdxRef.current = nextIdx;
          setCurrentStepIdx(nextIdx);
          if (nextIdx >= steps.length) {
            speakText("You have arrived at your destination");
            navActiveRef.current = false;
            navStartRef.current = null;
            setNavigationActive(false);
            const trip = tripRef.current;
            setArrivedInfo({
              destName: navDestRef.current?.name.split(",")[0] ?? "your destination",
              distM: trip?.distance ?? routeRef.current?.distanceM ?? 0,
              durationS: Math.round((Date.now() - (trip?.startTime ?? Date.now())) / 1000),
              maxSpeedKmh: trip?.maxSpeed ?? 0,
              alertsCount: trip?.alertsCount ?? 0,
            });
          }
        }
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
            { accuracy: Location.Accuracy.Highest, timeInterval: 1000, distanceInterval: 3 },
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

    fetchOSRM(currentLat, currentLng, navDestination.lat, navDestination.lng)
      .then((routes) => {
        if (cancelled || !routes.length) return;
        const [primary, ...alts] = routes;
        setActiveRoute(primary);
        routeRef.current = primary;
        setAltRoutes(alts);
        const vehicle = getVehicleTypeDef(vehicleTypeRef.current);
        setZonesOnRoute(getZonesOnRoute(primary, allZonesRef.current).map((z) => ({ ...z, speedLimit: capSpeedLimit(z.speedLimit, vehicle) })));
      })
      .catch((e) => { if (!cancelled) console.warn("OSRM:", e); })
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

  // Remote report polling — fetch nearby reports every 60 s when online
  useEffect(() => {
    if (!locationGranted) return;
    const poll = async () => {
      if (isOfflineRef.current || !pollLocationRef.current || !deviceIdRef.current) return;
      const { lat, lng } = pollLocationRef.current;
      try {
        const data = await apiGet<{ reports: Array<{
          id: string; type: string; lat: number; lng: number;
          status: string; confirmCount: number; denyCount: number;
          createdAt: number; expiresAt: number | null;
        }> }>(`/reports?lat=${lat}&lng=${lng}&radius=20000`);
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
          isOwn: false,
        }));
        setCommunityReports((prev) => {
          const owned = prev.filter((r) => r.isOwn);
          const remoteNew = remote.filter((rem) => !owned.some((o) => o.serverId === rem.id));
          const ownedUpdated = owned.map((o) => {
            const match = remote.find((r) => r.id === o.serverId);
            return match
              ? { ...o, status: match.status, confirmCount: match.confirmCount, denyCount: match.denyCount }
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

  // Admin-managed speed zones — fetch nearby DB zones every 5 min when online,
  // merged with the built-in static list (see allZones below).
  useEffect(() => {
    if (!locationGranted) return;
    const poll = async () => {
      if (isOfflineRef.current || !pollLocationRef.current) return;
      const { lat, lng } = pollLocationRef.current;
      try {
        const data = await apiGet<{ zones: ApiSpeedZone[] }>(`/speed-zones?lat=${lat}&lng=${lng}&radius=100000`);
        setDbZones(data.zones.flatMap(apiZoneToStaticZones));
        setDbStretches(data.zones.map(apiZoneToStretch).filter((s): s is SpeedStretch => s !== null));
      } catch { /* network error — keep previous DB zones */ }
    };
    poll(); // immediate on mount
    const handle = setInterval(poll, 300000);
    return () => clearInterval(handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationGranted]);

  // Merged static + admin-managed zones, kept in a ref so non-reactive
  // callbacks (e.g. handleLocation) always read the latest list.
  const allZones = useMemo<SpeedZone[]>(
    () => (dbZones.length ? [...SPEED_ZONES, ...dbZones] : SPEED_ZONES),
    [dbZones]
  );
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
    return withAhead(
      routeIncidents.filter((inc) => inc.distanceAlongRouteM >= currentRouteDistanceM - 50)
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
    const routes = await fetchOSRM(lat, lng, destLat, destLng);
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

  // ── Navigation actions ────────────────────────────────────────────────────
  const setNavDestination = useCallback((d: NavDestination | null) => {
    setNavDestState(d);
    navDestRef.current = d;
    destAnnouncedRef.current = false;
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
  }, [activeRoute]);

  const startNavigation = useCallback(() => {
    if (!activeRoute) return;
    stepIdxRef.current = 0;
    setCurrentStepIdx(0);
    lastSpokenRef.current = "";
    routeProjIdxRef.current = 0;
    navActiveRef.current = true;
    navStartRef.current = Date.now();
    setNavigationActive(true);
    speakText("Navigation started. " + (activeRoute.steps[0]?.instruction ?? ""));
  }, [activeRoute]);

  const stopNavigation = useCallback(() => {
    // Silence the voice guide first and foremost — everything else is state
    // cleanup. Some Android TTS engines race Speech.stop() if it lands right
    // as a speak() call is still being dispatched to the native side, so a
    // trailing follow-up stop a beat later catches any narrowly-missed
    // utterance that slipped through the first call.
    Speech.stop?.();
    setTimeout(() => Speech.stop?.(), 60);

    navActiveRef.current = false;
    navStartRef.current = null;
    setNavigationActive(false);
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
  }, []);

  // Let handleLocation (defined earlier as a stable, empty-deps useCallback)
  // reach the latest stopNavigation without needing it as a dependency.
  useEffect(() => {
    stopNavigationRef.current = stopNavigation;
  }, [stopNavigation]);

  const clearArrival = useCallback(() => { setArrivedInfo(null); setRouteIncidentsExpanded(false); }, []);

  // ── Other actions ─────────────────────────────────────────────────────────
  const dismissAlert = useCallback(() => { alertDismissed.current = true; setActiveAlert(null); }, []);
  const setHudMode = useCallback((v: boolean) => { setHudModeState(v); AsyncStorage.setItem(KEYS.HUD, JSON.stringify(v)); }, []);
  const setThemeOverride = useCallback((v: "system" | "light" | "dark") => {
    setThemeOverrideState(v);
    AsyncStorage.setItem(KEYS.THEME, v);
    if (Platform.OS !== "web") {
      Appearance.setColorScheme(v === "system" ? null : v);
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
    apiPost<{ id: string; status: string; confirmCount: number; action: string }>(
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
        AsyncStorage.setItem(KEYS.REPORTS, JSON.stringify(u));
        return u;
      });
    }).catch(() => { /* still offline / request failed — local copy remains, retried on reconnect */ });
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
    // Spoken confirmation so a driver doesn't need to glance at the screen —
    // mirrors the tone used for turn-by-turn voice guidance.
    speakText(`${resolveIncidentType(type).label} reported`);
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
    } catch {
      // Roll back optimistic update (e.g. 409 already confirmed, or network error)
      setCommunityReports((prev) =>
        prev.map((r) => (r.id === id || r.serverId === id) ? { ...r, confirmCount: originalCount } : r)
      );
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

  const denyReport = useCallback(async (id: string): Promise<boolean> => {
    if (!deviceIdRef.current) return false;
    const report = communityReportsRef.current.find((r) => r.id === id || r.serverId === id);
    if (!report) return false;
    const serverId = report.serverId ?? id;
    // Track that this device has voted on this report
    votedReportIdsRef.current.add(id);
    if (report.serverId) votedReportIdsRef.current.add(report.serverId);
    // Optimistic: immediately remove — server now denies on first vote
    setCommunityReports((prev) => prev.filter((r) => r.id !== id && r.serverId !== id));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await apiPost(`/reports/${serverId}/deny`, { deviceId: deviceIdRef.current });
      return true;
    } catch {
      // Roll back — restore the report so it isn't silently lost
      setCommunityReports((prev) => [...prev, report]);
      return false;
    }
  }, []);

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
      navigationActive, startNavigation, stopNavigation,
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
