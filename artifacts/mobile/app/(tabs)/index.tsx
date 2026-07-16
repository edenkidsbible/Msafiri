import React, { useRef, useState } from "react";
import { FLAT_LIST_PROPS, SCROLL_PROPS } from "@/lib/scrollProps";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  ScrollView,
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
import AlertBanner from "@/components/AlertBanner";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";
import SOSButton from "@/components/SOSButton";
import DriveMapView from "@/components/DriveMapView";
import ReportModal from "@/components/ReportModal";
import IncidentConfirmationPrompt from "@/components/IncidentConfirmationPrompt";
import { useIncidentConfirmationPrompt } from "@/hooks/useIncidentConfirmationPrompt";
import { nominatimSearch, GeoResult } from "@/utils/geocoding";
import { snapToRoad } from "@/utils/snapToRoad";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function distStr(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
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
    type === "camera" ? "camera" : type === "police" ? "person" : "speedometer";
  return <Ionicons name={name} size={size} color={color} />;
}

function zoneColor(type: string) {
  return type === "camera" ? "#E53935" : type === "police" ? "#1565C0" : "#E65100";
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
    currentSpeed, currentSpeedLimit, activeAlert, dismissAlert, nearbyZones,
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

  const overLimit  = currentSpeedLimit != null && currentSpeed > currentSpeedLimit;
  const hasRoute   = !!activeRoute;
  const isMapMode  = (hasRoute || navigationActive) && !showResults;
  const currentStep = activeRoute?.steps?.[currentStepIdx] ?? null;

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
        <DriveMapView />
      </View>

      {/* ── Speed/alert warning strip (over map, highest z, under header) ── */}
      {activeAlert && (
        <View style={[styles.alertLayer, { top: topInset + 4 }]} pointerEvents="box-none">
          <AlertBanner zone={activeAlert} onDismiss={dismissAlert} />
        </View>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TOP: Navigation instruction card (during active navigation)
      ══════════════════════════════════════════════════════════════════ */}
      {navigationActive && currentStep && (
        <View style={[styles.navCard, {
          top: topInset + (activeAlert ? 70 : 4),
          backgroundColor: isDark ? "#0F2040F5" : "#1565C0F5",
        }]}>
          <View style={styles.navCardIcon}>
            <Ionicons name={maneuverIcon(currentStep.instruction)} size={30} color="#FFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.navInstruction} numberOfLines={2}>
              {currentStep.instruction}
            </Text>
            {distToNextM != null && (
              <Text style={styles.navDist}>{distStr(distToNextM)}</Text>
            )}
          </View>
        </View>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TOP: Search bar + results (when not navigating)
      ══════════════════════════════════════════════════════════════════ */}
      {!navigationActive && (
        <View
          style={[styles.searchArea, { top: topInset + (activeAlert ? 70 : 4) }]}
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

      {/* Clear "Report Incident" button during navigation — replaces old triangle FAB */}
      {!showResults && navigationActive && (
        <TouchableOpacity
          style={[styles.navReportBtn, { top: topInset + 118, right: 12 }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowReport(true); }}
          activeOpacity={0.85}
        >
          <Ionicons name="camera" size={14} color="#FFF" />
          <Text style={styles.navReportTxt}>Report Incident</Text>
        </TouchableOpacity>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          BOTTOM: Normal-mode speed card.
          Left block: speed + LIMIT stacked (like the nav bar).
          Right panel: NEARBY ALERT badge + type + "X km ahead".
      ══════════════════════════════════════════════════════════════════ */}
      {!isMapMode && !showResults && (
        <View style={[styles.speedStrip, { bottom: bottomBase + 68, backgroundColor: bg }]}>

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
          ) : nearbyZones.length > 0 ? (
            <View style={{ flex: 1, gap: 5 }}>
              {/* Colour-coded "NEARBY ALERT" badge — immediately tells the driver
                  something is coming up without needing to read the details first */}
              <View style={[styles.nearbyAlertBadge, {
                backgroundColor: zoneColor(nearbyZones[0].type) + "22",
                borderColor:     zoneColor(nearbyZones[0].type) + "55",
              }]}>
                <Ionicons name="alert-circle" size={11} color={zoneColor(nearbyZones[0].type)} />
                <Text style={[styles.nearbyAlertLabel, { color: zoneColor(nearbyZones[0].type) }]}>
                  NEARBY ALERT
                </Text>
              </View>
              {/* Alert type */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <ZoneIcon type={nearbyZones[0].type} size={14} color={zoneColor(nearbyZones[0].type)} />
                <Text style={[styles.zoneTypeName, { color: fgMain }]}>
                  {nearbyZones[0].type === "camera" ? "Speed Camera"
                    : nearbyZones[0].type === "police" ? "Police Check"
                    : "Speed Zone"}
                  {nearbyZones[0].speedLimit ? `  ·  ${nearbyZones[0].speedLimit} km/h` : ""}
                </Text>
              </View>
              {/* "X km ahead" — "ahead" makes the spatial context explicit for drivers */}
              <Text style={[styles.zoneDistAhead, { color: fgMuted }]}>
                {distStr(nearbyZones[0].distance)} ahead
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
          style={[styles.reportBar, { bottom: bottomBase }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowReport(true); }}
          activeOpacity={0.85}
        >
          <Ionicons name="camera" size={20} color="#FFF" />
          <Text style={styles.reportBarTxt}>Report Camera/Incident</Text>
          <View style={styles.reportBarBadge}>
            <Ionicons name="add" size={16} color="#E65100" />
          </View>
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

            {/* ETA + destination — recomputed live from the current GPS fix */}
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

  alertLayer: { position: "absolute", left: 12, right: 12, zIndex: 30 },

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
  },
  navInstruction: {
    fontSize: 17, fontFamily: "Inter_700Bold", color: "#FFF", lineHeight: 24,
  },
  navDist: {
    fontSize: 24, fontFamily: "Inter_700Bold", color: "#90CAF9", marginTop: 4,
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
    position: "absolute", left: 16, right: 16, zIndex: 11,
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#E65100",
    borderRadius: 20, paddingHorizontal: 20, paddingVertical: 15,
    gap: 10,
    shadowColor: "#E65100", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 10, elevation: 10,
  },
  reportBarTxt: {
    flex: 1, color: "#FFF", fontSize: 16, fontFamily: "Inter_700Bold",
  },
  reportBarBadge: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "#FFF",
    alignItems: "center", justifyContent: "center",
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
  speedGroup: { alignItems: "center", minWidth: 88, flexShrink: 0 },
  speedLabel: { fontSize: 9, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, marginBottom: 2 },
  // 72 px at Inter_700Bold: three digits ("120") measure ~108 px, safely inside
  // the 130 px minWidth container. Large enough to read with one glance.
  speedNum:   { fontSize: 72, fontFamily: "Inter_700Bold", lineHeight: 76 },
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
  zoneTypeName:     { fontSize: 13, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  zoneDistAhead:    { fontSize: 11, fontFamily: "Inter_400Regular" },

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
    flexDirection: "row", alignItems: "center", gap: 10,
  },
  navSpeedBlock: {
    alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18,
  },
  navSpeedLabel: { fontSize: 8, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8 },
  navSpeedNum:  { fontSize: 70, fontFamily: "Inter_700Bold", lineHeight: 72 },
  navSpeedUnit: { fontSize: 9, fontFamily: "Inter_400Regular", marginTop: -2 },
  navLimitRing: {
    width: 38, height: 38, borderRadius: 19, borderWidth: 2.5,
    alignItems: "center", justifyContent: "center",
  },
  navLimitNum:  { fontSize: 14, fontFamily: "Inter_700Bold" },
  navDivider:   { width: 1, height: 52, borderRadius: 1, marginHorizontal: 2, opacity: 0.5 },
  navEta:       { fontSize: 19, fontFamily: "Inter_700Bold" },
  navDest:      { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  stopBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#E53935",
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14,
  },
  stopBtnTxt: { color: "#FFF", fontSize: 14, fontFamily: "Inter_700Bold" },

  navReportBtn: {
    position: "absolute",
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#E65100",
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 22,
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25, shadowRadius: 6, elevation: 8,
  },
  navReportTxt: { color: "#FFF", fontSize: 13, fontFamily: "Inter_700Bold" },

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
