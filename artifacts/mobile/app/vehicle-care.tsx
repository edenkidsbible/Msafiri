/**
 * Vehicle Care — Main dashboard screen.
 *
 * Shows the vehicle health score, upcoming/overdue maintenance, completed
 * items, and a category grid for logging service. All data lives in
 * AsyncStorage via utils/vehicleCare.ts.
 */

import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { getMakeById, getModelById } from "@/data/carModels";
import {
  loadVehicleCareData,
  saveVehicleCareData,
  addServiceRecord,
  updateServiceRecord,
  deleteServiceRecord,
  computeItemStatuses,
  computeVehicleCareStats,
  estimatedOdometerKm,
  MAINTENANCE_CATALOGUE,
  CATEGORIES,
  VehicleCareData,
  ServiceRecord,
  ReminderConfig,
} from "@/utils/vehicleCare";
import { loadVehicles, saveVehicles } from "@/utils/savedVehicles";
export { ErrorBoundary } from "@/components/ErrorBoundary";

// ── Circular health ring ──────────────────────────────────────────────────────

function HealthRing({ pct, size = 120, color, bg }: { pct: number; size?: number; color: string; bg: string }) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(1, pct / 100)) * circ;
  return (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={bg} strokeWidth={10} fill="none" />
      <Circle
        cx={size / 2} cy={size / 2} r={r}
        stroke={color} strokeWidth={10} fill="none"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        rotation="-90"
        origin={`${size / 2},${size / 2}`}
      />
    </Svg>
  );
}

// ── Status pill ───────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: "overdue" | "upcoming" | "ok" }) {
  const cfg = {
    overdue:  { label: "Overdue",  bg: "#E5484D20", color: "#E5484D" },
    upcoming: { label: "Upcoming", bg: "#FFB30020", color: "#FFB300" },
    ok:       { label: "Up to date", bg: "#22DD6620", color: "#22DD66" },
  }[status];
  return (
    <View style={{ backgroundColor: cfg.bg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 }}>
      <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: cfg.color }}>{cfg.label}</Text>
    </View>
  );
}

// ── Category icon map ─────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, { icon: string; color: string; bg: string }> = {
  "Engine":           { icon: "cog-outline",           color: "#F97316", bg: "#F9731620" },
  "Transmission":     { icon: "git-merge-outline",      color: "#A855F7", bg: "#A855F720" },
  "Brakes":           { icon: "warning-outline",        color: "#E5484D", bg: "#E5484D20" },
  "Tyres":            { icon: "radio-button-off-outline", color: "#3B82F6", bg: "#3B82F620" },
  "Suspension":       { icon: "layers-outline",         color: "#10B981", bg: "#10B98120" },
  "Battery":          { icon: "battery-charging-outline", color: "#F59E0B", bg: "#F59E0B20" },
  "Air Conditioning": { icon: "snow-outline",           color: "#06B6D4", bg: "#06B6D420" },
  "Miscellaneous":    { icon: "build-outline",          color: "#8B5CF6", bg: "#8B5CF620" },
};

// ── Log Service Modal ─────────────────────────────────────────────────────────

interface LogServiceModalProps {
  visible: boolean;
  item: ReminderConfig | null;
  currentOdometerKm: number;
  editRecord?: ServiceRecord | null;   // when provided → edit mode
  onClose: () => void;
  onSaved: () => void;
}

function LogServiceModal({ visible, item, currentOdometerKm, editRecord, onClose, onSaved }: LogServiceModalProps) {
  const c = useColors();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [mileage, setMileage] = useState(String(Math.round(currentOdometerKm)));
  const [cost, setCost] = useState("");
  const [garage, setGarage] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const cardBg   = c.isDark ? "#151917" : "#fff";
  const borderCol = c.isDark ? "#242B27" : "#E4EAE4";
  const isEditMode = !!editRecord;

  // Sync fields whenever the modal opens or edit target changes
  useEffect(() => {
    if (!visible) return;
    if (editRecord) {
      setDate(editRecord.date);
      setMileage(String(editRecord.mileageKm));
      setCost(editRecord.costKSh != null ? String(editRecord.costKSh) : "");
      setGarage(editRecord.garage ?? "");
      setNotes(editRecord.notes ?? "");
    } else {
      setDate(new Date().toISOString().slice(0, 10));
      setMileage(String(Math.round(currentOdometerKm)));
      setCost("");
      setGarage("");
      setNotes("");
    }
  }, [visible, editRecord]);

  async function handleSave() {
    if (!item) return;
    setSaving(true);
    try {
      if (isEditMode && editRecord) {
        await updateServiceRecord({
          ...editRecord,
          date,
          mileageKm: parseFloat(mileage) || currentOdometerKm,
          costKSh: cost ? parseFloat(cost) : undefined,
          garage: garage || undefined,
          notes: notes || undefined,
        });
      } else {
        const record: ServiceRecord = {
          id: Date.now().toString(),
          itemId: item.itemId,
          itemName: item.itemName,
          category: item.category,
          date,
          mileageKm: parseFloat(mileage) || currentOdometerKm,
          costKSh: cost ? parseFloat(cost) : undefined,
          garage: garage || undefined,
          notes: notes || undefined,
        };
        await addServiceRecord(record);
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const field = (label: string, val: string, set: (v: string) => void, opts?: { keyboardType?: "numeric"; placeholder?: string }) => (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: c.mutedForeground, marginBottom: 4 }}>{label}</Text>
      <TextInput
        value={val}
        onChangeText={set}
        style={{
          borderWidth: 1, borderColor: borderCol, borderRadius: 10,
          paddingHorizontal: 12, paddingVertical: 10,
          color: c.foreground, fontFamily: "Inter_400Regular", fontSize: 14,
          backgroundColor: c.isDark ? "#1A1F1C" : "#F8FAF8",
        }}
        placeholder={opts?.placeholder ?? ""}
        placeholderTextColor={c.mutedForeground}
        keyboardType={opts?.keyboardType}
      />
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable style={{ flex: 1, backgroundColor: "#00000080" }} onPress={onClose} />
        <View style={{ backgroundColor: cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
          {/* Drag handle */}
          <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 4 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: borderCol }} />
          </View>

          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, paddingTop: 12, marginBottom: 16 }}>
            <View>
              <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: c.foreground }}>Log Service</Text>
              {item && <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: c.mutedForeground, marginTop: 2 }}>{item.itemName}</Text>}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={24} color={c.foreground} />
            </TouchableOpacity>
          </View>

          {/* Scrollable fields — grows up to 75% of the screen */}
          <ScrollView
            style={{ maxHeight: 420 }}
            contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 8 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {field("Date Completed", date, setDate, { placeholder: "YYYY-MM-DD" })}
            {field("Current Mileage (km)", mileage, setMileage, { keyboardType: "numeric", placeholder: "e.g. 45000" })}
            {field("Cost (KSh)", cost, setCost, { keyboardType: "numeric", placeholder: "Optional" })}
            {field("Garage / Workshop", garage, setGarage, { placeholder: "Optional" })}
            {field("Notes", notes, setNotes, { placeholder: "Optional" })}
          </ScrollView>

          {/* Save button — always visible above keyboard */}
          <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 32 }}>
            <TouchableOpacity
              style={{ backgroundColor: c.primary, borderRadius: 14, paddingVertical: 15, alignItems: "center" }}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" }}>
                {saving ? "Saving…" : isEditMode ? "Save Changes" : "Save Service Record"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Update Odometer Modal ─────────────────────────────────────────────────────

interface UpdateOdometerModalProps {
  visible: boolean;
  currentKm: number;
  onClose: () => void;
  onSaved: () => void;
}

function UpdateOdometerModal({ visible, currentKm, onClose, onSaved }: UpdateOdometerModalProps) {
  const c = useColors();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const cardBg    = c.isDark ? "#151917" : "#fff";
  const borderCol = c.isDark ? "#242B27" : "#E4EAE4";

  useEffect(() => {
    if (visible) setValue(currentKm > 0 ? String(Math.round(currentKm)) : "");
  }, [visible, currentKm]);

  async function handleSave() {
    const km = parseFloat(value.replace(/,/g, ""));
    if (isNaN(km) || km < 0) {
      Alert.alert("Invalid Value", "Please enter a valid odometer reading.");
      return;
    }
    setSaving(true);
    try {
      // Update vehicle care data — new reading resets trip accumulation
      const data = await loadVehicleCareData();
      data.initialOdometerKm  = km;
      data.tripAccumulatedKm  = 0;
      await saveVehicleCareData(data);

      // Also update the default saved vehicle so the garage slide reflects it
      const vehicles = await loadVehicles();
      if (vehicles.length > 0) {
        const updated = vehicles.map((v, i) => i === 0 ? { ...v, odometerKm: km } : v);
        await saveVehicles(updated);
      }

      onSaved();
      onClose();
    } catch {
      Alert.alert("Error", "Could not save odometer reading. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable style={{ flex: 1, backgroundColor: "#00000080" }} onPress={onClose} />
        <View style={{ backgroundColor: cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
          {/* Drag handle */}
          <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 4 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: borderCol }} />
          </View>

          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, paddingTop: 12, marginBottom: 20 }}>
            <View>
              <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: c.foreground }}>Update Odometer</Text>
              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: c.mutedForeground, marginTop: 2 }}>
                Current: {currentKm > 0 ? `${Math.round(currentKm).toLocaleString()} km` : "Not set"}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={24} color={c.foreground} />
            </TouchableOpacity>
          </View>

          <View style={{ paddingHorizontal: 24, paddingBottom: 32 }}>
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: c.mutedForeground, marginBottom: 6 }}>
              New Odometer Reading (km)
            </Text>
            <TextInput
              value={value}
              onChangeText={setValue}
              keyboardType="numeric"
              placeholder="e.g. 87500"
              placeholderTextColor={c.mutedForeground}
              style={{
                borderWidth: 1, borderColor: borderCol, borderRadius: 12,
                paddingHorizontal: 14, paddingVertical: 13,
                color: c.foreground, fontFamily: "Inter_400Regular", fontSize: 16,
                backgroundColor: c.isDark ? "#1A1F1C" : "#F8FAF8",
                marginBottom: 18,
              }}
              autoFocus
            />
            <TouchableOpacity
              style={{ backgroundColor: c.primary, borderRadius: 14, paddingVertical: 15, alignItems: "center" }}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" }}>
                {saving ? "Saving…" : "Update Odometer"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function VehicleCareScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { vehicleMakeId, vehicleModelId, vehicleCustomMakeName, vehicleCustomModelName, vehicleType } = useApp();

  const [data, setData] = useState<VehicleCareData | null>(null);
  const [tab, setTab] = useState<"overview" | "history" | "costs">("overview");
  const [logItem, setLogItem] = useState<ReminderConfig | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [editRecord, setEditRecord] = useState<ServiceRecord | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [showOdoModal, setShowOdoModal] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        let d = await loadVehicleCareData();
        // Seed initialOdometerKm from the saved vehicle if not yet set
        if (d.initialOdometerKm === 0) {
          const vehicles = await loadVehicles();
          const def = vehicles.find(v => v.isDefault) ?? vehicles[0];
          if (def?.odometerKm && def.odometerKm > 0) {
            d = { ...d, initialOdometerKm: def.odometerKm };
            await saveVehicleCareData(d);
          }
        }
        if (alive) setData(d);
      })();
      return () => { alive = false; };
    }, [])
  );

  function reload() {
    loadVehicleCareData().then(setData);
  }

  function openLog(item: ReminderConfig) {
    setLogItem(item);
    setEditRecord(null);
    setShowLog(true);
  }

  function handleEditRecord(r: ServiceRecord) {
    const reminder = data?.reminders.find(rem => rem.itemId === r.itemId);
    if (reminder) {
      setLogItem(reminder);
      setEditRecord(r);
      setShowLog(true);
    }
  }

  function handleDeleteRecord(id: string) {
    Alert.alert(
      "Delete Record",
      "Remove this service record? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteServiceRecord(id);
            setEditRecord(null);
            reload();
          },
        },
      ]
    );
  }

  const selectedMake  = vehicleMakeId ? getMakeById(vehicleMakeId) : null;
  const selectedModel = (vehicleMakeId && vehicleModelId) ? getModelById(vehicleMakeId, vehicleModelId) : null;
  const vehicleDisplayName =
    selectedMake && selectedModel ? `${selectedMake.name} ${selectedModel.name}`
    : vehicleCustomMakeName && vehicleCustomModelName ? `${vehicleCustomMakeName} ${vehicleCustomModelName}`
    : "My Vehicle";

  const cardBg    = c.isDark ? "#151917" : c.card;
  const borderCol = c.isDark ? "#242B27" : c.tileBorder;
  const subText   = c.mutedForeground;

  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular" }}>Loading…</Text>
      </View>
    );
  }

  const stats     = computeVehicleCareStats(data);
  const statuses  = computeItemStatuses(data);
  const odometer  = estimatedOdometerKm(data);

  const healthColor =
    stats.healthScore >= 90 ? c.primary
    : stats.healthScore >= 75 ? c.primary
    : stats.healthScore >= 50 ? "#FFB300"
    : "#E5484D";
  const healthRingBg = c.isDark ? "#1E2820" : "#E8F5EE";

  const overdue  = statuses.filter(s => s.status === "overdue");
  const upcoming = statuses.filter(s => s.status === "upcoming");
  const ok       = statuses.filter(s => s.status === "ok" && s.lastRecord);

  // Category filtering
  const categoryItems = activeCategory
    ? statuses.filter(s => s.reminder.category === activeCategory)
    : null;

  // History sorted by date
  const historyRecords = [...data.records].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Cost by category (last 12 months)
  const now12 = new Date(); now12.setMonth(now12.getMonth() - 12);
  const costByCat: Record<string, number> = {};
  data.records
    .filter(r => new Date(r.date) >= now12 && r.costKSh)
    .forEach(r => {
      costByCat[r.category] = (costByCat[r.category] ?? 0) + (r.costKSh ?? 0);
    });
  const totalCost = Object.values(costByCat).reduce((a, b) => a + b, 0);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {/* Header */}
      <LinearGradient
        colors={c.isDark ? ["#0D1F14", "#0B0D0C"] : ["#E8F5EE", "#F4F6F4"]}
        style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 16 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c.isDark ? "#1A2820" : "#fff", alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="arrow-back" size={20} color={c.foreground} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 22, fontFamily: "Inter_700Bold", color: c.foreground }}>Vehicle Care</Text>
            <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: subText, marginTop: 2 }}>{vehicleDisplayName}</Text>
          </View>
          <TouchableOpacity
            style={{ backgroundColor: c.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 }}
            onPress={() => setShowOdoModal(true)}
          >
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Update Odometer</Text>
          </TouchableOpacity>
        </View>

        {/* Health ring + odometer */}
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 20, gap: 20 }}>
          <View style={{ alignItems: "center", justifyContent: "center" }}>
            <HealthRing pct={stats.healthScore} color={healthColor} bg={healthRingBg} />
            <View style={{ position: "absolute", alignItems: "center" }}>
              <Text style={{ fontSize: 22, fontFamily: "Inter_700Bold", color: c.foreground }}>{stats.healthScore}%</Text>
              <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: subText }}>Health</Text>
            </View>
          </View>

          <View style={{ flex: 1, gap: 10 }}>
            <View style={[styles.infoRow, { backgroundColor: c.isDark ? "#1A2820" : "#fff", borderColor: borderCol }]}>
              <Ionicons name="speedometer-outline" size={16} color={c.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: c.foreground }}>
                  {odometer > 0 ? `${odometer.toLocaleString(undefined, { maximumFractionDigits: 0 })} km` : "Not set"}
                </Text>
                <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: subText }}>Estimated Odometer</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={[styles.miniStat, { backgroundColor: "#E5484D15", flex: 1 }]}>
                <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: stats.overdue > 0 ? "#E5484D" : c.foreground }}>{stats.overdue}</Text>
                <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: stats.overdue > 0 ? "#E5484D" : subText }}>Overdue</Text>
              </View>
              <View style={[styles.miniStat, { backgroundColor: "#FFB30015", flex: 1 }]}>
                <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFB300" }}>{stats.upcoming30Days}</Text>
                <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: "#FFB300" }}>Upcoming</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Health label */}
        <View style={[styles.healthBadge, { backgroundColor: healthColor + "20", alignSelf: "flex-start", marginTop: 8 }]}>
          <Ionicons name="checkmark-circle" size={14} color={healthColor} />
          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: healthColor }}>{stats.healthLabel}</Text>
        </View>
      </LinearGradient>

      {/* Tab bar */}
      <View style={[styles.tabBar, { backgroundColor: cardBg, borderBottomColor: borderCol }]}>
        {(["overview", "history", "costs"] as const).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tabBtn, tab === t && { borderBottomColor: c.primary, borderBottomWidth: 2 }]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabBtnTxt, { color: tab === t ? c.primary : subText }]}>
              {t === "overview" ? "Overview" : t === "history" ? "History" : "Costs"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── OVERVIEW ── */}
        {tab === "overview" && !activeCategory && (
          <>
            {/* Overdue */}
            {overdue.length > 0 && (
              <View style={{ marginBottom: 16 }}>
                <Text style={[styles.groupTitle, { color: "#E5484D" }]}>⚠ Overdue</Text>
                <View style={{ gap: 8 }}>
                  {overdue.map(s => (
                    <View
                      key={s.reminder.itemId}
                      style={[styles.itemCard, { backgroundColor: cardBg, borderColor: "#E5484D40", flexDirection: "column", alignItems: "stretch" }]}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <View style={[styles.itemIconWrap, { backgroundColor: CATEGORY_ICONS[s.reminder.category]?.bg ?? "#88888820" }]}>
                          <Ionicons name={(CATEGORY_ICONS[s.reminder.category]?.icon ?? "build-outline") as any} size={18} color={CATEGORY_ICONS[s.reminder.category]?.color ?? "#888"} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[styles.itemName, { color: c.foreground }]}>{s.reminder.itemName}</Text>
                          <Text style={[styles.itemSub, { color: "#E5484D" }]}>
                            {s.kmRemaining !== null && s.kmRemaining < 0 ? `${Math.abs(Math.round(s.kmRemaining)).toLocaleString()} km overdue` : ""}
                            {s.daysRemaining !== null && s.daysRemaining < 0 ? (s.kmRemaining !== null ? " · " : "") + `${Math.abs(s.daysRemaining)}d overdue` : ""}
                          </Text>
                        </View>
                        <StatusPill status="overdue" />
                      </View>
                      {/* Action row */}
                      <View style={[styles.recordActions, { borderTopColor: borderCol }]}>
                        <TouchableOpacity style={styles.recordActionBtn} onPress={() => openLog(s.reminder)}>
                          <Ionicons name="add-circle-outline" size={14} color={c.primary} />
                          <Text style={[styles.recordActionTxt, { color: c.primary }]}>Log Service</Text>
                        </TouchableOpacity>
                        {s.lastRecord && (
                          <>
                            <View style={styles.recordActionDiv} />
                            <TouchableOpacity style={styles.recordActionBtn} onPress={() => handleEditRecord(s.lastRecord!)}>
                              <Ionicons name="pencil-outline" size={14} color={c.mutedForeground} />
                              <Text style={[styles.recordActionTxt, { color: c.mutedForeground }]}>Edit last</Text>
                            </TouchableOpacity>
                            <View style={styles.recordActionDiv} />
                            <TouchableOpacity style={styles.recordActionBtn} onPress={() => handleDeleteRecord(s.lastRecord!.id)}>
                              <Ionicons name="trash-outline" size={14} color="#E5484D" />
                              <Text style={[styles.recordActionTxt, { color: "#E5484D" }]}>Delete last</Text>
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Upcoming */}
            {upcoming.length > 0 && (
              <View style={{ marginBottom: 16 }}>
                <Text style={[styles.groupTitle, { color: "#FFB300" }]}>🔔 Upcoming</Text>
                <View style={{ gap: 8 }}>
                  {upcoming.map(s => (
                    <View
                      key={s.reminder.itemId}
                      style={[styles.itemCard, { backgroundColor: cardBg, borderColor: "#FFB30030", flexDirection: "column", alignItems: "stretch" }]}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <View style={[styles.itemIconWrap, { backgroundColor: CATEGORY_ICONS[s.reminder.category]?.bg ?? "#88888820" }]}>
                          <Ionicons name={(CATEGORY_ICONS[s.reminder.category]?.icon ?? "build-outline") as any} size={18} color={CATEGORY_ICONS[s.reminder.category]?.color ?? "#888"} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[styles.itemName, { color: c.foreground }]}>{s.reminder.itemName}</Text>
                          <Text style={[styles.itemSub, { color: "#FFB300" }]}>
                            {s.kmRemaining !== null && s.kmRemaining >= 0 ? `${Math.round(s.kmRemaining).toLocaleString()} km remaining` : ""}
                            {s.daysRemaining !== null && s.daysRemaining >= 0 ? (s.kmRemaining !== null && s.kmRemaining >= 0 ? " · " : "") + `${s.daysRemaining}d remaining` : ""}
                          </Text>
                        </View>
                        <StatusPill status="upcoming" />
                      </View>
                      {/* Action row */}
                      <View style={[styles.recordActions, { borderTopColor: borderCol }]}>
                        <TouchableOpacity style={styles.recordActionBtn} onPress={() => openLog(s.reminder)}>
                          <Ionicons name="add-circle-outline" size={14} color={c.primary} />
                          <Text style={[styles.recordActionTxt, { color: c.primary }]}>Log Service</Text>
                        </TouchableOpacity>
                        {s.lastRecord && (
                          <>
                            <View style={styles.recordActionDiv} />
                            <TouchableOpacity style={styles.recordActionBtn} onPress={() => handleEditRecord(s.lastRecord!)}>
                              <Ionicons name="pencil-outline" size={14} color={c.mutedForeground} />
                              <Text style={[styles.recordActionTxt, { color: c.mutedForeground }]}>Edit last</Text>
                            </TouchableOpacity>
                            <View style={styles.recordActionDiv} />
                            <TouchableOpacity style={styles.recordActionBtn} onPress={() => handleDeleteRecord(s.lastRecord!.id)}>
                              <Ionicons name="trash-outline" size={14} color="#E5484D" />
                              <Text style={[styles.recordActionTxt, { color: "#E5484D" }]}>Delete last</Text>
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Categories */}
            <Text style={[styles.groupTitle, { color: c.foreground, marginBottom: 12 }]}>All Categories</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
              {CATEGORIES.map(cat => {
                const cfg = CATEGORY_ICONS[cat] ?? { icon: "build-outline", color: "#888", bg: "#88888820" };
                const catStatuses = statuses.filter(s => s.reminder.category === cat);
                const catOverdue  = catStatuses.filter(s => s.status === "overdue").length;
                const catUpcoming = catStatuses.filter(s => s.status === "upcoming").length;
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.categoryCard, { backgroundColor: cardBg, borderColor: catOverdue ? "#E5484D40" : catUpcoming ? "#FFB30030" : borderCol }]}
                    onPress={() => setActiveCategory(cat)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.catIcon, { backgroundColor: cfg.bg }]}>
                      <Ionicons name={cfg.icon as any} size={20} color={cfg.color} />
                    </View>
                    <Text style={[styles.catLabel, { color: c.foreground }]} numberOfLines={2}>{cat}</Text>
                    {catOverdue > 0 && (
                      <View style={[styles.catBadge, { backgroundColor: "#E5484D" }]}>
                        <Text style={styles.catBadgeTxt}>{catOverdue}</Text>
                      </View>
                    )}
                    {catOverdue === 0 && catUpcoming > 0 && (
                      <View style={[styles.catBadge, { backgroundColor: "#FFB300" }]}>
                        <Text style={styles.catBadgeTxt}>{catUpcoming}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Recently completed */}
            {ok.length > 0 && (
              <View style={{ marginBottom: 16 }}>
                <Text style={[styles.groupTitle, { color: c.primary }]}>✓ Recently Serviced</Text>
                <View style={{ gap: 8 }}>
                  {ok.slice(0, 5).map(s => (
                    <View
                      key={s.reminder.itemId}
                      style={[styles.itemCard, { backgroundColor: cardBg, borderColor: borderCol }]}
                    >
                      <View style={[styles.itemIconWrap, { backgroundColor: CATEGORY_ICONS[s.reminder.category]?.bg ?? "#88888820" }]}>
                        <Ionicons name={(CATEGORY_ICONS[s.reminder.category]?.icon ?? "build-outline") as any} size={18} color={CATEGORY_ICONS[s.reminder.category]?.color ?? "#888"} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.itemName, { color: c.foreground }]}>{s.reminder.itemName}</Text>
                        <Text style={[styles.itemSub, { color: subText }]}>
                          {s.lastRecord ? new Date(s.lastRecord.date).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }) : ""}
                          {s.lastRecord?.mileageKm ? ` · ${s.lastRecord.mileageKm.toLocaleString()} km` : ""}
                        </Text>
                      </View>
                      <StatusPill status="ok" />
                    </View>
                  ))}
                </View>
              </View>
            )}
          </>
        )}

        {/* ── CATEGORY DRILL-DOWN ── */}
        {tab === "overview" && activeCategory && (
          <>
            <TouchableOpacity
              style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 }}
              onPress={() => setActiveCategory(null)}
            >
              <Ionicons name="arrow-back" size={18} color={c.primary} />
              <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: c.primary }}>All Categories</Text>
            </TouchableOpacity>
            <Text style={[styles.groupTitle, { color: c.foreground, marginBottom: 12 }]}>{activeCategory}</Text>
            <View style={{ gap: 8 }}>
              {(categoryItems ?? []).map(s => (
                <View
                  key={s.reminder.itemId}
                  style={[styles.itemCard, { backgroundColor: cardBg, borderColor: borderCol, flexDirection: "column", alignItems: "stretch" }]}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <Text style={[styles.itemName, { color: c.foreground }]}>{s.reminder.itemName}</Text>
                        <StatusPill status={s.status} />
                      </View>
                      {s.lastRecord ? (
                        <Text style={[styles.itemSub, { color: subText }]}>
                          Last: {new Date(s.lastRecord.date).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                          {s.lastRecord.mileageKm ? ` · ${s.lastRecord.mileageKm.toLocaleString()} km` : ""}
                          {s.lastRecord.costKSh ? ` · KSh ${s.lastRecord.costKSh.toLocaleString()}` : ""}
                        </Text>
                      ) : (
                        <Text style={[styles.itemSub, { color: subText }]}>No service logged</Text>
                      )}
                      {s.reminder.intervalKm && (
                        <Text style={[styles.itemSub, { color: subText, marginTop: 2 }]}>
                          Interval: every {s.reminder.intervalKm.toLocaleString()} km
                          {s.reminder.intervalMonths ? ` or ${s.reminder.intervalMonths} months` : ""}
                        </Text>
                      )}
                    </View>
                  </View>
                  {/* Action row */}
                  <View style={[styles.recordActions, { borderTopColor: borderCol }]}>
                    <TouchableOpacity style={styles.recordActionBtn} onPress={() => openLog(s.reminder)}>
                      <Ionicons name="add-circle-outline" size={14} color={c.primary} />
                      <Text style={[styles.recordActionTxt, { color: c.primary }]}>Log Service</Text>
                    </TouchableOpacity>
                    {s.lastRecord && (
                      <>
                        <View style={styles.recordActionDiv} />
                        <TouchableOpacity style={styles.recordActionBtn} onPress={() => handleEditRecord(s.lastRecord!)}>
                          <Ionicons name="pencil-outline" size={14} color={c.mutedForeground} />
                          <Text style={[styles.recordActionTxt, { color: c.mutedForeground }]}>Edit last</Text>
                        </TouchableOpacity>
                        <View style={styles.recordActionDiv} />
                        <TouchableOpacity style={styles.recordActionBtn} onPress={() => handleDeleteRecord(s.lastRecord!.id)}>
                          <Ionicons name="trash-outline" size={14} color="#E5484D" />
                          <Text style={[styles.recordActionTxt, { color: "#E5484D" }]}>Delete last</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ── HISTORY ── */}
        {tab === "history" && (
          <>
            {historyRecords.length === 0 ? (
              <View style={[styles.emptyState, { backgroundColor: cardBg, borderColor: borderCol }]}>
                <Ionicons name="document-text-outline" size={32} color={subText} />
                <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: c.foreground, marginTop: 12 }}>No service records yet</Text>
                <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: subText, textAlign: "center", marginTop: 4 }}>
                  Tap any maintenance item on the Overview tab to log a service.
                </Text>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {historyRecords.map(r => (
                  <View key={r.id} style={[styles.itemCard, { backgroundColor: cardBg, borderColor: borderCol, flexDirection: "column", alignItems: "stretch" }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <View style={[styles.itemIconWrap, { backgroundColor: CATEGORY_ICONS[r.category]?.bg ?? "#88888820" }]}>
                        <Ionicons name={(CATEGORY_ICONS[r.category]?.icon ?? "build-outline") as any} size={18} color={CATEGORY_ICONS[r.category]?.color ?? "#888"} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.itemName, { color: c.foreground }]}>{r.itemName}</Text>
                        <Text style={[styles.itemSub, { color: subText }]}>
                          {new Date(r.date).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" })}
                        </Text>
                        <Text style={[styles.itemSub, { color: subText }]}>
                          {r.mileageKm.toLocaleString()} km
                          {r.costKSh ? ` · KSh ${r.costKSh.toLocaleString()}` : ""}
                          {r.garage ? ` · ${r.garage}` : ""}
                        </Text>
                        {r.notes && <Text style={[styles.itemSub, { color: subText, fontStyle: "italic" }]}>{r.notes}</Text>}
                      </View>
                      <View style={[styles.itemIconWrap, { backgroundColor: c.primary + "20" }]}>
                        <Ionicons name="checkmark" size={18} color={c.primary} />
                      </View>
                    </View>
                    {/* Edit / Delete actions */}
                    <View style={[styles.recordActions, { borderTopColor: borderCol }]}>
                      <TouchableOpacity style={styles.recordActionBtn} onPress={() => handleEditRecord(r)}>
                        <Ionicons name="pencil-outline" size={14} color={c.primary} />
                        <Text style={[styles.recordActionTxt, { color: c.primary }]}>Edit</Text>
                      </TouchableOpacity>
                      <View style={styles.recordActionDiv} />
                      <TouchableOpacity style={styles.recordActionBtn} onPress={() => handleDeleteRecord(r.id)}>
                        <Ionicons name="trash-outline" size={14} color="#E5484D" />
                        <Text style={[styles.recordActionTxt, { color: "#E5484D" }]}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* ── COSTS ── */}
        {tab === "costs" && (
          <>
            {/* Total */}
            <View style={[styles.card, { backgroundColor: cardBg, borderColor: borderCol, marginBottom: 16, alignItems: "center", padding: 20 }]}>
              <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: subText }}>Total Spent (Last 12 Months)</Text>
              <Text style={{ fontSize: 32, fontFamily: "Inter_700Bold", color: c.foreground, marginTop: 4 }}>
                KSh {totalCost.toLocaleString()}
              </Text>
            </View>

            {/* By category */}
            <Text style={[styles.groupTitle, { color: c.foreground, marginBottom: 12 }]}>By Category</Text>
            <View style={{ gap: 10 }}>
              {Object.entries(costByCat)
                .sort(([, a], [, b]) => b - a)
                .map(([cat, amount]) => {
                  const cfg = CATEGORY_ICONS[cat] ?? { icon: "build-outline", color: "#888", bg: "#88888820" };
                  const pct = totalCost > 0 ? (amount / totalCost) * 100 : 0;
                  return (
                    <View key={cat} style={[styles.itemCard, { backgroundColor: cardBg, borderColor: borderCol }]}>
                      <View style={[styles.itemIconWrap, { backgroundColor: cfg.bg }]}>
                        <Ionicons name={cfg.icon as any} size={18} color={cfg.color} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                          <Text style={[styles.itemName, { color: c.foreground }]}>{cat}</Text>
                          <Text style={[styles.itemName, { color: c.foreground }]}>KSh {amount.toLocaleString()}</Text>
                        </View>
                        {/* Progress bar */}
                        <View style={{ height: 4, backgroundColor: c.isDark ? "#1E2820" : "#E8F0E8", borderRadius: 2 }}>
                          <View style={{ width: `${pct}%`, height: 4, backgroundColor: cfg.color, borderRadius: 2 }} />
                        </View>
                      </View>
                    </View>
                  );
                })}
              {Object.keys(costByCat).length === 0 && (
                <View style={[styles.emptyState, { backgroundColor: cardBg, borderColor: borderCol }]}>
                  <Ionicons name="card-outline" size={32} color={subText} />
                  <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: c.foreground, marginTop: 12 }}>No costs recorded</Text>
                  <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: subText, textAlign: "center", marginTop: 4 }}>
                    Add costs when logging service records.
                  </Text>
                </View>
              )}
            </View>
          </>
        )}

      </ScrollView>

      {/* Log Service Modal (supports both add and edit) */}
      <LogServiceModal
        visible={showLog}
        item={logItem}
        currentOdometerKm={odometer}
        editRecord={editRecord}
        onClose={() => { setShowLog(false); setEditRecord(null); }}
        onSaved={reload}
      />

      {/* Update Odometer Modal */}
      <UpdateOdometerModal
        visible={showOdoModal}
        currentKm={odometer}
        onClose={() => setShowOdoModal(false)}
        onSaved={reload}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  infoRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 12, borderWidth: 1, padding: 12,
  },
  miniStat: {
    borderRadius: 12, alignItems: "center", justifyContent: "center", padding: 10,
  },
  healthBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  tabBar: {
    flexDirection: "row", borderBottomWidth: 1,
  },
  tabBtn: {
    flex: 1, paddingVertical: 14, alignItems: "center",
  },
  tabBtnTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  groupTitle: { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 8 },

  itemCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 14, borderWidth: 1, padding: 14,
  },
  itemIconWrap: {
    width: 38, height: 38, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  itemName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  itemSub:  { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },

  categoryCard: {
    width: "47%", borderRadius: 16, borderWidth: 1, padding: 16,
    alignItems: "center", gap: 8, position: "relative",
  },
  catIcon: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  catLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  catBadge: {
    position: "absolute", top: 10, right: 10,
    width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center",
  },
  catBadgeTxt: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },

  card: { borderRadius: 16, borderWidth: 1, padding: 16 },

  // ── Edit / Delete action row below each service card ──────────────────────
  recordActions: {
    flexDirection: "row", alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth, marginTop: 10, paddingTop: 8,
  },
  recordActionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
    paddingVertical: 4,
  },
  recordActionTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  recordActionDiv: { width: StyleSheet.hairlineWidth, height: 16, backgroundColor: "#88888840" },

  emptyState: {
    borderRadius: 16, borderWidth: 1, padding: 24,
    alignItems: "center", justifyContent: "center",
  },
});
