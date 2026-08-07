// Per-tab error boundary — isolates a crash in this tab from the other tabs
// and the navigation shell. Expo Router picks this up automatically.
export { ErrorBoundary } from "@/components/ErrorBoundary";

import React, { useRef, useState, useMemo, useCallback, useEffect } from "react";
import { FLAT_LIST_PROPS, SCROLL_PROPS } from "@/lib/scrollProps";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useApp } from "@/context/AppContext";
import { useDashcam } from "@/context/DashcamContext";
import DriveAlertOverlay from "@/components/DriveAlertOverlay";
import TripSummaryModal, { type TripSummaryData } from "@/components/TripSummaryModal";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";
import SOSButton from "@/components/SOSButton";
import CrashDetectedModal from "@/components/CrashDetectedModal";
import KenyaFlagPill from "@/components/KenyaFlagPill";
import DriveMapView, { type DriveMapViewHandle } from "@/components/DriveMapView";
import { isCivilTwilight } from "@/utils/solarTwilight";
import ReportModal from "@/components/ReportModal";
import { CrosshairPickerModal } from "@/components/CrosshairPicker";
import IncidentConfirmationPrompt from "@/components/IncidentConfirmationPrompt";
import { useIncidentConfirmationPrompt } from "@/hooks/useIncidentConfirmationPrompt";
import { nominatimSearch, GeoResult } from "@/utils/geocoding";
import { listSavedPlaces, type SavedPlace } from "@/utils/tripsApi";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import {
  loadRecentSearches,
  saveRecentSearch,
  removeRecentSearch,
  clearRecentSearches,
} from "@/utils/recentSearches";
import { snapToRoad, getRoadName } from "@/utils/snapToRoad";
import { resolveIncidentType } from "@/constants/incidentTypes";
import { playSound, setSoundsMuted } from "@/utils/sound";
import { speakAlert, setAlertVoiceDisabled } from "@/utils/alertTts";
import { apiPost } from "@/utils/apiClient";
import { useDriveScore } from "@/hooks/useDriveScore";
import {
  startDriveSession, updateDriveSession, endDriveSession,
  scoreColor as getScoreColor, scoreLabel as getScoreLabel,
} from "@/utils/driveSessionApi";
import { loadVehicles, type SavedVehicle } from "@/utils/savedVehicles";
import { recordSession } from "@/utils/vehicleSessionMap";
import { getMakeById, getModelById } from "@/data/carModels";

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Animated TouchableOpacity for the pulsing trip-mode alert banner.
const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

function distStr(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180, f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180, dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function durationStr(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}min` : `${m} min`;
}

function incidentSummaryParts(incidents: { type: string; source: string }[]): { emoji: string; label: string }[] {
  const camCount = incidents.filter((i) => i.type === "camera").length;
  const policeCount = incidents.filter((i) => i.type === "police").length;
  const reportCount = incidents.filter((i) => i.source === "report").length;
  const liveCount = incidents.filter((i) => i.source === "here").length;
  const parts: { emoji: string; label: string }[] = [];
  if (camCount > 0) parts.push({ emoji: "📷", label: `${camCount} camera${camCount === 1 ? "" : "s"}` });
  if (policeCount > 0) parts.push({ emoji: "👮", label: `${policeCount} police` });
  if (reportCount > 0) parts.push({ emoji: "📢", label: `${reportCount} report${reportCount === 1 ? "" : "s"}` });
  if (liveCount > 0) parts.push({ emoji: "🔴", label: `${liveCount} live alert${liveCount === 1 ? "" : "s"}` });
  return parts;
}

// ─── Map error fallback ───────────────────────────────────────────────────────
// Rendered by the ErrorBoundary that wraps DriveMapView when the map layer
// throws (e.g. a bad Marker coordinate from a freshly-pushed zone or relocated
// report). Navigation audio and step-tracking continue uninterrupted because
// this fallback never touches AppContext — it only replaces the visual map.

function MapErrorFallback({ resetError }: { error: Error; resetError: () => void }) {
  return (
    <View style={mapErrStyles.container}>
      <View style={mapErrStyles.card}>
        <Text style={mapErrStyles.icon}>🗺️</Text>
        <Text style={mapErrStyles.title}>Map display error</Text>
        <Text style={mapErrStyles.body}>
          Navigation audio and turn guidance continue.{"\n"}
          The map will reload when you tap below.
        </Text>
        <TouchableOpacity style={mapErrStyles.btn} onPress={resetError} activeOpacity={0.8}>
          <Text style={mapErrStyles.btnTxt}>Reload map</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const mapErrStyles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0D1117",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    backgroundColor: "#1C2128",
    borderRadius: 16,
    padding: 28,
    marginHorizontal: 32,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#30363D",
  },
  icon:   { fontSize: 40, marginBottom: 12 },
  title:  { color: "#F0F6FC", fontSize: 17, fontWeight: "700", marginBottom: 8, textAlign: "center" },
  body:   { color: "#8B949E", fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: 20 },
  btn:    { backgroundColor: "#1976D2", borderRadius: 10, paddingHorizontal: 24, paddingVertical: 11 },
  btnTxt: { color: "#FFF", fontSize: 15, fontWeight: "600" },
});

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function DriveScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    locationGranted, requestLocationPermission,
    currentSpeed, currentSpeedLimit, activeAlert, activeAlertExtras, dismissAlert, nearbyZones, communityReports,
    hereIncidents,
    setThemeOverride,
    navDestination, setNavDestination,
    activeRoute, altRoutes, selectRoute, routeLoading,
    routeIncidentsAhead, routeTrafficDelayS, setRouteIncidentsExpanded,
    showTraffic, setShowTraffic,
    addReport, currentLat, currentLng,
    pendingConfirmationReport, setPendingConfirmationReport,
    setPendingConfirmationSource,
    isSharingTrip, shareLink, startSharingTrip, stopSharingTrip,
    driverName, setDriverName,
    setMapPickerActive,
    deviceId,
    crashDetected, clearCrash, crashAssistantId,
    crashSensitivity,
    setDashcamActive,
    setNavTripActive, setNavTripPaused,
  } = useApp();

  const { markDismissed } = useIncidentConfirmationPrompt();

  // Dashcam — REC indicator and toggle in the action pills row
  const {
    isRecording: dashcamRecording,
    backgroundRecordPending: dashcamPending,
    openDashcam,
    stopDashcam,
    stopAndSaveDashcam,
    lockCurrentClip,
    startBackgroundRecording,
    requestDashcamPermissions,
  } = useDashcam();

  // Proactively request camera + microphone permissions each time the drive
  // screen comes into focus — before the user taps the dashcam button.
  // This ensures first-time users see both system dialogs in the correct order
  // (camera → 500 ms gap → microphone) rather than having them fire back-to-back
  // when recording is already trying to start, which causes iOS to drop one.
  // The call is a no-op when both permissions are already granted.
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== "web") {
      requestDashcamPermissions().catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  // Sync dashcam recording state into AppContext so the accelerometer
  // crash detector runs even when navigation is not active.
  useEffect(() => { setDashcamActive(dashcamRecording); }, [dashcamRecording, setDashcamActive]);

  // ── Crash detection handlers ───────────────────────────────────────────
  const handleStartCrashReport = useCallback(() => {
    clearCrash();
    const targetId = crashAssistantId;
    if (targetId) {
      router.push(`/crash-assistant/${targetId}`);
    }
  }, [crashAssistantId, clearCrash]);

  const handleCrashExpired = useCallback(async () => {
    // Fire-and-forget: send SMS to emergency contacts
    if (deviceId) {
      apiPost("/emergency/alert", {
        deviceId,
        lat: currentLatRef.current ?? 0,
        lng: currentLngRef.current ?? 0,
        driverName,
      }).catch(() => {});
    }
    // Lock the current dashcam segment as a crash clip
    if (dashcamRecording) lockCurrentClip("crash");
    clearCrash();
  }, [deviceId, driverName, dashcamRecording, lockCurrentClip, clearCrash]);

  // Stable refs for currentLat/currentLng so effects that only need the
  // *current* position for a calculation (not to re-trigger on every fix)
  // can read from the ref instead of listing the state in their deps array.
  // This prevents those effects from re-running at the full GPS rate (1 Hz).
  const currentLatRef = useRef(currentLat);
  const currentLngRef = useRef(currentLng);
  useEffect(() => { currentLatRef.current = currentLat; }, [currentLat]);
  useEffect(() => { currentLngRef.current = currentLng; }, [currentLng]);

  // Drive-page dark/light state mirrors the app-wide Appearance setting exactly
  // (Settings > Display > Appearance), so this FAB and that screen always agree.
  const isDark = c.isDark;

  const topInset    = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;
  const tabBarH     = Platform.OS === "web" ? 84 : 96;

  // Responsive scaling — iPhone SE / 13 mini / older Pros are 375-390pt wide.
  // At that width the speed strip becomes too cramped at full size.
  const { width: screenW } = useWindowDimensions();
  const isSmall = screenW <= 390;

  // Measured pixel width of the emoji row — updated by onLayout.
  // Used to derive how many emojis fit without hardcoding a count.
  const emojiRowWidthRef = useRef(0);

  const [searchText, setSearchText] = useState("");
  const [searchInputFocused, setSearchInputFocused] = useState(false);
  const [geoResults, setGeoResults] = useState<GeoResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [showReport, setShowReport] = useState(false);
  // CrosshairPickerModal request — lifted out of ReportModal to sit at the
  // screen root so it is never nested inside another Modal (fixes iOS silent
  // presentation failure) and DriveMapView can unmount its map while it's open.
  const [crosshairRequest, setCrosshairRequest] = useState<{
    lat: number; lng: number; onConfirm: (lat: number, lng: number) => void;
  } | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recentSearches, setRecentSearches] = useState<GeoResult[]>([]);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [sharingLoading, setSharingLoading] = useState(false);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [speedStripHeight, setSpeedStripHeight] = useState(150);
  const [showNearbySheet, setShowNearbySheet] = useState(false);
  const driveMapRef = useRef<DriveMapViewHandle>(null);

  // ── Map drift (driver panned away from GPS position during navigation) ────
  const [mapDrifted, setMapDrifted] = useState(false);
  // When an alert is tapped in the Nearby sheet we force drift=true so GPS
  // follow stops before focusCoords animates. This flag tells the auto-resume
  // effect to use a shorter 8 s window (peek) instead of the 30 s manual-pan
  // window, so the driver is snapped back quickly without waiting.
  const alertFocusModeRef = useRef(false);
  // ── Live Trip state ──────────────────────────────────────────────────────
  const [tripActive, setTripActive] = useState(false);
  // Post-trip summary — populated at the moment a trip is stopped so we can
  // display stats even after tripActive clears and state resets.
  const [tripSummaryData, setTripSummaryData] = useState<TripSummaryData | null>(null);
  const [tripPaused, setTripPaused] = useState(false);
  // Refs for accurate elapsed-time accounting across pauses
  const pausedAtMsRef = useRef<number | null>(null);
  const totalPausedMsRef = useRef(0);
  // Elapsed seconds during the trip — drives the Drive Safely "Duration" tile.
  const [tripElapsedS, setTripElapsedS] = useState(0);
  // Audio Alerts master toggle (Drive Mode panel) — persisted, gates both the
  // Yna Agalo voice alerts and the short notification chimes globally.
  const [audioAlertsOn, setAudioAlertsOn] = useState(true);
  // Guards the one-shot auto-start effect (Start Driving → instant trip).
  const autoStartedRef = useRef(false);
  // Promise for the vehicle load so useFocusEffect can await it if needed
  const vehicleLoadPromiseRef = useRef<Promise<SavedVehicle[]> | null>(null);

  // 3-second pre-trip countdown (null = no countdown, 3/2/1 = counting down)
  const [countdownValue, setCountdownValue] = useState<number | null>(null);
  const countdownActiveRef = useRef(false);

  // ── Multi-vehicle: picker shown before auto-start ─────────────────────────
  const [driveVehicles,    setDriveVehicles]    = useState<SavedVehicle[]>([]);
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);
  const driveVehicleRef = useRef<SavedVehicle | null>(null); // vehicle for the current trip
  // Stable ref keeps the vehicles list readable from the focus-effect closure
  const driveVehiclesRef = useRef<SavedVehicle[]>([]);
  const [tripStartTime, setTripStartTime] = useState<Date | null>(null);
  const [liveTripSheetHeight, setLiveTripSheetHeight] = useState(0);
  const avgSpeedSumRef = useRef(0);
  const avgSpeedCountRef = useRef(0);
  const [avgSpeedDisplay, setAvgSpeedDisplay] = useState(0);
  // Drive-session server ID (null until the POST /drive-sessions call resolves)
  const sessionIdRef     = useRef<string | null>(null);
  // Ref-copy of tripStartTime for use inside callbacks without stale closures
  const tripStartTimeRef = useRef<Date | null>(null);
  // Tracks the last known tripActive value so the end-trip effect can detect
  // the false → true transition and fire only once per trip.
  const prevTripActiveRef = useRef(false);
  // Alert counters incremented during the trip — sent to the server on end
  const tripSpeedCamRef  = useRef(0);
  const tripPoliceRef    = useRef(0);

  // ── Driving score — sensor hook ───────────────────────────────────────────
  // Subscribes to the accelerometer only during a Live Trip and classifies
  // harsh brakes, rapid accels, and sharp turns for real-time score display.
  const driveScore = useDriveScore({
    active:            tripActive,
    currentSpeed,
    currentSpeedLimit,
    currentLat,
    currentLng,
  });

  // Brief toast shown after a cluster dismiss — tells the driver how long alerts
  // are paused near this area so they know what to expect if they pass again.
  const [pauseNote, setPauseNote] = useState<string | null>(null);
  const pauseNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load recent searches from AsyncStorage on mount
  useEffect(() => {
    loadRecentSearches().then(setRecentSearches).catch(() => {});
  }, []);

  // Load saved places (Home / Work / custom) — reload when search is focused
  // so changes made in the Trips tab are immediately reflected here.
  useEffect(() => {
    if (!deviceId) return;
    listSavedPlaces(deviceId).then(setSavedPlaces).catch(() => {});
  }, [deviceId]);
  useEffect(() => {
    if (!searchInputFocused || !deviceId) return;
    listSavedPlaces(deviceId).then(setSavedPlaces).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInputFocused]);


  // overviewMode removed — the map is always freely pannable during navigation.
  // mapDrifted tracks whether the driver has panned away from their GPS position;
  // the Recenter button appears when drifted and snaps back on tap.

  // ── Night mode auto-switch (Task #38) ────────────────────────────────────────
  // Derives civil twilight from the driver's GPS position — no network call.
  // manualThemeRef: set when the driver taps the moon/sun FAB this session,
  // which suppresses automatic switching for the rest of the session (resets on
  // app restart — not persisted).
  const manualThemeRef = useRef(false);
  const screenFade     = useRef(new Animated.Value(1)).current;

  // triggerAutoSwitch — fade out → swap theme → fade in (300 ms total)
  const triggerAutoSwitch = useCallback((next: "dark" | "light") => {
    Animated.timing(screenFade, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      setThemeOverride(next);
      Animated.timing(screenFade, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    });
  }, [screenFade, setThemeOverride]);

  // Ref bag keeps a stable snapshot of the values the interval reads each tick
  // so we don't need to tear-down/re-create the interval on every GPS fix.
  const autoNightRef = useRef({ isDark: c.isDark, lat: currentLat, lng: currentLng });
  useEffect(() => {
    autoNightRef.current = { isDark: c.isDark, lat: currentLat, lng: currentLng };
  });

  useEffect(() => {
    const tick = () => {
      if (manualThemeRef.current) return;
      const { isDark: dark, lat, lng } = autoNightRef.current;
      if (lat == null || lng == null) return;
      const night = isCivilTwilight(lat, lng, new Date());
      if (night && !dark)  triggerAutoSwitch("dark");
      if (!night && dark)  triggerAutoSwitch("light");
    };
    tick(); // check immediately on mount
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [triggerAutoSwitch]);

  // Track avg speed during Live Trip
  useEffect(() => {
    if (!tripActive || currentSpeed <= 0) return;
    avgSpeedSumRef.current += currentSpeed;
    avgSpeedCountRef.current++;
    setAvgSpeedDisplay(Math.round(avgSpeedSumRef.current / avgSpeedCountRef.current));
  }, [tripActive, currentSpeed]);

  // Auto-resume timers (8 s / 30 s) have been intentionally removed.
  // The map now stays wherever the driver panned it until they explicitly tap
  // the Recenter button.  This gives the driver full control and removes the
  // disorienting snap-back that was happening mid-inspection.
  // alertFocusModeRef is kept for callers that set it, but it no longer
  // triggers an auto-resume countdown.


  // Extracted so both the direct path and the name-prompt confirm button can call it.
  const doStartSharing = useCallback(async (name: string) => {
    setSharingLoading(true);
    try {
      const link = await startSharingTrip();
      if (!link) {
        // Session creation failed (network error or device ID not ready) —
        // surface the problem so the driver knows to retry.
        Alert.alert("Couldn't start sharing", "Check your connection and try again.");
        return;
      }
      const trimmed = name.trim();
      const namePrefix = trimmed
        ? `${trimmed} is sharing their live trip 📍`
        : "Follow my live trip 📍";
      // iOS: pass `url` as a separate field so the share sheet apps (Messages,
      // WhatsApp, etc.) render it as a tappable link card rather than plain text.
      // Android's Share API ignores the `url` field so embed the link in `message`.
      await Share.share(
        Platform.OS === "ios"
          ? { message: namePrefix, url: link }
          : {
              message: `${namePrefix}\nTap the link for real-time ETA and location:\n${link}`,
              title: "Track my trip — Msafiri Kenya",
            }
      );
    } finally {
      setSharingLoading(false);
    }
  }, [startSharingTrip]);

  const startTrip = useCallback(() => {
    if (countdownActiveRef.current || tripActive) return; // guard double-start
    countdownActiveRef.current = true;
    // Reset stats upfront so they read zero during the countdown
    avgSpeedSumRef.current = 0;
    avgSpeedCountRef.current = 0;
    setAvgSpeedDisplay(0);
    tripSpeedCamRef.current = 0;
    tripPoliceRef.current   = 0;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Show 3-second countdown, then launch the trip
    setCountdownValue(3);
    setTimeout(() => setCountdownValue(2), 1000);
    setTimeout(() => setCountdownValue(1), 2000);
    setTimeout(() => {
      setCountdownValue(null);
      countdownActiveRef.current = false;
      totalPausedMsRef.current = 0;
      pausedAtMsRef.current = null;
      const now = new Date();
      tripStartTimeRef.current = now;
      setTripActive(true);
      setTripPaused(false);
      setNavTripActive(true);
      setNavTripPaused(false);
      setTripStartTime(now);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Create server-side session (fire-and-forget — trip works offline too)
      if (deviceId) {
        startDriveSession(deviceId, currentLat, currentLng)
          .then((id) => {
            sessionIdRef.current = id;
            // Record which vehicle drove this session for per-vehicle garage stats
            const vid = driveVehicleRef.current?.id;
            if (vid) recordSession(vid, id).catch(() => {});
          })
          .catch(() => {}); // gracefully degraded — end call will no-op when null
      }
    }, 3000);
  }, [tripActive, deviceId, currentLat, currentLng]);

  // ── Load vehicles once on mount so the picker has data ───────────────────
  // We store the Promise so useFocusEffect can await it when the tab opens
  // before the async load completes — fixes the race where the auto-start
  // fires before the list is ready and always skips the multi-vehicle picker.
  useEffect(() => {
    const p = loadVehicles().then(list => {
      driveVehiclesRef.current = list;
      setDriveVehicles(list);
      // Pre-select default vehicle so single-vehicle users never see the picker
      const def = list.find(v => v.isDefault) ?? list[0];
      if (def) driveVehicleRef.current = def;
      return list;
    }).catch(() => [] as SavedVehicle[]);
    vehicleLoadPromiseRef.current = p;
  }, []);

  // ── Drive Mode auto-start ─────────────────────────────────────────────────
  // Tapping "Start Driving" on Home lands here and the trip starts instantly.
  // Exception: when a destination is already set (Map tab navigation or a
  // deep-link), the route preview sheet shows first so the driver can inspect
  // alt routes and tap Start themselves — preserving the pre-overhaul flow.
  //
  // When the user has multiple saved vehicles, show a picker first so the trip
  // is recorded against the right vehicle. The picker then calls startTrip().
  //
  // Uses useFocusEffect (not useEffect) because drive.tsx is a permanently-
  // mounted hidden tab. A mount-only effect fires exactly once and never
  // re-triggers when the user stops a trip and taps "Start Driving" again.
  // useFocusEffect re-runs every time the screen comes into focus, and the
  // autoStartedRef guard prevents double-starting while a trip is already
  // active. The ref is reset in the effect below when tripActive goes false.
  const { noAutoStart } = useLocalSearchParams<{ noAutoStart?: string }>();
  useFocusEffect(useCallback(() => {
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    if (!navDestination && noAutoStart !== "1") {
      // Await the vehicle load to avoid the race where this fires before
      // the async load completes and the picker is wrongly skipped.
      const proceed = (list: SavedVehicle[]) => {
        if (list.length > 1) {
          setShowVehiclePicker(true);
        } else {
          startTrip();
        }
      };
      if (vehicleLoadPromiseRef.current) {
        vehicleLoadPromiseRef.current.then(proceed);
      } else {
        proceed(driveVehiclesRef.current);
      }
    }
  // navDestination and noAutoStart are intentionally included so a fresh
  // destination set by the Map tab is visible when focus arrives.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navDestination, noAutoStart]));

  // Reset the auto-start guard and vehicle picker state when the trip ends.
  useEffect(() => {
    if (!tripActive) {
      autoStartedRef.current = false;
      // Clear drive vehicle so the picker shows fresh on the next trip
      driveVehicleRef.current = driveVehiclesRef.current.find(v => v.isDefault)
        ?? driveVehiclesRef.current[0]
        ?? null;
    }
  }, [tripActive]);

  // Tick the trip duration once per second while active.
  useEffect(() => {
    if (!tripActive) { setTripElapsedS(0); return; }
    if (tripPaused) return; // paused — don't tick, keep displayed value frozen
    const id = setInterval(() => {
      const start = tripStartTimeRef.current;
      if (start) {
        const raw = Date.now() - start.getTime() - totalPausedMsRef.current;
        setTripElapsedS(Math.max(0, Math.round(raw / 1000)));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [tripActive, tripPaused]);

  // Restore the persisted Audio Alerts preference on mount.
  useEffect(() => {
    AsyncStorage.getItem("sdk_audio_alerts_off").then((v) => {
      const on = v !== "1";
      setAudioAlertsOn(on);
      setAlertVoiceDisabled(!on);
      setSoundsMuted(!on);
    }).catch(() => {});
  }, []);

  // ── Trip Pause / Resume ───────────────────────────────────────────────────
  const pauseTrip = useCallback(() => {
    if (!tripActive || tripPaused) return;
    pausedAtMsRef.current = Date.now();
    setTripPaused(true);
    setNavTripPaused(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [tripActive, tripPaused, setNavTripPaused]);

  const resumeTrip = useCallback(() => {
    if (!tripActive || !tripPaused) return;
    if (pausedAtMsRef.current != null) {
      totalPausedMsRef.current += Date.now() - pausedAtMsRef.current;
      pausedAtMsRef.current = null;
    }
    setTripPaused(false);
    setNavTripPaused(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, [tripActive, tripPaused, setNavTripPaused]);

  const toggleAudioAlerts = useCallback(() => {
    setAudioAlertsOn((prev) => {
      const next = !prev;
      setAlertVoiceDisabled(!next);
      setSoundsMuted(!next);
      AsyncStorage.setItem("sdk_audio_alerts_off", next ? "0" : "1").catch(() => {});
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      return next;
    });
  }, []);

  const stopTrip = useCallback(() => {
    setTripActive(false);
    setTripPaused(false);
    setNavTripActive(false);
    setNavTripPaused(false);
    pausedAtMsRef.current = null;
    totalPausedMsRef.current = 0;
    setTripStartTime(null);
    setNavDestination(null);
    setSearchText("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Stop dashcam and save the current clip when driving ends
    if (dashcamRecording) stopAndSaveDashcam();
    // Finalisation is handled by the prevTripActiveRef effect below.
  }, [setNavDestination, dashcamRecording, stopAndSaveDashcam, setNavTripActive, setNavTripPaused]);

  /**
   * captureAndStop — captures a snapshot of all trip stats at the exact moment
   * the driver taps stop, BEFORE state resets clear the values, then calls
   * stopTrip(). The captured data is shown in TripSummaryModal so the driver
   * sees their stats without navigating away.
   */
  const captureAndStop = useCallback(() => {
    const snap      = driveScore.getSnapshot();
    const startTime = tripStartTimeRef.current;
    // Compute net elapsed (total wall-clock minus any paused durations)
    const elapsedMs = startTime
      ? Date.now() - startTime.getTime() - totalPausedMsRef.current
      : tripElapsedS * 1000;
    const durationS = Math.max(0, Math.round(elapsedMs / 1000));

    setTripSummaryData({
      durationS,
      distanceM:         snap.distanceM,
      avgSpeedKmh:       avgSpeedDisplay,
      maxSpeedKmh:       snap.maxSpeedKmh,
      score:             snap.score,
      harshBrakes:       snap.harshBrakes,
      harshAccels:       snap.harshAccels,
      sharpTurns:        snap.sharpTurns,
      speedingMinutes:   snap.speedingMinutes,
      smoothMinutes:     snap.smoothMinutes,
      speedCameraAlerts: tripSpeedCamRef.current,
      policeAlerts:      tripPoliceRef.current,
      hadDashcam:        dashcamRecording,
      isSharing:         isSharingTrip,
    });

    stopTrip();
    // Navigation is intentionally omitted here — the TripSummaryModal handles
    // where the driver goes next (home, clips, history, etc.).
  }, [
    driveScore, tripElapsedS, avgSpeedDisplay,
    dashcamRecording, isSharingTrip,
    stopTrip,
  ]);

  // ── End-trip effect: finalise server session when tripActive goes false ───
  useEffect(() => {
    const wasActive = prevTripActiveRef.current;
    prevTripActiveRef.current = tripActive;
    if (!tripActive && wasActive) {
      const sid = sessionIdRef.current;
      if (sid && deviceId) {
        const snap      = driveScore.getSnapshot();
        const startTime = tripStartTimeRef.current;
        const durationS = startTime
          ? Math.max(0, Math.round((Date.now() - startTime.getTime()) / 1000))
          : 0;
        // Only persist sessions where the driver actually moved ≥ 50 m at speed
        if (snap.distanceM < 50) {
          sessionIdRef.current     = null;
          tripStartTimeRef.current = null;
          return;
        }
        endDriveSession(sid, deviceId, {
          endLat:            currentLat,
          endLng:            currentLng,
          distanceM:         snap.distanceM,
          durationS,
          avgSpeedKmh:       avgSpeedDisplay,
          maxSpeedKmh:       snap.maxSpeedKmh,
          harshBrakes:       snap.harshBrakes,
          harshAccels:       snap.harshAccels,
          sharpTurns:        snap.sharpTurns,
          speedingMinutes:   snap.speedingMinutes,
          smoothMinutes:     snap.smoothMinutes,
          speedCameraAlerts: tripSpeedCamRef.current,
          policeAlerts:      tripPoliceRef.current,
        }).catch(() => {});
        sessionIdRef.current     = null;
        tripStartTimeRef.current = null;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripActive]);

  // ── 30-second periodic stats push during a Live Trip ─────────────────────
  useEffect(() => {
    if (!tripActive || !deviceId) return;
    const id = setInterval(() => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const snap = driveScore.getSnapshot();
      updateDriveSession(sid, deviceId, {
        distanceM:      snap.distanceM,
        maxSpeedKmh:    snap.maxSpeedKmh,
        avgSpeedKmh:    avgSpeedDisplay,
        harshBrakes:    snap.harshBrakes,
        harshAccels:    snap.harshAccels,
        sharpTurns:     snap.sharpTurns,
        speedingMinutes: snap.speedingMinutes,
        smoothMinutes:  snap.smoothMinutes,
      }).catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripActive, deviceId]);

  const handleSharePress = useCallback(async () => {
    if (isSharingTrip) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await stopSharingTrip();
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Show the name prompt the very first time the driver taps share.
    // After that (prompted = true) we go straight to sharing.
    const prompted = await AsyncStorage.getItem("sdk_share_name_prompted");
    if (!prompted) {
      setNameInput(driverName); // pre-fill if they already set a name somehow
      setShowNamePrompt(true);
      return;
    }

    await doStartSharing(driverName);
  }, [isSharingTrip, stopSharingTrip, doStartSharing, driverName]);

  const handleStopPress = useCallback(() => {
    stopTrip();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [stopTrip]);

  // Centralises search teardown so every dismiss path (outside tap, blur,
  // chevron button) all go through one place.
  const dismissSearch = useCallback(() => {
    setShowResults(false);
    setGeoResults([]);
    setSearchInputFocused(false);
    Keyboard.dismiss();
  }, []);

  const overLimit  = currentSpeedLimit != null && currentSpeed > currentSpeedLimit;
  const hasRoute   = !!activeRoute;
  const isMapMode  = hasRoute && !showResults;

  // alertOverlayPulse ref declared early (rule of hooks: same order every render).
  // The driving useEffect lives after primaryAlert's useMemo below.
  const alertOverlayPulse = useRef(new Animated.Value(1)).current;
  // Whole-overlay heartbeat scale — animated in the same loop as the ring
  // opacity so the entire alert overlay visibly "beats" when an alert is near.
  const alertOverlayScale = useRef(new Animated.Value(1)).current;

  // Nearest incident ahead — considers BOTH static speed zones AND community
  // reports so a just-reported broken-down vehicle beats a distant speed camera.
  // All nearby alerts for the badge + bottom sheet (non-navigation mode)
  const nearbyAlertCandidates = useMemo(() => {
    type NearbyCandidate = {
      id: string; type: string; typeName: string; distanceM: number;
      road?: string; speedLimit?: number; emoji: string;
      lat: number; lng: number;
      /** True when this candidate came from HERE Live Traffic (not community report / zone). */
      isHere?: boolean;
    };
    const results: NearbyCandidate[] = [];
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const NEARBY_RADIUS_M = 3000;
    const now = Date.now();

    // Speed zones within 3 km
    for (const z of nearbyZones) {
      if (z.distance > NEARBY_RADIUS_M) break; // sorted ascending
      results.push({
        id: z.id, type: z.type, typeName: resolveIncidentType(z.type).label,
        distanceM: z.distance, road: z.road, speedLimit: z.speedLimit,
        emoji: resolveIncidentType(z.type).emoji,
        lat: z.lat, lng: z.lng,
      });
    }

    // Community reports within 3 km, < 2 h old
    if (currentLat != null && currentLng != null) {
      for (const r of communityReports) {
        if (r.status === "expired" || r.status === "denied") continue;
        if (now - r.timestamp > TWO_HOURS) continue;
        const d = haversineM(currentLat, currentLng, r.lat, r.lng);
        if (d > NEARBY_RADIUS_M) continue;
        results.push({
          id: r.id, type: r.type, typeName: resolveIncidentType(r.type).label,
          distanceM: d, road: r.roadName, speedLimit: r.speedLimit ?? undefined,
          emoji: resolveIncidentType(r.type).emoji,
          lat: r.lat, lng: r.lng,
        });
      }

      // HERE Live Traffic incidents within 3 km (non-expired)
      for (const h of hereIncidents) {
        if (h.endTime != null && h.endTime < now) continue;
        const d = haversineM(currentLat, currentLng, h.lat, h.lng);
        if (d > NEARBY_RADIUS_M) continue;
        results.push({
          id: h.id, type: h.type, typeName: resolveIncidentType(h.type).label,
          distanceM: d, road: h.roadName,
          emoji: resolveIncidentType(h.type).emoji,
          lat: h.lat, lng: h.lng,
          isHere: true,
        });
      }
    }

    return results.sort((a, b) => a.distanceM - b.distanceM);
  }, [nearbyZones, communityReports, hereIncidents, currentLat, currentLng]);

  const primaryAlert = useMemo(() => {
    // With an active route, routeIncidentsAhead already merges zones + reports
    // on the route and sorts by distance remaining — use it directly.
    if (activeRoute && routeIncidentsAhead.length > 0) {
      // Skip incidents within 250 m — those are in-zone or just-passed.
      // The DriveAlertOverlay owns that range; the strip badge shows lookahead only.
      // Speed-camera priority: a camera ahead outranks other incident types
      // even when they are nearer — the rest stay reachable via the list.
      const ahead = routeIncidentsAhead.filter(i => (i.aheadDistanceM ?? 0) > 250);
      const inc = ahead.find(i => i.type === "camera") ?? ahead[0];
      if (inc) {
        return {
          type:       inc.type,
          typeName:   resolveIncidentType(inc.type).label,
          speedLimit: inc.speedLimit,
          distanceM:  inc.aheadDistanceM ?? 0,
          color:      resolveIncidentType(inc.type).color,
        };
      }
      return null;
    }

    // Outside navigation: find the closest item from EITHER source and show
    // whichever is nearer, so a freshly-reported incident beats a far camera.
    type AlertCandidate = {
      type: string; typeName: string; speedLimit?: number;
      distanceM: number; color: string; road?: string | null;
      /** Speed camera / speed zone — outranks other types within the radius. */
      isSpeedCam?: boolean;
    };
    const candidates: AlertCandidate[] = [];

    // Static speed zones (already proximity-sorted by AppContext).
    // Skip any zone within 250 m — those are in-zone or just-passed; the
    // DriveAlertOverlay handles them, and the strip would show a stale distance
    // counting upward after the driver passes.
    const aheadZone = nearbyZones.find(z => z.distance > 250);
    if (aheadZone) {
      candidates.push({
        type: aheadZone.type, typeName: resolveIncidentType(aheadZone.type).label,
        speedLimit: aheadZone.speedLimit, distanceM: aheadZone.distance,
        color: resolveIncidentType(aheadZone.type).color, road: aheadZone.road,
        isSpeedCam: aheadZone.type === "camera" || aheadZone.speedLimit != null,
      });
    }

    // Community reports + HERE incidents within 3 km.
    // Same 250 m cutoff — once the driver is inside the zone the overlay owns it.
    if (currentLat != null && currentLng != null) {
      const TWO_HOURS = 2 * 60 * 60 * 1000;
      const REPORT_RADIUS_M = 3000;
      const now = Date.now();
      let nearestDist = Infinity;
      let nearestReport: typeof communityReports[0] | null = null;
      for (const r of communityReports) {
        if (now - r.timestamp > TWO_HOURS) continue;
        const d = haversineM(currentLat, currentLng, r.lat, r.lng);
        if (d > 250 && d <= REPORT_RADIUS_M && d < nearestDist) {
          nearestDist = d;
          nearestReport = r;
        }
      }
      if (nearestReport) {
        candidates.push({
          type: nearestReport.type, typeName: resolveIncidentType(nearestReport.type).label,
          speedLimit: nearestReport.speedLimit ?? undefined,
          distanceM: nearestDist, color: resolveIncidentType(nearestReport.type).color,
          road: nearestReport.roadName,
          isSpeedCam: nearestReport.type === "camera",
        });
      }
      // HERE Live Traffic incidents within 3 km
      let nearestHereDist = Infinity;
      let nearestHere: typeof hereIncidents[0] | null = null;
      for (const h of hereIncidents) {
        if (h.endTime != null && h.endTime < now) continue;
        const d = haversineM(currentLat, currentLng, h.lat, h.lng);
        if (d > 250 && d <= REPORT_RADIUS_M && d < nearestHereDist) {
          nearestHereDist = d;
          nearestHere = h;
        }
      }
      if (nearestHere) {
        candidates.push({
          type: nearestHere.type, typeName: resolveIncidentType(nearestHere.type).label,
          distanceM: nearestHereDist, color: resolveIncidentType(nearestHere.type).color,
          road: nearestHere.roadName,
        });
      }
    }

    if (candidates.length === 0) return null;
    // Speed-camera priority: within the candidate radius a speed camera /
    // speed zone outranks other alert types even when they are nearer.
    // Everything else stays reachable via the nearby-alerts list.
    candidates.sort((a, b) => a.distanceM - b.distanceM);
    return candidates.find(c => c.isSpeedCam) ?? candidates[0];
  }, [activeRoute, routeIncidentsAhead, nearbyZones, communityReports, hereIncidents, currentLat, currentLng]);

  // ── Alert overlay heartbeat pulse ────────────────────────────────────────
  // Placed here (after primaryAlert useMemo) so alertDistM can read it safely.
  // Speed and depth scale with proximity: fastest/deepest < 200 m,
  // slowest/shallowest 500–1000 m. No animation beyond 1 km.
  const alertDistM = primaryAlert?.distanceM ?? Infinity;
  // Coarse proximity tier — only 4 possible values (−1 / 0 / 1 / 2).
  // Using the raw `alertDistM` in the dep array would restart the animation
  // loop on every GPS fix (1 Hz), creating/destroying Animated.loop objects
  // every second → memory pressure and eventual UI-thread crash.
  // The tier changes only when the driver crosses 200 m / 500 m / 1 km, which
  // is when the pulse speed/depth actually needs to change anyway.
  const alertDistTier =
    alertDistM < 200  ? 2 :
    alertDistM < 500  ? 1 :
    alertDistM < 1000 ? 0 : -1;

  useEffect(() => {
    const active = locationGranted && !overLimit && !routeLoading && primaryAlert != null;
    if (!active || alertDistTier < 0) {
      alertOverlayPulse.setValue(1);
      alertOverlayScale.setValue(1);
      return undefined;
    }
    const nd = Platform.OS !== "web";
    const duration = alertDistTier === 2 ? 350 : alertDistTier === 1 ? 600 : 1000;
    const minVal   = alertDistTier === 2 ? 0.55 : alertDistTier === 1 ? 0.70 : 0.83;
    // Heartbeat amplitude for the whole overlay — deepest when very close.
    const amp      = alertDistTier === 2 ? 0.06 : alertDistTier === 1 ? 0.04 : 0.025;
    // Scale sequence is a "lub-dub" beat whose total time matches the ring
    // opacity sequence (2 × duration) so the parallel loop never stutters.
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(alertOverlayPulse, { toValue: minVal, duration, useNativeDriver: nd }),
          Animated.timing(alertOverlayPulse, { toValue: 1,      duration, useNativeDriver: nd }),
        ]),
        Animated.sequence([
          Animated.timing(alertOverlayScale, { toValue: 1 + amp,       duration: duration * 0.4,  useNativeDriver: nd }),
          Animated.timing(alertOverlayScale, { toValue: 1,             duration: duration * 0.35, useNativeDriver: nd }),
          Animated.timing(alertOverlayScale, { toValue: 1 + amp * 0.6, duration: duration * 0.35, useNativeDriver: nd }),
          Animated.timing(alertOverlayScale, { toValue: 1,             duration: duration * 0.9,  useNativeDriver: nd }),
        ]),
      ]),
    );
    loop.start();
    return () => { loop.stop(); alertOverlayPulse.setValue(1); alertOverlayScale.setValue(1); };
  // alertDistTier is the coarse bucketed version of alertDistM — intentional.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertDistTier, locationGranted, overLimit, routeLoading, !!primaryAlert, alertOverlayPulse, alertOverlayScale]);

  // HUD-aware colours
  const bg       = isDark ? "#0A0A0AEF" : "#FFFFFFF0";
  // Fully-opaque version used for the alert overlay so underlying gauge content
  // never bleeds through (bg has a ~94 % alpha channel baked in).
  const bgOpaque = isDark ? "#0A0A0A"   : "#FFFFFF";
  const fgMain  = isDark ? "#F0F0F0"   : "#111111";
  const fgMuted = isDark ? "#777777"   : "#888888";
  const divBg   = isDark ? "#2A2A2A"   : "#E5E5E5";
  const fabBg   = isDark ? "#1A1A1AEE" : "#FFFFFFEE";
  const speedClr = overLimit ? "#E53935" : (isDark ? "#00E676" : "#1A237E");

  // Distance-coded alert overlay border — red when very close, fading through
  // orange → amber as the driver approaches, alert's own colour when distant.
  const overlayBorderColor = primaryAlert == null ? "#E53935"
    : primaryAlert.distanceM <  200 ? "#E53935"   // RED   — very close
    : primaryAlert.distanceM <  500 ? "#FF6D00"   // ORANGE — approaching
    : primaryAlert.distanceM < 1000 ? "#FBC02D"   // AMBER  — nearby
    : primaryAlert.color;                          // alert's own colour
  const overlayBorderWidth = primaryAlert == null ? 5
    : primaryAlert.distanceM <  200 ? 8
    : primaryAlert.distanceM <  500 ? 6
    : primaryAlert.distanceM < 1000 ? 5
    : 4;

  // ── Search ────────────────────────────────────────────────────────────────

  const runSearch = async (text: string) => {
    if (text.length < 2) { setGeoResults([]); setShowResults(false); return; }
    setSearchLoading(true);
    setSearchError(false);
    try {
      const results = await nominatimSearch(text);
      setGeoResults(results);
      setShowResults(true);
    } catch {
      setSearchError(true);
      setGeoResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSearchChange = (text: string) => {
    setSearchText(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.length < 2) { setGeoResults([]); setShowResults(false); return; }
    setShowResults(true);
    setSearchLoading(true);
    searchTimer.current = setTimeout(() => runSearch(text), 600);
  };

  const pickDestination = (r: GeoResult) => {
    Keyboard.dismiss();
    setSearchText(r.short);
    setGeoResults([]);
    setShowResults(false);
    setSearchInputFocused(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setNavDestination({ name: r.display, lat: r.lat, lng: r.lng });
    // Persist to recents (newest-first, deduped)
    saveRecentSearch(r).then(setRecentSearches);
  };

  /** Navigate directly to a saved place (Home / Work / custom).
   *  Pinned places are intentionally NOT saved to recents — they're always visible. */
  const navigateToSavedPlace = useCallback((place: SavedPlace) => {
    Keyboard.dismiss();
    setSearchText(place.label);
    setGeoResults([]);
    setShowResults(false);
    setSearchInputFocused(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setNavDestination({ name: place.label, lat: place.lat, lng: place.lng });
  }, [setNavDestination]);

  const clearDestination = () => {
    Keyboard.dismiss();
    if (tripActive) setTripActive(false);
    setNavDestination(null);
    setSearchText("");
    setGeoResults([]);
    setShowResults(false);
    setSearchError(false);
  };

  const bottomBase = bottomInset + tabBarH + 10;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <Animated.View style={[styles.screen, { opacity: screenFade }]}>

      {/* ── Base layer: full-screen map ──
          Wrapped in its own ErrorBoundary so a render error inside DriveMapView
          (e.g. a bad Marker coordinate from a freshly-pushed DB zone or an
          admin-relocated report) shows a recoverable fallback instead of
          propagating to the tab boundary and killing the navigation session.
          Navigation audio and step-tracking in AppContext are unaffected because
          they live outside this subtree. */}
      <View style={StyleSheet.absoluteFillObject}>
        <ErrorBoundary FallbackComponent={MapErrorFallback}>
          <DriveMapView ref={driveMapRef} mapDrifted={mapDrifted} onDriftChange={setMapDrifted} tripMode={tripActive} />
        </ErrorBoundary>
      </View>

      {/* Dismiss suggestions on outside tap — sits above the map but below
          all HUD layers; only rendered (and therefore only intercepts touches)
          when suggestions are actually visible. */}
      {(showResults || searchInputFocused) && (
        <Pressable style={StyleSheet.absoluteFillObject} onPress={dismissSearch} />
      )}

      {/* ── Drive alert overlay (bottom-anchored, slides up) ──────────────────
           DriveAlertOverlay is the SINGLE SOURCE OF TRUTH for all in-drive
           speed/zone/hazard alerts. Do NOT add a parallel alert component here.
           To add a new alert type, extend the DriveAlert union in AppContext and
           add the rendering logic inside DriveAlertOverlay itself.           ── */}
      {activeAlert && (
        <DriveAlertOverlay
          alert={activeAlert}
          extraAlerts={activeAlertExtras}
          onDismiss={dismissAlert}
          onDismissAll={() => {
            // Show a 4-second re-arm hint after the overlay has slid away.
            if (pauseNoteTimerRef.current) clearTimeout(pauseNoteTimerRef.current);
            setPauseNote("Alerts paused near this area for 10 min");
            pauseNoteTimerRef.current = setTimeout(() => setPauseNote(null), 4000);
          }}
          currentSpeed={currentSpeed}
          // Hide the overlay while stationary — no need to see alerts at 0 km/h.
          // The overlay slides back in automatically when the driver starts moving.
          visible={currentSpeed > 0}
          // Cover the gauge exactly: in nav mode cover the nav bar; in normal
          // mode cover the speed strip up to just above the report buttons.
          // The +20 adds a small breathing gap above the gauge top edge.
          minPanelHeight={
            tripActive && liveTripSheetHeight > 0
              ? liveTripSheetHeight + 20
              : bottomBase + speedStripHeight + 20
          }
        />
      )}

      {/* ── Cluster-dismiss re-arm hint ─────────────────────────────────────
          Appears for 4 s after "Got it — dismiss all" so the driver knows
          alerts near this spot are paused and when they will re-arm. */}
      {pauseNote && (
        <View
          pointerEvents="none"
          style={[
            styles.pauseNotePill,
            {
              bottom: tripActive && liveTripSheetHeight > 0
                ? liveTripSheetHeight + 64
                : bottomBase + speedStripHeight + 64,
            },
          ]}
        >
          <Ionicons name="time-outline" size={14} color="#FFF" />
          <Text style={styles.pauseNoteTxt}>{pauseNote}</Text>
        </View>
      )}

      {/* Drive Mode header removed — share moved to stats row, audio moved to bottom panel */}

      {/* ── Drive Mode top alert banner — e.g. "Speed camera ahead · 200 m" ──── */}
      {tripActive && primaryAlert && (
        <AnimatedTouchable
          activeOpacity={0.85}
          onPress={() => { if (nearbyAlertCandidates.length > 1) setShowNearbySheet(true); }}
          style={[styles.dmAlertBanner, {
            top: topInset + 8,
            backgroundColor: isDark ? "#101613F2" : "#FFFFFFF5",
            borderColor: primaryAlert.distanceM < 500 ? primaryAlert.color : c.primary + "66",
            transform: [{ scale: alertOverlayScale }],
          }]}
        >
          <View style={[styles.dmAlertIconWrap, { backgroundColor: primaryAlert.color + "22" }]}>
            <Text style={{ fontSize: 20, fontFamily: EMOJI_FONT_FAMILY }}>
              {resolveIncidentType(primaryAlert.type).emoji}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.dmAlertTitle, { color: c.foreground }]} numberOfLines={1}>
              {primaryAlert.typeName} ahead
            </Text>
            <Text style={[styles.dmAlertSub, { color: c.mutedForeground }]} numberOfLines={1}>
              <Text style={{ color: c.primary, fontFamily: "Inter_700Bold" }}>
                {distStr(primaryAlert.distanceM)}
              </Text>
              {primaryAlert.road ? ` • ${primaryAlert.road}` : ""}
            </Text>
          </View>
          {primaryAlert.speedLimit != null && (
            <View style={styles.dmLimitBadge}>
              <Text style={styles.dmLimitBadgeTxt}>{primaryAlert.speedLimit}</Text>
            </View>
          )}
        </AnimatedTouchable>
      )}

      {/* ── Compact LIVE pill — replaces the bulky trip info card so the top
          stays clear for nearby-alert overlays. Styled like the red REC pill. ── */}
      {tripActive && navDestination != null && (
        <View style={[styles.livePill, { top: topInset + (primaryAlert ? 90 : 16) }]}>
          <View style={styles.livePillDot} />
          <Text style={styles.livePillTxt}>LIVE</Text>
        </View>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TOP: Search bar + results (when not in Live Trip mode)
      ══════════════════════════════════════════════════════════════════ */}
      {!tripActive && (
        <View
          style={[styles.searchArea, { top: topInset + 4 }]}
          pointerEvents="box-none"
        >
          {/* Search pill */}
          <View pointerEvents="auto" style={[styles.searchPill, { backgroundColor: bg }]}>
            {isMapMode ? (
              <TouchableOpacity
                onPress={clearDestination}
                style={styles.searchIconSlot}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="arrow-back" size={20} color={c.primary} />
              </TouchableOpacity>
            ) : (
              <View style={styles.searchIconSlot}>
                <Ionicons name="search-outline" size={18} color={fgMuted} />
              </View>
            )}

            <TextInput
              style={[styles.searchInput, { color: fgMain }]}
              placeholder={
                isMapMode
                  ? navDestination?.name.split(",")[0] ?? "Change destination…"
                  : "Where to?"
              }
              placeholderTextColor={isMapMode ? (isDark ? "#FFFFFFBB" : "#333333") : fgMuted}
              value={searchText}
              onChangeText={handleSearchChange}
              returnKeyType="search"
              onSubmitEditing={() => searchText.length > 1 && runSearch(searchText)}
              onFocus={() => setSearchInputFocused(true)}
              onBlur={() => { setSearchInputFocused(false); setShowResults(false); setGeoResults([]); }}
              autoCorrect={false}
              autoCapitalize="none"
            />

            {searchLoading && (
              <ActivityIndicator size="small" color={c.primary} style={{ marginRight: 14 }} />
            )}

            {/* X — clear typed text and dismiss keyboard */}
            {!isMapMode && !searchLoading && searchText.length > 0 && (
              <TouchableOpacity
                onPress={() => { setSearchText(""); Keyboard.dismiss(); }}
                style={{ marginRight: 14 }}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close-circle" size={19} color={fgMuted} />
              </TouchableOpacity>
            )}

            {/* Keyboard-down — dismiss keyboard when focused but nothing typed yet */}
            {!isMapMode && !searchLoading && searchText.length === 0 && searchInputFocused && (
              <TouchableOpacity
                onPress={() => Keyboard.dismiss()}
                style={{ marginRight: 14 }}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="chevron-down" size={20} color={fgMuted} />
              </TouchableOpacity>
            )}

            {isMapMode && !searchLoading && (
              <TouchableOpacity
                onPress={clearDestination}
                style={{ marginRight: 14 }}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close-circle" size={19} color={fgMuted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Results dropdown — live search results */}
          {showResults && (
            <View pointerEvents="auto" style={[styles.resultsCard, { backgroundColor: bg }]}>
              {searchError && (
                <View style={styles.resultHint}>
                  <Ionicons name="cloud-offline-outline" size={15} color="#F57C00" />
                  <Text style={[styles.resultHintTxt, { color: fgMuted }]}>
                    Search unavailable — check your connection
                  </Text>
                </View>
              )}
              {!searchError && geoResults.length === 0 && !searchLoading && searchText.length > 1 && (
                <View style={styles.resultHint}>
                  <Ionicons name="location-outline" size={15} color={fgMuted} />
                  <Text style={[styles.resultHintTxt, { color: fgMuted }]}>
                    No places found in Kenya for "{searchText}"
                  </Text>
                </View>
              )}
              <FlatList
                {...FLAT_LIST_PROPS}
                data={geoResults}
                keyExtractor={(_, i) => String(i)}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item, index }) => (
                  <TouchableOpacity
                    style={[
                      styles.resultRow,
                      { borderBottomColor: divBg },
                      index === 0 && { borderTopColor: divBg, borderTopWidth: StyleSheet.hairlineWidth },
                    ]}
                    onPress={() => pickDestination(item)}
                    activeOpacity={0.72}
                  >
                    <View style={[styles.resultIcon, { backgroundColor: isDark ? "#222" : "#F2F2F2" }]}>
                      <Ionicons name="location-outline" size={15} color={c.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.resultName, { color: fgMain }]} numberOfLines={1}>
                        {item.short}
                      </Text>
                      <Text style={[styles.resultSub, { color: fgMuted }]} numberOfLines={1}>
                        {item.display.split(",").slice(2).join(",").trim()}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={13} color={fgMuted} />
                  </TouchableOpacity>
                )}
              />
            </View>
          )}

          {/* Pinned + Recents dropdown — shown when focused with no text typed */}
          {!showResults && searchInputFocused && searchText.length === 0 && (
            <View pointerEvents="auto" style={[styles.resultsCard, { backgroundColor: bg }]}>

              {/* ── Home ──────────────────────────────────────────── */}
              {(() => {
                const home = savedPlaces.find(p => p.kind === "home");
                return (
                  <TouchableOpacity
                    style={[styles.resultRow, { borderBottomColor: divBg }]}
                    onPress={() =>
                      home
                        ? navigateToSavedPlace(home)
                        : router.push("/(tabs)/trips?initialTab=planned")
                    }
                    activeOpacity={0.72}
                  >
                    <View style={[styles.resultIcon, { backgroundColor: isDark ? "#1A2A1A" : "#E8F5E9" }]}>
                      <Ionicons name="home" size={15} color="#2E7D32" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.resultName, { color: fgMain }]}>Home</Text>
                      <Text style={[styles.resultSub, { color: home ? fgMuted : c.primary }]} numberOfLines={1}>
                        {home ? (home.address ?? home.label) : "Tap to set home location"}
                      </Text>
                    </View>
                    {!home && <Ionicons name="add-circle-outline" size={16} color={c.primary} />}
                  </TouchableOpacity>
                );
              })()}

              {/* ── Work ──────────────────────────────────────────── */}
              {(() => {
                const work = savedPlaces.find(p => p.kind === "work");
                return (
                  <TouchableOpacity
                    style={[styles.resultRow, { borderBottomColor: divBg }]}
                    onPress={() =>
                      work
                        ? navigateToSavedPlace(work)
                        : router.push("/(tabs)/trips?initialTab=planned")
                    }
                    activeOpacity={0.72}
                  >
                    <View style={[styles.resultIcon, { backgroundColor: isDark ? "#1A1F2E" : "#E3F2FD" }]}>
                      <Ionicons name="briefcase" size={15} color="#1565C0" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.resultName, { color: fgMain }]}>Work</Text>
                      <Text style={[styles.resultSub, { color: work ? fgMuted : c.primary }]} numberOfLines={1}>
                        {work ? (work.address ?? work.label) : "Tap to set work location"}
                      </Text>
                    </View>
                    {!work && <Ionicons name="add-circle-outline" size={16} color={c.primary} />}
                  </TouchableOpacity>
                );
              })()}

              {/* ── Custom saved places ───────────────────────────── */}
              {savedPlaces.filter(p => p.kind === "custom").map(place => (
                <TouchableOpacity
                  key={place.id}
                  style={[styles.resultRow, { borderBottomColor: divBg }]}
                  onPress={() => navigateToSavedPlace(place)}
                  activeOpacity={0.72}
                >
                  <View style={[styles.resultIcon, { backgroundColor: isDark ? "#2A1A2A" : "#F3E5F5" }]}>
                    <Ionicons name="star" size={15} color="#7B1FA2" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.resultName, { color: fgMain }]} numberOfLines={1}>{place.label}</Text>
                    {!!place.address && (
                      <Text style={[styles.resultSub, { color: fgMuted }]} numberOfLines={1}>{place.address}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              ))}

              {/* ── Recents ───────────────────────────────────────── */}
              {recentSearches.length > 0 && (
                <>
                  <TouchableOpacity
                    style={[styles.recentsClearRow, { borderBottomColor: divBg }]}
                    onPress={() => {
                      clearRecentSearches();
                      setRecentSearches([]);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    activeOpacity={0.72}
                  >
                    <Text style={[styles.recentsClearTxt, { color: c.primary }]}>Clear all recents</Text>
                  </TouchableOpacity>
                  <FlatList
                    {...FLAT_LIST_PROPS}
                    data={recentSearches}
                    keyExtractor={(item) => item.display}
                    keyboardShouldPersistTaps="handled"
                    renderItem={({ item, index }) => (
                      <TouchableOpacity
                        style={[
                          styles.resultRow,
                          { borderBottomColor: divBg },
                          index === 0 && { borderTopColor: divBg, borderTopWidth: StyleSheet.hairlineWidth },
                        ]}
                        onPress={() => pickDestination(item)}
                        activeOpacity={0.72}
                      >
                        <View style={[styles.resultIcon, { backgroundColor: isDark ? "#222" : "#F2F2F2" }]}>
                          <Ionicons name="time-outline" size={15} color={fgMuted} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.resultName, { color: fgMain }]} numberOfLines={1}>
                            {item.short}
                          </Text>
                          <Text style={[styles.resultSub, { color: fgMuted }]} numberOfLines={1}>
                            {item.display.split(",").slice(2).join(",").trim()}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => {
                            removeRecentSearch(item).then(setRecentSearches);
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          }}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                          <Ionicons name="close-circle" size={17} color={fgMuted} />
                        </TouchableOpacity>
                      </TouchableOpacity>
                    )}
                  />
                </>
              )}
            </View>
          )}
        </View>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          RIGHT: Utility FABs — Recenter & Traffic (hidden during trip/search)
                 Theme toggle is always shown (not gated by tripActive).
      ══════════════════════════════════════════════════════════════════ */}
      {!showResults && !tripActive && (
        <View style={[styles.fabCol, { top: topInset + 72, right: 12 }]}>
          <TouchableOpacity
            style={[styles.fab, { backgroundColor: fabBg }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); driveMapRef.current?.recenter(); }}
          >
            <Ionicons name="locate" size={19} color={isDark ? "#CCC" : "#555"} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.fab, { backgroundColor: showTraffic ? c.primary : fabBg }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowTraffic(!showTraffic); }}
          >
            <Ionicons name="car-outline" size={19} color={showTraffic ? "#FFF" : (isDark ? "#CCC" : "#555")} />
          </TouchableOpacity>
        </View>
      )}

      {/* Theme toggle — always visible when not searching */}
      {!showResults && (
        <TouchableOpacity
          style={[
            styles.fab,
            {
              backgroundColor: fabBg,
              position: "absolute",
              right: 12,
              zIndex: 12,
              // When browsing: sit below recenter + traffic (2×43 + 2×9 gap = 104 px).
              // When tripActive those FABs are hidden, so snap to the top slot.
              top: topInset + 72 + (tripActive ? 0 : 104),
            },
          ]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            manualThemeRef.current = true; // suppress auto-switch for this session
            setThemeOverride(isDark ? "light" : "dark");
          }}
        >
          <Ionicons
            name={isDark ? "sunny" : "moon"}
            size={19}
            color={isDark ? "#FFC107" : "#3949AB"}
          />
        </TouchableOpacity>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          DRIVE MODE overlays (mockup-faithful):
          · Speed dial — top-left circular gauge with limit badge
          · Report / Center round buttons — right edge
          · Weather + GPS chips — just above the Drive Safely panel
      ══════════════════════════════════════════════════════════════════ */}
      {tripActive && (
        <>
          {/* Speed dial — green ring, big digit, km/h, limit badge below */}
          <View
            pointerEvents="none"
            style={[styles.dmDialWrap, {
              top: topInset + (primaryAlert ? 90 : 16),
              backgroundColor: isDark ? "#0F1411E8" : "#FFFFFFF0",
              borderColor: overLimit ? c.speedDanger : c.primary,
            }]}
          >
            <Text style={[styles.dmDialNum, { color: overLimit ? c.speedDanger : c.primary }]}>
              {Math.round(currentSpeed)}
            </Text>
            <Text style={[styles.dmDialUnit, { color: c.mutedForeground }]}>km/h</Text>
            {currentSpeedLimit != null && (
              <View style={styles.dmDialLimit}>
                <Text style={styles.dmDialLimitTxt}>{currentSpeedLimit}</Text>
              </View>
            )}
          </View>

          {/* Right-edge round buttons: Report + Center */}
          <View style={[styles.dmSideCol, { top: topInset + (primaryAlert ? 90 : 16) }]}>
            <TouchableOpacity
              style={[styles.dmSideBtn, { backgroundColor: isDark ? "#161B18F0" : "#FFFFFFF0", borderColor: c.tileBorder }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowReport(true); }}
              activeOpacity={0.85}
            >
              <Ionicons name="warning-outline" size={20} color={c.foreground} />
              <Text style={[styles.dmSideBtnTxt, { color: c.foreground }]}>Report</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dmSideBtn, { backgroundColor: isDark ? "#161B18F0" : "#FFFFFFF0", borderColor: c.tileBorder }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                driveMapRef.current?.recenter();
                setMapDrifted(false);
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="locate-outline" size={20} color={mapDrifted ? c.primary : c.foreground} />
              <Text style={[styles.dmSideBtnTxt, { color: mapDrifted ? c.primary : c.foreground }]}>Center</Text>
            </TouchableOpacity>
          </View>

          {/* Weather chip (left) + GPS chip (right) above the panel */}
          <View
            pointerEvents="none"
            style={[styles.dmChipRow, { bottom: liveTripSheetHeight + 10 }]}
          >
            <View style={[styles.dmChip, { backgroundColor: isDark ? "#12171480" : "#FFFFFFCC" }]}>
              <Ionicons name="partly-sunny-outline" size={15} color={c.foreground} />
              <Text style={[styles.dmChipTxt, { color: c.foreground }]}>Nairobi</Text>
            </View>
            <View style={[styles.dmChip, { backgroundColor: isDark ? "#12171480" : "#FFFFFFCC" }]}>
              <View style={{
                width: 8, height: 8, borderRadius: 4,
                backgroundColor: locationGranted ? c.primary : c.speedDanger,
              }} />
              <Text style={[styles.dmChipTxt, { color: c.foreground }]}>
                GPS {locationGranted ? "Good" : "Off"}
              </Text>
            </View>
          </View>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          BOTTOM: Normal-mode speed card.
          Left block: speed + LIMIT stacked (like the nav bar).
          Right panel: NEARBY ALERT badge + type + "X km ahead".
      ══════════════════════════════════════════════════════════════════ */}
      {!isMapMode && !showResults && !tripActive && (
        <View
          style={[styles.speedStrip, {
            bottom: bottomBase + 8,
            backgroundColor: bg,
            gap: isSmall ? 6 : 10,
            paddingHorizontal: isSmall ? 8 : 12,
            // Guarantee enough height for the full-bleed alert overlay when
            // it is active — without this, a route with no speed limit (no
            // limit ring) collapses the gauge and clips the overlay content.
            minHeight: (locationGranted && !overLimit && !routeLoading && primaryAlert)
              ? (isSmall ? 190 : 224)
              : undefined,
          }]}
          onLayout={(e) => setSpeedStripHeight(e.nativeEvent.layout.height)}
        >

          {/* Left: large speed digit + optional LIMIT ring below it */}
          <View style={[styles.speedGroup, {
            backgroundColor: overLimit ? "#E5393510" : (isDark ? "#FFFFFF08" : "#00000005"),
            borderRadius: 16,
            paddingHorizontal: isSmall ? 6 : 10,
            paddingVertical: isSmall ? 6 : 8,
            minWidth: isSmall ? 96 : 130,
          }]}>
            <Text style={[styles.speedLabel, { color: overLimit ? "#E5393380" : fgMuted }]}>
              YOUR SPEED
            </Text>
            <Text style={[styles.speedNum, {
              color: speedClr,
              fontSize: isSmall ? 60 : 84,
              lineHeight: isSmall ? 72 : 100,
            }]}>
              {Math.round(currentSpeed)}
            </Text>
            <Text style={[styles.speedUnit, { color: overLimit ? "#E5393380" : fgMuted }]}>km/h</Text>
            {/* Limit ring — stacked below, same column as speed */}
            {currentSpeedLimit != null && (
              <View style={{ alignItems: "center", gap: 2, marginTop: isSmall ? 4 : 6 }}>
                <Text style={[styles.limitLabel, { color: fgMuted }]}>LIMIT</Text>
                <View style={[styles.limitRing, {
                  borderColor: overLimit ? "#E53935" : (isDark ? "#555" : "#1A1A1A"),
                  width: isSmall ? 38 : 46,
                  height: isSmall ? 38 : 46,
                  borderRadius: isSmall ? 19 : 23,
                }]}>
                  <Text style={[styles.limitNum, {
                    color: overLimit ? "#E53935" : fgMain,
                    fontSize: isSmall ? 13 : 16,
                  }]}>
                    {currentSpeedLimit}
                  </Text>
                </View>
              </View>
            )}
          </View>

          <View style={[styles.vdivider, { backgroundColor: divBg }]} />

          {/* Right: contextual alert info.
              paddingRight reserves space for the absolutely-positioned SOS
              button so text never hides behind it. */}
          {!locationGranted ? (
            <TouchableOpacity
              style={[styles.gpsBtn, { backgroundColor: c.primary }]}
              onPress={requestLocationPermission}
            >
              <Ionicons name="location-outline" size={15} color="#FFF" />
              <Text style={styles.gpsBtnTxt}>Enable GPS</Text>
            </TouchableOpacity>
          ) : overLimit ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, paddingRight: isSmall ? 56 : 70 }}>
              <Ionicons name="alert-circle" size={20} color="#E53935" />
              <Text style={{ color: "#E53935", fontSize: 16, fontFamily: "Inter_700Bold" }}>Slow down!</Text>
            </View>
          ) : routeLoading ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7, flex: 1, paddingRight: isSmall ? 56 : 70 }}>
              <ActivityIndicator size="small" color={c.primary} />
              <Text style={[styles.clearTxt, { color: fgMuted }]}>Calculating route…</Text>
            </View>
          ) : primaryAlert ? (
            <TouchableOpacity
              activeOpacity={0.8}
              style={{ flex: 1, gap: 4 }}
              onPress={() => {
                if (nearbyAlertCandidates.length > 1) setShowNearbySheet(true);
              }}
            >
              {/* Row 1: "NEARBY ALERTS" label — full-width badge, text only */}
              <View style={[styles.nearbyAlertBadge, {
                backgroundColor: primaryAlert.color + "22",
                borderColor:     primaryAlert.color + "55",
                flexDirection: "row",
                alignItems: "center",
                alignSelf: "stretch",
                gap: 6,
              }]}>
                <Ionicons name="alert-circle" size={14} color={primaryAlert.color} />
                <Text style={[styles.nearbyAlertLabel, { color: primaryAlert.color }]}>
                  NEARBY ALERTS
                </Text>
              </View>
              {/* Row 2: Emoji row — only shown when 2+ alerts are nearby.
                  Width is measured at render time so the number of visible
                  emojis adapts to the actual available space automatically. */}
              {nearbyAlertCandidates.length > 1 && (() => {
                // Slot width: 18px emoji + 4px gap between items.
                // Reserve 46px for the "+N" label (~28px) + gap (4px) + chevron (12px) + marginLeft (2px).
                const maxVisible = emojiRowWidthRef.current > 0
                  ? Math.max(1, Math.floor((emojiRowWidthRef.current - 46) / 22))
                  : nearbyAlertCandidates.length; // unmeasured: show all, clipped by parent
                const overflow = nearbyAlertCandidates.length - maxVisible;
                return (
                  <View
                    style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                    onLayout={(e) => { emojiRowWidthRef.current = e.nativeEvent.layout.width; }}
                  >
                    {nearbyAlertCandidates.slice(0, maxVisible).map((c, i) => (
                      <Text key={c.id + i} style={{ fontSize: 18 }}>{c.emoji}</Text>
                    ))}
                    {overflow > 0 && (
                      <Text style={[styles.nearbyAlertLabel, { color: primaryAlert.color, marginLeft: 2 }]}>
                        +{overflow}
                      </Text>
                    )}
                    <Ionicons name="chevron-forward" size={12} color={primaryAlert.color} style={{ marginLeft: 2 }} />
                  </View>
                );
              })()}
              {/* Row 3: Marker + [type name above distance] — SOS floats bottom-right.
                  paddingRight is narrower now that SOS is a square icon button. */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingRight: isSmall ? 46 : 54 }}>
                <View style={[styles.alertMarker, { backgroundColor: primaryAlert.color }]}>
                  <Text style={styles.alertMarkerEmoji}>
                    {resolveIncidentType(primaryAlert.type).emoji}
                  </Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.zoneTypeName, { color: fgMain }]} numberOfLines={1}>
                    {primaryAlert.typeName}
                  </Text>
                  {primaryAlert.speedLimit ? (
                    <Text style={[styles.zoneTypeName, { color: fgMain }]} numberOfLines={1}>
                      {primaryAlert.speedLimit} km/h
                    </Text>
                  ) : null}
                  <Text style={[styles.zoneDistAhead, { color: fgMuted }]}>
                    {distStr(primaryAlert.distanceM)} ahead
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          ) : (
            <Text style={[styles.clearTxt, { color: fgMuted, flex: 1, paddingRight: isSmall ? 56 : 70 }]}>Clear ahead</Text>
          )}

          {/* ── FULL-STRIP ALERT OVERLAY ──────────────────────────────────────
              Covers the entire speed strip (gauge + right panel) when an alert
              is active. Opacity pulses via alertOverlayPulse (heartbeat effect
              whose speed / depth scale with proximity).
              Border colour shifts RED → ORANGE → AMBER → alert-colour as
              distance grows. SOS (zIndex 10) always floats on top. */}
          {locationGranted && !overLimit && !routeLoading && primaryAlert && primaryAlert.distanceM <= 1000 && (
            // Outer view is always fully opaque — hides the gauge + right-panel
            // content underneath. The inner ring's opacity pulses AND the whole
            // overlay scales in a lub-dub heartbeat so it's noticeable at a glance.
            <Animated.View
              style={[styles.alertOverlay, {
                backgroundColor: bgOpaque,
                borderLeftColor: overlayBorderColor,
                borderLeftWidth: overlayBorderWidth,
                transform: [{ scale: alertOverlayScale }],
              }]}
            >
              {/* Pulsing ring glow — only this opacity animates, not the whole overlay */}
              <Animated.View
                pointerEvents="none"
                style={{
                  position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                  borderRadius: 16,
                  borderWidth: 2,
                  borderColor: overlayBorderColor,
                  opacity: alertOverlayPulse,
                }}
              />

              <TouchableOpacity
                activeOpacity={0.92}
                style={styles.alertOverlayInner}
                onPress={() => {
                  if (nearbyAlertCandidates.length > 1) setShowNearbySheet(true);
                }}
              >
                {/* Row 1: big emoji · type name · distance */}
                <View style={[styles.alertOverlayTop, { paddingRight: isSmall ? 48 : 58 }]}>
                  <View style={[styles.alertOverlayIconWrap, {
                    backgroundColor: primaryAlert.color + "22",
                    width:  isSmall ? 52 : 62,
                    height: isSmall ? 52 : 62,
                    borderRadius: isSmall ? 14 : 16,
                  }]}>
                    <Text style={[styles.alertOverlayEmoji, { fontSize: isSmall ? 26 : 34 }]}>
                      {resolveIncidentType(primaryAlert.type).emoji}
                    </Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.alertOverlayTypeName, {
                      color: primaryAlert.color,
                      fontSize: isSmall ? 19 : 22,
                    }]}>
                      {primaryAlert.typeName}
                    </Text>
                    {nearbyAlertCandidates.length > 1 && (
                      <Text style={[styles.alertOverlayMoreTxt, { color: fgMuted }]}>
                        +{nearbyAlertCandidates.length - 1} more nearby · tap
                      </Text>
                    )}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[styles.alertOverlayDistNum, {
                      color: overlayBorderColor,
                      fontSize: isSmall ? 24 : 30,
                    }]}>
                      {distStr(primaryAlert.distanceM)}
                    </Text>
                    <Text style={[styles.alertOverlayDistLabel, { color: fgMuted }]}>ahead</Text>
                  </View>
                </View>

                {/* Row 2: speed comparison (camera/zone) or chips (reports) */}
                {(primaryAlert.type === "camera" || primaryAlert.type === "zone") ? (
                  <View style={[styles.alertOverlaySpeedRow, { paddingRight: isSmall ? 48 : 58 }]}>
                    {/* Zone limit */}
                    <View style={[styles.alertOverlaySpeedCell, { backgroundColor: primaryAlert.color + "18" }]}>
                      <Text style={[styles.alertOverlayCellLabel, { color: fgMuted }]}>ZONE LIMIT</Text>
                      <Text style={[styles.alertOverlayCellNum, {
                        color: primaryAlert.color,
                        fontSize: isSmall ? 38 : 46,
                        lineHeight: isSmall ? 44 : 52,
                      }]}>
                        {primaryAlert.speedLimit != null ? `${primaryAlert.speedLimit}` : "—"}
                      </Text>
                      <Text style={[styles.alertOverlayCellUnit, { color: fgMuted }]}>km/h</Text>
                    </View>
                    {/* Your speed */}
                    <View style={[styles.alertOverlaySpeedCell, {
                      backgroundColor: overLimit
                        ? "#E5393518"
                        : (isDark ? "#FFFFFF0A" : "#00000008"),
                    }]}>
                      <Text style={[styles.alertOverlayCellLabel, { color: fgMuted }]}>YOUR SPEED</Text>
                      <Text style={[styles.alertOverlayCellNum, {
                        color: speedClr,
                        fontSize: isSmall ? 38 : 46,
                        lineHeight: isSmall ? 44 : 52,
                      }]}>
                        {Math.round(currentSpeed)}
                      </Text>
                      <Text style={[styles.alertOverlayCellUnit, { color: fgMuted }]}>km/h</Text>
                    </View>
                  </View>
                ) : (
                  /* Non-speed alerts: proximity chip + optional speed limit */
                  <View style={[styles.alertOverlayChipRow, { paddingRight: isSmall ? 48 : 58 }]}>
                    <View style={[styles.alertOverlayChip, {
                      backgroundColor: overlayBorderColor + "20",
                      borderColor:     overlayBorderColor + "60",
                    }]}>
                      <Text style={[styles.alertOverlayChipTxt, { color: overlayBorderColor, fontSize: isSmall ? 14 : 16 }]}>
                        {primaryAlert.distanceM <  200 ? "⚠️ Very close"
                          : primaryAlert.distanceM < 500 ? "🔶 Approaching"
                          : "Community report"}
                      </Text>
                    </View>
                    {primaryAlert.speedLimit != null && (
                      <View style={[styles.alertOverlayChip, {
                        backgroundColor: primaryAlert.color + "18",
                        borderColor:     primaryAlert.color + "50",
                      }]}>
                        <Text style={[styles.alertOverlayChipTxt, { color: primaryAlert.color, fontSize: isSmall ? 14 : 16 }]}>
                          {primaryAlert.speedLimit} km/h zone
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            </Animated.View>
          )}

          {/* SOS — above the overlay via zIndex 10 */}
          <View style={{ position: "absolute", right: isSmall ? 8 : 12, bottom: isSmall ? 10 : 12, zIndex: 10 }}>
            <SOSButton compact small={isSmall} />
          </View>
        </View>
      )}

      {/* ── Idle-mode controls: Report Incident pill + small action pills ─────── */}
      {!isMapMode && !showResults && !tripActive && (
        <View style={{
          position: "absolute", left: 12, right: 12, zIndex: 14,
          flexDirection: "column", gap: 8,
          bottom: bottomBase + 8 + speedStripHeight + 8,
        }}>
          {/* Prominent Report Incident — full-width green pill */}
          <TouchableOpacity
            style={styles.reportIncidentPill}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowReport(true); }}
            activeOpacity={0.85}
          >
            <Ionicons name="add" size={18} color="#FFF" />
            <Text style={styles.reportIncidentPillTxt}>Report Incident</Text>
          </TouchableOpacity>

          {/* Small action pills row */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {mapDrifted && (
              <TouchableOpacity
                style={[styles.driveActionPill, {
                  backgroundColor: "#FFFFFFEE",
                  borderWidth: 1.5, borderColor: "#1565C0",
                  shadowColor: "#1565C0",
                }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  driveMapRef.current?.recenter();
                  setMapDrifted(false);
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="locate" size={14} color="#1565C0" />
                <Text style={[styles.driveActionPillTxt, { color: "#1565C0" }]}>Recenter</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.driveActionPill, {
                backgroundColor: isSharingTrip ? "#006600" : fabBg,
                flexShrink: 1, minWidth: 0,
              }]}
              onPress={handleSharePress}
              disabled={sharingLoading}
              activeOpacity={0.85}
            >
              {sharingLoading ? (
                <ActivityIndicator size="small" color={isDark ? "#aaa" : "#888"} />
              ) : (
                <>
                  <Ionicons
                    name={isSharingTrip ? "radio" : "share-social-outline"}
                    size={14}
                    color={isSharingTrip ? "#FFF" : fgMuted}
                  />
                  <Text style={[styles.driveActionPillTxt, { color: isSharingTrip ? "#FFF" : fgMuted }]} numberOfLines={1}>
                    {isSharingTrip ? "● Sharing" : "Share Location"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
            {Platform.OS !== "web" && (
              <TouchableOpacity
                style={[styles.driveActionPill, {
                  backgroundColor: dashcamRecording ? "#B71C1C" : "#1A1A1A",
                }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  if (dashcamRecording) {
                    // Stop the dashcam and save/lock the current clip
                    stopAndSaveDashcam();
                  } else {
                    // Not recording — start silently in the background so the
                    // map and alerts remain fully visible. If permission was
                    // denied, open the dashcam's permission-request screen so
                    // the user understands why nothing started.
                    startBackgroundRecording().then((ok) => { if (!ok) openDashcam(); });
                  }
                }}
                activeOpacity={0.85}
              >
                {dashcamRecording && (
                  <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#FF5252", marginRight: 2 }} />
                )}
                <Text style={styles.driveActionPillTxt}>
                  {dashcamRecording ? "● REC" : "🎥 Dashcam"}
                </Text>
              </TouchableOpacity>
            )}
            {/* Lock current dashcam clip — only visible while recording */}
            {dashcamRecording && Platform.OS !== "web" && (
              <TouchableOpacity
                style={[styles.driveActionPill, { backgroundColor: "#0D2E0D" }]}
                onPress={() => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  lockCurrentClip("manual");
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="lock-closed" size={12} color="#22c55e" />
                <Text style={[styles.driveActionPillTxt, { color: "#22c55e" }]}>Lock Clip</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          BOTTOM: Route preview sheet
          Wrapped in ErrorBoundary so a malformed activeRoute object
          (empty steps, NaN distance, etc.) hides the sheet rather than
          crashing the whole drive screen.
      ══════════════════════════════════════════════════════════════════ */}
      {isMapMode && !tripActive && activeRoute && (<ErrorBoundary FallbackComponent={() => null}>
        <View style={[styles.routeSheet, {
          backgroundColor: bg,
          paddingBottom: bottomBase,
        }]}>
          {/* Handle */}
          <View style={[styles.sheetHandle, { backgroundColor: divBg }]} />

          {/* ETA row */}
          <View style={styles.etaRow}>
            <View>
              <Text style={[styles.etaTime, { color: fgMain }]}>
                {durationStr(activeRoute.durationS)}
              </Text>
              <Text style={[styles.etaDist, { color: fgMuted }]}>
                {distStr(activeRoute.distanceM)}
                {navDestination ? ` · ${navDestination.name.split(",")[0]}` : ""}
              </Text>
              {routeTrafficDelayS > 0 && (
                <TouchableOpacity
                  style={styles.trafficDelayRow}
                  onPress={() => { setRouteIncidentsExpanded(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="time-outline" size={11} color="#E65100" />
                  <Text style={styles.trafficDelayTxt}>
                    Community reports: +{Math.round(routeTrafficDelayS / 60)} min
                  </Text>
                  <Ionicons name="chevron-forward" size={10} color="#E65100" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Incidents ahead — dedicated full-width bar, not squeezed into the ETA row */}
          {routeIncidentsAhead.length > 0 ? (
            <TouchableOpacity
              style={[styles.incidentsBar, { backgroundColor: "#E5393512", borderColor: "#E5393530" }]}
              onPress={() => { setRouteIncidentsExpanded(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              activeOpacity={0.8}
            >
              <Text style={styles.incidentsBarTxt} numberOfLines={1}>
                {incidentSummaryParts(routeIncidentsAhead).map((p, i) => (
                  <Text key={i}>
                    {i > 0 ? "   " : ""}
                    <Text style={{ fontFamily: EMOJI_FONT_FAMILY }}>{p.emoji}</Text> {p.label}
                  </Text>
                ))}
              </Text>
              <Ionicons name="chevron-forward" size={16} color="#E53935" />
            </TouchableOpacity>
          ) : (
            <View style={[styles.incidentsBar, { backgroundColor: "#2E7D3210", borderColor: "#2E7D3225" }]}>
              <Text style={{ fontFamily: EMOJI_FONT_FAMILY, fontSize: 14 }}>✅</Text>
              <Text style={[styles.incidentsBarTxt, { color: "#2E7D32", flex: 1 }]}>Route looks clear — no cameras, reports, or live alerts</Text>
            </View>
          )}

          {/* Alt routes */}
          {altRoutes.length > 0 && (
            <ScrollView {...SCROLL_PROPS} horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {/* Primary pill — only call it "Fastest" when no alt is actually shorter */}
                {(() => {
                  const isActuallyFastest = altRoutes.every((r) => r.durationS >= activeRoute.durationS);
                  return (
                    <View style={[styles.altPill, { backgroundColor: c.primary }]}>
                      <Text style={[styles.altPillTxt, { color: "#FFF" }]}>
                        {isActuallyFastest ? "Fastest" : "Selected"} · {durationStr(activeRoute.durationS)}
                      </Text>
                    </View>
                  );
                })()}
                {altRoutes.map((r) => {
                  const diffS = r.durationS - activeRoute.durationS;
                  const diffLabel =
                    diffS > 60 ? `+${Math.round(diffS / 60)} min` :
                    diffS < -60 ? `${Math.round(Math.abs(diffS) / 60)} min faster` :
                    durationStr(r.durationS);
                  return (
                    <TouchableOpacity
                      key={r.id}
                      style={[styles.altPill, { backgroundColor: isDark ? "#222" : "#F2F2F2" }]}
                      onPress={() => {
                        try {
                          selectRoute(r);
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        } catch (e) {
                          console.warn("[altRoute] selectRoute error:", e);
                        }
                      }}
                    >
                      <Text style={[styles.altPillTxt, { color: fgMain }]}>
                        {diffLabel} · {durationStr(r.durationS)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          )}

          {/* First step */}
          {activeRoute.steps?.[0] && (
            <View style={styles.firstStepRow}>
              <Ionicons name="arrow-forward-circle-outline" size={13} color={fgMuted} />
              <Text style={[styles.firstStepTxt, { color: fgMuted }]} numberOfLines={1}>
                {activeRoute.steps[0].instruction}
              </Text>
            </View>
          )}

          {/* Actions */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.cancelBtn, { backgroundColor: isDark ? "#222" : "#EFEFEF" }]}
              onPress={() => { clearDestination(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
            >
              <Ionicons name="close" size={16} color={fgMain} />
              <Text style={[styles.cancelBtnTxt, { color: fgMain }]}>Cancel</Text>
            </TouchableOpacity>
            <SOSButton compact small={isSmall} />
            <TouchableOpacity
              style={[styles.startBtn, { backgroundColor: c.primary }]}
              onPress={() => {
                // Multi-vehicle: pick which vehicle to use for this trip
                if (driveVehiclesRef.current.length > 1) {
                  setShowVehiclePicker(true);
                } else {
                  startTrip();
                }
              }}
            >
              <Ionicons name="navigate" size={17} color="#FFF" />
              <Text style={styles.startBtnTxt}>Start</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ErrorBoundary>)}

      {/* ══════════════════════════════════════════════════════════════════
          BOTTOM: Live Trip sheet
      ══════════════════════════════════════════════════════════════════ */}
      {tripActive && (
        <View
          style={[styles.liveTripSheet, {
            backgroundColor: isDark ? "#111514FA" : "#FFFFFFFA",
            borderTopWidth: 1, borderColor: c.tileBorder,
            paddingBottom: bottomInset + tabBarH - 18,
          }]}
          onLayout={(e) => setLiveTripSheetHeight(e.nativeEvent.layout.height)}
        >
          {/* Title row: "Drive Safely" + ETA (when routed) + SOS */}
          <View style={styles.dmPanelTitleRow}>
            <Text style={[styles.dmPanelTitle, { color: c.foreground }]}>Drive Safely</Text>
            {activeRoute != null && (
              <Text style={[styles.dmPanelEta, { color: c.mutedForeground }]} numberOfLines={1}>
                {durationStr(activeRoute.durationS)}
                {" · "}
                {distStr(activeRoute.distanceM)} left
              </Text>
            )}
            <SOSButton compact small />
          </View>

          {/* Stat tiles: Share Trip · Driving Score · Duration · Distance
              Current Speed removed — it's already prominent on the map dial. */}
          {(() => {
            const sc  = driveScore.score;
            const clr = getScoreColor(sc);
            const durTxt = (() => {
              const h = Math.floor(tripElapsedS / 3600);
              const m = Math.floor((tripElapsedS % 3600) / 60);
              const s = tripElapsedS % 60;
              return h > 0
                ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
                : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
            })();
            const distTxt = driveScore.distanceM >= 1000
              ? `${(driveScore.distanceM / 1000).toFixed(1)}`
              : `${Math.round(driveScore.distanceM)}`;
            const distUnit = driveScore.distanceM >= 1000 ? "km" : "m";
            const statTiles: { icon: keyof typeof Ionicons.glyphMap; color: string; value: string; unit?: string; label: string }[] = [
              { icon: "shield-outline",   color: clr,       value: `${sc}`,  label: "Driving Score" },
              { icon: "time-outline",     color: "#FFB300", value: durTxt,   label: "Duration" },
              { icon: "navigate-outline", color: "#8B7CF6", value: distTxt, unit: distUnit, label: "Distance" },
            ];
            return (
              <View style={styles.dmTileRow}>
                {/* Share Trip tile — interactive, replaces the redundant speed digit */}
                <TouchableOpacity
                  style={[styles.dmTile, {
                    backgroundColor: isSharingTrip
                      ? c.primary + "18"
                      : (isDark ? "#191E1B" : c.muted),
                    borderColor: isSharingTrip ? c.primary + "55" : c.tileBorder,
                  }]}
                  onPress={handleSharePress}
                  disabled={sharingLoading}
                  activeOpacity={0.8}
                >
                  {sharingLoading
                    ? <ActivityIndicator size="small" color={isSharingTrip ? c.primary : c.mutedForeground} />
                    : <Ionicons
                        name={isSharingTrip ? "radio" : "share-social-outline"}
                        size={18}
                        color={isSharingTrip ? c.primary : c.foreground}
                      />
                  }
                  <Text style={[styles.dmTileVal, { color: isSharingTrip ? c.primary : c.foreground }]} numberOfLines={1}>
                    {isSharingTrip ? "● Live" : "Off"}
                  </Text>
                  <Text style={[styles.dmTileLbl, { color: isSharingTrip ? c.primary : c.mutedForeground }]} numberOfLines={1}>
                    Share Trip
                  </Text>
                </TouchableOpacity>

                {statTiles.map((t) => (
                  <View
                    key={t.label}
                    style={[styles.dmTile, {
                      backgroundColor: isDark ? "#191E1B" : c.muted,
                      borderColor: c.tileBorder,
                    }]}
                  >
                    <Ionicons name={t.icon} size={18} color={t.color} />
                    <Text style={[styles.dmTileVal, { color: c.foreground }]} numberOfLines={1}>
                      {t.value}
                      {t.unit ? <Text style={[styles.dmTileUnit, { color: c.mutedForeground }]}> {t.unit}</Text> : null}
                    </Text>
                    <Text style={[styles.dmTileLbl, { color: c.mutedForeground }]} numberOfLines={1}>
                      {t.label}
                    </Text>
                  </View>
                ))}
              </View>
            );
          })()}

          {/* Bottom row: Dashcam toggle · red Stop Drive · Audio Alerts toggle */}
          <View style={styles.dmBottomRow}>
            {/* Dashcam card */}
            {Platform.OS !== "web" ? (
              <TouchableOpacity
                style={[styles.dmToggleCard, {
                  backgroundColor: isDark ? "#191E1B" : c.muted,
                  borderColor: dashcamRecording
                    ? c.speedDanger + "66"
                    : dashcamPending
                    ? c.primary + "66"
                    : c.tileBorder,
                }]}
                onPress={async () => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  if (dashcamRecording || dashcamPending) stopAndSaveDashcam();
                  else {
                    // Denied permission → show the dashcam permission screen.
                    const ok = await startBackgroundRecording();
                    if (!ok) openDashcam();
                  }
                }}
                activeOpacity={0.85}
              >
                {/* Icon + floating lock badge — lock sits on top of the icon so
                  it never consumes horizontal space in the card row. This
                  keeps the text column at full width on all screen sizes. */}
                <View style={{ position: "relative" }}>
                  <View style={[styles.dmToggleIcon, {
                    backgroundColor: dashcamRecording
                      ? c.speedDanger + "22"
                      : dashcamPending
                      ? c.primary + "22"
                      : (isDark ? "#232926" : "#FFFFFF"),
                  }]}>
                    {dashcamPending && !dashcamRecording
                      ? <ActivityIndicator size="small" color={c.primary} />
                      : <Ionicons name="videocam-outline" size={18} color={
                          dashcamRecording ? c.speedDanger : c.foreground
                        } />
                    }
                  </View>
                  {/* Lock badge — tap to protect current clip without opening
                      the full dashcam overlay. Floats top-right of the icon. */}
                  {dashcamRecording && (
                    <TouchableOpacity
                      style={[styles.dmLockBadge, { backgroundColor: c.primary, borderColor: c.card }]}
                      onPress={(e) => {
                        e.stopPropagation();
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        lockCurrentClip("manual");
                      }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      activeOpacity={0.75}
                    >
                      <Ionicons name="lock-closed" size={9} color="#FFF" />
                    </TouchableOpacity>
                  )}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.dmToggleTitle, { color: c.foreground }]} numberOfLines={1}>
                    Dashcam
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Text
                      style={[styles.dmToggleSub, {
                        color: dashcamRecording
                          ? c.speedDanger
                          : dashcamPending
                          ? c.primary
                          : c.mutedForeground,
                      }]}
                      numberOfLines={1}
                    >
                      {dashcamRecording ? "Recording" : dashcamPending ? "Starting…" : "Off"}
                    </Text>
                    {dashcamRecording && (
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.speedDanger }} />
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            ) : <View style={{ flex: 1 }} />}

            {/* Centre column: single multi-state transport-control button
                 ▶ play   = resume (when paused)
                 ⏸ pause  = pause  (when active)
                Long-press → stop the trip entirely (like a stop button ■)
                This mirrors how recording devices work: one button, three states. */}
            <View style={{ alignItems: "center", gap: 6 }}>
              <TouchableOpacity
                style={[styles.dmStopBtn, {
                  backgroundColor: tripPaused ? "#E5A20D" : "#E5484D",
                  shadowColor:     tripPaused ? "#E5A20D" : "#E5484D",
                  // Scale down on narrow phones so the two cards each get more room
                  width: isSmall ? 54 : 62, height: isSmall ? 54 : 62,
                  borderRadius: isSmall ? 27 : 31,
                }]}
                onPress={tripPaused ? resumeTrip : pauseTrip}
                onLongPress={() => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
                  captureAndStop();
                  // Navigation is intentionally removed — TripSummaryModal
                  // handles where the driver goes after reviewing their stats.
                }}
                delayLongPress={600}
                activeOpacity={0.85}
              >
                <Ionicons
                  name={tripPaused ? "play" : "pause"}
                  size={26}
                  color="#FFF"
                />
              </TouchableOpacity>
              <Text style={[styles.dmStopLbl, { color: c.mutedForeground }]}>
                {tripPaused ? "Resume" : "Hold to stop"}
              </Text>
            </View>

            {/* Audio Alerts card */}
            <TouchableOpacity
              style={[styles.dmToggleCard, {
                backgroundColor: isDark ? "#191E1B" : c.muted,
                borderColor: audioAlertsOn ? c.primary + "44" : c.tileBorder,
              }]}
              onPress={toggleAudioAlerts}
              activeOpacity={0.85}
            >
              <View style={[styles.dmToggleIcon, { backgroundColor: audioAlertsOn ? c.primary + "22" : (isDark ? "#232926" : "#FFFFFF") }]}>
                <Ionicons
                  name={audioAlertsOn ? "volume-high-outline" : "volume-mute-outline"}
                  size={18}
                  color={audioAlertsOn ? c.primary : c.mutedForeground}
                />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.dmToggleTitle, { color: c.foreground }]} numberOfLines={1}>
                  {isSmall ? "Audio" : "Audio Alerts"}
                </Text>
                <Text
                  style={[styles.dmToggleSub, { color: audioAlertsOn ? c.primary : c.mutedForeground }]}
                  numberOfLines={1}
                >
                  {audioAlertsOn ? "On" : "Off"}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Arrival card removed — Live Trip mode ends via "End Trip" button */}

      {/* Report incident modal */}
      <ReportModal
        visible={showReport}
        onClose={() => setShowReport(false)}
        currentLat={currentLat}
        currentLng={currentLng}
        onOpenMapPicker={(initialLat, initialLng, onConfirm) => {
          // iOS only allows one modal presentation at a time from the root
          // view controller. With ReportModal still open, presenting
          // CrosshairPickerModal queues indefinitely (10 s+). Fix: dismiss
          // ReportModal first, wait for its slide-out to finish (~300 ms),
          // then open CrosshairPickerModal. ReportModal state is preserved
          // because the component stays mounted (visible=false, not unmounted).
          setMapPickerActive(true);   // free DriveMapView surface immediately
          setShowReport(false);       // dismiss ReportModal
          setTimeout(() => {
            setCrosshairRequest({ lat: initialLat, lng: initialLng, onConfirm });
          }, 320);  // just past the default iOS modal dismiss animation (~300 ms)
        }}
        onSubmit={async (type, speedLimit, location) => {
          setShowReport(false);
          if (location) {
            const road = await getRoadName(location.lat, location.lng).catch(() => null);
            addReport(type, location.lat, location.lng, speedLimit, road ?? undefined);
          } else if (currentLat !== null && currentLng !== null) {
            // Prefer the route polyline when navigating — it pins the marker on
            // the exact road the driver is using, not just the nearest road in
            // Google's database (which can be the wrong lane or a parallel road).
            try {
              const [snapped, road] = await Promise.all([
                snapToRoad(currentLat, currentLng),
                getRoadName(currentLat, currentLng).catch(() => null),
              ]);
              addReport(type, snapped.lat, snapped.lng, speedLimit, road ?? undefined);
            } catch {
              addReport(type, currentLat, currentLng, speedLimit);
            }
          }
          // Play confirmation audio after the report is submitted
          playSound("confirm").catch(() => {});
          speakAlert("report_submitted").catch(() => {});
        }}
      />

      {/* Crosshair map picker — rendered at the screen root (NOT inside
          ReportModal) so it is never a nested Modal. DriveMapView's MapView
          is unmounted while this is visible via mapPickerActive in AppContext,
          guaranteeing a single native map surface is alive at any time. */}
      <CrosshairPickerModal
        visible={!!crosshairRequest}
        initialLat={crosshairRequest?.lat ?? -1.2921}
        initialLng={crosshairRequest?.lng ?? 36.8219}
        title="Pin the Incident Spot"
        onCancel={() => {
          setCrosshairRequest(null);
          setShowReport(true);   // return to report form with state intact
        }}
        onConfirm={(lat, lng) => {
          crosshairRequest?.onConfirm(lat, lng);
          setCrosshairRequest(null);
          setShowReport(true);   // return to report form with picked location set
        }}
      />

      {/* ── Nearby Alerts bottom sheet ────────────────────────────────────────── */}
      <Modal
        visible={showNearbySheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowNearbySheet(false)}
      >
        {/* Spacer-pressable pattern: backdrop Pressable fills all space above
            the sheet via flex:1, so the sheet sits naturally at the column
            bottom without absoluteFill or justifyContent tricks. */}
        <View style={{ flex: 1 }}>
          <Pressable
            style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }}
            onPress={() => setShowNearbySheet(false)}
          />
          <View style={[styles.nearbySheetContainer, { backgroundColor: c.card, paddingBottom: bottomInset + 12 }]}>
            <View style={styles.nearbySheetHandle} />
            <Text style={[styles.nearbySheetTitle, { color: c.foreground }]}>
              Nearby Alerts
            </Text>
            {/* No flex:1 on ScrollView — the container's maxHeight caps overall
                height; ScrollView expands to its content then becomes scrollable. */}
            <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
              {nearbyAlertCandidates.map((item) => {
                const resolved = resolveIncidentType(item.type);
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.nearbySheetRow, { borderBottomColor: c.border }]}
                    activeOpacity={0.7}
                    onPress={() => {
                      setShowNearbySheet(false);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      // Pause GPS follow BEFORE animating so the follow loop
                      // can't yank the camera back mid-flight. alertFocusModeRef
                      // tells the auto-resume effect to snap back after 8 s
                      // instead of the usual 30 s manual-pan window.
                      alertFocusModeRef.current = true;
                      setMapDrifted(true);
                      driveMapRef.current?.focusCoords(item.lat, item.lng);
                    }}
                  >
                    <View style={[styles.nearbySheetIconWrap, { backgroundColor: resolved.color + "22" }]}>
                      <Text style={{ fontSize: 20 }}>{resolved.emoji}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={[styles.nearbySheetRowTitle, { color: c.foreground }]}>
                          {resolved.label}
                        </Text>
                        {item.isHere && (
                          <View style={styles.liveBadge}>
                            <Text style={styles.liveBadgeTxt}>LIVE</Text>
                          </View>
                        )}
                      </View>
                      {item.road ? (
                        <Text style={[styles.nearbySheetRowSub, { color: c.mutedForeground }]} numberOfLines={1}>
                          {item.road}
                        </Text>
                      ) : null}
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 2 }}>
                      <Text style={[styles.nearbySheetDist, { color: c.mutedForeground }]}>
                        {distStr(item.distanceM)}
                      </Text>
                      <Ionicons name="chevron-forward" size={12} color={c.mutedForeground} />
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Driver name prompt (shown once before first live share) ─────────── */}
      <Modal
        visible={showNamePrompt}
        transparent
        animationType="fade"
        onRequestClose={() => setShowNamePrompt(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.namePromptOverlay}
        >
          <View style={[styles.namePromptSheet, { backgroundColor: c.card }]}>
            <Text style={[styles.namePromptTitle, { color: c.foreground }]}>
              What should people see?
            </Text>
            <Text style={[styles.namePromptSub, { color: c.mutedForeground }]}>
              People you share your live location with will see your name — e.g. "Jane is sharing their location".
            </Text>

            <View style={[styles.namePromptInputRow, { borderColor: c.border, backgroundColor: c.muted }]}>
              <Ionicons name="person-outline" size={18} color={c.mutedForeground} style={{ marginRight: 8 }} />
              <TextInput
                style={[styles.namePromptInput, { color: c.foreground }]}
                placeholder="Your first name (optional)"
                placeholderTextColor={c.mutedForeground}
                value={nameInput}
                onChangeText={setNameInput}
                returnKeyType="done"
                maxLength={40}
                autoFocus
              />
            </View>

            <TouchableOpacity
              style={[styles.namePromptPrimary, { backgroundColor: c.primary }]}
              activeOpacity={0.85}
              onPress={async () => {
                try {
                  const trimmed = nameInput.trim();
                  if (trimmed) setDriverName(trimmed);
                  await AsyncStorage.setItem("sdk_share_name_prompted", "1");
                  setShowNamePrompt(false);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  await doStartSharing(trimmed);
                } catch { /* non-fatal */ }
              }}
            >
              <Ionicons name="share-social-outline" size={17} color={c.primaryForeground} style={{ marginRight: 6 }} />
              <Text style={[styles.namePromptPrimaryTxt, { color: c.primaryForeground }]}>
                Start Sharing
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.namePromptSkip}
              activeOpacity={0.7}
              onPress={async () => {
                try {
                  await AsyncStorage.setItem("sdk_share_name_prompted", "1");
                  setShowNamePrompt(false);
                  await doStartSharing(driverName);
                } catch { /* non-fatal */ }
              }}
            >
              <Text style={[styles.namePromptSkipTxt, { color: c.mutedForeground }]}>Skip for now</Text>
            </TouchableOpacity>

            <Text style={[styles.namePromptHint, { color: c.mutedForeground }]}>
              You can update this anytime in Settings → Live Sharing
            </Text>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Incident confirmation prompt — proximity-triggered or push-notification deep-link */}
      {pendingConfirmationReport && (
        <IncidentConfirmationPrompt
          report={pendingConfirmationReport}
          onDismiss={() => {
            const id = pendingConfirmationReport.serverId ?? pendingConfirmationReport.id;
            markDismissed(id);
            setPendingConfirmationReport(null);
            setPendingConfirmationSource(null);
          }}
        />
      )}

      {/* Crash detection overlay — full-screen, highest z-index */}
      <CrashDetectedModal
        visible={crashDetected}
        onDismiss={clearCrash}
        onCallEmergency={() => { Linking.openURL("tel:112").catch(() => {}); clearCrash(); }}
        onCountdownExpired={handleCrashExpired}
        onStartCrashReport={handleStartCrashReport}
      />

      {/* Post-trip summary — slides up after the driver ends a trip */}
      <TripSummaryModal
        data={tripSummaryData}
        onDismiss={() => {
          setTripSummaryData(null);
          // Navigate home after the modal is dismissed via backdrop or close btn
          if (router.canGoBack()) router.back();
          else router.replace("/(tabs)");
        }}
        onStopSharing={() => {
          stopSharingTrip();
          // Update the summary data so the "Stop Sharing" button disappears
          setTripSummaryData(prev => prev ? { ...prev, isSharing: false } : null);
        }}
      />

      {/* ── Vehicle picker — shown before auto-start when user has 2+ vehicles ── */}
      <Modal
        visible={showVehiclePicker}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => {
          // User pressed back — cancel and go back to previous tab
          setShowVehiclePicker(false);
          autoStartedRef.current = false;
          router.back();
        }}
      >
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#00000080" }}>
          <View style={{
            backgroundColor: c.isDark ? "#111917" : "#fff",
            borderTopLeftRadius: 28, borderTopRightRadius: 28,
            paddingBottom: insets.bottom + 16,
          }}>
            {/* Drag handle */}
            <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 6 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.tileBorder }} />
            </View>

            {/* Header */}
            <View style={{ paddingHorizontal: 24, paddingTop: 10, paddingBottom: 18 }}>
              <Text style={{ fontSize: 20, fontFamily: "Inter_700Bold", color: c.foreground }}>
                Which vehicle are you driving?
              </Text>
              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: c.mutedForeground, marginTop: 4 }}>
                Select a vehicle so your trip is recorded correctly.
              </Text>
            </View>

            {/* Vehicle options */}
            {driveVehicles.map(v => {
              const make  = v.makeId ? getMakeById(v.makeId) : null;
              const model = (v.makeId && v.modelId) ? getModelById(v.makeId, v.modelId) : null;
              const name  = make && model
                ? `${make.name} ${model.name}`
                : (v.customMakeName && v.customModelName)
                ? `${v.customMakeName} ${v.customModelName}`
                : "My Vehicle";
              const emoji = (() => {
                switch (v.vehicleType) {
                  case "psv": return "🚐";
                  case "bus": return "🚌";
                  case "truck": return "🚛";
                  case "motorcycle": return "🏍️";
                  case "tractor": return "🚜";
                  default: return "🚗";
                }
              })();
              const isSelected = driveVehicleRef.current?.id === v.id;
              return (
                <TouchableOpacity
                  key={v.id}
                  activeOpacity={0.75}
                  onPress={() => {
                    driveVehicleRef.current = v;
                    setShowVehiclePicker(false);
                    startTrip();
                  }}
                  style={{
                    flexDirection: "row", alignItems: "center", gap: 14,
                    paddingHorizontal: 20, paddingVertical: 14, marginHorizontal: 12,
                    marginBottom: 8, borderRadius: 18, borderWidth: 1.5,
                    backgroundColor: isSelected ? c.primary + "12" : c.card,
                    borderColor: isSelected ? c.primary : c.tileBorder,
                  }}
                >
                  <View style={{
                    width: 52, height: 52, borderRadius: 16,
                    backgroundColor: c.primary + "18",
                    alignItems: "center", justifyContent: "center",
                  }}>
                    <Text style={{ fontSize: 26, fontFamily: EMOJI_FONT_FAMILY }}>{emoji}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: c.foreground }} numberOfLines={1}>
                      {name}
                    </Text>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: c.mutedForeground, marginTop: 2 }}>
                      {[v.fuelType, v.transmission].filter(Boolean).join(" · ") || "No details set"}
                      {v.isDefault ? "  ·  Default" : ""}
                    </Text>
                  </View>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={22} color={c.primary} />
                  )}
                  {!isSelected && (
                    <Ionicons name="chevron-forward" size={18} color={c.mutedForeground} />
                  )}
                </TouchableOpacity>
              );
            })}

            {/* Cancel */}
            <TouchableOpacity
              style={{ alignItems: "center", paddingVertical: 14, marginTop: 4 }}
              onPress={() => {
                setShowVehiclePicker(false);
                autoStartedRef.current = false;
                router.back();
              }}
            >
              <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: c.mutedForeground }}>
                Cancel — go back
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── 3-second pre-trip countdown overlay ────────────────────────────── */}
      {countdownValue !== null && (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              zIndex: 9500,
              backgroundColor: "rgba(0,0,0,0.82)",
              alignItems: "center",
              justifyContent: "center",
            },
          ]}
          pointerEvents="box-only"
        >
          {/* Outer ring */}
          <View style={{
            width: 160, height: 160, borderRadius: 80,
            borderWidth: 4, borderColor: "#00A84540",
            alignItems: "center", justifyContent: "center",
            marginBottom: 8,
          }}>
            <View style={{
              width: 136, height: 136, borderRadius: 68,
              borderWidth: 2.5, borderColor: "#00A845",
              alignItems: "center", justifyContent: "center",
            }}>
              <Text style={{
                color: "#fff",
                fontSize: 80,
                fontFamily: "Inter_900Black",
                lineHeight: 88,
                // @ts-ignore
                fontVariant: ["tabular-nums"],
              }}>
                {countdownValue}
              </Text>
            </View>
          </View>
          <Text style={{
            color: "rgba(255,255,255,0.7)",
            fontSize: 17,
            fontFamily: "Inter_600SemiBold",
            letterSpacing: 0.5,
          }}>
            {countdownValue === 3 ? "Starting drive…" : countdownValue === 2 ? "Get ready" : "Almost…"}
          </Text>
          <View style={{
            flexDirection: "row", alignItems: "center", gap: 6,
            marginTop: 24, backgroundColor: "#00A84515",
            paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
          }}>
            <Ionicons name="shield-checkmark-outline" size={15} color="#00A845" />
            <Text style={{ color: "#00A845", fontSize: 13, fontFamily: "Inter_600SemiBold" }}>
              Drive safe — Msafiri is watching
            </Text>
          </View>
        </View>
      )}

    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },



  // ── Search bar + results ─────────────────────────────────────────────────
  searchArea: {
    position: "absolute", left: 12, right: 12, zIndex: 18, gap: 6,
  },
  searchPill: {
    flexDirection: "row", alignItems: "center", height: 52, borderRadius: 26,
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.14, shadowRadius: 10, elevation: 8,
  },
  searchIconSlot: { width: 50, alignItems: "center", justifyContent: "center" },
  searchInput: { flex: 1, fontSize: 16, fontFamily: "Inter_500Medium" },

  resultsCard: {
    borderRadius: 20, overflow: "hidden", maxHeight: 350,
    shadowColor: "#000", shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.16, shadowRadius: 12, elevation: 12,
  },
  resultHint: { flexDirection: "row", alignItems: "center", gap: 8, padding: 16 },
  resultHintTxt: { fontSize: 14, fontFamily: "Inter_400Regular", flex: 1 },
  resultRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  resultName: { fontSize: 15, fontFamily: "Inter_500Medium" },
  resultSub:  { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  // ── Recent searches ───────────────────────────────────────────────────────
  recentsClearRow: {
    paddingHorizontal: 16, paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: "flex-end",
  },
  recentsClearTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  // ── Prominent Report button ───────────────────────────────────────────────
  reportBar: {
    position: "absolute", zIndex: 11,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: "#E65100",
    borderRadius: 22, paddingHorizontal: 16, paddingVertical: 11,
    gap: 7,
    shadowColor: "#E65100", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.45, shadowRadius: 8, elevation: 10,
  },
  reportBarTxt: {
    color: "#FFF", fontSize: 13, fontFamily: "Inter_700Bold",
  },

  // ── FAB column ────────────────────────────────────────────────────────────
  fabCol: { position: "absolute", zIndex: 12, gap: 9 },
  fab: {
    width: 43, height: 43, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18, shadowRadius: 6, elevation: 6,
  },

  // ── Speed strip ───────────────────────────────────────────────────────────
  speedStrip: {
    position: "absolute", left: 12, right: 12,
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 24, paddingHorizontal: 12, paddingVertical: 10,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 10,
  },
  // Speed group: consolidates speed digit + optional LIMIT ring into one
  // left-hand column (mirrors the nav bar's navSpeedBlock approach). Keeping
  // the limit inside the speed column lets us use a much wider digit (72 px)
  // without crowding the alert panel on the right.
  // minWidth: 130 — with paddingHorizontal:10 on the wrapper, content area is
  // 110 px. At Inter_700Bold 84 px, three digits ("130 km/h") still fit
  // (~126 px glyph width), with the container expanding slightly for 3 digits.
  speedGroup: { alignItems: "center", minWidth: 130, flexShrink: 0 },
  speedLabel: { fontSize: 9, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, marginBottom: 2 },
  speedNum:   { fontSize: 84, fontFamily: "Inter_700Bold", lineHeight: 100, includeFontPadding: false },
  speedUnit:  { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: -4 },

  limitLabel: { fontSize: 9, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8 },
  limitRing: {
    width: 46, height: 46, borderRadius: 23, borderWidth: 3,
    alignItems: "center", justifyContent: "center",
  },
  limitNum: { fontSize: 16, fontFamily: "Inter_700Bold" },

  // Stretch the divider to match whatever height the left block reaches
  // (which varies — limit ring is conditionally shown).
  vdivider: { width: 1, alignSelf: "stretch", borderRadius: 1, marginVertical: 4 },

  gpsBtn:    { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14 },
  gpsBtnTxt: { color: "#FFF", fontSize: 12, fontFamily: "Inter_600SemiBold" },

  // NEARBY ALERT badge — colour-coded pill above the alert type name
  nearbyAlertBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 10, borderWidth: 1,
  },
  nearbyAlertLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.9 },
  // Emoji marker — same rounded-square style as the map incident markers
  alertMarker: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
  },
  alertMarkerEmoji: { fontSize: 16, lineHeight: 20, fontFamily: EMOJI_FONT_FAMILY },
  zoneTypeName:     { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  zoneSpeedLine:    { fontSize: 13, fontFamily: "Inter_700Bold" },
  zoneDistAhead:    { fontSize: 11, fontFamily: "Inter_400Regular" },

  // ── Full-strip alert overlay ──────────────────────────────────────────────
  // Outer Animated.View: positions the overlay + carries the animated opacity
  // and distance-coded border. borderLeftWidth / borderLeftColor applied inline.
  alertOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 16,
    zIndex: 5,
    overflow: "hidden",
  },
  // Inner TouchableOpacity fills the Animated.View and holds the layout.
  alertOverlayInner: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  alertOverlayTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  alertOverlayIconWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  alertOverlayEmoji: {
    lineHeight: 36,
    fontFamily: EMOJI_FONT_FAMILY,
  },
  alertOverlayTypeName: {
    fontFamily: "Inter_700Bold",
  },
  alertOverlayMoreTxt: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  alertOverlayDistNum: {
    fontFamily: "Inter_700Bold",
    textAlign: "right",
  },
  alertOverlayDistLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "right",
    marginTop: 1,
  },
  alertOverlaySpeedRow: {
    flexDirection: "row",
    gap: 8,
  },
  alertOverlaySpeedCell: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: "center",
    gap: 1,
  },
  alertOverlayCellLabel: {
    fontSize: 9,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
  },
  alertOverlayCellNum: {
    fontFamily: "Inter_700Bold",
    lineHeight: 32,
  },
  alertOverlayCellUnit: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
  },
  alertOverlayChipRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  alertOverlayChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  alertOverlayChipTxt: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },

  // ── Idle-mode share button (mirrors nav share button, shown when not navigating) ──
  idleShareBtn: {
    position: "absolute", zIndex: 11,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    borderRadius: 22, paddingHorizontal: 14, paddingVertical: 11,
    gap: 6,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 6, elevation: 8,
  },
  idleShareBtnTxt: {
    fontSize: 13, fontFamily: "Inter_700Bold",
  },

  // Legacy (kept to avoid tsc errors on any surviving references)
  zoneContextLabel: { fontSize: 9, fontFamily: "Inter_600SemiBold", letterSpacing: 0.6, textTransform: "uppercase" },
  zoneName: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  zoneDist: { fontSize: 12, fontFamily: "Inter_400Regular" },
  clearTxt: { fontSize: 13, fontFamily: "Inter_400Regular" },

  // ── Route preview sheet ───────────────────────────────────────────────────
  routeSheet: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingTop: 10, paddingHorizontal: 16, gap: 10,
    shadowColor: "#000", shadowOffset: { width: 0, height: -5 },
    shadowOpacity: 0.13, shadowRadius: 16, elevation: 16,
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 6 },
  etaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  etaTime: { fontSize: 28, fontFamily: "Inter_700Bold" },
  etaDist: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  trafficDelayRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  trafficDelayTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#E65100" },
  incidentsBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8,
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderWidth: 1,
  },
  incidentsBarTxt: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#E53935" },
  altPill:    { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 },
  altPillTxt: { fontSize: 13, fontFamily: "Inter_500Medium" },
  firstStepRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  firstStepTxt: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  cancelBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 13, borderRadius: 14,
  },
  cancelBtnTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  startBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 16,
  },
  startBtnTxt: { color: "#FFF", fontSize: 16, fontFamily: "Inter_700Bold" },

  // ── Navigation bottom bar ─────────────────────────────────────────────────
  navBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    gap: 10,
    paddingTop: 14, paddingHorizontal: 16,
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    shadowColor: "#000", shadowOffset: { width: 0, height: -5 },
    shadowOpacity: 0.13, shadowRadius: 16, elevation: 16,
  },
  navBarTopRow: {
    flexDirection: "row", alignItems: "stretch", gap: 10,
  },
  navSpeedBlock: {
    alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18,
  },
  navSpeedLabel: { fontSize: 8, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8 },
  navSpeedNum:  { fontSize: 70, fontFamily: "Inter_700Bold", lineHeight: 84, includeFontPadding: false },
  navSpeedUnit: { fontSize: 9, fontFamily: "Inter_400Regular", marginTop: -2 },
  navLimitRing: {
    width: 38, height: 38, borderRadius: 19, borderWidth: 2.5,
    alignItems: "center", justifyContent: "center",
  },
  navLimitNum:  { fontSize: 14, fontFamily: "Inter_700Bold" },
  navDivider:   { width: 1, borderRadius: 1, marginHorizontal: 2, opacity: 0.5 },
  navEta:       { fontSize: 19, fontFamily: "Inter_700Bold" },
  navArrive:    { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1, opacity: 0.75 },
  navDest:      { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  navResumeSub: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2, opacity: 0.9 },
  navDisabledChip: { position: "absolute", alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, backgroundColor: "#00000033", zIndex: 18 },
  navDisabledChipTxt: { color: "#AAA", fontSize: 11, fontFamily: "Inter_500Medium" },

  stopBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#E53935",
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14,
  },
  stopBtnTxt: { color: "#FFF", fontSize: 14, fontFamily: "Inter_700Bold" },
  navShareBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14,
  },
  navShareBtnTxt: { fontSize: 14, fontFamily: "Inter_700Bold" },
  // Action row: Share (flex:1) + SOS + Stop — its own row so it never fights
  // with ETA text for horizontal space (the Android overlap fix).
  navActionRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  // Small chip below the speed/limit block showing the NEXT camera's limit
  // when the driver is about to enter a different speed zone.
  navNextCamChip: {
    flexDirection: "row", alignItems: "center", gap: 3,
    marginTop: 6, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8,
  },
  navNextCamTxt: { fontSize: 10, fontFamily: "Inter_700Bold" },

  navReportBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#E65100",
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 22,
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25, shadowRadius: 6, elevation: 8,
  },
  navReportTxt: { color: "#FFF", fontSize: 13, fontFamily: "Inter_700Bold" },

  // ── Kenyan-colors bottom action row (replaces old vertical FAB column) ───
  // Used for both the pre-nav row (above speed strip) and the nav row (above nav bar).
  // right: 12 gives the row a defined right edge so pills cannot overflow off-screen
  // on narrow devices (iPhone SE, 375pt). Variable-width pills (Share Location) get
  // flexShrink: 1 inline so they compress first before the row overflows.
  driveNavActionRow: {
    position: "absolute", left: 12, right: 12, zIndex: 14,
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  driveActionPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 24,
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28, shadowRadius: 7, elevation: 9,
  },
  driveActionPillTxt: { color: "#FFF", fontSize: 13, fontFamily: "Inter_700Bold" },

  // ── Cluster-dismiss re-arm hint pill ─────────────────────────────────────
  pauseNotePill: {
    position:          "absolute",
    alignSelf:         "center",
    flexDirection:     "row",
    alignItems:        "center",
    gap:               6,
    paddingHorizontal: 18,
    paddingVertical:   11,
    borderRadius:      24,
    backgroundColor:   "rgba(0,0,0,0.78)",
    zIndex:            16,
    shadowColor:       "#000",
    shadowOffset:      { width: 0, height: 3 },
    shadowOpacity:     0.30,
    shadowRadius:      6,
    elevation:         10,
  },
  pauseNoteTxt: { color: "#FFF", fontSize: 13, fontFamily: "Inter_600SemiBold" },

  // ── Divergence preview chip ───────────────────────────────────────────────
  // Row: absolute-positioned, full-width, centres the pill. box-none so
  // touches outside the pill pass straight through to the map.
  divergenceChipRow: {
    position: "absolute", left: 0, right: 0,
    alignItems: "center", justifyContent: "center",
    zIndex: 13,
  } as const,
  // Pill: the actual tappable badge the driver sees.
  divergenceChip: {
    flexDirection: "row", gap: 5,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#FF2D7820",
    borderWidth: 1, borderColor: "#FF2D7866",
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
  } as const,
  divergenceChipTxt: {
    fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#FF2D78",
  },

  // ── Nav-mode right-side FAB column (legacy — kept to avoid TS errors) ────
  navFabCol: {
    position: "absolute", zIndex: 14,
    alignItems: "flex-end", gap: 8,
  },


  // ── Arrival card ────────────────────────────────────────────────────────
  arrivalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  arrivalSheet: {
    borderTopLeftRadius: 32, borderTopRightRadius: 32,
    paddingHorizontal: 24, paddingTop: 12, paddingBottom: 48,
    alignItems: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18, shadowRadius: 20, elevation: 24,
  },
  arrivalHandle: {
    width: 40, height: 4, borderRadius: 2, marginBottom: 24,
  },
  arrivalIconWrap: { marginBottom: 12 },
  arrivalHeading: {
    fontSize: 26, fontFamily: "Inter_700Bold", marginBottom: 6, textAlign: "center",
  },
  arrivalDestName: {
    fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center",
    marginBottom: 24, paddingHorizontal: 8,
  },
  arrivalStats: {
    flexDirection: "row", borderRadius: 18, borderWidth: 1,
    paddingVertical: 16, paddingHorizontal: 8,
    width: "100%", marginBottom: 20,
  },
  arrivalStat: { flex: 1, alignItems: "center", gap: 2 },
  arrivalStatVal: { fontSize: 22, fontFamily: "Inter_700Bold" },
  arrivalStatLbl: { fontSize: 11, fontFamily: "Inter_400Regular" },
  arrivalStatDiv: { width: 1, marginVertical: 4 },
  arrivalParkBtn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    width: "100%", paddingVertical: 15, paddingHorizontal: 20,
    borderRadius: 16, borderWidth: 1, marginBottom: 12, justifyContent: "center",
  },
  arrivalParkTxt: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  arrivalDoneBtn: {
    width: "100%", paddingVertical: 16, borderRadius: 16,
    alignItems: "center", flexDirection: "row", justifyContent: "center",
  },
  arrivalDoneTxt: { fontSize: 16, fontFamily: "Inter_700Bold" },
  arrivalResumeName: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4 },
  arrivalResumeDest: { fontSize: 17, fontFamily: "Inter_700Bold", textAlign: "center", marginBottom: 4 },
  arrivalDeclineBtn: { alignItems: "center", paddingVertical: 14 },
  arrivalDeclineTxt: { fontSize: 14, fontFamily: "Inter_400Regular" },

  // ── Nearby Alerts sheet ───────────────────────────────────────────────────
  nearbySheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  nearbySheetContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "60%",
    paddingBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 24,
  },
  nearbySheetHandle: {
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 6,
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  nearbySheetTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    marginHorizontal: 20,
    marginBottom: 12,
  },
  nearbySheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  nearbySheetIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  nearbySheetRowTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  liveBadge: {
    backgroundColor: "#D32F2F",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  liveBadgeTxt: {
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    color: "#FFF",
    letterSpacing: 0.8,
  },
  nearbySheetRowSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  nearbySheetDist: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },

  // ── Driver name prompt modal ───────────────────────────────────────────────
  namePromptOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  namePromptSheet: {
    width: "100%",
    borderRadius: 24,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 20,
  },
  namePromptTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    marginBottom: 8,
    textAlign: "center",
  },
  namePromptSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
    textAlign: "center",
    marginBottom: 20,
  },
  namePromptInputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  namePromptInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  namePromptPrimary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 15,
    borderRadius: 14,
    marginBottom: 10,
  },
  namePromptPrimaryTxt: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  namePromptSkip: {
    alignItems: "center",
    paddingVertical: 10,
  },
  namePromptSkipTxt: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  namePromptHint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 12,
    opacity: 0.7,
  },

  // ── Drive Mode header ─────────────────────────────────────────────────────
  tripHeader: {
    position: "absolute", left: 0, right: 0, zIndex: 20,
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingBottom: 10,
  },
  tripHeaderTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  dmHeaderSub:     { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  dmShieldWrap: {
    width: 38, height: 38, borderRadius: 12, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  dmHeaderBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: "center", justifyContent: "center",
  },

  // ── Drive Mode top alert banner ───────────────────────────────────────────
  dmAlertBanner: {
    position: "absolute", left: 12, right: 12, zIndex: 19,
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 18, borderWidth: 1.5,
    paddingHorizontal: 12, paddingVertical: 10,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 10, elevation: 10,
  },
  dmAlertIconWrap: {
    width: 42, height: 42, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  dmAlertTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  dmAlertSub:   { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  dmLimitBadge: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 4, borderColor: "#E5484D",
    backgroundColor: "#FFF",
    alignItems: "center", justifyContent: "center",
  },
  dmLimitBadgeTxt: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111" },

  // ── Drive Mode speed dial ─────────────────────────────────────────────────
  dmDialWrap: {
    position: "absolute", left: 14, zIndex: 15,
    width: 96, height: 96, borderRadius: 48, borderWidth: 5,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 10,
  },
  dmDialNum:  { fontSize: 32, fontFamily: "Inter_700Bold", lineHeight: 36, includeFontPadding: false },
  dmDialUnit: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: -2 },
  dmDialLimit: {
    position: "absolute", bottom: -14, alignSelf: "center",
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 3.5, borderColor: "#E5484D",
    backgroundColor: "#FFF",
    alignItems: "center", justifyContent: "center",
  },
  dmDialLimitTxt: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#111" },

  // ── Drive Mode right-edge round buttons ──────────────────────────────────
  dmSideCol: {
    position: "absolute", right: 14, zIndex: 15, gap: 12,
    alignItems: "center",
  },
  dmSideBtn: {
    width: 60, height: 60, borderRadius: 18, borderWidth: 1,
    alignItems: "center", justifyContent: "center", gap: 1,
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25, shadowRadius: 7, elevation: 8,
  },
  dmSideBtnTxt: { fontSize: 10, fontFamily: "Inter_600SemiBold" },

  // ── Drive Mode weather / GPS chips ────────────────────────────────────────
  dmChipRow: {
    position: "absolute", left: 12, right: 12, zIndex: 14,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  dmChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8,
  },
  dmChipTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  // ── Drive Safely panel ────────────────────────────────────────────────────
  dmPanelTitleRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingTop: 6, paddingBottom: 10,
  },
  dmPanelTitle: { fontSize: 18, fontFamily: "Inter_700Bold", flexShrink: 0 },
  dmPanelEta:   { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "right", marginRight: 4 },
  dmTileRow: { flexDirection: "row", gap: 8 },
  dmTile: {
    flex: 1, borderRadius: 14, borderWidth: 1,
    paddingVertical: 10, paddingHorizontal: 4,
    alignItems: "center", gap: 3,
  },
  dmTileVal:  { fontSize: 15, fontFamily: "Inter_700Bold" },
  dmTileUnit: { fontSize: 10, fontFamily: "Inter_500Medium" },
  dmTileLbl:  { fontSize: 9.5, fontFamily: "Inter_500Medium" },
  dmBottomRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginTop: 12,
  },
  dmToggleCard: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 16, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 10,
  },
  dmToggleIcon: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  dmToggleTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  dmToggleSub:   { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 1 },
  dmStopBtn: {
    // width/height/borderRadius are overridden inline with isSmall
    width: 62, height: 62, borderRadius: 31,
    backgroundColor: "#E5484D",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#E5484D", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5, shadowRadius: 10, elevation: 10,
  },
  dmLockBadge: {
    // Floating badge anchored to the top-right corner of the dashcam icon.
    // Absolute position means it never takes horizontal space in the card row,
    // so the text column always has full available width on all screen sizes.
    position: "absolute", top: -5, right: -5,
    width: 18, height: 18, borderRadius: 9,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5,
  },
  dmStopSquare: { width: 20, height: 20, borderRadius: 5, backgroundColor: "#FFF" },
  dmStopLbl: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  // ── Compact LIVE pill — replaces the old trip info card. Styled to match
  // the red "● REC" dashcam pill; sits next to the speed gauge (left: 14,
  // width: 96) so the rest of the top row stays free for alert overlays.
  livePill: {
    position: "absolute",
    left: 120,   // 14 (gauge left) + 96 (gauge width) + 10 gap
    zIndex: 19,
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#B71C1C", borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 7,
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 6, elevation: 8,
  },
  livePillDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#FF5252" },
  livePillTxt: { color: "#FFF", fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 1 },

  // ── Live Trip bottom sheet ─────────────────────────────────────────────────
  liveTripSheet: {
    position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 15,
    paddingTop: 10, paddingHorizontal: 16,
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    shadowColor: "#000", shadowOffset: { width: 0, height: -5 },
    shadowOpacity: 0.13, shadowRadius: 16, elevation: 16,
  },
  liveTripShareRow:     { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  liveTripShareIconWrap: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  liveTripShareTitle:   { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  liveTripShareSub:     { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  liveTripShareBtn:     {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14,
  },
  liveTripShareBtnTxt:  { color: "#FFF", fontSize: 13, fontFamily: "Inter_700Bold" },
  liveTripDivider:      { height: StyleSheet.hairlineWidth, marginVertical: 6 },
  liveTripDetailsHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
  liveTripDetailsLabel:  { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  liveTripStatsRow:     { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  liveTripStat:         { flex: 1, alignItems: "center", gap: 3 },
  liveTripStatVal:      { fontSize: 17, fontFamily: "Inter_700Bold" },
  liveTripStatLbl:      { fontSize: 11, fontFamily: "Inter_400Regular" },
  liveTripStatDiv:      { width: 1, height: 36, borderRadius: 1 },
  liveTripScoreRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 10,
  },
  liveTripScoreBadge: {
    width: 52, height: 52, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  liveTripScoreNum: {
    fontSize: 22, fontFamily: "Inter_700Bold",
  },
  liveTripScoreTitle: {
    fontSize: 14, fontFamily: "Inter_700Bold",
  },
  liveTripScoreDetail: {
    fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2,
  },
  liveTripScoreLbl: {
    fontSize: 11, fontFamily: "Inter_400Regular",
  },

  // ── Pause / Resume button ─────────────────────────────────────────────────
  pauseBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 14,
    borderWidth: 1, borderColor: "rgba(128,128,128,0.2)",
  },
  pauseBtnTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  liveTripActionRow:    { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  liveTripReportBtn:    {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: "#1B5E20", gap: 6, paddingVertical: 13, borderRadius: 16,
  },
  liveTripReportBtnTxt: { color: "#FFF", fontSize: 14, fontFamily: "Inter_700Bold" },

  // ── Idle drive — prominent Report Incident pill ────────────────────────────
  reportIncidentPill: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: "#1B5E20", borderRadius: 28, paddingVertical: 13, gap: 8,
    shadowColor: "#1B5E20", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.45, shadowRadius: 8, elevation: 10,
  },
  reportIncidentPillTxt: { color: "#FFF", fontSize: 15, fontFamily: "Inter_700Bold" },
});
