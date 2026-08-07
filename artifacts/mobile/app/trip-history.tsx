/**
 * Trip History — Full trip management screen.
 *
 * • Vehicle selector card (multi-vehicle picker if 2+ saved)
 * • All Trips / Upcoming / Past tabs
 * • Trip summary stats (distance, drive time, trip count, vehicle)
 * • Collapsible Upcoming Trips list with edit / cancel / delete
 * • Collapsible Recent Trips list with score rings, view-details, hide
 * • "+ Add Trip" modal backed by the plannedTrips API
 */

export { ErrorBoundary } from "@/components/ErrorBoundary";

import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import DateTimePicker from "@react-native-community/datetimepicker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { getCarImageUrl, getMakeById, getModelById } from "@/data/carModels";
import { loadVehicles, SavedVehicle } from "@/utils/savedVehicles";
import {
  DriveSession,
  formatDuration,
  listDriveSessions,
  scoreColor,
  scoreLabel,
} from "@/utils/driveSessionApi";
import {
  createPlannedTrip,
  deletePlannedTrip,
  listPlannedTrips,
  listSavedPlaces,
  PlannedTrip,
  SavedPlace,
  updatePlannedTrip,
} from "@/utils/tripsApi";
import { getSessionsForVehicle } from "@/utils/vehicleSessionMap";
import {
  TripLocationMap,
  loadTripLocationCache,
  saveTripLocation,
} from "@/utils/tripLocationCache";
import { reverseGeocode } from "@/utils/geocoding";

// ── Constants ─────────────────────────────────────────────────────────────────

const HIDDEN_SESSIONS_KEY = "msafiri_hidden_sessions_v1";

// ── Helpers ───────────────────────────────────────────────────────────────────

function vehicleLabel(v: SavedVehicle): string {
  const make  = v.makeId  ? getMakeById(v.makeId)  : null;
  const model = v.makeId && v.modelId ? getModelById(v.makeId, v.modelId) : null;
  if (make && model) return `${make.name} ${model.name}`;
  if (v.customMakeName && v.customModelName) return `${v.customMakeName} ${v.customModelName}`;
  return "My Vehicle";
}

function fmtDur(s: number): string {
  if (s <= 0) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDate(epoch: number) {
  const d = new Date(epoch);
  return {
    monthShort: d.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
    day:        d.getDate(),
    weekday:    d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase(),
    timeStr:    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    fullStr:    d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }),
  };
}

function sessionDate(startedAt: string) {
  const d = new Date(startedAt);
  return {
    monthShort: d.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
    day:        d.getDate(),
    weekday:    d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase(),
    timeStr:    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  };
}

function timePeriod(startedAt: string): string {
  const h = new Date(startedAt).getHours();
  if (h < 12) return "Morning";
  if (h < 17) return "Afternoon";
  if (h < 21) return "Evening";
  return "Night";
}

// ── Score Ring ────────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 52 }: { score: number; size?: number }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const pct  = Math.max(0, Math.min(100, score)) / 100;
  const color = scoreColor(score);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ position: "absolute", top: 0, left: 0 }}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke="#1E2820" strokeWidth={5} fill="none" />
          <Circle
            cx={size / 2} cy={size / 2} r={r}
            stroke={color} strokeWidth={5} fill="none"
            strokeDasharray={`${pct * circ} ${circ}`}
            strokeLinecap="round"
            rotation="-90" origin={`${size / 2},${size / 2}`}
          />
        </Svg>
      </View>
      <Text style={{ fontSize: size < 48 ? 12 : 14, fontFamily: "Inter_700Bold", color }}>{score}</Text>
    </View>
  );
}

// ── Date Block ────────────────────────────────────────────────────────────────

function DateBlock({ month, day, weekday, borderCol }: { month: string; day: number; weekday: string; borderCol: string }) {
  const c = useColors();
  return (
    <View style={[styles.dateBlock, { borderColor: borderCol }]}>
      <Text style={[styles.dateMonth, { color: c.primary }]}>{month}</Text>
      <Text style={[styles.dateDay, { color: c.foreground }]}>{day}</Text>
      <Text style={[styles.dateWeekday, { color: c.mutedForeground }]}>{weekday}</Text>
    </View>
  );
}

// ── Vehicle Picker Modal ───────────────────────────────────────────────────────

interface VehiclePickerModalProps {
  visible: boolean;
  vehicles: SavedVehicle[];
  selectedId: string;
  onSelect: (v: SavedVehicle) => void;
  onClose: () => void;
}

function VehiclePickerModal({ visible, vehicles, selectedId, onSelect, onClose }: VehiclePickerModalProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const cardBg    = c.isDark ? "#151917" : "#fff";
  const borderCol = c.isDark ? "#242B27" : "#E4EAE4";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "#00000080" }} onPress={onClose} />
      <View style={{ backgroundColor: cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: insets.bottom + 24 }}>
        {/* Handle */}
        <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 4 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: borderCol }} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 8, marginBottom: 16 }}>
          <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: c.foreground }}>Select Vehicle</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={c.foreground} />
          </TouchableOpacity>
        </View>

        {vehicles.map(v => (
          <TouchableOpacity
            key={v.id}
            style={[styles.pickerRow, { borderColor: v.id === selectedId ? c.primary : borderCol, backgroundColor: v.id === selectedId ? c.primary + "12" : cardBg }]}
            onPress={() => { onSelect(v); onClose(); }}
            activeOpacity={0.75}
          >
            <VehicleThumb v={v} size={52} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: c.foreground }}>{vehicleLabel(v)}</Text>
                {v.isDefault && (
                  <View style={{ backgroundColor: c.primary + "20", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 }}>
                    <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: c.primary }}>Primary</Text>
                  </View>
                )}
              </View>
              <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: c.mutedForeground, marginTop: 2 }}>
                {[v.fuelType, v.transmission].filter(Boolean).join(" · ")}
              </Text>
            </View>
            {v.id === selectedId && <Ionicons name="checkmark-circle" size={22} color={c.primary} />}
          </TouchableOpacity>
        ))}
      </View>
    </Modal>
  );
}

function VehicleThumb({ v, size = 60 }: { v: SavedVehicle; size?: number }) {
  const url = v.makeId && v.modelId ? getCarImageUrl(v.makeId, v.modelId) : null;
  return (
    <View style={{ width: size, height: size * 0.65, borderRadius: 8, overflow: "hidden", backgroundColor: "#1A2020", alignItems: "center", justifyContent: "center" }}>
      {url
        ? <Image source={{ uri: url }} style={{ width: size, height: size * 0.65 }} resizeMode="cover" />
        : <Ionicons name="car-outline" size={size * 0.4} color="#888" />
      }
    </View>
  );
}

// ── Add / Edit Trip Modal ─────────────────────────────────────────────────────

interface AddTripModalProps {
  visible: boolean;
  editing: PlannedTrip | null;
  savedPlaces: SavedPlace[];
  deviceId: string;
  onClose: () => void;
  onSaved: () => void;
}

function AddTripModal({ visible, editing, savedPlaces, deviceId, onClose, onSaved }: AddTripModalProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const cardBg    = c.isDark ? "#151917" : "#fff";
  const borderCol = c.isDark ? "#242B27" : "#E4EAE4";
  const subText   = c.mutedForeground;

  const [label, setLabel]         = useState("");
  const [destPlace, setDestPlace] = useState<SavedPlace | null>(null);
  const [tripDate, setTripDate]   = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [saving, setSaving]       = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (editing) {
      setLabel(editing.label);
      setTripDate(new Date(editing.plannedAt));
      const match = savedPlaces.find(p => p.id === editing.savedPlaceId);
      setDestPlace(match ?? null);
    } else {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(8, 0, 0, 0);
      setLabel("");
      setDestPlace(null);
      setTripDate(tomorrow);
    }
  }, [visible, editing]);

  async function handleSave() {
    if (!label.trim()) {
      Alert.alert("Trip label required", "Enter a destination or route name.");
      return;
    }
    setSaving(true);
    try {
      const plannedAt = tripDate.getTime();
      const dest = destPlace ?? { lat: -1.286389, lng: 36.817223 }; // Nairobi centre fallback

      if (editing) {
        // Delete old + recreate so we can update the label (API only patches status/plannedAt)
        await deletePlannedTrip(deviceId, editing.id);
        await createPlannedTrip(deviceId, {
          savedPlaceId: destPlace?.id ?? null,
          label: label.trim(),
          destLat: dest.lat,
          destLng: dest.lng,
          plannedAt,
        });
      } else {
        await createPlannedTrip(deviceId, {
          savedPlaceId: destPlace?.id ?? null,
          label: label.trim(),
          destLat: dest.lat,
          destLng: dest.lng,
          plannedAt,
        });
      }

      onSaved();
      onClose();
    } catch {
      Alert.alert("Error", "Could not save trip. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "#00000080" }} onPress={onClose} />
      <View style={{ backgroundColor: cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: insets.bottom + 24 }}>
        <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 4 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: borderCol }} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 8, marginBottom: 20 }}>
          <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: c.foreground }}>{editing ? "Edit Trip" : "Plan a Trip"}</Text>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color={c.foreground} /></TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
          {/* Label */}
          <View>
            <Text style={[styles.fieldLabel, { color: subText }]}>Trip name / route</Text>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder='e.g. "Nairobi → Mombasa"'
              placeholderTextColor={subText}
              style={[styles.textInput, { borderColor: borderCol, color: c.foreground, backgroundColor: c.isDark ? "#1A1F1C" : "#F8FAF8" }]}
            />
          </View>

          {/* Destination from saved places */}
          {savedPlaces.length > 0 && (
            <View>
              <Text style={[styles.fieldLabel, { color: subText }]}>Destination (optional)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {savedPlaces.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={[
                        styles.placeChip,
                        { borderColor: destPlace?.id === p.id ? c.primary : borderCol, backgroundColor: destPlace?.id === p.id ? c.primary + "15" : "transparent" },
                      ]}
                      onPress={() => setDestPlace(destPlace?.id === p.id ? null : p)}
                    >
                      <Ionicons name={p.kind === "home" ? "home-outline" : p.kind === "work" ? "briefcase-outline" : "location-outline"} size={14} color={destPlace?.id === p.id ? c.primary : subText} />
                      <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: destPlace?.id === p.id ? c.primary : c.foreground }}>{p.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
          )}

          {/* Date */}
          <View>
            <Text style={[styles.fieldLabel, { color: subText }]}>Date</Text>
            <TouchableOpacity style={[styles.pickerBtn, { borderColor: borderCol }]} onPress={() => setShowDatePicker(true)}>
              <Ionicons name="calendar-outline" size={18} color={c.primary} />
              <Text style={{ fontSize: 15, fontFamily: "Inter_400Regular", color: c.foreground }}>
                {tripDate.toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" })}
              </Text>
            </TouchableOpacity>
            {showDatePicker && (
              <DateTimePicker
                value={tripDate}
                mode="date"
                minimumDate={new Date()}
                onChange={(_, d) => { setShowDatePicker(Platform.OS === "ios"); if (d) setTripDate(prev => { const n = new Date(prev); n.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); return n; }); }}
              />
            )}
          </View>

          {/* Time */}
          <View>
            <Text style={[styles.fieldLabel, { color: subText }]}>Departure time</Text>
            <TouchableOpacity style={[styles.pickerBtn, { borderColor: borderCol }]} onPress={() => setShowTimePicker(true)}>
              <Ionicons name="time-outline" size={18} color={c.primary} />
              <Text style={{ fontSize: 15, fontFamily: "Inter_400Regular", color: c.foreground }}>
                {tripDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </Text>
            </TouchableOpacity>
            {showTimePicker && (
              <DateTimePicker
                value={tripDate}
                mode="time"
                onChange={(_, d) => { setShowTimePicker(Platform.OS === "ios"); if (d) setTripDate(prev => { const n = new Date(prev); n.setHours(d.getHours(), d.getMinutes()); return n; }); }}
              />
            )}
          </View>

          {/* Save */}
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: c.primary, marginTop: 8 }]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" }}>
              {saving ? "Saving…" : editing ? "Update Trip" : "Plan Trip"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

type Tab = "all" | "upcoming" | "past";

export default function TripHistoryScreen() {
  const c       = useColors();
  const insets  = useSafeAreaInsets();
  const { deviceId } = useApp();

  // ── State ──────────────────────────────────────────────────────────────────
  const [vehicles,   setVehicles]   = useState<SavedVehicle[]>([]);
  const [activeVehicle, setActiveVehicle] = useState<SavedVehicle | null>(null);
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);

  const [sessions,         setSessions]         = useState<DriveSession[]>([]);
  const [filteredSessions, setFilteredSessions] = useState<DriveSession[]>([]);
  const [hiddenIds,        setHiddenIds]        = useState<Set<string>>(new Set());
  const [locationCache,    setLocationCache]    = useState<TripLocationMap>({});

  const [plannedTrips, setPlannedTrips] = useState<PlannedTrip[]>([]);
  const [savedPlaces,  setSavedPlaces]  = useState<SavedPlace[]>([]);

  const [tab, setTab] = useState<Tab>("all");
  const [upcomingExpanded, setUpcomingExpanded] = useState(true);
  const [recentExpanded,   setRecentExpanded]   = useState(true);
  const [loading, setLoading] = useState(true);

  const [showAddTrip, setShowAddTrip] = useState(false);
  const [editingTrip, setEditingTrip] = useState<PlannedTrip | null>(null);

  const cardBg    = c.isDark ? "#151917" : c.card;
  const borderCol = c.isDark ? "#242B27" : c.tileBorder;
  const subText   = c.mutedForeground;

  // ── Load data ──────────────────────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setLoading(true);

      Promise.all([
        loadVehicles(),
        deviceId ? listDriveSessions(deviceId, 100) : Promise.resolve({ sessions: [], total: 0 }),
        deviceId ? listPlannedTrips(deviceId)       : Promise.resolve([] as PlannedTrip[]),
        deviceId ? listSavedPlaces(deviceId)        : Promise.resolve([] as SavedPlace[]),
        AsyncStorage.getItem(HIDDEN_SESSIONS_KEY),
        loadTripLocationCache(),
      ]).then(([vs, { sessions: ss }, trips, places, hiddenRaw, locCache]) => {
        if (!alive) return;
        setVehicles(vs);
        setActiveVehicle(prev => {
          if (prev && vs.find(v => v.id === prev.id)) return prev;
          return vs.find(v => v.isDefault) ?? vs[0] ?? null;
        });
        setSessions(ss);
        const hidden = new Set<string>(hiddenRaw ? JSON.parse(hiddenRaw) : []);
        setHiddenIds(hidden);
        setPlannedTrips(trips);
        setSavedPlaces(places);
        setLocationCache(locCache);

        // Background: geocode sessions missing from cache (up to 15 most recent)
        const uncached = ss
          .filter(s => s.startLat != null && s.startLng != null && !locCache[s.id])
          .slice(0, 15);
        if (uncached.length > 0) {
          (async () => {
            const updated: TripLocationMap = { ...locCache };
            for (const s of uncached) {
              if (!alive) break;
              const from = await reverseGeocode(s.startLat!, s.startLng!);
              if (!from) continue;
              const to = (s.endLat != null && s.endLng != null)
                ? await reverseGeocode(s.endLat, s.endLng)
                : "";
              const loc = { from, to: to || from };
              await saveTripLocation(s.id, loc);
              updated[s.id] = loc;
            }
            if (alive) setLocationCache({ ...updated });
          })();
        }
      }).catch(() => {}).finally(() => { if (alive) setLoading(false); });

      return () => { alive = false; };
    }, [deviceId])
  );

  // ── Per-vehicle session filtering ─────────────────────────────────────────
  useEffect(() => {
    if (!activeVehicle) { setFilteredSessions(sessions); return; }
    const defaultV = vehicles.find(v => v.isDefault) ?? vehicles[0];
    getSessionsForVehicle(activeVehicle.id, defaultV?.id ?? activeVehicle.id, sessions)
      .then(fs => setFilteredSessions(fs.filter(s => s.endedAt != null && !hiddenIds.has(s.id))))
      .catch(() => setFilteredSessions(sessions.filter(s => s.endedAt != null && !hiddenIds.has(s.id))));
  }, [sessions, vehicles, activeVehicle, hiddenIds]);

  // ── Computed ───────────────────────────────────────────────────────────────
  const totalDistKm = filteredSessions.reduce((a, s) => a + s.distanceM, 0) / 1000;
  const totalDurS   = filteredSessions.reduce((a, s) => a + (s.durationS ?? 0), 0);
  const totalTrips  = filteredSessions.length;

  const upcomingTrips = useMemo(
    () => plannedTrips
      .filter(t => t.status === "upcoming" || t.status === "notified")
      .sort((a, b) => a.plannedAt - b.plannedAt),
    [plannedTrips]
  );
  const recentSessions = useMemo(
    () => [...filteredSessions].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
    [filteredSessions]
  );
  const visibleRecent  = tab === "all" ? recentSessions.slice(0, 5) : recentSessions;
  const visibleUpcoming = tab === "upcoming" ? upcomingTrips : (tab === "all" ? upcomingTrips : []);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleHideSession(id: string) {
    Alert.alert(
      "Hide Trip",
      "Remove this trip from your history? It can be restored by clearing the hidden list.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Hide",
          style: "destructive",
          onPress: async () => {
            const next = new Set([...hiddenIds, id]);
            setHiddenIds(next);
            await AsyncStorage.setItem(HIDDEN_SESSIONS_KEY, JSON.stringify([...next]));
          },
        },
      ]
    );
  }

  function handleSessionMenu(s: DriveSession) {
    Alert.alert(
      "Trip Options",
      `${timePeriod(s.startedAt)} Drive — ${(s.distanceM / 1000).toFixed(1)} km`,
      [
        {
          text: "View Details",
          onPress: () => router.push(`/trip-detail/${s.id}` as any),
        },
        {
          text: "Hide from History",
          style: "destructive",
          onPress: () => handleHideSession(s.id),
        },
        { text: "Cancel", style: "cancel" },
      ]
    );
  }

  function handlePlannedTripMenu(t: PlannedTrip) {
    const info = fmtDate(t.plannedAt);
    Alert.alert(
      t.label,
      `${info.fullStr} at ${info.timeStr}`,
      [
        {
          text: "Edit Trip",
          onPress: () => { setEditingTrip(t); setShowAddTrip(true); },
        },
        {
          text: "Cancel Trip",
          onPress: () => confirmCancelTrip(t),
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => confirmDeleteTrip(t),
        },
        { text: "Close", style: "cancel" },
      ]
    );
  }

  function confirmCancelTrip(t: PlannedTrip) {
    Alert.alert("Cancel Trip", "Mark this trip as cancelled?", [
      { text: "No", style: "cancel" },
      {
        text: "Cancel Trip",
        style: "destructive",
        onPress: async () => {
          try {
            await updatePlannedTrip(deviceId!, t.id, { status: "cancelled" });
            setPlannedTrips(prev => prev.filter(p => p.id !== t.id));
          } catch {
            Alert.alert("Error", "Could not cancel trip.");
          }
        },
      },
    ]);
  }

  function confirmDeleteTrip(t: PlannedTrip) {
    Alert.alert("Delete Trip", "Permanently delete this planned trip?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deletePlannedTrip(deviceId!, t.id);
            setPlannedTrips(prev => prev.filter(p => p.id !== t.id));
          } catch {
            Alert.alert("Error", "Could not delete trip.");
          }
        },
      },
    ]);
  }

  async function reloadTrips() {
    if (!deviceId) return;
    try {
      const [trips, places] = await Promise.all([listPlannedTrips(deviceId), listSavedPlaces(deviceId)]);
      setPlannedTrips(trips);
      setSavedPlaces(places);
    } catch {}
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>

      {/* ── Header ── */}
      <LinearGradient
        colors={c.isDark ? ["#0B1F12", "#0B0D0C"] : ["#E8F5EE", "#F4F6F4"]}
        style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 16 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.isDark ? "#1A2820" : "#fff", alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="arrow-back" size={20} color={c.foreground} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 22, fontFamily: "Inter_700Bold", color: c.foreground }}>Trip History</Text>
            <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: subText, marginTop: 2 }}>View and manage your past and upcoming trips.</Text>
          </View>
          <TouchableOpacity
            style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.primary, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12 }}
            onPress={() => { setEditingTrip(null); setShowAddTrip(true); }}
            activeOpacity={0.85}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" }}>Add Trip</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.primary} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>

          {/* ── Vehicle selector card ── */}
          {activeVehicle && (
            <TouchableOpacity
              style={[styles.vehicleCard, { backgroundColor: cardBg, borderColor: borderCol }]}
              onPress={() => vehicles.length > 1 && setShowVehiclePicker(true)}
              activeOpacity={vehicles.length > 1 ? 0.75 : 1}
            >
              <VehicleThumb v={activeVehicle} size={76} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: c.foreground }} numberOfLines={1}>{vehicleLabel(activeVehicle)}</Text>
                  {activeVehicle.isDefault && (
                    <View style={{ backgroundColor: c.primary + "20", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20, flexShrink: 0 }}>
                      <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: c.primary }}>Primary</Text>
                    </View>
                  )}
                </View>
                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: subText }}>
                  {[activeVehicle.fuelType, activeVehicle.transmission].filter(Boolean).join(" · ")}
                </Text>
                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: subText, marginTop: 2 }}>
                  {activeVehicle.odometerKm ? `${activeVehicle.odometerKm.toLocaleString()} km  ·  Updated from your trips` : "Odometer not set"}
                </Text>
              </View>
              {vehicles.length > 1 && (
                <View style={{ alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="chevron-forward" size={20} color={subText} />
                </View>
              )}
            </TouchableOpacity>
          )}

          {/* ── Tab bar ── */}
          <View style={[styles.tabBar, { backgroundColor: cardBg, borderBottomColor: borderCol }]}>
            {(["all", "upcoming", "past"] as Tab[]).map(t => (
              <TouchableOpacity
                key={t}
                style={[styles.tabBtn, tab === t && { borderBottomColor: c.primary, borderBottomWidth: 2 }]}
                onPress={() => setTab(t)}
              >
                <Text style={[styles.tabBtnTxt, { color: tab === t ? c.primary : subText }]}>
                  {t === "all" ? "All Trips" : t === "upcoming" ? "Upcoming" : "Past"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Trip Summary (All tab) ── */}
          {tab === "all" && (
            <View style={[styles.summaryCard, { backgroundColor: cardBg, borderColor: borderCol }]}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 14 }}>
                <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: c.foreground }}>Trip Summary</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: subText }}>This Year</Text>
                  <Ionicons name="chevron-down" size={14} color={subText} />
                </View>
              </View>
              <View style={styles.summaryRow}>
                <View style={styles.summaryTile}>
                  <Ionicons name="navigate-outline" size={22} color={c.primary} />
                  <Text style={[styles.summaryVal, { color: c.foreground }]}>{totalDistKm >= 1000 ? `${(totalDistKm / 1000).toFixed(1)}k` : totalDistKm.toFixed(0)} km</Text>
                  <Text style={[styles.summaryLbl, { color: subText }]}>Total Distance</Text>
                </View>
                <View style={styles.summaryTile}>
                  <Ionicons name="time-outline" size={22} color="#F97316" />
                  <Text style={[styles.summaryVal, { color: c.foreground }]}>{fmtDur(totalDurS)}</Text>
                  <Text style={[styles.summaryLbl, { color: subText }]}>Total Drive Time</Text>
                </View>
                <View style={styles.summaryTile}>
                  <Ionicons name="git-network-outline" size={22} color="#A855F7" />
                  <Text style={[styles.summaryVal, { color: c.foreground }]}>{totalTrips}</Text>
                  <Text style={[styles.summaryLbl, { color: subText }]}>Total Trips</Text>
                </View>
                <View style={styles.summaryTile}>
                  <Ionicons name="car-outline" size={22} color="#3B82F6" />
                  <Text style={[styles.summaryVal, { color: c.foreground, fontSize: 11 }]} numberOfLines={2}>
                    {activeVehicle ? vehicleLabel(activeVehicle) : "—"}
                  </Text>
                  <Text style={[styles.summaryLbl, { color: subText }]}>Your Vehicle</Text>
                </View>
              </View>
            </View>
          )}

          {/* ── Upcoming Trips ── */}
          {(tab === "all" || tab === "upcoming") && (
            <View style={{ marginTop: 12, marginHorizontal: 16 }}>
              {/* Section header */}
              <TouchableOpacity
                style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}
                onPress={() => setUpcomingExpanded(x => !x)}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: c.foreground, flex: 1 }}>
                  Upcoming Trips
                </Text>
                {upcomingTrips.length > 0 && (
                  <View style={{ backgroundColor: c.primary + "20", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, marginRight: 8 }}>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: c.primary }}>{upcomingTrips.length}</Text>
                  </View>
                )}
                <Ionicons name={upcomingExpanded ? "chevron-up" : "chevron-down"} size={18} color={subText} />
              </TouchableOpacity>

              {upcomingExpanded && (
                upcomingTrips.length === 0 ? (
                  <View style={[styles.emptyState, { backgroundColor: cardBg, borderColor: borderCol }]}>
                    <Ionicons name="calendar-outline" size={28} color={subText} />
                    <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: c.foreground, marginTop: 10 }}>No upcoming trips</Text>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: subText, marginTop: 4, textAlign: "center" }}>
                      Tap "+ Add Trip" to plan your next journey.
                    </Text>
                  </View>
                ) : (
                  <View style={[styles.tripListCard, { backgroundColor: cardBg, borderColor: borderCol }]}>
                    {visibleUpcoming.map((t, idx) => {
                      const df = fmtDate(t.plannedAt);
                      return (
                        <View key={t.id}>
                          {idx > 0 && <View style={[styles.divider, { backgroundColor: borderCol }]} />}
                          <View style={styles.tripRow}>
                            <DateBlock month={df.monthShort} day={df.day} weekday={df.weekday} borderCol={borderCol} />
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={[styles.tripLabel, { color: c.foreground }]} numberOfLines={1}>{t.label}</Text>
                              <View style={[styles.tripMeta, { marginTop: 4 }]}>
                                <Ionicons name="time-outline" size={12} color={subText} />
                                <Text style={[styles.tripMetaTxt, { color: subText }]}>
                                  {df.fullStr}  ·  {df.timeStr}
                                </Text>
                              </View>
                            </View>
                            <View style={{ alignItems: "flex-end", gap: 6 }}>
                              <View style={[styles.statusBadge, { backgroundColor: c.primary + "20" }]}>
                                <Text style={[styles.statusBadgeTxt, { color: c.primary }]}>Planned</Text>
                              </View>
                              <TouchableOpacity
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                onPress={() => handlePlannedTripMenu(t)}
                              >
                                <Ionicons name="ellipsis-horizontal" size={18} color={subText} />
                              </TouchableOpacity>
                            </View>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )
              )}
            </View>
          )}

          {/* ── Recent / Past Trips ── */}
          {(tab === "all" || tab === "past") && (
            <View style={{ marginTop: 16, marginHorizontal: 16 }}>
              {/* Section header */}
              <TouchableOpacity
                style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}
                onPress={() => setRecentExpanded(x => !x)}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: c.foreground, flex: 1 }}>
                  {tab === "all" ? "Recent Trips" : "Past Trips"}
                </Text>
                {recentSessions.length > 0 && (
                  <View style={{ backgroundColor: "#3B82F620", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, marginRight: 8 }}>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#3B82F6" }}>{recentSessions.length}</Text>
                  </View>
                )}
                <Ionicons name={recentExpanded ? "chevron-up" : "chevron-down"} size={18} color={subText} />
              </TouchableOpacity>

              {recentExpanded && (
                recentSessions.length === 0 ? (
                  <View style={[styles.emptyState, { backgroundColor: cardBg, borderColor: borderCol }]}>
                    <Ionicons name="map-outline" size={28} color={subText} />
                    <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: c.foreground, marginTop: 10 }}>No trips recorded yet</Text>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: subText, marginTop: 4, textAlign: "center" }}>
                      Start a drive to see your trip history here.
                    </Text>
                  </View>
                ) : (
                  <View style={[styles.tripListCard, { backgroundColor: cardBg, borderColor: borderCol }]}>
                    {visibleRecent.map((s, idx) => {
                      const sd = sessionDate(s.startedAt);
                      const distKm = (s.distanceM / 1000).toFixed(1);
                      const sc = s.score ?? 0;
                      return (
                        <View key={s.id}>
                          {idx > 0 && <View style={[styles.divider, { backgroundColor: borderCol }]} />}
                          <TouchableOpacity
                            style={styles.tripRow}
                            onPress={() => router.push(`/trip-detail/${s.id}` as any)}
                            activeOpacity={0.75}
                          >
                            <DateBlock month={sd.monthShort} day={sd.day} weekday={sd.weekday} borderCol={borderCol} />
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={[styles.tripLabel, { color: c.foreground }]} numberOfLines={1}>
                                {locationCache[s.id]
                                  ? locationCache[s.id].to && locationCache[s.id].to !== locationCache[s.id].from
                                    ? `${locationCache[s.id].from} → ${locationCache[s.id].to}`
                                    : locationCache[s.id].from
                                  : `${timePeriod(s.startedAt)} Drive`}
                              </Text>
                              <View style={[styles.tripMeta, { marginTop: 3 }]}>
                                <Text style={[styles.tripMetaTxt, { color: subText }]}>
                                  {sd.timeStr}  ·  {distKm} km  ·  {formatDuration(s.durationS ?? 0)}
                                </Text>
                              </View>
                              <Text style={[styles.tripMetaTxt, { color: subText, marginTop: 2 }]}>
                                Avg Speed {s.avgSpeedKmh != null ? `${Math.round(s.avgSpeedKmh)} km/h` : "—"}
                              </Text>
                            </View>
                            <View style={{ alignItems: "center", gap: 6 }}>
                              {sc > 0 ? <ScoreRing score={sc} size={50} /> : <View style={{ width: 50 }} />}
                              <TouchableOpacity
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                onPress={() => handleSessionMenu(s)}
                              >
                                <Ionicons name="ellipsis-horizontal" size={18} color={subText} />
                              </TouchableOpacity>
                            </View>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </View>
                )
              )}

              {/* View all link (All tab only, when capped at 5) */}
              {tab === "all" && recentSessions.length > 5 && recentExpanded && (
                <TouchableOpacity
                  style={[styles.viewAllRow, { backgroundColor: cardBg, borderColor: borderCol }]}
                  onPress={() => setTab("past")}
                  activeOpacity={0.75}
                >
                  <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: c.primary }}>
                    View all past trips
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={c.primary} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* ── Past tab: show all sessions ── */}
          {tab === "past" && recentSessions.length === 0 && (
            <View style={{ margin: 16 }}>
              <View style={[styles.emptyState, { backgroundColor: cardBg, borderColor: borderCol }]}>
                <Ionicons name="map-outline" size={32} color={subText} />
                <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: c.foreground, marginTop: 12 }}>No past trips for this vehicle</Text>
                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: subText, marginTop: 4, textAlign: "center" }}>
                  Complete a drive to see it here.
                </Text>
              </View>
            </View>
          )}

        </ScrollView>
      )}

      {/* ── Modals ── */}
      <VehiclePickerModal
        visible={showVehiclePicker}
        vehicles={vehicles}
        selectedId={activeVehicle?.id ?? ""}
        onSelect={v => setActiveVehicle(v)}
        onClose={() => setShowVehiclePicker(false)}
      />

      <AddTripModal
        visible={showAddTrip}
        editing={editingTrip}
        savedPlaces={savedPlaces}
        deviceId={deviceId ?? ""}
        onClose={() => { setShowAddTrip(false); setEditingTrip(null); }}
        onSaved={reloadTrips}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  vehicleCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    margin: 16, borderRadius: 18, borderWidth: 1, padding: 14,
  },
  tabBar: {
    flexDirection: "row", borderBottomWidth: 1,
  },
  tabBtn: {
    flex: 1, paddingVertical: 14, alignItems: "center",
  },
  tabBtnTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  summaryCard: {
    marginHorizontal: 16, marginTop: 14,
    borderRadius: 18, borderWidth: 1, padding: 16,
  },
  summaryRow: {
    flexDirection: "row", gap: 4,
  },
  summaryTile: {
    flex: 1, alignItems: "center", gap: 5,
  },
  summaryVal: { fontSize: 14, fontFamily: "Inter_700Bold", textAlign: "center" },
  summaryLbl: { fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "center" },

  tripListCard: {
    borderRadius: 18, borderWidth: 1, overflow: "hidden",
  },
  tripRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14,
  },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 14 },

  dateBlock: {
    width: 44, alignItems: "center", paddingVertical: 6, paddingHorizontal: 4,
    borderRadius: 10, borderWidth: 1,
  },
  dateMonth:   { fontSize: 10, fontFamily: "Inter_700Bold" },
  dateDay:     { fontSize: 18, fontFamily: "Inter_700Bold", lineHeight: 22 },
  dateWeekday: { fontSize: 9, fontFamily: "Inter_600SemiBold" },

  tripLabel:   { fontSize: 14, fontFamily: "Inter_700Bold" },
  tripMeta:    { flexDirection: "row", alignItems: "center", gap: 4 },
  tripMetaTxt: { fontSize: 12, fontFamily: "Inter_400Regular" },

  statusBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  statusBadgeTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  emptyState: {
    borderRadius: 18, borderWidth: 1, padding: 28,
    alignItems: "center", justifyContent: "center",
  },
  viewAllRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: 10, borderRadius: 14, borderWidth: 1, paddingVertical: 14,
  },

  // Picker modal
  pickerRow: {
    flexDirection: "row", alignItems: "center", gap: 14,
    marginHorizontal: 16, marginBottom: 10,
    borderRadius: 14, borderWidth: 1, padding: 14,
  },

  // AddTripModal
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  textInput: {
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 15, fontFamily: "Inter_400Regular",
  },
  pickerBtn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13,
  },
  placeChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  saveBtn: {
    borderRadius: 14, paddingVertical: 16, alignItems: "center",
  },
});
