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

function distStr(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function durationStr(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m} min`;
}

interface GeoResult { name: string; lat: number; lng: number }

async function nominatimSearch(q: string): Promise<GeoResult[]> {
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=ke` +
    `&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "SafeDriveKenya/1.0", "Accept-Language": "en" },
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json();
  return (data as any[]).map((r) => ({
    name: r.display_name as string,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  }));
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
  const [inputFocused, setInputFocused] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { if (!locationGranted) requestLocationPermission(); }, []);

  // keep-awake in HUD
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

  // Destination search with debounce
  const handleSearchChange = (text: string) => {
    setSearchText(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.length < 3) { setGeoResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const results = await nominatimSearch(text);
        setGeoResults(results);
      } catch { setGeoResults([]); }
      setSearchLoading(false);
    }, 600);
  };

  const pickDestination = (r: GeoResult) => {
    setNavDestination({ name: r.name, lat: r.lat, lng: r.lng });
    setSearchText(r.name.split(",")[0]); // short name
    setGeoResults([]);
    setInputFocused(false);
  };

  const clearDestination = () => {
    stopNavigation();
    setNavDestination(null);
    setSearchText("");
    setGeoResults([]);
    setInputFocused(false);
  };

  const currentStep = activeRoute?.steps?.[currentStepIdx] ?? null;
  const navETA = activeRoute ? durationStr(activeRoute.durationS) : "";

  const MANEUVER_ICON: Record<string, string> = {
    "turn right": "arrow-forward",
    "turn left": "arrow-back",
    roundabout: "reload",
    arrive: "checkmark-circle",
    depart: "navigate",
    continue: "arrow-up",
    merge: "git-merge",
    fork: "git-branch",
  };

  function maneuverIcon(instruction: string): string {
    const lower = instruction.toLowerCase();
    if (lower.includes("right")) return "arrow-forward-circle-outline";
    if (lower.includes("left")) return "arrow-back-circle-outline";
    if (lower.includes("roundabout")) return "reload-outline";
    if (lower.includes("arrived") || lower.includes("destination")) return "checkmark-circle-outline";
    if (lower.includes("head") || lower.includes("depart")) return "navigate-outline";
    return "arrow-up-circle-outline";
  }

  return (
    <View style={[styles.screen, { backgroundColor: hudMode ? "#000" : c.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topInset + 6 }]}>
        <View style={styles.headerLeft}>
          <Text style={[styles.appTitle, { color: hudMode ? "#FFF" : c.foreground }]}>
            SafeDrive Kenya
          </Text>
          {currentTrip && !navDestination && (
            <View style={styles.tripPill}>
              <View style={[styles.tripDot, { backgroundColor: c.speedSafe }]} />
              <Text style={[styles.tripText, { color: c.speedSafe }]}>Trip active</Text>
            </View>
          )}
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setHudMode(!hudMode); }}
            style={[styles.iconBtn, { backgroundColor: hudMode ? "#FFF2" : c.muted }]}
          >
            <Ionicons name={hudMode ? "sunny" : "moon-outline"} size={20} color={hudMode ? "#FFF" : c.foreground} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Destination search bar */}
      <View style={[styles.searchWrap, { marginHorizontal: 16, marginBottom: 6 }]}>
        <View style={[styles.searchBar, { backgroundColor: c.card, borderColor: navDestination ? c.primary : c.border }]}>
          <Ionicons
            name={navDestination ? "navigate" : "search-outline"}
            size={18}
            color={navDestination ? c.primary : c.mutedForeground}
          />
          <TextInput
            style={[styles.searchInput, { color: c.foreground }]}
            placeholder="Where to?"
            placeholderTextColor={c.mutedForeground}
            value={searchText}
            onChangeText={handleSearchChange}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setTimeout(() => setInputFocused(false), 200)}
            returnKeyType="search"
          />
          {searchLoading && <ActivityIndicator size="small" color={c.primary} />}
          {(searchText.length > 0 || navDestination) && (
            <TouchableOpacity onPress={clearDestination}>
              <Ionicons name="close-circle" size={18} color={c.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        {/* Nominatim results dropdown */}
        {inputFocused && geoResults.length > 0 && (
          <View style={[styles.dropdown, { backgroundColor: c.card, borderColor: c.border }]}>
            {geoResults.map((r, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.dropdownItem, i < geoResults.length - 1 && { borderBottomColor: c.border, borderBottomWidth: 1 }]}
                onPress={() => pickDestination(r)}
              >
                <Ionicons name="location-outline" size={16} color={c.mutedForeground} />
                <Text style={[styles.dropdownText, { color: c.foreground }]} numberOfLines={2}>
                  {r.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Route loading */}
      {routeLoading && (
        <View style={[styles.routeCard, { backgroundColor: c.card, borderColor: c.border, marginHorizontal: 16, marginBottom: 6 }]}>
          <ActivityIndicator size="small" color={c.primary} />
          <Text style={[styles.routeLoadText, { color: c.mutedForeground }]}>Calculating route…</Text>
        </View>
      )}

      {/* Route preview (destination set, not navigating) */}
      {activeRoute && !navigationActive && (
        <View style={[styles.routePreview, { backgroundColor: c.card, borderColor: c.border, marginHorizontal: 16, marginBottom: 6 }]}>
          {/* Primary info */}
          <View style={styles.routeTopRow}>
            <View style={styles.routeETA}>
              <Text style={[styles.routeTime, { color: c.foreground }]}>{durationStr(activeRoute.durationS)}</Text>
              <Text style={[styles.routeDist, { color: c.mutedForeground }]}>{distStr(activeRoute.distanceM)}</Text>
            </View>
            {zonesOnRoute.length > 0 && (
              <View style={[styles.zonesAhead, { backgroundColor: "#E5393522" }]}>
                <Ionicons name="warning-outline" size={13} color="#E53935" />
                <Text style={[styles.zonesAheadText, { color: "#E53935" }]}>
                  {zonesOnRoute.filter(z => z.type === "camera").length} cameras · {zonesOnRoute.filter(z => z.type === "police").length} checkpoints
                </Text>
              </View>
            )}
          </View>

          {/* Alternative routes */}
          {altRoutes.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
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

          {/* First instruction preview */}
          {activeRoute.steps[0] && (
            <Text style={[styles.firstStep, { color: c.mutedForeground }]} numberOfLines={1}>
              {activeRoute.steps[0].instruction}
            </Text>
          )}

          {/* Start button */}
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

      {/* Navigation active — next instruction banner */}
      {navigationActive && currentStep && (
        <View style={[styles.navBanner, { backgroundColor: "#1565C0", marginHorizontal: 16, marginBottom: 6 }]}>
          <View style={styles.navBannerLeft}>
            <Ionicons name={maneuverIcon(currentStep.instruction) as "navigate"} size={28} color="#FFF" />
            <View style={{ flex: 1 }}>
              <Text style={styles.navInstruction} numberOfLines={2}>{currentStep.instruction}</Text>
              {distToNextM != null && (
                <Text style={styles.navDist}>{distStr(distToNextM)}</Text>
              )}
            </View>
          </View>
          <View style={styles.navBannerRight}>
            <Text style={styles.navETA}>{navETA}</Text>
            <TouchableOpacity
              style={styles.stopNavBtn}
              onPress={() => { stopNavigation(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
            >
              <Text style={styles.stopNavText}>■ Stop</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Speed zone alert banner */}
      {activeAlert && <AlertBanner zone={activeAlert} onDismiss={dismissAlert} />}

      {/* Speedometer */}
      <View style={[styles.dialWrap, { flex: navigationActive ? 0.7 : 1 }]}>
        <SpeedometerDial speed={currentSpeed} speedLimit={currentSpeedLimit} hudMode={hudMode} />
        {overLimit && (
          <View style={[styles.overLimitBanner, { backgroundColor: c.speedDanger }]}>
            <Ionicons name="alert-circle" size={16} color="#FFF" />
            <Text style={styles.overLimitText}>Slow down!</Text>
          </View>
        )}
      </View>

      {/* Location permission prompt */}
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
                <Ionicons
                  name={z.type === "camera" ? "camera" : z.type === "police" ? "shield" : "warning"}
                  size={13}
                  color={z.distance < 1000 ? c.speedCaution : c.mutedForeground}
                />
                <Text style={[styles.zoneLimit, { color: c.foreground }]}>{z.speedLimit}</Text>
                <Text style={[styles.zoneKmh, { color: c.mutedForeground }]}>km/h</Text>
                <Text style={[styles.zoneDist, { color: c.mutedForeground }]}>{distStr(z.distance)}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* SOS */}
      <View style={[styles.sosWrap, { bottom: bottomInset + (Platform.OS === "web" ? 90 : 96) }]}>
        <SOSButton />
      </View>
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
  headerLeft: {},
  appTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  tripPill: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  tripDot: { width: 6, height: 6, borderRadius: 3 },
  tripText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  headerRight: { flexDirection: "row", gap: 8 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  searchWrap: { position: "relative", zIndex: 100 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  dropdown: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
    overflow: "hidden",
    zIndex: 200,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 8,
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dropdownText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  routeCard: {
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
  routeETA: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  routeTime: { fontSize: 22, fontFamily: "Inter_700Bold" },
  routeDist: { fontSize: 14, fontFamily: "Inter_400Regular" },
  zonesAhead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  zonesAheadText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  altRow: { flexDirection: "row", gap: 8 },
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
  navBannerLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  navInstruction: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFF", lineHeight: 20 },
  navDist: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFF", marginTop: 2 },
  navBannerRight: { alignItems: "flex-end", gap: 4 },
  navETA: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#FFFFFFAA" },
  stopNavBtn: { backgroundColor: "#FFFFFF22", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  stopNavText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#FFF" },
  dialWrap: { alignItems: "center", justifyContent: "center", paddingVertical: 16, minHeight: 200 },
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
