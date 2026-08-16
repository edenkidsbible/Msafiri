/**
 * VehicleSetup — shown once after the paywall when a user hasn't configured
 * their vehicle yet. Collects make, model, transmission, fuel type, and
 * current odometer, then seeds the savedVehicles list and navigates to the
 * main app. All steps are optional — the user can skip at any time.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { KeyboardInputModal } from "@/components/KeyboardInputModal";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { saveVehicles, loadVehicles, setPrimaryVehicleIdIfUnset, normalizePlate } from "@/utils/savedVehicles";
import { getCareStorageKey, setVehicleCareInitialOdometer } from "@/utils/vehicleCare";
import { apiGet, apiPost } from "@/utils/apiClient";
import { useVehicle } from "@/context/VehicleContext";
import { CAR_MAKES } from "@/data/carModels";
import { slugify } from "@/lib/vehicleImageFallback";
import CarLogoImage from "@/components/CarLogoImage";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";

// ── Types ─────────────────────────────────────────────────────────────────────

type FuelType = "Petrol" | "Diesel" | "Electric" | "Hybrid" | "CNG";
type Transmission = "Automatic" | "Manual";

const FUEL_TYPES: FuelType[] = ["Petrol", "Diesel", "Electric", "Hybrid", "CNG"];
const TRANSMISSIONS: Transmission[] = ["Automatic", "Manual"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function ChipRow<T extends string>({
  options, value, onSelect, color,
}: {
  options: readonly T[];
  value: T | null;
  onSelect: (v: T) => void;
  color: string;
}) {
  return (
    <View style={cs.chipRow}>
      {options.map((opt) => (
        <TouchableOpacity
          key={opt}
          style={[
            cs.chip,
            value === opt ? { backgroundColor: color, borderColor: color } : { borderColor: "#333" },
          ]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelect(opt); }}
          activeOpacity={0.8}
        >
          <Text style={[cs.chipTxt, { color: value === opt ? "#fff" : "#bbb" }]}>{opt}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

interface DuplicateVehicle {
  id: string;
  displayName: string;
  vehicleType: string;
}

export default function VehicleSetup() {
  const c = useColors();
  const { deviceId, setVehicleModel, setVehicleType: setCtxVehicleType, setCustomVehicle, vehicleType: ctxVehicleType } = useApp();
  const { refreshVehicles } = useVehicle();

  // Step 1 = make, 2 = model, 3 = details (vehicle type already set in onboarding)
  const [step, setStep] = useState(1);

  // Form state (vehicleType sourced from AppContext — set during onboarding slide 3)
  const [makeId, setMakeId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [isCustomMake, setIsCustomMake] = useState(false);
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [customMakeName, setCustomMakeName] = useState("");
  const [customModelName, setCustomModelName] = useState("");
  const [transmission, setTransmission] = useState<Transmission | null>(null);
  const [fuelType, setFuelType] = useState<FuelType | null>(null);

  const [plateNumber, setPlateNumber] = useState("");
  const [odometerInput, setOdometerInput] = useState("");
  const [odoModalVisible, setOdoModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  // Plate duplicate-check state
  const [plateChecking,   setPlateChecking]   = useState(false);
  const [plateDuplicate,  setPlateDuplicate]  = useState<DuplicateVehicle | null>(null);
  const plateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Claim modal state
  const [claimVisible,      setClaimVisible]      = useState(false);
  const [claimNote,         setClaimNote]         = useState("");
  const [claimSending,      setClaimSending]      = useState(false);
  const [claimNoteKimOpen,  setClaimNoteKimOpen]  = useState(false);
  const [claimSent,     setClaimSent]     = useState(false);

  // Keyboard input modals (replaces TextInput + revealInput refs pattern)
  const [makeModalVisible,  setMakeModalVisible]  = useState(false);
  const [modelModalVisible, setModelModalVisible] = useState(false);
  const [plateModalVisible, setPlateModalVisible] = useState(false);

  // ── Debounced plate search ─────────────────────────────────────────────────
  useEffect(() => {
    const canonical = normalizePlate(plateNumber);
    setPlateDuplicate(null);
    setClaimSent(false);
    if (canonical.length < 5) return;

    if (plateTimerRef.current) clearTimeout(plateTimerRef.current);
    plateTimerRef.current = setTimeout(async () => {
      setPlateChecking(true);
      try {
        const result = await apiGet<{
          found: boolean;
          vehicle?: DuplicateVehicle;
          alreadyMember?: boolean;
        }>(`/vehicles/search?plate=${encodeURIComponent(canonical)}&deviceId=${deviceId ?? ""}`);
        // Only flag as duplicate if found AND the current user isn't already a member
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
  }, [plateNumber, deviceId]);

  // ── Submit a claim ─────────────────────────────────────────────────────────
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
    } catch (err: any) {
      const msg = err?.message ?? "";
      if (msg.includes("already have a pending claim")) {
        setClaimSent(true);
        setClaimVisible(false);
      } else {
        // Show inline error — don't crash the modal
        console.warn("Claim failed:", msg);
      }
    } finally {
      setClaimSending(false);
    }
  }

  const selectedMake = useMemo(() => CAR_MAKES.find((m) => m.id === makeId), [makeId]);

  // Ref for scroll-to-end on step change
  const scrollViewRef = useRef<ScrollView>(null);

  const handleFinish = async () => {
    // Hard-gate: if the debounce already found a duplicate and it's unresolved, block.
    if (plateDuplicate && !claimSent) return;

    setSaving(true);

    // Final plate uniqueness check before writing — catches races where the
    // 800 ms debounce hadn't fired yet or where the earlier search call failed.
    const canonical = normalizePlate(plateNumber);
    if (canonical.length >= 5) {
      try {
        const result = await apiGet<{ found: boolean; vehicle?: DuplicateVehicle; alreadyMember?: boolean }>(
          `/vehicles/search?plate=${encodeURIComponent(canonical)}&deviceId=${deviceId ?? ""}`
        );
        if (result.found && result.vehicle && !result.alreadyMember) {
          // Show the duplicate UI — same as if the debounce had caught it
          setPlateDuplicate(result.vehicle);
          setSaving(false);
          return;
        }
      } catch {
        // Network failure at save time — don't block the user, proceed with local save
      }
    }

    try {
      const existing = await loadVehicles();
      // Use slug-based IDs (not timestamps) so image URL resolution via
      // slugify(customModelName) always matches what the server writes to R2.
      const resolvedMakeId = isCustomMake ? `custom-${slugify(customMakeName)}` : (makeId ?? null);
      const resolvedModelId = (isCustomModel || isCustomMake) ? `custom-${slugify(customModelName)}` : (modelId ?? null);
      // For a known make + custom model, store the make's display name so
      // vehicleDisplayName can show "Volkswagen Arteon" instead of "My Vehicle".
      const resolvedCustomMake = isCustomMake
        ? customMakeName
        : (isCustomModel ? (CAR_MAKES.find((m) => m.id === makeId)?.name ?? null) : null);
      const resolvedCustomModel = (isCustomMake || isCustomModel) ? customModelName : null;

      // Sync primary vehicle into AppContext for backwards-compat.
      if (!isCustomMake && !isCustomModel && makeId && modelId) {
        setVehicleModel(makeId, modelId);
      } else if ((isCustomMake || isCustomModel) && resolvedMakeId && resolvedModelId) {
        setCustomVehicle(
          resolvedMakeId,
          resolvedModelId,
          resolvedCustomMake ?? "",
          resolvedCustomModel ?? "",
        );
      }
      setCtxVehicleType((ctxVehicleType ?? "car") as any);

      const parsedOdometer = odometerInput.trim() ? parseFloat(odometerInput) : undefined;

      const newVehicle = {
        id: existing.length === 0 ? "v0" : `v${Date.now()}`,
        makeId: resolvedMakeId,
        modelId: resolvedModelId,
        customMakeName: resolvedCustomMake,
        customModelName: resolvedCustomModel,
        vehicleType: (ctxVehicleType ?? "car") as any,
        isDefault: true,
        fuelType: fuelType ?? undefined,
        transmission: transmission ?? undefined,
        plateNumber: normalizePlate(plateNumber) || undefined,
        odometerKm: parsedOdometer,
      };

      if (existing.length === 0) {
        await saveVehicles([newVehicle]);
        // Durably record this as the primary vehicle ID so that any
        // NULL-vehicleId legacy drive sessions always show under the
        // first vehicle ever created, even if the default changes later.
        await setPrimaryVehicleIdIfUnset(newVehicle.id);
      } else {
        // Adding an additional vehicle — append it without touching existing ones.
        // isDefault stays false so the user's current default is preserved.
        await saveVehicles([...existing, { ...newVehicle, isDefault: false }]);
      }

      // Seed the care-odometer baseline so the running total the app shows
      // starts from the car's real mileage, not from zero.
      if (parsedOdometer != null && !isNaN(parsedOdometer) && parsedOdometer > 0) {
        const savedId    = newVehicle.id;
        const savedIsDefault = existing.length === 0; // first vehicle → default key
        const careKey    = getCareStorageKey(savedId, savedIsDefault);
        await setVehicleCareInitialOdometer(careKey, parsedOdometer).catch(() => {});
      }

      // Sync VehicleContext so all consumers see the updated list immediately
      refreshVehicles().catch(() => {});
    } catch {
      // Best-effort — proceed to app even on failure
    } finally {
      setSaving(false);
      router.replace("/(tabs)");
    }
  };

  const handleSkip = () => router.replace("/(tabs)");

  const next = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setStep((s) => s + 1); };
  const back = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setStep((s) => s - 1); };

  const canProceedStep1 = makeId != null || (isCustomMake && customMakeName.trim().length > 0);
  const canProceedStep2 = modelId != null || (isCustomModel && customModelName.trim().length > 0);

  return (
    <SafeAreaView style={[cs.screen, { backgroundColor: "#0B1611" }]}>
      {/* Header */}
      <View style={cs.header}>
        {step > 1 ? (
          <TouchableOpacity onPress={back} style={cs.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
        ) : <View style={{ width: 36 }} />}
        <View style={cs.progressRow}>
          {[1, 2, 3].map((i) => (
            <View
              key={i}
              style={[
                cs.progressDot,
                { backgroundColor: i <= step ? "#00A845" : "rgba(255,255,255,0.15)" },
              ]}
            />
          ))}
        </View>
        <TouchableOpacity onPress={handleSkip}>
          <Text style={cs.skipTxt}>Skip</Text>
        </TouchableOpacity>
      </View>

      {/* Why banner */}
      <View style={cs.whyBanner}>
        <Ionicons name="shield-checkmark-outline" size={16} color="#00A845" />
        <Text style={cs.whyTxt}>
          Your vehicle powers <Text style={{ color: "#00A845" }}>Garage</Text>, fuel tracking, service reminders, and accurate speed alerts.
        </Text>
      </View>

      <KeyboardAwareScrollViewCompat
        ref={scrollViewRef}
        contentContainerStyle={cs.content}
        showsVerticalScrollIndicator={false}
      >
          {/* ── Step 1: Make ───────────────────────────────────────────────── */}
          {step === 1 && (
            <>
              <Text style={cs.stepTitle}>Select your make</Text>
              <Text style={cs.stepSub}>Choose your car's manufacturer from the list.</Text>
              <View style={cs.makeGrid}>
                {CAR_MAKES.map((make) => {
                  const selected = makeId === make.id && !isCustomMake;
                  return (
                    <TouchableOpacity
                      key={make.id}
                      style={[
                        cs.makeCard,
                        selected ? { borderColor: "#00A845", backgroundColor: "#00A84515" } : { borderColor: "rgba(255,255,255,0.1)" },
                      ]}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMakeId(make.id); setIsCustomMake(false); setModelId(null); setIsCustomModel(false); }}
                      activeOpacity={0.8}
                    >
                      <CarLogoImage makeId={make.id} width={56} height={28} emoji={make.emoji} />
                      <Text style={[cs.makeName, { color: selected ? "#00A845" : "#ddd" }]} numberOfLines={1}>{make.name}</Text>
                    </TouchableOpacity>
                  );
                })}
                {/* Other */}
                <TouchableOpacity
                  style={[
                    cs.makeCard,
                    isCustomMake ? { borderColor: "#00A845", backgroundColor: "#00A84515" } : { borderColor: "rgba(255,255,255,0.1)" },
                  ]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setIsCustomMake(true); setMakeId(null); setIsCustomModel(true); setMakeModalVisible(true); }}
                  activeOpacity={0.8}
                >
                  <Text style={cs.makeEmoji}>🚗</Text>
                  <Text style={[cs.makeName, { color: isCustomMake ? "#00A845" : "#ddd" }]}>Other</Text>
                </TouchableOpacity>
              </View>
              {isCustomMake && (
                <View style={cs.customInputGroup}>
                  <KeyboardInputModal
                    visible={makeModalVisible}
                    label="Make name"
                    value={customMakeName}
                    onChangeText={setCustomMakeName}
                    onDone={() => setMakeModalVisible(false)}
                    placeholder="e.g. Foton, JAC, King Long…"
                    autoCapitalize="words"
                  />
                  <KeyboardInputModal
                    visible={modelModalVisible}
                    label="Model name"
                    value={customModelName}
                    onChangeText={setCustomModelName}
                    onDone={() => setModelModalVisible(false)}
                    placeholder="e.g. Tunland, S5…"
                    autoCapitalize="words"
                  />
                  <Text style={cs.customLabel}>Make name</Text>
                  <TouchableOpacity
                    style={cs.customInput}
                    onPress={() => setMakeModalVisible(true)}
                    activeOpacity={0.7}
                  >
                    <Text style={{ color: customMakeName ? "#ddd" : "#555", fontFamily: "Inter_400Regular", fontSize: 15 }}>
                      {customMakeName || "e.g. Foton, JAC, King Long…"}
                    </Text>
                  </TouchableOpacity>
                  <Text style={[cs.customLabel, { marginTop: 12 }]}>Model name</Text>
                  <TouchableOpacity
                    style={cs.customInput}
                    onPress={() => setModelModalVisible(true)}
                    activeOpacity={0.7}
                  >
                    <Text style={{ color: customModelName ? "#ddd" : "#555", fontFamily: "Inter_400Regular", fontSize: 15 }}>
                      {customModelName || "e.g. Tunland, S5…"}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}

          {/* ── Step 2: Model ──────────────────────────────────────────────── */}
          {step === 2 && !isCustomMake && (
            <>
              <Text style={cs.stepTitle}>{selectedMake?.name} — select model</Text>
              <Text style={cs.stepSub}>Which version do you have?</Text>
              <View style={cs.modelList}>
                {(selectedMake?.models ?? []).map((model) => {
                  const selected = modelId === model.id && !isCustomModel;
                  return (
                    <TouchableOpacity
                      key={model.id}
                      style={[
                        cs.modelRow,
                        { borderColor: selected ? "#00A845" : "rgba(255,255,255,0.08)", backgroundColor: selected ? "#00A84510" : "transparent" },
                      ]}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setModelId(model.id); setIsCustomModel(false); }}
                      activeOpacity={0.8}
                    >
                      <Text style={[cs.modelName, { color: selected ? "#00A845" : "#ddd" }]}>{model.name}</Text>
                      {selected && <Ionicons name="checkmark-circle" size={18} color="#00A845" />}
                    </TouchableOpacity>
                  );
                })}
                {/* Other model */}
                <TouchableOpacity
                  style={[
                    cs.modelRow,
                    { borderColor: isCustomModel ? "#00A845" : "rgba(255,255,255,0.08)", backgroundColor: isCustomModel ? "#00A84510" : "transparent" },
                  ]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setIsCustomModel(true); setModelId(null); setModelModalVisible(true); }}
                  activeOpacity={0.8}
                >
                  <Text style={[cs.modelName, { color: isCustomModel ? "#00A845" : "#ddd" }]}>Other / Variant</Text>
                  {isCustomModel && <Ionicons name="checkmark-circle" size={18} color="#00A845" />}
                </TouchableOpacity>
              </View>
              {isCustomModel && (
                <View style={cs.customInputGroup}>
                  <KeyboardInputModal
                    visible={modelModalVisible}
                    label="Model name"
                    value={customModelName}
                    onChangeText={setCustomModelName}
                    onDone={() => setModelModalVisible(false)}
                    placeholder="e.g. GX Super, LX Special…"
                    autoCapitalize="words"
                  />
                  <Text style={cs.customLabel}>Model name</Text>
                  <TouchableOpacity
                    style={cs.customInput}
                    onPress={() => setModelModalVisible(true)}
                    activeOpacity={0.7}
                  >
                    <Text style={{ color: customModelName ? "#ddd" : "#555", fontFamily: "Inter_400Regular", fontSize: 15 }}>
                      {customModelName || "e.g. GX Super, LX Special…"}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}

          {/* ── Step 3: Details ────────────────────────────────────────────── */}
          {step === 3 && (
            <>
              <Text style={cs.stepTitle}>Nearly there!</Text>

              <Text style={cs.fieldLabel}>Number plate</Text>
              <Text style={cs.fieldHint}>
                Required — prevents duplicate registrations and lets you restore your data on a new device.
              </Text>
              <View style={{ position: "relative" }}>
                <KeyboardInputModal
                  visible={plateModalVisible}
                  label="Number Plate"
                  value={plateNumber}
                  onChangeText={t => setPlateNumber(t.toUpperCase())}
                  onDone={() => setPlateModalVisible(false)}
                  placeholder="e.g. KCB 123A"
                  autoCapitalize="characters"
                />
                <TouchableOpacity
                  style={[
                    cs.odometerInput,
                    plateDuplicate && { borderColor: "#D97706", borderWidth: 1.5 },
                  ]}
                  onPress={() => setPlateModalVisible(true)}
                  activeOpacity={0.7}
                >
                  <Text style={{ color: plateNumber ? "#ddd" : "#555", fontFamily: "Inter_400Regular", fontSize: 15 }}>
                    {plateNumber || "e.g. KCB 123A"}
                  </Text>
                </TouchableOpacity>
                {plateChecking && (
                  <ActivityIndicator
                    size="small"
                    color="#00A845"
                    style={{ position: "absolute", right: 14, top: 14 }}
                  />
                )}
              </View>

              {/* ── Duplicate plate warning ─────────────────────────────── */}
              {plateDuplicate && !claimSent && (
                <View style={cs.dupCard}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <Ionicons name="warning-outline" size={16} color="#D97706" />
                    <Text style={cs.dupTitle}>This plate is already registered</Text>
                  </View>
                  <Text style={cs.dupBody}>
                    <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>
                      {plateDuplicate.displayName}
                    </Text>
                    {" "}is already on Msafiri. Pick what applies to you:
                  </Text>

                  {/* Option 1 — returning owner on a new device */}
                  <TouchableOpacity
                    style={cs.dupPrimaryBtn}
                    onPress={() => router.push("/restore-data" as any)}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="refresh-circle-outline" size={15} color="#fff" />
                    <Text style={cs.dupPrimaryBtnTxt}>I had this plate before — restore my data</Text>
                  </TouchableOpacity>

                  {/* Option 2 — co-driver of the same physical car */}
                  <TouchableOpacity
                    style={cs.dupSecondaryBtn}
                    onPress={() =>
                      router.push({
                        pathname: "/join-vehicle",
                        params: { prefillPlate: normalizePlate(plateNumber) },
                      } as any)
                    }
                    activeOpacity={0.8}
                  >
                    <Ionicons name="people-outline" size={14} color="rgba(255,255,255,0.75)" />
                    <Text style={cs.dupSecondaryBtnTxt}>I share this car — join as co-driver</Text>
                  </TouchableOpacity>

                  {/* Option 3 — someone else is using their plate fraudulently */}
                  <TouchableOpacity
                    style={cs.dupSecondaryBtn}
                    onPress={() => { setClaimNote(""); setClaimVisible(true); }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="flag-outline" size={14} color="rgba(255,255,255,0.5)" />
                    <Text style={[cs.dupSecondaryBtnTxt, { color: "rgba(255,255,255,0.5)" }]}>
                      Someone else is using my plate — report a claim
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* ── Claim sent confirmation ─────────────────────────────── */}
              {plateDuplicate && claimSent && (
                <View style={[cs.dupCard, { borderColor: "#22C55E50", backgroundColor: "#22C55E10" }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="checkmark-circle-outline" size={16} color="#22C55E" />
                    <Text style={[cs.dupTitle, { color: "#22C55E" }]}>Claim submitted</Text>
                  </View>
                  <Text style={cs.dupBody}>
                    We've received your report. Our team will review it and follow up. In the meantime, you can still request to join as a co-driver.
                  </Text>
                </View>
              )}

              <Text style={[cs.fieldLabel, { marginTop: 20 }]}>
                Fuel type{" "}
                <Text style={{ color: "rgba(255,255,255,0.35)", fontFamily: "Inter_400Regular", fontSize: 11 }}>Optional</Text>
              </Text>
              <ChipRow options={FUEL_TYPES} value={fuelType} onSelect={setFuelType} color="#00A845" />

              <Text style={[cs.fieldLabel, { marginTop: 20 }]}>
                Transmission{" "}
                <Text style={{ color: "rgba(255,255,255,0.35)", fontFamily: "Inter_400Regular", fontSize: 11 }}>Optional</Text>
              </Text>
              <ChipRow options={TRANSMISSIONS} value={transmission} onSelect={setTransmission} color="#00A845" />

              {/* Current odometer */}
              <Text style={[cs.fieldLabel, { marginTop: 20 }]}>
                Current odometer (km){" "}
                <Text style={{ color: "rgba(255,255,255,0.35)", fontFamily: "Inter_400Regular", fontSize: 11 }}>Optional</Text>
              </Text>
              <Text style={cs.fieldHint}>
                Your car's current mileage. Every trip you make will be added to this figure automatically.
              </Text>
              <KeyboardInputModal
                visible={odoModalVisible}
                label="Current Odometer (km)"
                value={odometerInput}
                onChangeText={t => setOdometerInput(t.replace(/[^0-9.]/g, ""))}
                onDone={() => setOdoModalVisible(false)}
                placeholder="e.g. 45000"
                keyboardType="numeric"
              />
              <TouchableOpacity
                style={cs.odometerInput}
                onPress={() => setOdoModalVisible(true)}
                activeOpacity={0.7}
              >
                <Text style={{ color: odometerInput ? "#ddd" : "#555", fontFamily: "Inter_400Regular", fontSize: 15 }}>
                  {odometerInput || "e.g. 45 000"}
                </Text>
              </TouchableOpacity>
            </>
          )}
      </KeyboardAwareScrollViewCompat>

      {/* Bottom CTA */}
      <View style={cs.bottom}>
        {step < 3 ? (
          <TouchableOpacity
            style={[
              cs.nextBtn,
              {
                opacity:
                  (step === 1 && !canProceedStep1) ||
                  (step === 2 && !isCustomMake && !canProceedStep2)
                    ? 0.4 : 1,
              },
            ]}
            onPress={next}
            disabled={
              (step === 1 && !canProceedStep1) ||
              (step === 2 && !isCustomMake && !canProceedStep2)
            }
            activeOpacity={0.85}
          >
            <Text style={cs.nextBtnTxt}>Next</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </TouchableOpacity>
        ) : (
          <>
            {plateDuplicate && !claimSent && (
              <View style={cs.dupBlockNote}>
                <Ionicons name="lock-closed-outline" size={13} color="#D97706" />
                <Text style={cs.dupBlockNoteTxt}>
                  Resolve the duplicate plate above before saving.
                </Text>
              </View>
            )}
            <TouchableOpacity
              style={[cs.nextBtn, plateDuplicate && !claimSent && { opacity: 0.4 }]}
              onPress={handleFinish}
              disabled={saving || (!!plateDuplicate && !claimSent)}
              activeOpacity={0.85}
            >
              <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
              <Text style={cs.nextBtnTxt}>{saving ? "Saving…" : "Set up my vehicle"}</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity onPress={handleSkip} style={cs.skipBtnBelow}>
          <Text style={cs.skipBelowTxt}>I'll set this up later in Garage</Text>
        </TouchableOpacity>
      </View>

      {/* ── Claim modal ──────────────────────────────────────────────────── */}
      <Modal
        visible={claimVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setClaimVisible(false)}
        statusBarTranslucent
      >
        <TouchableWithoutFeedback onPress={() => setClaimVisible(false)} accessible={false}>
          <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" }}>
            <TouchableWithoutFeedback accessible={false}>
              <View style={cs.claimSheet}>
                <View style={cs.claimHandle} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <Ionicons name="flag-outline" size={20} color="#D97706" />
                  <Text style={cs.claimTitle}>Claim this vehicle</Text>
                </View>
                <Text style={cs.claimSub}>
                  Tell us why you believe{" "}
                  <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>
                    {plateDuplicate?.displayName ?? "this vehicle"}
                  </Text>{" "}
                  is yours. Our team will review it and contact you.
                </Text>
                {/* Tappable note card — keyboard entry handled by KeyboardInputModal below */}
                <TouchableOpacity
                  onPress={() => setClaimNoteKimOpen(true)}
                  activeOpacity={0.75}
                  style={[cs.claimInput, {
                    justifyContent: "flex-start",
                    borderColor: claimNote ? "rgba(255,255,255,0.15)" : "#00A84566",
                  }]}
                >
                  <Text style={{
                    color: claimNote ? "#fff" : "#555",
                    fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20,
                  }}>
                    {claimNote || "e.g. I bought this car in 2021, my plate is KAA 123B…"}
                  </Text>
                </TouchableOpacity>
                <Text style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, fontFamily: "Inter_400Regular", alignSelf: "flex-end", marginBottom: 16 }}>
                  {claimNote.length}/500
                </Text>
                <TouchableOpacity
                  style={[cs.nextBtn, { marginBottom: 10 }]}
                  onPress={handleSubmitClaim}
                  disabled={claimSending}
                  activeOpacity={0.85}
                >
                  {claimSending
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <>
                        <Ionicons name="send-outline" size={16} color="#fff" />
                        <Text style={cs.nextBtnTxt}>Submit Claim</Text>
                      </>
                  }
                </TouchableOpacity>
                <TouchableOpacity
                  style={cs.skipBtnBelow}
                  onPress={() => setClaimVisible(false)}
                  activeOpacity={0.8}
                >
                  <Text style={cs.skipBelowTxt}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ── Claim note text entry (KeyboardInputModal keeps Submit always visible) */}
      <KeyboardInputModal
        visible={claimNoteKimOpen}
        label="Why is this vehicle yours?"
        value={claimNote}
        onChangeText={(t) => setClaimNote(t.slice(0, 500))}
        onDone={() => setClaimNoteKimOpen(false)}
        onCancel={() => setClaimNoteKimOpen(false)}
        placeholder="e.g. I bought this car in 2021, my plate is KAA 123B…"
        multiline
        inputHeight={130}
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const cs = StyleSheet.create({
  screen:   { flex: 1 },
  header:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  backBtn:  { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  progressRow: { flexDirection: "row", gap: 8 },
  progressDot: { width: 28, height: 4, borderRadius: 2 },
  skipTxt:  { color: "rgba(255,255,255,0.5)", fontSize: 14, fontFamily: "Inter_500Medium" },

  whyBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    marginHorizontal: 20, marginBottom: 8,
    padding: 12, borderRadius: 12,
    backgroundColor: "rgba(0,168,69,0.08)", borderWidth: 1, borderColor: "rgba(0,168,69,0.2)",
  },
  whyTxt:   { flex: 1, color: "rgba(255,255,255,0.7)", fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },

  content:  { padding: 20, paddingBottom: 16 },

  stepTitle: { color: "#fff", fontSize: 22, fontFamily: "Inter_700Bold", marginBottom: 6 },
  stepSub:   { color: "rgba(255,255,255,0.55)", fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 20, lineHeight: 20 },

  // Vehicle type grid
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  typeCard: {
    width: "47%", padding: 14, borderRadius: 16, borderWidth: 1.5,
    alignItems: "center", gap: 6,
  },
  typeEmoji: { fontSize: 32 },
  typeLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", textAlign: "center" },

  // Make grid
  makeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  makeCard: {
    width: "30%", padding: 10, borderRadius: 12, borderWidth: 1,
    alignItems: "center", gap: 4,
  },
  makeEmoji: { fontSize: 22 },
  makeName:  { fontSize: 12, fontFamily: "Inter_600SemiBold", textAlign: "center" },

  // Custom make/model input
  customInputGroup: { marginTop: 16 },
  customLabel: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 6 },
  customInput: {
    backgroundColor: "#1A2820", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    color: "#fff", fontSize: 15, fontFamily: "Inter_400Regular",
  },

  // Model list
  modelList: { gap: 6 },
  modelRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 14, borderRadius: 12, borderWidth: 1,
  },
  modelName: { fontSize: 15, fontFamily: "Inter_500Medium" },

  // Details
  fieldLabel: { color: "rgba(255,255,255,0.7)", fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 10 },
  fieldHint:  { color: "rgba(255,255,255,0.4)", fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 12, marginTop: -6, lineHeight: 17 },
  chipRow:    { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, borderWidth: 1.5,
  },
  chipTxt: { fontSize: 13, fontFamily: "Inter_500Medium" },
  odometerInput: {
    backgroundColor: "#1A2820", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 10, paddingHorizontal: 16, paddingVertical: 13,
    color: "#fff", fontSize: 17, fontFamily: "Inter_500Medium",
  },

  // Duplicate-plate warning card
  dupCard: {
    marginTop: 10,
    backgroundColor: "#F59E0B10",
    borderWidth: 1,
    borderColor: "#F59E0B50",
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  dupTitle: {
    color: "#D97706",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  dupBody: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  dupPrimaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#00A845",
    borderRadius: 10,
    paddingVertical: 11,
  },
  dupPrimaryBtnTxt: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  dupSecondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 10,
    paddingVertical: 10,
  },
  dupSecondaryBtnTxt: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  dupBlockNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 4,
  },
  dupBlockNoteTxt: {
    color: "#D97706",
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },

  // Claim modal sheet
  claimSheet: {
    backgroundColor: "#0B1611",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 36,
  },
  claimHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignSelf: "center",
    marginBottom: 20,
  },
  claimTitle: {
    color: "#fff",
    fontSize: 17,
    fontFamily: "Inter_700Bold",
  },
  claimSub: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
    marginBottom: 16,
    marginTop: 4,
  },
  claimInput: {
    backgroundColor: "#1A2820",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#fff",
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    minHeight: 110,
    marginBottom: 6,
  },

  // Bottom CTA
  bottom:     { padding: 20, paddingBottom: 24, gap: 12 },
  nextBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#00A845", borderRadius: 18, paddingVertical: 15,
  },
  nextBtnTxt:     { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
  skipBtnBelow:   { alignItems: "center", paddingVertical: 4 },
  skipBelowTxt:   { color: "rgba(255,255,255,0.35)", fontSize: 13, fontFamily: "Inter_400Regular" },
});
