export { ErrorBoundary } from "@/components/ErrorBoundary";
import React, { useCallback, useState, useRef, useMemo, useEffect } from "react";
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet,
  TextInput, Image, ActivityIndicator, Platform, ScrollView,
  KeyboardAvoidingView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import {
  SORTED_MAKES, sortedModels, getCarImageUrl,
  type CarMake, type CarModel,
} from "@/data/carModels";
import { apiGet, apiPost, API_BASE } from "@/utils/apiClient";
import { savePendingDetails, type VehicleDetails } from "@/utils/savedVehicles";

// ─── Types ────────────────────────────────────────────────────────────────────
type Step = "make" | "model" | "custom-make" | "custom-model" | "vehicle-details" | "custom-done";

type FuelType = "Petrol" | "Diesel" | "Electric" | "Hybrid" | "CNG";
type TransmissionType = "Automatic" | "Manual";

interface CustomVehicleRecord {
  id: string;
  makeName: string;
  modelName: string;
  makeSlug: string;
  modelSlug: string;
  knownMakeId: string | null;
  imageStatus: "pending" | "done";
  submittedCount: number;
}

// ─── Sentinels ───────────────────────────────────────────────────────────────
const OTHER_MAKE: CarMake = {
  id: "__other__",
  name: "Other — not listed",
  emoji: "🔧",
  models: [],
};
const OTHER_MODEL: CarModel = { id: "__other__", name: "Other — my model isn't listed" };

// ─── Helpers ─────────────────────────────────────────────────────────────────
function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ─── CarImage — thumbnail with 2-level fallback (custom → default → emoji) ──
function CarImage({
  makeId, modelId, emoji, size, isCustom = false,
}: {
  makeId: string; modelId: string; emoji: string; size: number; isCustom?: boolean;
}) {
  const [tryDefault, setTryDefault] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <Text style={{ fontSize: size * 0.6, lineHeight: size }}>{emoji}</Text>;
  }

  const uri = tryDefault
    ? `${API_BASE}/car-images/other/default`
    : getCarImageUrl(makeId, modelId);

  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size * 0.65 }}
      resizeMode="contain"
      onError={() => {
        if (!tryDefault && isCustom) setTryDefault(true);
        else setFailed(true);
      }}
    />
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function CarPickerScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { vehicleMakeId, vehicleModelId, setVehicleModel, setCustomVehicle } = useApp();

  const [step, setStep] = useState<Step>("make");
  const [selectedMake, setSelectedMake] = useState<CarMake | null>(null);
  const [query, setQuery] = useState("");

  // Custom vehicle text inputs
  const [customMakeName, setCustomMakeName] = useState("");
  const [customModelName, setCustomModelName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Vehicle details step (fuel, transmission, odometer) — set just before vehicle-details
  const [pendingMakeForDetails, setPendingMakeForDetails] = useState<CarMake | null>(null);
  const [pendingModelForDetails, setPendingModelForDetails] = useState<CarModel | null>(null);
  const [pendingIsCustom, setPendingIsCustom] = useState(false);
  const [fuelType, setFuelType] = useState<FuelType>("Petrol");
  const [transmission, setTransmission] = useState<TransmissionType>("Automatic");
  const [odometerInput, setOdometerInput] = useState("");

  // Custom vehicles fetched from API (already-submitted community makes/models)
  const [customVehicles, setCustomVehicles] = useState<CustomVehicleRecord[]>([]);

  useEffect(() => {
    apiGet<CustomVehicleRecord[]>("/custom-vehicles").then(setCustomVehicles).catch(() => {});
  }, []);

  // ── Merge custom vehicles into the static list ──────────────────────────────
  const allMakes = useMemo<CarMake[]>(() => {
    // Group fully-custom makes (no knownMakeId)
    const customMakeMap: Record<string, CarMake> = {};
    for (const cv of customVehicles) {
      if (cv.knownMakeId) continue;
      const id = `custom-${cv.makeSlug}`;
      if (!customMakeMap[id]) {
        customMakeMap[id] = { id, name: cv.makeName, emoji: "🚗", models: [] };
      }
      customMakeMap[id].models.push({ id: cv.modelSlug, name: cv.modelName });
    }

    // Inject custom models into known makes
    const enrichedKnown = SORTED_MAKES.map((make) => {
      const extras = customVehicles
        .filter((cv) => cv.knownMakeId === make.id)
        .map((cv) => ({ id: `custom-${cv.modelSlug}`, name: cv.modelName }));
      return extras.length ? { ...make, models: [...make.models, ...extras] } : make;
    });

    return [...enrichedKnown, ...Object.values(customMakeMap), OTHER_MAKE];
  }, [customVehicles]);

  // ── Filtered lists for the search box ──────────────────────────────────────
  const filteredMakes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allMakes;
    return allMakes.filter((m) => m.name.toLowerCase().includes(q));
  }, [allMakes, query]);

  const filteredModels = useMemo(() => {
    if (!selectedMake) return [];
    const models = [...sortedModels(selectedMake), OTHER_MODEL];
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.name.toLowerCase().includes(q));
  }, [selectedMake, query]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleSelectMake = useCallback((make: CarMake) => {
    if (make.id === "__other__") {
      setStep("custom-make");
      setQuery("");
      return;
    }
    setSelectedMake(make);
    setQuery("");
    setStep("model");
  }, []);

  const handleSelectModel = useCallback((model: CarModel) => {
    if (!selectedMake) return;
    if (model.id === "__other__") {
      setStep("custom-model");
      setQuery("");
      return;
    }
    // Go to vehicle-details before committing; store pending selection
    const isCustom = selectedMake.id.startsWith("custom-") || model.id.startsWith("custom-");
    setPendingMakeForDetails(selectedMake);
    setPendingModelForDetails(model);
    setPendingIsCustom(isCustom);
    setStep("vehicle-details");
  }, [selectedMake]);

  const handleBack = useCallback(() => {
    if (step === "model") { setStep("make"); setQuery(""); }
    else if (step === "custom-make") { setStep("make"); setCustomMakeName(""); }
    else if (step === "custom-model") {
      if (selectedMake && selectedMake.id !== "__other__") setStep("model");
      else setStep("custom-make");
      setCustomModelName("");
    }
    else if (step === "vehicle-details") {
      // Return to wherever we came from
      if (pendingIsCustom && !pendingModelForDetails?.id.startsWith("custom-")) {
        // Was on custom-model step
        setStep("custom-model");
      } else if (pendingMakeForDetails) {
        setStep("model");
      } else {
        setStep("make");
      }
    }
    else if (step === "custom-done") { router.back(); }
    else { router.back(); }
  }, [step, selectedMake, pendingIsCustom, pendingMakeForDetails, pendingModelForDetails]);

  const handleCustomMakeNext = useCallback(() => {
    const trimmed = customMakeName.trim();
    if (!trimmed) return;
    setStep("custom-model");
  }, [customMakeName]);

  const handleCustomModelConfirm = useCallback(async () => {
    const modelTrimmed = customModelName.trim();
    if (!modelTrimmed || submitting) return;

    // Determine final make name and IDs
    const isKnownMake = selectedMake && selectedMake.id !== "__other__";
    const makeName = isKnownMake ? selectedMake!.name : customMakeName.trim();
    const makeSlug = isKnownMake ? selectedMake!.id : `custom-${slugify(makeName)}`;
    const modelSlug = slugify(modelTrimmed);
    const knownMakeId = isKnownMake ? selectedMake!.id : null;
    const makeId = isKnownMake ? selectedMake!.id : makeSlug;
    const modelId = `custom-${modelSlug}`;

    // Build synthetic make/model objects for the details step
    const pendMake: CarMake = selectedMake
      ? (selectedMake.id === "__other__" ? { id: makeId, name: makeName, emoji: "🚗", models: [] } : selectedMake)
      : { id: makeId, name: makeName, emoji: "🚗", models: [] };
    const pendModel: CarModel = { id: modelId, name: modelTrimmed };

    // Submit to API in background
    setSubmitting(true);
    apiPost("/custom-vehicles", { makeName, modelName: modelTrimmed, knownMakeId })
      .catch(() => {})
      .finally(() => setSubmitting(false));

    // Write AppContext immediately (offline-safe), then show vehicle-details
    setCustomVehicle(makeId, modelId, makeName, modelTrimmed);
    setPendingMakeForDetails(pendMake);
    setPendingModelForDetails(pendModel);
    setPendingIsCustom(true);
    setStep("vehicle-details");
  }, [customModelName, customMakeName, selectedMake, setCustomVehicle, submitting]);

  const handleVehicleDetailsConfirm = useCallback(async () => {
    if (!pendingMakeForDetails || !pendingModelForDetails) return;

    // Save the extra details so applyPendingSlot can pick them up
    const details: VehicleDetails = {
      fuelType,
      transmission,
      odometerKm: odometerInput.trim() ? parseFloat(odometerInput) : undefined,
    };
    await savePendingDetails(details);

    // Update AppContext if this was a standard (non-custom-model-entry) pick
    if (!pendingIsCustom) {
      setVehicleModel(pendingMakeForDetails.id, pendingModelForDetails.id);
    }

    // For custom routes we already called setCustomVehicle; show done state
    if (pendingIsCustom) {
      setStep("custom-done");
    } else {
      router.back();
    }
  }, [pendingMakeForDetails, pendingModelForDetails, pendingIsCustom, fuelType, transmission, odometerInput, setVehicleModel]);

  // ── Render items ─────────────────────────────────────────────────────────
  const renderMakeItem = useCallback(({ item }: { item: CarMake }) => {
    const isOther = item.id === "__other__";
    const isSelected = vehicleMakeId === item.id;
    return (
      <TouchableOpacity
        style={[
          styles.row,
          { backgroundColor: c.card, borderColor: isSelected ? c.primary : c.tileBorder },
          isOther && { borderStyle: "dashed" },
        ]}
        onPress={() => handleSelectMake(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.emojiBox, { backgroundColor: isOther ? c.primary + "18" : c.muted }]}>
          <Text style={styles.emoji}>{item.emoji}</Text>
        </View>
        <Text style={[styles.rowLabel, { color: isOther ? c.primary : c.foreground }]}>
          {item.name}
        </Text>
        {isSelected && <Ionicons name="checkmark-circle" size={20} color={c.primary} />}
        <Ionicons
          name={isOther ? "add-circle-outline" : "chevron-forward"}
          size={18}
          color={isOther ? c.primary : c.mutedForeground}
          style={{ marginLeft: isSelected ? 6 : 0 }}
        />
      </TouchableOpacity>
    );
  }, [c, vehicleMakeId, handleSelectMake]);

  const renderModelItem = useCallback(({ item }: { item: CarModel }) => {
    if (!selectedMake) return null;
    const isOther = item.id === "__other__";
    const isSelected = vehicleMakeId === selectedMake.id && vehicleModelId === item.id;
    const isCustomModel = item.id.startsWith("custom-");
    return (
      <TouchableOpacity
        style={[
          styles.modelRow,
          { backgroundColor: c.card, borderColor: isSelected ? c.primary : c.tileBorder },
          isOther && { borderStyle: "dashed" },
        ]}
        onPress={() => handleSelectModel(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.modelThumb, { backgroundColor: c.muted }]}>
          <CarImage
            makeId={selectedMake.id}
            modelId={item.id}
            emoji={selectedMake.emoji}
            size={108}
            isCustom={isCustomModel || selectedMake.id.startsWith("custom-")}
          />
        </View>
        <Text style={[styles.modelLabel, { color: isOther ? c.primary : c.foreground }]}>
          {item.name}
        </Text>
        {isOther && (
          <Ionicons name="add-circle-outline" size={18} color={c.primary} />
        )}
        {isSelected && <Ionicons name="checkmark-circle" size={20} color={c.primary} />}
      </TouchableOpacity>
    );
  }, [c, selectedMake, vehicleMakeId, vehicleModelId, handleSelectModel]);

  // ── Derived header title ─────────────────────────────────────────────────
  const headerTitle =
    step === "make"             ? "Select Make" :
    step === "model"            ? (selectedMake?.name ?? "Select Model") :
    step === "custom-make"      ? "Enter Your Make" :
    step === "custom-model"     ? "Enter Your Model" :
    step === "vehicle-details"  ? "Vehicle Details" :
    "Vehicle Saved";

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border, backgroundColor: c.background }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={c.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.foreground }]} numberOfLines={1}>
          {headerTitle}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {/* ── Make / Model list steps ─────────────────────────────────────── */}
      {(step === "make" || step === "model") && (
        <>
          <View style={[styles.searchWrap, { backgroundColor: c.muted }]}>
            <Ionicons name="search" size={16} color={c.mutedForeground} />
            <TextInput
              style={[styles.searchInput, { color: c.foreground }]}
              placeholder={step === "make" ? "Search makes…" : "Search models…"}
              placeholderTextColor={c.mutedForeground}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
          </View>

          {step === "model" && selectedMake && (
            <View style={[styles.breadcrumb, {
              backgroundColor: c.primary + "16", borderColor: c.primary + "40",
            }]}>
              <Text style={[styles.breadcrumbTxt, { color: c.primary }]}>
                {selectedMake.emoji}  {selectedMake.name}
              </Text>
              <TouchableOpacity onPress={() => { setStep("make"); setQuery(""); }}>
                <Text style={[styles.changeTxt, { color: c.primary }]}>Change</Text>
              </TouchableOpacity>
            </View>
          )}

          <FlatList<CarMake | CarModel>
            data={step === "make" ? filteredMakes : filteredModels}
            keyExtractor={(item) => item.id}
            renderItem={(info) =>
              step === "make"
                ? renderMakeItem({ item: info.item as CarMake })
                : renderModelItem({ item: info.item as CarModel })
            }
            contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: insets.bottom + 24 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={{ alignItems: "center", marginTop: 60 }}>
                <Text style={[styles.emptyTxt, { color: c.mutedForeground }]}>
                  No results for "{query}"
                </Text>
              </View>
            }
          />
        </>
      )}

      {/* ── Custom make input ───────────────────────────────────────────── */}
      {step === "custom-make" && (
        <ScrollView
          contentContainerStyle={[styles.customForm, { paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.customCard, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
            <View style={[styles.customIconWrap, { backgroundColor: c.primary + "18" }]}>
              <Ionicons name="car-outline" size={28} color={c.primary} />
            </View>
            <Text style={[styles.customTitle, { color: c.foreground }]}>
              What's the make?
            </Text>
            <Text style={[styles.customSub, { color: c.mutedForeground }]}>
              Type the brand name of your vehicle (e.g. Haima, Foton, BAIC…)
            </Text>
            <TextInput
              style={[styles.customInput, { backgroundColor: c.muted, color: c.foreground }]}
              placeholder="e.g. Haima"
              placeholderTextColor={c.mutedForeground}
              value={customMakeName}
              onChangeText={setCustomMakeName}
              autoCapitalize="words"
              autoCorrect={false}
              autoFocus
              returnKeyType="next"
              onSubmitEditing={handleCustomMakeNext}
            />
            <TouchableOpacity
              style={[
                styles.confirmBtn,
                { backgroundColor: customMakeName.trim() ? c.primary : c.muted },
              ]}
              onPress={handleCustomMakeNext}
              disabled={!customMakeName.trim()}
              activeOpacity={0.8}
            >
              <Text style={[styles.confirmBtnTxt, {
                color: customMakeName.trim() ? "#fff" : c.mutedForeground,
              }]}>
                Next →
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* ── Custom model input ──────────────────────────────────────────── */}
      {step === "custom-model" && (
        <ScrollView
          contentContainerStyle={[styles.customForm, { paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.customCard, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
            <View style={[styles.customIconWrap, { backgroundColor: c.primary + "18" }]}>
              <Ionicons name="settings-outline" size={28} color={c.primary} />
            </View>
            <Text style={[styles.customTitle, { color: c.foreground }]}>
              What's the model?
            </Text>
            {/* Remind the user of the make they confirmed */}
            {(selectedMake || customMakeName.trim()) && (
              <View style={[styles.makeChip, { backgroundColor: c.primary + "16", borderColor: c.primary + "40" }]}>
                <Text style={[styles.makeChipTxt, { color: c.primary }]}>
                  Make: {selectedMake?.name ?? customMakeName.trim()}
                </Text>
              </View>
            )}
            <Text style={[styles.customSub, { color: c.mutedForeground }]}>
              Type the specific model name (e.g. S5, M3 Pro, Truck 4×4…)
            </Text>
            <TextInput
              style={[styles.customInput, { backgroundColor: c.muted, color: c.foreground }]}
              placeholder="e.g. S5"
              placeholderTextColor={c.mutedForeground}
              value={customModelName}
              onChangeText={setCustomModelName}
              autoCapitalize="words"
              autoCorrect={false}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleCustomModelConfirm}
            />
            <TouchableOpacity
              style={[
                styles.confirmBtn,
                { backgroundColor: (customModelName.trim() && !submitting) ? c.primary : c.muted },
              ]}
              onPress={handleCustomModelConfirm}
              disabled={!customModelName.trim() || submitting}
              activeOpacity={0.8}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={c.primary} />
              ) : (
                <Text style={[styles.confirmBtnTxt, {
                  color: customModelName.trim() ? "#fff" : c.mutedForeground,
                }]}>
                  Confirm vehicle
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* ── Vehicle Details step ────────────────────────────────────────── */}
      {step === "vehicle-details" && (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={insets.top + 56}
        >
          <ScrollView
            contentContainerStyle={[styles.customForm, { paddingBottom: insets.bottom + 32 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.customCard, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
              {/* Vehicle chip */}
              {(pendingMakeForDetails || pendingModelForDetails) && (
                <View style={[styles.makeChip, { backgroundColor: c.primary + "16", borderColor: c.primary + "40" }]}>
                  <Ionicons name="car-sport-outline" size={14} color={c.primary} />
                  <Text style={[styles.makeChipTxt, { color: c.primary }]}>
                    {pendingMakeForDetails?.name ?? ""}{pendingModelForDetails ? ` ${pendingModelForDetails.name}` : ""}
                  </Text>
                </View>
              )}

              <Text style={[styles.customTitle, { color: c.foreground }]}>
                A few more details
              </Text>
              <Text style={[styles.customSub, { color: c.mutedForeground }]}>
                These help us personalise your maintenance schedule and odometer tracking. You can update them later.
              </Text>

              {/* Fuel Type */}
              <View style={styles.detailSection}>
                <Text style={[styles.detailLabel, { color: c.mutedForeground }]}>Fuel Type</Text>
                <View style={styles.pillRow}>
                  {(["Petrol", "Diesel", "Electric", "Hybrid", "CNG"] as FuelType[]).map(ft => (
                    <TouchableOpacity
                      key={ft}
                      style={[
                        styles.pill,
                        { borderColor: fuelType === ft ? c.primary : c.tileBorder },
                        fuelType === ft && { backgroundColor: c.primary + "20" },
                      ]}
                      onPress={() => setFuelType(ft)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.pillTxt, { color: fuelType === ft ? c.primary : c.mutedForeground }]}>{ft}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Transmission */}
              <View style={styles.detailSection}>
                <Text style={[styles.detailLabel, { color: c.mutedForeground }]}>Transmission</Text>
                <View style={styles.pillRow}>
                  {(["Automatic", "Manual"] as TransmissionType[]).map(tr => (
                    <TouchableOpacity
                      key={tr}
                      style={[
                        styles.pill,
                        { borderColor: transmission === tr ? c.primary : c.tileBorder },
                        transmission === tr && { backgroundColor: c.primary + "20" },
                      ]}
                      onPress={() => setTransmission(tr)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.pillTxt, { color: transmission === tr ? c.primary : c.mutedForeground }]}>{tr}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Current odometer */}
              <View style={styles.detailSection}>
                <Text style={[styles.detailLabel, { color: c.mutedForeground }]}>Current Odometer (km)</Text>
                <TextInput
                  style={[styles.customInput, { backgroundColor: c.muted, color: c.foreground }]}
                  placeholder="e.g. 45000"
                  placeholderTextColor={c.mutedForeground}
                  value={odometerInput}
                  onChangeText={t => setOdometerInput(t.replace(/[^0-9.]/g, ""))}
                  keyboardType="numeric"
                  returnKeyType="done"
                />
                <Text style={[styles.detailHint, { color: c.mutedForeground }]}>
                  Used to calculate when maintenance is due. Leave blank if unsure.
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: c.primary }]}
                onPress={handleVehicleDetailsConfirm}
                activeOpacity={0.85}
              >
                <Text style={[styles.confirmBtnTxt, { color: "#fff" }]}>
                  {pendingIsCustom ? "Save & Continue →" : "Save Vehicle →"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={() => {
                // Skip details entirely — still save empty details so applyPendingSlot clears the key
                savePendingDetails({}).then(() => {
                  if (!pendingIsCustom && pendingMakeForDetails && pendingModelForDetails) {
                    setVehicleModel(pendingMakeForDetails.id, pendingModelForDetails.id);
                  }
                  if (pendingIsCustom) {
                    setStep("custom-done");
                  } else {
                    router.back();
                  }
                });
              }}>
                <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: c.mutedForeground, marginTop: 4 }}>
                  Skip for now
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* ── Custom done — success state ─────────────────────────────────── */}
      {step === "custom-done" && (
        <ScrollView
          contentContainerStyle={[styles.customForm, { paddingBottom: insets.bottom + 32 }]}
        >
          <View style={[styles.customCard, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
            {/* Default car image as the placeholder */}
            <Image
              source={{ uri: `${API_BASE}/car-images/other/default` }}
              style={styles.doneCarImg}
              resizeMode="contain"
            />
            <View style={[styles.doneIconBadge, { backgroundColor: "#4CAF50" }]}>
              <Ionicons name="checkmark" size={18} color="#fff" />
            </View>
            <Text style={[styles.customTitle, { color: c.foreground, marginTop: 8 }]}>
              Vehicle saved!
            </Text>
            <Text style={[styles.customSub, { color: c.mutedForeground, textAlign: "center" }]}>
              Your vehicle image will appear on your next app open — we're generating it now.
            </Text>
            <View style={[styles.savedVehicleChip, {
              backgroundColor: c.primary + "16", borderColor: c.primary + "40",
            }]}>
              <Ionicons name="car-sport-outline" size={16} color={c.primary} />
              <Text style={[styles.savedVehicleTxt, { color: c.primary }]}>
                {selectedMake?.name ?? customMakeName.trim()}{" "}
                {customModelName.trim()}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.confirmBtn, { backgroundColor: c.primary }]}
              onPress={() => router.back()}
              activeOpacity={0.8}
            >
              <Text style={[styles.confirmBtnTxt, { color: "#fff" }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginLeft: -8 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", flex: 1, textAlign: "center" },

  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    margin: 12, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },

  breadcrumb: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginHorizontal: 12, marginBottom: 4, borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  breadcrumbTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  changeTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold", opacity: 0.8 },

  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 14, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 14,
  },
  emojiBox: { width: 42, height: 42, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: 24 },
  rowLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },

  modelRow: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 14, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 14,
  },
  modelThumb: {
    width: 120, height: 78, borderRadius: 10,
    alignItems: "center", justifyContent: "center", overflow: "hidden",
  },
  modelLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },

  emptyTxt: { fontSize: 14, fontFamily: "Inter_400Regular" },

  // ── Custom input steps ────────────────────────────────────────────────────
  customForm: {
    flexGrow: 1, alignItems: "center", justifyContent: "center",
    padding: 24,
  },
  customCard: {
    width: "100%", borderRadius: 20, borderWidth: 1,
    padding: 24, alignItems: "center", gap: 14,
  },
  customIconWrap: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: "center", justifyContent: "center",
  },
  customTitle: { fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  customSub: {
    fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19,
    textAlign: "center",
  },
  makeChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1,
  },
  makeChipTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  customInput: {
    width: "100%", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, fontFamily: "Inter_500Medium",
  },
  confirmBtn: {
    width: "100%", borderRadius: 14, paddingVertical: 14,
    alignItems: "center", justifyContent: "center",
  },
  confirmBtnTxt: { fontSize: 15, fontFamily: "Inter_700Bold" },

  // ── Vehicle Details step ──────────────────────────────────────────────────
  detailSection: { width: "100%", gap: 8 },
  detailLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  detailHint: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16, marginTop: 4 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5,
  },
  pillTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  // ── Done state ────────────────────────────────────────────────────────────
  doneCarImg: { width: 220, height: 140 },
  doneIconBadge: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    marginTop: -16, // overlap the image bottom edge
  },
  savedVehicleChip: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1,
  },
  savedVehicleTxt: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
