import React, { useEffect, useRef, useState } from "react";
import { Animated, FlatList, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import type { CommunityReport } from "@/context/AppContext";
import { getVehicleTypeDef, capSpeedLimit } from "@/data/vehicleTypes";
import ReportModal from "@/components/ReportModal";
import ReportUndoToast, { UndoableReport } from "@/components/ReportUndoToast";
import { snapToRoad } from "@/utils/snapToRoad";
import { useRoundaboutExitCounter } from "@/hooks/useRoundaboutExitCounter";

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
    activeRoute, altRoutes, selectRoute, navigationActive,
    navDestination, showTraffic, setShowTraffic,
    currentStepIdx, distToNextM, distanceRemainingM, durationRemainingS,
    startNavigation, stopNavigation,
    vehicleType, routeTrafficDelayS, allZones,
    fasterRoute, acceptFasterRoute, dismissFasterRoute,
  } = useApp();
  const vehicle = getVehicleTypeDef(vehicleType);
  const [filter, setFilter] = useState<ZoneFilter>("all");
  const [showReport, setShowReport] = useState(false);
  const [undoReport, setUndoReport] = useState<UndoableReport | null>(null);

  // Fade the ETA labels when durationRemainingS jumps >60 s (traffic refresh).
  // Small per-GPS-fix drift is below the threshold and passes through unchanged.
  const etaFadeAnim  = useRef(new Animated.Value(1)).current;
  const prevEtaRef   = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevEtaRef.current;
    prevEtaRef.current = durationRemainingS;
    if (prev == null || durationRemainingS == null) return;
    if (Math.abs(durationRemainingS - prev) < 60) return;
    Animated.sequence([
      Animated.timing(etaFadeAnim, { toValue: 0, duration: 150, useNativeDriver: false }),
      Animated.timing(etaFadeAnim, { toValue: 1, duration: 250, useNativeDriver: false }),
    ]).start();
  }, [durationRemainingS, etaFadeAnim]);

  const currentStep = activeRoute?.steps?.[currentStepIdx] ?? null;
  const isRoundaboutStep = currentStep?.instruction?.toLowerCase().includes("roundabout") ?? false;

  const { exitsPassed, targetExitIsNext } = useRoundaboutExitCounter({
    currentLat,
    currentLng,
    currentStepIdx,
    navigationActive,
    targetExitNumber: isRoundaboutStep ? (currentStep?.exitNumber ?? null) : null,
  });

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const zones = allZones.filter((z) => filter === "all" || z.type === filter)
    .map((z) => ({ ...z, speedLimit: capSpeedLimit(z.speedLimit, vehicle), distance: currentLat && currentLng ? haversine(currentLat, currentLng, z.lat, z.lng) : null }))
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

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
                <Animated.View style={{ opacity: etaFadeAnim }}>
                  <Text style={[styles.routeMeta, { color: navigationActive ? "#FFFFFFBB" : c.mutedForeground }]}>
                    {durationStr(durationRemainingS ?? activeRoute.durationS)} · {distStr(distanceRemainingM ?? activeRoute.distanceM)}
                  </Text>
                  <Text style={[styles.routeMeta, { color: navigationActive ? "#FFFFFFAA" : c.mutedForeground, marginTop: 1 }]}>
                    {arrivalTimeStr(durationRemainingS ?? activeRoute.durationS)}
                  </Text>
                </Animated.View>
                {routeTrafficDelayS > 0 && (
                  <Text style={[styles.routeMeta, { color: navigationActive ? "#FFD180" : "#E65100", marginTop: 1 }]}>
                    Community reports: +{Math.round(routeTrafficDelayS / 60)} min
                  </Text>
                )}
              </View>
              {navigationActive ? (
                <TouchableOpacity style={styles.stopBtn} onPress={() => stopNavigation("manual")}>
                  <Text style={styles.stopBtnText}>■ Stop</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[styles.startBtn, { backgroundColor: c.primary }]} onPress={startNavigation}>
                  <Ionicons name="navigate" size={14} color={c.primaryForeground} />
                  <Text style={[styles.startBtnText, { color: c.primaryForeground }]}>Start</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Faster route banner (nav active) */}
            {navigationActive && !!fasterRoute && durationRemainingS != null && (
              <View style={styles.fasterRouteBanner}>
                <Ionicons name="flash" size={14} color="#00BCD4" />
                <Text style={styles.fasterRouteTxt} numberOfLines={1}>
                  Faster route — save {Math.max(1, Math.round((durationRemainingS - fasterRoute.durationS) / 60))} min
                </Text>
                <TouchableOpacity style={styles.fasterRouteSwitch} onPress={acceptFasterRoute}>
                  <Text style={styles.fasterRouteSwitchTxt}>Switch</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.fasterRouteDismiss} onPress={dismissFasterRoute}>
                  <Ionicons name="close" size={14} color="#FFFFFFAA" />
                </TouchableOpacity>
              </View>
            )}

            {/* Current instruction (nav active) */}
            {navigationActive && currentStep && (
              <View>
                <View style={styles.instructionRow}>
                  <View style={{ position: "relative" }}>
                    <Ionicons name="arrow-forward-circle-outline" size={18} color="#FFF" />
                    {currentStep.exitNumber != null && (
                      <View style={[styles.exitBadge, {
                        backgroundColor: targetExitIsNext ? "#FFC107" : "#FFF",
                      }]}>
                        <Text style={[styles.exitBadgeTxt, {
                          color: targetExitIsNext ? "#7B3F00" : "#1565C0",
                        }]}>
                          {currentStep.exitNumber}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.instructionText} numberOfLines={2}>
                    {!isRoundaboutStep && distToNextM != null ? `In ${distToNextM}m — ` : ""}
                    {currentStep.instruction}
                  </Text>
                </View>
                {/* Roundabout exit counter strip */}
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
                            isPassed && styles.rabDotPassed,
                            isTarget && !isPassed && styles.rabDotTarget,
                            isNextUp && styles.rabDotNext,
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
  routePanelTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12 },
  routeDestName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  routeMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  stopBtn: { backgroundColor: "#FFFFFF22", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  stopBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#FFF" },
  startBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  startBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  instructionRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  instructionText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#FFF", lineHeight: 18 },
  exitBadge: { position: "absolute", bottom: -4, right: -4, borderRadius: 8, minWidth: 16, height: 16, paddingHorizontal: 3, alignItems: "center", justifyContent: "center" },
  exitBadgeTxt: { fontSize: 9, fontFamily: "Inter_700Bold", lineHeight: 14 },
  rabRow: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingBottom: 10, flexWrap: "wrap" },
  rabDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: "#FFFFFF55", backgroundColor: "transparent" },
  rabDotPassed: { backgroundColor: "#FFFFFF80", borderColor: "#FFFFFF80" },
  rabDotTarget: { width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: "#FFC107", backgroundColor: "transparent" },
  rabDotNext: { backgroundColor: "#FFC107", borderColor: "#FFC107" },
  rabLabel: { marginLeft: 4, fontSize: 12, fontFamily: "Inter_700Bold", color: "#FFF" },
  altRow: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingBottom: 10, flexWrap: "wrap" },
  altChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, borderWidth: 1 },
  altChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  stepNum: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  stepNumText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  stepText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },
  stepDist: { fontSize: 11, fontFamily: "Inter_400Regular" },
  fasterRouteBanner: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#FFFFFF22" },
  fasterRouteTxt: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#00BCD4" },
  fasterRouteSwitch: { backgroundColor: "#00BCD4", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  fasterRouteSwitchTxt: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#FFF" },
  fasterRouteDismiss: { padding: 2 },
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
