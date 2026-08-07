/**
 * My Reports — premium screen showing all incidents the user has ever submitted.
 * Fetches from GET /api/reports/mine?deviceId=… so it includes historical records
 * regardless of the device's current location.
 */
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { resolveIncidentType } from "@/constants/incidentTypes";
import { apiGet, apiDelete } from "@/utils/apiClient";
import { formatTimeAgo } from "@/lib/timeAgo";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MyReport {
  id: string;
  type: string;
  lat: number;
  lng: number;
  status: "active" | "confirmed" | "expired" | "denied" | "admin_review" | "pending_review";
  confirmCount: number;
  denyCount: number;
  speedLimit?: number;
  roadName?: string;
  adminVerified: boolean;
  createdAt: number;
  expiresAt: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusLabel(status: MyReport["status"]): string {
  switch (status) {
    case "active":        return "Active";
    case "confirmed":     return "Confirmed";
    case "expired":       return "Expired";
    case "denied":        return "Removed";
    case "admin_review":  return "Under Review";
    case "pending_review":return "Pending";
    default:              return status;
  }
}

function statusColor(status: MyReport["status"]): string {
  switch (status) {
    case "active":         return "#00C853";
    case "confirmed":      return "#1565C0";
    case "expired":        return "#9E9E9E";
    case "denied":         return "#E53935";
    case "admin_review":   return "#F59E0B";
    case "pending_review": return "#FF7043";
    default:               return "#9E9E9E";
  }
}

function isLive(status: MyReport["status"]): boolean {
  return status === "active" || status === "confirmed";
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function MyReportsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { deviceId } = useApp();

  const [reports, setReports] = useState<MyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!deviceId) { setLoading(false); return; }
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ reports: MyReport[] }>(`/reports/mine?deviceId=${encodeURIComponent(deviceId)}`);
      setReports(data.reports);
    } catch {
      setError("Could not load your reports. Pull down to retry.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [deviceId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRefresh = () => {
    setRefreshing(true);
    load(true);
  };

  const handleViewOnMap = (r: MyReport) => {
    router.push({
      pathname: "/(tabs)/map",
      params: {
        focusId: r.id,
        focusLat: String(r.lat),
        focusLng: String(r.lng),
        focusTs: String(Date.now()),
      },
    } as any);
  };

  const handleRemove = (r: MyReport) => {
    if (r.confirmCount >= 3) {
      Alert.alert(
        "Cannot Remove",
        "This report has been confirmed by 3 or more drivers and is now protected. It can only be removed by an admin.",
        [{ text: "OK" }],
      );
      return;
    }
    Alert.alert(
      "Remove Report",
      "This will mark your report as expired so it no longer appears on the map.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setRemoving(r.id);
            try {
              await apiDelete(`/reports/${r.id}`, { deviceId });
              setReports((prev) => prev.map((p) => p.id === r.id ? { ...p, status: "expired" as const } : p));
            } catch {
              Alert.alert("Error", "Could not remove the report. Please try again.");
            } finally {
              setRemoving(null);
            }
          },
        },
      ],
    );
  };

  // Group: live first, then historical
  const live = reports.filter((r) => isLive(r.status));
  const past = reports.filter((r) => !isLive(r.status));
  const now = Date.now();

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: c.tileBorder }]}>
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: c.card, borderColor: c.tileBorder }]}
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={18} color={c.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: c.foreground }]}>My Reports</Text>
          <Text style={[styles.headerSub, { color: c.mutedForeground }]}>
            {loading ? "Loading…" : `${reports.length} report${reports.length !== 1 ? "s" : ""} submitted`}
          </Text>
        </View>
      </View>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Ionicons name="cloud-offline-outline" size={44} color={c.mutedForeground} />
          <Text style={[styles.errorTxt, { color: c.mutedForeground }]}>{error}</Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: c.primary }]}
            onPress={() => load()}
          >
            <Text style={styles.retryBtnTxt}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : reports.length === 0 ? (
        <View style={styles.centerState}>
          <View style={[styles.emptyIconWrap, { backgroundColor: c.primary + "18" }]}>
            <Ionicons name="flag-outline" size={36} color={c.primary} />
          </View>
          <Text style={[styles.emptyTitle, { color: c.foreground }]}>No reports yet</Text>
          <Text style={[styles.emptyBody, { color: c.mutedForeground }]}>
            Help keep Kenya's roads safe by reporting hazards, speed cameras, and incidents.
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: c.primary }]}
            onPress={() => router.back()}
          >
            <Text style={styles.retryBtnTxt}>Submit a report</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: insets.bottom + 32,
            paddingTop: 16,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={c.primary}
              colors={[c.primary]}
            />
          }
        >
          {/* ── Live reports ─────────────────────────────────────────────── */}
          {live.length > 0 && (
            <>
              <View style={styles.groupRow}>
                <View style={[styles.groupDot, { backgroundColor: "#00C853" }]} />
                <Text style={[styles.groupLabel, { color: c.foreground }]}>Live on map</Text>
                <Text style={[styles.groupCount, { color: c.mutedForeground }]}>{live.length}</Text>
              </View>
              <View style={[styles.card, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
                {live.map((r, i) => (
                  <ReportRow
                    key={r.id}
                    report={r}
                    now={now}
                    isLast={i === live.length - 1}
                    removing={removing === r.id}
                    colors={c}
                    onViewMap={() => handleViewOnMap(r)}
                    onRemove={() => handleRemove(r)}
                  />
                ))}
              </View>
            </>
          )}

          {/* ── Past reports ─────────────────────────────────────────────── */}
          {past.length > 0 && (
            <>
              <View style={[styles.groupRow, live.length > 0 && { marginTop: 24 }]}>
                <View style={[styles.groupDot, { backgroundColor: c.mutedForeground }]} />
                <Text style={[styles.groupLabel, { color: c.foreground }]}>History</Text>
                <Text style={[styles.groupCount, { color: c.mutedForeground }]}>{past.length}</Text>
              </View>
              <View style={[styles.card, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
                {past.map((r, i) => (
                  <ReportRow
                    key={r.id}
                    report={r}
                    now={now}
                    isLast={i === past.length - 1}
                    removing={removing === r.id}
                    colors={c}
                    onViewMap={() => handleViewOnMap(r)}
                    onRemove={() => handleRemove(r)}
                  />
                ))}
              </View>
            </>
          )}

          {/* ── Stats card ───────────────────────────────────────────────── */}
          <View style={[styles.statsRow, { marginTop: 28 }]}>
            {[
              { label: "Total", value: reports.length },
              { label: "Active", value: live.length },
              { label: "Confirmed", value: reports.filter((r) => r.status === "confirmed" || r.confirmCount > 0).length },
            ].map((s) => (
              <View key={s.label} style={[styles.statTile, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
                <Text style={[styles.statValue, { color: c.foreground }]}>{s.value}</Text>
                <Text style={[styles.statLabel, { color: c.mutedForeground }]}>{s.label}</Text>
              </View>
            ))}
          </View>
          <Text style={[styles.footerNote, { color: c.mutedForeground }]}>
            Reports expire automatically after a set period. Confirmed reports with 3+ verifications are protected.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

// ── Report Row Component ──────────────────────────────────────────────────────

function ReportRow({
  report: r, now, isLast, removing, colors: c,
  onViewMap, onRemove,
}: {
  report: MyReport; now: number; isLast: boolean; removing: boolean;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onViewMap: () => void; onRemove: () => void;
}) {
  const def = resolveIncidentType(r.type);
  const live = isLive(r.status);
  const sColor = statusColor(r.status);
  const canRemove = live && r.confirmCount < 3;

  return (
    <View style={[styles.row, !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.tileBorder }]}>
      {/* Left: emoji icon */}
      <View style={[styles.rowIcon, { backgroundColor: def.color + "20" }]}>
        <Text style={{ fontSize: 20, fontFamily: EMOJI_FONT_FAMILY }}>{def.emoji}</Text>
      </View>

      {/* Centre: details */}
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={styles.rowTitleRow}>
          <Text style={[styles.rowType, { color: c.foreground }]} numberOfLines={1}>{def.label}</Text>
          <View style={[styles.statusBadge, { backgroundColor: sColor + "1E" }]}>
            <View style={[styles.statusDot, { backgroundColor: sColor }]} />
            <Text style={[styles.statusTxt, { color: sColor }]}>{statusLabel(r.status)}</Text>
          </View>
        </View>
        {r.roadName ? (
          <Text style={[styles.rowRoad, { color: c.mutedForeground }]} numberOfLines={1}>
            <Ionicons name="location-outline" size={11} color={c.mutedForeground} /> {r.roadName}
          </Text>
        ) : null}
        <View style={styles.rowMeta}>
          <Text style={[styles.rowMetaTxt, { color: c.mutedForeground }]}>
            {formatTimeAgo(r.createdAt, now)}
          </Text>
          {r.confirmCount > 0 && (
            <View style={styles.rowMetaChip}>
              <Ionicons name="thumbs-up-outline" size={10} color={c.primary} />
              <Text style={[styles.rowMetaChipTxt, { color: c.primary }]}>{r.confirmCount}</Text>
            </View>
          )}
          {r.adminVerified && (
            <View style={[styles.rowMetaChip, { backgroundColor: "#1565C018" }]}>
              <Ionicons name="shield-checkmark-outline" size={10} color="#1565C0" />
              <Text style={[styles.rowMetaChipTxt, { color: "#1565C0" }]}>Verified</Text>
            </View>
          )}
        </View>
      </View>

      {/* Right: actions */}
      <View style={styles.rowActions}>
        {live && (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: c.primary + "18" }]}
            onPress={onViewMap}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="map-outline" size={15} color={c.primary} />
          </TouchableOpacity>
        )}
        {canRemove && (
          removing ? (
            <ActivityIndicator size={15} color="#E53935" style={{ width: 30, height: 30 }} />
          ) : (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: "#E5393518" }]}
              onPress={onRemove}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Ionicons name="trash-outline" size={15} color="#E53935" />
            </TouchableOpacity>
          )
        )}
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },

  centerState: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 36, gap: 14,
  },
  emptyIconWrap: {
    width: 70, height: 70, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
  },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  emptyBody: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  errorTxt: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  retryBtn: { borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  retryBtnTxt: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },

  groupRow: {
    flexDirection: "row", alignItems: "center", gap: 7,
    marginBottom: 10,
  },
  groupDot: { width: 7, height: 7, borderRadius: 4 },
  groupLabel: { fontSize: 13, fontFamily: "Inter_700Bold", flex: 1 },
  groupCount: {
    fontSize: 12, fontFamily: "Inter_500Medium",
    backgroundColor: "transparent",
  },

  card: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },

  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  rowIcon: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", flexShrink: 0 },

  rowTitleRow: { flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" },
  rowType: { fontSize: 14, fontFamily: "Inter_700Bold" },
  rowRoad: { fontSize: 12, fontFamily: "Inter_400Regular" },

  rowMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowMetaTxt: { fontSize: 11, fontFamily: "Inter_400Regular" },
  rowMetaChip: {
    flexDirection: "row", alignItems: "center", gap: 3,
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
    backgroundColor: "#00C85318",
  },
  rowMetaChipTxt: { fontSize: 10, fontFamily: "Inter_600SemiBold" },

  statusBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3,
  },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusTxt: { fontSize: 10.5, fontFamily: "Inter_700Bold" },

  rowActions: { flexDirection: "row", gap: 6, alignItems: "center", flexShrink: 0 },
  actionBtn: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },

  statsRow: { flexDirection: "row", gap: 10 },
  statTile: {
    flex: 1, borderRadius: 14, borderWidth: 1,
    paddingVertical: 14, alignItems: "center", gap: 4,
  },
  statValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11.5, fontFamily: "Inter_500Medium" },

  footerNote: {
    fontSize: 11.5, fontFamily: "Inter_400Regular",
    textAlign: "center", lineHeight: 17, marginTop: 14,
    paddingHorizontal: 10,
  },
});
