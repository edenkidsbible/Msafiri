import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
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
import SpeedometerDial from "@/components/SpeedometerDial";
import AlertBanner from "@/components/AlertBanner";
import SOSButton from "@/components/SOSButton";
import DriveMapView from "@/components/DriveMapView";
import ReportModal from "@/components/ReportModal";
import { fetchWithTimeout } from "@/utils/fetchTimeout";

function distStr(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
function durationStr(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}min` : `${m} min`;
}

interface GeoResult { display: string; short: string; lat: number; lng: number }

async function nominatimSearch(q: string): Promise<GeoResult[]> {
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&limit=7&countrycodes=ke` +
    `&q=${encodeURIComponent(q)}`;
  const res = await fetchWithTimeout(
    url,
    { headers: { "User-Agent": "SafeDriveKenya/1.0", "Accept-Language": "en" } },
    9000
  );
  const data = await res.json();
  return (data as any[]).map((r) => {
    const parts = (r.display_name as string).split(",");
    const short = parts.slice(0, 2).join(",").trim();
    return { display: r.display_name as string, short, lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
  });
}

function maneuverIcon(instruction: string): keyof typeof Ionicons.glyphMap {
  const l = instruction.toLowerCase();
  if (l.includes("right")) return "arrow-forward-circle";
  if (l.includes("left")) return "arrow-back-circle";
  if (l.includes("roundabout")) return "reload-circle";
  if (l.includes("arrived") || l.includes("destination")) return "checkmark-circle";
  if (l.includes("head") || l.includes("depart")) return "navigate";
  if (l.includes("merge")) return "git-merge-outline";
  return "arrow-up-circle";
}

// Zone type icon — Ionicons only, works on all Android versions
function ZoneIcon({ type, size = 14, color }: { type: string; size?: number; color: string }) {
  const name: keyof typeof Ionicons.glyphMap =
    type === "camera" ? "camera" : type === "police" ? "shield-checkmark" : "speedometer";
  return <Ionicons name={name} size={size} color={color} />;
}

export default function DriveScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    locationGranted, requestLocationPermission,
    currentSpeed, currentSpeedLimit, activeAlert, dismissAlert, nearbyZones,
    hudMode, setHudMode,
    navDestination, setNavDestination,
    activeRoute, altRoutes, selectRoute, routeLoading,
    navigationActive, startNavigation, stopNavigation,
    currentStepIdx, distToNextM, zonesOnRoute,
    showTraffic, setShowTraffic,
    addReport, currentLat, currentLng,
  } = useApp();

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;
  const tabBarHeight = Platform.OS === "web" ? 84 : 96;

  const [searchText, setSearchText] = useState("");
  const [geoResults, setGeoResults] = useState<GeoResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const overLimit = currentSpeedLimit != null && currentSpeed > currentSpeedLimit;
  const hasRoute = !!activeRoute;
  const isMapMode = (hasRoute || navigationActive) && !showResults;
  const currentStep = activeRoute?.steps?.[currentStepIdx] ?? null;

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
    setNavDestination({ name: r.display, lat: r.lat, lng: r.lng });
    setSearchText(r.short);
    setGeoResults([]);
    setShowResults(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const clearDestination = () => {
    stopNavigation();
    setNavDestination(null);
    setSearchText("");
    setGeoResults([]);
    setShowResults(false);
    setSearchError(false);
  };

  // ─── Layout ─────────────────────────────────────────────────────────────────
  // Approximate top section height (status bar + header + search bar) for search results offset
  const searchResultsTop = topInset + 110;

  return (
    <View style={styles.screen}>

      {/* ════════ Map always fills the entire screen ════════ */}
      <View style={StyleSheet.absoluteFillObject}>
        <DriveMapView />
      </View>

      {/* ════════ Top overlay: header / search bar / nav instructions ════════ */}
      <View style={[styles.topOverlay, { paddingTop: topInset + 6 }]} pointerEvents="box-none">

        {/* ── Normal mode header (title + HUD toggle) — hidden once route is set ── */}
        {!isMapMode && (
          <View style={[styles.header, { marginBottom: 6 }]}>
            <Text style={[styles.appTitle, { color: hudMode ? "#FFF" : "#FFF" }]}>SafeDrive Kenya</Text>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setHudMode(!hudMode); }}
              style={[styles.iconBtn, { backgroundColor: "#0006" }]}
            >
              <Ionicons name={hudMode ? "sunny" : "moon-outline"} size={20} color="#FFF" />
            </TouchableOpacity>
          </View>
        )}

        {/* Search bar — always visible */}
        <View style={styles.searchBarWrap}>
          <View style={[styles.searchBar, {
            backgroundColor: c.card + "F4",
            borderColor: isMapMode ? c.primary : c.border,
          }]}>
            <Ionicons
              name={isMapMode ? "navigate" : "search-outline"}
              size={17}
              color={isMapMode ? c.primary : c.mutedForeground}
            />
            <TextInput
              style={[styles.searchInput, { color: c.foreground }]}
              placeholder={isMapMode ? "Change destination…" : "Where to?"}
              placeholderTextColor={c.mutedForeground}
              value={searchText}
              onChangeText={handleSearchChange}
              returnKeyType="search"
              onSubmitEditing={() => searchText.length > 1 && runSearch(searchText)}
              autoCorrect={false}
            />
            {searchLoading && <ActivityIndicator size="small" color={c.primary} />}
            {isMapMode && (
              <TouchableOpacity
                onPress={clearDestination}
                style={styles.clearBtn}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close-circle" size={20} color={c.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Alert banner */}
        {activeAlert && <AlertBanner zone={activeAlert} onDismiss={dismissAlert} />}

        {/* Navigation instruction card */}
        {navigationActive && currentStep && (
          <View style={[styles.navInstructionCard, { backgroundColor: "#1565C0" }]}>
            <Ionicons name={maneuverIcon(currentStep.instruction)} size={34} color="#FFF" />
            <View style={{ flex: 1 }}>
              <Text style={styles.navStepText} numberOfLines={2}>{currentStep.instruction}</Text>
              {distToNextM != null && (
                <Text style={styles.navStepDist}>{distStr(distToNextM)}</Text>
              )}
            </View>
          </View>
        )}
      </View>

      {/* Traffic toggle — top right floating button */}
      <TouchableOpacity
        style={[styles.trafficBtn, {
          backgroundColor: showTraffic ? c.primary : c.card + "EE",
          top: topInset + 14,
        }]}
        onPress={() => setShowTraffic(!showTraffic)}
      >
        <Ionicons name="car" size={20} color={showTraffic ? "#FFF" : c.primary} />
      </TouchableOpacity>

      {/* ════════ Search results panel (floating) ════════ */}
      {showResults && (
        <View style={[styles.searchResultsPanel, { backgroundColor: c.card + "F8", top: searchResultsTop }]}>
          {searchError && (
            <View style={styles.searchHint}>
              <Ionicons name="cloud-offline-outline" size={16} color={c.mutedForeground} />
              <Text style={[styles.searchHintText, { color: c.mutedForeground }]}>
                No connection — check internet and try again
              </Text>
            </View>
          )}
          {!searchError && geoResults.length === 0 && !searchLoading && searchText.length > 1 && (
            <View style={styles.searchHint}>
              <Ionicons name="location-outline" size={16} color={c.mutedForeground} />
              <Text style={[styles.searchHintText, { color: c.mutedForeground }]}>
                No places found in Kenya for "{searchText}"
              </Text>
            </View>
          )}
          {!searchError && searchText.length < 2 && (
            <View style={styles.searchHint}>
              <Ionicons name="search-outline" size={16} color={c.mutedForeground} />
              <Text style={[styles.searchHintText, { color: c.mutedForeground }]}>
                Type at least 2 characters to search
              </Text>
            </View>
          )}
          <FlatList
            data={geoResults}
            keyExtractor={(_, i) => String(i)}
            keyboardShouldPersistTaps="always"
            renderItem={({ item, index }) => (
              <TouchableOpacity
                style={[
                  styles.resultRow,
                  { borderBottomColor: c.border },
                  index === 0 && { borderTopColor: c.border, borderTopWidth: StyleSheet.hairlineWidth },
                ]}
                onPress={() => pickDestination(item)}
                activeOpacity={0.7}
              >
                <View style={[styles.resultIcon, { backgroundColor: c.muted }]}>
                  <Ionicons name="location-outline" size={16} color={c.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.resultShort, { color: c.foreground }]} numberOfLines={1}>
                    {item.short}
                  </Text>
                  <Text style={[styles.resultDetail, { color: c.mutedForeground }]} numberOfLines={1}>
                    {item.display.split(",").slice(2).join(",").trim()}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={c.mutedForeground} />
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* ════════ Normal mode bottom panel (speedometer + quick actions) ════════ */}
      {!isMapMode && !showResults && (
        <View
          style={[
            styles.normalBottomPanel,
            {
              backgroundColor: hudMode ? "#000D" : c.card + "F0",
              paddingBottom: bottomInset + tabBarHeight + 10,
            },
          ]}
          pointerEvents="box-none"
        >
          {/* Route calculating indicator */}
          {routeLoading && (
            <View style={[styles.routeLoadRow, { backgroundColor: c.muted, borderColor: c.border }]}>
              <ActivityIndicator size="small" color={c.primary} />
              <Text style={[styles.routeLoadText, { color: c.mutedForeground }]}>Calculating route…</Text>
            </View>
          )}

          {/* Speedometer */}
          <View style={styles.dialWrap}>
            <SpeedometerDial speed={currentSpeed} speedLimit={currentSpeedLimit} hudMode={hudMode} />
            {overLimit && (
              <View style={[styles.overLimitBanner, { backgroundColor: "#E53935" }]}>
                <Ionicons name="alert-circle" size={16} color="#FFF" />
                <Text style={styles.overLimitText}>Slow down!</Text>
              </View>
            )}
          </View>

          {!locationGranted && (
            <TouchableOpacity
              style={[styles.permBtn, { backgroundColor: c.primary }]}
              onPress={requestLocationPermission}
            >
              <Ionicons name="location-outline" size={18} color={c.primaryForeground} />
              <Text style={[styles.permText, { color: c.primaryForeground }]}>Enable Location</Text>
            </TouchableOpacity>
          )}

          {/* Quick actions: Report / Traffic / Night Mode */}
          {!hudMode && (
            <View style={[styles.quickRow, { paddingHorizontal: 16 }]}>
              <TouchableOpacity
                style={[styles.quickBtn, { backgroundColor: c.card, borderColor: c.border }]}
                onPress={() => setShowReport(true)}
                activeOpacity={0.8}
              >
                <View style={[styles.quickBtnIcon, { backgroundColor: "#E6510018" }]}>
                  <Ionicons name="warning-outline" size={22} color="#E65100" />
                </View>
                <Text style={[styles.quickBtnLabel, { color: c.foreground }]}>Report{"\n"}Incident</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.quickBtn, {
                  backgroundColor: showTraffic ? c.primary + "14" : c.card,
                  borderColor: showTraffic ? c.primary : c.border,
                }]}
                onPress={() => setShowTraffic(!showTraffic)}
                activeOpacity={0.8}
              >
                <View style={[styles.quickBtnIcon, { backgroundColor: showTraffic ? c.primary + "22" : c.muted }]}>
                  <Ionicons name="car-outline" size={22} color={showTraffic ? c.primary : c.mutedForeground} />
                </View>
                <Text style={[styles.quickBtnLabel, { color: showTraffic ? c.primary : c.foreground }]}>
                  Traffic{"\n"}<Text style={{ fontSize: 10 }}>{showTraffic ? "On" : "Off"}</Text>
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.quickBtn, { backgroundColor: c.card, borderColor: c.border }]}
                onPress={() => setHudMode(!hudMode)}
                activeOpacity={0.8}
              >
                <View style={[styles.quickBtnIcon, { backgroundColor: c.muted }]}>
                  <Ionicons name="moon-outline" size={22} color={c.mutedForeground} />
                </View>
                <Text style={[styles.quickBtnLabel, { color: c.foreground }]}>Night{"\n"}Mode</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Upcoming zones strip */}
          {!hudMode && nearbyZones.length > 0 && (
            <View style={styles.nearbySection}>
              <Text style={[styles.nearbyTitle, { color: c.mutedForeground }]}>UPCOMING ZONES</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.nearbyScroll}>
                {nearbyZones.slice(0, 5).map((z) => (
                  <View key={z.id} style={[styles.zoneChip, { backgroundColor: c.card, borderColor: c.border }]}>
                    <ZoneIcon type={z.type} size={13} color={
                      z.type === "camera" ? "#E53935" : z.type === "police" ? "#1565C0" : "#E65100"
                    } />
                    <Text style={[styles.zoneLimit, { color: c.foreground }]}>{z.speedLimit}</Text>
                    <Text style={[styles.zoneKmh, { color: c.mutedForeground }]}>km/h</Text>
                    <Text style={[styles.zoneDist, { color: c.mutedForeground }]}>{distStr(z.distance)}</Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      )}

      {/* SOS — floating, always visible in normal mode */}
      {!isMapMode && !showResults && (
        <View style={[styles.sosWrap, { bottom: bottomInset + tabBarHeight + 8 }]}>
          <SOSButton />
        </View>
      )}

      {/* ════════ Route preview bottom sheet (has route, not yet navigating) ════════ */}
      {isMapMode && !navigationActive && activeRoute && (
        <View style={[
          styles.bottomSheet,
          { backgroundColor: c.card + "F5", paddingBottom: bottomInset + tabBarHeight + 10 },
        ]}>
          <View style={styles.etaRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.etaTime, { color: c.foreground }]}>{durationStr(activeRoute.durationS)}</Text>
              <Text style={[styles.etaDist, { color: c.mutedForeground }]} numberOfLines={1}>
                {distStr(activeRoute.distanceM)} · {navDestination?.name.split(",")[0]}
              </Text>
            </View>
            {zonesOnRoute.length > 0 && (
              <View style={[styles.zonesChip, { backgroundColor: "#E5393518" }]}>
                <Ionicons name="warning" size={12} color="#E53935" />
                <Text style={[styles.zonesChipText, { color: "#E53935" }]}>
                  {zonesOnRoute.filter((z) => z.type === "camera").length} cam
                  {" · "}
                  {zonesOnRoute.filter((z) => z.type === "police").length} police
                </Text>
              </View>
            )}
          </View>

          {altRoutes.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
              <View style={styles.altRow}>
                <View style={[styles.altChip, { backgroundColor: c.primary }]}>
                  <Text style={[styles.altChipText, { color: c.primaryForeground }]}>
                    Fastest · {durationStr(activeRoute.durationS)}
                  </Text>
                </View>
                {altRoutes.map((r, i) => (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.altChip, { backgroundColor: c.muted, borderColor: c.border, borderWidth: 1 }]}
                    onPress={() => { selectRoute(r); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  >
                    <Text style={[styles.altChipText, { color: c.foreground }]}>
                      Alt {i + 1} · {durationStr(r.durationS)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          )}

          {activeRoute.steps[0] && (
            <View style={styles.firstStepRow}>
              <Ionicons name="arrow-forward-circle-outline" size={14} color={c.mutedForeground} />
              <Text style={[styles.firstStep, { color: c.mutedForeground }]} numberOfLines={1}>
                {activeRoute.steps[0].instruction}
              </Text>
            </View>
          )}

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.cancelRouteBtn, { backgroundColor: c.muted, borderColor: c.border }]}
              onPress={() => { clearDestination(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={16} color={c.foreground} />
              <Text style={[styles.cancelRouteTxt, { color: c.foreground }]}>Cancel</Text>
            </TouchableOpacity>
            <SOSButton compact />
            <TouchableOpacity
              style={[styles.startBtn, { backgroundColor: c.primary }]}
              onPress={() => { startNavigation(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }}
              activeOpacity={0.87}
            >
              <Ionicons name="navigate" size={16} color={c.primaryForeground} />
              <Text style={[styles.startBtnText, { color: c.primaryForeground }]}>Start</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Speed bubble — bottom left during active navigation */}
      {navigationActive && (
        <View style={[
          styles.speedBubble,
          {
            backgroundColor: overLimit ? "#E53935" : "#1B5E20",
            bottom: bottomInset + tabBarHeight + 14,
          },
        ]}>
          <Text style={styles.speedBubbleNumber}>{Math.round(currentSpeed)}</Text>
          <Text style={styles.speedBubbleUnit}>km/h</Text>
          {currentSpeedLimit != null && (
            <View style={[styles.speedLimitInBubble, { backgroundColor: "#FFF2" }]}>
              <Text style={styles.speedLimitInBubbleText}>{currentSpeedLimit}</Text>
            </View>
          )}
        </View>
      )}

      {/* Navigation active bottom bar */}
      {navigationActive && (
        <View style={[
          styles.navBottomBar,
          { backgroundColor: c.card + "F5", paddingBottom: bottomInset + tabBarHeight + 10 },
        ]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.navBarEta, { color: c.foreground }]}>
              {durationStr(activeRoute?.durationS ?? 0)}
            </Text>
            <Text style={[styles.navBarDest, { color: c.mutedForeground }]} numberOfLines={1}>
              {navDestination?.name.split(",")[0]}
            </Text>
          </View>
          <SOSButton compact />
          <TouchableOpacity
            style={[styles.stopBtn, { backgroundColor: "#E53935" }]}
            onPress={() => { stopNavigation(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
          >
            <Ionicons name="stop" size={15} color="#FFF" />
            <Text style={styles.stopBtnText}>Stop</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Report incident modal */}
      <ReportModal
        visible={showReport}
        onClose={() => setShowReport(false)}
        onSubmit={(type) => {
          if (currentLat !== null && currentLng !== null) {
            addReport(type, currentLat, currentLng);
          }
          setShowReport(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },

  /* Map mode */
  mapContainer: { flex: 1 },
  topOverlay: {
    position: "absolute", top: 0, left: 0, right: 0,
    paddingHorizontal: 12, gap: 8, paddingBottom: 8,
  },
  trafficBtn: {
    position: "absolute", right: 12,
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18, shadowRadius: 5, elevation: 5,
  },
  navInstructionCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 18, padding: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 10, elevation: 8,
  },
  navStepText: { color: "#FFF", fontSize: 16, fontFamily: "Inter_700Bold", lineHeight: 22 },
  navStepDist: { color: "#FFFFFFCC", fontSize: 22, fontFamily: "Inter_700Bold", marginTop: 4 },
  speedBubble: {
    position: "absolute", left: 14,
    width: 76, height: 76, borderRadius: 38,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
  },
  speedBubbleNumber: { color: "#FFF", fontSize: 26, fontFamily: "Inter_700Bold", lineHeight: 28 },
  speedBubbleUnit: { color: "#FFFFFFAA", fontSize: 11, fontFamily: "Inter_500Medium" },
  speedLimitInBubble: {
    position: "absolute", top: -4, right: -4,
    width: 26, height: 26, borderRadius: 13,
    alignItems: "center", justifyContent: "center",
  },
  speedLimitInBubbleText: { color: "#FFF", fontSize: 10, fontFamily: "Inter_700Bold" },

  /* Route preview bottom sheet */
  bottomSheet: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingTop: 18, paddingHorizontal: 16, gap: 10,
    shadowColor: "#000", shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.14, shadowRadius: 12, elevation: 12,
  },
  etaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  etaTime: { fontSize: 24, fontFamily: "Inter_700Bold" },
  etaDist: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  zonesChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
  },
  zonesChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  altRow: { flexDirection: "row", gap: 8 },
  altChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  altChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  firstStepRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  firstStep: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },

  /* Action row (cancel + SOS + start) */
  actionRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  cancelRouteBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderWidth: 1,
  },
  cancelRouteTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  startBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 16,
  },
  startBtnText: { fontSize: 15, fontFamily: "Inter_700Bold" },

  /* Nav bottom bar */
  navBottomBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingTop: 14, paddingHorizontal: 16,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    shadowColor: "#000", shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.14, shadowRadius: 12, elevation: 12,
  },
  navBarEta: { fontSize: 18, fontFamily: "Inter_700Bold" },
  navBarDest: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  stopBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14,
  },
  stopBtnText: { color: "#FFF", fontSize: 14, fontFamily: "Inter_700Bold" },

  /* Normal mode */
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 6,
  },
  appTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  iconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  searchBarPadded: { paddingHorizontal: 16, paddingBottom: 8 },
  searchBarWrap: { paddingHorizontal: 12 },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 14, borderWidth: 1.5,
    paddingHorizontal: 12, paddingVertical: 10,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 6, elevation: 4,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  clearBtn: { padding: 2 },

  /* Normal-mode bottom panel (floats above tab bar, below map) */
  normalBottomPanel: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18, shadowRadius: 12, elevation: 16,
  },

  /* Search results (floating, below search bar) */
  searchResultsPanel: {
    position: "absolute", left: 0, right: 0,
    maxHeight: 360,
    borderRadius: 16,
    marginHorizontal: 12,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 10, elevation: 12,
    overflow: "hidden",
  },
  searchHint: { flexDirection: "row", alignItems: "center", gap: 8, padding: 16 },
  searchHintText: { fontSize: 14, fontFamily: "Inter_400Regular", flex: 1 },
  resultRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  resultShort: { fontSize: 15, fontFamily: "Inter_500Medium" },
  resultDetail: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  /* Route loading */
  routeLoadRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginHorizontal: 16, marginBottom: 8, padding: 12,
    borderRadius: 12, borderWidth: 1,
  },
  routeLoadText: { fontSize: 14, fontFamily: "Inter_500Medium" },

  /* Speedometer section */
  dialWrap: { alignItems: "center", paddingVertical: 8 },
  overLimitBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginTop: 12, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20,
  },
  overLimitText: { color: "#FFF", fontSize: 15, fontFamily: "Inter_700Bold" },
  permBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    alignSelf: "center", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 16,
    marginTop: 8,
  },
  permText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  /* Nearby zones strip */
  nearbySection: { paddingHorizontal: 16, marginTop: 8 },
  nearbyTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1, marginBottom: 8 },
  nearbyScroll: {},
  zoneChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12,
    borderWidth: 1, marginRight: 8,
  },
  zoneLimit: { fontSize: 15, fontFamily: "Inter_700Bold" },
  zoneKmh: { fontSize: 10, fontFamily: "Inter_400Regular" },
  zoneDist: { fontSize: 11, fontFamily: "Inter_500Medium" },

  /* Quick actions row (Report / Traffic / Night) */
  quickRow: {
    flexDirection: "row", gap: 10, marginTop: 12, marginBottom: 4,
  },
  quickBtn: {
    flex: 1, alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 12, borderRadius: 16, borderWidth: 1,
  },
  quickBtnIcon: {
    width: 42, height: 42, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  quickBtnLabel: {
    fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center", lineHeight: 16,
  },

  /* SOS (normal mode only — floating) */
  sosWrap: { position: "absolute", right: 16 },
});
