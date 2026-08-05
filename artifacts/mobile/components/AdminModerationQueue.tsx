/**
 * AdminModerationQueue — full-screen admin panel with two tabs:
 *
 *  • "Needs Review" — flagged / pending_review / admin_review reports
 *  • "All Reports"  — complete community report list with filter + controls
 *
 * Each card supports: Verify, Remove, Edit (type/road), Fix Pin, View on Map.
 * View on Map closes the modal and pans the live map to that coordinate.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { resolveIncidentType, INCIDENT_TYPE_ORDER } from "@/constants/incidentTypes";
import { formatTimeAgo } from "@/lib/timeAgo";
import AdminReportEditSheet from "./AdminReportEditSheet";
import type { CommunityReport } from "@/context/AppContext";

// ─── Shared report shape used by both tabs ────────────────────────────────────

export interface AdminReport {
  id: string;
  type: string;
  lat: number;
  lng: number;
  status: string;
  roadName: string | null;
  speedLimit: number | null;
  flagCount: number;
  confirmCount: number;
  denyCount: number;
  adminVerified: boolean;
  createdAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const QUEUE_STATUSES = ["flagged", "pending_review", "admin_review"];

const STATUS_LABEL: Record<string, string> = {
  active:         "Active",
  confirmed:      "Confirmed",
  flagged:        "Flagged",
  pending_review: "Pending Review",
  admin_review:   "Admin Review",
  expired:        "Expired",
  denied:         "Removed",
};

const STATUS_COLOR: Record<string, string> = {
  active:         "#1B5E20",
  confirmed:      "#0D47A1",
  flagged:        "#B71C1C",
  pending_review: "#E65100",
  admin_review:   "#1565C0",
  expired:        "#616161",
  denied:         "#757575",
};

const ALL_STATUS_FILTERS = ["all", "active", "confirmed", "flagged", "pending_review", "admin_review", "expired", "denied"];
const STATUS_FILTER_LABELS: Record<string, string> = {
  all: "All",
  active: "Active",
  confirmed: "Confirmed",
  flagged: "Flagged",
  pending_review: "Pending",
  admin_review: "Admin",
  expired: "Expired",
  denied: "Removed",
};

const PAGE_SIZE = 25;

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called when admin taps "Fix Pin"; caller should open the location picker. */
  onFixPin?: (report: AdminReport) => void;
  /** Called when admin taps "View on Map"; caller should close the modal and pan. */
  onViewOnMap?: (lat: number, lng: number) => void;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

async function adminFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) throw new Error("EXPO_PUBLIC_DOMAIN not set");
  const token = await AsyncStorage.getItem("admin_mobile_token");
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`https://${domain}/api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Report card ──────────────────────────────────────────────────────────────

interface CardProps {
  report: AdminReport;
  isDark: boolean;
  cardBg: string;
  fg: string;
  fgMuted: string;
  divider: string;
  actioningId: string | null;
  onVerify: (r: AdminReport) => void;
  onRemove: (r: AdminReport) => void;
  onEdit:   (r: AdminReport) => void;
  onFixPin: (r: AdminReport) => void;
  onViewOnMap?: (r: AdminReport) => void;
  now: number;
}

function ReportCard({
  report: r, isDark, cardBg, fg, fgMuted, divider,
  actioningId, onVerify, onRemove, onEdit, onFixPin, onViewOnMap, now,
}: CardProps) {
  const def       = resolveIncidentType(r.type);
  const statusClr = STATUS_COLOR[r.status] ?? "#757575";
  const statusLbl = STATUS_LABEL[r.status] ?? r.status;
  const busy      = actioningId === r.id;

  return (
    <View style={[card.wrap, { backgroundColor: cardBg }]}>
      {/* Top row */}
      <View style={card.top}>
        <View style={[card.emojiWrap, { backgroundColor: def.color + "22" }]}>
          <Text style={card.emoji}>{def.emoji}</Text>
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={card.titleRow}>
            <Text style={[card.type, { color: fg }]}>{def.label}</Text>
            <View style={[card.pill, { backgroundColor: statusClr + "18", borderColor: statusClr + "50" }]}>
              <Text style={[card.pillTxt, { color: statusClr }]}>{statusLbl}</Text>
            </View>
          </View>
          {r.roadName ? (
            <Text style={[card.road, { color: fgMuted }]}>{r.roadName}</Text>
          ) : null}
          <Text style={[card.meta, { color: fgMuted }]}>
            {formatTimeAgo(new Date(r.createdAt).getTime(), now)}
            {r.confirmCount > 1  ? `  ·  ${r.confirmCount}✓`         : ""}
            {r.denyCount    > 0  ? `  ·  ${r.denyCount}✗`            : ""}
            {r.flagCount    > 0  ? `  ·  ${r.flagCount} flag${r.flagCount > 1 ? "s" : ""}` : ""}
            {r.adminVerified     ? "  ·  ✓ admin"                     : ""}
          </Text>
        </View>
      </View>

      {/* Action row 1: Verify + Remove */}
      <View style={[card.actions, { borderTopColor: divider }]}>
        <TouchableOpacity
          style={[card.btn, { backgroundColor: "#E8F5E920", borderColor: "#1B5E2040" }, busy && card.btnDisabled]}
          disabled={busy}
          onPress={() => onVerify(r)}
        >
          {busy ? <ActivityIndicator size={12} color="#1B5E20" /> : <Ionicons name="checkmark-circle" size={13} color="#1B5E20" />}
          <Text style={[card.btnTxt, { color: "#1B5E20" }]}>{r.adminVerified ? "✓ Verified" : "Verify"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[card.btn, { backgroundColor: "#FFEBEE20", borderColor: "#B71C1C40" }, busy && card.btnDisabled]}
          disabled={busy}
          onPress={() => onRemove(r)}
        >
          <Ionicons name="close-circle" size={13} color="#B71C1C" />
          <Text style={[card.btnTxt, { color: "#B71C1C" }]}>Remove</Text>
        </TouchableOpacity>
      </View>

      {/* Action row 2: Edit + Fix Pin + View on Map */}
      <View style={[card.actions, { borderTopColor: divider }]}>
        <TouchableOpacity
          style={[card.btn, { backgroundColor: "#EDE7F620", borderColor: "#4A148C40" }]}
          onPress={() => onEdit(r)}
        >
          <Ionicons name="create-outline" size={13} color="#4A148C" />
          <Text style={[card.btnTxt, { color: "#4A148C" }]}>Edit</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[card.btn, { backgroundColor: "#E3F2FD20", borderColor: "#1565C040" }]}
          onPress={() => onFixPin(r)}
        >
          <Ionicons name="location" size={13} color="#1565C0" />
          <Text style={[card.btnTxt, { color: "#1565C0" }]}>Fix Pin</Text>
        </TouchableOpacity>

        {onViewOnMap && (
          <TouchableOpacity
            style={[card.btn, { backgroundColor: "#F3E5F520", borderColor: "#6A1B9A40" }]}
            onPress={() => onViewOnMap(r)}
          >
            <Ionicons name="map-outline" size={13} color="#6A1B9A" />
            <Text style={[card.btnTxt, { color: "#6A1B9A" }]}>Map</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const card = StyleSheet.create({
  wrap:       { borderRadius: 14, padding: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  top:        { flexDirection: "row", gap: 12, marginBottom: 10 },
  emojiWrap:  { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  emoji:      { fontSize: 22 },
  titleRow:   { flexDirection: "row", alignItems: "center", gap: 6 },
  type:       { fontSize: 15, fontFamily: "Inter_700Bold" },
  road:       { fontSize: 12, fontFamily: "Inter_400Regular" },
  meta:       { fontSize: 11, fontFamily: "Inter_400Regular" },
  pill:       { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, borderWidth: 1 },
  pillTxt:    { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  actions:    { flexDirection: "row", gap: 6, paddingTop: 8, borderTopWidth: 1, marginTop: 4 },
  btn:        { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  btnDisabled:{ opacity: 0.5 },
  btnTxt:     { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});

// ─── Main component ───────────────────────────────────────────────────────────

type Tab = "queue" | "all";

export default function AdminModerationQueue({ visible, onClose, onFixPin, onViewOnMap }: Props) {
  const c      = useColors();
  const isDark = c.isDark;
  const { isAdmin, adminVerifyReport, adminDenyReport, adminEditReport } = useApp();

  const bg      = isDark ? "#111"    : "#F2F2F7";
  const cardBg  = isDark ? "#1C1C1E" : "#FFFFFF";
  const fg      = isDark ? "#FFFFFF" : "#1A1A1A";
  const fgMuted = isDark ? "#999"    : "#757575";
  const divider = isDark ? "#2C2C2E" : "#E0E0E0";
  const tabActiveBg = isDark ? "#2C2C2E" : "#FFFFFF";

  // ── Tabs ───────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>("queue");

  // ── Queue tab ─────────────────────────────────────────────────────────────
  const [queueReports,    setQueueReports]    = useState<AdminReport[]>([]);
  const [queueLoading,    setQueueLoading]    = useState(false);
  const [queueRefreshing, setQueueRefreshing] = useState(false);

  // ── All-reports tab ───────────────────────────────────────────────────────
  const [allReports,    setAllReports]    = useState<AdminReport[]>([]);
  const [allLoading,    setAllLoading]    = useState(false);
  const [allRefreshing, setAllRefreshing] = useState(false);
  const [allTotal,      setAllTotal]      = useState(0);
  const [allPage,       setAllPage]       = useState(1);
  const [allMore,       setAllMore]       = useState(false);
  const [statusFilter,  setStatusFilter]  = useState("all");
  const [typeFilter,    setTypeFilter]    = useState("all");

  // ── Shared action state ───────────────────────────────────────────────────
  const [actioningId,    setActioningId]    = useState<string | null>(null);
  const [editingReport,  setEditingReport]  = useState<AdminReport | null>(null);

  const now = Date.now();

  // ── Data loaders ──────────────────────────────────────────────────────────

  const loadQueue = useCallback(async (refresh = false) => {
    if (!isAdmin) return;
    if (refresh) setQueueRefreshing(true); else setQueueLoading(true);
    try {
      const data = await adminFetch<{ reports: AdminReport[] }>("/admin-mobile/reports/queue");
      setQueueReports(data.reports ?? []);
    } catch { /* silently ignore */ }
    finally { setQueueLoading(false); setQueueRefreshing(false); }
  }, [isAdmin]);

  const loadAll = useCallback(async (page = 1, status = statusFilter, type = typeFilter, refresh = false) => {
    if (!isAdmin) return;
    if (refresh || page === 1) setAllRefreshing(true); else setAllLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (status && status !== "all") params.set("status", status);
      if (type   && type   !== "all") params.set("type",   type);
      const data = await adminFetch<{ reports: AdminReport[]; total: number; page: number }>(
        `/admin-mobile/reports/all?${params}`
      );
      setAllTotal(data.total ?? 0);
      setAllPage(page);
      setAllReports((prev) => page === 1 ? (data.reports ?? []) : [...prev, ...(data.reports ?? [])]);
      setAllMore((data.reports?.length ?? 0) === PAGE_SIZE);
    } catch { /* silently ignore */ }
    finally { setAllLoading(false); setAllRefreshing(false); }
  }, [isAdmin, statusFilter, typeFilter]);

  // Reload when modal opens
  useEffect(() => {
    if (!visible) return;
    void loadQueue();
    void loadAll(1);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload "all" whenever filters change
  const filterVersion = useRef(0);
  useEffect(() => {
    filterVersion.current += 1;
    const v = filterVersion.current;
    const t = setTimeout(() => {
      if (v !== filterVersion.current) return;
      void loadAll(1, statusFilter, typeFilter);
    }, 120);
    return () => clearTimeout(t);
  }, [statusFilter, typeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Shared action handlers ────────────────────────────────────────────────

  const removeFromBothLists = (id: string) => {
    setQueueReports((p) => p.filter((r) => r.id !== id));
    setAllReports((p) => p.map((r) => r.id === id ? { ...r, status: "denied" } : r));
  };

  const markVerifiedInBothLists = (id: string) => {
    const patch = { adminVerified: true, status: "confirmed" };
    setQueueReports((p) => p.filter((r) => r.id !== id)); // remove from queue once actioned
    setAllReports((p) => p.map((r) => r.id === id ? { ...r, ...patch } : r));
  };

  const handleVerify = async (r: AdminReport) => {
    setActioningId(r.id);
    try {
      await adminVerifyReport(r.id);
      markVerifiedInBothLists(r.id);
    } catch (err: unknown) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed");
    } finally { setActioningId(null); }
  };

  const handleRemove = (r: AdminReport) => {
    Alert.alert("Remove Report", "Remove this report from the map?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setActioningId(r.id);
          try {
            await adminDenyReport(r.id);
            removeFromBothLists(r.id);
          } catch (err: unknown) {
            Alert.alert("Error", err instanceof Error ? err.message : "Failed");
          } finally { setActioningId(null); }
        },
      },
    ]);
  };

  const handleEdit = (r: AdminReport) => setEditingReport(r);

  const handleFixPin = (r: AdminReport) => {
    onClose();
    onFixPin?.(r);
  };

  const handleViewOnMap = (r: AdminReport) => {
    onClose();
    onViewOnMap?.(r.lat, r.lng);
  };

  const handleEditSave = async (fields: { type?: string; roadName?: string | null }) => {
    if (!editingReport) return;
    await adminEditReport(editingReport.id, editingReport.id, fields);
    const patch = {
      ...(fields.type     !== undefined ? { type: fields.type }               : {}),
      ...(fields.roadName !== undefined ? { roadName: fields.roadName ?? null } : {}),
    };
    setQueueReports((p) => p.map((r) => r.id === editingReport.id ? { ...r, ...patch } : r));
    setAllReports((p)   => p.map((r) => r.id === editingReport.id ? { ...r, ...patch } : r));
    setEditingReport(null);
  };

  // ── Shared card props ─────────────────────────────────────────────────────

  const sharedCardProps = {
    isDark, cardBg, fg, fgMuted, divider, actioningId,
    onVerify: handleVerify,
    onRemove: handleRemove,
    onEdit:   handleEdit,
    onFixPin: handleFixPin,
    onViewOnMap: onViewOnMap ? handleViewOnMap : undefined,
    now,
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[ss.root, { backgroundColor: bg }]}>

        {/* Header */}
        <View style={[ss.header, { backgroundColor: cardBg, borderBottomColor: divider }]}>
          <View style={{ flex: 1 }}>
            <View style={[ss.adminChip, { backgroundColor: "#1565C015", borderColor: "#1565C040" }]}>
              <Ionicons name="shield" size={11} color="#1565C0" />
              <Text style={[ss.adminChipTxt, { color: "#1565C0" }]}>ADMIN</Text>
            </View>
            <Text style={[ss.headerTitle, { color: fg }]}>Reports</Text>
          </View>
          <TouchableOpacity style={ss.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={22} color={fgMuted} />
          </TouchableOpacity>
        </View>

        {/* Tab bar */}
        <View style={[ss.tabBar, { backgroundColor: cardBg, borderBottomColor: divider }]}>
          {([["queue", "Needs Review"], ["all", "All Reports"]] as [Tab, string][]).map(([key, label]) => {
            const active = tab === key;
            const badge  = key === "queue" ? queueReports.length : allTotal;
            return (
              <TouchableOpacity
                key={key}
                style={[ss.tab, active && [ss.tabActive, { backgroundColor: tabActiveBg, borderColor: "#1565C0" }]]}
                onPress={() => setTab(key)}
              >
                <Text style={[ss.tabTxt, { color: active ? "#1565C0" : fgMuted }]}>{label}</Text>
                {badge > 0 && (
                  <View style={[ss.tabBadge, { backgroundColor: active ? "#1565C0" : fgMuted }]}>
                    <Text style={ss.tabBadgeTxt}>{badge > 99 ? "99+" : badge}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Queue tab ─────────────────────────────────────────────────────── */}
        {tab === "queue" && (
          queueLoading ? (
            <View style={ss.center}>
              <ActivityIndicator color="#1565C0" />
            </View>
          ) : queueReports.length === 0 ? (
            <View style={ss.center}>
              <Ionicons name="checkmark-circle-outline" size={48} color={fgMuted} />
              <Text style={[ss.emptyTxt, { color: fgMuted }]}>Queue is empty</Text>
              <Text style={[ss.emptySubTxt, { color: fgMuted }]}>No flagged or pending reports right now.</Text>
            </View>
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={ss.listContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl refreshing={queueRefreshing} onRefresh={() => loadQueue(true)} tintColor="#1565C0" />
              }
            >
              <Text style={[ss.countTxt, { color: fgMuted }]}>
                {queueReports.length} item{queueReports.length !== 1 ? "s" : ""} need attention
              </Text>
              {queueReports.map((r) => (
                <ReportCard key={r.id} report={r} {...sharedCardProps} />
              ))}
            </ScrollView>
          )
        )}

        {/* ── All Reports tab ────────────────────────────────────────────────── */}
        {tab === "all" && (
          <View style={{ flex: 1 }}>
            {/* Status filter chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={ss.filterRow}
              style={[ss.filterBar, { borderBottomColor: divider }]}
            >
              {ALL_STATUS_FILTERS.map((s) => {
                const active = statusFilter === s;
                return (
                  <TouchableOpacity
                    key={s}
                    style={[ss.filterChip, { backgroundColor: active ? "#1565C0" : (isDark ? "#2C2C2E" : "#F0F0F0"), borderColor: active ? "#1565C0" : divider }]}
                    onPress={() => setStatusFilter(s)}
                  >
                    <Text style={[ss.filterChipTxt, { color: active ? "#FFF" : fgMuted }]}>
                      {STATUS_FILTER_LABELS[s] ?? s}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Type filter chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={ss.filterRow}
              style={[ss.filterBar, { borderBottomColor: divider }]}
            >
              {(["all", ...INCIDENT_TYPE_ORDER] as string[]).map((t) => {
                const active = typeFilter === t;
                const def    = t === "all" ? null : resolveIncidentType(t);
                return (
                  <TouchableOpacity
                    key={t}
                    style={[ss.filterChip, { backgroundColor: active ? "#1565C0" : (isDark ? "#2C2C2E" : "#F0F0F0"), borderColor: active ? "#1565C0" : divider }]}
                    onPress={() => setTypeFilter(t)}
                  >
                    <Text style={[ss.filterChipTxt, { color: active ? "#FFF" : fgMuted }]}>
                      {def ? `${def.emoji} ${def.label}` : "All Types"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* List */}
            {allLoading && allReports.length === 0 ? (
              <View style={ss.center}>
                <ActivityIndicator color="#1565C0" />
              </View>
            ) : allReports.length === 0 ? (
              <View style={ss.center}>
                <Ionicons name="search-outline" size={40} color={fgMuted} />
                <Text style={[ss.emptyTxt, { color: fgMuted }]}>No reports match your filters</Text>
              </View>
            ) : (
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={ss.listContent}
                showsVerticalScrollIndicator={false}
                refreshControl={
                  <RefreshControl
                    refreshing={allRefreshing}
                    onRefresh={() => loadAll(1, statusFilter, typeFilter, true)}
                    tintColor="#1565C0"
                  />
                }
              >
                <Text style={[ss.countTxt, { color: fgMuted }]}>
                  {allTotal.toLocaleString()} report{allTotal !== 1 ? "s" : ""}
                  {statusFilter !== "all" ? ` · ${STATUS_FILTER_LABELS[statusFilter] ?? statusFilter}` : ""}
                  {typeFilter   !== "all" ? ` · ${resolveIncidentType(typeFilter).label}` : ""}
                </Text>

                {allReports.map((r) => (
                  <ReportCard key={r.id} report={r} {...sharedCardProps} />
                ))}

                {allMore && (
                  <TouchableOpacity
                    style={[ss.loadMoreBtn, { borderColor: divider, backgroundColor: cardBg }]}
                    onPress={() => loadAll(allPage + 1)}
                    disabled={allLoading}
                  >
                    {allLoading
                      ? <ActivityIndicator color="#1565C0" size="small" />
                      : <Text style={[ss.loadMoreTxt, { color: "#1565C0" }]}>Load more</Text>}
                  </TouchableOpacity>
                )}
                <View style={{ height: 32 }} />
              </ScrollView>
            )}
          </View>
        )}

        {/* Inline edit sheet (stacked modal — supported on both iOS and Android) */}
        {editingReport && (
          <AdminReportEditSheet
            report={{
              id:        editingReport.id,
              type:      editingReport.type as CommunityReport["type"],
              lat:       editingReport.lat,
              lng:       editingReport.lng,
              timestamp: new Date(editingReport.createdAt).getTime(),
              confirmed: editingReport.confirmCount,
              roadName:  editingReport.roadName ?? undefined,
            }}
            visible
            onClose={() => setEditingReport(null)}
            onSave={handleEditSave}
          />
        )}
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ss = StyleSheet.create({
  root:          { flex: 1 },
  header:        { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 58, paddingBottom: 14, borderBottomWidth: 1 },
  adminChip:     { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, borderWidth: 1, marginBottom: 4 },
  adminChipTxt:  { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  headerTitle:   { fontSize: 22, fontFamily: "Inter_700Bold" },
  closeBtn:      { padding: 4, marginTop: 4 },

  // Tab bar
  tabBar:        { flexDirection: "row", gap: 8, padding: 12, paddingTop: 10, borderBottomWidth: 1 },
  tab:           { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: "transparent" },
  tabActive:     { shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 2, elevation: 2 },
  tabTxt:        { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  tabBadge:      { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  tabBadgeTxt:   { fontSize: 10, fontFamily: "Inter_700Bold", color: "#FFF" },

  // Filter chips
  filterBar:     { maxHeight: 46, borderBottomWidth: 1 },
  filterRow:     { flexDirection: "row", gap: 6, paddingHorizontal: 14, paddingVertical: 8 },
  filterChip:    { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1 },
  filterChipTxt: { fontSize: 12, fontFamily: "Inter_500Medium" },

  // List
  listContent:   { padding: 14, gap: 10 },
  center:        { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 32 },
  emptyTxt:      { fontSize: 16, fontFamily: "Inter_500Medium", textAlign: "center" },
  emptySubTxt:   { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  countTxt:      { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 4 },
  loadMoreBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 14, borderRadius: 14, borderWidth: 1, marginTop: 4 },
  loadMoreTxt:   { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
