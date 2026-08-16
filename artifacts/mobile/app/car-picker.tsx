export { ErrorBoundary } from "@/components/ErrorBoundary";
import React, { useCallback, useState, useRef, useMemo, useEffect } from "react";
import { KeyboardInputModal } from "@/components/KeyboardInputModal";
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet,
  TextInput, Image, ActivityIndicator, Platform, ScrollView, Modal,
  KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard,
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
import CarLogoImage from "@/components/CarLogoImage";
import { apiGet, apiPost, API_BASE, ApiError } from "@/utils/apiClient";
import { savePendingDetails, normalizePlate, type VehicleDetails } from "@/utils/savedVehicles";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";

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
      style={{ width: size, height: size * 0.65, transform: [{ scaleX: -1 }] }}
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
  const { vehicleMakeId, vehicleModelId, setVehicleModel, setCustomVehicle, deviceId } = useApp();

  const [step, setStep] = useState<Step>("make");
  const [selectedMake, setSelectedMake] = useState<CarMake | null>(null);
  const [query, setQuery] = useState("");

  // Scroll the shared make/model FlatList back to the top whenever the step
  // changes so the model list always opens from row 0, not the previous scroll position.
  const flatListRef = useRef<FlatList<CarMake | CarModel>>(null);
  useEffect(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [step]);

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
  const [makeModalVisible,  setMakeModalVisible]  = useState(false);
  const [modelModalVisible, setModelModalVisible] = useState(false);
  const [odoModalVisible,   setOdoModalVisible]   = useState(false);

  // Plate duplicate-check state (vehicle-details step)
  const [plateNumber,       setPlateNumber]       = useState("");
  const [plateModalVisible, setPlateModalVisible] = useState(false);
  const [plateChecking,     setPlateChecking]     = useState(false);
  const [plateDuplicate,    setPlateDuplicate]    = useState<{ id: string; displayName: string } | null>(null);
  const plateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [claimVisible,      setClaimVisible]      = useState(false);
  const [claimNote,         setClaimNote]         = useState("");
  const [claimSending,      setClaimSending]      = useState(false);
  const [claimNoteKimOpen,  setClaimNoteKimOpen]  = useState(false);
  const [claimSent,     setClaimSent]     = useState(false);

  // Auto-open the text modal when entering custom make/model steps (replaces autoFocus)
  useEffect(() => {
    if (step === "custom-make")  { setCustomMakeName("");  setMakeModalVisible(true); }
    if (step === "custom-model") { setCustomModelName(""); setModelModalVisible(true); }
  }, [step]);

  // Debounced plate duplicate check — fires when user types in vehicle-details step
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
  }, [plateNumber, deviceId]);

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

  // Custom vehicles fetched from API (already-submitted community makes/models)
  const [customVehicles, setCustomVehicles] = useState<CustomVehicleRecord[]>([]);

  useEffect(() => {
    apiGet<CustomVehicleRecord[]>("/custom-vehicles").then(setCustomVehicles).catch(() => {});
  }, []);

  // ── Merge custom vehicles into the static list ──────────────────────────────
  // Only promote vehicles whose image was found ("done") — that confirms the
  // model is real and the image is ready to display.  Pending/not_found records
  // are intentionally excluded so the list stays clean.
  const allMakes = useMemo<CarMake[]>(() => {
    const promoted = customVehicles.filter((cv) => cv.imageStatus === "done");

    // Group fully-custom makes (no knownMakeId)
    const customMakeMap: Record<string, CarMake> = {};
    for (const cv of promoted) {
      if (cv.knownMakeId) continue;
      const id = `custom-${cv.makeSlug}`;
      if (!customMakeMap[id]) {
        customMakeMap[id] = { id, name: cv.makeName, emoji: "🚗", models: [] };
      }
      // Model ID keeps "custom-" prefix so VehicleThumb knows to resolve the
      // image via slugify(customModelName) rather than a static registry lookup.
      customMakeMap[id].models.push({ id: `custom-${cv.modelSlug}`, name: cv.modelName });
    }

    // Inject promoted models into known makes
    const enrichedKnown = SORTED_MAKES.map((make) => {
      const extras = promoted
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
    const isCustom = selectedMake.id.startsWith("custom-") || model.id.startsWith("custom-");

    // When the user picks a promoted model directly from the list (custom ID,
    // but already in our DB), commit it to AppContext immediately so
    // handleVehicleDetailsConfirm can rely on setCustomVehicle having been
    // called.  For genuinely-new custom models this is done by
    // handleCustomModelConfirm instead — these paths are mutually exclusive.
    if (isCustom) {
      const isKnownMake = !selectedMake.id.startsWith("custom-");
      setCustomVehicle(selectedMake.id, model.id, selectedMake.name, model.name);
      // Increment the submittedCount (dedup logic prevents re-generating the image).
      apiPost("/custom-vehicles", {
        makeName: selectedMake.name,
        modelName: model.name,
        knownMakeId: isKnownMake ? selectedMake.id : null,
      }).catch(() => {});
    }

    setPendingMakeForDetails(selectedMake);
    setPendingModelForDetails(model);
    setPendingIsCustom(isCustom);
    setStep("vehicle-details");
  }, [selectedMake, setCustomVehicle]);

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
      plateNumber: normalizePlate(plateNumber) || undefined,
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
          {isOther ? (
            <Text style={styles.emoji}>{item.emoji}</Text>
          ) : (
            <CarLogoImage makeId={item.id} width={52} height={28} emoji={item.emoji} />
          )}
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
            ref={flatListRef}
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
            <KeyboardInputModal
              visible={makeModalVisible}
              label="Vehicle Make"
              value={customMakeName}
              onChangeText={setCustomMakeName}
              onDone={() => setMakeModalVisible(false)}
              placeholder="e.g. Haima"
              autoCapitalize="words"
            />
            <TouchableOpacity
              style={[styles.customInput, { backgroundColor: c.muted, justifyContent: "center" }]}
              onPress={() => setMakeModalVisible(true)}
              activeOpacity={0.7}
            >
              <Text style={{ color: customMakeName ? c.foreground : c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 16, textAlign: "center" }}>
                {customMakeName || "e.g. Haima"}
              </Text>
            </TouchableOpacity>
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
            <KeyboardInputModal
              visible={modelModalVisible}
              label="Vehicle Model"
              value={customModelName}
              onChangeText={setCustomModelName}
              onDone={() => setModelModalVisible(false)}
              placeholder="e.g. S5"
              autoCapitalize="words"
            />
            <TouchableOpacity
              style={[styles.customInput, { backgroundColor: c.muted, justifyContent: "center" }]}
              onPress={() => setModelModalVisible(true)}
              activeOpacity={0.7}
            >
              <Text style={{ color: customModelName ? c.foreground : c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 16, textAlign: "center" }}>
                {customModelName || "e.g. S5"}
              </Text>
            </TouchableOpacity>
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
        <KeyboardAwareScrollViewCompat
          contentContainerStyle={[styles.customForm, { paddingBottom: insets.bottom + 32 }]}
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
                  style={[styles.customInput, { backgroundColor: c.muted, justifyContent: "center" }]}
                  onPress={() => setOdoModalVisible(true)}
                  activeOpacity={0.7}
                >
                  <Text style={{ color: odometerInput ? c.foreground : c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 16, textAlign: "center" }}>
                    {odometerInput || "e.g. 45000"}
                  </Text>
                </TouchableOpacity>
                <Text style={[styles.detailHint, { color: c.mutedForeground }]}>
                  Used to calculate when maintenance is due. Leave blank if unsure.
                </Text>
              </View>

              {/* Number plate — with duplicate detection */}
              <View style={styles.detailSection}>
                <Text style={[styles.detailLabel, { color: c.mutedForeground }]}>Number Plate</Text>
                <Text style={[styles.detailHint, { color: c.mutedForeground }]}>
                  Prevents duplicate registrations and lets you restore data on a new device.
                </Text>
                <View style={{ position: "relative", width: "100%" }}>
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
                      styles.customInput,
                      { backgroundColor: c.muted, justifyContent: "center" },
                      plateDuplicate && !claimSent && { borderWidth: 1.5, borderColor: "#D97706" },
                    ]}
                    onPress={() => setPlateModalVisible(true)}
                    activeOpacity={0.7}
                  >
                    <Text style={{ color: plateNumber ? c.foreground : c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 16, textAlign: "center" }}>
                      {plateNumber || "e.g. KCB 123A"}
                    </Text>
                  </TouchableOpacity>
                  {plateChecking && (
                    <ActivityIndicator size="small" color={c.primary} style={{ position: "absolute", right: 14, top: 14 }} />
                  )}
                </View>

                {/* Duplicate options */}
                {plateDuplicate && !claimSent && (
                  <View style={{ padding: 12, borderRadius: 12, backgroundColor: "#D9770608", borderWidth: 1.5, borderColor: "#D9770640" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <Ionicons name="warning-outline" size={15} color="#D97706" />
                      <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#D97706" }}>This plate is already registered</Text>
                    </View>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: c.mutedForeground, marginBottom: 10 }}>
                      <Text style={{ fontFamily: "Inter_600SemiBold", color: c.foreground }}>{plateDuplicate.displayName}</Text>
                      {" "}is already on Msafiri. Pick what applies to you:
                    </Text>
                    <TouchableOpacity
                      style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, backgroundColor: c.primary, marginBottom: 8 }}
                      onPress={() => router.push("/restore-data" as any)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="refresh-circle-outline" size={14} color="#fff" />
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" }}>I had this plate — restore my data</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, backgroundColor: c.muted, marginBottom: 6 }}
                      onPress={() => router.push({ pathname: "/join-vehicle", params: { prefillPlate: normalizePlate(plateNumber) } } as any)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="people-outline" size={13} color={c.mutedForeground} />
                      <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: c.mutedForeground }}>I share this car — join as co-driver</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 }}
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
                  <View style={{ padding: 10, borderRadius: 10, backgroundColor: "#22C55E10", borderWidth: 1, borderColor: "#22C55E50", flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="checkmark-circle-outline" size={15} color="#22C55E" />
                    <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: "#22C55E", flex: 1 }}>Claim submitted — our team will review it.</Text>
                  </View>
                )}
              </View>

              {/* Block note when duplicate unresolved */}
              {plateDuplicate && !claimSent && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" }}>
                  <Ionicons name="lock-closed-outline" size={12} color="#D97706" />
                  <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: "#D97706" }}>
                    Resolve the duplicate plate above before saving.
                  </Text>
                </View>
              )}

              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: c.primary, opacity: plateDuplicate && !claimSent ? 0.4 : 1 }]}
                onPress={handleVehicleDetailsConfirm}
                disabled={!!plateDuplicate && !claimSent}
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
          </KeyboardAwareScrollViewCompat>
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
      {/* ── Claim modal (vehicle-details step) ──────────────────────────── */}
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
              <View style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 }}>
                <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: c.tileBorder, marginBottom: 20 }} />
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
                {/* Tappable note card — keyboard entry handled by KeyboardInputModal below */}
                <TouchableOpacity
                  onPress={() => setClaimNoteKimOpen(true)}
                  activeOpacity={0.75}
                  style={{
                    backgroundColor: c.muted, borderRadius: 12, borderWidth: 1,
                    borderColor: claimNote ? c.tileBorder : c.primary + "66",
                    paddingHorizontal: 14, paddingVertical: 11, minHeight: 100,
                    justifyContent: "flex-start", marginBottom: 6,
                  }}
                >
                  <Text style={{
                    color: claimNote ? c.foreground : c.mutedForeground + "88",
                    fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20,
                  }}>
                    {claimNote || "e.g. I bought this car in 2021, my plate is KAA 123B…"}
                  </Text>
                </TouchableOpacity>
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
