/**
 * Accident Reports — full management screen
 * Lists all accident reports for the selected vehicle, grouped by month.
 * Supports Draft / Completed / Archived tabs, sorting, inline 3-dot menus,
 * PDF download/share, archive, delete, and creating new reports.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { format, isToday, isYesterday } from "date-fns";
import { Image } from "expo-image";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  API_BASE,
} from "@/utils/apiClient";
import {
  ensureVehicles,
  type SavedVehicle,
} from "@/utils/savedVehicles";
import { getCarImageUrl, getMakeById, getModelById } from "@/data/carModels";

// ── Types ─────────────────────────────────────────────────────────────────────

type ReportStatus = "draft" | "complete" | "archived";

interface AccidentRecord {
  id: string;
  status: ReportStatus;
  isManual: boolean;
  detectedAt: string;
  updatedAt: string | null;
  roadName?: string | null;
  county?: string | null;
  speedBeforeKmh?: string | null;
  directionLabel?: string | null;
  otherDriverJson?: string | null;
  hasPdf: boolean;
  photoCount: number;
  witnessCount: number;
}

type TabKey = "all" | "draft" | "complete" | "archived";
type SortKey = "newest" | "oldest";

// ── Helpers ───────────────────────────────────────────────────────────────────

function vehicleDisplayName(v: SavedVehicle): string {
  if (v.customMakeName) return `${v.customMakeName} ${v.customModelName ?? ""}`.trim();
  const make  = getMakeById(v.makeId ?? "");
  const model = getModelById(v.makeId ?? "", v.modelId ?? "");
  if (make && model) return `${make.name} ${model.name}`;
  if (make) return make.name;
  return "My Vehicle";
}

function deriveTitle(r: AccidentRecord): string {
  let typeLabel = r.isManual ? "Accident Report" : "Auto-Detected Incident";
  if (r.otherDriverJson) {
    try {
      const od = JSON.parse(r.otherDriverJson) as { type?: string };
      if (od.type === "solo")               typeLabel = "Single Vehicle Incident";
      else if (od.type === "pedestrian_cyclist") typeLabel = "Pedestrian/Cyclist Incident";
      else                                  typeLabel = "Vehicle Collision";
    } catch { /* ignore */ }
  }
  const loc = r.roadName ?? r.county;
  return loc ? `${typeLabel} – ${loc}` : typeLabel;
}

function statusLabel(status: ReportStatus): string {
  if (status === "draft")    return "Draft";
  if (status === "complete") return "Completed";
  return "Archived";
}

function statusColor(status: ReportStatus): string {
  if (status === "draft")    return "#FF9F0A";
  if (status === "complete") return "#34C759";
  return "#636366";
}

function statusIcon(status: ReportStatus): keyof typeof Ionicons.glyphMap {
  if (status === "draft")    return "document-text-outline";
  if (status === "complete") return "checkmark-circle-outline";
  return "archive-outline";
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d))     return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMMM yyyy");
}

function lastEditedLabel(r: AccidentRecord): string | null {
  const src = r.updatedAt ?? r.detectedAt;
  if (!src) return null;
  const d = new Date(src);
  if (isToday(d)) return `Last edited: Today, ${format(d, "h:mm a")}`;
  if (isYesterday(d)) return `Last edited: Yesterday, ${format(d, "h:mm a")}`;
  return `Last edited: ${format(d, "MMM d, yyyy")}`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AccidentReportsScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const {
    deviceId,
    vehicleType, vehicleMakeId, vehicleModelId,
    vehicleCustomMakeName, vehicleCustomModelName,
  } = useApp();

  // ── Vehicle selection ───────────────────────────────────────────────────────
  const [vehicles, setVehicles]           = useState<SavedVehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<SavedVehicle | null>(null);
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);

  // ── Report list ─────────────────────────────────────────────────────────────
  const [records, setRecords]   = useState<AccidentRecord[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [tab, setTab]       = useState<TabKey>("all");
  const [sort, setSort]     = useState<SortKey>("newest");
  const [menuRecord, setMenuRecord] = useState<AccidentRecord | null>(null);

  // ── Load vehicles ───────────────────────────────────────────────────────────
  useFocusEffect(useCallback(() => {
    (async () => {
      const list = await ensureVehicles({
        makeId: vehicleMakeId,
        modelId: vehicleModelId,
        customMakeName: vehicleCustomMakeName,
        customModelName: vehicleCustomModelName,
        vehicleType,
      });
      setVehicles(list);
      if (!selectedVehicle) {
        setSelectedVehicle(list.find(v => v.isDefault) ?? list[0] ?? null);
      }
    })();
  }, [vehicleMakeId, vehicleModelId, vehicleCustomMakeName, vehicleCustomModelName, vehicleType]));

  // ── Load records ─────────────────────────────────────────────────────────────
  const load = useCallback(async (showSpinner = true) => {
    if (!deviceId) return;
    if (showSpinner) setLoading(true);
    try {
      const data = await apiGet<{ records: AccidentRecord[] }>(
        `/accidents?deviceId=${deviceId}`
      );
      setRecords(data.records ?? []);
    } catch {
      // silently degrade
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [deviceId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Derived stats ─────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    all:      records.length,
    draft:    records.filter(r => r.status === "draft").length,
    complete: records.filter(r => r.status === "complete").length,
    archived: records.filter(r => r.status === "archived").length,
  }), [records]);

  // ── Filtered + sorted list ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = tab === "all" ? records : records.filter(r => r.status === (tab === "complete" ? "complete" : tab));
    if (sort === "oldest") list = [...list].reverse();
    return list;
  }, [records, tab, sort]);

  // ── Grouped sections ──────────────────────────────────────────────────────
  const sections = useMemo(() => {
    const map = new Map<string, AccidentRecord[]>();
    for (const r of filtered) {
      const key = dayLabel(r.detectedAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
  }, [filtered]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    if (!deviceId || creating) return;
    setCreating(true);
    try {
      const data = await apiPost<{ id: string }>("/accidents", {
        deviceId,
        isManual: true,
      });
      router.push(`/crash-assistant/${data.id}` as any);
    } catch {
      Alert.alert("Error", "Could not create a new report. Please try again.");
    } finally {
      setCreating(false);
    }
  }, [deviceId, creating]);

  const handleArchive = useCallback(async (r: AccidentRecord) => {
    if (!deviceId) return;
    try {
      await apiPatch(`/accidents/${r.id}`, { deviceId, status: "archived" });
      setRecords(prev =>
        prev.map(rec => rec.id === r.id ? { ...rec, status: "archived" } : rec)
      );
    } catch {
      Alert.alert("Error", "Could not archive this report.");
    }
  }, [deviceId]);

  const handleDelete = useCallback(async (r: AccidentRecord) => {
    Alert.alert(
      "Delete Report",
      "This will permanently delete the accident report and all its data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            if (!deviceId) return;
            try {
              await apiDelete(`/accidents/${r.id}?deviceId=${deviceId}`, {});
              setRecords(prev => prev.filter(rec => rec.id !== r.id));
            } catch {
              Alert.alert("Error", "Could not delete this report.");
            }
          },
        },
      ]
    );
  }, [deviceId]);

  const handleDownloadPdf = useCallback(async (r: AccidentRecord) => {
    if (!deviceId) return;
    try {
      const url = `${API_BASE}/accidents/${r.id}/report?deviceId=${deviceId}`;
      await Linking.openURL(url);
    } catch {
      Alert.alert("Error", "Could not open the PDF report.");
    }
  }, [deviceId]);

  const handleSharePdf = useCallback(async (r: AccidentRecord) => {
    if (!deviceId) return;
    try {
      const url = `${API_BASE}/accidents/${r.id}/report?deviceId=${deviceId}`;
      await Share.share({ title: `Accident Report – ${deriveTitle(r)}`, url });
    } catch { /* dismissed */ }
  }, [deviceId]);

  const handleMenu = useCallback((r: AccidentRecord) => {
    const isDraft    = r.status === "draft";
    const isComplete = r.status === "complete";
    const isArchived = r.status === "archived";

    const options: string[] = [];
    const actions: (() => void)[] = [];

    if (isDraft) {
      options.push("Continue Draft");
      actions.push(() => router.push(`/crash-assistant/${r.id}` as any));
    } else {
      options.push("View Report");
      actions.push(() => router.push(`/crash-assistant/${r.id}` as any));
    }

    if (isComplete || r.hasPdf) {
      options.push("Download PDF");
      actions.push(() => handleDownloadPdf(r));
      options.push("Share PDF");
      actions.push(() => handleSharePdf(r));
    }

    if (!isArchived) {
      options.push("Archive");
      actions.push(() => handleArchive(r));
    }

    options.push("Delete Report");
    actions.push(() => handleDelete(r));
    options.push("Cancel");

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          destructiveButtonIndex: options.indexOf("Delete Report"),
          cancelButtonIndex: options.length - 1,
        },
        (idx) => { actions[idx]?.(); }
      );
    } else {
      setMenuRecord(r);
    }
  }, [handleDownloadPdf, handleSharePdf, handleArchive, handleDelete]);

  // ── Vehicle image ─────────────────────────────────────────────────────────
  function getVehicleImage(v: SavedVehicle): string | null {
    const makeId  = v.makeId ?? "";
    const modelId = v.modelId ?? "";
    const model   = getModelById(makeId, modelId);
    if (model) return getCarImageUrl(makeId, model.id);
    const models  = getMakeById(makeId)?.models;
    const fallback = models?.[0];
    if (fallback) return getCarImageUrl(makeId, fallback.id);
    return null;
  }

  const s = makeStyles(colors, insets);

  // ── Bottom quick-action bar ───────────────────────────────────────────────
  function BottomBar() {
    const btns = [
      {
        icon: "download-outline" as const,
        label: "Download\nGuide",
        onPress: async () => {
          try {
            const dest = `${FileSystem.cacheDirectory}msafiri-accident-guide.pdf`;
            const dl = await FileSystem.downloadAsync(`${API_BASE}/accident-guide`, dest);
            if (dl.status !== 200) { Alert.alert("Error", "Could not download guide."); return; }
            const canShare = await Sharing.isAvailableAsync();
            if (canShare) {
              await Sharing.shareAsync(dest, { mimeType: "application/pdf", dialogTitle: "Msafiri Accident Guide", UTI: "com.adobe.pdf" });
            } else {
              await Linking.openURL(`${API_BASE}/accident-guide`);
            }
          } catch { Alert.alert("Error", "Could not download the guide. Check your connection."); }
        },
      },
      {
        icon: "share-social-outline" as const,
        label: "Share\nGuide",
        onPress: async () => {
          try {
            const dest = `${FileSystem.cacheDirectory}msafiri-accident-guide.pdf`;
            const dl = await FileSystem.downloadAsync(`${API_BASE}/accident-guide`, dest);
            if (dl.status !== 200) { Alert.alert("Error", "Could not load guide."); return; }
            await Sharing.shareAsync(dest, { mimeType: "application/pdf", dialogTitle: "Share Accident Guide", UTI: "com.adobe.pdf" });
          } catch { Alert.alert("Error", "Could not share the guide."); }
        },
      },
      { icon: "information-circle-outline" as const, label: "Report\nGuide", onPress: () => Alert.alert("Report Guide", "When involved in an accident:\n\n1. Stop safely\n2. Check for injuries\n3. Call 999 if needed\n4. Document the scene\n5. Exchange information\n6. File an OB number\n7. Notify your insurer within 24 hours") },
      { icon: "call-outline" as const, label: "Emergency\nContacts", onPress: () => Alert.alert("Emergency Contacts", "Police: 999\nAmbulance: 999\nAA Kenya Rescue: 0709 933 000") },
    ];
    return (
      <View style={s.bottomBar}>
        {btns.map((b, i) => (
          <TouchableOpacity key={i} style={s.bottomBtn} onPress={b.onPress} activeOpacity={0.7}>
            <Ionicons name={b.icon} size={22} color={i === 3 ? "#FF453A" : colors.primary} />
            <Text style={[s.bottomBtnLabel, { color: i === 3 ? "#FF453A" : colors.mutedForeground }]}>{b.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  // ── Android menu modal ────────────────────────────────────────────────────
  function AndroidMenuModal() {
    if (!menuRecord) return null;
    const r = menuRecord;
    const isDraft    = r.status === "draft";
    const isArchived = r.status === "archived";
    const items: { label: string; icon: keyof typeof Ionicons.glyphMap; color?: string; action: () => void }[] = [];
    items.push({
      label: isDraft ? "Continue Draft" : "View Report",
      icon: isDraft ? "create-outline" : "eye-outline",
      action: () => { setMenuRecord(null); router.push(`/crash-assistant/${r.id}` as any); },
    });
    if (r.hasPdf) {
      items.push({ label: "Download PDF", icon: "download-outline", action: () => { setMenuRecord(null); handleDownloadPdf(r); } });
      items.push({ label: "Share PDF", icon: "share-social-outline", action: () => { setMenuRecord(null); handleSharePdf(r); } });
    }
    if (!isArchived) {
      items.push({ label: "Archive", icon: "archive-outline", action: () => { setMenuRecord(null); handleArchive(r); } });
    }
    items.push({ label: "Delete Report", icon: "trash-outline", color: "#FF453A", action: () => { setMenuRecord(null); handleDelete(r); } });

    return (
      <Modal transparent animationType="fade" visible onRequestClose={() => setMenuRecord(null)}>
        <Pressable style={s.modalOverlay} onPress={() => setMenuRecord(null)}>
          <View style={[s.menuSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[s.menuTitle, { color: colors.text }]} numberOfLines={2}>{deriveTitle(r)}</Text>
            {items.map((it, i) => (
              <TouchableOpacity key={i} style={s.menuItem} onPress={it.action} activeOpacity={0.7}>
                <Ionicons name={it.icon} size={20} color={it.color ?? colors.text} />
                <Text style={[s.menuItemLabel, { color: it.color ?? colors.text }]}>{it.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    );
  }

  // ── Render record item ─────────────────────────────────────────────────────
  function RecordItem({ item }: { item: AccidentRecord }) {
    const sc = statusColor(item.status);
    const title = deriveTitle(item);
    const dateStr = format(new Date(item.detectedAt), "MMM d, yyyy · h:mm a");
    const edited = item.status === "draft" ? lastEditedLabel(item) : null;
    const completedStr = item.status === "complete"
      ? `Completed: ${format(new Date(item.updatedAt ?? item.detectedAt), "MMM d, yyyy")}`
      : item.status === "archived"
      ? `Archived: ${format(new Date(item.updatedAt ?? item.detectedAt), "MMM d, yyyy")}`
      : null;

    return (
      <TouchableOpacity
        style={[s.recordRow, { borderColor: colors.border }]}
        onPress={() => router.push(`/crash-assistant/${item.id}` as any)}
        activeOpacity={0.75}
      >
        {/* Icon */}
        <View style={[s.recordIcon, { backgroundColor: sc + "18" }]}>
          <Ionicons name={statusIcon(item.status)} size={22} color={sc} />
        </View>

        {/* Content */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.recordTitle, { color: colors.text }]} numberOfLines={1}>{title}</Text>
          <Text style={[s.recordDate, { color: colors.mutedForeground }]}>{dateStr}</Text>
          {edited ? (
            <Text style={[s.recordEdited, { color: "#FF9F0A" }]}>{edited}</Text>
          ) : completedStr ? (
            <Text style={[s.recordEdited, { color: colors.mutedForeground }]}>{completedStr}</Text>
          ) : null}
        </View>

        {/* Status + menu */}
        <View style={s.recordRight}>
          <View style={[s.statusPill, { backgroundColor: sc + "20" }]}>
            <Text style={[s.statusPillText, { color: sc }]}>{statusLabel(item.status)}</Text>
          </View>
          <TouchableOpacity onPress={() => handleMenu(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={s.menuBtn}>
            <Ionicons name="ellipsis-vertical" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  function EmptyState() {
    return (
      <View style={s.emptyWrap}>
        <View style={[s.emptyIcon, { backgroundColor: colors.muted + "18" }]}>
          <Ionicons name="shield-checkmark-outline" size={48} color={colors.mutedForeground} />
        </View>
        <Text style={[s.emptyTitle, { color: colors.text }]}>
          {tab === "all" ? "No accident reports" : `No ${statusLabel(tab as ReportStatus)} reports`}
        </Text>
        <Text style={[s.emptySubtitle, { color: colors.mutedForeground }]}>
          {tab === "all"
            ? "Reports are created automatically when an accident is detected, or you can start one manually."
            : `You have no reports with ${statusLabel(tab as ReportStatus).toLowerCase()} status.`}
        </Text>
        {tab === "all" && (
          <TouchableOpacity style={[s.createBtn, { backgroundColor: colors.primary }]} onPress={handleCreate} activeOpacity={0.8}>
            {creating ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="add-circle-outline" size={18} color="#fff" />}
            <Text style={s.createBtnText}>Create New Report</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={[s.container, { backgroundColor: colors.background }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.headerBack}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[s.headerTitle, { color: colors.text }]}>Accident Reports</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={["top"]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerBack}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[s.headerTitle, { color: colors.text }]}>Accident Reports</Text>
          <Text style={[s.headerSub, { color: colors.mutedForeground }]}>Create, manage and share your accident reports.</Text>
        </View>
        <TouchableOpacity
          onPress={() => Alert.alert("Settings", "Accident report settings are available in the main Settings screen.")}
          style={s.headerGear}
        >
          <Ionicons name="settings-outline" size={22} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={sections}
        keyExtractor={s => s.label}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(false); }} tintColor={colors.primary} />
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        ListHeaderComponent={
          <>
            {/* Vehicle selector */}
            <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
              <Text style={[s.sectionLabel, { color: colors.mutedForeground }]}>Select Vehicle</Text>
            </View>
            <TouchableOpacity
              style={[s.vehicleCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => vehicles.length > 1 && setShowVehiclePicker(true)}
              activeOpacity={vehicles.length > 1 ? 0.75 : 1}
            >
              {selectedVehicle && (() => {
                const img = getVehicleImage(selectedVehicle);
                return img
                  ? <Image source={{ uri: img }} style={s.vehicleImg} contentFit="contain" />
                  : <View style={[s.vehicleImgPlaceholder, { backgroundColor: colors.muted + "20" }]}>
                      <Ionicons name="car-outline" size={28} color={colors.mutedForeground} />
                    </View>;
              })()}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={[s.vehicleName, { color: colors.text }]}>
                    {selectedVehicle ? vehicleDisplayName(selectedVehicle) : "No Vehicle"}
                  </Text>
                  {selectedVehicle?.isDefault && (
                    <View style={[s.primaryBadge, { backgroundColor: colors.primary + "20" }]}>
                      <Text style={[s.primaryBadgeText, { color: colors.primary }]}>Primary</Text>
                    </View>
                  )}
                </View>
                {selectedVehicle?.odometerKm != null && (
                  <Text style={[s.vehicleMeta, { color: colors.mutedForeground }]}>
                    {selectedVehicle.odometerKm.toLocaleString()} km
                  </Text>
                )}
              </View>
              {vehicles.length > 1 && (
                <Ionicons name="chevron-down" size={20} color={colors.mutedForeground} />
              )}
            </TouchableOpacity>

            {/* Stats strip */}
            <View style={[s.statsStrip, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {[
                { icon: "document-text-outline" as const, count: stats.all,      label: "All Reports", color: colors.primary },
                { icon: "create-outline"         as const, count: stats.draft,    label: "Drafts",      color: "#FF9F0A" },
                { icon: "checkmark-circle-outline" as const, count: stats.complete, label: "Completed",   color: "#34C759" },
                { icon: "archive-outline"        as const, count: stats.archived, label: "Archived",    color: "#636366" },
              ].map((st, i) => (
                <TouchableOpacity
                  key={i}
                  style={s.statItem}
                  onPress={() => setTab(i === 0 ? "all" : i === 1 ? "draft" : i === 2 ? "complete" : "archived")}
                  activeOpacity={0.7}
                >
                  <View style={[s.statIconWrap, { backgroundColor: st.color + "18" }]}>
                    <Ionicons name={st.icon} size={20} color={st.color} />
                  </View>
                  <Text style={[s.statCount, { color: colors.text }]}>{st.count}</Text>
                  <Text style={[s.statLabel, { color: colors.mutedForeground }]}>{st.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Create new report */}
            <TouchableOpacity
              style={[s.createCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={handleCreate}
              activeOpacity={0.8}
            >
              <View style={[s.createIconWrap, { backgroundColor: colors.primary }]}>
                {creating
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Ionicons name="add" size={22} color="#fff" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.createTitle, { color: colors.text }]}>Create New Report</Text>
                <Text style={[s.createSub, { color: colors.mutedForeground }]}>Start a new accident report</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.primary} />
            </TouchableOpacity>

            {/* Tabs */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
              {(["all", "draft", "complete", "archived"] as TabKey[]).map(t => {
                const active = tab === t;
                const label  = t === "all" ? "All" : t === "draft" ? "Drafts" : t === "complete" ? "Completed" : "Archived";
                return (
                  <TouchableOpacity
                    key={t}
                    style={[s.tab, active && { backgroundColor: colors.primary }]}
                    onPress={() => setTab(t)}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.tabText, { color: active ? "#fff" : colors.mutedForeground }]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Sort row */}
            {filtered.length > 0 && (
              <View style={s.sortRow}>
                <TouchableOpacity
                  style={[s.sortChip, { borderColor: colors.border }]}
                  onPress={() => setSort(p => p === "newest" ? "oldest" : "newest")}
                  activeOpacity={0.7}
                >
                  <Text style={[s.sortChipText, { color: colors.text }]}>Sort: {sort === "newest" ? "Newest" : "Oldest"}</Text>
                  <Ionicons name="chevron-down" size={14} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
            )}
          </>
        }
        renderItem={({ item: section }) => (
          <View style={{ marginBottom: 8 }}>
            <Text style={[s.groupLabel, { color: colors.mutedForeground }]}>{section.label}</Text>
            <View style={[s.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {section.items.map((rec, idx) => (
                <View key={rec.id}>
                  <RecordItem item={rec} />
                  {idx < section.items.length - 1 && (
                    <View style={[s.divider, { backgroundColor: colors.border }]} />
                  )}
                </View>
              ))}
            </View>
          </View>
        )}
        ListEmptyComponent={filtered.length === 0 && !loading ? <EmptyState /> : null}
      />

      {/* Bottom bar */}
      <View style={[s.bottomBarWrap, { borderTopColor: colors.border, paddingBottom: insets.bottom || 12 }]}>
        <BottomBar />
      </View>

      {/* Vehicle picker modal */}
      <Modal visible={showVehiclePicker} transparent animationType="slide" onRequestClose={() => setShowVehiclePicker(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowVehiclePicker(false)}>
          <Pressable style={[s.vehicleSheet, { backgroundColor: colors.card }]}>
            <View style={s.sheetHandle} />
            <Text style={[s.sheetTitle, { color: colors.text }]}>Select Vehicle</Text>
            {vehicles.map(v => {
              const active = v.id === selectedVehicle?.id;
              return (
                <TouchableOpacity
                  key={v.id}
                  style={[s.vehiclePickerRow, { borderColor: colors.border }, active && { borderColor: colors.primary, backgroundColor: colors.primary + "10" }]}
                  onPress={() => { setSelectedVehicle(v); setShowVehiclePicker(false); }}
                  activeOpacity={0.75}
                >
                  <Ionicons name="car-outline" size={22} color={active ? colors.primary : colors.mutedForeground} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.vehiclePickerName, { color: colors.text }]}>{vehicleDisplayName(v)}</Text>
                    {v.isDefault && <Text style={[s.vehiclePickerSub, { color: colors.primary }]}>Primary Vehicle</Text>}
                  </View>
                  {active && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Android 3-dot menu */}
      {Platform.OS !== "ios" && <AndroidMenuModal />}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useColors>, insets: { bottom: number }) {
  return StyleSheet.create({
    container:        { flex: 1 },
    header:           { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
    headerBack:       { width: 36, height: 36, alignItems: "center", justifyContent: "center", marginTop: 2 },
    headerTitle:      { fontSize: 20, fontFamily: "Inter_700Bold" },
    headerSub:        { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
    headerGear:       { width: 36, height: 36, alignItems: "center", justifyContent: "center", marginTop: 2 },

    sectionLabel:     { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },

    vehicleCard:      { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 16, borderWidth: 1 },
    vehicleImg:       { width: 60, height: 40, borderRadius: 8 },
    vehicleImgPlaceholder: { width: 60, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center" },
    vehicleName:      { fontSize: 15, fontFamily: "Inter_600SemiBold" },
    vehicleMeta:      { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
    primaryBadge:     { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
    primaryBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },

    statsStrip:       { flexDirection: "row", marginHorizontal: 16, marginBottom: 12, borderRadius: 16, borderWidth: 1, overflow: "hidden" },
    statItem:         { flex: 1, alignItems: "center", paddingVertical: 14, gap: 4 },
    statIconWrap:     { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 2 },
    statCount:        { fontSize: 18, fontFamily: "Inter_700Bold" },
    statLabel:        { fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "center" },

    createCard:       { flexDirection: "row", alignItems: "center", gap: 14, marginHorizontal: 16, marginBottom: 16, padding: 16, borderRadius: 16, borderWidth: 1 },
    createIconWrap:   { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    createTitle:      { fontSize: 15, fontFamily: "Inter_600SemiBold" },
    createSub:        { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

    tab:              { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: "transparent", borderWidth: 1, borderColor: "transparent" },
    tabText:          { fontSize: 14, fontFamily: "Inter_500Medium" },

    sortRow:          { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, marginBottom: 12 },
    sortChip:         { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
    sortChipText:     { fontSize: 13, fontFamily: "Inter_500Medium" },

    groupLabel:       { fontSize: 12, fontFamily: "Inter_500Medium", paddingHorizontal: 16, marginBottom: 6, marginTop: 4 },
    groupCard:        { marginHorizontal: 16, borderRadius: 16, borderWidth: 1, overflow: "hidden" },

    recordRow:        { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderBottomWidth: 0 },
    recordIcon:       { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    recordTitle:      { fontSize: 14, fontFamily: "Inter_600SemiBold" },
    recordDate:       { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
    recordEdited:     { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 3 },
    recordRight:      { alignItems: "flex-end", gap: 8 },
    statusPill:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    statusPillText:   { fontSize: 11, fontFamily: "Inter_600SemiBold" },
    menuBtn:          { padding: 4 },

    divider:          { height: StyleSheet.hairlineWidth, marginLeft: 70 },

    emptyWrap:        { alignItems: "center", padding: 40, paddingTop: 60 },
    emptyIcon:        { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center", marginBottom: 16 },
    emptyTitle:       { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center", marginBottom: 8 },
    emptySubtitle:    { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22, marginBottom: 28 },
    createBtn:        { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 14 },
    createBtnText:    { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },

    bottomBarWrap:    { position: "absolute", bottom: 0, left: 0, right: 0, borderTopWidth: StyleSheet.hairlineWidth, backgroundColor: "transparent" },
    bottomBar:        { flexDirection: "row", paddingTop: 12, paddingHorizontal: 8 },
    bottomBtn:        { flex: 1, alignItems: "center", gap: 4 },
    bottomBtnLabel:   { fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "center" },

    modalOverlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    menuSheet:        { borderRadius: 20, margin: 12, padding: 16, borderWidth: 1 },
    menuTitle:        { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
    menuItem:         { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 13 },
    menuItemLabel:    { fontSize: 15, fontFamily: "Inter_400Regular" },

    vehicleSheet:     { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
    sheetHandle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: "#636366", alignSelf: "center", marginBottom: 16 },
    sheetTitle:       { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 16 },
    vehiclePickerRow: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 8 },
    vehiclePickerName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
    vehiclePickerSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  });
}
