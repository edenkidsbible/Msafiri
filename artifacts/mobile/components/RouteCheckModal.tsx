import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useApp, RouteCheckResult } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { distLabel, incidentVisual, incidentDelayMin, delayMinutesLabel } from "@/components/RouteIncidentsPanel";

function distanceStr(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function durationStr(s: number): string {
  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

export default function RouteCheckModal({
  visible,
  onClose,
  destLabel,
  destLat,
  destLng,
}: {
  visible: boolean;
  onClose: () => void;
  destLabel: string;
  destLat: number;
  destLng: number;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { locationGranted, requestLocationPermission, currentLat, checkRouteStatus, setNavDestination } = useApp();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [result, setResult] = useState<RouteCheckResult | null>(null);

  useEffect(() => {
    if (!visible) { setResult(null); setError(false); return; }
    if (!locationGranted || currentLat == null) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    checkRouteStatus(destLat, destLng)
      .then((r) => { if (!cancelled) { setResult(r); if (!r) setError(true); } })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [visible, destLat, destLng, locationGranted, currentLat]);

  const navigateNow = () => {
    setNavDestination({ name: destLabel, lat: destLat, lng: destLng });
    onClose();
    router.push("/");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const clear = result ? result.incidents.length === 0 : false;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: c.card, paddingBottom: insets.bottom + 20 }]} onPress={() => {}}>
          <View style={[styles.grabber, { backgroundColor: c.border }]} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: c.foreground }]} numberOfLines={1}>{destLabel}</Text>
              <Text style={[styles.subtitle, { color: c.mutedForeground }]}>Road conditions right now</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={c.mutedForeground} />
            </TouchableOpacity>
          </View>

          {!locationGranted || currentLat == null ? (
            <View style={styles.stateBox}>
              <Ionicons name="location-outline" size={30} color={c.mutedForeground} />
              <Text style={[styles.stateText, { color: c.mutedForeground }]}>
                Turn on location to check current road conditions on this route.
              </Text>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: c.primary }]} onPress={requestLocationPermission}>
                <Text style={styles.actionBtnText}>Enable Location</Text>
              </TouchableOpacity>
            </View>
          ) : loading ? (
            <View style={styles.stateBox}>
              <ActivityIndicator color={c.primary} />
              <Text style={[styles.stateText, { color: c.mutedForeground }]}>Checking road conditions…</Text>
            </View>
          ) : error || !result ? (
            <View style={styles.stateBox}>
              <Ionicons name="cloud-offline-outline" size={30} color={c.mutedForeground} />
              <Text style={[styles.stateText, { color: c.mutedForeground }]}>
                Couldn't check this route. Check your connection and try again.
              </Text>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: c.primary }]}
                onPress={() => { setError(false); setResult(null); checkRouteStatus(destLat, destLng).then(setResult).catch(() => setError(true)); }}
              >
                <Text style={styles.actionBtnText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View
                style={[
                  styles.statusBanner,
                  { backgroundColor: clear ? "#2E7D3214" : "#E6510014", borderColor: clear ? "#2E7D3233" : "#E6510033" },
                ]}
              >
                <Ionicons
                  name={clear ? "checkmark-circle" : "warning"}
                  size={20}
                  color={clear ? "#2E7D32" : "#E65100"}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.statusTitle, { color: clear ? "#2E7D32" : "#E65100" }]}>
                    {clear
                      ? "Road looks clear"
                      : `${result.incidents.length} ${result.incidents.length === 1 ? "incident" : "incidents"} on this route`}
                  </Text>
                  {result.trafficDelayS > 0 && (
                    <Text style={[styles.statusSub, { color: c.mutedForeground }]}>
                      Expect ~{delayMinutesLabel(result.trafficDelayS)} extra delay
                    </Text>
                  )}
                </View>
              </View>

              <View style={styles.metaRow}>
                <View style={styles.metaItem}>
                  <Ionicons name="navigate-outline" size={14} color={c.mutedForeground} />
                  <Text style={[styles.metaText, { color: c.foreground }]}>{distanceStr(result.distanceM)}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Ionicons name="time-outline" size={14} color={c.mutedForeground} />
                  <Text style={[styles.metaText, { color: c.foreground }]}>
                    {durationStr(result.durationS + result.trafficDelayS)}
                  </Text>
                </View>
              </View>

              {result.incidents.length > 0 && (
                <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
                  {result.incidents.map((inc) => {
                    const { IconComp, icon, color } = incidentVisual(inc);
                    const delayMin = incidentDelayMin(inc);
                    return (
                      <View key={inc.id} style={[styles.row, { borderColor: c.border }]}>
                        <View style={[styles.rowIcon, { backgroundColor: color + "18" }]}>
                          <IconComp name={icon as never} size={15} color={color} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={styles.rowTitleRow}>
                            <Text style={[styles.rowTitle, { color: c.foreground }]}>{inc.label}</Text>
                            {delayMin != null && (
                              <View style={styles.delayChip}>
                                <Ionicons name="time-outline" size={9} color="#E65100" />
                                <Text style={styles.delayChipTxt}>~{delayMin} min</Text>
                              </View>
                            )}
                          </View>
                          <Text style={[styles.rowSub, { color: c.mutedForeground }]} numberOfLines={1}>
                            {inc.source === "static" ? (inc.road ?? inc.name) : "Reported by a driver"}
                          </Text>
                        </View>
                        <Text style={[styles.rowDist, { color }]}>{distLabel(inc.distanceAlongRouteM)}</Text>
                      </View>
                    );
                  })}
                </ScrollView>
              )}

              <TouchableOpacity style={[styles.navBtn, { backgroundColor: c.primary }]} onPress={navigateNow}>
                <Ionicons name="navigate" size={17} color="#FFF" />
                <Text style={styles.navBtnText}>Start Navigation</Text>
              </TouchableOpacity>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "#00000066", justifyContent: "flex-end" },
  sheet: {
    maxHeight: "80%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 14 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 10 },
  title: { fontSize: 17, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  stateBox: { alignItems: "center", gap: 10, paddingVertical: 30 },
  stateText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 10 },
  actionBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, marginTop: 4 },
  actionBtnText: { color: "#FFF", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  statusBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 12,
  },
  statusTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  statusSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  metaRow: { flexDirection: "row", gap: 18, marginBottom: 10 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  list: { maxHeight: 260, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 10, borderBottomWidth: 1 },
  rowIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  rowTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  rowTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  delayChip: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "#E6510018", borderRadius: 8, paddingHorizontal: 5, paddingVertical: 2,
  },
  delayChipTxt: { fontSize: 9, fontFamily: "Inter_600SemiBold", color: "#E65100" },
  rowSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  rowDist: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginLeft: 6 },
  navBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: 14, paddingVertical: 14, marginTop: 6,
  },
  navBtnText: { color: "#FFF", fontSize: 14, fontFamily: "Inter_700Bold" },
});
