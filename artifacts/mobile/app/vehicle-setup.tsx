/**
 * VehicleSetup — shown once after the paywall when a user hasn't configured
 * their vehicle yet. Collects make, model, transmission, fuel type, and
 * current odometer, then seeds the savedVehicles list and navigates to the
 * main app. All steps are optional — the user can skip at any time.
 */
import React, { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { saveVehicles, loadVehicles } from "@/utils/savedVehicles";
import { CAR_MAKES } from "@/data/carModels";
import { VEHICLE_TYPES } from "@/data/vehicleTypes";

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

export default function VehicleSetup() {
  const c = useColors();
  const { setVehicleModel, setVehicleType: setCtxVehicleType, setCustomVehicle } = useApp();

  // Step 0 = type, 1 = make, 2 = model, 3 = details
  const [step, setStep] = useState(0);

  // Form state
  const [vehicleType, setVehicleType] = useState<string>("car");
  const [makeId, setMakeId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [isCustomMake, setIsCustomMake] = useState(false);
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [customMakeName, setCustomMakeName] = useState("");
  const [customModelName, setCustomModelName] = useState("");
  const [transmission, setTransmission] = useState<Transmission | null>(null);
  const [fuelType, setFuelType] = useState<FuelType | null>(null);
  const [odometer, setOdometer] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedMake = useMemo(() => CAR_MAKES.find((m) => m.id === makeId), [makeId]);

  const handleFinish = async () => {
    setSaving(true);
    try {
      const existing = await loadVehicles();
      const odo = parseInt(odometer, 10);
      const resolvedMakeId = isCustomMake ? `custom-${Date.now()}` : (makeId ?? null);
      const resolvedModelId = isCustomModel || isCustomMake ? `custom-${Date.now()}-m` : (modelId ?? null);
      const resolvedCustomMake = isCustomMake ? customMakeName : null;
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
      setCtxVehicleType(vehicleType as any);

      const newVehicle = {
        id: existing.length === 0 ? "v0" : `v${Date.now()}`,
        makeId: resolvedMakeId,
        modelId: resolvedModelId,
        customMakeName: resolvedCustomMake,
        customModelName: resolvedCustomModel,
        vehicleType: vehicleType as any,
        isDefault: true,
        fuelType: fuelType ?? undefined,
        transmission: transmission ?? undefined,
        odometerKm: isNaN(odo) ? undefined : odo,
      };

      if (existing.length === 0) {
        await saveVehicles([newVehicle]);
      } else {
        // Mark all others as non-default, update first slot
        const updated = existing.map((v, i) =>
          i === 0 ? { ...v, ...newVehicle, id: v.id } : { ...v, isDefault: false }
        );
        await saveVehicles(updated);
      }
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
        {step > 0 ? (
          <TouchableOpacity onPress={back} style={cs.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
        ) : <View style={{ width: 36 }} />}
        <View style={cs.progressRow}>
          {[0, 1, 2, 3].map((i) => (
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

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={cs.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Step 0: Vehicle type ───────────────────────────────────────── */}
          {step === 0 && (
            <>
              <Text style={cs.stepTitle}>What do you drive?</Text>
              <Text style={cs.stepSub}>Select the type of vehicle you use most.</Text>
              <View style={cs.typeGrid}>
                {VEHICLE_TYPES.map((vt) => {
                  const emoji =
                    vt.id === "motorcycle" ? "🏍️" :
                    vt.id === "bus"        ? "🚌" :
                    vt.id === "psv"        ? "🚐" :
                    vt.id === "truck"      ? "🚛" :
                    vt.id === "tractor"   ? "🚜" : "🚗";
                  const selected = vehicleType === vt.id;
                  return (
                    <TouchableOpacity
                      key={vt.id}
                      style={[
                        cs.typeCard,
                        selected ? { borderColor: "#00A845", backgroundColor: "#00A84515" } : { borderColor: "rgba(255,255,255,0.12)" },
                      ]}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setVehicleType(vt.id); }}
                      activeOpacity={0.8}
                    >
                      <Text style={cs.typeEmoji}>{emoji}</Text>
                      <Text style={[cs.typeLabel, { color: selected ? "#00A845" : "#ccc" }]}>{vt.label}</Text>
                      {selected && <Ionicons name="checkmark-circle" size={16} color="#00A845" />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

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
                      <Text style={cs.makeEmoji}>{make.emoji}</Text>
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
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setIsCustomMake(true); setMakeId(null); setIsCustomModel(true); }}
                  activeOpacity={0.8}
                >
                  <Text style={cs.makeEmoji}>🚗</Text>
                  <Text style={[cs.makeName, { color: isCustomMake ? "#00A845" : "#ddd" }]}>Other</Text>
                </TouchableOpacity>
              </View>
              {isCustomMake && (
                <View style={cs.customInputGroup}>
                  <Text style={cs.customLabel}>Make name</Text>
                  <TextInput
                    style={cs.customInput}
                    value={customMakeName}
                    onChangeText={setCustomMakeName}
                    placeholder="e.g. Foton, JAC, King Long…"
                    placeholderTextColor="#555"
                    autoCorrect={false}
                  />
                  <Text style={[cs.customLabel, { marginTop: 12 }]}>Model name</Text>
                  <TextInput
                    style={cs.customInput}
                    value={customModelName}
                    onChangeText={setCustomModelName}
                    placeholder="e.g. Tunland, S5…"
                    placeholderTextColor="#555"
                    autoCorrect={false}
                  />
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
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setIsCustomModel(true); setModelId(null); }}
                  activeOpacity={0.8}
                >
                  <Text style={[cs.modelName, { color: isCustomModel ? "#00A845" : "#ddd" }]}>Other / Variant</Text>
                  {isCustomModel && <Ionicons name="checkmark-circle" size={18} color="#00A845" />}
                </TouchableOpacity>
              </View>
              {isCustomModel && (
                <View style={cs.customInputGroup}>
                  <Text style={cs.customLabel}>Model name</Text>
                  <TextInput
                    style={cs.customInput}
                    value={customModelName}
                    onChangeText={setCustomModelName}
                    placeholder="e.g. GX Super, LX Special…"
                    placeholderTextColor="#555"
                    autoCorrect={false}
                  />
                </View>
              )}
            </>
          )}

          {/* ── Step 3: Details ────────────────────────────────────────────── */}
          {step === 3 && (
            <>
              <Text style={cs.stepTitle}>A few more details</Text>
              <Text style={cs.stepSub}>Optional — you can always update these in Garage.</Text>

              <Text style={cs.fieldLabel}>Transmission</Text>
              <ChipRow options={TRANSMISSIONS} value={transmission} onSelect={setTransmission} color="#00A845" />

              <Text style={[cs.fieldLabel, { marginTop: 20 }]}>Fuel type</Text>
              <ChipRow options={FUEL_TYPES} value={fuelType} onSelect={setFuelType} color="#00A845" />

              <Text style={[cs.fieldLabel, { marginTop: 20 }]}>Current odometer (km)</Text>
              <Text style={cs.fieldHint}>
                Used to estimate service intervals and track your mileage in the Garage section.
              </Text>
              <TextInput
                style={cs.odometerInput}
                value={odometer}
                onChangeText={setOdometer}
                placeholder="e.g. 54000"
                placeholderTextColor="#555"
                keyboardType="number-pad"
                returnKeyType="done"
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

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
          <TouchableOpacity
            style={cs.nextBtn}
            onPress={handleFinish}
            disabled={saving}
            activeOpacity={0.85}
          >
            <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
            <Text style={cs.nextBtnTxt}>{saving ? "Saving…" : "Set up my vehicle"}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={handleSkip} style={cs.skipBtnBelow}>
          <Text style={cs.skipBelowTxt}>I'll set this up later in Garage</Text>
        </TouchableOpacity>
      </View>
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
