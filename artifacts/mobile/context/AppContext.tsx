import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import * as Speech from "expo-speech";
import NetInfo from "@react-native-community/netinfo";
import { SPEED_ZONES, SpeedZone } from "@/data/speedZones";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CommunityReport {
  id: string;
  type: "camera" | "police" | "accident" | "pothole" | "roadblock" | "clear";
  lat: number;
  lng: number;
  timestamp: number;
  confirmed: number;
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

export interface NavDestination { name: string; lat: number; lng: number }

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

interface AppContextValue {
  locationGranted: boolean;
  requestLocationPermission: () => Promise<void>;
  currentLat: number | null;
  currentLng: number | null;
  currentSpeed: number;
  activeAlert: (SpeedZone & { distance: number }) | null;
  currentSpeedLimit: number | null;
  nearbyZones: Array<SpeedZone & { distance: number }>;
  dismissAlert: () => void;
  hudMode: boolean;
  setHudMode: (v: boolean) => void;
  sosContact: SOSContact | null;
  setSosContact: (c: SOSContact | null) => void;
  communityReports: CommunityReport[];
  addReport: (type: CommunityReport["type"], lat: number, lng: number) => void;
  currentTrip: Partial<TripData> | null;
  tripHistory: TripData[];
  clearTripHistory: () => void;
  onboardingComplete: boolean;
  completeOnboarding: () => void;
  isOffline: boolean;
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
  routeLoading: boolean;
  showTraffic: boolean;
  setShowTraffic: (v: boolean) => void;
  zonesOnRoute: SpeedZone[];
}

const AppContext = createContext<AppContextValue | null>(null);

const KEYS = {
  TRIPS: "sdk_trips",
  REPORTS: "sdk_reports",
  HUD: "sdk_hud",
  SOS: "sdk_sos",
  ONBOARDING: "sdk_onboarding",
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
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
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

function speakText(text: string) {
  if (Platform.OS === "web") return;
  Speech.stop();
  Speech.speak(text, { language: "en", rate: 0.92 });
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

async function requestNotificationPermission(): Promise<boolean> {
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
  const [sosContact, setSosContactState] = useState<SOSContact | null>(null);
  const [communityReports, setCommunityReports] = useState<CommunityReport[]>([]);
  const [currentTrip, setCurrentTrip] = useState<Partial<TripData> | null>(null);
  const [tripHistory, setTripHistory] = useState<TripData[]>([]);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
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

  const alertZoneRef = useRef<string | null>(null);
  const alertDismissed = useRef(false);
  const tripRef = useRef<Partial<TripData> | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifGranted = useRef(false);
  const routeRef = useRef<AppRoute | null>(null);
  const stepIdxRef = useRef(0);
  const lastSpokenRef = useRef<string>("");
  const navActiveRef = useRef(false);

  // ── Startup load ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [trips, reports, hud, sos, onboarded] = await Promise.all([
        AsyncStorage.getItem(KEYS.TRIPS),
        AsyncStorage.getItem(KEYS.REPORTS),
        AsyncStorage.getItem(KEYS.HUD),
        AsyncStorage.getItem(KEYS.SOS),
        AsyncStorage.getItem(KEYS.ONBOARDING),
      ]);
      if (trips) setTripHistory(JSON.parse(trips));
      if (reports) {
        const parsed: CommunityReport[] = JSON.parse(reports);
        setCommunityReports(parsed.filter((r) => Date.now() - r.timestamp < 86400000));
      }
      if (hud) setHudModeState(JSON.parse(hud));
      if (sos) setSosContactState(JSON.parse(sos));
      setOnboardingComplete(onboarded === "true");
      notifGranted.current = await requestNotificationPermission();
    })();
  }, []);

  // ── Offline detection ─────────────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS === "web") {
      const on = () => setIsOffline(false);
      const off = () => setIsOffline(true);
      window.addEventListener("online", on);
      window.addEventListener("offline", off);
      setIsOffline(!navigator.onLine);
      return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
    }
    const unsub = NetInfo.addEventListener((s) => setIsOffline(!(s.isConnected ?? true)));
    return unsub;
  }, []);

  // ── Location permission ───────────────────────────────────────────────────
  const requestLocationPermission = useCallback(async () => {
    if (Platform.OS === "web") {
      if ("geolocation" in navigator) setLocationGranted(true);
      return;
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    setLocationGranted(status === "granted");
  }, []);

  // ── Core location handler ─────────────────────────────────────────────────
  const handleLocation = useCallback((lat: number, lng: number, speedMs: number | null) => {
    const kmh = speedMs != null && speedMs >= 0 ? speedMs * 3.6 : 0;
    setCurrentLat(lat);
    setCurrentLng(lng);
    setCurrentSpeed(kmh);

    // Speed zones
    const withDist = SPEED_ZONES
      .map((z) => ({ ...z, distance: haversine(lat, lng, z.lat, z.lng) }))
      .sort((a, b) => a.distance - b.distance);
    setNearbyZones(withDist.filter((z) => z.distance < 5000));
    const inZone = withDist.find((z) => z.distance <= IN_ZONE_DIST);
    setCurrentSpeedLimit(inZone?.speedLimit ?? null);

    const alertCandidate = withDist.find((z) => z.distance > IN_ZONE_DIST && z.distance <= ALERT_DIST);
    if (alertCandidate) {
      if (alertCandidate.id !== alertZoneRef.current) {
        alertZoneRef.current = alertCandidate.id;
        alertDismissed.current = false;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        if (notifGranted.current) void fireZoneNotification(alertCandidate, alertCandidate.distance);
        speakText(`${alertCandidate.type === "camera" ? "Speed camera" : "Police checkpoint"} ahead. Reduce to ${alertCandidate.speedLimit} kilometres per hour.`);
        if (tripRef.current) tripRef.current.alertsCount = (tripRef.current.alertsCount ?? 0) + 1;
      }
      if (!alertDismissed.current) setActiveAlert(alertCandidate);
    } else {
      const stillInRange = alertZoneRef.current && withDist.find((z) => z.id === alertZoneRef.current && z.distance <= ALERT_DIST);
      if (!stillInRange) { alertZoneRef.current = null; alertDismissed.current = false; setActiveAlert(null); }
    }

    // Navigation step tracking
    if (navActiveRef.current && routeRef.current) {
      const steps = routeRef.current.steps;
      const idx = stepIdxRef.current;
      if (idx < steps.length) {
        const step = steps[idx];
        const dist = haversine(lat, lng, step.location.latitude, step.location.longitude);
        setDistToNextM(Math.round(dist));

        const key = `step_${idx}`;
        if (dist < STEP_ANNOUNCE_DIST && lastSpokenRef.current !== key) {
          lastSpokenRef.current = key;
          const distWord = dist > 100 ? `In ${Math.round(dist / 50) * 50} metres, ` : "";
          speakText(distWord + step.instruction.toLowerCase());
        }
        if (dist < STEP_ADVANCE_DIST) {
          const nextIdx = idx + 1;
          stepIdxRef.current = nextIdx;
          setCurrentStepIdx(nextIdx);
          if (nextIdx >= steps.length) {
            speakText("You have arrived at your destination");
            navActiveRef.current = false;
            setNavigationActive(false);
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
  useEffect(() => {
    if (!locationGranted) return;
    let cleanup: (() => void) | undefined;
    if (Platform.OS !== "web") {
      (async () => {
        const sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 5 },
          (loc) => handleLocation(loc.coords.latitude, loc.coords.longitude, loc.coords.speed)
        );
        cleanup = () => sub.remove();
      })();
    } else if ("geolocation" in navigator) {
      const id = navigator.geolocation.watchPosition(
        (pos) => handleLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.speed),
        (err) => console.warn("Geo:", err),
        { enableHighAccuracy: true }
      );
      cleanup = () => navigator.geolocation.clearWatch(id);
    }
    return () => cleanup?.();
  }, [locationGranted, handleLocation]);

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

    fetchOSRM(currentLat, currentLng, navDestination.lat, navDestination.lng)
      .then((routes) => {
        if (cancelled || !routes.length) return;
        const [primary, ...alts] = routes;
        setActiveRoute(primary);
        routeRef.current = primary;
        setAltRoutes(alts);
        setZonesOnRoute(getZonesOnRoute(primary, SPEED_ZONES));
      })
      .catch((e) => { if (!cancelled) console.warn("OSRM:", e); })
      .finally(() => { if (!cancelled) setRouteLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navDestination?.lat, navDestination?.lng]);

  // ── Navigation actions ────────────────────────────────────────────────────
  const setNavDestination = useCallback((d: NavDestination | null) => {
    setNavDestState(d);
    if (!d) {
      setActiveRoute(null);
      setAltRoutes([]);
      setZonesOnRoute([]);
      routeRef.current = null;
    }
    setNavigationActive(false);
    navActiveRef.current = false;
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
    setZonesOnRoute(getZonesOnRoute(r, SPEED_ZONES));
    stepIdxRef.current = 0;
    setCurrentStepIdx(0);
    lastSpokenRef.current = "";
    setDistToNextM(null);
  }, [activeRoute]);

  const startNavigation = useCallback(() => {
    if (!activeRoute) return;
    stepIdxRef.current = 0;
    setCurrentStepIdx(0);
    lastSpokenRef.current = "";
    navActiveRef.current = true;
    setNavigationActive(true);
    speakText("Navigation started. " + (activeRoute.steps[0]?.instruction ?? ""));
  }, [activeRoute]);

  const stopNavigation = useCallback(() => {
    navActiveRef.current = false;
    setNavigationActive(false);
    setDistToNextM(null);
    setNavDestState(null);
    setActiveRoute(null);
    setAltRoutes([]);
    setZonesOnRoute([]);
    routeRef.current = null;
    stepIdxRef.current = 0;
    setCurrentStepIdx(0);
    lastSpokenRef.current = "";
    Speech.stop?.();
  }, []);

  // ── Other actions ─────────────────────────────────────────────────────────
  const dismissAlert = useCallback(() => { alertDismissed.current = true; setActiveAlert(null); }, []);
  const setHudMode = useCallback((v: boolean) => { setHudModeState(v); AsyncStorage.setItem(KEYS.HUD, JSON.stringify(v)); }, []);
  const setSosContact = useCallback((c: SOSContact | null) => { setSosContactState(c); c ? AsyncStorage.setItem(KEYS.SOS, JSON.stringify(c)) : AsyncStorage.removeItem(KEYS.SOS); }, []);
  const addReport = useCallback((type: CommunityReport["type"], lat: number, lng: number) => {
    const r: CommunityReport = { id: genId(), type, lat, lng, timestamp: Date.now(), confirmed: 1 };
    setCommunityReports((prev) => { const u = [r, ...prev]; AsyncStorage.setItem(KEYS.REPORTS, JSON.stringify(u)); return u; });
    if (tripRef.current) tripRef.current.alertsCount = (tripRef.current.alertsCount ?? 0) + 1;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);
  const clearTripHistory = useCallback(() => { setTripHistory([]); AsyncStorage.removeItem(KEYS.TRIPS); }, []);
  const completeOnboarding = useCallback(() => { setOnboardingComplete(true); AsyncStorage.setItem(KEYS.ONBOARDING, "true"); }, []);
  const setShowTraffic = useCallback((v: boolean) => setShowTrafficState(v), []);

  return (
    <AppContext.Provider value={{
      locationGranted, requestLocationPermission,
      currentLat, currentLng, currentSpeed,
      activeAlert, currentSpeedLimit, nearbyZones, dismissAlert,
      hudMode, setHudMode,
      sosContact, setSosContact,
      communityReports, addReport,
      currentTrip, tripHistory, clearTripHistory,
      onboardingComplete, completeOnboarding,
      isOffline,
      navDestination, setNavDestination,
      activeRoute, altRoutes, selectRoute,
      navigationActive, startNavigation, stopNavigation,
      currentStepIdx, distToNextM, routeLoading,
      showTraffic, setShowTraffic,
      zonesOnRoute,
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
