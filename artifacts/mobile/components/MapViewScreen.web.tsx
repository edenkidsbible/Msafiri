import React, { useState } from "react";
import { FlatList, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { SPEED_ZONES } from "@/data/speedZones";
import ReportModal from "@/components/ReportModal";

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180;
  const f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distStr(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

type ZoneFilter = "all" | "camera" | "police" | "zone";

const TYPE_COLOR: Record<string, string> = { camera: "#E53935", police: "#1565C0", zone: "#F57C00" };
const TYPE_ICON: Record<string, string> = { camera: "camera", police: "shield", zone: "warning" };

function durationStr(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}min` : `${m} min`;
}

export default function MapViewScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    currentLat, currentLng, communityReports, addReport,
    activeRoute, altRoutes, selectRoute, navigationActive,
    navDestination, showTraffic, setShowTraffic,
    currentStepIdx, distToNextM,
    startNavigation, stopNavigation,
  } = useApp();
  const [filter, setFilter] = useState<ZoneFilter>("all");
  const [showReport, setShowReport] = useState(false);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const zones = SPEED_ZONES.filter((z) => filter === "all" || z.type === filter)
    .map((z) => ({ ...z, distance: currentLat && currentLng ? haversine(currentLat, currentLng, z.lat, z.lng) : null }))
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

  const handleReport = (type: "camera" | "police" | "accident" | "pothole" | "roadblock" | "clear") => {
    if (currentLat && currentLng) addReport(type, currentLat, currentLng);
    setShowReport(false);
  };

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 8 }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: c.foreground }]}>
            {navDestination ? "Navigation" : "Speed Zones"}
          </Text>
          <View style={styles.headerBtns}>
            <TouchableOpacity
              style={[styles.trafficToggle, { backgroundColor: showTraffic ? c.primary : c.muted }]}
              onPress={() => setShowTraffic(!showTraffic)}
            >
              <Ionicons name="car-outline" size={15} color={showTraffic ? c.primaryForeground : c.foreground} />
              <Text style={[styles.trafficToggleText, { color: showTraffic ? c.primaryForeground : c.foreground }]}>
                Traffic
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.reportBtn, { backgroundColor: c.primary }]} onPress={() => setShowReport(true)}>
              <Ionicons name="add" size={18} color={c.primaryForeground} />
              <Text style={[styles.reportBtnText, { color: c.primaryForeground }]}>Report</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Active route panel */}
        {activeRoute && navDestination && (
          <View style={[styles.routePanel, { backgroundColor: navigationActive ? "#1565C0" : c.card, borderColor: c.border }]}>
            <View style={styles.routePanelTop}>
              <View>
                <Text style={[styles.routeDestName, { color: navigationActive ? "#FFF" : c.foreground }]} numberOfLines={1}>
                  {navDestination.name.split(",")[0]}
                </Text>
                <Text style={[styles.routeMeta, { color: navigationActive ? "#FFFFFFBB" : c.mutedForeground }]}>
                  {durationStr(activeRoute.durationS)} · {distStr(activeRoute.distanceM)}
                </Text>
              </View>
              {navigationActive ? (
                <TouchableOpacity style={styles.stopBtn} onPress={stopNavigation}>
                  <Text style={styles.stopBtnText}>■ Stop</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[styles.startBtn, { backgroundColor: c.primary }]} onPress={startNavigation}>
                  <Ionicons name="navigate" size={14} color={c.primaryForeground} />
                  <Text style={[styles.startBtnText, { color: c.primaryForeground }]}>Start</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Current instruction (nav active) */}
            {navigationActive && activeRoute.steps[currentStepIdx] && (
              <View style={styles.instructionRow}>
                <Ionicons name="arrow-forward-circle-outline" size={18} color="#FFF" />
                <Text style={styles.instructionText} numberOfLines={2}>
                  {distToNextM != null ? `In ${distToNextM}m — ` : ""}{activeRoute.steps[currentStepIdx].instruction}
                </Text>
              </View>
            )}

            {/* Alternative routes */}
            {altRoutes.length > 0 && !navigationActive && (
              <View style={styles.altRow}>
                {altRoutes.map((r, i) => (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.altChip, { backgroundColor: c.muted, borderColor: c.border }]}
                    onPress={() => selectRoute(r)}
                  >
                    <Text style={[styles.altChipText, { color: c.foreground }]}>
                      Alt {i + 1} · {durationStr(r.durationS)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Turn-by-turn steps list */}
            {!navigationActive && activeRoute.steps.slice(0, 5).map((step, i) => (
              <View key={i} style={[styles.stepRow, i > 0 && { borderTopColor: c.border, borderTopWidth: 1 }]}>
                <View style={[styles.stepNum, { backgroundColor: c.muted }]}>
                  <Text style={[styles.stepNumText, { color: c.foreground }]}>{i + 1}</Text>
                </View>
                <Text style={[styles.stepText, { color: c.foreground }]} numberOfLines={1}>
                  {step.instruction}
                </Text>
                <Text style={[styles.stepDist, { color: c.mutedForeground }]}>
                  {distStr(step.distanceM)}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Text style={[styles.sub, { color: c.mutedForeground }]}>
          {navDestination ? "Set destination on Drive tab" : currentLat ? "Sorted by distance from your location" : `${zones.length} zones on Kenya roads`}
        </Text>
        <View style={styles.filters}>
          {(["all", "camera", "police", "zone"] as ZoneFilter[]).map((f) => (
            <TouchableOpacity key={f} style={[styles.filterChip, { backgroundColor: filter === f ? c.primary : c.muted, borderColor: filter === f ? c.primary : c.border }]} onPress={() => setFilter(f)}>
              <Text style={[styles.filterLabel, { color: filter === f ? c.primaryForeground : c.foreground }]}>
                {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <FlatList
        data={zones}
        keyExtractor={(z) => z.id}
        contentContainerStyle={{ paddingBottom: bottomInset + 100, paddingTop: 4 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <View style={[styles.zoneRow, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={[styles.zoneIconBox, { backgroundColor: TYPE_COLOR[item.type] + "22" }]}>
              <Ionicons name={TYPE_ICON[item.type] as "camera"} size={20} color={TYPE_COLOR[item.type]} />
            </View>
            <View style={styles.zoneInfo}>
              <Text style={[styles.zoneName, { color: c.foreground }]} numberOfLines={1}>{item.name}</Text>
              <Text style={[styles.zoneRoad, { color: c.mutedForeground }]} numberOfLines={1}>{item.road}</Text>
            </View>
            <View style={styles.zoneRight}>
              <View style={[styles.limitBadge, { backgroundColor: c.muted }]}>
                <Text style={[styles.limitNum, { color: c.foreground }]}>{item.speedLimit}</Text>
                <Text style={[styles.limitUnit, { color: c.mutedForeground }]}>km/h</Text>
              </View>
              {item.distance != null && <Text style={[styles.zoneDist, { color: c.mutedForeground }]}>{distStr(item.distance)}</Text>}
            </View>
          </View>
        )}
      />

      {communityReports.length > 0 && (
        <View style={[styles.reportsBadge, { backgroundColor: c.primary, bottom: bottomInset + 110 }]}>
          <Ionicons name="people" size={14} color={c.primaryForeground} />
          <Text style={[styles.reportsBadgeText, { color: c.primaryForeground }]}>{communityReports.length} community report{communityReports.length !== 1 ? "s" : ""}</Text>
        </View>
      )}

      <ReportModal visible={showReport} onClose={() => setShowReport(false)} onSubmit={handleReport} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 10 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  headerBtns: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 12 },
  trafficToggle: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  trafficToggleText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  reportBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  reportBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  routePanel: { borderRadius: 14, borderWidth: 1, marginBottom: 12, overflow: "hidden" },
  routePanelTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12 },
  routeDestName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  routeMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  stopBtn: { backgroundColor: "#FFFFFF22", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  stopBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#FFF" },
  startBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  startBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  instructionRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  instructionText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#FFF", lineHeight: 18 },
  altRow: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingBottom: 10, flexWrap: "wrap" },
  altChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, borderWidth: 1 },
  altChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  stepNum: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  stepNumText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  stepText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },
  stepDist: { fontSize: 11, fontFamily: "Inter_400Regular" },
  filters: { flexDirection: "row", gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  filterLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  zoneRow: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 14, borderWidth: 1, gap: 12 },
  zoneIconBox: { width: 42, height: 42, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  zoneInfo: { flex: 1 },
  zoneName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  zoneRoad: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  zoneRight: { alignItems: "flex-end", gap: 3 },
  limitBadge: { flexDirection: "row", alignItems: "baseline", gap: 2, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  limitNum: { fontSize: 16, fontFamily: "Inter_700Bold" },
  limitUnit: { fontSize: 10, fontFamily: "Inter_400Regular" },
  zoneDist: { fontSize: 11, fontFamily: "Inter_400Regular" },
  reportsBadge: { position: "absolute", alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  reportsBadgeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
