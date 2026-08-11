/**
 * admin-listings.tsx — Admin management screen for community report listings.
 *
 * Accessible from Profile → Manage Listings when the admin PIN has been entered
 * at the paywall.  Shows pending_review reports (waiting for admin approval)
 * and lets the admin approve or deny each one.
 *
 * Uses the /admin-mobile/* endpoints with the stored 30-day JWT.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { resolveIncidentType } from "@/constants/incidentTypes";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? "msafirikenya.com"}/api`;
const EAT = "Africa/Nairobi";

type AdminReport = {
  id: string;
  type: string;
  status: string;
  lat: number;
  lng: number;
  roadName: string | null;
  confirmCount: number;
  denyCount: number;
  adminVerified: boolean;
  speedLimit: number | null;
  createdAt: string;
  expiresAt: string | null;
};

function fmtAge(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2)    return "just now";
  if (mins < 60)   return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-KE", { hour: "numeric", minute: "2-digit", timeZone: EAT });
}

async function adminFetch<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const token = await AsyncStorage.getItem("admin_mobile_token");
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

type Tab = "pending" | "active";

export default function AdminListingsScreen() {
  const c = useColors();
  const { isAdmin } = useApp();
  const [tab, setTab] = useState<Tab>("pending");
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);

  // Guard: non-admins can't reach this screen
  useEffect(() => {
    if (!isAdmin) router.back();
  }, [isAdmin]);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const status = tab === "pending" ? "pending_review" : "active";
      const data = await adminFetch<{ reports: AdminReport[] }>(
        "GET",
        `/admin-mobile/reports?status=${status}`
      );
      setReports(data.reports ?? []);
    } catch {
      // Keep existing list on error
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  const approve = useCallback(async (id: string) => {
    setActioningId(id);
    try {
      await adminFetch("POST", `/admin-mobile/reports/${id}/verify`);
      setReports((prev) => prev.filter((r) => r.id !== id));
    } catch {
      Alert.alert("Error", "Failed to approve report. Please try again.");
    } finally {
      setActioningId(null);
    }
  }, []);

  const deny = useCallback((id: string) => {
    Alert.alert(
      "Deny Report",
      "This will remove the report from the map permanently.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Deny",
          style: "destructive",
          onPress: async () => {
            setActioningId(id);
            try {
              await adminFetch("POST", `/admin-mobile/reports/${id}/deny`);
              setReports((prev) => prev.filter((r) => r.id !== id));
            } catch {
              Alert.alert("Error", "Failed to deny report. Please try again.");
            } finally {
              setActioningId(null);
            }
          },
        },
      ]
    );
  }, []);

  if (!isAdmin) return null;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={26} color={c.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>Manage Listings</Text>
        <TouchableOpacity onPress={fetchReports} style={styles.refreshBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="refresh" size={22} color={c.primary} />
        </TouchableOpacity>
      </View>

      {/* Tab selector */}
      <View style={[styles.segmentWrap, { backgroundColor: c.muted }]}>
        {(["pending", "active"] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.segmentBtn, tab === t && { backgroundColor: c.card }]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.segmentTxt, { color: tab === t ? c.primary : c.mutedForeground }]}>
              {t === "pending" ? "Needs Review" : "Active Reports"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.primary} />
          <Text style={[styles.loadingTxt, { color: c.mutedForeground }]}>Loading reports…</Text>
        </View>
      ) : reports.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>{tab === "pending" ? "✅" : "🗺️"}</Text>
          <Text style={[styles.emptyTitle, { color: c.foreground }]}>
            {tab === "pending" ? "All clear" : "No active reports"}
          </Text>
          <Text style={[styles.emptyText, { color: c.mutedForeground }]}>
            {tab === "pending"
              ? "No reports are waiting for review right now."
              : "There are no live community reports at the moment."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <Text style={[styles.countLabel, { color: c.mutedForeground }]}>
              {reports.length} report{reports.length !== 1 ? "s" : ""}
            </Text>
          }
          renderItem={({ item: r }) => {
            const def = resolveIncidentType(r.type);
            const busy = actioningId === r.id;
            return (
              <View style={[styles.card, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
                {/* Type + status row */}
                <View style={styles.cardTop}>
                  <View style={[styles.typePill, { backgroundColor: def.color + "22" }]}>
                    <Text style={[styles.typeEmoji, { fontFamily: EMOJI_FONT_FAMILY }]}>{def.emoji}</Text>
                    <Text style={[styles.typeLabel, { color: def.color }]}>{def.label}</Text>
                  </View>
                  <View style={[
                    styles.statusPill,
                    { backgroundColor: r.status === "pending_review" ? "#F59E0B22" : "#22C55E22" },
                  ]}>
                    <Text style={[
                      styles.statusTxt,
                      { color: r.status === "pending_review" ? "#D97706" : "#16A34A" },
                    ]}>
                      {r.status === "pending_review" ? "Pending" : r.adminVerified ? "Verified ✓" : "Active"}
                    </Text>
                  </View>
                </View>

                {/* Location */}
                {r.roadName ? (
                  <Text style={[styles.road, { color: c.foreground }]} numberOfLines={1}>
                    📍 {r.roadName}
                  </Text>
                ) : (
                  <Text style={[styles.road, { color: c.mutedForeground }]} numberOfLines={1}>
                    {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
                  </Text>
                )}

                {/* Meta */}
                <Text style={[styles.meta, { color: c.mutedForeground }]}>
                  {fmtAge(r.createdAt)} · {fmtTime(r.createdAt)}
                  {r.speedLimit != null ? ` · ${r.speedLimit} km/h zone` : ""}
                </Text>
                <Text style={[styles.votes, { color: c.mutedForeground }]}>
                  👍 {r.confirmCount} confirms · 👎 {r.denyCount} denies
                </Text>

                {/* Action buttons */}
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.approveBtn, busy && styles.btnDisabled]}
                    onPress={() => approve(r.id)}
                    disabled={busy}
                    activeOpacity={0.8}
                  >
                    {busy
                      ? <ActivityIndicator size="small" color="#FFF" />
                      : <>
                          <Ionicons name="checkmark-circle" size={16} color="#FFF" />
                          <Text style={styles.btnTxt}>Approve</Text>
                        </>
                    }
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.denyBtn, { borderColor: c.destructive + "55" }, busy && styles.btnDisabled]}
                    onPress={() => deny(r.id)}
                    disabled={busy}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="close-circle" size={16} color={c.destructive} />
                    <Text style={[styles.denyTxt, { color: c.destructive }]}>Deny</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 44, alignItems: "flex-start", paddingLeft: 8 },
  refreshBtn: { width: 44, alignItems: "flex-end", paddingRight: 8 },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },

  segmentWrap: {
    flexDirection: "row",
    margin: 16,
    borderRadius: 12,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: "center",
  },
  segmentTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  loadingTxt: { fontSize: 14, fontFamily: "Inter_400Regular" },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },

  countLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 4 },

  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },

  typePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  typeEmoji: { fontSize: 14 },
  typeLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  statusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  road: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  votes: { fontSize: 12, fontFamily: "Inter_400Regular" },

  actions: { flexDirection: "row", gap: 10, marginTop: 6 },
  approveBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#22C55E",
    borderRadius: 12,
    paddingVertical: 10,
  },
  denyBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 10,
  },
  btnTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFF" },
  denyTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  btnDisabled: { opacity: 0.5 },
});
