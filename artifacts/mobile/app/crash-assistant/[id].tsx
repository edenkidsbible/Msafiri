/**
 * Crash Assistant — Step-by-step post-accident documentation flow.
 *
 * Steps:
 *  0. Evidence       — Auto-collected GPS / speed / weather summary (read-only)
 *  1. Photos         — 6 scene categories via camera / library
 *  2. Witnesses      — Add / remove witnesses
 *  3. Other Driver   — Other party details
 *  4. Police         — OB number, officer, station
 *  5. Statement      — Driver's written account
 *  6. Report         — Generate PDF and share
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { format } from "date-fns";
import * as ImagePicker from "expo-image-picker";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useApp } from "@/context/AppContext";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, API_BASE } from "@/utils/apiClient";
import { useColors } from "@/hooks/useColors";
import { loadVehicles, type SavedVehicle } from "@/utils/savedVehicles";
import { CAR_MAKES, getMakeById, getModelById } from "@/data/carModels";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Weather {
  description?: string;
  tempC?: number;
  windspeedKmh?: number;
  roadCondition?: string;
}

/** Describes the other party — may be a vehicle, pedestrian/cyclist, or no other party at all. */
interface OtherParty {
  type?: "vehicle" | "pedestrian_cyclist" | "solo";
  // Vehicle collision
  vehicleType?: string; // 'Car' | 'Truck / Lorry' | 'Bus / Matatu' | 'Motorcycle / Boda boda' | 'Other'
  vehicleReg?: string;
  name?: string;
  phone?: string;
  insuranceCompany?: string;
  policyNumber?: string;
  // Pedestrian/cyclist
  injuries?: string;
  // Solo incident — no other party
  cause?: string;
  // Shared free-text notes
  notes?: string;
}

interface PoliceInfo {
  station?: string;
  officerName?: string;
  obNumber?: string;
  reference?: string;
}

interface Photo {
  id: string;
  category: string;
  url?: string | null;
  createdAt: string;
}

interface Witness {
  id: string;
  name: string;
  phone?: string | null;
  notes?: string | null;
}

interface TimelineEvent {
  id: string;
  eventType: string;
  description?: string | null;
  occurredAt: string;
}

interface AccidentRecord {
  id: string;
  status: "draft" | "complete";
  isManual: boolean;
  detectedAt: string;
  lat?: number | null;
  lng?: number | null;
  roadName?: string | null;
  county?: string | null;
  nearbyLandmark?: string | null;
  speedBeforeKmh?: number | null;
  speedAtImpactKmh?: number | null;
  headingDeg?: number | null;
  directionLabel?: string | null;
  destinationName?: string | null;
  distanceM?: number | null;
  durationS?: number | null;
  weather?: Weather | null;
  /** Stored as otherDriverJson on the server — now covers all incident types */
  otherDriver?: OtherParty | null;
  police?: PoliceInfo | null;
  driverStatement?: string | null;
  hasPdf: boolean;
  hasAudioStatement: boolean;
  dashcamClipId?: string | null;
  photos: Photo[];
  witnesses: Witness[];
  timeline: TimelineEvent[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STEPS = ["evidence", "photos", "witnesses", "other_driver", "police", "statement", "report"] as const;
type Step = typeof STEPS[number];

const STEP_LABEL: Record<Step, string> = {
  evidence:     "Evidence",
  photos:       "Photos",
  witnesses:    "Witnesses",
  other_driver: "Other Party",
  police:       "Police",
  statement:    "Statement",
  report:       "Report",
};

const SOLO_CAUSES = [
  "Tyre burst / blowout",
  "Brake failure",
  "Mechanical fault",
  "Animal on road",
  "Road hazard (pothole / debris)",
  "Fell asleep at wheel",
  "Medical emergency",
  "Swerved to avoid obstacle",
  "Lost control / skid",
  "Other",
] as const;

const VEHICLE_TYPES = [
  "Car",
  "Truck / Lorry",
  "Bus / Matatu",
  "Motorcycle / Boda boda",
  "Tuk-tuk",
  "Other",
] as const;

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const PHOTO_CATEGORIES = [
  { id: "front_damage",   label: "Front Damage",   icon: "car-outline" },
  { id: "rear_damage",    label: "Rear Damage",     icon: "car-outline" },
  { id: "side_damage",    label: "Side Damage",     icon: "git-merge-outline" },
  { id: "other_vehicle",  label: "Other Vehicle",   icon: "car-sport-outline" },
  { id: "number_plates",  label: "Number Plates",   icon: "card-outline" },
  { id: "road_condition", label: "Road & Scene",    icon: "map-outline" },
] as const;

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function CrashAssistantScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { deviceId } = useApp();
  const colors = useColors();

  const [record, setRecord] = useState<AccidentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [stepIdx, setStepIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploadingCategory, setUploadingCategory] = useState<string | null>(null);
  // Tracks photos whose R2 upload was not confirmed — keyed by category so the
  // PhotosStep can render a per-category retry chip.
  const [failedUploads, setFailedUploads] = useState<Record<string, Array<{ uri: string; mimeType: string }>>>({});

  // Per-step form state
  const [otherParty, setOtherParty] = useState<OtherParty>({});
  const [police, setPolice] = useState<PoliceInfo>({});
  const [statement, setStatement] = useState("");
  const [witnessForm, setWitnessForm] = useState({ name: "", phone: "", notes: "" });
  const [showWitnessForm, setShowWitnessForm] = useState(false);
  // Audio statement state (tracks whether audio has been uploaded so the PDF can note it)
  const [audioStatementUploaded, setAudioStatementUploaded] = useState(false);

  // Report step
  const [generating, setGenerating] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  // My vehicle — pre-populated from saved vehicles, auto-fills report details
  const [myVehicle, setMyVehicle] = useState<SavedVehicle | null>(null);
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [savedVehicles, setSavedVehicles] = useState<SavedVehicle[]>([]);
  useEffect(() => {
    loadVehicles().then((list) => {
      setSavedVehicles(list);
      const def = list.find((v) => v.isDefault) ?? list[0] ?? null;
      setMyVehicle(def);
    }).catch(() => {});
  }, []);

  const scrollRef = useRef<ScrollView | null>(null);

  const loadRecord = useCallback(async () => {
    if (!deviceId || !id) return;
    try {
      const data: AccidentRecord = await apiGet(`/accidents/${id}?deviceId=${deviceId}`);
      setRecord(data);
      // Pre-populate form state from saved record
      if (data.otherDriver) setOtherParty(data.otherDriver);
      if (data.police) setPolice(data.police);
      if (data.driverStatement) setStatement(data.driverStatement);
      if (data.hasAudioStatement) setAudioStatementUploaded(true);
      if (data.hasPdf) setPdfUrl(`report-ready`);
    } catch {
      Alert.alert("Error", "Could not load accident record.");
    } finally {
      setLoading(false);
    }
  }, [deviceId, id]);

  useEffect(() => { loadRecord(); }, [loadRecord]);

  // Scroll to top when step changes
  useEffect(() => { scrollRef.current?.scrollTo({ y: 0, animated: true }); }, [stepIdx]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const currentStep = STEPS[stepIdx]!;

  const saveCurrentStep = useCallback(async () => {
    if (!deviceId || !id || !record) return;
    try {
      if (currentStep === "other_driver") {
        await apiPatch(`/accidents/${id}`, { deviceId, otherDriver: otherParty });
      } else if (currentStep === "police") {
        await apiPatch(`/accidents/${id}`, { deviceId, police });
      } else if (currentStep === "statement") {
        await apiPatch(`/accidents/${id}`, { deviceId, driverStatement: statement });
      }
    } catch { /* fire-and-forget; user can retry */ }
  }, [currentStep, deviceId, id, record, otherParty, police, statement]);

  const handleNext = useCallback(async () => {
    await saveCurrentStep();
    if (stepIdx < STEPS.length - 1) setStepIdx((s) => s + 1);
  }, [saveCurrentStep, stepIdx]);

  const handleBack = useCallback(() => {
    if (stepIdx > 0) setStepIdx((s) => s - 1);
  }, [stepIdx]);

  // ── Photo Upload ──────────────────────────────────────────────────────────

  // Core upload helper shared by the initial pick and the retry path.
  const runUpload = useCallback(async (
    category: string,
    uri: string,
    mimeType: string,
  ): Promise<"ok" | "confirm_failed"> => {
    if (!deviceId || !id) return "ok";

    const { photoId, uploadUrl } = await apiPost(`/accidents/${id}/photos/request-upload`, {
      deviceId, category, contentType: mimeType,
    }) as { photoId: string; uploadUrl: string };

    // Upload via blob fetch (React Native supports this)
    const blobResponse = await fetch(uri);
    const blob = await blobResponse.blob();
    await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: blob,
    });

    // Confirm server-side — 410 means the PUT never reached R2.
    try {
      await apiPost(`/accidents/${id}/photos/${photoId}/confirm`, { deviceId });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 410 || err.status === 404)) {
        return "confirm_failed";
      }
      throw err;
    }
    return "ok";
  }, [deviceId, id]);

  const pickAndUploadPhoto = useCallback(async (category: string, source: "camera" | "library") => {
    if (!deviceId || !id) return;
    try {
      const result = source === "camera"
        ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });

      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const mimeType = asset.mimeType ?? "image/jpeg";

      setUploadingCategory(category);

      const outcome = await runUpload(category, asset.uri, mimeType);
      if (outcome === "confirm_failed") {
        // File never landed in storage — keep the local URI so the driver can retry.
        setFailedUploads((prev) => ({
          ...prev,
          [category]: [...(prev[category] ?? []), { uri: asset.uri, mimeType }],
        }));
        return;
      }

      await loadRecord();
    } catch {
      Alert.alert("Upload Failed", "Could not upload photo. Please try again.");
    } finally {
      setUploadingCategory(null);
    }
  }, [deviceId, id, runUpload, loadRecord]);

  const retryFailedUpload = useCallback(async (category: string, uri: string, mimeType: string) => {
    // Optimistically remove from failed list before retrying.
    setFailedUploads((prev) => {
      const next = { ...prev };
      next[category] = (next[category] ?? []).filter((f) => f.uri !== uri);
      if (next[category]!.length === 0) delete next[category];
      return next;
    });

    setUploadingCategory(category);
    try {
      const outcome = await runUpload(category, uri, mimeType);
      if (outcome === "confirm_failed") {
        setFailedUploads((prev) => ({
          ...prev,
          [category]: [...(prev[category] ?? []), { uri, mimeType }],
        }));
        return;
      }
      await loadRecord();
    } catch {
      // Restore to failed list so the driver sees the retry chip again.
      setFailedUploads((prev) => ({
        ...prev,
        [category]: [...(prev[category] ?? []), { uri, mimeType }],
      }));
      Alert.alert("Upload Failed", "Could not upload photo. Please try again.");
    } finally {
      setUploadingCategory(null);
    }
  }, [runUpload, loadRecord]);

  const showPhotoOptions = useCallback((category: string) => {
    Alert.alert("Add Photo", "Choose source", [
      { text: "Take Photo", onPress: () => pickAndUploadPhoto(category, "camera") },
      { text: "Choose from Library", onPress: () => pickAndUploadPhoto(category, "library") },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [pickAndUploadPhoto]);

  const deletePhoto = useCallback(async (photoId: string) => {
    if (!deviceId || !id) return;
    Alert.alert("Delete Photo", "Remove this photo?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          await apiDelete(`/accidents/${id}/photos/${photoId}?deviceId=${deviceId}`, {});
          await loadRecord();
        },
      },
    ]);
  }, [deviceId, id, loadRecord]);

  // ── Witness Management ────────────────────────────────────────────────────

  const addWitness = useCallback(async () => {
    if (!witnessForm.name.trim() || !deviceId || !id) return;
    setSaving(true);
    try {
      await apiPost(`/accidents/${id}/witnesses`, {
        deviceId,
        name: witnessForm.name.trim(),
        phone: witnessForm.phone.trim() || undefined,
        notes: witnessForm.notes.trim() || undefined,
      });
      setWitnessForm({ name: "", phone: "", notes: "" });
      setShowWitnessForm(false);
      await loadRecord();
    } catch {
      Alert.alert("Error", "Could not add witness.");
    } finally {
      setSaving(false);
    }
  }, [witnessForm, deviceId, id, loadRecord]);

  const deleteWitness = useCallback(async (witnessId: string) => {
    if (!deviceId || !id) return;
    await apiDelete(`/accidents/${id}/witnesses/${witnessId}?deviceId=${deviceId}`, {});
    await loadRecord();
  }, [deviceId, id, loadRecord]);

  // ── Report Generation ─────────────────────────────────────────────────────

  const generateReport = useCallback(async () => {
    if (!deviceId || !id) return;
    setGenerating(true);
    try {
      // Best-effort save — don't let a save failure block report generation.
      // The report is generated from whatever data is already on the server.
      try {
        await apiPatch(`/accidents/${id}`, {
          deviceId,
          driverStatement: statement || undefined,
          otherDriver: Object.keys(otherParty).length > 0 ? otherParty : undefined,
          status: "complete",
        });
      } catch { /* proceed anyway */ }

      const { url } = await apiGet(`/accidents/${id}/report?deviceId=${deviceId}`) as { url: string };
      setPdfUrl(url);
      await loadRecord();
    } catch {
      Alert.alert("Error", "Could not generate report. Please try again.");
    } finally {
      setGenerating(false);
    }
  }, [deviceId, id, statement, otherParty, loadRecord]);

  const shareReport = useCallback(async () => {
    if (!id) return;
    // Use the short branded URL that redirects server-side to the signed PDF.
    // This avoids sharing long presigned R2 URLs with insurers / authorities.
    const dateStr = record ? format(new Date(record.detectedAt), "d MMM yyyy") : "";
    const shortUrl = `${API_BASE}/accidents/${id}/report/view`;
    try {
      await Share.share({ url: shortUrl, message: `Crash Report — ${dateStr}` });
    } catch {
      Alert.alert("Error", "Could not share report.");
    }
  }, [id, record]);

  // ── Render ────────────────────────────────────────────────────────────────

  const styles = makeStyles(colors);

  if (loading || !record) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading record…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const hasPdfReady = !!(record.hasPdf || (pdfUrl && pdfUrl !== "report-ready"));

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Crash Assistant</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            {format(new Date(record.detectedAt), "d MMM yyyy · h:mm a")}
          </Text>
        </View>
        <View style={[styles.stepBadge, { backgroundColor: colors.primary + "18" }]}>
          <Text style={[styles.stepBadgeText, { color: colors.primary }]}>
            {stepIdx + 1}/{STEPS.length}
          </Text>
        </View>
      </View>

      {/* ── Step Progress ────────────────────────────────────────────────── */}
      <View style={styles.progressWrap}>
        {STEPS.map((step, i) => {
          const done    = i < stepIdx;
          const current = i === stepIdx;
          return (
            <React.Fragment key={step}>
              <TouchableOpacity
                style={[
                  styles.progressStep,
                  done    && { backgroundColor: colors.primary, borderColor: colors.primary },
                  current && { backgroundColor: colors.primary, borderColor: colors.primary },
                  !done && !current && { backgroundColor: "transparent", borderColor: colors.border },
                ]}
                onPress={() => setStepIdx(i)}
                activeOpacity={0.75}
              >
                {done ? (
                  <Ionicons name="checkmark" size={11} color="#fff" />
                ) : (
                  <Text style={[
                    styles.progressStepNum,
                    { color: current ? "#fff" : colors.mutedForeground },
                  ]}>
                    {i + 1}
                  </Text>
                )}
              </TouchableOpacity>
              {i < STEPS.length - 1 && (
                <View style={[
                  styles.progressLine,
                  { backgroundColor: i < stepIdx ? colors.primary : colors.border },
                ]} />
              )}
            </React.Fragment>
          );
        })}
      </View>

      {/* ── Current step label ──────────────────────────────────────────── */}
      <View style={styles.stepLabelRow}>
        <Ionicons
          name={
            currentStep === "evidence"     ? "shield-checkmark-outline" :
            currentStep === "photos"       ? "camera-outline" :
            currentStep === "witnesses"    ? "people-outline" :
            currentStep === "other_driver" ? "car-outline" :
            currentStep === "police"       ? "shield-outline" :
            currentStep === "statement"    ? "create-outline" :
                                             "document-text-outline"
          }
          size={18}
          color={colors.primary}
        />
        <Text style={[styles.stepName, { color: colors.text }]}>{STEP_LABEL[currentStep]}</Text>
      </View>

      {/* ── Step Content ─────────────────────────────────────────────────── */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          {currentStep === "evidence" && (
            <>
              {/* ── My Vehicle selector ─────────────────────────────────── */}
              <TouchableOpacity
                style={[
                  styles.vehicleCard,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
                onPress={() => setShowVehicleModal(true)}
                activeOpacity={0.8}
              >
                <View style={[styles.vehicleCardIcon, { backgroundColor: colors.primary + "18" }]}>
                  <Ionicons name="car-outline" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.vehicleCardLabel, { color: colors.mutedForeground }]}>My Vehicle</Text>
                  <Text style={[styles.vehicleCardValue, { color: colors.text }]} numberOfLines={1}>
                    {myVehicle
                      ? [myVehicle.customMakeName ?? getMakeById(myVehicle.makeId ?? "")?.name ?? myVehicle.makeId ?? "—",
                          myVehicle.customModelName ?? getModelById(myVehicle.makeId ?? "", myVehicle.modelId ?? "")?.name ?? myVehicle.modelId ?? ""].filter(Boolean).join(" ")
                      : "Not selected — tap to add"}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>

              <EvidenceStep record={record} colors={colors} styles={styles} />
            </>
          )}

          {currentStep === "photos" && (
            <PhotosStep
              record={record}
              uploadingCategory={uploadingCategory}
              failedUploads={failedUploads}
              onAdd={showPhotoOptions}
              onDelete={deletePhoto}
              onRetry={retryFailedUpload}
              colors={colors}
              styles={styles}
            />
          )}

          {currentStep === "witnesses" && (
            <WitnessesStep
              witnesses={record.witnesses}
              showForm={showWitnessForm}
              form={witnessForm}
              saving={saving}
              onSetForm={setWitnessForm}
              onShowForm={setShowWitnessForm}
              onAdd={addWitness}
              onDelete={deleteWitness}
              colors={colors}
              styles={styles}
            />
          )}

          {currentStep === "other_driver" && (
            <OtherPartyStep value={otherParty} onChange={setOtherParty} colors={colors} styles={styles} />
          )}

          {currentStep === "police" && (
            <PoliceStep value={police} onChange={setPolice} colors={colors} styles={styles} />
          )}

          {currentStep === "statement" && (
            <StatementStep
              value={statement}
              onChange={setStatement}
              accidentId={id}
              deviceId={deviceId ?? ""}
              hasAudioStatement={audioStatementUploaded}
              onAudioUploaded={() => { setAudioStatementUploaded(true); loadRecord(); }}
              colors={colors}
              styles={styles}
            />
          )}

          {currentStep === "report" && (
            <ReportStep
              record={record}
              hasPdfReady={hasPdfReady}
              generating={generating}
              pdfUrl={pdfUrl !== "report-ready" ? pdfUrl : null}
              onGenerate={generateReport}
              onShare={shareReport}
              colors={colors}
              styles={styles}
            />
          )}

        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Navigation Buttons ────────────────────────────────────────────── */}
      <SafeAreaView edges={["bottom"]} style={[styles.navBar, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[
            styles.navBtn,
            { borderColor: stepIdx === 0 ? colors.border + "60" : colors.border,
              opacity: stepIdx === 0 ? 0.4 : 1 },
          ]}
          onPress={handleBack}
          disabled={stepIdx === 0}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={18} color={colors.text} />
          <Text style={[styles.navBtnText, { color: colors.text }]}>Back</Text>
        </TouchableOpacity>

        {stepIdx < STEPS.length - 1 ? (
          <TouchableOpacity
            style={[styles.navBtnPrimary, { backgroundColor: colors.primary }]}
            onPress={handleNext}
            activeOpacity={0.85}
          >
            <Text style={styles.navBtnPrimaryText}>Continue</Text>
            <Ionicons name="arrow-forward" size={18} color={colors.primaryForeground ?? "#fff"} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.navBtnPrimary, { backgroundColor: colors.success ?? colors.primary }]}
            onPress={() => router.back()}
            activeOpacity={0.85}
          >
            <Ionicons name="checkmark-circle" size={20} color="#fff" />
            <Text style={styles.navBtnPrimaryText}>Complete</Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>
      {/* ── My Vehicle picker modal ─────────────────────────────────────── */}
      <Modal
        visible={showVehicleModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowVehicleModal(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setShowVehicleModal(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={[styles.vehicleModalSheet, { backgroundColor: colors.card }]}
            onPress={() => {}}
          >
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: 8 }} />
            <Text style={[styles.vehicleModalTitle, { color: colors.text }]}>Select Your Vehicle</Text>
            <Text style={[styles.vehicleModalSub, { color: colors.mutedForeground }]}>
              The selected vehicle will appear in your crash report.
            </Text>

            {savedVehicles.length === 0 ? (
              <View style={{ alignItems: "center", padding: 24, gap: 8 }}>
                <Ionicons name="car-outline" size={36} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, textAlign: "center", fontSize: 14 }}>
                  No saved vehicles yet.{"\n"}Add one in the Garage section.
                </Text>
              </View>
            ) : (
              savedVehicles.map((v) => {
                const makeName = v.customMakeName ?? getMakeById(v.makeId ?? "")?.name ?? v.makeId ?? "—";
                const modelName = v.customModelName ?? getModelById(v.makeId ?? "", v.modelId ?? "")?.name ?? v.modelId ?? "";
                const selected = myVehicle?.id === v.id;
                return (
                  <TouchableOpacity
                    key={v.id}
                    style={[
                      styles.vehiclePickRow,
                      { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary + "10" : "transparent" },
                    ]}
                    onPress={() => { setMyVehicle(v); setShowVehicleModal(false); }}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.vehiclePickIcon, { backgroundColor: selected ? colors.primary + "18" : colors.muted }]}>
                      <Ionicons name="car-outline" size={20} color={selected ? colors.primary : colors.mutedForeground} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: colors.text, fontFamily: "Inter_600SemiBold", fontSize: 14 }} numberOfLines={1}>
                        {[makeName, modelName].filter(Boolean).join(" ") || "Unknown Vehicle"}
                      </Text>
                      {v.vehicleType && (
                        <Text style={{ color: colors.mutedForeground, fontSize: 12, textTransform: "capitalize" }}>
                          {v.vehicleType}
                        </Text>
                      )}
                    </View>
                    {selected && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })
            )}

            <TouchableOpacity
              style={[styles.vehicleModalDone, { backgroundColor: colors.primary }]}
              onPress={() => setShowVehicleModal(false)}
              activeOpacity={0.85}
            >
              <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 }}>Done</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EvidenceStep({ record, colors, styles }: { record: AccidentRecord; colors: ReturnType<typeof useColors>; styles: ReturnType<typeof makeStyles> }) {
  const speedBefore = record.speedBeforeKmh ? Math.round(record.speedBeforeKmh) : null;
  const speedImpact = record.speedAtImpactKmh ? Math.round(record.speedAtImpactKmh) : null;

  // Build grouped rows for each section
  const locationRows = [
    record.roadName         && { label: "Road",        value: record.roadName },
    record.nearbyLandmark   && { label: "Nearby",       value: record.nearbyLandmark },
    record.county           && { label: "County",       value: record.county },
    (record.lat != null && record.lng != null)
      && { label: "Coordinates", value: `${Number(record.lat).toFixed(5)}, ${Number(record.lng).toFixed(5)}` },
  ].filter(Boolean) as { label: string; value: string }[];

  const speedRows = [
    speedBefore != null && { label: "Before impact", value: `${speedBefore} km/h`, highlight: true },
    speedImpact != null && { label: "At impact",     value: `${speedImpact} km/h`, highlight: true },
    record.directionLabel   && { label: "Direction",    value: record.directionLabel },
  ].filter(Boolean) as { label: string; value: string; highlight?: boolean }[];

  const weatherRows = record.weather ? [
    record.weather.description && { label: "Conditions",   value: record.weather.description },
    record.weather.tempC != null && { label: "Temperature", value: `${record.weather.tempC}°C` },
    record.weather.roadCondition && { label: "Road surface", value: record.weather.roadCondition },
  ].filter(Boolean) as { label: string; value: string }[] : [];

  return (
    <View>
      {/* Type banner */}
      <View style={[styles.infoCard, {
        backgroundColor: record.isManual ? colors.card : "#FF3B3010",
        borderColor: record.isManual ? colors.border : "#FF3B3040",
      }]}>
        <View style={styles.infoCardHeader}>
          <View style={{
            width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center",
            backgroundColor: record.isManual ? colors.primary + "18" : "#FF3B3018",
          }}>
            <Ionicons name={record.isManual ? "document-text-outline" : "warning-outline"} size={20}
              color={record.isManual ? colors.primary : "#FF3B30"} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.infoCardTitle, { color: colors.text }]}>
              {record.isManual ? "Manual Report" : "Crash Auto-Detected"}
            </Text>
            <Text style={[styles.infoNote, { color: colors.mutedForeground }]}>
              {record.isManual
                ? "You started this report manually."
                : "Collision detected automatically."}
            </Text>
          </View>
        </View>
      </View>

      {/* Location */}
      {locationRows.length > 0 && (
        <>
          <SectionHeader title="Location" icon="location-outline" colors={colors} />
          <View style={[styles.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {locationRows.map((row, i) => (
              <View
                key={row.label}
                style={i < locationRows.length - 1 ? styles.groupRow : styles.groupRowLast}
              >
                <Text style={[styles.infoLabel, { flex: 1 }]}>{row.label}</Text>
                <Text style={[styles.infoValue, { color: colors.text }]}>{row.value}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* Speed */}
      {speedRows.length > 0 && (
        <>
          <SectionHeader title="Vehicle Speed" icon="speedometer-outline" colors={colors} />
          <View style={[styles.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {speedRows.map((row, i) => (
              <View
                key={row.label}
                style={i < speedRows.length - 1 ? styles.groupRow : styles.groupRowLast}
              >
                <Text style={[styles.infoLabel, { flex: 1 }]}>{row.label}</Text>
                <Text style={[styles.infoValue, { color: row.highlight ? colors.primary : colors.text }]}>
                  {row.value}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* Weather */}
      {weatherRows.length > 0 && (
        <>
          <SectionHeader title="Weather & Road" icon="partly-sunny-outline" colors={colors} />
          <View style={[styles.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {weatherRows.map((row, i) => (
              <View
                key={row.label}
                style={i < weatherRows.length - 1 ? styles.groupRow : styles.groupRowLast}
              >
                <Text style={[styles.infoLabel, { flex: 1 }]}>{row.label}</Text>
                <Text style={[styles.infoValue, { color: colors.text }]}>{row.value}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* Dashcam */}
      {record.dashcamClipId && (
        <>
          <SectionHeader title="Dashcam" icon="videocam-outline" colors={colors} />
          <View style={[styles.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.groupRowLast}>
              <Text style={[styles.infoLabel, { flex: 1 }]}>Clip status</Text>
              <Text style={[styles.infoValue, { color: colors.primary }]}>Footage saved</Text>
            </View>
          </View>
        </>
      )}

      <View style={styles.evidenceNote}>
        <Ionicons name="lock-closed-outline" size={15} color={colors.mutedForeground} />
        <Text style={[styles.evidenceNoteText, { color: colors.mutedForeground }]}>
          This evidence was captured automatically at the moment of the incident and cannot be edited.
        </Text>
      </View>
    </View>
  );
}

function PhotosStep({
  record, uploadingCategory, failedUploads, onAdd, onDelete, onRetry, colors, styles,
}: {
  record: AccidentRecord;
  uploadingCategory: string | null;
  failedUploads: Record<string, Array<{ uri: string; mimeType: string }>>;
  onAdd: (cat: string) => void;
  onDelete: (id: string) => void;
  onRetry: (category: string, uri: string, mimeType: string) => void;
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  const photosByCategory: Record<string, Photo[]> = {};
  for (const p of record.photos) {
    if (!photosByCategory[p.category]) photosByCategory[p.category] = [];
    photosByCategory[p.category]!.push(p);
  }

  return (
    <View>
      <Text style={[styles.stepIntro, { color: colors.mutedForeground }]}>
        Document the scene with photos. Each category helps with your insurance claim.
      </Text>
      {PHOTO_CATEGORIES.map((cat) => {
        const photos = photosByCategory[cat.id] ?? [];
        const failed = failedUploads[cat.id] ?? [];
        const uploading = uploadingCategory === cat.id;
        const hasAny = photos.length > 0 || failed.length > 0;
        return (
          <View key={cat.id} style={[styles.photoCatCard, { backgroundColor: colors.card, borderColor: hasAny ? (failed.length > 0 ? "#FF3B3060" : colors.primary + "60") : colors.border }]}>
            <View style={styles.photoCatHeader}>
              <View style={[styles.photoCatIcon, { backgroundColor: hasAny ? (failed.length > 0 ? "#FF3B3018" : colors.primary + "18") : colors.muted + "15" }]}>
                <Ionicons name={cat.icon as any} size={20} color={hasAny ? (failed.length > 0 ? "#FF3B30" : colors.primary) : colors.mutedForeground} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.photoCatLabel, { color: colors.text }]}>{cat.label}</Text>
                <Text style={[styles.photoCatCount, { color: failed.length > 0 ? "#FF3B30" : colors.mutedForeground }]}>
                  {photos.length === 0 && failed.length === 0
                    ? "No photos"
                    : photos.length === 0 && failed.length > 0
                      ? `${failed.length} failed`
                      : `${photos.length} photo${photos.length > 1 ? "s" : ""}${failed.length > 0 ? ` · ${failed.length} failed` : ""}`}
                </Text>
              </View>
              {uploading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <TouchableOpacity style={[styles.addPhotoBtn, { borderColor: colors.primary }]} onPress={() => onAdd(cat.id)}>
                  <Ionicons name="camera" size={16} color={colors.primary} />
                  <Text style={[styles.addPhotoBtnText, { color: colors.primary }]}>Add</Text>
                </TouchableOpacity>
              )}
            </View>
            {(photos.length > 0 || failed.length > 0) && (
              <View style={styles.photoList}>
                {photos.map((p) => (
                  <View key={p.id} style={[styles.photoChip, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "40" }]}>
                    <Ionicons name="image-outline" size={13} color={colors.primary} />
                    <Text style={[styles.photoChipText, { color: colors.primary }]}>
                      {format(new Date(p.createdAt), "h:mm a")}
                    </Text>
                    <TouchableOpacity onPress={() => onDelete(p.id)}>
                      <Ionicons name="close" size={14} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </View>
                ))}
                {failed.map((f, idx) => (
                  <TouchableOpacity
                    key={`failed-${idx}`}
                    style={[styles.photoChip, { backgroundColor: "#FF3B3012", borderColor: "#FF3B3040" }]}
                    onPress={() => onRetry(cat.id, f.uri, f.mimeType)}
                  >
                    <Ionicons name="warning-outline" size={13} color="#FF3B30" />
                    <Text style={[styles.photoChipText, { color: "#FF3B30" }]}>Upload failed — tap to retry</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function WitnessesStep({
  witnesses, showForm, form, saving,
  onSetForm, onShowForm, onAdd, onDelete, colors, styles,
}: {
  witnesses: Witness[];
  showForm: boolean;
  form: { name: string; phone: string; notes: string };
  saving: boolean;
  onSetForm: (v: { name: string; phone: string; notes: string }) => void;
  onShowForm: (v: boolean) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View>
      <Text style={[styles.stepIntro, { color: colors.mutedForeground }]}>
        Record the names and contact details of anyone who witnessed the accident.
      </Text>

      {witnesses.map((w) => (
        <View key={w.id} style={[styles.witnessCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.witnessCardRow}>
            <Ionicons name="person-circle-outline" size={32} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.witnessName, { color: colors.text }]}>{w.name}</Text>
              {w.phone && <Text style={[styles.witnessSub, { color: colors.mutedForeground }]}>{w.phone}</Text>}
              {w.notes && <Text style={[styles.witnessSub, { color: colors.mutedForeground }]} numberOfLines={2}>{w.notes}</Text>}
            </View>
            <TouchableOpacity onPress={() => onDelete(w.id)}>
              <Ionicons name="trash-outline" size={20} color="#FF3B30" />
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {witnesses.length === 0 && !showForm && (
        <View style={[styles.emptyState, { borderColor: colors.border }]}>
          <Ionicons name="people-outline" size={32} color={colors.mutedForeground} />
          <Text style={[styles.emptyStateText, { color: colors.mutedForeground }]}>No witnesses added</Text>
        </View>
      )}

      {showForm ? (
        <View style={[styles.witnessForm, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.formLabel, { color: colors.text }]}>Witness Details</Text>
          <FormInput label="Full Name *" value={form.name} onChangeText={(t) => onSetForm({ ...form, name: t })} placeholder="Jane Doe" colors={colors} styles={styles} />
          <FormInput label="Phone Number" value={form.phone} onChangeText={(t) => onSetForm({ ...form, phone: t })} placeholder="+254 700 000 000" keyboardType="phone-pad" colors={colors} styles={styles} />
          <FormInput label="Notes" value={form.notes} onChangeText={(t) => onSetForm({ ...form, notes: t })} placeholder="What they saw..." multiline colors={colors} styles={styles} />
          <View style={styles.formBtns}>
            <TouchableOpacity style={[styles.formCancelBtn, { borderColor: colors.border }]} onPress={() => onShowForm(false)}>
              <Text style={[styles.formCancelBtnText, { color: colors.text }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.formSaveBtn, { backgroundColor: colors.primary }]}
              onPress={onAdd}
              disabled={saving || !form.name.trim()}
            >
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.formSaveBtnText}>Add Witness</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={[styles.addBtn, { borderColor: colors.primary, borderStyle: "dashed" }]} onPress={() => onShowForm(true)}>
          <Ionicons name="person-add-outline" size={20} color={colors.primary} />
          <Text style={[styles.addBtnText, { color: colors.primary }]}>Add Witness</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/** Incident-type selector + dynamic other-party form. */
function OtherPartyStep({ value, onChange, colors, styles }: {
  value: OtherParty;
  onChange: (v: OtherParty) => void;
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  const incidentType = value.type ?? null;

  const INCIDENT_TYPES: { id: OtherParty["type"]; label: string; icon: string; desc: string }[] = [
    { id: "vehicle",             label: "Vehicle Collision",    icon: "car-outline",        desc: "Collided with another vehicle" },
    { id: "pedestrian_cyclist",  label: "Pedestrian / Cyclist", icon: "walk-outline",       desc: "Hit a pedestrian or cyclist" },
    { id: "solo",                label: "Solo Incident",        icon: "warning-outline",    desc: "No other party — tyre burst, road hazard, etc." },
  ];

  return (
    <View>
      <Text style={[styles.stepIntro, { color: colors.mutedForeground }]}>
        Select the type of incident. This shapes the rest of your report.
      </Text>

      {/* Incident type selector */}
      {INCIDENT_TYPES.map((t) => {
        const selected = incidentType === t.id;
        return (
          <TouchableOpacity
            key={t.id}
            style={[
              styles.incidentTypeCard,
              {
                backgroundColor: selected ? colors.primary + "12" : colors.card,
                borderColor:     selected ? colors.primary         : colors.border,
              },
            ]}
            onPress={() => onChange({ ...value, type: t.id })}
            activeOpacity={0.75}
          >
            <View style={[styles.incidentTypeIcon, { backgroundColor: selected ? colors.primary + "20" : colors.muted + "15" }]}>
              <Ionicons name={t.icon as any} size={22} color={selected ? colors.primary : colors.mutedForeground} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.incidentTypeLabel, { color: selected ? colors.primary : colors.text }]}>{t.label}</Text>
              <Text style={[styles.incidentTypeDesc, { color: colors.mutedForeground }]}>{t.desc}</Text>
            </View>
            {selected && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
          </TouchableOpacity>
        );
      })}

      {/* ── Vehicle Collision ────────────────────────────────────────────────── */}
      {incidentType === "vehicle" && (
        <View style={styles.partyFormSection}>
          <Text style={[styles.partyFormTitle, { color: colors.text }]}>Other Vehicle</Text>

          {/* Vehicle type chips */}
          <Text style={[styles.formLabel, { color: colors.mutedForeground, marginBottom: 8 }]}>Vehicle type</Text>
          <View style={styles.chipRow}>
            {VEHICLE_TYPES.map((vt) => {
              const sel = value.vehicleType === vt;
              return (
                <TouchableOpacity
                  key={vt}
                  style={[styles.chip, { borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary + "12" : "transparent" }]}
                  onPress={() => onChange({ ...value, vehicleType: vt })}
                >
                  <Text style={[styles.chipText, { color: sel ? colors.primary : colors.mutedForeground }]}>{vt}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <FormInput label="Registration Number" value={value.vehicleReg ?? ""} onChangeText={(t) => onChange({ ...value, vehicleReg: t })} placeholder="KDA 123A" autoCapitalize="characters" colors={colors} styles={styles} />
          <FormInput label="Driver Name" value={value.name ?? ""} onChangeText={(t) => onChange({ ...value, name: t })} placeholder="John Doe" colors={colors} styles={styles} />
          <FormInput label="Driver Phone" value={value.phone ?? ""} onChangeText={(t) => onChange({ ...value, phone: t })} placeholder="+254 700 000 000" keyboardType="phone-pad" colors={colors} styles={styles} />
          <FormInput label="Insurance Company" value={value.insuranceCompany ?? ""} onChangeText={(t) => onChange({ ...value, insuranceCompany: t })} placeholder="Jubilee Insurance" colors={colors} styles={styles} />
          <FormInput label="Policy Number" value={value.policyNumber ?? ""} onChangeText={(t) => onChange({ ...value, policyNumber: t })} placeholder="JB/000000/00" colors={colors} styles={styles} />
        </View>
      )}

      {/* ── Pedestrian / Cyclist ─────────────────────────────────────────────── */}
      {incidentType === "pedestrian_cyclist" && (
        <View style={styles.partyFormSection}>
          <Text style={[styles.partyFormTitle, { color: colors.text }]}>Pedestrian / Cyclist Details</Text>
          <FormInput label="Name (if known)" value={value.name ?? ""} onChangeText={(t) => onChange({ ...value, name: t })} placeholder="Optional" colors={colors} styles={styles} />
          <FormInput label="Phone (if known)" value={value.phone ?? ""} onChangeText={(t) => onChange({ ...value, phone: t })} placeholder="+254 700 000 000" keyboardType="phone-pad" colors={colors} styles={styles} />
          <FormInput label="Injuries / Condition" value={value.injuries ?? ""} onChangeText={(t) => onChange({ ...value, injuries: t })} placeholder="e.g. Conscious, leg injury — taken to KNH" multiline colors={colors} styles={styles} />
          <FormInput label="Notes" value={value.notes ?? ""} onChangeText={(t) => onChange({ ...value, notes: t })} placeholder="Any other relevant details" multiline colors={colors} styles={styles} />
        </View>
      )}

      {/* ── Solo Incident ────────────────────────────────────────────────────── */}
      {incidentType === "solo" && (
        <View style={styles.partyFormSection}>
          <Text style={[styles.partyFormTitle, { color: colors.text }]}>What caused the incident?</Text>
          <View style={styles.causeList}>
            {SOLO_CAUSES.map((cause) => {
              const sel = value.cause === cause;
              return (
                <TouchableOpacity
                  key={cause}
                  style={[
                    styles.causeRow,
                    {
                      backgroundColor: sel ? colors.primary + "12" : colors.card,
                      borderColor:     sel ? colors.primary         : colors.border,
                    },
                  ]}
                  onPress={() => onChange({ ...value, cause })}
                >
                  <Text style={[styles.causeText, { color: sel ? colors.primary : colors.text }]}>{cause}</Text>
                  {sel && <Ionicons name="checkmark-circle" size={18} color={colors.primary} />}
                </TouchableOpacity>
              );
            })}
          </View>
          <FormInput label="Additional notes" value={value.notes ?? ""} onChangeText={(t) => onChange({ ...value, notes: t })} placeholder="Describe what happened…" multiline colors={colors} styles={styles} />
        </View>
      )}
    </View>
  );
}

function PoliceStep({ value, onChange, colors, styles }: {
  value: PoliceInfo;
  onChange: (v: PoliceInfo) => void;
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View>
      <Text style={[styles.stepIntro, { color: colors.mutedForeground }]}>
        If police attended the scene or you filed a report, record the details here.
      </Text>
      <FormInput label="Police Station" value={value.station ?? ""} onChangeText={(t) => onChange({ ...value, station: t })} placeholder="Westlands Police Station" colors={colors} styles={styles} />
      <FormInput label="Officer's Name" value={value.officerName ?? ""} onChangeText={(t) => onChange({ ...value, officerName: t })} placeholder="PC J. Kariuki" colors={colors} styles={styles} />
      <FormInput label="OB Number" value={value.obNumber ?? ""} onChangeText={(t) => onChange({ ...value, obNumber: t })} placeholder="OB/23/0001" colors={colors} styles={styles} />
      <FormInput label="Reference Number" value={value.reference ?? ""} onChangeText={(t) => onChange({ ...value, reference: t })} placeholder="Optional reference" colors={colors} styles={styles} />
    </View>
  );
}

/** Statement step — text input tab or in-app audio recording tab. */
function StatementStep({
  value, onChange,
  accidentId, deviceId,
  hasAudioStatement, onAudioUploaded,
  colors, styles,
}: {
  value: string;
  onChange: (v: string) => void;
  accidentId: string;
  deviceId: string;
  hasAudioStatement: boolean;
  onAudioUploaded: () => void;
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [mode, setMode] = useState<"text" | "audio">("text");
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // expo-audio recording hooks (must be at component top level)
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);

  const startRecording = useCallback(async () => {
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) {
      Alert.alert("Microphone Access Required", "Please allow microphone access in your device settings to record an audio statement.");
      return;
    }
    // Set audio mode so recording works on iOS even in silent mode.
    // Wrapped in its own try-catch: a failure here must not block recording.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: true } as any);
    } catch { /* non-fatal — proceed anyway */ }
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      Alert.alert("Error", "Could not start recording. Please try again.");
    }
  }, [recorder]);

  const stopRecording = useCallback(async () => {
    try {
      await recorder.stop();
      // Give a brief moment for the URI to be set
      await new Promise<void>((r) => setTimeout(r, 200));
      const uri = recorder.uri;
      if (uri) setRecordingUri(uri);
    } catch {
      Alert.alert("Error", "Could not stop recording.");
    }
  }, [recorder]);

  const uploadAudio = useCallback(async () => {
    if (!recordingUri || !accidentId || !deviceId) return;
    setUploading(true);
    try {
      const { photoId, uploadUrl } = await apiPost(
        `/accidents/${accidentId}/photos/request-upload`,
        { deviceId, category: "audio_statement", contentType: "audio/m4a" },
      ) as { photoId: string; uploadUrl: string };

      const blob = await (await fetch(recordingUri)).blob();
      await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "audio/m4a" },
        body: blob,
      });
      await apiPost(`/accidents/${accidentId}/photos/${photoId}/confirm`, { deviceId });
      onAudioUploaded();
      setRecordingUri(null); // mark as committed
    } catch {
      Alert.alert("Upload Failed", "Could not save your audio statement. Please try again.");
    } finally {
      setUploading(false);
    }
  }, [recordingUri, accidentId, deviceId, onAudioUploaded]);

  const discardRecording = useCallback(() => {
    setRecordingUri(null);
  }, []);

  const isRecording = recorderState.isRecording;
  const durationMs  = recorderState.durationMillis ?? 0;

  return (
    <View>
      {/* ── Mode tabs ────────────────────────────────────────────────────── */}
      <View style={[styles.modeTabs, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {(["text", "audio"] as const).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.modeTab, mode === m && { backgroundColor: colors.primary }]}
            onPress={() => setMode(m)}
          >
            <Ionicons
              name={m === "text" ? "create-outline" : "mic-outline"}
              size={16}
              color={mode === m ? "#fff" : colors.mutedForeground}
            />
            <Text style={[styles.modeTabText, { color: mode === m ? "#fff" : colors.mutedForeground }]}>
              {m === "text" ? "Write" : "Record"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Write mode ───────────────────────────────────────────────────── */}
      {mode === "text" && (
        <>
          <Text style={[styles.stepIntro, { color: colors.mutedForeground }]}>
            Describe what happened. Use your keyboard's microphone button to dictate if preferred.
          </Text>
          <View style={[styles.statementBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TextInput
              style={[styles.statementInput, { color: colors.text }]}
              value={value}
              onChangeText={onChange}
              placeholder="Describe the sequence of events, road conditions, visibility, speed, what you saw, and anything else relevant to the incident…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              textAlignVertical="top"
              returnKeyType="default"
            />
          </View>
          <Text style={[styles.charCount, { color: colors.mutedForeground }]}>{value.length} characters</Text>
        </>
      )}

      {/* ── Record mode ──────────────────────────────────────────────────── */}
      {mode === "audio" && (
        <View style={{ alignItems: "center", paddingTop: 16 }}>
          {hasAudioStatement && !recordingUri && (
            <View style={[styles.audioSavedBanner, { backgroundColor: "#34C75918", borderColor: "#34C759" }]}>
              <Ionicons name="checkmark-circle" size={18} color="#34C759" />
              <Text style={[styles.audioSavedText, { color: "#34C759" }]}>Audio statement saved</Text>
            </View>
          )}

          {/* Big mic button */}
          {!recordingUri && (
            <>
              <Text style={[styles.stepIntro, { color: colors.mutedForeground, textAlign: "center" }]}>
                {isRecording
                  ? "Recording in progress — tap to stop when done."
                  : "Tap the microphone to start recording your statement."}
              </Text>

              <TouchableOpacity
                style={[
                  styles.micBtn,
                  { backgroundColor: isRecording ? "#FF3B30" : colors.primary },
                ]}
                onPress={isRecording ? stopRecording : startRecording}
                activeOpacity={0.85}
              >
                <Ionicons name={isRecording ? "stop" : "mic"} size={36} color="#fff" />
              </TouchableOpacity>

              {isRecording && (
                <Text style={[styles.recordTimer, { color: colors.primary }]}>
                  {formatDuration(durationMs)}
                </Text>
              )}
            </>
          )}

          {/* After recording — confirm / discard / upload */}
          {recordingUri && (
            <View style={{ width: "100%", gap: 12 }}>
              <View style={[styles.audioReadyCard, { backgroundColor: colors.card, borderColor: colors.primary + "60" }]}>
                <Ionicons name="musical-note-outline" size={24} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.audioReadyTitle, { color: colors.text }]}>Recording complete</Text>
                  <Text style={[styles.audioReadySub, { color: colors.mutedForeground }]}>{formatDuration(durationMs)} recorded</Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.uploadAudioBtn, { backgroundColor: colors.primary }]}
                onPress={uploadAudio}
                disabled={uploading}
              >
                {uploading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name="cloud-upload-outline" size={20} color="#fff" />}
                <Text style={styles.uploadAudioBtnText}>{uploading ? "Saving…" : "Save to Report"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.discardAudioBtn, { borderColor: colors.border }]}
                onPress={discardRecording}
              >
                <Ionicons name="trash-outline" size={18} color="#FF3B30" />
                <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: "#FF3B30" }}>Discard & Re-record</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function ReportStep({ record, hasPdfReady, generating, pdfUrl, onGenerate, onShare, colors, styles }: {
  record: AccidentRecord;
  hasPdfReady: boolean;
  generating: boolean;
  pdfUrl: string | null;
  onGenerate: () => void;
  onShare: () => void;
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View>
      {/* Timeline */}
      <SectionHeader title="Timeline" icon="time-outline" colors={colors} />
      {record.timeline.length > 0 ? (
        <View style={[styles.groupCard, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 0, paddingHorizontal: 14, paddingVertical: 8 }]}>
          {record.timeline.map((evt, i) => (
            <View key={evt.id} style={[styles.timelineRow, i === record.timeline.length - 1 && { marginBottom: 4 }]}>
              <View style={{ alignItems: "center", width: 20 }}>
                <View style={[styles.timelineDot, { backgroundColor: colors.primary }]} />
                {i < record.timeline.length - 1 && (
                  <View style={{ width: 2, flex: 1, backgroundColor: colors.border, marginTop: 4 }} />
                )}
              </View>
              <View style={{ flex: 1, paddingBottom: i < record.timeline.length - 1 ? 12 : 0 }}>
                <Text style={[styles.timelineTime, { color: colors.mutedForeground }]}>
                  {format(new Date(evt.occurredAt), "h:mm a")}
                </Text>
                <Text style={[styles.timelineDesc, { color: colors.text }]}>{evt.description ?? evt.eventType}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <Text style={[styles.stepIntro, { color: colors.mutedForeground }]}>No timeline events recorded.</Text>
      )}

      {/* Report Generation */}
      <View style={[styles.reportCard, { backgroundColor: colors.card, borderColor: hasPdfReady ? "#34C759" : colors.border }]}>
        {hasPdfReady ? (
          <>
            <View style={styles.reportReadyRow}>
              <View style={styles.reportReadyIcon}>
                <Ionicons name="document-text" size={32} color="#34C759" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.reportReadyTitle, { color: colors.text }]}>PDF Report Ready</Text>
                <Text style={[styles.reportReadySub, { color: colors.mutedForeground }]}>
                  Your insurance-ready report has been generated.
                </Text>
              </View>
            </View>
            <TouchableOpacity style={[styles.shareBtn, { backgroundColor: "#34C759" }]} onPress={onShare}>
              <Ionicons name="share-outline" size={20} color="#fff" />
              <Text style={styles.shareBtnText}>Share Report</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={[styles.reportCardTitle, { color: colors.text }]}>Generate PDF Report</Text>
            <Text style={[styles.reportCardSub, { color: colors.mutedForeground }]}>
              Creates a complete insurance-ready PDF including all evidence, photos, witness statements, and your account.
            </Text>
            <TouchableOpacity
              style={[styles.generateBtn, { backgroundColor: colors.primary }]}
              onPress={onGenerate}
              disabled={generating}
            >
              {generating ? (
                <>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.generateBtnText}>Generating…</Text>
                </>
              ) : (
                <>
                  <Ionicons name="document-attach-outline" size={20} color="#fff" />
                  <Text style={styles.generateBtnText}>Generate Report</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Summary stats */}
      <View style={styles.summaryRow}>
        <SummaryChip icon="images-outline" value={`${record.photos.length}`} label="photos" colors={colors} />
        <SummaryChip icon="people-outline" value={`${record.witnesses.length}`} label="witnesses" colors={colors} />
        <SummaryChip icon="shield-checkmark-outline" value={record.status === "complete" ? "✓" : "…"} label={record.status} colors={colors} />
      </View>
    </View>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function SectionHeader({ title, icon, colors }: { title: string; icon: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 20, marginBottom: 6 }}>
      <Ionicons name={icon as any} size={15} color={colors.primary} />
      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.primary, textTransform: "uppercase", letterSpacing: 0.8 }}>{title}</Text>
    </View>
  );
}

function InfoRow({ label, value, highlight, colors, styles }: {
  label: string; value?: string | number | null;
  highlight?: boolean;
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: highlight ? colors.primary : colors.text }]}>{String(value)}</Text>
    </View>
  );
}

function FormInput({ label, value, onChangeText, placeholder, keyboardType, multiline, autoCapitalize, colors, styles }: {
  label: string; value: string; onChangeText: (t: string) => void;
  placeholder?: string; keyboardType?: "default" | "phone-pad" | "email-address";
  multiline?: boolean; autoCapitalize?: "none" | "characters" | "words" | "sentences";
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.formField}>
      <Text style={[styles.formLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        style={[styles.formInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text, ...(multiline ? { height: 80, textAlignVertical: "top" } : {}) }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType ?? "default"}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        returnKeyType={multiline ? "default" : "next"}
      />
    </View>
  );
}

function SummaryChip({ icon, value, label, colors }: { icon: string; value: string; label: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ alignItems: "center", gap: 4, flex: 1 }}>
      <Ionicons name={icon as any} size={20} color={colors.primary} />
      <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: colors.text }}>{value}</Text>
      <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>{label}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    loadingCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
    loadingText: { fontSize: 14, fontFamily: "Inter_400Regular" },

    // ── Header (matches accident-reports.tsx) ─────────────────────────────
    header: {
      flexDirection: "row", alignItems: "flex-start",
      paddingHorizontal: 16, paddingVertical: 12, gap: 12,
    },
    headerBack: { width: 36, height: 36, alignItems: "center", justifyContent: "center", marginTop: 2 },
    headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
    headerSub:   { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
    stepBadge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, marginTop: 2 },
    stepBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

    // ── Step progress ─────────────────────────────────────────────────────
    progressWrap: {
      flexDirection: "row", alignItems: "center",
      paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4,
    },
    progressStep: {
      width: 26, height: 26, borderRadius: 13, borderWidth: 1.5,
      alignItems: "center", justifyContent: "center",
    },
    progressStepNum: { fontSize: 11, fontFamily: "Inter_700Bold" },
    progressLine: { flex: 1, height: 2, borderRadius: 1 },

    // ── Step label row ────────────────────────────────────────────────────
    stepLabelRow: {
      flexDirection: "row", alignItems: "center", gap: 8,
      paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14,
    },
    stepName: { fontSize: 20, fontFamily: "Inter_700Bold" },

    content: { paddingHorizontal: 16, paddingBottom: 32 },

    // ── Nav bar ───────────────────────────────────────────────────────────
    navBar: {
      flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    navBtn: {
      flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 6, paddingVertical: 14, borderRadius: 16, borderWidth: 1,
    },
    navBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
    navBtnPrimary: {
      flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 8, paddingVertical: 14, borderRadius: 16,
    },
    navBtnPrimaryText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },

    // ── Evidence step ─────────────────────────────────────────────────────
    infoCard: {
      borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 12,
    },
    infoCardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
    infoCardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
    infoNote: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
    infoRow: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
      paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border + "70",
    },
    infoLabel: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, color: colors.mutedForeground },
    infoValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 2, textAlign: "right" },
    evidenceNote: {
      flexDirection: "row", gap: 8, marginTop: 20,
      padding: 14, borderRadius: 14, backgroundColor: colors.muted + "15",
      alignItems: "flex-start",
    },
    evidenceNoteText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },

    // ── Section heading (uppercase accent) ───────────────────────────────
    sectionHeading: {
      flexDirection: "row", alignItems: "center", gap: 6,
      marginTop: 20, marginBottom: 8,
    },
    sectionHeadingText: {
      fontSize: 11, fontFamily: "Inter_600SemiBold",
      textTransform: "uppercase", letterSpacing: 0.8,
    },

    // ── Grouped info card ─────────────────────────────────────────────────
    groupCard: {
      borderRadius: 16, borderWidth: 1, overflow: "hidden",
      marginBottom: 12,
    },
    groupRow: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
      padding: 12, borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border + "70",
    },
    groupRowLast: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
      padding: 12,
    },

    // ── Photos step ───────────────────────────────────────────────────────
    stepIntro: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 16 },
    photoCatCard: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
    photoCatHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
    photoCatIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    photoCatLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
    photoCatCount: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
    addPhotoBtn: {
      flexDirection: "row", alignItems: "center", gap: 4,
      paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1,
    },
    addPhotoBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
    photoList: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
    photoChip: {
      flexDirection: "row", alignItems: "center", gap: 4,
      paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, borderWidth: 1,
    },
    photoChipText: { fontSize: 12, fontFamily: "Inter_400Regular" },

    // ── Witnesses step ────────────────────────────────────────────────────
    witnessCard: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
    witnessCardRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    witnessName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
    witnessSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
    emptyState: {
      alignItems: "center", padding: 36, borderRadius: 16,
      borderWidth: 1, borderStyle: "dashed", gap: 8, marginBottom: 16,
    },
    emptyStateText: { fontSize: 14, fontFamily: "Inter_400Regular" },
    witnessForm: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 10 },
    addBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 8, paddingVertical: 16, borderRadius: 16, borderWidth: 1.5, marginTop: 4,
    },
    addBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
    formField: { marginBottom: 14 },
    formLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
    formInput: {
      borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
      fontSize: 14, fontFamily: "Inter_400Regular",
    },
    formBtns: { flexDirection: "row", gap: 10, marginTop: 12 },
    formCancelBtn: {
      flex: 1, alignItems: "center", paddingVertical: 13,
      borderRadius: 12, borderWidth: 1,
    },
    formCancelBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
    formSaveBtn: { flex: 2, alignItems: "center", paddingVertical: 13, borderRadius: 12 },
    formSaveBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },

    // ── Statement step ────────────────────────────────────────────────────
    statementBox: {
      borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 8,
    },
    statementInput: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 24, minHeight: 200 },
    charCount: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "right", marginBottom: 4 },

    // ── Report step ───────────────────────────────────────────────────────
    sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 12 },
    timelineRow: { flexDirection: "row", gap: 14, marginBottom: 12, alignItems: "flex-start" },
    timelineDot: { width: 12, height: 12, borderRadius: 6, marginTop: 3 },
    timelineTime: { fontSize: 11, fontFamily: "Inter_400Regular", marginBottom: 2 },
    timelineDesc: { fontSize: 14, fontFamily: "Inter_400Regular" },
    reportCard: {
      borderRadius: 16, borderWidth: 1, padding: 16, marginTop: 20, marginBottom: 16,
    },
    reportCardTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 6 },
    reportCardSub: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 16 },
    generateBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 8, paddingVertical: 15, borderRadius: 14,
    },
    generateBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
    reportReadyRow: { flexDirection: "row", gap: 14, alignItems: "center", marginBottom: 16 },
    reportReadyIcon: {
      width: 56, height: 56, borderRadius: 14,
      backgroundColor: "#34C75918", alignItems: "center", justifyContent: "center",
    },
    reportReadyTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 3 },
    reportReadySub: { fontSize: 13, fontFamily: "Inter_400Regular" },
    shareBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 8, paddingVertical: 15, borderRadius: 14,
    },
    shareBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
    summaryRow: {
      flexDirection: "row", borderRadius: 16, overflow: "hidden",
      backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
      padding: 16, gap: 8,
    },

    // ── My Vehicle card (Evidence step) ──────────────────────────────────
    vehicleCard: {
      flexDirection: "row", alignItems: "center", gap: 12,
      borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 12,
    },
    vehicleCardIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    vehicleCardLabel: { fontSize: 11, fontFamily: "Inter_500Medium", marginBottom: 2 },
    vehicleCardValue: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

    // ── Vehicle picker modal ──────────────────────────────────────────────
    modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
    vehicleModalSheet: {
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 20, paddingTop: 12, maxHeight: "80%", gap: 0,
    },
    vehicleModalTitle: { fontSize: 17, fontFamily: "Inter_700Bold", marginTop: 8, marginBottom: 4 },
    vehicleModalSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 16, lineHeight: 19 },
    vehiclePickRow: {
      flexDirection: "row", alignItems: "center", gap: 12,
      borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 8,
    },
    vehiclePickIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    vehicleModalDone: {
      marginTop: 8, borderRadius: 16, paddingVertical: 14,
      alignItems: "center", justifyContent: "center",
    },

    // ── Incident type selector ────────────────────────────────────────────
    incidentTypeCard: {
      flexDirection: "row", alignItems: "center", gap: 12,
      borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10,
    },
    incidentTypeIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    incidentTypeLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
    incidentTypeDesc:  { fontSize: 12, fontFamily: "Inter_400Regular" },

    // ── Other party dynamic form ──────────────────────────────────────────
    partyFormSection: { marginTop: 20, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    partyFormTitle: { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 14 },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
    chipText: { fontSize: 13, fontFamily: "Inter_400Regular" },
    causeList: { gap: 8, marginBottom: 16 },
    causeRow: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 14, paddingVertical: 13, borderRadius: 14, borderWidth: 1,
    },
    causeText: { fontSize: 14, fontFamily: "Inter_400Regular" },

    // ── Statement mode tabs ───────────────────────────────────────────────
    modeTabs: {
      flexDirection: "row", borderRadius: 14, borderWidth: 1,
      overflow: "hidden", marginBottom: 16,
    },
    modeTab: {
      flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 6, paddingVertical: 11,
    },
    modeTabText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

    // ── Recording UI ──────────────────────────────────────────────────────
    micBtn: {
      width: 100, height: 100, borderRadius: 50,
      alignItems: "center", justifyContent: "center",
      marginVertical: 24,
    },
    recordTimer: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: 2, marginBottom: 8 },
    audioSavedBanner: {
      flexDirection: "row", alignItems: "center", gap: 8,
      borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
      marginBottom: 16, width: "100%",
    },
    audioSavedText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
    audioReadyCard: {
      flexDirection: "row", alignItems: "center", gap: 12,
      borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 4,
    },
    audioReadyTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
    audioReadySub:   { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
    uploadAudioBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 8, paddingVertical: 15, borderRadius: 14,
    },
    uploadAudioBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
    discardAudioBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 8, paddingVertical: 12, borderRadius: 14, borderWidth: 1,
    },
  });
}
