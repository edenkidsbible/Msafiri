import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Circle, Polyline, Rect } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import {
  DriveSession,
  listDriveSessions,
  scoreColor,
  formatDuration,
} from "@/utils/driveSessionApi";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";
import { getCarImageUrl, getMakeById, getModelById } from "@/data/carModels";
import { API_BASE } from "@/utils/apiClient";
import {
  loadVehicleCareData,
  computeVehicleCareStats,
  getCareStorageKey,
  VehicleCareStats,
  estimatedOdometerKm,
} from "@/utils/vehicleCare";
import {
  SavedVehicle,
  loadVehicles,
  ensureVehicles,
  applyPendingSlot,
  setPendingSlot,
  setDefaultVehicle,
  removeVehicle,
  PENDING_SLOT_KEY,
} from "@/utils/savedVehicles";
import { getSessionsForVehicle } from "@/utils/vehicleSessionMap";
export { ErrorBoundary } from "@/components/ErrorBoundary";

const SCREEN_W = Dimensions.get("window").width;
const CARD_W   = SCREEN_W - 32; // 16px margin each side

// ── Helpers ───────────────────────────────────────────────────────────────────

function getVehicleEmoji(type: string): string {
  switch (type) {
    case "car":        return "🚗";
    case "psv":        return "🚐";
    case "bus":        return "🚌";
    case "truck":      return "🚛";
    case "motorcycle": return "🏍️";
    case "tractor":    return "🚜";
    default:           return "🚗";
  }
}

function vehicleDisplayName(v: SavedVehicle): string {
  const make  = v.makeId  ? getMakeById(v.makeId)  : null;
  const model = (v.makeId && v.modelId) ? getModelById(v.makeId, v.modelId) : null;
  if (make && model) return `${make.name} ${model.name}`;
  if (v.customMakeName && v.customModelName) return `${v.customMakeName} ${v.customModelName}`;
  return "My Vehicle";
}

function tripDateLabel(iso: string): string {
  const d    = new Date(iso);
  const now  = new Date();
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString())    return `Today, ${time}`;
  if (d.toDateString() === yest.toDateString())   return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

function fmtDur(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Vehicle image (R2 PNG — custom-first with poll-retry) ────────────────────
//
// Resolution order per render:
//   1. Custom model generated image  →  car-images/{makeId}/{modelSlug}.png
//      (strip "custom-" prefix from modelId — that's the R2 key the server writes)
//   2. On 404: first standard model of that make as silhouette fallback
//   3. On 404 again: emoji
//
// For custom models that are still generating, we retry the image URL every
// 15 s (up to 4 retries ≈ 1 min) so the card auto-updates once the image lands.

import { CAR_MAKES } from "@/data/carModels";

function firstStandardModel(makeId: string): string | null {
  const make = CAR_MAKES.find(m => m.id === makeId);
  return make?.models?.[0]?.id ?? null;
}

// Strip the "custom-" prefix the car-picker adds to modelIds — the R2 key
// written by customVehicles route uses the raw slug (no prefix).
function customModelSlug(modelId: string): string {
  return modelId.startsWith("custom-") ? modelId.slice(7) : modelId;
}

function VehicleImage({ v, width, height }: { v: SavedVehicle; width: number; height: number }) {
  const c = useColors();

  const isMakeFully  = !v.makeId  || v.makeId.startsWith("custom-");
  const isModelCustom = !v.modelId || v.modelId.startsWith("custom-");

  // Phase 0 = custom generated image; Phase 1 = standard make fallback; Phase 2 = emoji
  const [phase,   setPhase]   = useState(0);
  const [loading, setLoading] = useState(true);
  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (retryTimer.current) clearTimeout(retryTimer.current); };
  }, []);

  // No usable make → jump straight to emoji
  if (isMakeFully || phase >= 2) {
    return (
      <Text style={{ fontSize: height * 0.55, fontFamily: EMOJI_FONT_FAMILY, textAlign: "center" }}>
        {getVehicleEmoji(v.vehicleType)}
      </Text>
    );
  }

  const makeId = v.makeId!;

  // Phase 0: try the custom-generated image (or standard image for non-custom models)
  // Phase 1: try the first standard model image as a silhouette fallback
  let uri: string;
  if (phase === 0) {
    const modelSlug = isModelCustom ? customModelSlug(v.modelId!) : v.modelId!;
    uri = getCarImageUrl(makeId, modelSlug);
  } else {
    const fallback = firstStandardModel(makeId);
    if (!fallback) { setPhase(2); return null; }
    uri = getCarImageUrl(makeId, fallback);
  }

  function handleError() {
    setLoading(false);
    if (phase === 0 && isModelCustom && retryCount.current < 4) {
      // Custom image not ready yet — poll every 15 s
      retryCount.current += 1;
      retryTimer.current = setTimeout(() => {
        setLoading(true); // re-trigger Image load
      }, 15_000);
    } else {
      setPhase(p => p + 1);
      setLoading(true);
    }
  }

  return (
    <View style={{ width, height, alignItems: "center", justifyContent: "center" }}>
      {loading && (
        <ActivityIndicator size="small" color={c.primary} style={{ position: "absolute" }} />
      )}
      <Image
        key={`${uri}-${retryCount.current}`}   // force re-mount on retry
        source={{ uri }}
        style={{ width, height }}
        resizeMode="contain"
        onLoad={() => setLoading(false)}
        onError={handleError}
      />
    </View>
  );
}

// ── Circular health ring ──────────────────────────────────────────────────────

function HealthRing({
  pct, size = 72, strokeColor, trackColor,
}: { pct: number; size?: number; strokeColor: string; trackColor?: string }) {
  const r    = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(1, pct / 100)) * circ;
  const track = trackColor ?? "#2A3530";
  return (
    <Svg width={size} height={size}>
      <Circle cx={size/2} cy={size/2} r={r} stroke={track} strokeWidth={7} fill="none" />
      <Circle
        cx={size/2} cy={size/2} r={r}
        stroke={strokeColor} strokeWidth={7} fill="none"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        rotation="-90"
        origin={`${size/2},${size/2}`}
      />
    </Svg>
  );
}

// ── Trip map thumbnail ────────────────────────────────────────────────────────

function TripThumb({ color }: { color: string }) {
  return (
    <View style={{ width: 56, height: 56, borderRadius: 12, overflow: "hidden", backgroundColor: "#111815" }}>
      <Svg width={56} height={56}>
        <Rect x="0" y="0" width="56" height="56" fill={color} fillOpacity="0.07" />
        <Polyline
          points="8,44 16,36 22,30 30,26 38,20 44,16"
          fill="none" stroke={color} strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
        />
        <Circle cx="8"  cy="44" r="3.5" fill="#EF4444" />
        <Circle cx="44" cy="16" r="3.5" fill={color} />
      </Svg>
    </View>
  );
}

// ── Vehicle slide (one entry in the My Vehicles FlatList) ─────────────────────

interface VehicleSlideProps {
  v: SavedVehicle;
  index: number;
  healthScore: number;
  healthLabel: string;
  healthColor: string;
  odometerKm: number;
  cardBg: string;
  borderCol: string;
  subText: string;
  primary: string;
  foreground: string;
  totalVehicles: number;
  onChangeVehicle: (index: number) => void;
  onSetDefault: (id: string) => void;
  onRemove: (id: string) => void;
}

// Image fills the card width minus 2×card-padding (16px each side)
const IMG_W = CARD_W - 32;
const IMG_H = Math.round(IMG_W * 0.54); // ~16:9-ish ratio, typically ~196px on 402w

function VehicleSlide({
  v, index, healthScore, healthLabel, healthColor,
  odometerKm, cardBg, borderCol, subText, primary, foreground,
  totalVehicles, onChangeVehicle, onSetDefault, onRemove,
}: VehicleSlideProps) {
  const trackColor = cardBg === "#151917" || cardBg.startsWith("#0") ? "#2A3530" : "#DDE6DA";
  const fuelLabel = v.fuelType ?? "Petrol";
  const trLabel   = v.transmission ?? "Automatic";
  const odoDisplay = (() => {
    if (v.odometerKm && v.odometerKm > 0)
      return `${v.odometerKm.toLocaleString(undefined, { maximumFractionDigits: 0 })} km`;
    if (odometerKm > 0)
      return `${odometerKm.toLocaleString(undefined, { maximumFractionDigits: 0 })} km`;
    return "— km";
  })();

  return (
    <View style={{ width: CARD_W }}>
      <View style={[styles.card, { backgroundColor: cardBg, borderColor: borderCol, width: "100%", padding: 0, overflow: "hidden" }]}>

        {/* ── Car image — full card width, prominent ── */}
        <View style={[styles.vehicleImgWrap, { backgroundColor: cardBg, width: IMG_W + 32, height: IMG_H + 16 }]}>
          <VehicleImage v={v} width={IMG_W} height={IMG_H} />
          {/* Default badge floats over image */}
          {v.isDefault && (
            <View style={[styles.defaultBadge, { backgroundColor: primary + "DD", position: "absolute", top: 10, left: 10 }]}>
              <Ionicons name="star" size={10} color="#fff" />
              <Text style={[styles.defaultBadgeTxt, { color: "#fff" }]}>Default</Text>
            </View>
          )}
        </View>

        {/* ── Text content ── */}
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
          {/* Name + primary badge */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
            <Text style={[styles.vehicleName, { color: foreground }]} numberOfLines={1}>
              {vehicleDisplayName(v)}
            </Text>
            {v.isDefault && (
              <View style={styles.primaryBadge}>
                <Text style={styles.primaryBadgeTxt}>Primary</Text>
              </View>
            )}
          </View>
          <Text style={[styles.vehicleSub, { color: subText }]}>{fuelLabel} • {trLabel}</Text>

          {/* Odo + Health ring side-by-side */}
          <View style={styles.vehicleInfoRow}>
            {/* Odometer */}
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={[styles.vehicleOdoLabel, { color: subText }]}>Estimated Odometer</Text>
              <Text style={[styles.vehicleOdoValue, { color: foreground }]}>{odoDisplay}</Text>
              <Text style={[styles.vehicleOdoSub, { color: subText }]}>Updated from your trips</Text>
            </View>

            {/* Health ring */}
            <TouchableOpacity
              style={styles.vehicleHealthWrap}
              onPress={() => router.push({ pathname: "/vehicle-care" as any, params: { vehicleId: v.id, isDefault: v.isDefault ? "true" : "false", vehicleName: vehicleDisplayName(v) } })}
              activeOpacity={0.8}
            >
              <View style={{ position: "relative", alignItems: "center", justifyContent: "center" }}>
                <HealthRing pct={healthScore} size={68} strokeColor={healthColor} trackColor={trackColor} />
                <View style={{ position: "absolute", alignItems: "center" }}>
                  <Text style={[styles.healthPct, { color: foreground }]}>{healthScore}%</Text>
                </View>
              </View>
              <Text style={[styles.healthTitle, { color: subText }]}>Health</Text>
              <Text style={[styles.healthLabel, { color: healthColor }]}>{healthLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Action buttons ── */}
        <View style={[styles.vehicleActionRow, { borderTopColor: borderCol, marginHorizontal: 16, marginBottom: 14 }]}>
          <TouchableOpacity
            style={[styles.vehicleActionBtn, { backgroundColor: primary + "18", borderColor: primary + "40" }]}
            onPress={() => onChangeVehicle(index)}
            activeOpacity={0.8}
          >
            <Ionicons name="swap-horizontal-outline" size={15} color={primary} />
            <Text style={[styles.vehicleActionTxt, { color: primary }]}>Change Vehicle</Text>
          </TouchableOpacity>
          {!v.isDefault && (
            <TouchableOpacity
              style={[styles.vehicleActionBtn, { backgroundColor: "#3B82F618", borderColor: "#3B82F640" }]}
              onPress={() => onSetDefault(v.id)}
              activeOpacity={0.8}
            >
              <Ionicons name="star-outline" size={15} color="#3B82F6" />
              <Text style={[styles.vehicleActionTxt, { color: "#3B82F6" }]}>Set as Default</Text>
            </TouchableOpacity>
          )}
          {/* Remove vehicle — always shown */}
          <TouchableOpacity
            style={[styles.vehicleActionBtn, { backgroundColor: "#EF444418", borderColor: "#EF444440", flex: 0, paddingHorizontal: 12 }]}
            onPress={() => onRemove(v.id)}
            activeOpacity={0.8}
          >
            <Ionicons name="trash-outline" size={15} color="#EF4444" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ── "Add Vehicle" slide ───────────────────────────────────────────────────────

function AddVehicleSlide({
  cardBg, borderCol, primary, foreground, subText, onAdd,
}: { cardBg: string; borderCol: string; primary: string; foreground: string; subText: string; onAdd: () => void }) {
  return (
    <View style={{ width: CARD_W }}>
      <TouchableOpacity
        style={[styles.card, styles.addVehicleCard, { backgroundColor: cardBg, borderColor: primary + "40", borderStyle: "dashed" }]}
        onPress={onAdd}
        activeOpacity={0.8}
      >
        <View style={[styles.addVehicleIcon, { backgroundColor: primary + "20" }]}>
          <Ionicons name="add" size={28} color={primary} />
        </View>
        <Text style={[styles.addVehicleTitle, { color: foreground }]}>Add Another Vehicle</Text>
        <Text style={[styles.addVehicleSub, { color: subText }]}>
          Track maintenance and details for all your vehicles
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function GarageScreen() {
  const c = useColors();
  const insets   = useSafeAreaInsets();
  const tabBarH  = Platform.OS === "web" ? 84 : 96;
  const {
    vehicleType, deviceId, vehicleMakeId, vehicleModelId,
    vehicleCustomMakeName, vehicleCustomModelName,
  } = useApp();

  const [sessions,         setSessions]         = useState<DriveSession[]>([]);
  const [filteredSessions, setFilteredSessions] = useState<DriveSession[]>([]);
  const [careStats,  setCareStats]  = useState<VehicleCareStats | null>(null);
  const [odometerKm, setOdometerKm] = useState(0);
  const [vehicles,   setVehicles]   = useState<SavedVehicle[]>([]);
  const [slideIndex, setSlideIndex] = useState(0);
  // Bumped each time the screen is focused; triggers the care stats reload effect.
  const [focusTick, setFocusTick] = useState(0);
  const flatRef = useRef<FlatList>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;

      // Bump tick so the care-stats effect re-runs on every focus
      setFocusTick(t => t + 1);

      // Load drive sessions
      if (deviceId) {
        listDriveSessions(deviceId, 50)
          .then(({ sessions: s }) => { if (alive) setSessions(s); })
          .catch(() => {});
      }

      // Vehicles list — handle pending slot update from car-picker
      (async () => {
        // Check if car-picker just returned with a new selection
        const applied = await applyPendingSlot({
          makeId: vehicleMakeId,
          modelId: vehicleModelId,
          customMakeName: vehicleCustomMakeName,
          customModelName: vehicleCustomModelName,
          vehicleType,
        });

        let list = applied;
        if (!list) {
          // Normal load — seed from AppContext if needed
          list = await ensureVehicles({
            makeId: vehicleMakeId,
            modelId: vehicleModelId,
            customMakeName: vehicleCustomMakeName,
            customModelName: vehicleCustomModelName,
            vehicleType,
          });
          // Always keep slot 0 (default) in sync with AppContext
          if (list.length > 0 && (
            list[0].makeId !== vehicleMakeId || list[0].modelId !== vehicleModelId
          )) {
            list = list.map((v, i) =>
              i === 0
                ? { ...v, makeId: vehicleMakeId, modelId: vehicleModelId,
                    customMakeName: vehicleCustomMakeName, customModelName: vehicleCustomModelName,
                    vehicleType }
                : v
            );
            const { saveVehicles } = await import("@/utils/savedVehicles");
            await saveVehicles(list);
          }
        }
        if (alive) setVehicles(list);
      })();

      return () => { alive = false; };
    }, [deviceId, vehicleMakeId, vehicleModelId, vehicleCustomMakeName, vehicleCustomModelName, vehicleType])
  );

  // ── Per-vehicle session filtering ───────────────────────────────────────────
  // When the user swipes to a different vehicle slide, filter the full session
  // list down to only those recorded for that vehicle via the session map.
  useEffect(() => {
    if (sessions.length === 0 || vehicles.length === 0) {
      setFilteredSessions(sessions);
      return;
    }
    const activeVehicle  = vehicles[Math.min(slideIndex, vehicles.length - 1)] ?? vehicles[0];
    const defaultVehicle = vehicles.find(v => v.isDefault) ?? vehicles[0];
    getSessionsForVehicle(activeVehicle.id, defaultVehicle.id, sessions)
      .then(filtered => setFilteredSessions(filtered))
      .catch(() => setFilteredSessions(sessions));
  }, [sessions, vehicles, slideIndex]);

  // ── Per-vehicle care stats ───────────────────────────────────────────────────
  // Reload Vehicle Care stats whenever the active slide or focus changes so the
  // Upcoming / Overdue / Completed / Spent row reflects the correct vehicle.
  useEffect(() => {
    if (vehicles.length === 0) return;
    const activeVehicle = vehicles[Math.min(slideIndex, vehicles.length - 1)] ?? vehicles[0];
    const storageKey = getCareStorageKey(activeVehicle.id, activeVehicle.isDefault);
    loadVehicleCareData(storageKey).then(data => {
      setCareStats(computeVehicleCareStats(data));
      setOdometerKm(estimatedOdometerKm(data));
    }).catch(() => {});
  }, [vehicles, slideIndex, focusTick]);

  // ── Computed stats ──────────────────────────────────────────────────────────

  const completed   = filteredSessions.filter(s => s.endedAt != null);
  const totalDistKm = completed.reduce((a, s) => a + s.distanceM, 0) / 1000;
  const totalDurS   = completed.reduce((a, s) => a + (s.durationS ?? 0), 0);
  const totalTrips  = completed.length;
  const recentTrips = completed.slice(0, 3);

  const healthScore = careStats?.healthScore ?? 92;
  const healthLabel = careStats?.healthLabel ?? "Good";
  const healthColor =
    healthScore >= 90 ? "#22DD66"
    : healthScore >= 75 ? "#22DD66"
    : healthScore >= 50 ? "#FFB300"
    : "#E5484D";

  const cardBg    = c.isDark ? "#151917" : c.card;
  const borderCol = c.isDark ? "#242B27" : c.tileBorder;
  const subText   = c.mutedForeground;

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleChangeVehicle(slotIndex: number) {
    await setPendingSlot(slotIndex);
    router.push("/car-picker" as any);
  }

  async function handleAddVehicle() {
    await setPendingSlot(-1); // -1 = new slot
    router.push("/car-picker" as any);
  }

  async function handleSetDefault(id: string) {
    const updated = await setDefaultVehicle(id);
    setVehicles(updated);
  }

  function handleRemoveVehicle(id: string) {
    const isLast = vehicles.length === 1;
    const vehicle = vehicles.find(v => v.id === id);
    const name = vehicle
      ? (vehicle.customModelName?.trim() || vehicle.modelId || "this vehicle")
      : "this vehicle";

    if (isLast) {
      // Removing the only vehicle → strong warning about losing Vehicle Care data
      Alert.alert(
        "Remove Last Vehicle?",
        `Removing ${name} will erase all Vehicle Care history — maintenance records, service logs, and cost data — and you won't be able to track your service until you add a vehicle again.\n\nThis cannot be undone.`,
        [
          { text: "Keep Vehicle", style: "cancel" },
          {
            text: "Remove Anyway",
            style: "destructive",
            onPress: async () => {
              const updated = await removeVehicle(id);
              setVehicles(updated);
            },
          },
        ],
      );
    } else {
      // Still have other vehicles → simpler confirm
      Alert.alert(
        "Remove Vehicle",
        `Remove ${name} from your garage?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              const updated = await removeVehicle(id);
              setVehicles(updated);
              // If we removed the slide that was being viewed, snap back
              setSlideIndex(prev => Math.max(0, Math.min(prev, updated.length - 1)));
            },
          },
        ],
      );
    }
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  function renderVehicleItem({ item, index }: { item: SavedVehicle | "add"; index: number }) {
    if (item === "add") {
      return (
        <AddVehicleSlide
          cardBg={cardBg} borderCol={borderCol} primary={c.primary}
          foreground={c.foreground} subText={subText}
          onAdd={handleAddVehicle}
        />
      );
    }
    return (
      <VehicleSlide
        v={item} index={index}
        healthScore={healthScore} healthLabel={healthLabel} healthColor={healthColor}
        odometerKm={odometerKm}
        cardBg={cardBg} borderCol={borderCol} subText={subText} primary={c.primary}
        foreground={c.foreground}
        totalVehicles={vehicles.length}
        onChangeVehicle={handleChangeVehicle}
        onSetDefault={handleSetDefault}
        onRemove={handleRemoveVehicle}
      />
    );
  }

  // Build slide data: vehicles + one "add" slot (up to 4 vehicles total)
  const slideData: (SavedVehicle | "add")[] = [
    ...vehicles,
    ...(vehicles.length < 4 ? (["add"] as const) : []),
  ];

  const activeCount = slideData.length - (slideData[slideData.length - 1] === "add" ? 1 : 0);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: tabBarH + insets.bottom + 24,
        }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Header ── */}
        <View style={[styles.headerRow, { paddingHorizontal: 16 }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.pageTitle, { color: c.foreground }]}>Garage</Text>
            <Text style={[styles.pageSub, { color: subText }]}>
              Your driving hub. Everything about your journeys and your vehicles.
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity
              style={[styles.headerIconBtn, { backgroundColor: cardBg, borderColor: borderCol }]}
              onPress={() => {}}
            >
              <Ionicons name="notifications-outline" size={20} color={c.foreground} />
              <View style={styles.notifDot} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.headerIconBtn, { backgroundColor: cardBg, borderColor: borderCol }]}
              onPress={() => router.push("/(tabs)/profile")}
            >
              <Ionicons name="settings-outline" size={20} color={c.foreground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── My Vehicles — horizontal swipeable slides ── */}
        <View style={{ marginBottom: 16 }}>
          {/* Section header */}
          <View style={[styles.sectionHeaderRow, { paddingHorizontal: 16, marginBottom: 10 }]}>
            <Text style={[styles.sectionTitle, { color: c.foreground }]}>My Vehicles</Text>
            <TouchableOpacity onPress={() => router.push("/car-picker" as any)}>
              <Text style={[styles.viewAllLink, { color: c.primary }]}>View all</Text>
            </TouchableOpacity>
          </View>

          {/* Swipeable slides */}
          <FlatList
            ref={flatRef}
            data={slideData}
            keyExtractor={(item, i) =>
              item === "add" ? "add" : (item as SavedVehicle).id
            }
            renderItem={renderVehicleItem}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            snapToInterval={CARD_W + 12}
            decelerationRate="fast"
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            onMomentumScrollEnd={e => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / (CARD_W + 12));
              setSlideIndex(idx);
            }}
          />

          {/* Pagination dots */}
          <View style={[styles.dotRow, { marginTop: 12 }]}>
            {slideData.map((_, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => {
                  flatRef.current?.scrollToIndex({ index: i, animated: true });
                  setSlideIndex(i);
                }}
              >
                <View style={[
                  styles.dot,
                  i === slideIndex
                    ? [styles.dotActive, { backgroundColor: c.primary }]
                    : { backgroundColor: c.isDark ? "#2A3530" : "#D0D8D4" },
                ]} />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Garage Overview — 3 items, 1 row ── */}
        <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: borderCol }]}>
            {/* Header: title + vehicle context pill when not on default slide */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <Text style={[styles.sectionTitle, { color: c.foreground }]}>
                Garage Overview
              </Text>
              {vehicles.length > 1 && vehicles[slideIndex] && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4,
                  backgroundColor: c.primary + "18", borderRadius: 12,
                  paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Ionicons name="car-outline" size={11} color={c.primary} />
                  <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: c.primary }} numberOfLines={1}>
                    {vehicleDisplayName(vehicles[slideIndex])}
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.overviewRow}>
              {/* Total Distance */}
              <View style={[styles.overviewTile, { borderRightWidth: 1, borderRightColor: borderCol }]}>
                <View style={[styles.overviewIcon, { backgroundColor: c.primary + "20" }]}>
                  <Ionicons name="navigate-outline" size={20} color={c.primary} />
                </View>
                <Text style={[styles.overviewValue, { color: c.foreground }]} numberOfLines={1}>
                  {totalDistKm >= 1000
                    ? `${(totalDistKm / 1000).toFixed(1)}k`
                    : totalDistKm.toFixed(0)} km
                </Text>
                <Text style={[styles.overviewLabel, { color: subText }]}>Total Distance</Text>
              </View>

              {/* Total Drive Time */}
              <View style={[styles.overviewTile, { borderRightWidth: 1, borderRightColor: borderCol }]}>
                <View style={[styles.overviewIcon, { backgroundColor: "#F9731620" }]}>
                  <Ionicons name="time-outline" size={20} color="#F97316" />
                </View>
                <Text style={[styles.overviewValue, { color: c.foreground }]} numberOfLines={1}>
                  {fmtDur(totalDurS)}
                </Text>
                <Text style={[styles.overviewLabel, { color: subText }]}>Total Drive Time</Text>
              </View>

              {/* Total Trips */}
              <View style={styles.overviewTile}>
                <View style={[styles.overviewIcon, { backgroundColor: "#A855F720" }]}>
                  <Ionicons name="git-network-outline" size={20} color="#A855F7" />
                </View>
                <Text style={[styles.overviewValue, { color: c.foreground }]}>{totalTrips}</Text>
                <Text style={[styles.overviewLabel, { color: subText }]}>Total Trips</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ── Garage Tools — 3 items, 1 row ── */}
        <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: borderCol }]}>
            <Text style={[styles.sectionTitle, { color: c.foreground, marginBottom: 14 }]}>
              Garage Tools
            </Text>
            <View style={styles.toolsRow}>
              {TOOLS.map(tool => (
                <TouchableOpacity
                  key={tool.key}
                  style={[styles.toolTile, { backgroundColor: c.isDark ? "#1A2020" : "#F4F6F4" }]}
                  onPress={() => router.push(tool.href as any)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.toolIconWrap, { backgroundColor: tool.bg }]}>
                    <Ionicons name={tool.icon as any} size={24} color={tool.color} />
                  </View>
                  <Text style={[styles.toolLabel, { color: c.foreground }]} numberOfLines={2}>
                    {tool.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* ── Vehicle Care banner ── */}
        <View style={{ marginHorizontal: 16, marginBottom: 8 }}>
          <LinearGradient
            colors={c.isDark ? ["#0F1F15", "#0B1A10"] : ["#EAF7EE", "#D4F0DC"]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={[styles.careBanner, { borderColor: c.primary + "30" }]}
          >
            <View style={[styles.careIconWrap, { backgroundColor: c.primary + "25" }]}>
              <Ionicons name="heart-outline" size={24} color={c.primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.careBannerText, { color: c.foreground }]}>
                Track maintenance, get reminders{"\n"}and keep your vehicle in top shape.
              </Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 6 }}>
              <TouchableOpacity
                style={[styles.openCareBtn, { backgroundColor: c.primary }]}
                onPress={() => {
                  const av = vehicles[Math.min(slideIndex, vehicles.length - 1)] ?? vehicles[0];
                  router.push({ pathname: "/vehicle-care" as any, params: { vehicleId: av?.id, isDefault: av?.isDefault ? "true" : "false", vehicleName: av ? vehicleDisplayName(av) : undefined } });
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.openCareBtnTxt}>Open Vehicle Care</Text>
              </TouchableOpacity>
              <Ionicons name="clipboard-outline" size={22} color={c.primary + "80"} />
            </View>
          </LinearGradient>
        </View>

        {/* Vehicle Care mini-stats */}
        <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: borderCol, paddingVertical: 12 }]}>
            <View style={styles.careStatsRow}>
              <View style={[styles.careStatTile, { borderRightWidth: 1, borderRightColor: borderCol }]}>
                <Text style={[styles.careStatValue, { color: c.foreground }]}>
                  {careStats?.upcoming30Days ?? "—"}
                </Text>
                <Text style={[styles.careStatTitle, { color: subText }]}>Upcoming</Text>
                <Text style={[styles.careStatSub, { color: subText }]}>Next 30 days</Text>
              </View>
              <View style={[styles.careStatTile, { borderRightWidth: 1, borderRightColor: borderCol }]}>
                <Text style={[styles.careStatValue, {
                  color: (careStats?.overdue ?? 0) > 0 ? "#FFB300" : c.foreground,
                }]}>
                  {careStats?.overdue ?? "—"}
                </Text>
                <Text style={[styles.careStatTitle, {
                  color: (careStats?.overdue ?? 0) > 0 ? "#FFB300" : subText,
                }]}>Overdue</Text>
                <Text style={[styles.careStatSub, {
                  color: (careStats?.overdue ?? 0) > 0 ? "#FFB300" : subText,
                }]}>
                  {(careStats?.overdue ?? 0) > 0 ? "Needs attention" : "All good"}
                </Text>
              </View>
              <View style={[styles.careStatTile, { borderRightWidth: 1, borderRightColor: borderCol }]}>
                <Text style={[styles.careStatValue, { color: c.foreground }]}>
                  {careStats?.completedThisYear ?? "—"}
                </Text>
                <Text style={[styles.careStatTitle, { color: subText }]}>Completed</Text>
                <Text style={[styles.careStatSub, { color: subText }]}>This year</Text>
              </View>
              <View style={styles.careStatTile}>
                <Text style={[styles.careStatValue, { color: c.foreground, fontSize: 13 }]} numberOfLines={1}>
                  {careStats?.spentLast12MonthsKSh
                    ? `KSh ${careStats.spentLast12MonthsKSh.toLocaleString()}`
                    : "—"}
                </Text>
                <Text style={[styles.careStatTitle, { color: subText }]}>Spent</Text>
                <Text style={[styles.careStatSub, { color: subText }]}>Last 12 months</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ── Recent Trips ── */}
        <View style={{ marginHorizontal: 16 }}>
          <View style={[styles.sectionHeaderRow, { marginBottom: 12 }]}>
            <Text style={[styles.sectionTitle, { color: c.foreground }]}>Recent Trips</Text>
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/trips" as any)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.viewAllLink, { color: c.primary }]}>View all</Text>
            </TouchableOpacity>
          </View>

          <View style={{ gap: 10 }}>
            {recentTrips.length === 0 ? (
              <View style={[styles.card, {
                backgroundColor: cardBg, borderColor: borderCol,
                flexDirection: "row", alignItems: "center", gap: 10,
              }]}>
                <Ionicons name="car-outline" size={20} color={subText} />
                <Text style={[styles.emptyTxt, { color: subText }]}>No trips recorded yet</Text>
              </View>
            ) : (
              recentTrips.map(t => (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.tripRow, { backgroundColor: cardBg, borderColor: borderCol }]}
                  onPress={() => router.push("/(tabs)/trips" as any)}
                  activeOpacity={0.8}
                >
                  <TripThumb color={c.primary} />
                  <View style={{ flex: 1, minWidth: 0, justifyContent: "center" }}>
                    <Text style={[styles.tripDate, { color: subText }]} numberOfLines={1}>
                      {tripDateLabel(t.startedAt)}
                    </Text>
                    <Text style={[styles.tripRoute, { color: c.foreground }]} numberOfLines={1}>
                      Nairobi → CBD
                    </Text>
                    <Text style={[styles.tripStats, { color: subText }]} numberOfLines={1}>
                      {t.distanceM >= 1000
                        ? `${(t.distanceM / 1000).toFixed(1)} km`
                        : `${Math.round(t.distanceM)} m`}
                      {" · "}{t.durationS ? fmtDur(t.durationS) : "—"}
                      {t.avgSpeedKmh ? ` · Avg ${Math.round(t.avgSpeedKmh)} km/h` : ""}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    {t.score != null && (
                      <View style={[styles.scoreRing, { borderColor: scoreColor(t.score) }]}>
                        <Text style={[styles.scoreRingTxt, { color: c.foreground }]}>{t.score}</Text>
                      </View>
                    )}
                    <Ionicons name="chevron-forward" size={16} color={subText} />
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        </View>

      </ScrollView>
    </View>
  );
}

// ── Garage Tools config ───────────────────────────────────────────────────────

const TOOLS = [
  {
    key: "history",
    icon: "map-outline",
    label: "Trip\nHistory",
    color: "#3B82F6",
    bg: "#3B82F620",
    href: "/trip-history",
  },
  {
    key: "dashcam",
    icon: "videocam-outline",
    label: "Dashcam\nVideos",
    color: "#EF4444",
    bg: "#EF444420",
    href: "/dashcam-clips",
  },
  {
    key: "accident",
    icon: "car-sport-outline",
    label: "Accident\nReports",
    color: "#EF4444",
    bg: "#EF444420",
    href: "/crash-vault",
  },
];

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row", alignItems: "flex-start",
    justifyContent: "space-between", marginBottom: 20,
  },
  pageTitle: { fontSize: 28, fontFamily: "Inter_700Bold" },
  pageSub:   { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3, lineHeight: 18 },
  headerIconBtn: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  notifDot: {
    position: "absolute", top: 7, right: 7,
    width: 8, height: 8, borderRadius: 4, backgroundColor: "#EF4444",
  },

  card: { borderRadius: 18, borderWidth: 1, padding: 16 },

  sectionHeaderRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  viewAllLink:  { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  // My Vehicles — stacked layout (image on top, info below)
  defaultBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20,
    alignSelf: "flex-start",
  },
  defaultBadgeTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  // Image strip — fills full card width, aligned center
  vehicleImgWrap: {
    alignItems: "center", justifyContent: "center", overflow: "hidden",
  },

  // Info row: odo info flex-left | health ring fixed-right
  vehicleInfoRow: {
    flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10, marginBottom: 4,
  },

  vehicleName: { fontSize: 15, fontFamily: "Inter_700Bold", flexShrink: 1 },
  primaryBadge: {
    backgroundColor: "#3B82F620", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6,
  },
  primaryBadgeTxt: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#3B82F6" },
  vehicleSub:      { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  vehicleOdoLabel: { fontSize: 10, fontFamily: "Inter_500Medium", marginTop: 2 },
  vehicleOdoValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  vehicleOdoSub:   { fontSize: 10, fontFamily: "Inter_400Regular" },

  vehicleHealthWrap: { alignItems: "center", gap: 2 },
  healthPct:   { fontSize: 13, fontFamily: "Inter_700Bold" },
  healthTitle: { fontSize: 9,  fontFamily: "Inter_500Medium", textAlign: "center" },
  healthLabel: { fontSize: 10, fontFamily: "Inter_700Bold" },

  vehicleActionRow: {
    flexDirection: "row", gap: 8,
    paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth,
  },
  vehicleActionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 9, borderRadius: 12, borderWidth: 1,
  },
  vehicleActionTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  // Add vehicle slide
  addVehicleCard: {
    alignItems: "center", justifyContent: "center",
    minHeight: 160, gap: 10,
  },
  addVehicleIcon: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: "center", justifyContent: "center",
  },
  addVehicleTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  addVehicleSub:   { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },

  // Dots
  dotRow: { flexDirection: "row", justifyContent: "center", gap: 5 },
  dot:    { height: 6, borderRadius: 3, width: 6 },
  dotActive: { width: 18 },

  // Garage Overview — 3 cols in one row
  overviewRow:   { flexDirection: "row" },
  overviewTile:  { flex: 1, alignItems: "center", gap: 6, paddingVertical: 4 },
  overviewIcon:  { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  overviewValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  overviewLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textAlign: "center" },

  // Garage Tools — 3 cols in one row
  toolsRow: { flexDirection: "row", gap: 10 },
  toolTile: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingVertical: 14, borderRadius: 14, gap: 8,
  },
  toolIconWrap: {
    width: 52, height: 52, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  toolLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textAlign: "center", lineHeight: 15 },

  // Vehicle Care banner
  careBanner: {
    borderRadius: 16, borderWidth: 1, padding: 14,
    flexDirection: "row", alignItems: "center", gap: 10,
  },
  careIconWrap:   { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  careBannerText: { fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 18 },
  openCareBtn:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  openCareBtnTxt: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },

  // Care mini-stats
  careStatsRow:  { flexDirection: "row" },
  careStatTile:  { flex: 1, alignItems: "center", paddingVertical: 4 },
  careStatValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  careStatTitle: { fontSize: 10, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  careStatSub:   { fontSize: 9,  fontFamily: "Inter_400Regular", textAlign: "center" },

  // Recent Trips
  tripRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 16, borderWidth: 1, padding: 12,
  },
  tripDate:  { fontSize: 11, fontFamily: "Inter_500Medium", marginBottom: 2 },
  tripRoute: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  tripStats: { fontSize: 11, fontFamily: "Inter_400Regular" },
  scoreRing: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 2.5,
    alignItems: "center", justifyContent: "center",
  },
  scoreRingTxt: { fontSize: 13, fontFamily: "Inter_700Bold" },
  emptyTxt: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
});
