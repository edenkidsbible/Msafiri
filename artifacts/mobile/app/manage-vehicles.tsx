/**
 * Manage Vehicles
 *
 * Full-screen vehicle management hub: view all vehicles, add new ones,
 * edit details, set default, or delete. Navigated to from the "Manage
 * Vehicles" link in the Garage tab.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
  Image,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Svg, { Circle } from "react-native-svg";

import { useColors } from "@/hooks/useColors";
import { useVehicle } from "@/context/VehicleContext";
import { useApp } from "@/context/AppContext";
import { apiGet, apiPost, ApiError } from "@/utils/apiClient";
import {
  SavedVehicle,
  loadVehicles,
  removeVehicle,
  setDefaultVehicle,
  updateVehicleDetails,
  normalizePlate,
  type VehicleDetails,
} from "@/utils/savedVehicles";
import {
  swapCareDataForDefaultChange,
  loadVehicleCareData,
  saveVehicleCareData,
  getCareStorageKey,
  estimatedOdometerKm,
  VehicleCareData,
} from "@/utils/vehicleCare";
import { getCarImageUrl, getMakeById, getModelById, CAR_MAKES } from "@/data/carModels";
import { getVehicleFallbackImage, slugify } from "@/lib/vehicleImageFallback";
import CarLogoImage from "@/components/CarLogoImage";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";

const SCREEN_W  = Dimensions.get("window").width;
const CARD_W    = SCREEN_W - 32;          // 16 px margin each side (matches garage)
const IMG_H     = 140;                    // same as garage IMG_H
const IMG_W     = CARD_W - 48;           // same formula as garage IMG_W - 16

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function getVehicleEmoji(type: string): string {
  switch (type) {
    case "psv":        return "🚐";
    case "bus":        return "🚌";
    case "truck":      return "🚛";
    case "motorcycle": return "🏍️";
    case "tractor":    return "🚜";
    default:           return "🚗";
  }
}

function firstStandardModel(makeId: string): string | null {
  const make = CAR_MAKES.find(m => m.id === makeId);
  return make?.models?.[0]?.id ?? null;
}

function customModelSlug(modelId: string): string {
  return modelId.startsWith("custom-") ? modelId.slice(7) : modelId;
}

// ── Small vehicle thumbnail (reuses R2 image logic) ───────────────────────────

function VehicleThumb({ v, width, height }: { v: SavedVehicle; width: number; height: number }) {
  const isMakeCustom  = !v.makeId  || v.makeId.startsWith("custom-");
  const isModelCustom = !v.modelId || v.modelId.startsWith("custom-");
  const [phase, setPhase] = useState(0);

  // Build the best R2 image URL for the current phase.
  // For custom makes/models we use the slugified display name (matches the key
  // the server wrote into R2) instead of the local timestamp-based ID.
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
    // Phase 1: silhouette from the make's first standard model
    const fb = firstStandardModel(v.makeId!);
    if (fb) uri = getCarImageUrl(v.makeId!, fb);
  }

  // No URI or all phases exhausted → type-specific PNG (never emoji)
  if (!uri) {
    return (
      <Image
        source={getVehicleFallbackImage(v.vehicleType)}
        style={{ width, height, transform: [{ scaleX: -1 }] }}
        resizeMode="contain"
      />
    );
  }

  return (
    <Image
      source={{ uri }}
      style={{ width, height, transform: [{ scaleX: -1 }] }}
      resizeMode="contain"
      onError={() => setPhase(p => p + 1)}
    />
  );
}

// ── Compact health ring ───────────────────────────────────────────────────────

function MiniRing({ pct, size = 40, color }: { pct: number; size?: number; color: string }) {
  const r    = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(1, pct / 100)) * circ;
  return (
    <Svg width={size} height={size}>
      <Circle cx={size/2} cy={size/2} r={r} stroke="#DDE6DA" strokeWidth={5} fill="none" />
      <Circle
        cx={size/2} cy={size/2} r={r}
        stroke={color} strokeWidth={5} fill="none"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        rotation="-90"
        origin={`${size/2},${size/2}`}
      />
    </Svg>
  );
}

// ── Edit Vehicle Details bottom-sheet ─────────────────────────────────────────

const FUEL_OPTIONS = ["Petrol", "Diesel", "Electric", "Hybrid", "CNG"] as const;
const TRANS_OPTIONS = ["Automatic", "Manual"] as const;

function EditSheet({
  vehicle, visible, onClose, onSaved,
}: {
  vehicle: SavedVehicle | null;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const c = useColors();
  const [fuelType,     setFuelType]     = useState<SavedVehicle["fuelType"]>(undefined);
  const [transmission, setTransmission] = useState<SavedVehicle["transmission"]>(undefined);
  const [odoText,      setOdoText]      = useState("");
  const [plate,        setPlate]        = useState("");
  const [saving,       setSaving]       = useState(false);

  // Plate duplicate-check state
  const [plateChecking,  setPlateChecking]  = useState(false);
  const [plateDuplicate, setPlateDuplicate] = useState<{ id: string; displayName: string } | null>(null);
  const plateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [claimVisible,  setClaimVisible]  = useState(false);
  const [claimNote,     setClaimNote]     = useState("");
  const [claimSending,  setClaimSending]  = useState(false);
  const [claimSent,     setClaimSent]     = useState(false);

  const { deviceId } = useApp();

  useEffect(() => {
    if (!vehicle) return;
    setFuelType(vehicle.fuelType);
    setTransmission(vehicle.transmission);
    setOdoText(vehicle.odometerKm != null && vehicle.odometerKm > 0 ? String(vehicle.odometerKm) : "");
    setPlate(vehicle.plateNumber ?? "");
    // Reset duplicate state when the modal reopens
    setPlateDuplicate(null);
    setClaimSent(false);
  }, [vehicle?.id, visible]);

  // Debounced plate duplicate check — skips if unchanged from vehicle's own plate
  useEffect(() => {
    const canonical = normalizePlate(plate);
    setPlateDuplicate(null);
    setClaimSent(false);
    // Don't flag their own plate
    if (canonical === normalizePlate(vehicle?.plateNumber ?? "")) return;
    if (canonical.length < 5) return;

    if (plateTimerRef.current) clearTimeout(plateTimerRef.current);
    plateTimerRef.current = setTimeout(async () => {
      setPlateChecking(true);
      try {
        const result = await apiGet<{
          found: boolean;
          vehicle?: { id: string; displayName: string };
          alreadyMember?: boolean;
        }>(`/vehicles/search?plate=${encodeURIComponent(canonical)}&deviceId=${deviceId ?? ""}`);
        setPlateDuplicate(
          result.found && result.vehicle && !result.alreadyMember
            ? result.vehicle
            : null,
        );
      } catch {
        // Silent — don't block the user on a search failure
      } finally {
        setPlateChecking(false);
      }
    }, 800);

    return () => { if (plateTimerRef.current) clearTimeout(plateTimerRef.current); };
  }, [plate, deviceId, vehicle?.plateNumber]);

  async function handleSubmitClaim() {
    if (!plateDuplicate || !deviceId) return;
    setClaimSending(true);
    try {
      await apiPost("/vehicles/claim", {
        deviceId,
        vehicleId: plateDuplicate.id,
        claimNote: claimNote.trim() || undefined,
      });
      setClaimSent(true);
      setClaimVisible(false);
    } catch (err: unknown) {
      const msg = (err instanceof ApiError ? err.message : "") ?? "";
      if (msg.includes("already have a pending claim")) {
        setClaimSent(true);
        setClaimVisible(false);
      } else {
        console.warn("Claim failed:", msg);
      }
    } finally {
      setClaimSending(false);
    }
  }

  const bg      = c.isDark ? "#111714" : "#fff";
  const inputBg = c.isDark ? "#1A211C" : "#F4F6F4";
  const border  = c.isDark ? "#2A3530" : "#E5EDE8";

  const chipStyle = (sel: boolean) => ({
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5,
    backgroundColor: sel ? c.primary + "22" : inputBg,
    borderColor: sel ? c.primary : border,
  });
  const chipTxt = (sel: boolean) => ({
    fontSize: 13, fontFamily: "Inter_600SemiBold" as const,
    color: sel ? c.primary : c.mutedForeground,
  });

  async function handleSave() {
    if (!vehicle) return;
    setSaving(true);
    try {
      const odo = odoText.trim() ? parseFloat(odoText.replace(/,/g, "")) : undefined;
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
        const careData = await loadVehicleCareData(careKey);
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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#00000070" }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={{
            backgroundColor: bg,
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            paddingHorizontal: 20, paddingBottom: 40, paddingTop: 8,
          }}>
            {/* Handle */}
            <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: border, marginBottom: 18 }} />

            <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: c.foreground, marginBottom: 4 }}>
              Edit Vehicle Details
            </Text>
            <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: c.mutedForeground, marginBottom: 20, lineHeight: 18 }}>
              {"Update the specifics for "}
              <Text style={{ fontFamily: "Inter_600SemiBold", color: c.foreground }}>
                {vehicle ? vehicleDisplayName(vehicle) : "this vehicle"}
              </Text>
              {". Make and model cannot be changed to protect your trip history."}
            </Text>

            {/* Plate */}
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: c.mutedForeground, marginBottom: 6 }}>Plate Number</Text>
            <View style={{ position: "relative" }}>
              <TextInput
                value={plate}
                onChangeText={t => setPlate(t.toUpperCase())}
                placeholder="e.g. KCB 123A"
                placeholderTextColor={c.mutedForeground + "88"}
                autoCapitalize="characters"
                style={{
                  backgroundColor: inputBg, borderRadius: 12,
                  borderWidth: plateDuplicate && !claimSent ? 1.5 : 1,
                  borderColor: plateDuplicate && !claimSent ? "#D97706" : border,
                  paddingHorizontal: 14, paddingVertical: 11,
                  color: c.foreground, fontFamily: "Inter_500Medium", fontSize: 14,
                  marginBottom: plateDuplicate ? 8 : 18,
                }}
              />
              {plateChecking && (
                <ActivityIndicator
                  size="small"
                  color={c.primary}
                  style={{ position: "absolute", right: 12, top: 12 }}
                />
              )}
            </View>

            {/* Duplicate plate warning */}
            {plateDuplicate && !claimSent && (
              <View style={{
                marginBottom: 14, padding: 12, borderRadius: 12,
                backgroundColor: "#D9770608", borderWidth: 1.5, borderColor: "#D9770640",
              }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Ionicons name="warning-outline" size={15} color="#D97706" />
                  <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#D97706" }}>
                    This plate is already registered
                  </Text>
                </View>
                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: c.mutedForeground, marginBottom: 10 }}>
                  <Text style={{ fontFamily: "Inter_600SemiBold", color: c.foreground }}>{plateDuplicate.displayName}</Text>
                  {" "}is already on Msafiri. Pick what applies:
                </Text>
                <TouchableOpacity
                  style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9, backgroundColor: c.primary + "DD", marginBottom: 6 }}
                  onPress={() => router.push("/restore-data" as any)}
                  activeOpacity={0.85}
                >
                  <Ionicons name="refresh-circle-outline" size={14} color="#fff" />
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" }}>I had this plate — restore my data</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9, backgroundColor: inputBg, marginBottom: 6 }}
                  onPress={() => router.push({ pathname: "/join-vehicle", params: { prefillPlate: normalizePlate(plate) } } as any)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="people-outline" size={13} color={c.mutedForeground} />
                  <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: c.mutedForeground }}>I share this car — join as co-driver</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9 }}
                  onPress={() => { setClaimNote(""); setClaimVisible(true); }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="flag-outline" size={13} color={c.mutedForeground + "88"} />
                  <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: c.mutedForeground + "88" }}>Someone else is using my plate — report a claim</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Claim sent confirmation */}
            {plateDuplicate && claimSent && (
              <View style={{ marginBottom: 14, padding: 10, borderRadius: 10, backgroundColor: "#22C55E10", borderWidth: 1, borderColor: "#22C55E50", flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="checkmark-circle-outline" size={15} color="#22C55E" />
                <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: "#22C55E", flex: 1 }}>Claim submitted — our team will review it.</Text>
              </View>
            )}

            {/* Fuel */}
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: c.mutedForeground, marginBottom: 8 }}>Fuel Type</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
              {FUEL_OPTIONS.map(opt => (
                <TouchableOpacity key={opt} style={chipStyle(fuelType === opt)} onPress={() => setFuelType(opt)} activeOpacity={0.8}>
                  <Text style={chipTxt(fuelType === opt)}>{opt}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Transmission */}
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: c.mutedForeground, marginBottom: 8 }}>Transmission</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 18 }}>
              {TRANS_OPTIONS.map(opt => (
                <TouchableOpacity key={opt} style={chipStyle(transmission === opt)} onPress={() => setTransmission(opt)} activeOpacity={0.8}>
                  <Text style={chipTxt(transmission === opt)}>{opt}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Odometer */}
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: c.mutedForeground, marginBottom: 6 }}>Current Odometer (km)</Text>
            <TextInput
              value={odoText}
              onChangeText={setOdoText}
              placeholder="e.g. 52000"
              placeholderTextColor={c.mutedForeground + "88"}
              keyboardType="numeric"
              style={{
                backgroundColor: inputBg, borderRadius: 12, borderWidth: 1, borderColor: border,
                paddingHorizontal: 14, paddingVertical: 11,
                color: c.foreground, fontFamily: "Inter_500Medium", fontSize: 14, marginBottom: 24,
              }}
            />

            {/* Buttons */}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity
                onPress={onClose}
                style={{ flex: 1, paddingVertical: 13, borderRadius: 14, borderWidth: 1, borderColor: border, alignItems: "center" }}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: c.mutedForeground }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                disabled={saving || (!!plateDuplicate && !claimSent)}
                style={{ flex: 2, paddingVertical: 13, borderRadius: 14, backgroundColor: c.primary, alignItems: "center", opacity: saving || (!!plateDuplicate && !claimSent) ? 0.4 : 1 }}
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

      {/* ── Claim modal ──────────────────────────────────────────────────── */}
      <Modal
        visible={claimVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setClaimVisible(false)}
        statusBarTranslucent
      >
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" }}>
          <View style={{ backgroundColor: bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 }}>
            <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: border, marginBottom: 20 }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <Ionicons name="flag-outline" size={20} color="#D97706" />
              <Text style={{ fontSize: 17, fontFamily: "Inter_700Bold", color: c.foreground }}>Claim this vehicle</Text>
            </View>
            <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: c.mutedForeground, marginBottom: 16, lineHeight: 19 }}>
              Tell us why you believe{" "}
              <Text style={{ fontFamily: "Inter_600SemiBold", color: c.foreground }}>
                {plateDuplicate?.displayName ?? "this vehicle"}
              </Text>
              {" "}is yours. Our team will review and contact you.
            </Text>
            <TextInput
              style={{
                backgroundColor: inputBg, borderRadius: 12, borderWidth: 1, borderColor: border,
                paddingHorizontal: 14, paddingVertical: 11, color: c.foreground,
                fontFamily: "Inter_400Regular", fontSize: 14, minHeight: 100,
                textAlignVertical: "top", marginBottom: 6,
              }}
              value={claimNote}
              onChangeText={setClaimNote}
              placeholder="e.g. I bought this car in 2021, my plate is KAA 123B…"
              placeholderTextColor={c.mutedForeground + "88"}
              multiline
              numberOfLines={4}
              maxLength={500}
            />
            <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: c.mutedForeground + "55", alignSelf: "flex-end", marginBottom: 16 }}>
              {claimNote.length}/500
            </Text>
            <TouchableOpacity
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: c.primary, marginBottom: 10, opacity: claimSending ? 0.7 : 1 }}
              onPress={handleSubmitClaim}
              disabled={claimSending}
              activeOpacity={0.85}
            >
              {claimSending
                ? <ActivityIndicator size="small" color="#fff" />
                : <>
                    <Ionicons name="send-outline" size={16} color="#fff" />
                    <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" }}>Submit Claim</Text>
                  </>
              }
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setClaimVisible(false)} activeOpacity={0.8} style={{ alignItems: "center" }}>
              <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: c.mutedForeground }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

// ── Vehicle row card ──────────────────────────────────────────────────────────

function VehicleRow({
  v, estimatedOdoKm, onEdit, onSetDefault, onDelete,
  cardBg, border, primary, foreground, muted,
}: {
  v: SavedVehicle;
  estimatedOdoKm: number;
  onEdit: (v: SavedVehicle) => void;
  onSetDefault: (id: string) => void;
  onDelete: (id: string) => void;
  cardBg: string; border: string; primary: string; foreground: string; muted: string;
}) {
  const fuelLabel  = v.fuelType ?? "Petrol";
  const trLabel    = v.transmission ?? "Automatic";
  const healthColor = "#22C55E";
  const healthPct   = 100;

  return (
    <View style={[s.rowCard, { backgroundColor: cardBg, borderColor: border }]}>

      {/* ── Hero image strip ── */}
      <View style={[s.rowThumb, { backgroundColor: primary + "0D" }]}>
        <VehicleThumb v={v} width={IMG_W} height={IMG_H} />
        {/* Default badge floats top-left */}
        {v.isDefault && (
          <View style={[s.defaultChip, { backgroundColor: primary, borderColor: primary, position: "absolute", top: 10, left: 12 }]}>
            <Ionicons name="star" size={9} color="#fff" />
            <Text style={[s.defaultChipTxt, { color: "#fff" }]}>Default</Text>
          </View>
        )}
        {/* Health ring floats top-right */}
        <View style={{ position: "absolute", top: 8, right: 12, alignItems: "center" }}>
          <View style={{ position: "relative", alignItems: "center", justifyContent: "center" }}>
            <MiniRing pct={healthPct} size={44} color={healthColor} />
            <View style={{ position: "absolute" }}>
              <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold" as const, color: foreground }}>{healthPct}%</Text>
            </View>
          </View>
          <Text style={{ fontSize: 8, fontFamily: "Inter_500Medium" as const, color: healthColor, marginTop: 1 }}>Health</Text>
        </View>
      </View>

      {/* ── Info section ── */}
      <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 }}>
        {/* Name row */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
          {v.makeId && !v.makeId.startsWith("custom-") && (
            <CarLogoImage makeId={v.makeId} width={22} height={14} emoji={getVehicleEmoji(v.vehicleType)} />
          )}
          <Text style={[s.rowName, { color: foreground, flexShrink: 1 }]} numberOfLines={1}>
            {vehicleDisplayName(v)}
          </Text>
        </View>

        {/* Spec chips */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: v.odometerKm ? 8 : 4 }}>
          <View style={[s.chip, { backgroundColor: primary + "14", borderColor: primary + "35" }]}>
            <Text style={[s.chipTxt, { color: primary }]}>{fuelLabel}</Text>
          </View>
          <View style={[s.chip, { backgroundColor: muted + "20", borderColor: muted + "20" }]}>
            <Text style={[s.chipTxt, { color: muted }]}>{trLabel}</Text>
          </View>
          {v.plateNumber ? (
            <View style={[s.chip, { backgroundColor: muted + "14", borderColor: muted + "18" }]}>
              <Text style={[s.chipTxt, { color: muted }]}>{v.plateNumber}</Text>
            </View>
          ) : null}
        </View>

        {/* Odometer */}
        {estimatedOdoKm > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 4 }}>
            <Ionicons name="speedometer-outline" size={12} color={muted} />
            <View>
              <Text style={[s.rowOdo, { color: foreground, fontSize: 13, fontFamily: "Inter_600SemiBold" }]}>
                {estimatedOdoKm.toLocaleString(undefined, { maximumFractionDigits: 0 })} km
              </Text>
              <Text style={[s.rowOdo, { color: muted }]}>Estimated from trips</Text>
            </View>
          </View>
        ) : null}
      </View>

      {/* ── Action strip ── */}
      <View style={[s.rowActions, { borderTopColor: border }]}>
        {!v.isDefault && (
          <TouchableOpacity
            style={[s.rowActionBtn, { backgroundColor: "#3B82F612", borderColor: "#3B82F630" }]}
            onPress={() => { Haptics.selectionAsync(); onSetDefault(v.id); }}
            activeOpacity={0.8}
          >
            <Ionicons name="star-outline" size={13} color="#3B82F6" />
            <Text style={[s.rowActionTxt, { color: "#3B82F6" }]}>Set Default</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[s.rowActionBtn, { backgroundColor: "#22C55E12", borderColor: "#22C55E30" }]}
          onPress={() => { Haptics.selectionAsync(); onEdit(v); }}
          activeOpacity={0.8}
        >
          <Ionicons name="pencil-outline" size={13} color="#22C55E" />
          <Text style={[s.rowActionTxt, { color: "#22C55E" }]}>Edit Details</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.rowActionBtn, { backgroundColor: "#EF444412", borderColor: "#EF444430" }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onDelete(v.id); }}
          activeOpacity={0.8}
        >
          <Ionicons name="trash-outline" size={13} color="#EF4444" />
          <Text style={[s.rowActionTxt, { color: "#EF4444" }]}>Remove</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ManageVehiclesScreen() {
  const c      = useColors();
  const insets = useSafeAreaInsets();
  const { vehicles, refreshVehicles, activeVehicleId, setActiveVehicle } = useVehicle();
  const { setVehicleModel, setVehicleType, setCustomVehicle } = useApp();

  const [editTarget, setEditTarget] = useState<SavedVehicle | null>(null);
  const [editVisible, setEditVisible] = useState(false);
  const [careDataMap, setCareDataMap] = useState<Record<string, VehicleCareData>>({});

  async function loadCareData(vehicleList: typeof vehicles) {
    const entries = await Promise.all(
      vehicleList.map(async v => {
        const key = getCareStorageKey(v.id, v.isDefault);
        const data = await loadVehicleCareData(key);
        return [v.id, data] as const;
      }),
    );
    setCareDataMap(Object.fromEntries(entries));
  }

  // Re-load vehicles on every focus in case another screen changed them
  useFocusEffect(useCallback(() => {
    refreshVehicles();
  }, [refreshVehicles]));

  // Reload care data whenever the vehicle list changes
  useEffect(() => {
    if (vehicles.length > 0) loadCareData(vehicles);
  }, [vehicles]);

  // ── Sync AppContext after default/remove changes ───────────────────────────
  function syncCtx(updated: SavedVehicle[]) {
    const def = updated.find(v => v.isDefault) ?? updated[0] ?? null;
    if (!def) { setVehicleModel("", ""); return; }
    if (def.customMakeName || def.customModelName) {
      setCustomVehicle(def.makeId ?? "", def.modelId ?? "", def.customMakeName ?? "", def.customModelName ?? "");
    } else {
      setVehicleModel(def.makeId ?? "", def.modelId ?? "");
    }
    setVehicleType(def.vehicleType);
  }

  async function handleSetDefault(id: string) {
    // ── 1. Migrate vehicle care data BEFORE flipping isDefault flags ───────────
    // getCareStorageKey returns the shared legacy key for the default vehicle and
    // a vehicle-specific key for others. Swapping the default without migrating
    // first causes the new default to read the old default's care records.
    const oldDefault = vehicles.find(v => v.isDefault);
    if (oldDefault && oldDefault.id !== id) {
      await swapCareDataForDefaultChange(oldDefault.id, id);
    }

    // ── 2. Persist the new default flag ───────────────────────────────────────
    const updated = await setDefaultVehicle(id);
    syncCtx(updated);
    setActiveVehicle(id);
    await refreshVehicles();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function handleDelete(id: string) {
    const v    = vehicles.find(x => x.id === id);
    const name = v ? vehicleDisplayName(v) : "this vehicle";
    const isLast = vehicles.length === 1;

    Alert.alert(
      isLast ? "Remove Last Vehicle?" : "Remove Vehicle",
      isLast
        ? `Removing ${name} will erase all Vehicle Care history — maintenance records, service logs, and cost data.\n\nThis cannot be undone.`
        : `Remove ${name} from your garage?`,
      [
        { text: isLast ? "Keep Vehicle" : "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            const updated = await removeVehicle(id);
            syncCtx(updated);
            await refreshVehicles();
            if (vehicles.length === 1) router.back(); // last vehicle removed
          },
        },
      ],
    );
  }

  function handleEdit(v: SavedVehicle) {
    setEditTarget(v);
    setEditVisible(true);
  }

  const cardBg  = c.isDark ? "#111714" : "#FFFFFF";
  const border  = c.isDark ? "#1E2922" : "#E8EDE9";
  const muted   = c.mutedForeground;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {/* ── Header ── */}
      <View style={[s.header, { paddingTop: insets.top + 12, borderBottomColor: border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={s.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={24} color={c.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: c.foreground }]}>Manage Vehicles</Text>
          <Text style={[s.sub, { color: muted }]}>
            {vehicles.length === 0
              ? "No vehicles added yet"
              : `${vehicles.length} vehicle${vehicles.length === 1 ? "" : "s"} in your garage`}
          </Text>
        </View>
        {/* Add button in header */}
        <TouchableOpacity
          style={[s.addHeaderBtn, { backgroundColor: c.primary }]}
          onPress={() => router.push("/vehicle-setup" as any)}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {vehicles.length === 0 ? (
          /* Empty state */
          <View style={[s.emptyCard, { backgroundColor: cardBg, borderColor: border }]}>
            <View style={[s.emptyIcon, { backgroundColor: c.primary + "15" }]}>
              <Ionicons name="car-outline" size={36} color={c.primary} />
            </View>
            <Text style={[s.emptyTitle, { color: c.foreground }]}>No Vehicles Yet</Text>
            <Text style={[s.emptySub, { color: muted }]}>
              Add your car, matatu, or truck to start tracking trips and vehicle health.
            </Text>
            <TouchableOpacity
              style={[s.emptyBtn, { backgroundColor: c.primary }]}
              onPress={() => router.push("/vehicle-setup" as any)}
              activeOpacity={0.85}
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={s.emptyBtnTxt}>Add Your First Vehicle</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {vehicles.map(v => {
              const careData = careDataMap[v.id];
              const estimatedOdoKm = careData ? estimatedOdometerKm(careData) : (v.odometerKm ?? 0);
              return (
                <VehicleRow
                  key={v.id}
                  v={v}
                  estimatedOdoKm={estimatedOdoKm}
                  onEdit={handleEdit}
                  onSetDefault={handleSetDefault}
                  onDelete={handleDelete}
                  cardBg={cardBg}
                  border={border}
                  primary={c.primary}
                  foreground={c.foreground}
                  muted={muted}
                />
              );
            })}

            {/* Add another vehicle CTA */}
            {vehicles.length < 4 && (
              <TouchableOpacity
                style={[s.addAnotherBtn, { backgroundColor: c.primary + "12", borderColor: c.primary + "40" }]}
                onPress={() => router.push("/vehicle-setup" as any)}
                activeOpacity={0.85}
              >
                <View style={[s.addAnotherIcon, { backgroundColor: c.primary + "20" }]}>
                  <Ionicons name="add" size={22} color={c.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.addAnotherTitle, { color: c.primary }]}>Add Another Vehicle</Text>
                  <Text style={[s.addAnotherSub, { color: c.primary + "99" }]}>
                    Track up to 4 vehicles in your garage
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.primary + "80"} />
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>

      {/* ── Edit Details sheet ── */}
      <EditSheet
        vehicle={editTarget}
        visible={editVisible}
        onClose={() => setEditVisible(false)}
        onSaved={refreshVehicles}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn:    { width: 36, height: 36, justifyContent: "center" },
  title:      { fontSize: 20, fontFamily: "Inter_700Bold" },
  sub:        { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  addHeaderBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
  },

  // Vehicle row card
  rowCard: {
    borderRadius: 18, borderWidth: 1,
    marginBottom: 12, overflow: "hidden",
  },
  rowThumb: {
    width: "100%", height: IMG_H + 24,   // matches garage: IMG_H + 24
    alignItems: "center", justifyContent: "center",
    backgroundColor: "transparent",
  },
  rowName: { fontSize: 15, fontFamily: "Inter_700Bold", flexShrink: 1 },
  rowOdo:  { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  defaultChip: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 10, borderWidth: 1,
  },
  defaultChipTxt: { fontSize: 9, fontFamily: "Inter_700Bold" },
  chip: {
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: 12, borderWidth: 1,
  },
  chipTxt: { fontSize: 10, fontFamily: "Inter_600SemiBold" },

  rowActions: {
    flexDirection: "row", gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  rowActionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 5, paddingVertical: 8, borderRadius: 10, borderWidth: 1,
  },
  rowActionTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  // Info section (below image in row)
  rowInfo: {
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 2,
    flexDirection: "row", alignItems: "flex-start", gap: 10,
  },

  // Empty state
  emptyCard: {
    borderRadius: 20, borderWidth: 1,
    padding: 28, alignItems: "center", gap: 12,
    marginTop: 16,
  },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: "center", justifyContent: "center",
  },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  emptySub:   { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  emptyBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 20, paddingVertical: 13, borderRadius: 14, marginTop: 4,
  },
  emptyBtnTxt: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },

  // Add Another vehicle CTA
  addAnotherBtn: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 18, borderWidth: 1.5,
    paddingHorizontal: 16, paddingVertical: 16, marginTop: 4,
  },
  addAnotherIcon: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
  },
  addAnotherTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  addAnotherSub:   { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
});
