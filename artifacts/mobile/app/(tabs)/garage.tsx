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
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Circle, Polyline, Rect } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { useVehicle } from "@/context/VehicleContext";
import {
  DriveSession,
  listDriveSessions,
  scoreColor,
  formatDuration,
} from "@/utils/driveSessionApi";
import { getCarImageUrl, getMakeById, getModelById } from "@/data/carModels";
import { getVehicleFallbackImage, slugify } from "@/lib/vehicleImageFallback";
import CarLogoImage from "@/components/CarLogoImage";
import { API_BASE } from "@/utils/apiClient";
import {
  loadVehicleCareData,
  saveVehicleCareData,
  computeVehicleCareStats,
  getCareStorageKey,
  swapCareDataForDefaultChange,
  reAnchorServiceRecords,
  VehicleCareStats,
  estimatedOdometerKm,
} from "@/utils/vehicleCare";
import {
  SavedVehicle,
  ensureVehicles,
  applyPendingSlot,
  setPendingSlot,
  setDefaultVehicle,
  removeVehicle,
  updateVehicleDetails,
  normalizePlate,
  type VehicleDetails,
} from "@/utils/savedVehicles";
// vehicleSessionMap removed — sessions are now filtered server-side via vehicleId param
import {
  TripLocationMap,
  loadTripLocationCache,
} from "@/utils/tripLocationCache";
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
  // Known static make + custom/unknown model (e.g. Volkswagen + "Arteon")
  if (make && v.customModelName) return `${make.name} ${v.customModelName}`;
  // Fully custom make + model
  if (v.customMakeName && v.customModelName) return `${v.customMakeName} ${v.customModelName}`;
  if (v.customMakeName) return v.customMakeName;
  if (make) return make.name;
  return "My Vehicle";
}

function tripDateLabel(iso: string): string {
  const d    = new Date(iso);
  const now  = new Date();
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  const EAT = "Africa/Nairobi";
  const fmtDate = (dt: Date) => dt.toLocaleDateString("en-KE", { timeZone: EAT, year: "numeric", month: "2-digit", day: "2-digit" });
  const time = d.toLocaleTimeString("en-KE", { hour: "numeric", minute: "2-digit", timeZone: EAT });
  if (fmtDate(d) === fmtDate(now))    return `Today, ${time}`;
  if (fmtDate(d) === fmtDate(yest))   return `Yesterday, ${time}`;
  return `${d.toLocaleDateString("en-KE", { month: "short", day: "numeric", timeZone: EAT })}, ${time}`;
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

  const isMakeCustom  = !v.makeId  || v.makeId.startsWith("custom-");
  const isModelCustom = !v.modelId || v.modelId.startsWith("custom-");

  // phase 0 = real model image, phase 1 = make silhouette (known make only), phase 2 = local PNG
  const [phase,   setPhase]   = useState(0);
  const [loading, setLoading] = useState(true);
  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (retryTimer.current) clearTimeout(retryTimer.current); };
  }, []);

  // Build the best R2 URL for the current phase.
  // Custom makes/models: use the slugified display name so it matches the R2
  // key the server wrote (e.g. "arteon", not a raw timestamp ID).
  let uri: string | null = null;
  if (phase === 0) {
    if (isMakeCustom) {
      if (v.customMakeName && v.customModelName)
        uri = getCarImageUrl(slugify(v.customMakeName), slugify(v.customModelName));
    } else if (isModelCustom) {
      if (v.customModelName)
        uri = getCarImageUrl(v.makeId!, slugify(v.customModelName));
    } else {
      uri = getCarImageUrl(v.makeId!, v.modelId!);
    }
  } else if (phase === 1 && !isMakeCustom) {
    const fallback = firstStandardModel(v.makeId!);
    if (fallback) uri = getCarImageUrl(v.makeId!, fallback);
  }

  // No URL or all phases exhausted → type-specific PNG silhouette (never emoji)
  if (!uri) {
    return (
      <Image
        source={getVehicleFallbackImage(v.vehicleType)}
        style={{ width, height }}
        resizeMode="contain"
      />
    );
  }

  function handleError() {
    setLoading(false);
    if (phase === 0 && (isModelCustom || isMakeCustom) && retryCount.current < 4) {
      // Custom image may still be processing — poll every 15 s
      retryCount.current += 1;
      retryTimer.current = setTimeout(() => {
        setLoading(true);
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
        key={`${uri}-${retryCount.current}`}
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
  onSetDefault: (id: string) => void;
  onRemove: (id: string) => void;
  onEdit: (v: SavedVehicle) => void;
}

// Image fills the card width minus horizontal padding
const IMG_W = CARD_W - 32;
const IMG_H = 140; // Compact, intentional — leaves room for info below

function VehicleSlide({
  v, index, healthScore, healthLabel, healthColor,
  odometerKm, cardBg, borderCol, subText, primary, foreground,
  totalVehicles, onSetDefault, onRemove, onEdit,
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

        {/* ── Hero image strip — tinted, compact ── */}
        <View style={{ height: IMG_H + 24, backgroundColor: primary + "0D", alignItems: "center", justifyContent: "center" }}>
          <VehicleImage v={v} width={IMG_W - 16} height={IMG_H} />
          {/* Default star badge — top-left */}
          {v.isDefault && (
            <View style={[styles.defaultBadge, { backgroundColor: primary, position: "absolute", top: 10, left: 12 }]}>
              <Ionicons name="star" size={10} color="#fff" />
              <Text style={[styles.defaultBadgeTxt, { color: "#fff" }]}>Default</Text>
            </View>
          )}
          {/* Health ring — top-right floating */}
          <TouchableOpacity
            style={{ position: "absolute", top: 8, right: 12, alignItems: "center" }}
            onPress={() => router.push({ pathname: "/vehicle-care" as any, params: { vehicleId: v.id, isDefault: v.isDefault ? "true" : "false", vehicleName: vehicleDisplayName(v) } })}
            activeOpacity={0.8}
          >
            <View style={{ position: "relative", alignItems: "center", justifyContent: "center" }}>
              <HealthRing pct={healthScore} size={52} strokeColor={healthColor} trackColor={trackColor} />
              <View style={{ position: "absolute", alignItems: "center" }}>
                <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold" as const, color: foreground }}>{healthScore}%</Text>
              </View>
            </View>
            <Text style={{ fontSize: 9, fontFamily: "Inter_600SemiBold" as const, color: healthColor, marginTop: 2 }}>{healthLabel}</Text>
          </TouchableOpacity>
        </View>

        {/* ── Identity row ── */}
        <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
            {v.makeId && !v.makeId.startsWith("custom-") && (
              <CarLogoImage makeId={v.makeId} width={28} height={20} emoji={getVehicleEmoji(v.vehicleType)} />
            )}
            <Text style={[styles.vehicleName, { color: foreground, flex: 1 }]} numberOfLines={1}>
              {vehicleDisplayName(v)}
            </Text>
          </View>

          {/* Spec chips row */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            <View style={[styles.specChip, { backgroundColor: primary + "15", borderColor: primary + "35" }]}>
              <Ionicons name="water-outline" size={11} color={primary} />
              <Text style={[styles.specChipTxt, { color: primary }]}>{fuelLabel}</Text>
            </View>
            <View style={[styles.specChip, { backgroundColor: subText + "15", borderColor: subText + "25" }]}>
              <Ionicons name="options-outline" size={11} color={subText} />
              <Text style={[styles.specChipTxt, { color: subText }]}>{trLabel}</Text>
            </View>
            {v.plateNumber ? (
              <View style={[styles.specChip, { backgroundColor: subText + "10", borderColor: subText + "20" }]}>
                <Ionicons name="card-outline" size={11} color={subText} />
                <Text style={[styles.specChipTxt, { color: subText }]}>{v.plateNumber}</Text>
              </View>
            ) : null}
          </View>

          {/* Odometer */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 }}>
            <Ionicons name="speedometer-outline" size={14} color={subText} />
            <View>
              <Text style={[styles.vehicleOdoValue, { color: foreground, fontSize: 16 }]}>{odoDisplay}</Text>
              <Text style={[styles.vehicleOdoSub, { color: subText }]}>Estimated odometer · updated from trips</Text>
            </View>
          </View>
        </View>

        {/* ── Action strip ── */}
        <View style={[styles.vehicleActionRow, { borderTopColor: borderCol, marginHorizontal: 14, marginBottom: 12 }]}>
          {!v.isDefault && (
            <TouchableOpacity
              style={[styles.vehicleActionBtn, { backgroundColor: "#3B82F614", borderColor: "#3B82F635" }]}
              onPress={() => onSetDefault(v.id)}
              activeOpacity={0.8}
            >
              <Ionicons name="star-outline" size={14} color="#3B82F6" />
              <Text style={[styles.vehicleActionTxt, { color: "#3B82F6" }]}>Set Default</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.vehicleActionBtn, { backgroundColor: "#22C55E14", borderColor: "#22C55E35" }]}
            onPress={() => onEdit(v)}
            activeOpacity={0.8}
          >
            <Ionicons name="pencil-outline" size={14} color="#22C55E" />
            <Text style={[styles.vehicleActionTxt, { color: "#22C55E" }]}>Edit Details</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ── Edit Vehicle Details Modal ────────────────────────────────────────────────

const FUEL_OPTIONS = ["Petrol", "Diesel", "Electric", "Hybrid", "CNG"] as const;
const TRANS_OPTIONS = ["Automatic", "Manual"] as const;

function EditVehicleModal({
  vehicle, visible, onClose, onSaved,
  cardBg, borderCol, primary, foreground, subText,
}: {
  vehicle: SavedVehicle | null;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  cardBg: string;
  borderCol: string;
  primary: string;
  foreground: string;
  subText: string;
}) {
  const c = useColors();
  const [fuelType,     setFuelType]     = useState<SavedVehicle["fuelType"]>(undefined);
  const [transmission, setTransmission] = useState<SavedVehicle["transmission"]>(undefined);
  const [odoText,      setOdoText]      = useState("");
  const [plate,        setPlate]        = useState("");
  const [saving,       setSaving]       = useState(false);

  // Populate from vehicle whenever it changes
  useEffect(() => {
    if (!vehicle) return;
    setFuelType(vehicle.fuelType);
    setTransmission(vehicle.transmission);
    setOdoText(vehicle.odometerKm != null && vehicle.odometerKm > 0 ? String(vehicle.odometerKm) : "");
    setPlate(vehicle.plateNumber ?? "");
  }, [vehicle?.id, visible]);

  async function handleSave() {
    if (!vehicle) return;

    const odo = odoText.trim() ? parseFloat(odoText.replace(/,/g, "")) : undefined;
    const currentOdo = vehicle.odometerKm;

    // Warn when the new reading is lower than the stored one — silent typos
    // (e.g. 5 000 instead of 50 000) would corrupt service-interval reminders.
    if (
      odo != null && !isNaN(odo) && odo >= 0 &&
      currentOdo != null && currentOdo > 0 &&
      odo < currentOdo
    ) {
      Alert.alert(
        "Lower than current reading",
        `Your saved odometer is ${currentOdo.toLocaleString(undefined, { maximumFractionDigits: 0 })} km. Entering ${odo.toLocaleString(undefined, { maximumFractionDigits: 0 })} km will set it lower — this may affect service reminders.\n\nAre you sure?`,
        [
          { text: "Go back", style: "cancel" },
          { text: "Yes, save anyway", style: "destructive", onPress: () => commitSave(odo) },
        ],
      );
      return;
    }

    await commitSave(odo);
  }

  async function commitSave(odo: number | undefined) {
    if (!vehicle) return;
    setSaving(true);
    try {
      const details: VehicleDetails = {};
      if (fuelType     !== undefined) details.fuelType     = fuelType;
      if (transmission !== undefined) details.transmission = transmission;
      if (odo != null && !isNaN(odo) && odo >= 0) details.odometerKm = odo;
      details.plateNumber = normalizePlate(plate) || undefined;
      await updateVehicleDetails(vehicle.id, details);

      // When the odometer is manually corrected, reset trip accumulation so
      // the estimated reading doesn't double-count km driven before the edit.
      if (odo != null && !isNaN(odo) && odo >= 0) {
        const careKey = getCareStorageKey(vehicle.id, vehicle.isDefault);
        let careData = await loadVehicleCareData(careKey);

        // Check whether any service records are now "above" the new reading.
        // This happens after a downward correction and leaves km-based reminders
        // in a "corrected" (inconsistent) state.  Offer to re-anchor them now.
        const staleCount = careData.records.filter(r => r.mileageKm > odo).length;
        if (staleCount > 0) {
          // Finish the regular save first so the odometer update is not lost
          // if the user dismisses the dialog.
          careData.initialOdometerKm = odo;
          careData.tripAccumulatedKm = 0;
          await saveVehicleCareData(careData, careKey);

          onSaved();
          onClose();

          // Prompt after closing the modal so it doesn't stack on top
          setTimeout(() => {
            Alert.alert(
              "Re-anchor service records?",
              `${staleCount} service record${staleCount > 1 ? "s were" : " was"} logged above ` +
              `${odo.toLocaleString(undefined, { maximumFractionDigits: 0 })} km. ` +
              `Reset ${staleCount > 1 ? "their" : "its"} mileage to the new odometer so reminders calculate correctly?`,
              [
                { text: "Keep as-is", style: "cancel" },
                {
                  text: "Reset mileage",
                  onPress: async () => {
                    const freshData = await loadVehicleCareData(careKey);
                    await saveVehicleCareData(reAnchorServiceRecords(freshData, odo), careKey);
                    onSaved();
                  },
                },
              ],
            );
          }, 400);
          return;
        }

        careData.initialOdometerKm = odo;
        careData.tripAccumulatedKm = 0;
        await saveVehicleCareData(careData, careKey);
      }

      onSaved();
      onClose();
    } catch {
      Alert.alert("Error", "Could not save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const inputBg   = c.isDark ? "#1A211C" : "#F4F6F4";
  const chipStyle = (selected: boolean) => ({
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1.5,
    backgroundColor: selected ? primary + "22" : inputBg,
    borderColor: selected ? primary : borderCol,
  });
  const chipTxtStyle = (selected: boolean) => ({
    fontSize: 13, fontFamily: "Inter_600SemiBold" as const,
    color: selected ? primary : subText,
  });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#00000070" }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={{
            backgroundColor: c.isDark ? "#111714" : "#fff",
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            paddingHorizontal: 20, paddingBottom: 36, paddingTop: 8,
          }}>
            {/* Handle pill */}
            <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2,
              backgroundColor: borderCol, marginBottom: 16 }} />

            <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: foreground, marginBottom: 4 }}>
              Edit Vehicle Details
            </Text>
            <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: subText, marginBottom: 20, lineHeight: 18 }}>
              Update the specifics for{" "}
              <Text style={{ fontFamily: "Inter_600SemiBold", color: foreground }}>
                {vehicle ? vehicleDisplayName(vehicle) : "this vehicle"}
              </Text>
              {". Make and model cannot be changed here to protect your trip history."}
            </Text>

            {/* Plate number */}
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: subText, marginBottom: 6 }}>
              Plate Number
            </Text>
            <TextInput
              value={plate}
              onChangeText={t => setPlate(t.toUpperCase())}
              placeholder="e.g. KCB 123A"
              placeholderTextColor={subText + "88"}
              autoCapitalize="characters"
              style={{
                backgroundColor: inputBg, borderRadius: 12, borderWidth: 1,
                borderColor: borderCol, paddingHorizontal: 14, paddingVertical: 11,
                color: foreground, fontFamily: "Inter_500Medium", fontSize: 14,
                marginBottom: 18,
              }}
            />

            {/* Fuel type */}
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: subText, marginBottom: 8 }}>
              Fuel Type
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
              {FUEL_OPTIONS.map(opt => (
                <TouchableOpacity key={opt} style={chipStyle(fuelType === opt)} onPress={() => setFuelType(opt)} activeOpacity={0.8}>
                  <Text style={chipTxtStyle(fuelType === opt)}>{opt}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Transmission */}
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: subText, marginBottom: 8 }}>
              Transmission
            </Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 18 }}>
              {TRANS_OPTIONS.map(opt => (
                <TouchableOpacity key={opt} style={chipStyle(transmission === opt)} onPress={() => setTransmission(opt)} activeOpacity={0.8}>
                  <Text style={chipTxtStyle(transmission === opt)}>{opt}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Odometer */}
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: subText, marginBottom: 6 }}>
              Current Odometer (km)
            </Text>
            <TextInput
              value={odoText}
              onChangeText={setOdoText}
              placeholder="e.g. 52000"
              placeholderTextColor={subText + "88"}
              keyboardType="numeric"
              style={{
                backgroundColor: inputBg, borderRadius: 12, borderWidth: 1,
                borderColor: borderCol, paddingHorizontal: 14, paddingVertical: 11,
                color: foreground, fontFamily: "Inter_500Medium", fontSize: 14,
                marginBottom: 24,
              }}
            />

            {/* Buttons */}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity
                onPress={onClose}
                style={{
                  flex: 1, paddingVertical: 13, borderRadius: 14, borderWidth: 1,
                  borderColor: borderCol, alignItems: "center",
                }}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: subText }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                disabled={saving}
                style={{
                  flex: 2, paddingVertical: 13, borderRadius: 14,
                  backgroundColor: primary, alignItems: "center",
                  opacity: saving ? 0.6 : 1,
                }}
                activeOpacity={0.85}
              >
                <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" }}>
                  {saving ? "Saving…" : "Save Changes"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
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
    setVehicleModel, setCustomVehicle, setVehicleType,
  } = useApp();

  const [filteredSessions, setFilteredSessions] = useState<DriveSession[]>([]);
  const [locationCache,    setLocationCache]    = useState<TripLocationMap>({});
  const [careStats,  setCareStats]  = useState<VehicleCareStats | null>(null);
  const [odometerKm, setOdometerKm] = useState(0);
  const [slideIndex, setSlideIndex] = useState(0);
  // Bumped each time the screen is focused; triggers the care stats reload effect.
  const [focusTick, setFocusTick] = useState(0);
  const flatRef = useRef<FlatList>(null);

  // Edit vehicle details modal
  const [editTarget, setEditTarget] = useState<SavedVehicle | null>(null);
  const [editVisible, setEditVisible] = useState(false);

  function handleEditVehicle(v: SavedVehicle) {
    setEditTarget(v);
    setEditVisible(true);
  }

  // ── VehicleContext — single source of truth for the vehicle list ─────────
  // Reading vehicles directly from context eliminates the local duplicate and
  // prevents the local list and context list from drifting apart after any
  // mutation (add / remove / set-default). The garage writes to VehicleContext
  // via setActiveVehicle / refreshVehicles; all other screens read from it.
  const { vehicles, setActiveVehicle, refreshVehicles, primaryVehicleId } = useVehicle();

  // Clamp slideIndex to the live vehicle count so removing a vehicle can never
  // leave the carousel pointing at a now-missing slot. Used for all data
  // lookups and rendering; slideIndex state is also healed asynchronously by
  // the effect below so subsequent swipe math starts from the right position.
  const clampedSlideIndex = vehicles.length > 0
    ? Math.min(slideIndex, vehicles.length - 1)
    : 0;

  // Heal slideIndex state whenever vehicles shrinks (e.g. after a removal).
  useEffect(() => {
    if (vehicles.length === 0) return;
    const maxIdx = vehicles.length - 1;
    if (slideIndex > maxIdx) {
      setSlideIndex(maxIdx);
      flatRef.current?.scrollToIndex({ index: maxIdx, animated: false });
    }
  }, [vehicles.length]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;

      // Bump tick so the care-stats effect re-runs on every focus
      setFocusTick(t => t + 1);

      // Load location cache (sessions are fetched per-vehicle via the effect below)
      if (deviceId) {
        loadTripLocationCache()
          .then((locCache) => { if (alive) setLocationCache(locCache); })
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
          // Keep slot 0 in sync with AppContext, BUT only when there is a
          // single vehicle. With multiple vehicles AppContext may still hold a
          // non-default vehicle's data (e.g. right after the user added a new
          // vehicle via car-picker, which writes its make/model into AppContext).
          // Running the sync in that case would overwrite the default vehicle
          // with the new vehicle's data — the data-exchange bug.
          if (list.length === 1 && (
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
        if (alive) {
          // Refresh VehicleContext — it reads from AsyncStorage (where the mutations
          // above already persisted the list) and pushes fresh data to all consumers.
          // No separate local setVehicles needed — vehicles comes from context now.
          refreshVehicles().catch(() => {});
        }
      })();

      return () => { alive = false; };
    }, [deviceId, vehicleMakeId, vehicleModelId, vehicleCustomMakeName, vehicleCustomModelName, vehicleType])
  );

  // ── Per-vehicle session fetch ────────────────────────────────────────────────
  // Fetch sessions from the server scoped to the vehicle currently shown on the
  // garage slide. focusTick re-triggers on every screen focus so new sessions
  // recorded during a drive appear immediately without a manual pull-to-refresh.
  // The default vehicle also includes legacy rows where vehicle_id IS NULL so
  // pre-tracking trips still appear in its history.
  //
  // Generation counter: each effect invocation increments `sessionsFetchGen`.
  // The response handler checks that its generation is still the latest before
  // writing state, so rapid swipes can never let an older (slower) response
  // overwrite data for the most recently selected vehicle.
  const sessionsFetchGen = useRef(0);
  useEffect(() => {
    if (!deviceId || vehicles.length === 0) return;
    const slideVehicle = vehicles[clampedSlideIndex] ?? vehicles[0];
    // Clear immediately so stale data from the previous vehicle never lingers
    setFilteredSessions([]);
    const gen = ++sessionsFetchGen.current;
    listDriveSessions(
      deviceId,
      100,
      0,
      slideVehicle.id,
      // Always attach unattributed (NULL vehicleId) sessions to the first vehicle
      // ever created — never to whichever happens to be the current default.
      // This prevents trip history from jumping around when the default changes.
      slideVehicle.id === primaryVehicleId,
    )
      .then(({ sessions }) => {
        if (gen !== sessionsFetchGen.current) return; // stale — a newer request is in flight
        setFilteredSessions(sessions);
      })
      .catch(() => {});
  }, [deviceId, vehicles, clampedSlideIndex, focusTick]);

  // ── Per-vehicle care stats ───────────────────────────────────────────────────
  // Reload Vehicle Care stats whenever the active slide or focus changes so the
  // Upcoming / Overdue / Completed / Spent row reflects the correct vehicle.
  useEffect(() => {
    if (vehicles.length === 0) return;
    const activeVehicle = vehicles[clampedSlideIndex] ?? vehicles[0];
    const storageKey = getCareStorageKey(activeVehicle.id, activeVehicle.isDefault);
    loadVehicleCareData(storageKey).then(data => {
      setCareStats(computeVehicleCareStats(data));
      setOdometerKm(estimatedOdometerKm(data));
    }).catch(() => {});
  }, [vehicles, clampedSlideIndex, focusTick]);

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

  async function handleAddVehicle() {
    await setPendingSlot(-1); // -1 = new slot
    router.push("/car-picker" as any);
  }

  async function handleSetDefault(id: string) {
    // ── 1. Migrate vehicle care data BEFORE flipping isDefault flags ───────────
    // getCareStorageKey returns the legacy STORAGE_KEY for the default vehicle
    // and a vehicle-specific key for non-default vehicles. Changing which
    // vehicle is default would swap the keys, causing the newly-defaulted
    // vehicle to read the OLD default's care records. We swap the stored data
    // first so every vehicle's care history follows it through the key change.
    const oldDefault = vehicles.find(v => v.isDefault);
    if (oldDefault && oldDefault.id !== id) {
      await swapCareDataForDefaultChange(oldDefault.id, id);
    }

    // ── 2. Persist the new default — vehicle order is unchanged, only isDefault
    // flag flips. We look up position and identity from the current context list.
    await setDefaultVehicle(id);

    // ── 3. Scroll the carousel to the newly-defaulted vehicle ─────────────────
    const newIdx = vehicles.findIndex(v => v.id === id);
    if (newIdx !== -1 && newIdx !== slideIndex) {
      setSlideIndex(newIdx);
      setTimeout(() => {
        flatRef.current?.scrollToIndex({ index: newIdx, animated: true });
      }, 50);
    }
    // Sync VehicleContext — refreshVehicles reloads from AsyncStorage so the
    // updated isDefault flags are visible everywhere.
    setActiveVehicle(id);
    refreshVehicles().catch(() => {});

    // ── 4. Sync AppContext to the newly-default vehicle ───────────────────────
    const newDefault = vehicles.find(v => v.id === id);
    if (newDefault) {
      if (newDefault.customMakeName || newDefault.customModelName) {
        setCustomVehicle(
          newDefault.makeId        ?? "",
          newDefault.modelId       ?? "",
          newDefault.customMakeName ?? "",
          newDefault.customModelName ?? "",
        );
      } else {
        setVehicleModel(newDefault.makeId ?? "", newDefault.modelId ?? "");
      }
      setVehicleType(newDefault.vehicleType);
    }
  }

  function handleRemoveVehicle(id: string) {
    const isLast = vehicles.length === 1;
    const vehicle = vehicles.find(v => v.id === id);
    const name = vehicle
      ? (vehicle.customModelName?.trim() || vehicle.modelId || "this vehicle")
      : "this vehicle";

    // Shared helper — sync AppContext to whichever vehicle is now the default,
    // or clear it when all vehicles have been removed.
    //
    // WHY this is critical:
    //   Without syncing, AppContext still holds the deleted/old-default vehicle's
    //   make/model/type after a removal. This causes two bugs:
    //   1. If the removed vehicle was the only one, ensureVehicles() re-seeds it
    //      from stale AppContext keys on the very next garage focus → the deleted
    //      vehicle silently reappears.
    //   2. If one vehicle remains, the single-vehicle focus sync sees
    //      list[0].makeId !== vehicleMakeId (deleted vs remaining) and overwrites
    //      the remaining vehicle's identity with the deleted vehicle's data.
    const syncAppContextAfterRemove = (updated: typeof vehicles) => {
      const newDefault = updated.find(v => v.isDefault) ?? updated[0] ?? null;
      if (newDefault) {
        if (newDefault.customMakeName || newDefault.customModelName) {
          setCustomVehicle(
            newDefault.makeId         ?? "",
            newDefault.modelId        ?? "",
            newDefault.customMakeName  ?? "",
            newDefault.customModelName ?? "",
          );
        } else {
          setVehicleModel(newDefault.makeId ?? "", newDefault.modelId ?? "");
        }
        setVehicleType(newDefault.vehicleType);
      } else {
        // All vehicles gone — clear vehicle identity so ensureVehicles skips
        // re-seeding on the next focus (it guards on empty makeId).
        setVehicleModel("", "");
      }
    };

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
              syncAppContextAfterRemove(updated);
              await refreshVehicles();
              // VehicleContext.refreshVehicles() already falls back to default
              // when the active vehicle was removed — no manual setActiveVehicle needed.
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
              syncAppContextAfterRemove(updated);
              // Snap slideIndex back before refreshVehicles so the clamp and
              // healing effect in the render path see a consistent position.
              const newSlide = Math.max(0, Math.min(slideIndex, updated.length - 1));
              setSlideIndex(newSlide);
              const newActive = updated[newSlide];
              if (newActive) setActiveVehicle(newActive.id);
              await refreshVehicles();
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
        onSetDefault={handleSetDefault}
        onRemove={handleRemoveVehicle}
        onEdit={handleEditVehicle}
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
            <TouchableOpacity onPress={() => router.push("/manage-vehicles" as any)}>
              <Text style={[styles.viewAllLink, { color: c.primary }]}>Manage Vehicles</Text>
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
              // Tell VehicleContext which car is now active so all other screens update
              const item = slideData[idx];
              if (item && item !== "add") setActiveVehicle((item as SavedVehicle).id);
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
                  const item = slideData[i];
                  if (item && item !== "add") setActiveVehicle((item as SavedVehicle).id);
                }}
              >
                <View style={[
                  styles.dot,
                  i === clampedSlideIndex
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
              {vehicles.length > 1 && vehicles[clampedSlideIndex] && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4,
                  backgroundColor: c.primary + "18", borderRadius: 12,
                  paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Ionicons name="car-outline" size={11} color={c.primary} />
                  <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: c.primary }} numberOfLines={1}>
                    {vehicleDisplayName(vehicles[clampedSlideIndex])}
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
                      {locationCache[t.id]
                        ? locationCache[t.id].to && locationCache[t.id].to !== locationCache[t.id].from
                          ? `${locationCache[t.id].from} → ${locationCache[t.id].to}`
                          : locationCache[t.id].from
                        : "—"}
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

      {/* ── Edit vehicle details modal ── */}
      <EditVehicleModal
        vehicle={editTarget}
        visible={editVisible}
        onClose={() => setEditVisible(false)}
        onSaved={() => refreshVehicles().catch(() => {})}
        cardBg={cardBg}
        borderCol={borderCol}
        primary={c.primary}
        foreground={c.foreground}
        subText={subText}
      />
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
    href: "/dashcam-videos",
  },
  {
    key: "accident",
    icon: "car-sport-outline",
    label: "Accident\nReports",
    color: "#EF4444",
    bg: "#EF444420",
    href: "/accident-reports",
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

  // Spec chips on vehicle card
  specChip: {
    flexDirection: "row" as const, alignItems: "center" as const, gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 20, borderWidth: 1,
  },
  specChipTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold" as const },

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
