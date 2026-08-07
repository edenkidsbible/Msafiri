import React, { useEffect, useRef, useState } from "react";
import { Animated, FlatList, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import type { CommunityReport } from "@/context/AppContext";
import { getVehicleTypeDef, capSpeedLimit } from "@/data/vehicleTypes";
import ReportModal from "@/components/ReportModal";
import ReportUndoToast, { UndoableReport } from "@/components/ReportUndoToast";
import { snapToRoad } from "@/utils/snapToRoad";
import { useWeather, weatherIcon } from "@/hooks/useWeather";

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
const TYPE_ICON: Record<string, string> = { camera: "camera", police: "person", zone: "warning" };

function durationStr(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}min` : `${m} min`;
}

function arrivalTimeStr(durationS: number): string {
  const d = new Date(Date.now() + durationS * 1000);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  return `Arrive ${h}:${m}`;
}

export default function MapViewScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    currentLat, currentLng, communityReports, addReport, deleteReport,
    activeRoute, altRoutes, selectRoute,
    navDestination, setNavDestination, showTraffic, setShowTraffic,
    vehicleType, routeTrafficDelayS, allZones,
  } = useApp();
  const vehicle = getVehicleTypeDef(vehicleType);
  const [filter, setFilter] = useState<ZoneFilter>("all");
  const [showReport, setShowReport] = useState(false);
  const [undoReport, setUndoReport] = useState<UndoableReport | null>(null);

  // ── Alert focus (deep-link from the home screen's Nearby Alerts cards) ─────
  const { focusId, focusLat, focusLng, focusTs } = useLocalSearchParams<{
    focusId?: string; focusLat?: string; focusLng?: string; focusTs?: string;
  }>();
  const [focusedAlert, setFocusedAlert] = useState<{ id: string; lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!focusId || !focusLat || !focusLng) return;
    const lat = parseFloat(focusLat);
    const lng = parseFloat(focusLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setFocusedAlert({ id: focusId, lat, lng });
  }, [focusId, focusLat, focusLng, focusTs]);
  const focusedZoneId = focusedAlert?.id.startsWith("z-") ? focusedAlert.id.slice(2) : null;
  const focusedReport = focusedAlert?.id.startsWith("r-")
    ? communityReports.find((r) => r.id === focusedAlert.id.slice(2)) ?? null
    : null;

  const weather = useWeather(currentLat, currentLng);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const zones = allZones.filter((z) => filter === "all" || z.type === filter)
    .map((z) => ({ ...z, speedLimit: capSpeedLimit(z.speedLimit, vehicle), distance: currentLat && currentLng ? haversine(currentLat, currentLng, z.lat, z.lng) : null }))
    .sort((a, b) => {
      if (focusedZoneId) {
        if (a.id === focusedZoneId) return -1;
        if (b.id === focusedZoneId) return 1;
      }
      return (a.distance ?? Infinity) - (b.distance ?? Infinity);
    });

  const handleReport = async (type: CommunityReport["type"], speedLimit?: number, location?: { lat: number; lng: number }) => {
    setShowReport(false);
    let id: string | undefined;
    if (location) {
      id = addReport(type, location.lat, location.lng, speedLimit);
    } else if (currentLat && currentLng) {
      const snapped = await snapToRoad(currentLat, currentLng);
      id = addReport(type, snapped.lat, snapped.lng, speedLimit);
    }
    if (id) setUndoReport({ id, type });
  };

  const undoLastReport = () => {
    if (undoReport) deleteReport(undoReport.id);
    setUndoReport(null);
  };

  /** Clear the active route preview and destination. */
  const dismissRoute = () => setNavDestination(null);

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 8 }]}>
        <View style={styles.headerRow}>
          <View style={styles.titleGroup}>
            <Text style={[styles.title, { color: c.foreground }]}>
              {navDestination ? "Route Preview" : "Speed Zones"}
            </Text>
            {weather?.tempC != null && (
              <View style={[styles.weatherChip, { backgroundColor: c.card, borderColor: c.border }]}>
                <Ionicons name={weatherIcon(weather.weatherCode) as any} size={14} color="#FFB300" />
                <Text style={[styles.weatherTemp, { color: c.foreground }]}>{weather.tempC}°</Text>
                <Text style={[styles.weatherLocality, { color: c.mutedForeground }]} numberOfLines={1}>
                  {weather.locality ?? weather.description ?? ""}
                </Text>
              </View>
            )}
          </View>
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

        {/* Route preview panel — shown whenever a destination is set */}
        {activeRoute && navDestination && (
          <View style={[styles.routePanel, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.routePanelTop}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.routeDestName, { color: c.foreground }]} numberOfLines={1}>
                  {navDestination.name.split(",")[0]}
                </Text>
                <Text style={[styles.routeMeta, { color: c.mutedForeground }]}>
                  {durationStr(activeRoute.durationS)} · {distStr(activeRoute.distanceM)}
                </Text>
                <Text style={[styles.routeMeta, { color: c.mutedForeground, marginTop: 1 }]}>
                  {arrivalTimeStr(activeRoute.durationS)}
                </Text>
                {routeTrafficDelayS > 0 && (
                  <Text style={[styles.routeMeta, { color: "#E65100", marginTop: 1 }]}>
                    Community reports: +{Math.round(routeTrafficDelayS / 60)} min
                  </Text>
                )}
              </View>
              {/* Dismiss button — always visible while preview is active */}
              <TouchableOpacity
                style={[styles.dismissBtn, { backgroundColor: c.muted }]}
                onPress={dismissRoute}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={16} color={c.foreground} />
              </TouchableOpacity>
            </View>

            {/* Alternative routes */}
            {altRoutes.length > 0 && (
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

            {/* First 5 steps — route overview only, not turn-by-turn instructions */}
            {activeRoute.steps.slice(0, 5).map((step, i) => (
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
          {navDestination ? "Route preview — set destination on the Drive tab" : currentLat ? "Sorted by distance from your location" : `${zones.length} zones on Kenya roads`}
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

      {/* Focused alert banner (deep-link from home's Nearby Alerts) */}
      {focusedAlert && (
        <View style={[styles.focusBanner, { backgroundColor: c.primary + "18", borderColor: c.primary }]}>
          <View style={[styles.focusDot, { backgroundColor: c.primary }]} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.focusTitle, { color: c.foreground }]} numberOfLines={1}>
              {focusedReport
                ? `Reported ${focusedReport.type}${focusedReport.roadName ? ` · ${focusedReport.roadName}` : ""}`
                : focusedZoneId
                  ? "Selected alert highlighted below"
                  : "Selected alert"}
            </Text>
            <Text style={[styles.focusSub, { color: c.mutedForeground }]} numberOfLines={1}>
              {currentLat && currentLng
                ? `${distStr(haversine(currentLat, currentLng, focusedAlert.lat, focusedAlert.lng))} away · ${focusedAlert.lat.toFixed(4)}, ${focusedAlert.lng.toFixed(4)}`
                : `${focusedAlert.lat.toFixed(4)}, ${focusedAlert.lng.toFixed(4)}`}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setFocusedAlert(null)} style={{ padding: 4 }}>
            <Ionicons name="close" size={16} color={c.mutedForeground} />
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={zones}
        keyExtractor={(z) => z.id}
        contentContainerStyle={{ paddingBottom: bottomInset + 100, paddingTop: 4 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <View
            style={[
              styles.zoneRow,
              { backgroundColor: c.card, borderColor: c.border },
              focusedZoneId === item.id && { borderColor: c.primary, borderWidth: 2, backgroundColor: c.primary + "10" },
            ]}
          >
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

      <ReportUndoToast
        report={undoReport}
        bottom={bottomInset + (communityReports.length > 0 ? 152 : 20)}
        onUndo={undoLastReport}
        onDismiss={() => setUndoReport(null)}
      />

      <ReportModal
        visible={showReport}
        onClose={() => setShowReport(false)}
        onSubmit={handleReport}
        currentLat={currentLat}
        currentLng={currentLng}
        onOpenMapPicker={(_lat, _lng, _cb) => {
          // Map picker is native-only; no-op on web.
        }}
      />
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
  routePanelTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", padding: 12, gap: 8 },
  routeDestName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  routeMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  dismissBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 },
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
  focusBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginHorizontal: 16, marginBottom: 8, padding: 12,
    borderRadius: 14, borderWidth: 1.5,
  },
  focusDot: { width: 10, height: 10, borderRadius: 5 },
  focusTitle: { fontSize: 13.5, fontFamily: "Inter_600SemiBold" },
  focusSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  titleGroup: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1, minWidth: 0 },
  weatherChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, borderWidth: 1,
    flexShrink: 1,
  },
  weatherTemp: { fontSize: 13, fontFamily: "Inter_700Bold" },
  weatherLocality: { fontSize: 11, fontFamily: "Inter_500Medium", flexShrink: 1 },
});
