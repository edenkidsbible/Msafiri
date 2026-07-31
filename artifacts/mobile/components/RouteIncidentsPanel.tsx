import React from "react";
import { SCROLL_PROPS } from "@/lib/scrollProps";
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useApp, RouteIncident } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

// The Drive tab already has its own inline triggers (the route-preview pill
// and the active-nav chip), so the floating collapsed FAB is suppressed
// there to avoid showing two redundant tap targets on the same screen.
const DRIVE_TAB_PATH = "/";

// The Map (browse-map) tab has its own "Report" button at left:16,bottom:+96
// and a controls column at right:12,bottom:+96, so the default right:16,+90
// position collides with both. On this tab we float the chip above the Report
// button on the left instead.
const MAP_TAB_PATH = "/map";

export function distLabel(m: number): string {
  const v = Math.max(0, m);
  return v >= 1000 ? `${(v / 1000).toFixed(1)} km ahead` : `${Math.round(v)} m ahead`;
}

export function incidentVisual(inc: RouteIncident): { IconComp: typeof Ionicons | typeof MaterialCommunityIcons; icon: string; color: string } {
  if (inc.source === "static" || inc.type === "camera") {
    // Admin-confirmed camera reports are treated identically to static speed
    // cameras — same red icon, same visual weight, no "reported by a driver" framing.
    if (inc.type === "camera") return { IconComp: Ionicons, icon: "camera", color: "#E53935" };
    if (inc.type === "police") return { IconComp: Ionicons, icon: "person", color: "#1565C0" };
    return { IconComp: Ionicons, icon: "speedometer", color: "#E65100" };
  }
  switch (inc.type) {
    case "alcoblow":  return { IconComp: Ionicons, icon: "beer", color: "#283593" };
    case "accident":  return { IconComp: Ionicons, icon: "warning", color: "#B71C1C" };
    case "traffic":   return { IconComp: MaterialCommunityIcons, icon: "traffic-light", color: "#C62828" };
    case "roadblock": return { IconComp: Ionicons, icon: "construct", color: "#7B1FA2" };
    case "roadworks": return { IconComp: Ionicons, icon: "hammer", color: "#FBC02D" };
    case "hazard":    return { IconComp: Ionicons, icon: "flash", color: "#FF6F00" };
    case "pothole":   return { IconComp: Ionicons, icon: "remove-circle", color: "#F57C00" };
    case "debris":    return { IconComp: Ionicons, icon: "cube", color: "#795548" };
    case "breakdown": return { IconComp: Ionicons, icon: "car", color: "#FF8F00" };
    case "weather":   return { IconComp: Ionicons, icon: "rainy", color: "#37474F" };
    case "closure":   return { IconComp: Ionicons, icon: "hand-left", color: "#880E4F" };
    default:          return { IconComp: Ionicons, icon: "help-circle", color: "#546E7A" };
  }
}

export function delayMinutesLabel(delayS: number): string {
  return `${Math.round(delayS / 60)} min`;
}

// Mirror of AppContext TRAFFIC_DELAY_WEIGHTS_MIN — used to tag delay-causing rows
const TRAFFIC_DELAY_WEIGHTS_MIN: Record<string, number> = {
  closure: 15, accident: 12, roadblock: 10, traffic: 8, roadworks: 5, breakdown: 4, weather: 3,
};

export function incidentDelayMin(inc: RouteIncident): number | null {
  const base = TRAFFIC_DELAY_WEIGHTS_MIN[inc.type];
  if (!base) return null;
  if (inc.source === "here") return base; // HERE incidents carry full weight
  if (inc.source !== "report") return null;
  const confirms = inc.confirmCount ?? 0;
  const confidence = confirms > 0 ? Math.min(1 + confirms * 0.15, 1.6) : 0.7;
  return Math.round(base * confidence);
}

export default function RouteIncidentsPanel() {
  const {
    activeRoute, navigationActive, arrivedInfo,
    routeIncidentsAhead, routeTrafficDelayS, routeIncidentsExpanded, setRouteIncidentsExpanded,
  } = useApp();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  if (!activeRoute || arrivedInfo) return null;

  const isDriveTab = pathname === DRIVE_TAB_PATH;
  const isMapTab   = pathname === MAP_TAB_PATH;

  if (!routeIncidentsExpanded) {
    // Off the Drive tab, surface a small floating chip so the incident list
    // stays reachable no matter which screen the driver is on.
    // Drive tab has inline incidents in the nav bar; Map tab now shows them in
    // the bottom action row — suppress the floating chip on both.
    if (isDriveTab || isMapTab || routeIncidentsAhead.length === 0) return null;

    // On the Map tab the Report button sits at left:16,bottom:+96. Float the
    // chip immediately to its right at the same height so they read as a pair.
    // The base fab style has no `right` anchor — chipStyle provides it for the
    // default position — so the button never stretches full-width.
    const chipStyle = isMapTab
      ? { left: 128, bottom: insets.bottom + 96 }    // beside the Report button
      : { right: 16, bottom: insets.bottom + 90 };   // default: bottom-right

    return (
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: c.card, borderColor: c.border, ...chipStyle }]}
        onPress={() => { setRouteIncidentsExpanded(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        activeOpacity={0.85}
      >
        <Ionicons name="warning" size={14} color="#E53935" />
        <Text style={[styles.fabTxt, { color: c.foreground }]}>{routeIncidentsAhead.length} ahead</Text>
        <Ionicons name="chevron-up" size={12} color={c.mutedForeground} />
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.overlay}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => setRouteIncidentsExpanded(false)}
      />
      <View style={[styles.sheet, { backgroundColor: c.card, paddingBottom: insets.bottom + 16 }]}>
        <View style={[styles.grabber, { backgroundColor: c.border }]} />

        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: c.foreground }]}>
            {navigationActive ? "Incidents ahead" : "Incidents on this route"}
          </Text>
          <TouchableOpacity onPress={() => setRouteIncidentsExpanded(false)} hitSlop={10}>
            <Ionicons name="close" size={20} color={c.mutedForeground} />
          </TouchableOpacity>
        </View>

        {routeTrafficDelayS > 0 && (
          <View style={[styles.delayBanner, { backgroundColor: "#E6510014", borderColor: "#E6510033" }]}>
            <View style={[styles.delayBannerIcon, { backgroundColor: "#E6510018" }]}>
              <Ionicons name="time" size={16} color="#E65100" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.delayBannerTitle}>
                Traffic alerts: +{delayMinutesLabel(routeTrafficDelayS)} extra
              </Text>
              <Text style={[styles.delayBannerSub, { color: c.mutedForeground }]}>
                Incidents on your route not yet reflected in Google traffic
              </Text>
            </View>
          </View>
        )}

        {routeIncidentsAhead.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-circle-outline" size={28} color={c.mutedForeground} />
            <Text style={[styles.emptyTxt, { color: c.mutedForeground }]}>
              {navigationActive
                ? "Nothing reported ahead — drive safe."
                : "No known cameras, checkpoints, or reports on this route."}
            </Text>
          </View>
        ) : (
          <ScrollView {...SCROLL_PROPS} style={styles.list} showsVerticalScrollIndicator={false}>
            {routeIncidentsAhead.map((inc) => {
              const { IconComp, icon, color } = incidentVisual(inc);
              const delayMin = incidentDelayMin(inc);
              return (
                <View key={inc.id} style={[styles.row, { borderColor: c.border }]}>
                  <View style={[styles.rowIcon, { backgroundColor: color + "18" }]}>
                    <IconComp name={icon as never} size={16} color={color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.rowTitleRow}>
                      <Text style={[styles.rowTitle, { color: c.foreground }]}>{inc.label}</Text>
                      {delayMin != null && (
                        <View style={styles.delayChip}>
                          <Ionicons name="time-outline" size={10} color="#E65100" />
                          <Text style={styles.delayChipTxt}>~{delayMin} min</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.rowTitleRow}>
                      {inc.source === "here" && (
                        <View style={styles.livePill}>
                          <Text style={styles.livePillTxt}>LIVE</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.rowSub, { color: c.mutedForeground }]} numberOfLines={1}>
                      {inc.source === "here"
                        ? (inc.road ?? "HERE Traffic · live incident")
                        : inc.source === "static"
                          ? (inc.road ?? inc.name)
                          : inc.type === "camera"
                            ? (inc.road ?? inc.name ?? "Speed camera")
                            : "Reported by a driver"}
                    </Text>
                    {!!inc.description && (
                      <Text style={[styles.rowDesc, { color: c.mutedForeground }]} numberOfLines={2}>
                        {inc.description}
                      </Text>
                    )}
                    {inc.speedLimit != null && (
                      <Text style={[styles.rowDesc, { color: c.mutedForeground }]}>
                        Limit: {inc.speedLimit} km/h
                      </Text>
                    )}
                    {/* #31 — Confidence tier pill (community reports only) */}
                    {inc.source === "report" && inc.type !== "camera" && (() => {
                      const c2 = inc.confirmCount ?? 0;
                      if (c2 >= 5) return (
                        <View style={styles.tierPillReliable}>
                          <Text style={styles.tierPillTxt}>✓ Highly Reliable · {c2} drivers</Text>
                        </View>
                      );
                      if (c2 >= 2) return (
                        <View style={styles.tierPillConfirmed}>
                          <Text style={[styles.tierPillTxt, { color: "#1B5E20" }]}>✓ Confirmed by {c2} drivers</Text>
                        </View>
                      );
                      return (
                        <Text style={[styles.rowDesc, { color: c.mutedForeground, fontStyle: "italic" }]}>
                          Unconfirmed · reported by 1 driver
                        </Text>
                      );
                    })()}
                    {inc.source === "report" && inc.type === "camera" && (
                      inc.reportStatus === "pending_review" || inc.reportStatus === "admin_review"
                        ? <Text style={[styles.rowDesc, { color: "#E65100" }]}>Pending review</Text>
                        : <Text style={[styles.rowDesc, { color: "#2E7D32" }]}>Confirmed by admin</Text>
                    )}
                  </View>
                  <Text style={[styles.rowDist, { color }]}>
                    {distLabel(inc.aheadDistanceM ?? inc.distanceAlongRouteM)}
                  </Text>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 18,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 998,
  },
  fabTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  overlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: "flex-end",
    zIndex: 999,
  },
  sheet: {
    maxHeight: "70%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 20,
  },
  grabber: {
    width: 40, height: 4, borderRadius: 2,
    alignSelf: "center", marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  delayBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    marginBottom: 10,
  },
  delayBannerIcon: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: "center", justifyContent: "center",
  },
  delayBannerTitle: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#E65100" },
  delayBannerSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  emptyState: { alignItems: "center", gap: 8, paddingVertical: 28 },
  emptyTxt: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  list: { marginTop: 4 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  rowIcon: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
  },
  rowTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  rowTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  delayChip: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "#E6510018", borderRadius: 8,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  delayChipTxt: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#E65100" },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  rowDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  rowDist: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginLeft: 6 },

  // ── Confidence tier pills (#31) ───────────────────────────────────────────
  tierPillReliable: {
    marginTop: 3, alignSelf: "flex-start",
    backgroundColor: "#1B5E2018", borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  tierPillConfirmed: {
    marginTop: 3, alignSelf: "flex-start",
    backgroundColor: "#E8F5E9", borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  tierPillTxt: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#1B5E20" },
  // HERE Live Traffic badge
  livePill: {
    backgroundColor: "#1565C0",
    borderRadius: 5,
    paddingHorizontal: 6, paddingVertical: 2,
    marginBottom: 2,
  },
  livePillTxt: { fontSize: 9, fontFamily: "Inter_800ExtraBold", color: "#FFF", letterSpacing: 0.6 },
});
