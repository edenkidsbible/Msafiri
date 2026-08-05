/**
 * AdminModerationQueue — full-screen admin panel showing flagged / pending
 * reports that need a human decision. Loaded on demand from the admin mode
 * indicator; only renders when isAdmin is true.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { resolveIncidentType } from "@/constants/incidentTypes";
import { formatTimeAgo } from "@/lib/timeAgo";

interface QueueReport {
  id: string;
  type: string;
  lat: number;
  lng: number;
  status: string;
  roadName: string | null;
  flagCount: number;
  confirmCount: number;
  adminVerified: boolean;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  flagged:        "Flagged",
  pending_review: "Pending Review",
  admin_review:   "Admin Review",
};

const STATUS_COLOR: Record<string, string> = {
  flagged:        "#B71C1C",
  pending_review: "#E65100",
  admin_review:   "#1565C0",
};

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called when admin taps "Fix Pin" so the caller can open the location picker. */
  onFixPin?: (report: QueueReport) => void;
}

export default function AdminModerationQueue({ visible, onClose, onFixPin }: Props) {
  const c      = useColors();
  const isDark = c.isDark;
  const {
    isAdmin,
    adminVerifyReport,
    adminDenyReport,
  } = useApp();

  const [reports,     setReports]     = useState<QueueReport[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const bg       = isDark ? "#111"    : "#F2F2F7";
  const cardBg   = isDark ? "#1C1C1E" : "#FFFFFF";
  const fg       = isDark ? "#FFFFFF" : "#1A1A1A";
  const fgMuted  = isDark ? "#999"    : "#757575";
  const divider  = isDark ? "#333"    : "#E0E0E0";

  const loadQueue = useCallback(async (showRefreshing = false) => {
    if (!isAdmin) return;
    if (showRefreshing) setRefreshing(true); else setLoading(true);
    try {
      const API_BASE = process.env.EXPO_PUBLIC_DOMAIN
        ? `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`
        : "";
      const token = (await import("@react-native-async-storage/async-storage"))
        .default.getItem("admin_mobile_token");
      const t = await token;
      if (!t || !API_BASE) return;
      const res = await fetch(`${API_BASE}/admin-mobile/reports/queue`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!res.ok) return;
      const data: { reports: QueueReport[] } = await res.json();
      setReports(data.reports ?? []);
    } catch { /* silently ignore network errors */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [isAdmin]);

  useEffect(() => { if (visible) void loadQueue(); }, [visible, loadQueue]);

  async function handleVerify(r: QueueReport) {
    setActioningId(r.id);
    try {
      await adminVerifyReport(r.id);
      setReports((prev) => prev.filter((x) => x.id !== r.id));
    } catch (err: unknown) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed");
    } finally {
      setActioningId(null);
    }
  }

  async function handleDeny(r: QueueReport) {
    Alert.alert("Remove Report", "Remove this report from the map?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setActioningId(r.id);
          try {
            await adminDenyReport(r.id);
            setReports((prev) => prev.filter((x) => x.id !== r.id));
          } catch (err: unknown) {
            Alert.alert("Error", err instanceof Error ? err.message : "Failed");
          } finally {
            setActioningId(null);
          }
        },
      },
    ]);
  }

  const now = Date.now();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[ss.root, { backgroundColor: bg }]}>
        {/* Header */}
        <View style={[ss.header, { backgroundColor: cardBg, borderBottomColor: divider }]}>
          <View>
            <View style={[ss.adminChip, { backgroundColor: "#1565C015", borderColor: "#1565C040" }]}>
              <Ionicons name="shield" size={11} color="#1565C0" />
              <Text style={[ss.adminChipTxt, { color: "#1565C0" }]}>ADMIN</Text>
            </View>
            <Text style={[ss.headerTitle, { color: fg }]}>Moderation Queue</Text>
          </View>
          <TouchableOpacity style={ss.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={22} color={fgMuted} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={ss.center}>
            <ActivityIndicator color="#1565C0" />
            <Text style={[ss.emptyTxt, { color: fgMuted }]}>Loading queue…</Text>
          </View>
        ) : reports.length === 0 ? (
          <View style={ss.center}>
            <Ionicons name="checkmark-circle-outline" size={48} color={fgMuted} />
            <Text style={[ss.emptyTxt, { color: fgMuted }]}>Queue is empty</Text>
            <Text style={[ss.emptySubTxt, { color: fgMuted }]}>No flagged or pending reports right now.</Text>
          </View>
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 14, gap: 10 }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => loadQueue(true)}
                tintColor="#1565C0"
              />
            }
            showsVerticalScrollIndicator={false}
          >
            <Text style={[ss.countTxt, { color: fgMuted }]}>
              {reports.length} report{reports.length !== 1 ? "s" : ""} need attention
            </Text>
            {reports.map((r) => {
              const def        = resolveIncidentType(r.type);
              const statusClr  = STATUS_COLOR[r.status]  ?? "#757575";
              const statusLbl  = STATUS_LABEL[r.status]  ?? r.status;
              const isActioning = actioningId === r.id;
              return (
                <View key={r.id} style={[ss.card, { backgroundColor: cardBg }]}>
                  {/* Top row */}
                  <View style={ss.cardTop}>
                    <View style={[ss.emojiWrap, { backgroundColor: def.color + "22" }]}>
                      <Text style={ss.emoji}>{def.emoji}</Text>
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={[ss.cardType, { color: fg }]}>{def.label}</Text>
                        <View style={[ss.statusPill, { backgroundColor: statusClr + "18", borderColor: statusClr + "50" }]}>
                          <Text style={[ss.statusTxt, { color: statusClr }]}>{statusLbl}</Text>
                        </View>
                      </View>
                      {r.roadName ? (
                        <Text style={[ss.cardRoad, { color: fgMuted }]}>{r.roadName}</Text>
                      ) : null}
                      <Text style={[ss.cardMeta, { color: fgMuted }]}>
                        {formatTimeAgo(new Date(r.createdAt).getTime(), now)}
                        {r.flagCount > 0 ? `  ·  ${r.flagCount} flag${r.flagCount > 1 ? "s" : ""}` : ""}
                        {r.confirmCount > 1 ? `  ·  ${r.confirmCount} confirm${r.confirmCount > 1 ? "s" : ""}` : ""}
                      </Text>
                    </View>
                  </View>

                  {/* Action row */}
                  <View style={[ss.actionRow, { borderTopColor: divider }]}>
                    <TouchableOpacity
                      style={[ss.actionBtn, { backgroundColor: "#E8F5E920", borderColor: "#1B5E2040" }, isActioning && ss.actionBtnDisabled]}
                      disabled={isActioning}
                      onPress={() => handleVerify(r)}
                    >
                      {isActioning
                        ? <ActivityIndicator size={13} color="#1B5E20" />
                        : <Ionicons name="checkmark-circle" size={14} color="#1B5E20" />}
                      <Text style={[ss.actionTxt, { color: "#1B5E20" }]}>Verify</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[ss.actionBtn, { backgroundColor: "#FFEBEE20", borderColor: "#B71C1C40" }, isActioning && ss.actionBtnDisabled]}
                      disabled={isActioning}
                      onPress={() => handleDeny(r)}
                    >
                      <Ionicons name="close-circle" size={14} color="#B71C1C" />
                      <Text style={[ss.actionTxt, { color: "#B71C1C" }]}>Remove</Text>
                    </TouchableOpacity>

                    {onFixPin && (
                      <TouchableOpacity
                        style={[ss.actionBtn, { backgroundColor: "#E3F2FD20", borderColor: "#1565C040" }]}
                        onPress={() => { onClose(); onFixPin(r); }}
                      >
                        <Ionicons name="location" size={14} color="#1565C0" />
                        <Text style={[ss.actionTxt, { color: "#1565C0" }]}>Fix Pin</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const ss = StyleSheet.create({
  root:         { flex: 1 },
  header:       { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 58, paddingBottom: 14, borderBottomWidth: 1 },
  adminChip:    { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, borderWidth: 1, marginBottom: 4 },
  adminChipTxt: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  headerTitle:  { fontSize: 22, fontFamily: "Inter_700Bold" },
  closeBtn:     { padding: 4, marginTop: 4 },
  center:       { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 32 },
  emptyTxt:     { fontSize: 16, fontFamily: "Inter_500Medium", textAlign: "center" },
  emptySubTxt:  { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  countTxt:     { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 4 },
  card:         { borderRadius: 14, padding: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  cardTop:      { flexDirection: "row", gap: 12, marginBottom: 12 },
  emojiWrap:    { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  emoji:        { fontSize: 22 },
  cardType:     { fontSize: 15, fontFamily: "Inter_700Bold" },
  cardRoad:     { fontSize: 12, fontFamily: "Inter_400Regular" },
  cardMeta:     { fontSize: 11, fontFamily: "Inter_400Regular" },
  statusPill:   { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, borderWidth: 1 },
  statusTxt:    { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  actionRow:    { flexDirection: "row", gap: 8, paddingTop: 10, borderTopWidth: 1 },
  actionBtn:    { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9, borderRadius: 8, borderWidth: 1 },
  actionBtnDisabled: { opacity: 0.5 },
  actionTxt:    { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
