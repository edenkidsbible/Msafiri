import React, { useRef, useState, useMemo, useCallback, useEffect } from "react";
import { FLAT_LIST_PROPS, SCROLL_PROPS } from "@/lib/scrollProps";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import DriveAlertOverlay from "@/components/DriveAlertOverlay";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";
import SOSButton from "@/components/SOSButton";
import DriveMapView, { type DriveMapViewHandle } from "@/components/DriveMapView";
import ReportModal from "@/components/ReportModal";
import IncidentConfirmationPrompt from "@/components/IncidentConfirmationPrompt";
import { useIncidentConfirmationPrompt } from "@/hooks/useIncidentConfirmationPrompt";
import { nominatimSearch, GeoResult } from "@/utils/geocoding";
import { snapToRoad } from "@/utils/snapToRoad";
import { resolveIncidentType } from "@/constants/incidentTypes";
import { useRoundaboutExitCounter } from "@/hooks/useRoundaboutExitCounter";
import { speakRoundaboutExitCue, speakTakeThisExit } from "@/utils/sound";

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

function ZoneIcon({ type, size = 14, color }: { type: string; size?: number; color: string }) {
  const name: keyof typeof Ionicons.glyphMap =
    type === "camera"    ? "camera"      :
    type === "police"    ? "person"      :
    type === "accident"  ? "car-sport"   :
    type === "pothole"   ? "warning"     :
    type === "roadblock" ? "ban"         :
    type === "roadworks" ? "construct"   :
    type === "alcoblow"  ? "wine"        :
    type === "flooding"  ? "water"       :
    type === "traffic"   ? "car"         :
    type === "landslide" ? "earth"       :
                           "speedometer";
  return <Ionicons name={name} size={size} color={color} />;
}

function zoneColor(type: string) {
  return type === "camera" ? "#E53935" : type === "police" ? "#1565C0" : "#E65100";
}

/** Accent colour for any alert type — uses the canonical incidentTypes palette
 *  so the badge and emoji marker always match the map markers exactly. */
function alertColor(type: string): string {
  return resolveIncidentType(type).color;
}

/** Human-readable label for any alert type. */
function alertTypeName(type: string): string {
  const MAP: Record<string, string> = {
    camera: "Speed Camera", police: "Police Check", zone: "Speed Zone",
    accident: "Accident", roadblock: "Road Block", pothole: "Pothole",
    alcoblow: "Alcoblow", flooding: "Flooding", roadworks: "Road Works",
    traffic: "Traffic Jam", landslide: "Landslide",
  };
  return MAP[type] ?? (type.charAt(0).toUpperCase() + type.slice(1));
}

function incidentSummaryParts(incidents: { type: string; source: string }[]): { emoji: string; label: string }[] {
  const camCount = incidents.filter((i) => i.type === "camera").length;
  const policeCount = incidents.filter((i) => i.type === "police").length;
  const reportCount = incidents.filter((i) => i.source === "report").length;
  const parts: { emoji: string; label: string }[] = [];
  if (camCount > 0) parts.push({ emoji: "📷", label: `${camCount} camera${camCount === 1 ? "" : "s"}` });
  if (policeCount > 0) parts.push({ emoji: "👮", label: `${policeCount} police` });
  if (reportCount > 0) parts.push({ emoji: "📢", label: `${reportCount} report${reportCount === 1 ? "" : "s"}` });
  return parts;
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function DriveScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    locationGranted, requestLocationPermission,
    currentSpeed, currentSpeedLimit, activeAlert, dismissAlert, nearbyZones, communityReports,
    setThemeOverride,
    navDestination, setNavDestination,
    activeRoute, altRoutes, selectRoute, routeLoading,
    navigationActive, startNavigation, stopNavigation,
    currentStepIdx, distToNextM, distanceRemainingM, durationRemainingS, zonesOnRoute,
    routeIncidentsAhead, routeTrafficDelayS, setRouteIncidentsExpanded,
    showTraffic, setShowTraffic,
    addReport, currentLat, currentLng,
    arrivedInfo, clearArrival,
    pendingConfirmationReport, setPendingConfirmationReport,
    setPendingConfirmationSource,
    isSharingTrip, shareLink, startSharingTrip, stopSharingTrip,
    driverName,
  } = useApp();

  const { markDismissed } = useIncidentConfirmationPrompt();

  // Drive-page dark/light state mirrors the app-wide Appearance setting exactly
  // (Settings > Display > Appearance), so this FAB and that screen always agree.
  const isDark = c.isDark;

  const topInset    = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;
  const tabBarH     = Platform.OS === "web" ? 84 : 96;

  const [searchText, setSearchText] = useState("");
  const [geoResults, setGeoResults] = useState<GeoResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sharingLoading, setSharingLoading] = useState(false);
  const [speedStripHeight, setSpeedStripHeight] = useState(150);
  const driveMapRef = useRef<DriveMapViewHandle>(null);

  // ── Map drift (driver panned away from GPS position during navigation) ────
  const [mapDrifted, setMapDrifted] = useState(false);

  // ── Route overview mode ───────────────────────────────────────────────────
  const [overviewMode, setOverviewMode] = useState(false);
  const overviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Toast shown when overview auto-exits due to approaching turn
  const overviewToastOpacity = useRef(new Animated.Value(0)).current;
  const overviewToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showOverviewToast = useCallback(() => {
    if (overviewToastTimerRef.current) clearTimeout(overviewToastTimerRef.current);
    Animated.timing(overviewToastOpacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    overviewToastTimerRef.current = setTimeout(() => {
      Animated.timing(overviewToastOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start();
    }, 2200);
  }, [overviewToastOpacity]);

  // Auto-exit overview after 8 seconds so the driver doesn't have to tap again.
  // Also clears any drift state — entering overview is an implicit "I see the
  // map now" action, so the Recenter button doesn't need to stay visible.
  const enterOverview = useCallback(() => {
    if (overviewTimerRef.current) clearTimeout(overviewTimerRef.current);
    setOverviewMode(true);
    setMapDrifted(false);
    overviewTimerRef.current = setTimeout(() => {
      setOverviewMode(false);
    }, 8000);
  }, []);

  const exitOverview = useCallback(() => {
    if (overviewTimerRef.current) clearTimeout(overviewTimerRef.current);
    setOverviewMode(false);
  }, []);

  // Auto-exit overview when approaching the next turn (within 500 m)
  useEffect(() => {
    if (!overviewMode || distToNextM == null) return;
    if (distToNextM < 500) {
      exitOverview();
      showOverviewToast();
    }
  }, [overviewMode, distToNextM, exitOverview, showOverviewToast]);

  // Clear overview + drift when navigation ends (e.g. driver taps Stop)
  useEffect(() => {
    if (!navigationActive) {
      if (overviewTimerRef.current) clearTimeout(overviewTimerRef.current);
      if (overviewToastTimerRef.current) clearTimeout(overviewToastTimerRef.current);
      setOverviewMode(false);
      setMapDrifted(false);
    }
  }, [navigationActive]);

  const handleSharePress = useCallback(async () => {
    if (isSharingTrip) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await stopSharingTrip();
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSharingLoading(true);
    try {
      const link = await startSharingTrip();
      if (link) {
        const namePrefix = driverName.trim() ? `${driverName.trim()} is sharing their live location 📍` : "Follow my live trip 📍";
        await Share.share({
          message: `${namePrefix}\n${link}`,
          title: "Track my trip — Msafiri Kenya",
        });
      }
    } finally {
      setSharingLoading(false);
    }
  }, [isSharingTrip, startSharingTrip, stopSharingTrip, driverName]);

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

  // ── Roundabout voice cues ─────────────────────────────────────────────────
  // Track the previous exitsPassed so we only speak on genuine increments,
  // not on the reset back to 0 when the driver leaves the roundabout.
  const prevExitsPassedRef = useRef(0);
  useEffect(() => {
    const prev = prevExitsPassedRef.current;
    prevExitsPassedRef.current = exitsPassed;

    // Only fire when the count genuinely increased
    if (exitsPassed <= 0 || exitsPassed <= prev) return;

    // If targetExitIsNext is already true for this render, the "take this exit"
    // effect below will speak — skip the arm-count cue to avoid two overlapping clips.
    if (targetExitIsNext) return;

    void speakRoundaboutExitCue(exitsPassed);
  }, [exitsPassed]); // eslint-disable-line react-hooks/exhaustive-deps

  const prevTargetExitIsNextRef = useRef(false);
  useEffect(() => {
    const prev = prevTargetExitIsNextRef.current;
    prevTargetExitIsNextRef.current = targetExitIsNext;

    // Only fire on the transition false → true
    if (targetExitIsNext && !prev) {
      void speakTakeThisExit();
    }
  }, [targetExitIsNext]);

  // Nearest incident ahead — considers BOTH static speed zones AND community
  // reports so a just-reported broken-down vehicle beats a distant speed camera.
  const primaryAlert = useMemo(() => {
    // While navigating, routeIncidentsAhead already merges zones + reports on
    // the route and sorts by distance remaining — use it directly.
    if (navigationActive && routeIncidentsAhead.length > 0) {
      const inc = routeIncidentsAhead[0];
      return {
        type:       inc.type,
        typeName:   alertTypeName(inc.type),
        speedLimit: inc.speedLimit,
        distanceM:  inc.aheadDistanceM ?? 0,
        color:      alertColor(inc.type),
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
        type: z.type, typeName: alertTypeName(z.type),
        speedLimit: z.speedLimit, distanceM: z.distance, color: alertColor(z.type),
      });
    }

    // Community reports within 3 km that are < 2 h old
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
          type: nearestReport.type, typeName: alertTypeName(nearestReport.type),
          speedLimit: nearestReport.speedLimit ?? undefined,
          distanceM: nearestDist, color: alertColor(nearestReport.type),
        });
      }
    }

    if (candidates.length === 0) return null;
    // Pick the closest — a community report 200 m away wins over a camera 1 km away
    return candidates.sort((a, b) => a.distanceM - b.distanceM)[0];
  }, [navigationActive, routeIncidentsAhead, nearbyZones, communityReports, currentLat, currentLng]);

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
  };

  const clearDestination = () => {
    Keyboard.dismiss();
    stopNavigation();
    setNavDestination(null);
    setSearchText("");
    setGeoResults([]);
    setShowResults(false);
    setSearchError(false);
  };

  const bottomBase = bottomInset + tabBarH + 10;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={styles.screen}>

      {/* ── Base layer: full-screen map ── */}
      <View style={StyleSheet.absoluteFillObject}>
        <DriveMapView ref={driveMapRef} overviewMode={overviewMode} onDriftChange={setMapDrifted} />
      </View>

      {/* ── Drive alert overlay (bottom-anchored, slides up) ── */}
      {activeAlert && (
        <DriveAlertOverlay zone={activeAlert} onDismiss={dismissAlert} currentSpeed={currentSpeed} />
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TOP: Navigation instruction card (during active navigation)
      ══════════════════════════════════════════════════════════════════ */}
      {navigationActive && currentStep && (
        <View style={[styles.navCard, {
          top: topInset + 4,
          backgroundColor: isDark ? "#0F2040F5" : "#1565C0F5",
        }]}>
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
              autoCorrect={false}
              autoCapitalize="none"
            />

            {searchLoading && (
              <ActivityIndicator size="small" color={c.primary} style={{ marginRight: 14 }} />
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

          {/* Results dropdown */}
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

      {/* ══════════════════════════════════════════════════════════════════
          RECENTER button — appears on the left when the driver has panned
          away from their GPS position during navigation. Tapping snaps the
          map back to street-level tracking, just like Apple / Google Maps.
      ══════════════════════════════════════════════════════════════════ */}
      {!showResults && navigationActive && !overviewMode && mapDrifted && (
        <TouchableOpacity
          style={[styles.recenterBtn, { bottom: bottomBase + speedStripHeight + 80, left: 16 }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            driveMapRef.current?.recenter();
            setMapDrifted(false);
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="locate" size={17} color="#1565C0" />
          <Text style={styles.recenterBtnTxt}>Recenter</Text>
        </TouchableOpacity>
      )}

      {/* Navigation right-side FABs: overview toggle + report incident */}
      {!showResults && navigationActive && (
        <View style={[styles.navFabCol, { top: topInset + 118, right: 12 }]}>
          {/* Route overview toggle — zooms out to show the full route */}
          <TouchableOpacity
            style={[
              styles.overviewBtn,
              overviewMode && styles.overviewBtnActive,
              { backgroundColor: overviewMode ? "#1565C0" : fabBg },
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              overviewMode ? exitOverview() : enterOverview();
            }}
            activeOpacity={0.85}
          >
            <Ionicons
              name="map-outline"
              size={16}
              color={overviewMode ? "#FFF" : (isDark ? "#CCC" : "#555")}
            />
            <Text style={[styles.overviewBtnTxt, { color: overviewMode ? "#FFF" : (isDark ? "#CCC" : "#555") }]}>
              {overviewMode ? "Tracking" : "Overview"}
            </Text>
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
          style={[styles.speedStrip, { bottom: bottomBase + 8, backgroundColor: bg }]}
          onLayout={(e) => setSpeedStripHeight(e.nativeEvent.layout.height)}
        >

          {/* Left: large speed digit + optional LIMIT ring below it */}
          <View style={[styles.speedGroup, {
            backgroundColor: overLimit ? "#E5393510" : (isDark ? "#FFFFFF08" : "#00000005"),
            borderRadius: 16, paddingHorizontal: 10, paddingVertical: 8,
          }]}>
            <Text style={[styles.speedLabel, { color: overLimit ? "#E5393380" : fgMuted }]}>
              YOUR SPEED
            </Text>
            <Text style={[styles.speedNum, { color: speedClr }]}>
              {Math.round(currentSpeed)}
            </Text>
            <Text style={[styles.speedUnit, { color: overLimit ? "#E5393380" : fgMuted }]}>km/h</Text>
            {/* Limit ring — stacked below, same column as speed */}
            {currentSpeedLimit != null && (
              <View style={{ alignItems: "center", gap: 2, marginTop: 6 }}>
                <Text style={[styles.limitLabel, { color: fgMuted }]}>LIMIT</Text>
                <View style={[styles.limitRing, { borderColor: overLimit ? "#E53935" : (isDark ? "#555" : "#1A1A1A") }]}>
                  <Text style={[styles.limitNum, { color: overLimit ? "#E53935" : fgMain }]}>
                    {currentSpeedLimit}
                  </Text>
                </View>
              </View>
            )}
          </View>

          <View style={[styles.vdivider, { backgroundColor: divBg }]} />

          {/* Right: contextual alert info */}
          {!locationGranted ? (
            <TouchableOpacity
              style={[styles.gpsBtn, { backgroundColor: c.primary }]}
              onPress={requestLocationPermission}
            >
              <Ionicons name="location-outline" size={15} color="#FFF" />
              <Text style={styles.gpsBtnTxt}>Enable GPS</Text>
            </TouchableOpacity>
          ) : overLimit ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
              <Ionicons name="alert-circle" size={20} color="#E53935" />
              <Text style={{ color: "#E53935", fontSize: 16, fontFamily: "Inter_700Bold" }}>Slow down!</Text>
            </View>
          ) : routeLoading ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7, flex: 1 }}>
              <ActivityIndicator size="small" color={c.primary} />
              <Text style={[styles.clearTxt, { color: fgMuted }]}>Calculating route…</Text>
            </View>
          ) : primaryAlert ? (
            <View style={{ flex: 1, gap: 5 }}>
              {/* Colour-coded "NEARBY ALERT" badge */}
              <View style={[styles.nearbyAlertBadge, {
                backgroundColor: primaryAlert.color + "22",
                borderColor:     primaryAlert.color + "55",
              }]}>
                <Ionicons name="alert-circle" size={11} color={primaryAlert.color} />
                <Text style={[styles.nearbyAlertLabel, { color: primaryAlert.color }]}>
                  NEARBY ALERT
                </Text>
              </View>
              {/* Emoji marker (matches map) + type name + optional speed */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={[styles.alertMarker, { backgroundColor: primaryAlert.color }]}>
                  <Text style={styles.alertMarkerEmoji}>
                    {resolveIncidentType(primaryAlert.type).emoji}
                  </Text>
                </View>
                <View>
                  <Text style={[styles.zoneTypeName, { color: fgMain }]} numberOfLines={1}>
                    {primaryAlert.typeName}
                  </Text>
                  {primaryAlert.speedLimit ? (
                    <Text style={[styles.zoneSpeedLine, { color: fgMain }]}>
                      {primaryAlert.speedLimit} km/h
                    </Text>
                  ) : null}
                </View>
              </View>
              {/* Distance */}
              <Text style={[styles.zoneDistAhead, { color: fgMuted }]}>
                {distStr(primaryAlert.distanceM)} ahead
              </Text>
            </View>
          ) : (
            <Text style={[styles.clearTxt, { color: fgMuted, flex: 1 }]}>Clear ahead</Text>
          )}

          {/* SOS */}
          <SOSButton compact />
        </View>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          BOTTOM: Prominent Report button (below speed strip, above tab bar)
      ══════════════════════════════════════════════════════════════════ */}
      {!isMapMode && !showResults && (
        <TouchableOpacity
          style={[styles.reportBar, { bottom: bottomBase + 8 + speedStripHeight + 8, right: 16 }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowReport(true); }}
          activeOpacity={0.82}
        >
          <Ionicons name="camera" size={16} color="#FFF" />
          <Text style={styles.reportBarTxt}>Report Incident</Text>
        </TouchableOpacity>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          BOTTOM-LEFT: Share Trip button — visible whenever not navigating
          (mirrors the nav-bar share button for freeform "track me" sessions)
      ══════════════════════════════════════════════════════════════════ */}
      {!isMapMode && !showResults && (
        <TouchableOpacity
          style={[
            styles.idleShareBtn,
            {
              bottom: bottomBase + 8 + speedStripHeight + 8,
              left: 16,
              backgroundColor: isSharingTrip ? "#00C853" : fabBg,
            },
          ]}
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
              <Text style={[styles.idleShareBtnTxt, { color: isSharingTrip ? "#fff" : fgMuted }]}>
                {isSharingTrip ? "● Sharing" : "Share Location"}
              </Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          BOTTOM: Route preview sheet
      ══════════════════════════════════════════════════════════════════ */}
      {isMapMode && !navigationActive && activeRoute && (
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
                {durationStr(activeRoute.durationS + routeTrafficDelayS)}
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
                    Expect ~{Math.round(routeTrafficDelayS / 60)} min delay in traffic
                  </Text>
                  <Ionicons name="chevron-forward" size={10} color="#E65100" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Incidents ahead — dedicated full-width bar, not squeezed into the ETA row */}
          {routeIncidentsAhead.length > 0 && (
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
          )}

          {/* Alt routes */}
          {altRoutes.length > 0 && (
            <ScrollView {...SCROLL_PROPS} horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={[styles.altPill, { backgroundColor: c.primary }]}>
                  <Text style={[styles.altPillTxt, { color: "#FFF" }]}>
                    Fastest · {durationStr(activeRoute.durationS + routeTrafficDelayS)}
                  </Text>
                </View>
                {altRoutes.map((r, i) => (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.altPill, { backgroundColor: isDark ? "#222" : "#F2F2F2" }]}
                    onPress={() => { selectRoute(r); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  >
                    <Text style={[styles.altPillTxt, { color: fgMain }]}>
                      Alt {i + 1} · {durationStr(r.durationS)}
                    </Text>
                  </TouchableOpacity>
                ))}
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
            <SOSButton compact />
            <TouchableOpacity
              style={[styles.startBtn, { backgroundColor: c.primary }]}
              onPress={() => { startNavigation(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }}
            >
              <Ionicons name="navigate" size={17} color="#FFF" />
              <Text style={styles.startBtnTxt}>Start</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          BOTTOM: Navigation active bar
      ══════════════════════════════════════════════════════════════════ */}
      {navigationActive && (
        <View style={[styles.navBar, { backgroundColor: bg, paddingBottom: bottomBase }]}>

          <View style={styles.navBarTopRow}>
            {/* Speed block */}
            <View style={[styles.navSpeedBlock, {
              backgroundColor: overLimit ? "#E5393518" : (isDark ? "#00E67618" : "#E8F5E9"),
            }]}>
              <Text style={[styles.navSpeedLabel, { color: overLimit ? "#E5393380" : (isDark ? "#00E67680" : "#2E7D3280") }]}>
                YOUR SPEED
              </Text>
              <Text style={[styles.navSpeedNum, { color: overLimit ? "#E53935" : (isDark ? "#00E676" : "#2E7D32") }]}>
                {Math.round(currentSpeed)}
              </Text>
              <Text style={[styles.navSpeedUnit, { color: overLimit ? "#E5393380" : (isDark ? "#00E67680" : "#2E7D3280") }]}>
                km/h
              </Text>
              {currentSpeedLimit != null && (
                <View style={{ alignItems: "center", marginTop: 6, gap: 2 }}>
                  <Text style={[styles.navSpeedLabel, { color: fgMuted }]}>LIMIT</Text>
                  <View style={[styles.navLimitRing, {
                    borderColor: overLimit ? "#E53935" : (isDark ? "#555" : "#333"),
                  }]}>
                    <Text style={[styles.navLimitNum, { color: overLimit ? "#E53935" : fgMain }]}>
                      {currentSpeedLimit}
                    </Text>
                  </View>
                </View>
              )}
            </View>

            <View style={[styles.navDivider, { backgroundColor: divBg }]} />

            {/* Right column: ETA+SOS+Stop on top, Share button pinned to bottom */}
            <View style={{ flex: 1, justifyContent: "space-between" }}>

              {/* Top row */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.navEta, { color: fgMain }]}>
                    {durationStr(durationRemainingS ?? ((activeRoute?.durationS ?? 0) + routeTrafficDelayS))}
                  </Text>
                  <Text style={[styles.navDest, { color: fgMuted }]} numberOfLines={1}>
                    {distanceRemainingM != null ? `${distStr(distanceRemainingM)} · ` : ""}
                    {navDestination?.name.split(",")[0]}
                  </Text>
                </View>
                <SOSButton compact />
                <TouchableOpacity
                  style={styles.stopBtn}
                  onPress={() => { stopNavigation(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
                >
                  <Ionicons name="stop-circle" size={15} color="#FFF" />
                  <Text style={styles.stopBtnTxt}>Stop</Text>
                </TouchableOpacity>
              </View>

              {/* Share button — bottom aligns with speed gauge bottom */}
              <TouchableOpacity
                style={[styles.navShareBtn, {
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
                    <Text style={[styles.navShareBtnTxt, { color: isSharingTrip ? "#fff" : fgMuted }]}>
                      {isSharingTrip ? "● Sharing — tap to stop" : "Share Location"}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

            </View>
          </View>

          {/* ── Bottom action row: Report + Incidents Ahead ────────────── */}
          <View style={styles.navActionRow}>

            {/* Report Incident — always visible */}
            <TouchableOpacity
              style={[styles.navActionReport, { backgroundColor: "#E65100" }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowReport(true); }}
              activeOpacity={0.85}
            >
              <Ionicons name="camera" size={14} color="#FFF" />
              <Text style={styles.navActionReportTxt}>Report</Text>
            </TouchableOpacity>

            {/* Incidents Ahead — conditional; shows count + summary */}
            {routeIncidentsAhead.length > 0 ? (
              <TouchableOpacity
                style={[styles.navActionIncidents, {
                  backgroundColor: isDark ? "#00E67614" : "#E5393512",
                  borderColor: isDark ? "#00E67640" : "#E5393530",
                }]}
                onPress={() => { setRouteIncidentsExpanded(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                activeOpacity={0.8}
              >
                <Ionicons name="warning" size={14} color={isDark ? "#00E676" : "#E53935"} />
                <Text style={[styles.navActionIncidentsTxt, { color: isDark ? "#00E676" : "#E53935" }]} numberOfLines={1}>
                  {routeIncidentsAhead.length} Ahead
                </Text>
                <Ionicons name="chevron-up" size={14} color={isDark ? "#00E676" : "#E53935"} />
              </TouchableOpacity>
            ) : (
              <View style={[styles.navActionClear, { backgroundColor: isDark ? "#00E67614" : "#E8F5E9", borderColor: isDark ? "#00E67630" : "#A5D6A730" }]}>
                <Ionicons name="checkmark-circle-outline" size={14} color={isDark ? "#00E676" : "#2E7D32"} />
                <Text style={[styles.navActionClearTxt, { color: isDark ? "#00E676" : "#2E7D32" }]}>Clear Ahead</Text>
              </View>
            )}
          </View>

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
            const snapped = await snapToRoad(currentLat, currentLng);
            addReport(type, snapped.lat, snapped.lng, speedLimit);
          }
        }}
      />

      {/* ── Overview auto-exit toast ─────────────────────────────────────────── */}
      <Animated.View
        pointerEvents="none"
        style={[styles.overviewToast, { opacity: overviewToastOpacity }]}
      >
        <Ionicons name="navigate" size={14} color="#FFF" />
        <Text style={styles.overviewToastTxt}>Returning to tracking</Text>
      </Animated.View>

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
    </View>
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
    flexDirection: "row", alignItems: "center", gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: 8, borderWidth: 1,
  },
  nearbyAlertLabel: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.9 },
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
  navDest:      { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
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

  // ── Nav bar bottom action row: Report + Incidents Ahead ─────────────────
  navActionRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
  },
  navActionReport: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 11, borderRadius: 22,
    shadowColor: "#E65100", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 6, elevation: 6,
  },
  navActionReportTxt: { color: "#FFF", fontSize: 14, fontFamily: "Inter_700Bold" },
  navActionIncidents: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 7,
    paddingHorizontal: 14, paddingVertical: 11, borderRadius: 22, borderWidth: 1,
  },
  navActionIncidentsTxt: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  navActionClear: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
    paddingHorizontal: 14, paddingVertical: 11, borderRadius: 22, borderWidth: 1,
  },
  navActionClearTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  // ── Nav-mode right-side FAB column (overview only) ────────────────────
  navFabCol: {
    position: "absolute", zIndex: 14,
    alignItems: "flex-end", gap: 8,
  },
  overviewBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 13, paddingVertical: 9, borderRadius: 22,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18, shadowRadius: 6, elevation: 7,
  },
  overviewBtnActive: {
    shadowColor: "#1565C0", shadowOpacity: 0.45,
  },
  overviewBtnTxt: { fontSize: 13, fontFamily: "Inter_700Bold" },

  // ── Recenter button (left-side, appears when map drifts during nav) ────────
  recenterBtn: {
    position: "absolute", zIndex: 30,
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#FFFFFFEE",
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 22,
    borderWidth: 1.5, borderColor: "#1565C0",
    shadowColor: "#1565C0", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22, shadowRadius: 8, elevation: 8,
  },
  recenterBtnTxt: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#1565C0" },

  // ── Overview auto-exit toast ──────────────────────────────────────────────
  overviewToast: {
    position: "absolute", zIndex: 30,
    alignSelf: "center", top: "35%",
    flexDirection: "row", alignItems: "center", gap: 7,
    backgroundColor: "#1565C0EE",
    paddingHorizontal: 18, paddingVertical: 11, borderRadius: 24,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 10, elevation: 12,
  },
  overviewToastTxt: {
    color: "#FFF", fontSize: 14, fontFamily: "Inter_700Bold",
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
    width: "100%", paddingVertical: 16, borderRadius: 16, alignItems: "center",
  },
  arrivalDoneTxt: { fontSize: 16, fontFamily: "Inter_700Bold" },
});
