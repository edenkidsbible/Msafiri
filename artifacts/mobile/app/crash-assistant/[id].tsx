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
import { useApp } from "@/context/AppContext";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/utils/apiClient";
import { useColors } from "@/hooks/useColors";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Weather {
  description?: string;
  tempC?: number;
  windspeedKmh?: number;
  roadCondition?: string;
}

interface OtherDriver {
  name?: string;
  phone?: string;
  insuranceCompany?: string;
  policyNumber?: string;
  vehicleReg?: string;
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
  otherDriver?: OtherDriver | null;
  police?: PoliceInfo | null;
  driverStatement?: string | null;
  hasPdf: boolean;
  dashcamClipId?: string | null;
  photos: Photo[];
  witnesses: Witness[];
  timeline: TimelineEvent[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STEPS = ["evidence", "photos", "witnesses", "other_driver", "police", "statement", "report"] as const;
type Step = typeof STEPS[number];

const STEP_LABEL: Record<Step, string> = {
  evidence:    "Evidence",
  photos:      "Photos",
  witnesses:   "Witnesses",
  other_driver: "Other Driver",
  police:      "Police",
  statement:   "Statement",
  report:      "Report",
};

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

  // Per-step form state
  const [otherDriver, setOtherDriver] = useState<OtherDriver>({});
  const [police, setPolice] = useState<PoliceInfo>({});
  const [statement, setStatement] = useState("");
  const [witnessForm, setWitnessForm] = useState({ name: "", phone: "", notes: "" });
  const [showWitnessForm, setShowWitnessForm] = useState(false);

  // Report step
  const [generating, setGenerating] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView | null>(null);

  const loadRecord = useCallback(async () => {
    if (!deviceId || !id) return;
    try {
      const data: AccidentRecord = await apiGet(`/accidents/${id}?deviceId=${deviceId}`);
      setRecord(data);
      // Pre-populate form state from saved record
      if (data.otherDriver) setOtherDriver(data.otherDriver);
      if (data.police) setPolice(data.police);
      if (data.driverStatement) setStatement(data.driverStatement);
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
        await apiPatch(`/accidents/${id}`, { deviceId, otherDriver });
      } else if (currentStep === "police") {
        await apiPatch(`/accidents/${id}`, { deviceId, police });
      } else if (currentStep === "statement") {
        await apiPatch(`/accidents/${id}`, { deviceId, driverStatement: statement });
      }
    } catch { /* fire-and-forget; user can retry */ }
  }, [currentStep, deviceId, id, record, otherDriver, police, statement]);

  // patch endpoint is /accidents/:id but method should be PATCH — apiPost handles body
  // (the server uses router.patch but we map it via apiPost with method override — 
  //  actually we need PATCH not POST; let's use a direct fetch via apiPost which sends POST.
  // The server has PATCH /accidents/:id — we need to call that.)

  const handleNext = useCallback(async () => {
    await saveCurrentStep();
    if (stepIdx < STEPS.length - 1) setStepIdx((s) => s + 1);
  }, [saveCurrentStep, stepIdx]);

  const handleBack = useCallback(() => {
    if (stepIdx > 0) setStepIdx((s) => s - 1);
  }, [stepIdx]);

  // ── Photo Upload ──────────────────────────────────────────────────────────

  const pickAndUploadPhoto = useCallback(async (category: string, source: "camera" | "library") => {
    if (!deviceId || !id) return;
    try {
      const result = source === "camera"
        ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });

      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];

      setUploadingCategory(category);

      // Get presigned PUT URL from server
      const { photoId, uploadUrl } = await apiPost(`/accidents/${id}/photos/request-upload`, {
        deviceId, category,
      }) as { photoId: string; uploadUrl: string };

      // Upload via blob fetch (React Native supports this)
      const blobResponse = await fetch(asset.uri);
      const blob = await blobResponse.blob();
      const mimeType = asset.mimeType ?? "image/jpeg";
      await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: blob,
      });

      // Confirm server-side
      await apiPost(`/accidents/${id}/photos/${photoId}/confirm`, { deviceId });

      await loadRecord();
    } catch {
      Alert.alert("Upload Failed", "Could not upload photo. Please try again.");
    } finally {
      setUploadingCategory(null);
    }
  }, [deviceId, id, loadRecord]);

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
      // Save statement before generating
      await apiPatch(`/accidents/${id}`, { deviceId, driverStatement: statement, status: "complete" });
      const { url } = await apiGet(`/accidents/${id}/report?deviceId=${deviceId}`) as { url: string };
      setPdfUrl(url);
      await loadRecord();
    } catch {
      Alert.alert("Error", "Could not generate report. Please try again.");
    } finally {
      setGenerating(false);
    }
  }, [deviceId, id, statement, loadRecord]);

  const shareReport = useCallback(async () => {
    if (!pdfUrl || pdfUrl === "report-ready") {
      // Fetch a fresh signed URL
      if (!deviceId || !id) return;
      try {
        const { url } = await apiGet(`/accidents/${id}/report/url?deviceId=${deviceId}`) as { url: string };
        await Share.share({ url, message: `Crash Report — ${record ? format(new Date(record.detectedAt), "d MMM yyyy") : ""}` });
      } catch {
        Alert.alert("Error", "Could not share report.");
      }
      return;
    }
    await Share.share({ url: pdfUrl, message: `Crash Report — ${record ? format(new Date(record.detectedAt), "d MMM yyyy") : ""}` });
  }, [pdfUrl, deviceId, id, record]);

  // ── Render ────────────────────────────────────────────────────────────────

  const styles = makeStyles(colors);

  if (loading || !record) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.muted }]}>Loading record…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const hasPdfReady = record.hasPdf || (pdfUrl && pdfUrl !== "report-ready");

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Crash Assistant</Text>
          <Text style={[styles.headerSub, { color: colors.muted }]}>
            {format(new Date(record.detectedAt), "d MMM yyyy · h:mm a")}
          </Text>
        </View>
        <View style={[styles.stepBadge, { backgroundColor: colors.primary + "18" }]}>
          <Text style={[styles.stepBadgeText, { color: colors.primary }]}>
            {stepIdx + 1}/{STEPS.length}
          </Text>
        </View>
      </View>

      {/* ── Step Progress Bar ────────────────────────────────────────────── */}
      <View style={styles.progressRow}>
        {STEPS.map((step, i) => (
          <TouchableOpacity
            key={step}
            style={[
              styles.progressDot,
              i < stepIdx && { backgroundColor: colors.primary },
              i === stepIdx && { backgroundColor: colors.primary, transform: [{ scaleX: 1 }] },
              i > stepIdx && { backgroundColor: colors.border },
            ]}
            onPress={() => setStepIdx(i)}
          >
            {i < stepIdx && <Ionicons name="checkmark" size={10} color="#fff" />}
          </TouchableOpacity>
        ))}
      </View>
      <Text style={[styles.stepName, { color: colors.primary }]}>{STEP_LABEL[currentStep]}</Text>

      {/* ── Step Content ─────────────────────────────────────────────────── */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          {currentStep === "evidence" && (
            <EvidenceStep record={record} colors={colors} styles={styles} />
          )}

          {currentStep === "photos" && (
            <PhotosStep
              record={record}
              uploadingCategory={uploadingCategory}
              onAdd={showPhotoOptions}
              onDelete={deletePhoto}
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
            <OtherDriverStep value={otherDriver} onChange={setOtherDriver} colors={colors} styles={styles} />
          )}

          {currentStep === "police" && (
            <PoliceStep value={police} onChange={setPolice} colors={colors} styles={styles} />
          )}

          {currentStep === "statement" && (
            <StatementStep value={statement} onChange={setStatement} colors={colors} styles={styles} />
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
          style={[styles.navBtn, { borderColor: colors.border }]}
          onPress={handleBack}
          disabled={stepIdx === 0}
        >
          <Ionicons name="chevron-back" size={20} color={stepIdx === 0 ? colors.muted : colors.text} />
          <Text style={[styles.navBtnText, { color: stepIdx === 0 ? colors.muted : colors.text }]}>Back</Text>
        </TouchableOpacity>

        {stepIdx < STEPS.length - 1 ? (
          <TouchableOpacity
            style={[styles.navBtnPrimary, { backgroundColor: colors.primary }]}
            onPress={handleNext}
          >
            <Text style={styles.navBtnPrimaryText}>Continue</Text>
            <Ionicons name="chevron-forward" size={20} color="#fff" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.navBtnPrimary, { backgroundColor: "#34C759" }]}
            onPress={() => router.back()}
          >
            <Ionicons name="checkmark-circle" size={20} color="#fff" />
            <Text style={styles.navBtnPrimaryText}>Done</Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>
    </SafeAreaView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EvidenceStep({ record, colors, styles }: { record: AccidentRecord; colors: ReturnType<typeof useColors>; styles: ReturnType<typeof makeStyles> }) {
  const speedBefore = record.speedBeforeKmh ? Math.round(record.speedBeforeKmh) : null;
  const speedImpact = record.speedAtImpactKmh ? Math.round(record.speedAtImpactKmh) : null;

  return (
    <View>
      <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.infoCardHeader}>
          <Ionicons name={record.isManual ? "document-text" : "warning"} size={20} color={record.isManual ? colors.primary : "#FF3B30"} />
          <Text style={[styles.infoCardTitle, { color: colors.text }]}>
            {record.isManual ? "Manual Report" : "Crash Auto-Detected"}
          </Text>
        </View>
        <Text style={[styles.infoNote, { color: colors.muted }]}>
          {record.isManual
            ? "You started this report manually. Fill in the details below."
            : "Crash Assistant detected a collision and captured the data below automatically."}
        </Text>
      </View>

      <SectionHeader title="Location" icon="location-outline" colors={colors} />
      <InfoRow label="Road" value={record.roadName} colors={colors} styles={styles} />
      <InfoRow label="Nearby" value={record.nearbyLandmark} colors={colors} styles={styles} />
      <InfoRow label="County" value={record.county} colors={colors} styles={styles} />
      {record.lat != null && record.lng != null && (
        <InfoRow label="Coordinates" value={`${Number(record.lat).toFixed(5)}, ${Number(record.lng).toFixed(5)}`} colors={colors} styles={styles} />
      )}

      {(speedBefore != null || speedImpact != null) && (
        <>
          <SectionHeader title="Vehicle Speed" icon="speedometer-outline" colors={colors} />
          {speedBefore != null && <InfoRow label="Before impact" value={`${speedBefore} km/h`} colors={colors} styles={styles} highlight />}
          {speedImpact != null && <InfoRow label="At impact" value={`${speedImpact} km/h`} colors={colors} styles={styles} highlight />}
          {record.directionLabel && <InfoRow label="Direction" value={record.directionLabel} colors={colors} styles={styles} />}
        </>
      )}

      {record.weather && (
        <>
          <SectionHeader title="Weather" icon="partly-sunny-outline" colors={colors} />
          <InfoRow label="Conditions" value={record.weather.description} colors={colors} styles={styles} />
          {record.weather.tempC != null && <InfoRow label="Temperature" value={`${record.weather.tempC}°C`} colors={colors} styles={styles} />}
          <InfoRow label="Road" value={record.weather.roadCondition} colors={colors} styles={styles} />
        </>
      )}

      {record.dashcamClipId && (
        <>
          <SectionHeader title="Dashcam" icon="videocam-outline" colors={colors} />
          <InfoRow label="Clip locked" value="Dashcam footage saved automatically" colors={colors} styles={styles} />
        </>
      )}

      <View style={styles.evidenceNote}>
        <Ionicons name="lock-closed-outline" size={15} color={colors.muted} />
        <Text style={[styles.evidenceNoteText, { color: colors.muted }]}>
          This evidence was captured automatically at the moment of the incident and cannot be edited.
        </Text>
      </View>
    </View>
  );
}

function PhotosStep({
  record, uploadingCategory, onAdd, onDelete, colors, styles,
}: {
  record: AccidentRecord;
  uploadingCategory: string | null;
  onAdd: (cat: string) => void;
  onDelete: (id: string) => void;
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
      <Text style={[styles.stepIntro, { color: colors.muted }]}>
        Document the scene with photos. Each category helps with your insurance claim.
      </Text>
      {PHOTO_CATEGORIES.map((cat) => {
        const photos = photosByCategory[cat.id] ?? [];
        const uploading = uploadingCategory === cat.id;
        return (
          <View key={cat.id} style={[styles.photoCatCard, { backgroundColor: colors.card, borderColor: photos.length > 0 ? colors.primary + "60" : colors.border }]}>
            <View style={styles.photoCatHeader}>
              <View style={[styles.photoCatIcon, { backgroundColor: photos.length > 0 ? colors.primary + "18" : colors.muted + "15" }]}>
                <Ionicons name={cat.icon as any} size={20} color={photos.length > 0 ? colors.primary : colors.muted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.photoCatLabel, { color: colors.text }]}>{cat.label}</Text>
                <Text style={[styles.photoCatCount, { color: colors.muted }]}>
                  {photos.length === 0 ? "No photos" : `${photos.length} photo${photos.length > 1 ? "s" : ""}`}
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
            {photos.length > 0 && (
              <View style={styles.photoList}>
                {photos.map((p) => (
                  <View key={p.id} style={[styles.photoChip, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "40" }]}>
                    <Ionicons name="image-outline" size={13} color={colors.primary} />
                    <Text style={[styles.photoChipText, { color: colors.primary }]}>
                      {format(new Date(p.createdAt), "h:mm a")}
                    </Text>
                    <TouchableOpacity onPress={() => onDelete(p.id)}>
                      <Ionicons name="close" size={14} color={colors.muted} />
                    </TouchableOpacity>
                  </View>
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
      <Text style={[styles.stepIntro, { color: colors.muted }]}>
        Record the names and contact details of anyone who witnessed the accident.
      </Text>

      {witnesses.map((w) => (
        <View key={w.id} style={[styles.witnessCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.witnessCardRow}>
            <Ionicons name="person-circle-outline" size={32} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.witnessName, { color: colors.text }]}>{w.name}</Text>
              {w.phone && <Text style={[styles.witnessSub, { color: colors.muted }]}>{w.phone}</Text>}
              {w.notes && <Text style={[styles.witnessSub, { color: colors.muted }]} numberOfLines={2}>{w.notes}</Text>}
            </View>
            <TouchableOpacity onPress={() => onDelete(w.id)}>
              <Ionicons name="trash-outline" size={20} color="#FF3B30" />
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {witnesses.length === 0 && !showForm && (
        <View style={[styles.emptyState, { borderColor: colors.border }]}>
          <Ionicons name="people-outline" size={32} color={colors.muted} />
          <Text style={[styles.emptyStateText, { color: colors.muted }]}>No witnesses added</Text>
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

function OtherDriverStep({ value, onChange, colors, styles }: {
  value: OtherDriver;
  onChange: (v: OtherDriver) => void;
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View>
      <Text style={[styles.stepIntro, { color: colors.muted }]}>
        Record the other driver's details. This information is included in your insurance report.
      </Text>
      <FormInput label="Full Name" value={value.name ?? ""} onChangeText={(t) => onChange({ ...value, name: t })} placeholder="John Doe" colors={colors} styles={styles} />
      <FormInput label="Phone Number" value={value.phone ?? ""} onChangeText={(t) => onChange({ ...value, phone: t })} placeholder="+254 700 000 000" keyboardType="phone-pad" colors={colors} styles={styles} />
      <FormInput label="Vehicle Registration" value={value.vehicleReg ?? ""} onChangeText={(t) => onChange({ ...value, vehicleReg: t })} placeholder="KDA 123A" autoCapitalize="characters" colors={colors} styles={styles} />
      <FormInput label="Insurance Company" value={value.insuranceCompany ?? ""} onChangeText={(t) => onChange({ ...value, insuranceCompany: t })} placeholder="Jubilee Insurance" colors={colors} styles={styles} />
      <FormInput label="Policy Number" value={value.policyNumber ?? ""} onChangeText={(t) => onChange({ ...value, policyNumber: t })} placeholder="JB/000000/00" colors={colors} styles={styles} />
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
      <Text style={[styles.stepIntro, { color: colors.muted }]}>
        If police attended the scene or you filed a report, record the details here.
      </Text>
      <FormInput label="Police Station" value={value.station ?? ""} onChangeText={(t) => onChange({ ...value, station: t })} placeholder="Westlands Police Station" colors={colors} styles={styles} />
      <FormInput label="Officer's Name" value={value.officerName ?? ""} onChangeText={(t) => onChange({ ...value, officerName: t })} placeholder="PC J. Kariuki" colors={colors} styles={styles} />
      <FormInput label="OB Number" value={value.obNumber ?? ""} onChangeText={(t) => onChange({ ...value, obNumber: t })} placeholder="OB/23/0001" colors={colors} styles={styles} />
      <FormInput label="Reference Number" value={value.reference ?? ""} onChangeText={(t) => onChange({ ...value, reference: t })} placeholder="Optional reference" colors={colors} styles={styles} />
    </View>
  );
}

function StatementStep({ value, onChange, colors, styles }: {
  value: string;
  onChange: (v: string) => void;
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View>
      <Text style={[styles.stepIntro, { color: colors.muted }]}>
        Write your account of what happened. Your statement is time-stamped and included in the insurance report.
        You can use your keyboard's voice-input button to dictate.
      </Text>
      <View style={[styles.statementBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <TextInput
          style={[styles.statementInput, { color: colors.text }]}
          value={value}
          onChangeText={onChange}
          placeholder="Describe what happened in your own words. Include the sequence of events, road conditions, visibility, and any other relevant details..."
          placeholderTextColor={colors.muted}
          multiline
          textAlignVertical="top"
          returnKeyType="default"
        />
      </View>
      <Text style={[styles.charCount, { color: colors.muted }]}>{value.length} characters</Text>
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
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Timeline</Text>
      {record.timeline.map((evt) => (
        <View key={evt.id} style={styles.timelineRow}>
          <View style={[styles.timelineDot, { backgroundColor: colors.primary }]} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.timelineTime, { color: colors.muted }]}>
              {format(new Date(evt.occurredAt), "h:mm a")}
            </Text>
            <Text style={[styles.timelineDesc, { color: colors.text }]}>{evt.description ?? evt.eventType}</Text>
          </View>
        </View>
      ))}
      {record.timeline.length === 0 && (
        <Text style={[styles.stepIntro, { color: colors.muted }]}>No timeline events recorded.</Text>
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
                <Text style={[styles.reportReadySub, { color: colors.muted }]}>
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
            <Text style={[styles.reportCardSub, { color: colors.muted }]}>
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
      <Text style={[styles.infoLabel, { color: colors.muted }]}>{label}</Text>
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
      <Text style={[styles.formLabel, { color: colors.muted }]}>{label}</Text>
      <TextInput
        style={[styles.formInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text, ...(multiline ? { height: 80, textAlignVertical: "top" } : {}) }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
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
      <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: colors.muted }}>{label}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    loadingCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
    loadingText: { fontSize: 14, fontFamily: "Inter_400Regular" },

    header: {
      flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12,
      gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    headerBtn: { width: 36 },
    headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
    headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
    stepBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
    stepBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

    progressRow: {
      flexDirection: "row", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4,
      gap: 6, alignItems: "center",
    },
    progressDot: {
      flex: 1, height: 6, borderRadius: 3,
      alignItems: "center", justifyContent: "center",
    },
    stepName: {
      fontSize: 20, fontFamily: "Inter_700Bold",
      paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12,
    },

    content: { paddingHorizontal: 16, paddingBottom: 32 },

    navBar: {
      flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    navBtn: {
      flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 6, paddingVertical: 14, borderRadius: 14, borderWidth: 1,
    },
    navBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
    navBtnPrimary: {
      flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 8, paddingVertical: 14, borderRadius: 14,
    },
    navBtnPrimaryText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },

    // Evidence step
    infoCard: {
      borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 8,
    },
    infoCardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
    infoCardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
    infoNote: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
    infoRow: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
      paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border + "60",
    },
    infoLabel: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
    infoValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 2, textAlign: "right" },
    evidenceNote: {
      flexDirection: "row", gap: 8, marginTop: 20,
      padding: 12, borderRadius: 10, backgroundColor: colors.muted + "12",
      alignItems: "flex-start",
    },
    evidenceNoteText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },

    // Photos step
    stepIntro: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 16 },
    photoCatCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
    photoCatHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
    photoCatIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    photoCatLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
    photoCatCount: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
    addPhotoBtn: {
      flexDirection: "row", alignItems: "center", gap: 4,
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1,
    },
    addPhotoBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
    photoList: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
    photoChip: {
      flexDirection: "row", alignItems: "center", gap: 4,
      paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1,
    },
    photoChipText: { fontSize: 12, fontFamily: "Inter_400Regular" },

    // Witnesses step
    witnessCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
    witnessCardRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    witnessName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
    witnessSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
    emptyState: {
      alignItems: "center", padding: 32, borderRadius: 14,
      borderWidth: 1, borderStyle: "dashed", gap: 8, marginBottom: 16,
    },
    emptyStateText: { fontSize: 14, fontFamily: "Inter_400Regular" },
    witnessForm: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 10 },
    addBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 8, paddingVertical: 16, borderRadius: 14, borderWidth: 1.5, marginTop: 4,
    },
    addBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
    formField: { marginBottom: 14 },
    formLabel: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 6 },
    formInput: {
      borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
      fontSize: 14, fontFamily: "Inter_400Regular",
    },
    formBtns: { flexDirection: "row", gap: 10, marginTop: 12 },
    formCancelBtn: {
      flex: 1, alignItems: "center", paddingVertical: 12,
      borderRadius: 10, borderWidth: 1,
    },
    formCancelBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
    formSaveBtn: { flex: 2, alignItems: "center", paddingVertical: 12, borderRadius: 10 },
    formSaveBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },

    // Statement step
    statementBox: {
      borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 8,
    },
    statementInput: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 24, minHeight: 200 },
    charCount: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "right", marginBottom: 4 },

    // Report step
    sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 12 },
    timelineRow: { flexDirection: "row", gap: 12, marginBottom: 12, alignItems: "flex-start" },
    timelineDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
    timelineTime: { fontSize: 11, fontFamily: "Inter_400Regular", marginBottom: 2 },
    timelineDesc: { fontSize: 14, fontFamily: "Inter_400Regular" },
    reportCard: {
      borderRadius: 16, borderWidth: 1, padding: 16, marginTop: 20, marginBottom: 16,
    },
    reportCardTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 6 },
    reportCardSub: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, marginBottom: 16 },
    generateBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 8, paddingVertical: 14, borderRadius: 12,
    },
    generateBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
    reportReadyRow: { flexDirection: "row", gap: 12, alignItems: "center", marginBottom: 14 },
    reportReadyIcon: {
      width: 56, height: 56, borderRadius: 14,
      backgroundColor: "#34C75918", alignItems: "center", justifyContent: "center",
    },
    reportReadyTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 3 },
    reportReadySub: { fontSize: 13, fontFamily: "Inter_400Regular" },
    shareBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 8, paddingVertical: 14, borderRadius: 12,
    },
    shareBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
    summaryRow: {
      flexDirection: "row", borderRadius: 14, overflow: "hidden",
      backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
      padding: 16, gap: 8,
    },
  });
}
