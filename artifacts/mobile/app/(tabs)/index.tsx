import React, { useEffect, useRef, useState } from "react";
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

function maneuverIcon(instruction: string): "arrow-forward-circle-outline" | "arrow-back-circle-outline" | "reload-outline" | "checkmark-circle-outline" | "navigate-outline" | "arrow-up-circle-outline" {
  const l = instruction.toLowerCase();
  if (l.includes("right")) return "arrow-forward-circle-outline";
  if (l.includes("left")) return "arrow-back-circle-outline";
  if (l.includes("roundabout")) return "reload-outline";
  if (l.includes("arrived") || l.includes("destination")) return "checkmark-circle-outline";
  if (l.includes("head") || l.includes("depart")) return "navigate-outline";
  return "arrow-up-circle-outline";
}

export default function DriveScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    locationGranted, requestLocationPermission,
    currentSpeed, currentSpeedLimit, activeAlert, dismissAlert, nearbyZones,
    hudMode, setHudMode, currentTrip,
    navDestination, setNavDestination,
    activeRoute, altRoutes, selectRoute, routeLoading,
    navigationActive, startNavigation, stopNavigation,
    currentStepIdx, distToNextM, zonesOnRoute,
  } = useApp();

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const [searchText, setSearchText] = useState("");
  const [geoResults, setGeoResults] = useState<GeoResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { if (!locationGranted) requestLocationPermission(); }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    let cleanup: (() => void) | undefined;
    (async () => {
      if (hudMode) {
        const KA = await import("expo-keep-awake");
        await KA.activateKeepAwakeAsync();
        cleanup = () => KA.deactivateKeepAwake();
      }
    })();
    return () => cleanup?.();
  }, [hudMode]);

  const overLimit = currentSpeedLimit != null && currentSpeed > currentSpeedLimit;

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

  const currentStep = activeRoute?.steps?.[currentStepIdx] ?? null;
  const isSearchMode = showResults || (searchLoading && searchText.length > 1);

  return (
    <View style={[styles.screen, { backgroundColor: hudMode ? "#000" : c.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topInset + 6 }]}>
        <View>
          <Text style={[styles.appTitle, { color: hudMode ? "#FFF" : c.foreground }]}>SafeDrive Kenya</Text>
          {currentTrip && !navDestination && (
            <View style={styles.tripPill}>
              <View style={[styles.tripDot, { backgroundColor: c.speedSafe }]} />
              <Text style={[styles.tripText, { color: c.speedSafe }]}>Trip active</Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setHudMode(!hudMode); }}
          style={[styles.iconBtn, { backgroundColor: hudMode ? "#FFF2" : c.muted }]}
        >
          <Ionicons name={hudMode ? "sunny" : "moon-outline"} size={20} color={hudMode ? "#FFF" : c.foreground} />
        </TouchableOpacity>
      </View>

      {/* Destination search bar */}
      <View style={[styles.searchBarWrap, { marginHorizontal: 14, marginBottom: 4 }]}>
        <View style={[
          styles.searchBar,
          { backgroundColor: c.card, borderColor: navDestination && !isSearchMode ? c.primary : c.border },
        ]}>
          <Ionicons
            name={navDestination && !isSearchMode ? "navigate" : "search-outline"}
            size={18}
            color={navDestination && !isSearchMode ? c.primary : c.mutedForeground}
          />
          <TextInput
            style={[styles.searchInput, { color: c.foreground }]}
            placeholder="Where to?"
            placeholderTextColor={c.mutedForeground}
            value={searchText}
            onChangeText={handleSearchChange}
            returnKeyType="search"
            onSubmitEditing={() => searchText.length > 1 && runSearch(searchText)}
            autoCorrect={false}
          />
          {searchLoading && isSearchMode && (
            <ActivityIndicator size="small" color={c.primary} />
          )}
          {(searchText.length > 0 || navDestination) && (
            <TouchableOpacity onPress={clearDestination} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close-circle" size={18} color={c.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── SEARCH MODE: inline results list ── */}
      {isSearchMode ? (
        <View style={[styles.searchResultsPanel, { backgroundColor: c.background }]}>
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
      ) : (
        <>
          {/* Route loading indicator */}
          {routeLoading && (
            <View style={[styles.routeLoadRow, { backgroundColor: c.card, borderColor: c.border, marginHorizontal: 14, marginBottom: 6 }]}>
              <ActivityIndicator size="small" color={c.primary} />
              <Text style={[styles.routeLoadText, { color: c.mutedForeground }]}>Calculating route…</Text>
            </View>
          )}

          {/* Route preview */}
          {activeRoute && !navigationActive && (
            <View style={[styles.routePreview, { backgroundColor: c.card, borderColor: c.border, marginHorizontal: 14, marginBottom: 6 }]}>
              <View style={styles.routeTopRow}>
                <View style={styles.routeETA}>
                  <Text style={[styles.routeTime, { color: c.foreground }]}>{durationStr(activeRoute.durationS)}</Text>
                  <Text style={[styles.routeDist, { color: c.mutedForeground }]}>· {distStr(activeRoute.distanceM)}</Text>
                </View>
                {zonesOnRoute.length > 0 && (
                  <View style={[styles.zonesChip, { backgroundColor: "#E5393522" }]}>
                    <Text style={{ fontSize: 12 }}>⚠️</Text>
                    <Text style={[styles.zonesChipText, { color: "#E53935" }]}>
                      {zonesOnRoute.filter(z => z.type === "camera").length}📷 · {zonesOnRoute.filter(z => z.type === "police").length}🚔
                    </Text>
                  </View>
                )}
              </View>

              {altRoutes.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
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
                <Text style={[styles.firstStep, { color: c.mutedForeground }]} numberOfLines={1}>
                  ➤ {activeRoute.steps[0].instruction}
                </Text>
              )}

              <TouchableOpacity
                style={[styles.startBtn, { backgroundColor: c.primary }]}
                onPress={() => { startNavigation(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }}
                activeOpacity={0.85}
              >
                <Ionicons name="navigate" size={18} color={c.primaryForeground} />
                <Text style={[styles.startBtnText, { color: c.primaryForeground }]}>Start Navigation</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Navigation active — instruction banner */}
          {navigationActive && currentStep && (
            <View style={[styles.navBanner, { backgroundColor: "#1565C0", marginHorizontal: 14, marginBottom: 6 }]}>
              <View style={styles.navLeft}>
                <Ionicons name={maneuverIcon(currentStep.instruction)} size={26} color="#FFF" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.navInstruction} numberOfLines={2}>{currentStep.instruction}</Text>
                  {distToNextM != null && <Text style={styles.navDist}>{distStr(distToNextM)}</Text>}
                </View>
              </View>
              <View style={styles.navRight}>
                <Text style={styles.navETA}>{durationStr(activeRoute?.durationS ?? 0)}</Text>
                <TouchableOpacity
                  style={styles.stopBtn}
                  onPress={() => { stopNavigation(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
                >
                  <Text style={styles.stopBtnText}>■ Stop</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Speed zone alert */}
          {activeAlert && <AlertBanner zone={activeAlert} onDismiss={dismissAlert} />}

          {/* Speedometer */}
          <View style={[styles.dialWrap, navigationActive && { flex: 0.6, minHeight: 180 }]}>
            <SpeedometerDial speed={currentSpeed} speedLimit={currentSpeedLimit} hudMode={hudMode} />
            {overLimit && (
              <View style={[styles.overLimitBanner, { backgroundColor: c.speedDanger }]}>
                <Ionicons name="alert-circle" size={16} color="#FFF" />
                <Text style={styles.overLimitText}>Slow down!</Text>
              </View>
            )}
          </View>

          {/* Location prompt */}
          {!locationGranted && (
            <TouchableOpacity
              style={[styles.permBtn, { backgroundColor: c.primary }]}
              onPress={requestLocationPermission}
              activeOpacity={0.85}
            >
              <Ionicons name="location-outline" size={18} color={c.primaryForeground} />
              <Text style={[styles.permText, { color: c.primaryForeground }]}>Enable Location</Text>
            </TouchableOpacity>
          )}

          {/* Nearby zones strip */}
          {!hudMode && !navigationActive && nearbyZones.length > 0 && (
            <View style={styles.nearbySection}>
              <Text style={[styles.nearbyTitle, { color: c.mutedForeground }]}>UPCOMING ZONES</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.nearbyScroll}>
                {nearbyZones.slice(0, 5).map((z) => (
                  <View key={z.id} style={[styles.zoneChip, { backgroundColor: c.card, borderColor: c.border }]}>
                    <Text style={{ fontSize: 13 }}>
                      {z.type === "camera" ? "📷" : z.type === "police" ? "🚔" : "🚦"}
                    </Text>
                    <Text style={[styles.zoneLimit, { color: c.foreground }]}>{z.speedLimit}</Text>
                    <Text style={[styles.zoneKmh, { color: c.mutedForeground }]}>km/h</Text>
                    <Text style={[styles.zoneDist, { color: c.mutedForeground }]}>{distStr(z.distance)}</Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
        </>
      )}

      {/* SOS — always visible */}
      {!isSearchMode && (
        <View style={[styles.sosWrap, { bottom: bottomInset + (Platform.OS === "web" ? 90 : 96) }]}>
          <SOSButton />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  appTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  tripPill: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  tripDot: { width: 6, height: 6, borderRadius: 3 },
  tripText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  iconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  searchBarWrap: {},
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  searchResultsPanel: { flex: 1 },
  searchHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  searchHintText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  resultShort: { fontSize: 14, fontFamily: "Inter_500Medium" },
  resultDetail: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  routeLoadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  routeLoadText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  routePreview: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 10 },
  routeTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  routeETA: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  routeTime: { fontSize: 22, fontFamily: "Inter_700Bold" },
  routeDist: { fontSize: 14, fontFamily: "Inter_400Regular" },
  zonesChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  zonesChipText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  altRow: { flexDirection: "row", gap: 8, paddingVertical: 2 },
  altChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  altChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  firstStep: { fontSize: 12, fontFamily: "Inter_400Regular" },
  startBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 14,
  },
  startBtnText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  navBanner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    padding: 14,
    gap: 12,
    justifyContent: "space-between",
  },
  navLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  navInstruction: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFF", lineHeight: 20 },
  navDist: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFF", marginTop: 2 },
  navRight: { alignItems: "flex-end", gap: 4 },
  navETA: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#FFFFFFAA" },
  stopBtn: { backgroundColor: "#FFFFFF22", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  stopBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#FFF" },
  dialWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 12, minHeight: 220 },
  overLimitBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 24,
    marginTop: 14,
  },
  overLimitText: { color: "#FFF", fontSize: 14, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  permBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 28,
    marginBottom: 16,
  },
  permText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  nearbySection: { paddingBottom: 8 },
  nearbyTitle: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 1.5, marginLeft: 20, marginBottom: 6 },
  nearbyScroll: { paddingLeft: 16 },
  zoneChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 8,
  },
  zoneLimit: { fontSize: 14, fontFamily: "Inter_700Bold" },
  zoneKmh: { fontSize: 10, fontFamily: "Inter_400Regular" },
  zoneDist: { fontSize: 11, fontFamily: "Inter_400Regular" },
  sosWrap: { position: "absolute", right: 20 },
});
