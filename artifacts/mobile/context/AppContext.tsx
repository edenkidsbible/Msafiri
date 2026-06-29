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
import NetInfo from "@react-native-community/netinfo";
import { SPEED_ZONES, SpeedZone } from "@/data/speedZones";

export interface CommunityReport {
  id: string;
  type: "camera" | "police" | "accident" | "pothole" | "roadblock" | "clear";
  lat: number;
  lng: number;
  timestamp: number;
  confirmed: number;
}

export interface TripPoint {
  lat: number;
  lng: number;
  speed: number;
  time: number;
}

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

export interface SOSContact {
  name: string;
  phone: string;
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
}

const AppContext = createContext<AppContextValue | null>(null);

const KEYS = {
  TRIPS: "sdk_trips",
  REPORTS: "sdk_reports",
  HUD: "sdk_hud",
  SOS: "sdk_sos",
  ONBOARDING: "sdk_onboarding",
};

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180;
  const f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

const ALERT_DIST = 1000;
const IN_ZONE_DIST = 250;
const MIN_TRIP_DIST = 200;
const STOP_TIMEOUT_MS = 3 * 60 * 1000;

// Configure notification handler once
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

async function scheduleAlertNotification(zone: SpeedZone, distM: number): Promise<void> {
  if (Platform.OS === "web") return;
  const typeLabel =
    zone.type === "camera"
      ? "Speed Camera"
      : zone.type === "police"
      ? "Police Checkpoint"
      : "Speed Zone";
  const distLabel = distM >= 1000 ? `${(distM / 1000).toFixed(1)} km` : `${Math.round(distM)} m`;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `⚠️ ${typeLabel} Ahead — ${zone.speedLimit} km/h`,
      body: `${zone.name} is ${distLabel} away on ${zone.road}.`,
      data: { zoneId: zone.id },
    },
    trigger: null, // fire immediately
  });
}

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

  const alertZoneRef = useRef<string | null>(null);
  const alertDismissed = useRef(false);
  const tripRef = useRef<Partial<TripData> | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifGranted = useRef(false);

  // Load persisted data + request notification permission
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
        const fresh = parsed.filter((r) => Date.now() - r.timestamp < 24 * 3600 * 1000);
        setCommunityReports(fresh);
      }
      if (hud) setHudModeState(JSON.parse(hud));
      if (sos) setSosContactState(JSON.parse(sos));
      setOnboardingComplete(onboarded === "true");

      notifGranted.current = await requestNotificationPermission();
    })();
  }, []);

  // Offline / connectivity detection
  useEffect(() => {
    if (Platform.OS === "web") {
      const handleOnline = () => setIsOffline(false);
      const handleOffline = () => setIsOffline(true);
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
      setIsOffline(!navigator.onLine);
      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOffline(!(state.isConnected ?? true));
    });
    return unsubscribe;
  }, []);

  const requestLocationPermission = useCallback(async () => {
    if (Platform.OS === "web") {
      if ("geolocation" in navigator) setLocationGranted(true);
      return;
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    setLocationGranted(status === "granted");
  }, []);

  const handleLocation = useCallback(
    (lat: number, lng: number, speedMs: number | null) => {
      const kmh = speedMs != null && speedMs >= 0 ? speedMs * 3.6 : 0;
      setCurrentLat(lat);
      setCurrentLng(lng);
      setCurrentSpeed(kmh);

      const withDist = SPEED_ZONES.map((z) => ({
        ...z,
        distance: haversine(lat, lng, z.lat, z.lng),
      })).sort((a, b) => a.distance - b.distance);

      setNearbyZones(withDist.filter((z) => z.distance < 5000));

      const inZone = withDist.find((z) => z.distance <= IN_ZONE_DIST);
      setCurrentSpeedLimit(inZone ? inZone.speedLimit : null);

      const alertCandidate = withDist.find(
        (z) => z.distance > IN_ZONE_DIST && z.distance <= ALERT_DIST
      );

      if (alertCandidate) {
        if (alertCandidate.id !== alertZoneRef.current) {
          // New zone entered — fire haptic + local notification
          alertZoneRef.current = alertCandidate.id;
          alertDismissed.current = false;
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          if (notifGranted.current) {
            scheduleAlertNotification(alertCandidate, alertCandidate.distance);
          }
        }
        if (!alertDismissed.current) setActiveAlert(alertCandidate);
      } else {
        const stillInRange =
          alertZoneRef.current &&
          withDist.find((z) => z.id === alertZoneRef.current && z.distance <= ALERT_DIST);
        if (!stillInRange) {
          alertZoneRef.current = null;
          alertDismissed.current = false;
          setActiveAlert(null);
        }
      }

      // Trip tracking
      if (kmh > 5) {
        if (stopTimer.current) {
          clearTimeout(stopTimer.current);
          stopTimer.current = null;
        }
        if (!tripRef.current) {
          const t: Partial<TripData> = {
            id: genId(),
            startTime: Date.now(),
            distance: 0,
            maxSpeed: kmh,
            avgSpeed: kmh,
            alertsCount: 0,
            positions: [{ lat, lng, speed: kmh, time: Date.now() }],
          };
          tripRef.current = t;
          setCurrentTrip({ ...t });
        } else {
          const t = tripRef.current;
          const positions = t.positions ?? [];
          const last = positions[positions.length - 1];
          const added = last ? haversine(last.lat, last.lng, lat, lng) : 0;
          const newPos = [...positions, { lat, lng, speed: kmh, time: Date.now() }];
          const trimmed = newPos.length > 300 ? newPos.slice(-150) : newPos;
          const updated: Partial<TripData> = {
            ...t,
            distance: (t.distance ?? 0) + added,
            maxSpeed: Math.max(t.maxSpeed ?? 0, kmh),
            avgSpeed: trimmed.reduce((s, p) => s + p.speed, 0) / trimmed.length,
            positions: trimmed,
          };
          tripRef.current = updated;
          setCurrentTrip({ ...updated });
        }
      } else if (tripRef.current) {
        if (!stopTimer.current) {
          stopTimer.current = setTimeout(() => {
            const t = tripRef.current;
            if (t && (t.distance ?? 0) >= MIN_TRIP_DIST) {
              const done: TripData = {
                id: t.id ?? genId(),
                startTime: t.startTime ?? Date.now(),
                endTime: Date.now(),
                distance: t.distance ?? 0,
                maxSpeed: t.maxSpeed ?? 0,
                avgSpeed: t.avgSpeed ?? 0,
                alertsCount: t.alertsCount ?? 0,
                positions: t.positions ?? [],
              };
              setTripHistory((prev) => {
                const updated = [done, ...prev].slice(0, 50);
                AsyncStorage.setItem(KEYS.TRIPS, JSON.stringify(updated));
                return updated;
              });
            }
            tripRef.current = null;
            setCurrentTrip(null);
            stopTimer.current = null;
          }, STOP_TIMEOUT_MS);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!locationGranted) return;
    let cleanup: (() => void) | undefined;

    if (Platform.OS !== "web") {
      (async () => {
        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 1000,
            distanceInterval: 5,
          },
          (loc) =>
            handleLocation(loc.coords.latitude, loc.coords.longitude, loc.coords.speed)
        );
        cleanup = () => sub.remove();
      })();
    } else if ("geolocation" in navigator) {
      const id = navigator.geolocation.watchPosition(
        (pos) =>
          handleLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.speed),
        (err) => console.warn("Geo:", err),
        { enableHighAccuracy: true }
      );
      cleanup = () => navigator.geolocation.clearWatch(id);
    }

    return () => cleanup?.();
  }, [locationGranted, handleLocation]);

  const dismissAlert = useCallback(() => {
    alertDismissed.current = true;
    setActiveAlert(null);
  }, []);

  const setHudMode = useCallback((v: boolean) => {
    setHudModeState(v);
    AsyncStorage.setItem(KEYS.HUD, JSON.stringify(v));
  }, []);

  const setSosContact = useCallback((c: SOSContact | null) => {
    setSosContactState(c);
    if (c) AsyncStorage.setItem(KEYS.SOS, JSON.stringify(c));
    else AsyncStorage.removeItem(KEYS.SOS);
  }, []);

  const addReport = useCallback(
    (type: CommunityReport["type"], lat: number, lng: number) => {
      const r: CommunityReport = {
        id: genId(),
        type,
        lat,
        lng,
        timestamp: Date.now(),
        confirmed: 1,
      };
      setCommunityReports((prev) => {
        const updated = [r, ...prev];
        AsyncStorage.setItem(KEYS.REPORTS, JSON.stringify(updated));
        return updated;
      });
      if (tripRef.current) {
        tripRef.current.alertsCount = (tripRef.current.alertsCount ?? 0) + 1;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    []
  );

  const clearTripHistory = useCallback(() => {
    setTripHistory([]);
    AsyncStorage.removeItem(KEYS.TRIPS);
  }, []);

  const completeOnboarding = useCallback(() => {
    setOnboardingComplete(true);
    AsyncStorage.setItem(KEYS.ONBOARDING, "true");
  }, []);

  return (
    <AppContext.Provider
      value={{
        locationGranted,
        requestLocationPermission,
        currentLat,
        currentLng,
        currentSpeed,
        activeAlert,
        currentSpeedLimit,
        nearbyZones,
        dismissAlert,
        hudMode,
        setHudMode,
        sosContact,
        setSosContact,
        communityReports,
        addReport,
        currentTrip,
        tripHistory,
        clearTripHistory,
        onboardingComplete,
        completeOnboarding,
        isOffline,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
