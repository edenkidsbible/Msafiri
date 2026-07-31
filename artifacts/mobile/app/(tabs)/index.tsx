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
import DriveAlertOverlay from "@/components/DriveAlertOverlay";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";
import SOSButton from "@/components/SOSButton";
import DriveMapView, { type DriveMapViewHandle } from "@/components/DriveMapView";
import { isCivilTwilight } from "@/utils/solarTwilight";
import ReportModal from "@/components/ReportModal";
import IncidentConfirmationPrompt from "@/components/IncidentConfirmationPrompt";
import { useIncidentConfirmationPrompt } from "@/hooks/useIncidentConfirmationPrompt";
import { nominatimSearch, GeoResult } from "@/utils/geocoding";
import {
  loadRecentSearches,
  saveRecentSearch,
  removeRecentSearch,
  clearRecentSearches,
} from "@/utils/recentSearches";
import { snapToRoad } from "@/utils/snapToRoad";
import { resolveIncidentType } from "@/constants/incidentTypes";
import { useRoundaboutExitCounter } from "@/hooks/useRoundaboutExitCounter";
import RouteSearchSheet from "@/components/RouteSearchSheet";
import { playSound } from "@/utils/sound";
import { speakAlert } from "@/utils/alertTts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

/** Format estimated arrival as a clock time, e.g. "Arrive 14:35" */
function arrivalTimeStr(durationS: number): string {
  const d = new Date(Date.now() + durationS * 1000);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  return `Arrive ${h}:${m}`;
}

function maneuverIcon(instruction: string): keyof typeof Ionicons.glyphMap {
  const l = instruction.toLowerCase();
  if (l.includes("right")) return "arrow-forward-circle";
  if (l.includes("left"))  return "arrow-back-circle";
  if (l.includes("roundabout")) return "reload-circle";
  if (l.includes("arrived") || l.includes("destination")) return "checkmark-circle";
  if (l.includes("head") || l.includes("depart")) return "navigate";
  if (l.includes("merge")) return "git-merge-outline";
  return "arrow-up-circle";
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
    activeRoute, altRoutes, divergenceRoutes, selectRoute, routeLoading,
    navigationActive, startNavigation, stopNavigation,
    currentStepIdx, distToNextM, distanceRemainingM, durationRemainingS, zonesOnRoute,
    routeIncidentsAhead, routeTrafficDelayS, setRouteIncidentsExpanded,
    showTraffic, setShowTraffic,
    addReport, currentLat, currentLng, snapToActiveRoute,
    arrivedInfo, clearArrival,
    pendingConfirmationReport, setPendingConfirmationReport,
    setPendingConfirmationSource,
    isSharingTrip, shareLink, startSharingTrip, stopSharingTrip,
    driverName, setDriverName,
    gpsLost,
    fasterRoute, acceptFasterRoute, dismissFasterRoute,
  } = useApp();

  const { markDismissed } = useIncidentConfirmationPrompt();

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
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recentSearches, setRecentSearches] = useState<GeoResult[]>([]);
  const [sharingLoading, setSharingLoading] = useState(false);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [speedStripHeight, setSpeedStripHeight] = useState(150);
  const [navCardHeight, setNavCardHeight] = useState(0);
  const [showNearbySheet, setShowNearbySheet] = useState(false);
  const driveMapRef = useRef<DriveMapViewHandle>(null);
  // #34 — Search Along Route
  const [showRouteSearch, setShowRouteSearch] = useState(false);
  // #6 — resume original destination after a Search Along Route stop
  const [resumeDestination, setResumeDestination] = useState<import("@/context/AppContext").NavDestination | null>(null);
  // Coordinates of the active divert stop — used for departure detection.
  // Stored in a ref so the distance-check effect doesn't re-register on every GPS tick.
  const divertStopRef = useRef<{ lat: number; lng: number } | null>(null);
  // True once the driver has arrived within 200 m of the divert stop so we
  // don't trigger departure before they've even reached the place.
  const divertArrivedRef = useRef(false);

  // ── Map drift (driver panned away from GPS position during navigation) ────
  const [mapDrifted, setMapDrifted] = useState(false);
  // When an alert is tapped in the Nearby sheet we force drift=true so GPS
  // follow stops before focusCoords animates. This flag tells the auto-resume
  // effect to use a shorter 8 s window (peek) instead of the 30 s manual-pan
  // window, so the driver is snapped back quickly without waiting.
  const alertFocusModeRef = useRef(false);
  const [navBarHeight, setNavBarHeight] = useState(0);
  // Brief toast shown after a cluster dismiss — tells the driver how long alerts
  // are paused near this area so they know what to expect if they pass again.
  const [pauseNote, setPauseNote] = useState<string | null>(null);
  const pauseNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Kenya flag color-cycle on the Report button — cycles Red→Black→Green→Red
  // so it's impossible to miss. useNativeDriver must be false for color animation.
  const reportColorAnim = useRef(new Animated.Value(0)).current;
  const reportBgColor   = reportColorAnim.interpolate({
    inputRange:  [0, 1, 2, 3],
    outputRange: ["#CE1126", "#1A1A1A", "#006600", "#CE1126"],
  });
  // Load recent searches from AsyncStorage on mount
  useEffect(() => {
    loadRecentSearches().then(setRecentSearches).catch(() => {});
  }, []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(reportColorAnim, { toValue: 3, duration: 3000, useNativeDriver: false })
    );
    loop.start();
    return () => loop.stop();
  }, [reportColorAnim]);

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

  // Clear drift state when navigation ends (e.g. driver taps Stop)
  useEffect(() => {
    if (!navigationActive) {
      setMapDrifted(false);
    }
  }, [navigationActive]);

  // Auto-resume timers (8 s / 30 s) have been intentionally removed.
  // The map now stays wherever the driver panned it until they explicitly tap
  // the Recenter button.  This gives the driver full control and removes the
  // disorienting snap-back that was happening mid-inspection.
  // alertFocusModeRef is kept for callers that set it, but it no longer
  // triggers an auto-resume countdown.

  // Safety net: clear resumeDestination whenever navigation ends without an arrival.
  // When the driver arrives naturally, both navigationActive→false and arrivedInfo are
  // set in the same React batch, so arrivedInfo is non-null here and we leave
  // resumeDestination intact for the arrival modal to use.
  useEffect(() => {
    if (!navigationActive && arrivedInfo == null) {
      setResumeDestination(null);
      divertStopRef.current    = null;
      divertArrivedRef.current = false;
    }
  }, [navigationActive, arrivedInfo]);

  // ── Auto-depart detection ────────────────────────────────────────────────
  // When the driver has a divert stop active AND navigation has ended (they've
  // arrived at the stop or dismissed it), watch their GPS position.
  // Once they've been within 200 m (arrived), then move >350 m away
  // (departed), automatically resume navigation to the saved destination.
  useEffect(() => {
    if (!resumeDestination) return;          // no divert in progress
    if (navigationActive) return;            // still navigating to the stop
    if (!arrivedInfo) return;                // arrival modal not showing
    if (currentLat == null || currentLng == null) return;

    const stop = divertStopRef.current;
    if (!stop) return;

    const distFromStop = haversineM(currentLat, currentLng, stop.lat, stop.lng);

    // Gate: mark as "arrived" once within 200 m of the divert stop
    if (!divertArrivedRef.current && distFromStop <= 200) {
      divertArrivedRef.current = true;
    }

    // Depart: driver was close, now >350 m away → auto-resume
    if (divertArrivedRef.current && distFromStop > 350) {
      const dest = resumeDestination;
      clearArrival();
      setResumeDestination(null);
      divertStopRef.current    = null;
      divertArrivedRef.current = false;
      setNavDestination(dest);
      startNavigation();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [currentLat, currentLng, resumeDestination, navigationActive, arrivedInfo,
      clearArrival, setNavDestination, startNavigation]);

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

  // #10 — when driver taps Stop mid-SAR-stop, offer to resume the original destination
  const handleStopPress = useCallback(() => {
    if (resumeDestination) {
      const dest = resumeDestination;
      const poiName = navDestination?.name.split(",")[0] ?? "this stop";
      const originalName = dest.name.split(",")[0];
      Alert.alert(
        "Abandon stop?",
        `Navigate to ${originalName} instead of continuing to ${poiName}?`,
        [
          {
            text: "Yes, go to " + originalName,
            style: "default",
            onPress: () => {
              // Swap destination without stopping — avoids triggering the
              // safety-net useEffect that clears resumeDestination on Stop.
              setResumeDestination(null);
              setNavDestination(dest);
              startNavigation();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            },
          },
          {
            text: "No, stop here",
            style: "destructive",
            onPress: () => {
              setResumeDestination(null);
              stopNavigation();
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            },
          },
        ],
      );
    } else {
      setResumeDestination(null);
      stopNavigation();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, [resumeDestination, navDestination, setNavDestination, startNavigation, stopNavigation]);

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
  const isMapMode  = (hasRoute || navigationActive) && !showResults;
  const currentStep = activeRoute?.steps?.[currentStepIdx] ?? null;

  // ── Roundabout exit counter ───────────────────────────────────────────────
  const isRoundaboutStep = currentStep?.instruction?.toLowerCase().includes("roundabout") ?? false;
  const { exitsPassed, targetExitIsNext } = useRoundaboutExitCounter({
    currentLat,
    currentLng,
    currentStepIdx,
    navigationActive,
    targetExitNumber: isRoundaboutStep ? (currentStep?.exitNumber ?? null) : null,
  });

  // Fade animation for the ETA bar — fires when durationRemainingS jumps >60 s
  // (traffic refresh). Small per-GPS-fix drift is below the threshold and ignored.
  const etaFadeAnim = useRef(new Animated.Value(1)).current;
  const prevEtaRef  = useRef<number | null>(null);

  // Pulse animation for the exit badge when the target exit is next
  const exitBadgePulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (targetExitIsNext) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(exitBadgePulse, {
            toValue: 1.35,
            duration: 380,
            useNativeDriver: Platform.OS !== "web",
          }),
          Animated.timing(exitBadgePulse, {
            toValue: 1.0,
            duration: 380,
            useNativeDriver: Platform.OS !== "web",
          }),
        ]),
      );
      loop.start();
      return () => { loop.stop(); exitBadgePulse.setValue(1); };
    }
    exitBadgePulse.setValue(1);
    return undefined;
  }, [targetExitIsNext, exitBadgePulse]);

  const prevTargetExitIsNextRef = useRef(false);

  // Fade the ETA bar on large jumps (traffic refresh >60 s); ignore GPS drift.
  useEffect(() => {
    const prev = prevEtaRef.current;
    prevEtaRef.current = durationRemainingS;
    if (prev == null || durationRemainingS == null) return;
    if (Math.abs(durationRemainingS - prev) < 60) return;
    Animated.sequence([
      Animated.timing(etaFadeAnim, { toValue: 0, duration: 150, useNativeDriver: Platform.OS !== "web" }),
      Animated.timing(etaFadeAnim, { toValue: 1, duration: 250, useNativeDriver: Platform.OS !== "web" }),
    ]).start();
  }, [durationRemainingS, etaFadeAnim]);

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
    // While navigating, routeIncidentsAhead already merges zones + reports on
    // the route and sorts by distance remaining — use it directly.
    if (navigationActive && routeIncidentsAhead.length > 0) {
      const inc = routeIncidentsAhead[0];
      return {
        type:       inc.type,
        typeName:   resolveIncidentType(inc.type).label,
        speedLimit: inc.speedLimit,
        distanceM:  inc.aheadDistanceM ?? 0,
        color:      resolveIncidentType(inc.type).color,
      };
    }

    // Outside navigation: find the closest item from EITHER source and show
    // whichever is nearer, so a freshly-reported incident beats a far camera.
    type AlertCandidate = {
      type: string; typeName: string; speedLimit?: number;
      distanceM: number; color: string;
    };
    const candidates: AlertCandidate[] = [];

    // Static speed zones (already proximity-sorted by AppContext)
    if (nearbyZones.length > 0) {
      const z = nearbyZones[0];
      candidates.push({
        type: z.type, typeName: resolveIncidentType(z.type).label,
        speedLimit: z.speedLimit, distanceM: z.distance, color: resolveIncidentType(z.type).color,
      });
    }

    // Community reports + HERE incidents within 3 km
    if (currentLat != null && currentLng != null) {
      const TWO_HOURS = 2 * 60 * 60 * 1000;
      const REPORT_RADIUS_M = 3000;
      const now = Date.now();
      let nearestDist = Infinity;
      let nearestReport: typeof communityReports[0] | null = null;
      for (const r of communityReports) {
        if (now - r.timestamp > TWO_HOURS) continue;
        const d = haversineM(currentLat, currentLng, r.lat, r.lng);
        if (d <= REPORT_RADIUS_M && d < nearestDist) {
          nearestDist = d;
          nearestReport = r;
        }
      }
      if (nearestReport) {
        candidates.push({
          type: nearestReport.type, typeName: resolveIncidentType(nearestReport.type).label,
          speedLimit: nearestReport.speedLimit ?? undefined,
          distanceM: nearestDist, color: resolveIncidentType(nearestReport.type).color,
        });
      }
      // HERE Live Traffic incidents within 3 km
      let nearestHereDist = Infinity;
      let nearestHere: typeof hereIncidents[0] | null = null;
      for (const h of hereIncidents) {
        if (h.endTime != null && h.endTime < now) continue;
        const d = haversineM(currentLat, currentLng, h.lat, h.lng);
        if (d <= REPORT_RADIUS_M && d < nearestHereDist) {
          nearestHereDist = d;
          nearestHere = h;
        }
      }
      if (nearestHere) {
        candidates.push({
          type: nearestHere.type, typeName: resolveIncidentType(nearestHere.type).label,
          distanceM: nearestHereDist, color: resolveIncidentType(nearestHere.type).color,
        });
      }
    }

    if (candidates.length === 0) return null;
    // Pick the closest — a HERE incident 200 m away wins over a camera 1 km away
    return candidates.sort((a, b) => a.distanceM - b.distanceM)[0];
  }, [navigationActive, routeIncidentsAhead, nearbyZones, communityReports, hereIncidents, currentLat, currentLng]);

  // HUD-aware colours
  const bg      = isDark ? "#0A0A0AEF" : "#FFFFFFF0";
  const fgMain  = isDark ? "#F0F0F0"   : "#111111";
  const fgMuted = isDark ? "#777777"   : "#888888";
  const divBg   = isDark ? "#2A2A2A"   : "#E5E5E5";
  const fabBg   = isDark ? "#1A1A1AEE" : "#FFFFFFEE";
  const speedClr = overLimit ? "#E53935" : (isDark ? "#00E676" : "#1A237E");

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
    setNavDestination({ name: r.display, lat: r.lat, lng: r.lng });
    setSearchText(r.short);
    setGeoResults([]);
    setShowResults(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Persist to recents (newest-first, deduped)
    saveRecentSearch(r).then(setRecentSearches);
  };

  const clearDestination = () => {
    Keyboard.dismiss();
    stopNavigation();
    setNavDestination(null);
    setResumeDestination(null);
    setSearchText("");
    setGeoResults([]);
    setShowResults(false);
    setSearchError(false);
  };

  const bottomBase = bottomInset + tabBarH + 10;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <Animated.View style={[styles.screen, { opacity: screenFade }]}>

      {/* ── Base layer: full-screen map ── */}
      <View style={StyleSheet.absoluteFillObject}>
        <DriveMapView ref={driveMapRef} mapDrifted={mapDrifted} onDriftChange={setMapDrifted} />
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
          // Cover the gauge exactly: in nav mode cover the nav bar; in normal
          // mode cover the speed strip up to just above the report buttons.
          // The +20 adds a small breathing gap above the gauge top edge.
          minPanelHeight={
            navigationActive && navBarHeight > 0
              ? navBarHeight + 20
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
              bottom: navigationActive && navBarHeight > 0
                ? navBarHeight + 64
                : bottomBase + speedStripHeight + 64,
            },
          ]}
        >
          <Ionicons name="time-outline" size={14} color="#FFF" />
          <Text style={styles.pauseNoteTxt}>{pauseNote}</Text>
        </View>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TOP: Navigation instruction card (during active navigation)
      ══════════════════════════════════════════════════════════════════ */}
      {navigationActive && currentStep && (
        <View
          style={[styles.navCard, {
            top: topInset + 4,
            backgroundColor: isDark ? "#0F2040F5" : "#1565C0F5",
          }]}
          onLayout={(e) => setNavCardHeight(e.nativeEvent.layout.height)}
        >
          <View style={styles.navCardIcon}>
            <Ionicons name={maneuverIcon(currentStep.instruction)} size={30} color="#FFF" />
            {currentStep.exitNumber != null && (
              <Animated.View style={[styles.exitBadge, {
                transform: [{ scale: exitBadgePulse }],
                backgroundColor: targetExitIsNext ? "#FFC107" : "#FFF",
              }]}>
                <Text style={[styles.exitBadgeTxt, {
                  color: targetExitIsNext ? "#7B3F00" : "#1565C0",
                }]}>
                  {currentStep.exitNumber}
                </Text>
              </Animated.View>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.navInstruction} numberOfLines={2}>
              {currentStep.instruction}
            </Text>
            {distToNextM != null && !isRoundaboutStep && (
              <Text style={styles.navDist}>{distStr(distToNextM)}</Text>
            )}
            {/* Roundabout exit counter — shown instead of distance while in roundabout */}
            {isRoundaboutStep && currentStep.exitNumber != null && (
              <View style={styles.rabRow}>
                {Array.from({ length: currentStep.exitNumber }).map((_, i) => {
                  const isPassed = i < exitsPassed;
                  const isTarget = i === currentStep.exitNumber! - 1;
                  const isNextUp = isTarget && targetExitIsNext;
                  return (
                    <View
                      key={i}
                      style={[
                        styles.rabDot,
                        isPassed  && styles.rabDotPassed,
                        isTarget  && !isPassed && styles.rabDotTarget,
                        isNextUp  && styles.rabDotNext,
                      ]}
                    />
                  );
                })}
                <Text style={styles.rabLabel}>
                  {targetExitIsNext
                    ? "Exit now!"
                    : exitsPassed > 0
                      ? `${currentStep.exitNumber - exitsPassed} more`
                      : `Exit ${currentStep.exitNumber}`}
                </Text>
              </View>
            )}
            {isRoundaboutStep && distToNextM != null && (
              <Text style={[styles.navDist, { opacity: 0.7 }]}>{distStr(distToNextM)}</Text>
            )}
          </View>
        </View>
      )}

      {/* ── Faster route available banner ────────────────────────────────────
          Appears during active navigation when the periodic background check
          finds a route ≥ 3 min faster than the current remaining ETA.
          Positioned just below the nav instruction card. */}
      {navigationActive && !!fasterRoute && durationRemainingS != null && (
        <View style={[styles.fasterRouteBanner, { top: topInset + 4 + navCardHeight + 6 }]}>
          <Ionicons name="flash" size={14} color="#FFF" style={{ marginLeft: 12 }} />
          <Text style={styles.fasterRouteTxt} numberOfLines={1}>
            Faster route — save {Math.max(1, Math.round((durationRemainingS - fasterRoute.durationS) / 60))} min
          </Text>
          <TouchableOpacity
            style={styles.fasterRouteSwitch}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              acceptFasterRoute();
            }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Text style={styles.fasterRouteSwitchTxt}>Switch</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ paddingHorizontal: 10, paddingVertical: 8 }}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              dismissFasterRoute();
            }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Ionicons name="close" size={16} color="#FFFFFFCC" />
          </TouchableOpacity>
        </View>
      )}

      {/* GPS signal-lost chip — shown during dead reckoning (mid-nav only) */}
      {navigationActive && gpsLost && (
        <View style={[styles.gpsLostChip, { top: topInset + 4 }]}>
          <Ionicons name="cloud-offline-outline" size={12} color="#FFF" />
          <Text style={styles.gpsLostText}>GPS signal lost</Text>
        </View>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TOP: Search bar + results (when not navigating)
      ══════════════════════════════════════════════════════════════════ */}
      {!navigationActive && (
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

          {/* Recents dropdown — shown when focused with no text typed */}
          {!showResults && searchInputFocused && searchText.length === 0 && recentSearches.length > 0 && (
            <View pointerEvents="auto" style={[styles.resultsCard, { backgroundColor: bg }]}>
              {/* Clear all header */}
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
            </View>
          )}
        </View>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          RIGHT: Utility FABs — Traffic & Night mode (hidden during search/nav)
      ══════════════════════════════════════════════════════════════════ */}
      {!showResults && !navigationActive && (
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

          <TouchableOpacity
            style={[styles.fab, { backgroundColor: fabBg }]}
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
        </View>
      )}

      {/* ── During-navigation Kenyan-colors action row ──────────────────────
          Floats just above the nav bar. Recenter (when drifted) + Find Nearby (black) + Report (red, pulsing).
          Replaces the old top-right vertical FAB column. */}
      {!showResults && navigationActive && (
        <View style={[styles.driveNavActionRow, { bottom: navBarHeight + 8 }]}>
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

          {/* Find Nearby — hidden when Recenter is visible to protect Report pill space */}
          {!mapDrifted && (
            <TouchableOpacity
              style={[styles.driveActionPill, { backgroundColor: "#1A1A1A" }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowRouteSearch(true); }}
              activeOpacity={0.85}
            >
              <Text style={styles.driveActionPillTxt}>🔍 Nearby</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowReport(true); }}
            activeOpacity={0.82}
          >
            <Animated.View style={[styles.driveActionPill, { backgroundColor: reportBgColor }]}>
              <Ionicons name="camera" size={14} color="#FFF" />
              <Text style={styles.driveActionPillTxt}>Report</Text>
            </Animated.View>
          </TouchableOpacity>
        </View>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          BOTTOM: Normal-mode speed card.
          Left block: speed + LIMIT stacked (like the nav bar).
          Right panel: NEARBY ALERT badge + type + "X km ahead".
      ══════════════════════════════════════════════════════════════════ */}
      {!isMapMode && !showResults && (
        <View
          style={[styles.speedStrip, {
            bottom: bottomBase + 8,
            backgroundColor: bg,
            gap: isSmall ? 6 : 10,
            paddingHorizontal: isSmall ? 8 : 12,
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

          {/* SOS — anchored to the bottom-right of the strip so it stays out
              of the way of the taller alert badge row above it. */}
          <View style={{ position: "absolute", right: isSmall ? 8 : 12, bottom: isSmall ? 10 : 12 }}>
            <SOSButton compact small={isSmall} />
          </View>
        </View>
      )}

      {/* ── Pre-navigation Kenyan-colors action row ──────────────────────────
          Sits above the speed strip when there is no active route or nav.
          Share Location (green when live) · Find Nearby (black) · Report (red, pulsing).
          Replaces the old separate reportBar + idleShareBtn + Find Nearby FAB. */}
      {!isMapMode && !showResults && (
        <View style={[styles.driveNavActionRow, { bottom: bottomBase + 8 + speedStripHeight + 8 }]}>

          {/* Recenter — shown when map has drifted from GPS position */}
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

          {/* Share Location — Kenya green when actively sharing.
              flexShrink: 1 lets this pill compress first on narrow screens (375pt)
              before the row can overflow its right: 12 boundary. */}
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

          {/* Find Nearby — hidden when Recenter is visible to protect Report pill space */}
          {!mapDrifted && (
            <TouchableOpacity
              style={[styles.driveActionPill, { backgroundColor: "#1A1A1A" }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowRouteSearch(true); }}
              activeOpacity={0.85}
            >
              <Text style={styles.driveActionPillTxt}>🔍 Nearby</Text>
            </TouchableOpacity>
          )}

          {/* Report — Kenya flag color cycle */}
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowReport(true); }}
            activeOpacity={0.82}
          >
            <Animated.View style={[styles.driveActionPill, { backgroundColor: reportBgColor }]}>
              <Text style={{ fontSize: 14, fontFamily: EMOJI_FONT_FAMILY }}>📣</Text>
              <Text style={styles.driveActionPillTxt}>Report</Text>
            </Animated.View>
          </TouchableOpacity>

        </View>
      )}

      {/* ── Divergence preview chip ─────────────────────────────────────────
          Floats above the action-pill row while the driver is off-route and
          pink alternative polylines are visible on the map. */}
      {!showResults && navigationActive && divergenceRoutes.length > 0 && (
        // box-none so the containing row doesn't eat map touches outside the pill
        <View
          pointerEvents="box-none"
          style={[styles.divergenceChipRow, { bottom: navBarHeight + 54 }]}
        >
          <TouchableOpacity
            activeOpacity={0.75}
            style={styles.divergenceChip}
            onPress={() => {
              // Commit to the first (best) divergence route instantly
              selectRoute(divergenceRoutes[0]);
              void startNavigation();
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }}
          >
            <Ionicons name="git-branch-outline" size={13} color="#FF2D78" />
            <Text style={styles.divergenceChipTxt}>
              {divergenceRoutes.length === 1
                ? "Tap to take this route"
                : `${divergenceRoutes.length} alternatives — tap one`}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          BOTTOM: Route preview sheet
          Wrapped in ErrorBoundary so a malformed activeRoute object
          (empty steps, NaN distance, etc.) hides the sheet rather than
          crashing the whole drive screen.
      ══════════════════════════════════════════════════════════════════ */}
      {isMapMode && !navigationActive && activeRoute && (<ErrorBoundary FallbackComponent={() => null}>
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
          {activeRoute.steps[0] && (
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
              onPress={() => { startNavigation(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }}
            >
              <Ionicons name="navigate" size={17} color="#FFF" />
              <Text style={styles.startBtnTxt}>Start</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ErrorBoundary>)}

      {/* ══════════════════════════════════════════════════════════════════
          BOTTOM: Navigation active bar
      ══════════════════════════════════════════════════════════════════ */}
      {navigationActive && (
        <View
          style={[styles.navBar, { backgroundColor: bg, paddingBottom: bottomBase }]}
          onLayout={(e) => setNavBarHeight(e.nativeEvent.layout.height)}
        >

          <View style={styles.navBarTopRow}>
            {/* Left: speed digit + current limit ring + upcoming zone chip */}
            <View style={[styles.navSpeedBlock, {
              backgroundColor: overLimit ? "#E5393518" : (isDark ? "#00E67618" : "#E8F5E9"),
              paddingHorizontal: isSmall ? 10 : 14,
            }]}>
              <Text style={[styles.navSpeedLabel, { color: overLimit ? "#E5393380" : (isDark ? "#00E67680" : "#2E7D3280") }]}>
                YOUR SPEED
              </Text>
              <Text style={[styles.navSpeedNum, {
                color: overLimit ? "#E53935" : (isDark ? "#00E676" : "#2E7D32"),
                fontSize: isSmall ? 54 : 70,
                lineHeight: isSmall ? 66 : 84,
              }]}>
                {Math.round(currentSpeed)}
              </Text>
              <Text style={[styles.navSpeedUnit, { color: overLimit ? "#E5393380" : (isDark ? "#00E67680" : "#2E7D3280") }]}>
                km/h
              </Text>
              {currentSpeedLimit != null && (
                <View style={{ alignItems: "center", marginTop: isSmall ? 4 : 6, gap: 2 }}>
                  <Text style={[styles.navSpeedLabel, { color: fgMuted }]}>LIMIT</Text>
                  <View style={[styles.navLimitRing, {
                    borderColor: overLimit ? "#E53935" : (isDark ? "#555" : "#333"),
                    width: isSmall ? 32 : 38,
                    height: isSmall ? 32 : 38,
                    borderRadius: isSmall ? 16 : 19,
                  }]}>
                    <Text style={[styles.navLimitNum, {
                      color: overLimit ? "#E53935" : fgMain,
                      fontSize: isSmall ? 12 : 14,
                    }]}>
                      {currentSpeedLimit}
                    </Text>
                  </View>
                </View>
              )}
              {/* Upcoming camera/zone chip — next limit when different from current zone */}
              {activeAlert?.source === "zone" && activeAlert.speedLimit != null &&
                activeAlert.speedLimit !== currentSpeedLimit && (
                <View style={[styles.navNextCamChip, { backgroundColor: isDark ? "#FFFFFF12" : "#00000010" }]}>
                  <Ionicons
                    name={activeAlert.type === "camera" ? "camera" : activeAlert.type === "police" ? "shield" : "warning"}
                    size={9}
                    color={fgMuted}
                  />
                  <Text style={[styles.navNextCamTxt, { color: fgMuted }]}>
                    {activeAlert.speedLimit} km/h
                  </Text>
                </View>
              )}
            </View>

            <View style={[styles.navDivider, { backgroundColor: divBg }]} />

            {/* Right: ETA block (full width) then action row below.
                Keeping ETA and buttons in separate rows eliminates the Android
                overlap where long ETA text used to fight SOS + Stop for space. */}
            <View style={{ flex: 1, gap: 6 }}>

              {/* ETA / arrival / destination — unobstructed, full column width */}
              <Animated.View style={{ opacity: etaFadeAnim }}>
                <Text style={[styles.navEta, { color: fgMain }]}>
                  {durationStr(durationRemainingS ?? (activeRoute?.durationS ?? 0))}
                </Text>
                <Text style={[styles.navArrive, { color: fgMuted }]}>
                  {arrivalTimeStr(durationRemainingS ?? (activeRoute?.durationS ?? 0))}
                  {distanceRemainingM != null ? ` · ${distStr(distanceRemainingM)}` : ""}
                </Text>
                <Text style={[styles.navDest, { color: fgMuted }]} numberOfLines={1}>
                  {navDestination?.name?.split(",")[0]}
                </Text>
                {resumeDestination && (
                  <Text style={[styles.navResumeSub, { color: c.primary }]} numberOfLines={1}>
                    ↩ en route to {resumeDestination.name?.split(",")[0]}
                  </Text>
                )}
              </Animated.View>

              {/* Alert chip — nearest incident on the active route.
                  Uses primaryAlert which, during navigation, is sourced from
                  routeIncidentsAhead[0] — already sorted by distance ahead.
                  Tapping opens the same nearby-alerts sheet as the speed strip. */}
              {primaryAlert && (
                <TouchableOpacity
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setShowNearbySheet(true);
                  }}
                  activeOpacity={0.8}
                  style={[styles.navAlertChip, {
                    backgroundColor: primaryAlert.color + "22",
                    borderColor: primaryAlert.color + "55",
                  }]}
                >
                  <Text style={{ fontSize: 13, fontFamily: EMOJI_FONT_FAMILY }}>
                    {resolveIncidentType(primaryAlert.type).emoji}
                  </Text>
                  <Text style={[styles.navAlertChipTxt, { color: primaryAlert.color }]}>
                    {distStr(primaryAlert.distanceM)}
                  </Text>
                  {nearbyAlertCandidates.length > 1 && (
                    <Ionicons name="chevron-forward" size={10} color={primaryAlert.color} />
                  )}
                </TouchableOpacity>
              )}

              {/* Action row: Share (flex) · SOS · Stop — own row, never squishes */}
              <View style={styles.navActionRow}>
                <TouchableOpacity
                  style={[styles.navShareBtn, {
                    flex: 1,
                    backgroundColor: isSharingTrip ? "#00C853" : (isDark ? "#262626" : "#F2F2F2"),
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
                        color={isSharingTrip ? "#fff" : fgMuted}
                      />
                      <Text style={[styles.navShareBtnTxt, { color: isSharingTrip ? "#fff" : fgMuted }]} numberOfLines={1}>
                        {isSharingTrip ? "● Sharing" : "Share ETA"}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
                <SOSButton compact small={isSmall} />
                <TouchableOpacity
                  style={styles.stopBtn}
                  onPress={handleStopPress}
                >
                  <Ionicons name="stop-circle" size={15} color="#FFF" />
                  <Text style={styles.stopBtnTxt}>Stop</Text>
                </TouchableOpacity>
              </View>

            </View>
          </View>

          {routeIncidentsAhead.length > 0 && (
            <TouchableOpacity
              style={[styles.incidentsBar, {
                backgroundColor: isDark ? "#00E67614" : "#E5393512",
                borderColor: isDark ? "#00E67640" : "#E5393530",
              }]}
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
              <Ionicons name="chevron-forward" size={16} color={isDark ? "#00E676" : "#E53935"} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ── Arrival card ──────────────────────────────────────────────────── */}
      {arrivedInfo && (
        <Modal
          visible
          transparent
          animationType="slide"
          onRequestClose={() => { clearArrival(); stopNavigation(); }}
        >
          <View style={styles.arrivalOverlay}>
            <View style={[styles.arrivalSheet, { backgroundColor: c.card }]}>
              <View style={[styles.arrivalHandle, { backgroundColor: c.border }]} />

              {/* Icon + title */}
              <View style={styles.arrivalIconWrap}>
                <Ionicons name="checkmark-circle" size={60} color="#00C853" />
              </View>
              <Text style={[styles.arrivalHeading, { color: c.foreground }]}>You've arrived!</Text>
              <Text style={[styles.arrivalDestName, { color: c.mutedForeground }]} numberOfLines={2}>
                {arrivedInfo.destName}
              </Text>

              {/* Trip stats strip */}
              <View style={[styles.arrivalStats, { backgroundColor: c.muted, borderColor: c.border }]}>
                <View style={styles.arrivalStat}>
                  <Text style={[styles.arrivalStatVal, { color: c.foreground }]}>
                    {arrivedInfo.distM >= 1000
                      ? `${(arrivedInfo.distM / 1000).toFixed(1)}`
                      : `${Math.round(arrivedInfo.distM)}`}
                  </Text>
                  <Text style={[styles.arrivalStatLbl, { color: c.mutedForeground }]}>
                    {arrivedInfo.distM >= 1000 ? "km" : "m"}
                  </Text>
                </View>
                <View style={[styles.arrivalStatDiv, { backgroundColor: c.border }]} />
                <View style={styles.arrivalStat}>
                  <Text style={[styles.arrivalStatVal, { color: c.foreground }]}>
                    {Math.floor(arrivedInfo.durationS / 60)}
                  </Text>
                  <Text style={[styles.arrivalStatLbl, { color: c.mutedForeground }]}>min</Text>
                </View>
                <View style={[styles.arrivalStatDiv, { backgroundColor: c.border }]} />
                <View style={styles.arrivalStat}>
                  <Text style={[styles.arrivalStatVal, { color: c.foreground }]}>
                    {Math.round(arrivedInfo.maxSpeedKmh)}
                  </Text>
                  <Text style={[styles.arrivalStatLbl, { color: c.mutedForeground }]}>km/h max</Text>
                </View>
                {arrivedInfo.alertsCount > 0 && (
                  <>
                    <View style={[styles.arrivalStatDiv, { backgroundColor: c.border }]} />
                    <View style={styles.arrivalStat}>
                      <Text style={[styles.arrivalStatVal, { color: "#E53935" }]}>
                        {arrivedInfo.alertsCount}
                      </Text>
                      <Text style={[styles.arrivalStatLbl, { color: c.mutedForeground }]}>alerts</Text>
                    </View>
                  </>
                )}
              </View>

              {/* Resume destination prompt — shown when the stop was a Search Along Route POI */}
              {resumeDestination ? (
                <>
                  <Text style={[styles.arrivalResumeName, { color: c.mutedForeground }]}>
                    Original destination:
                  </Text>
                  <Text style={[styles.arrivalResumeDest, { color: c.foreground }]} numberOfLines={2}>
                    {resumeDestination.name?.split(",")[0]}
                  </Text>

                  {/* Continue button */}
                  <TouchableOpacity
                    style={[styles.arrivalDoneBtn, { backgroundColor: c.primary, marginTop: 12 }]}
                    onPress={() => {
                      const dest = resumeDestination;
                      clearArrival();
                      setResumeDestination(null);
                      setNavDestination(dest);
                      startNavigation().catch(() => {});
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                    }}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="navigate" size={16} color={c.primaryForeground} style={{ marginRight: 6 }} />
                    <Text style={[styles.arrivalDoneTxt, { color: c.primaryForeground }]}>
                      Continue to {resumeDestination.name?.split(",")[0]}
                    </Text>
                  </TouchableOpacity>

                  {/* Decline link */}
                  <TouchableOpacity
                    style={styles.arrivalDeclineBtn}
                    onPress={() => { clearArrival(); stopNavigation(); setResumeDestination(null); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.arrivalDeclineTxt, { color: c.mutedForeground }]}>
                      No thanks, I'm done
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {/* Parking search button */}
                  <TouchableOpacity
                    style={[styles.arrivalParkBtn, { backgroundColor: c.muted, borderColor: c.border }]}
                    onPress={() => {
                      clearArrival();
                      stopNavigation();
                      setSearchText("parking near me");
                      runSearch("parking near me");
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="car-outline" size={18} color={c.foreground} />
                    <Text style={[styles.arrivalParkTxt, { color: c.foreground }]}>Find Nearby Parking</Text>
                  </TouchableOpacity>

                  {/* Done button */}
                  <TouchableOpacity
                    style={[styles.arrivalDoneBtn, { backgroundColor: c.primary }]}
                    onPress={() => { clearArrival(); stopNavigation(); }}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.arrivalDoneTxt, { color: c.primaryForeground }]}>Done</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </Modal>
      )}

      {/* Report incident modal */}
      <ReportModal
        visible={showReport}
        onClose={() => setShowReport(false)}
        currentLat={currentLat}
        currentLng={currentLng}
        onSubmit={async (type, speedLimit, location) => {
          setShowReport(false);
          if (location) {
            addReport(type, location.lat, location.lng, speedLimit);
          } else if (currentLat !== null && currentLng !== null) {
            // Prefer the route polyline when navigating — it pins the marker on
            // the exact road the driver is using, not just the nearest road in
            // Google's database (which can be the wrong lane or a parallel road).
            try {
              const routeSnap = snapToActiveRoute(currentLat, currentLng);
              const snapped = routeSnap ?? await snapToRoad(currentLat, currentLng);
              addReport(type, snapped.lat, snapped.lng, speedLimit);
            } catch {
              // Fall back to raw GPS coords if snap fails
              addReport(type, currentLat, currentLng, speedLimit);
            }
          }
          // Play confirmation audio after the report is submitted
          playSound("confirm").catch(() => {});
          speakAlert("report_submitted").catch(() => {});
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

      {/* #34 — Search Along Route */}
      <RouteSearchSheet
        visible={showRouteSearch}
        onClose={() => setShowRouteSearch(false)}
        onSelect={(poi) => {
          setShowRouteSearch(false);

          const doNavigate = (divert: boolean) => {
            if (divert && navDestination) {
              // Save original destination; store divert stop coords for departure detection
              setResumeDestination(navDestination);
              divertStopRef.current    = { lat: poi.lat, lng: poi.lng };
              divertArrivedRef.current = false;
            } else {
              // Full destination change — discard any prior resume destination
              setResumeDestination(null);
              divertStopRef.current    = null;
              divertArrivedRef.current = false;
            }
            setNavDestination({ name: poi.name, lat: poi.lat, lng: poi.lng });
            setSearchText(poi.name);
            startNavigation();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          };

          // When there's already an active destination, ask the driver whether to
          // divert (and resume later) or simply change the destination.
          if (navDestination) {
            const origName = navDestination.name.split(",")[0];
            Alert.alert(
              poi.name,
              `How would you like to proceed?`,
              [
                {
                  text: `Divert here, then continue to ${origName}`,
                  onPress: () => doNavigate(true),
                },
                {
                  text: "Change destination",
                  style: "destructive",
                  onPress: () => doNavigate(false),
                },
                {
                  text: "Cancel",
                  style: "cancel",
                  onPress: () => setShowRouteSearch(true), // reopen the sheet
                },
              ],
            );
          } else {
            // No prior destination — navigate directly without prompting
            doNavigate(false);
          }
        }}
      />
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },


  // ── Navigation instruction card ───────────────────────────────────────────
  navCard: {
    position: "absolute", left: 12, right: 12, zIndex: 20,
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 22, padding: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25, shadowRadius: 14, elevation: 12,
  },
  navCardIcon: {
    width: 56, height: 56, borderRadius: 18,
    backgroundColor: "#FFFFFF22",
    alignItems: "center", justifyContent: "center",
    overflow: "visible",
  },
  exitBadge: {
    position: "absolute", bottom: -5, right: -5,
    backgroundColor: "#FFF", borderRadius: 10,
    minWidth: 20, height: 20, paddingHorizontal: 4,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25, shadowRadius: 3, elevation: 4,
  },
  exitBadgeTxt: {
    color: "#1565C0", fontSize: 11, fontFamily: "Inter_700Bold", lineHeight: 14,
  },
  navInstruction: {
    fontSize: 17, fontFamily: "Inter_700Bold", color: "#FFF", lineHeight: 24,
  },
  navDist: {
    fontSize: 24, fontFamily: "Inter_700Bold", color: "#90CAF9", marginTop: 4,
  },
  navAlertChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 12, borderWidth: 1,
  },
  navAlertChipTxt: {
    fontSize: 12, fontFamily: "Inter_600SemiBold",
  },

  // ── Roundabout exit counter ───────────────────────────────────────────────
  rabRow: {
    flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6, flexWrap: "wrap",
  },
  rabDot: {
    width: 10, height: 10, borderRadius: 5,
    borderWidth: 1.5, borderColor: "#FFFFFF55",
    backgroundColor: "transparent",
  },
  rabDotPassed: {
    backgroundColor: "#FFFFFF80",
    borderColor: "#FFFFFF80",
  },
  rabDotTarget: {
    width: 12, height: 12, borderRadius: 6,
    borderWidth: 2, borderColor: "#FFC107",
    backgroundColor: "transparent",
  },
  rabDotNext: {
    backgroundColor: "#FFC107",
    borderColor: "#FFC107",
  },
  rabLabel: {
    marginLeft: 4,
    fontSize: 13, fontFamily: "Inter_700Bold", color: "#FFF",
  },

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
  gpsLostChip:  { position: "absolute", alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: "#E65100EE", zIndex: 30 },
  gpsLostText:  { color: "#FFF", fontSize: 11, fontFamily: "Inter_500Medium" },

  // ── Faster-route banner ───────────────────────────────────────────────────
  // Appears just below the nav instruction card when a periodic background
  // check finds a route ≥ 3 min faster than the current remaining ETA.
  fasterRouteBanner: {
    position: "absolute", left: 12, right: 12, zIndex: 19,
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#1B5E20EE",
    borderRadius: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22, shadowRadius: 8, elevation: 10,
  },
  fasterRouteTxt: {
    flex: 1, color: "#FFF", fontSize: 13, fontFamily: "Inter_600SemiBold",
    paddingVertical: 11,
  },
  fasterRouteSwitch: {
    backgroundColor: "#FFFFFF28",
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 10,
    marginRight: 2,
  },
  fasterRouteSwitchTxt: {
    color: "#FFF", fontSize: 13, fontFamily: "Inter_700Bold",
  },
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
});
