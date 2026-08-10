/**
 * Pre-Trip Checklist
 *
 * Shown when the driver taps "Start Driving" on the home screen.
 * Handles all permission requests upfront and lets the driver verify their
 * dashcam angle + mic preference before the countdown begins.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Switch,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Image,
  AppState,
  Linking,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useDashcam } from "@/context/DashcamContext";
import { useVehicle } from "@/context/VehicleContext";
import { getCarImageUrl, getMakeById, getModelById, CAR_MAKES } from "@/data/carModels";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";
import type { SavedVehicle } from "@/utils/savedVehicles";
import { API_BASE } from "@/utils/apiClient";

export const QUICK_START_KEY        = "quickstart_pretrip_v1";
export const DASHCAM_AUTOSTART_KEY  = "dashcam_autostart_v1";

// ── Dynamically load native-only modules ─────────────────────────────────────
// expo-camera and expo-notifications are unavailable on web.
let useCameraPermissions: (() => [any, () => Promise<any>]) | null = null;
let useMicrophonePermissions: (() => [any, () => Promise<any>]) | null = null;
let CameraView: React.ComponentType<any> | null = null;
let Notifications: any = null;

if (Platform.OS !== "web") {
  try {
    const cam = require("expo-camera");
    useCameraPermissions    = cam.useCameraPermissions;
    useMicrophonePermissions = cam.useMicrophonePermissions;
    CameraView              = cam.CameraView;
  } catch { /* muted on web */ }
  try {
    Notifications = require("expo-notifications");
  } catch { /* muted on web */ }
}

// ── Vehicle helpers ───────────────────────────────────────────────────────────
function vehicleDisplayName(v: SavedVehicle): string {
  const make  = v.makeId  ? getMakeById(v.makeId)  : null;
  const model = (v.makeId && v.modelId) ? getModelById(v.makeId, v.modelId) : null;
  if (make && model) return `${make.name} ${model.name}`;
  if (v.customMakeName && v.customModelName) return `${v.customMakeName} ${v.customModelName}`;
  return "My Vehicle";
}

function vehicleEmoji(type: string): string {
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

// ── Vehicle image (mirrors garage.tsx VehicleImage) ──────────────────────────
function VehicleImage({ v, width, height }: { v: SavedVehicle; width: number; height: number }) {
  const c = useColors();

  const isMakeCustom  = !v.makeId  || v.makeId.startsWith("custom-");
  const isModelCustom = !v.modelId || v.modelId.startsWith("custom-");

  // Phase 0 = model-specific image; Phase 1 = first-model silhouette; Phase 2 = emoji
  const [phase,   setPhase]   = useState(0);
  const [loading, setLoading] = useState(true);
  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (retryTimer.current) clearTimeout(retryTimer.current); };
  }, []);

  // No usable make → show emoji
  if (isMakeCustom || phase >= 2) {
    return (
      <Text style={{ fontSize: height * 0.55, fontFamily: EMOJI_FONT_FAMILY, textAlign: "center" }}>
        {vehicleEmoji(v.vehicleType)}
      </Text>
    );
  }

  const makeId = v.makeId!;
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
      retryCount.current += 1;
      retryTimer.current = setTimeout(() => setLoading(true), 15_000);
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

// ── Types ─────────────────────────────────────────────────────────────────────
type PermStatus = "granted" | "denied" | "undetermined";

function toStatus(granted?: boolean, canAsk?: boolean): PermStatus {
  if (granted) return "granted";
  if (canAsk === false) return "denied";
  return "undetermined";
}

// ── 2-column permission card ──────────────────────────────────────────────────
interface PermCardProps {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  status: PermStatus;
  canAskAgain?: boolean;
  loading?: boolean;
  onEnable: () => void;
  colors: ReturnType<typeof useColors>;
}

function PermCard({
  icon, label, status, canAskAgain = true,
  loading, onEnable, colors: c,
}: PermCardProps) {
  const isGranted      = status === "granted";
  const isDenied       = status === "denied";
  const accentColor    = isGranted ? "#22C55E" : isDenied ? "#EF4444" : c.mutedForeground;
  const bgColor        = isGranted ? "#22C55E18" : isDenied ? "#EF444418" : c.muted + "55";
  const statusLabel    = isGranted ? "Enabled" : isDenied ? "Blocked" : "Not set";

  return (
    <View style={[styles.permCard, { backgroundColor: bgColor, borderColor: accentColor + "44" }]}>
      {/* Icon + label */}
      <View style={styles.permCardTop}>
        <View style={[styles.permCardIcon, { backgroundColor: accentColor + "22" }]}>
          <Ionicons name={icon} size={18} color={accentColor} />
        </View>
        <Text style={[styles.permCardLabel, { color: c.foreground }]} numberOfLines={1}>
          {label}
        </Text>
      </View>

      {/* Status badge */}
      <View style={[styles.permStatusBadge, { backgroundColor: accentColor + "22" }]}>
        {loading ? (
          <ActivityIndicator size={10} color={accentColor} />
        ) : (
          <Ionicons
            name={isGranted ? "checkmark-circle" : isDenied ? "close-circle" : "ellipse-outline"}
            size={11}
            color={accentColor}
          />
        )}
        <Text style={[styles.permStatusTxt, { color: accentColor }]}>
          {loading ? "Checking…" : statusLabel}
        </Text>
      </View>

      {/* Enable / Open Settings button — only shown when not yet granted */}
      {!isGranted && (
        <TouchableOpacity
          style={[styles.permBtn, { backgroundColor: "#22C55E" }]}
          onPress={onEnable}
          disabled={!!loading}
          activeOpacity={0.75}
        >
          <Text style={[styles.permBtnTxt, { color: "#FFF" }]}>
            {(!canAskAgain && !isGranted) ? "Open Settings" : "Enable"}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function PretripCheckScreen() {
  const c      = useColors();
  const insets = useSafeAreaInsets();
  const { settings, updateSettings, requestDashcamPermissions } = useDashcam();
  const { vehicles, activeVehicleId, setActiveVehicle } = useVehicle();

  // Trip vehicle — defaults to the current active vehicle; driver can change before starting.
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(
    () => activeVehicleId
  );
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);

  // Keep selection in sync if context loads vehicles after mount
  useEffect(() => {
    if (!selectedVehicleId && activeVehicleId) {
      setSelectedVehicleId(activeVehicleId);
    }
  }, [activeVehicleId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId) ?? vehicles[0] ?? null;

  // ── Permission state ───────────────────────────────────────────────────────
  const [locationStatus,  setLocationStatus]  = useState<PermStatus>("undetermined");
  const [bgLocStatus,     setBgLocStatus]     = useState<PermStatus>("undetermined");
  const [notifStatus,     setNotifStatus]     = useState<PermStatus>("undetermined");
  const [locCanAsk,       setLocCanAsk]       = useState(true);
  const [notifCanAsk,     setNotifCanAsk]     = useState(true);

  const [camPermission,   requestCamPerm,  getCamPerm]  = useCameraPermissions
    ? useCameraPermissions()
    : [null, async () => null, async () => null];
  const [micPermission,   requestMicPerm,  getMicPerm]  = useMicrophonePermissions
    ? useMicrophonePermissions()
    : [null, async () => null, async () => null];

  const cameraStatus = toStatus(camPermission?.granted, camPermission?.canAskAgain);
  const micStatus    = toStatus(micPermission?.granted,  micPermission?.canAskAgain);

  const [loadingPerm, setLoadingPerm] = useState<string | null>(null);

  // Check existing permission statuses
  const refreshPermissions = useCallback(async () => {
    try {
      const fg = await Location.getForegroundPermissionsAsync();
      setLocationStatus(toStatus(fg.granted, fg.canAskAgain));
      setLocCanAsk(fg.canAskAgain !== false);
    } catch { /* ignore */ }

    try {
      const bg = await Location.getBackgroundPermissionsAsync();
      setBgLocStatus(toStatus(bg.granted, bg.canAskAgain));
    } catch { /* ignore */ }

    if (Notifications) {
      try {
        const n = await Notifications.getPermissionsAsync();
        setNotifStatus(toStatus(n.granted, n.canAskAgain));
        setNotifCanAsk(n.canAskAgain !== false);
      } catch { /* ignore */ }
    } else {
      setNotifStatus("granted");
    }

    // Re-check camera & mic — critical when returning from iOS/Android Settings.
    // The hooks expose a 3rd "getPermission" function that re-reads status without
    // showing a dialog, which lets us update the displayed badge immediately.
    try { if (getCamPerm) await getCamPerm(); } catch { /* ignore */ }
    try { if (getMicPerm) await getMicPerm(); } catch { /* ignore */ }
  }, [getCamPerm, getMicPerm]);

  useEffect(() => {
    refreshPermissions();
  }, [refreshPermissions]);

  // Re-check when app returns from Settings
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshPermissions();
    });
    return () => sub.remove();
  }, [refreshPermissions]);

  const requestLocation = useCallback(async () => {
    setLoadingPerm("location");
    try {
      if (!locCanAsk) {
        Linking.openSettings();
      } else {
        const fg = await Location.requestForegroundPermissionsAsync();
        setLocationStatus(toStatus(fg.granted, fg.canAskAgain));
        setLocCanAsk(fg.canAskAgain !== false);
        if (fg.granted) {
          await new Promise(r => setTimeout(r, 600));
          const bg = await Location.requestBackgroundPermissionsAsync();
          setBgLocStatus(toStatus(bg.granted, bg.canAskAgain));
        }
      }
    } catch { /* ignore */ }
    setLoadingPerm(null);
  }, [locCanAsk]);

  const requestNotifs = useCallback(async () => {
    if (!Notifications) return;
    setLoadingPerm("notif");
    try {
      if (!notifCanAsk) {
        Linking.openSettings();
      } else {
        const n = await Notifications.requestPermissionsAsync();
        setNotifStatus(toStatus(n.granted, n.canAskAgain));
        setNotifCanAsk(n.canAskAgain !== false);
      }
    } catch { /* ignore */ }
    setLoadingPerm(null);
  }, [notifCanAsk]);

  const requestCamera = useCallback(async () => {
    setLoadingPerm("camera");
    if (!camPermission?.canAskAgain && !camPermission?.granted) {
      // Permission permanently denied — send user to Settings.
      // AppState "active" will fire on return and refreshPermissions() will
      // call getCamPerm() to pick up the new status immediately.
      Linking.openSettings();
      setLoadingPerm(null);
      return;
    }
    try {
      // Call the hook's own request so it updates its internal state.
      await requestCamPerm();
      // Also run dashcam-level init (camera context setup etc.)
      await requestDashcamPermissions();
    } catch { /* ignore */ }
    setLoadingPerm(null);
  }, [requestDashcamPermissions, camPermission, requestCamPerm]);

  const requestMic = useCallback(async () => {
    setLoadingPerm("mic");
    if (!micPermission?.canAskAgain && !micPermission?.granted) {
      // Permission permanently denied — send user to Settings.
      Linking.openSettings();
      setLoadingPerm(null);
      return;
    }
    try { await requestMicPerm(); } catch { /* ignore */ }
    setLoadingPerm(null);
  }, [requestMicPerm, micPermission]);

  const openSettings = useCallback(() => {
    Linking.openSettings();
  }, []);

  // ── Camera preview ─────────────────────────────────────────────────────────
  const [cameraReady, setCameraReady] = useState(false);
  const cameraGranted = camPermission?.granted ?? false;

  // ── Mic toggle with BT music warning ──────────────────────────────────────
  const toggleMic = useCallback(async (value: boolean) => {
    Haptics.selectionAsync().catch(() => {});
    await updateSettings({ audioEnabled: value });
    if (value && micPermission && !micPermission.granted) {
      try { await requestMicPerm(); } catch { /* muted fallback */ }
    }
  }, [updateSettings, micPermission, requestMicPerm]);

  // ── Quality selector ───────────────────────────────────────────────────────
  const setQuality = useCallback(async (q: "720p" | "1080p") => {
    Haptics.selectionAsync().catch(() => {});
    await updateSettings({ quality: q });
  }, [updateSettings]);

  // ── Quick-start preference ─────────────────────────────────────────────────
  const [quickStartEnabled, setQuickStartEnabled] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(QUICK_START_KEY)
      .then((v) => { if (v === "1") setQuickStartEnabled(true); })
      .catch(() => {});
  }, []);

  const toggleQuickStart = useCallback(async (value: boolean) => {
    Haptics.selectionAsync().catch(() => {});
    setQuickStartEnabled(value);
    try {
      if (value) await AsyncStorage.setItem(QUICK_START_KEY, "1");
      else await AsyncStorage.removeItem(QUICK_START_KEY);
    } catch { /* ignore */ }
  }, []);

  // ── Dashcam auto-start preference ──────────────────────────────────────────
  // Default ON: absence of the key (first install) also means enabled.
  const [dashcamAutoStart, setDashcamAutoStart] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(DASHCAM_AUTOSTART_KEY)
      .then((v) => { if (v === "0") setDashcamAutoStart(false); })
      .catch(() => {});
  }, []);

  const toggleDashcamAutoStart = useCallback(async (value: boolean) => {
    Haptics.selectionAsync().catch(() => {});
    setDashcamAutoStart(value);
    try {
      await AsyncStorage.setItem(DASHCAM_AUTOSTART_KEY, value ? "1" : "0");
    } catch { /* ignore */ }
  }, []);

  // ── Start driving ──────────────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (selectedVehicleId) setActiveVehicle(selectedVehicleId);
    router.replace("/(tabs)/drive");
  }, [selectedVehicleId, setActiveVehicle]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const allEssentialGranted = locationStatus === "granted" && notifStatus === "granted";

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: c.border }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={24} color={c.foreground} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: c.foreground }]}>Ready to Drive?</Text>
          <Text style={[styles.headerSub, { color: c.mutedForeground }]}>
            Set up before your trip starts
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Permissions 2-column grid ────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>PERMISSIONS</Text>
        <View style={styles.permGrid}>
          <PermCard
            icon="location"
            label="Location"
            status={locationStatus}
            canAskAgain={locCanAsk}
            loading={loadingPerm === "location"}
            onEnable={requestLocation}
            colors={c}
          />
          <PermCard
            icon="notifications"
            label="Notifications"
            status={notifStatus}
            canAskAgain={notifCanAsk}
            loading={loadingPerm === "notif"}
            onEnable={requestNotifs}
            colors={c}
          />
          <PermCard
            icon="videocam"
            label="Camera"
            status={cameraStatus}
            canAskAgain={camPermission?.canAskAgain ?? true}
            loading={loadingPerm === "camera"}
            onEnable={requestCamera}
            colors={c}
          />
          <PermCard
            icon="mic"
            label="Microphone"
            status={micStatus}
            canAskAgain={micPermission?.canAskAgain ?? true}
            loading={loadingPerm === "mic"}
            onEnable={requestMic}
            colors={c}
          />
        </View>

        {/* ── Vehicle selector ─────────────────────────────────────────── */}
        {vehicles.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { color: c.mutedForeground, marginTop: 20 }]}>
              YOUR VEHICLE
            </Text>
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              {vehicles.length === 1 ? (
                /* Single vehicle — show with image */
                <View style={styles.vehicleCardRow}>
                  <View style={styles.vehicleImgWrap}>
                    <VehicleImage v={vehicles[0]} width={90} height={58} />
                  </View>
                  <View style={styles.vehicleCardText}>
                    <Text style={[styles.vehicleRowName, { color: c.foreground }]}>
                      {vehicleDisplayName(vehicles[0])}
                    </Text>
                    <Text style={[styles.vehicleRowSub, { color: c.mutedForeground }]}>
                      {vehicles[0].plateNumber
                        ? vehicles[0].plateNumber
                        : vehicles[0].isDefault ? "Default vehicle" : "Your vehicle"}
                    </Text>
                  </View>
                  <Ionicons name="checkmark-circle" size={22} color="#22C55E" />
                </View>
              ) : (
                /* Multiple vehicles: collapsed summary + expandable picker */
                <>
                  <TouchableOpacity
                    style={[
                      styles.vehicleCardRow,
                      {
                        borderBottomWidth: vehiclePickerOpen ? StyleSheet.hairlineWidth : 0,
                        borderBottomColor: c.border,
                      },
                    ]}
                    onPress={() => setVehiclePickerOpen(o => !o)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.vehicleImgWrap}>
                      {selectedVehicle
                        ? <VehicleImage v={selectedVehicle} width={90} height={58} />
                        : <Text style={{ fontSize: 30 }}>{vehicleEmoji("car")}</Text>
                      }
                    </View>
                    <View style={styles.vehicleCardText}>
                      <Text style={[styles.vehicleRowName, { color: c.foreground }]}>
                        {selectedVehicle ? vehicleDisplayName(selectedVehicle) : "Select a vehicle"}
                      </Text>
                      <Text style={[styles.vehicleRowSub, { color: c.mutedForeground }]}>
                        {vehiclePickerOpen ? "Tap a vehicle below" : "Tap to change for this trip"}
                      </Text>
                    </View>
                    <Ionicons
                      name={vehiclePickerOpen ? "chevron-up" : "chevron-down"}
                      size={18}
                      color={c.mutedForeground}
                    />
                  </TouchableOpacity>

                  {vehiclePickerOpen && vehicles.map((v, i) => (
                    <TouchableOpacity
                      key={v.id}
                      style={[
                        styles.vehiclePickerRow,
                        {
                          backgroundColor: v.id === selectedVehicleId ? c.primary + "11" : "transparent",
                          borderBottomWidth: i < vehicles.length - 1 ? StyleSheet.hairlineWidth : 0,
                          borderBottomColor: c.border,
                        },
                      ]}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        setSelectedVehicleId(v.id);
                        setVehiclePickerOpen(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.vehicleImgWrap, { width: 70, height: 44 }]}>
                        <VehicleImage v={v} width={70} height={44} />
                      </View>
                      <View style={styles.vehicleCardText}>
                        <Text style={[styles.vehicleRowName, { color: c.foreground }]}>
                          {vehicleDisplayName(v)}
                        </Text>
                        {v.isDefault && (
                          <Text style={[styles.vehicleRowSub, { color: c.mutedForeground }]}>
                            Default
                          </Text>
                        )}
                      </View>
                      {v.id === selectedVehicleId
                        ? <Ionicons name="radio-button-on" size={20} color={c.primary} />
                        : <Ionicons name="radio-button-off" size={20} color={c.mutedForeground} />
                      }
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </View>
          </>
        )}

        {/* ── Dashcam setup card ───────────────────────────────────────── */}
        {Platform.OS !== "web" && (
          <>
            <Text style={[styles.sectionLabel, { color: c.mutedForeground, marginTop: 20 }]}>
              DASHCAM SETUP
            </Text>
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>

              {/* Camera preview */}
              <View style={styles.previewWrap}>
                {cameraGranted && CameraView ? (
                  <>
                    <CameraView
                      style={styles.cameraView}
                      facing="back"
                      onCameraReady={() => setCameraReady(true)}
                    />
                    {!cameraReady && (
                      <View style={styles.cameraPlaceholder}>
                        <ActivityIndicator color="#FFF" />
                      </View>
                    )}
                  </>
                ) : (
                  <View style={[styles.cameraPlaceholder, { backgroundColor: c.muted }]}>
                    <Ionicons
                      name={cameraGranted ? "videocam" : "videocam-off"}
                      size={36}
                      color={c.mutedForeground}
                    />
                    <Text style={[styles.cameraPlaceholderTxt, { color: c.mutedForeground }]}>
                      {cameraGranted
                        ? "Starting camera…"
                        : "Allow Camera access above to preview your dashcam angle"}
                    </Text>
                  </View>
                )}

                {cameraGranted && (
                  <View style={styles.previewBadge}>
                    <Ionicons name="videocam" size={11} color="#FFF" />
                    <Text style={styles.previewBadgeTxt}>Dashcam view</Text>
                  </View>
                )}
              </View>

              <Text style={[styles.previewHint, { color: c.mutedForeground }]}>
                Adjust your phone mount so the road ahead fills this view
              </Text>

              <View style={[styles.divider, { backgroundColor: c.border }]} />

              {/* Mic toggle */}
              <View style={styles.settingRow}>
                <View style={styles.settingRowLeft}>
                  <Ionicons
                    name={settings.audioEnabled ? "mic" : "mic-off"}
                    size={20}
                    color={settings.audioEnabled ? c.primary : c.mutedForeground}
                  />
                  <View style={styles.settingRowText}>
                    <Text style={[styles.settingRowLabel, { color: c.foreground }]}>
                      Record Audio
                    </Text>
                    <Text style={[styles.settingRowDesc, { color: c.mutedForeground }]}>
                      {settings.audioEnabled
                        ? "⚠️ Bluetooth music pauses while mic is on"
                        : "Dashcam records video only — music keeps playing"}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={settings.audioEnabled}
                  onValueChange={toggleMic}
                  trackColor={{ false: c.muted, true: c.primary + "88" }}
                  thumbColor={settings.audioEnabled ? c.primary : c.mutedForeground}
                />
              </View>

              <View style={[styles.divider, { backgroundColor: c.border }]} />

              {/* Quality selector */}
              <View style={styles.settingRow}>
                <View style={styles.settingRowLeft}>
                  <Ionicons name="film-outline" size={20} color={c.mutedForeground} />
                  <Text style={[styles.settingRowLabel, { color: c.foreground }]}>
                    Video Quality
                  </Text>
                </View>
                <View style={styles.qualityChips}>
                  {(["720p", "1080p"] as const).map((q) => (
                    <TouchableOpacity
                      key={q}
                      style={[
                        styles.qualityChip,
                        {
                          backgroundColor: settings.quality === q ? c.primary : c.muted,
                          borderColor: settings.quality === q ? c.primary : c.border,
                        },
                      ]}
                      onPress={() => setQuality(q)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.qualityChipTxt,
                          { color: settings.quality === q ? "#FFF" : c.mutedForeground },
                        ]}
                      >
                        {q === "720p" ? "HD" : "FHD"}
                      </Text>
                      <Text
                        style={[
                          styles.qualityChipSub,
                          { color: settings.quality === q ? "#FFF" : c.mutedForeground },
                        ]}
                      >
                        {q}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={[styles.divider, { backgroundColor: c.border }]} />

              {/* Auto-start Dashcam toggle */}
              <View style={styles.settingRow}>
                <View style={styles.settingRowLeft}>
                  <Ionicons
                    name="videocam-outline"
                    size={20}
                    color={dashcamAutoStart ? c.primary : c.mutedForeground}
                  />
                  <View style={styles.settingRowText}>
                    <Text style={[styles.settingRowLabel, { color: c.foreground }]}>
                      Auto-start Recording
                    </Text>
                    <Text style={[styles.settingRowDesc, { color: c.mutedForeground }]}>
                      {dashcamAutoStart
                        ? "Dashcam starts recording automatically when your trip begins"
                        : "You'll need to start the dashcam manually from the drive screen"}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={dashcamAutoStart}
                  onValueChange={toggleDashcamAutoStart}
                  trackColor={{ false: c.muted, true: c.primary + "88" }}
                  thumbColor={dashcamAutoStart ? c.primary : c.mutedForeground}
                />
              </View>
            </View>
          </>
        )}

        {/* ── Tips card ────────────────────────────────────────────────── */}
        <View style={[styles.tipsCard, { backgroundColor: c.primary + "11", borderColor: c.primary + "33" }]}>
          <Ionicons name="bulb-outline" size={16} color={c.primary} />
          <Text style={[styles.tipsTxt, { color: c.primary }]}>
            Mount your phone on the windshield or dashboard where you can glance at the screen without
            taking your eyes off the road.
          </Text>
        </View>
      </ScrollView>

      {/* ── Start Driving CTA ──────────────────────────────────────────────── */}
      <View
        style={[
          styles.ctaWrap,
          {
            backgroundColor: c.background,
            borderTopColor: c.border,
            paddingBottom: insets.bottom + 12,
          },
        ]}
      >
        {allEssentialGranted && (
          <View style={[styles.quickStartRow, { borderColor: c.border }]}>
            <View style={styles.quickStartText}>
              <Ionicons name="flash" size={15} color={quickStartEnabled ? c.primary : c.mutedForeground} />
              <Text style={[styles.quickStartLabel, { color: c.foreground }]}>Quick start</Text>
              <Text style={[styles.quickStartDesc, { color: c.mutedForeground }]}>
                Skip checklist next time
              </Text>
            </View>
            <Switch
              value={quickStartEnabled}
              onValueChange={toggleQuickStart}
              trackColor={{ false: c.muted, true: c.primary + "88" }}
              thumbColor={quickStartEnabled ? c.primary : c.mutedForeground}
            />
          </View>
        )}

        {!allEssentialGranted && (
          <Text style={[styles.ctaWarning, { color: c.mutedForeground }]}>
            Some permissions are missing — alerts may not work correctly
          </Text>
        )}
        <TouchableOpacity
          style={[styles.ctaBtn, { backgroundColor: "#22C55E" }]}
          onPress={handleStart}
          activeOpacity={0.88}
        >
          <Ionicons name="car-sport" size={20} color="#FFF" />
          <Text style={styles.ctaBtnTxt}>Start Driving</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn:      { width: 40, height: 40, justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle:  { fontSize: 17, fontFamily: "Inter_700Bold" },
  headerSub:    { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  // Scroll
  scroll:        { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 20 },

  sectionLabel: {
    fontSize: 11, fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8, marginBottom: 8,
    textTransform: "uppercase",
  },

  // Card
  card: {
    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },

  // ── 2-column permissions grid ─────────────────────────────────────────────
  permGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 4,
  },
  permCard: {
    width: "47.5%",
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  permCardTop: {
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  permCardIcon: {
    width: 32, height: 32, borderRadius: 9,
    alignItems: "center", justifyContent: "center",
  },
  permCardLabel: {
    flex: 1,
    fontSize: 13, fontFamily: "Inter_600SemiBold",
  },
  permStatusBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 20,
  },
  permStatusTxt: {
    fontSize: 11, fontFamily: "Inter_600SemiBold",
  },
  permCardBtns: {
    flexDirection: "row", gap: 6, marginTop: 2,
  },
  permBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  permBtnTxt: {
    fontSize: 11, fontFamily: "Inter_600SemiBold",
  },

  // Phone mount option
  mountOption: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 14,
    gap: 12,
  },
  mountIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  mountOptionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  mountOptionDesc:  { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  // Camera preview
  previewWrap: {
    width: "100%", height: 200,
    backgroundColor: "#000",
    position: "relative", overflow: "hidden",
  },
  cameraView:        { ...StyleSheet.absoluteFillObject },
  cameraPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center", justifyContent: "center",
    gap: 10, padding: 24,
  },
  cameraPlaceholderTxt: {
    fontSize: 13, fontFamily: "Inter_400Regular",
    textAlign: "center", lineHeight: 20,
  },
  previewBadge: {
    position: "absolute", top: 10, left: 10,
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 20,
  },
  previewBadgeTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#FFF" },
  previewHint: {
    fontSize: 12, fontFamily: "Inter_400Regular",
    paddingHorizontal: 14, paddingVertical: 10,
    textAlign: "center",
  },

  // Divider
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 14 },

  // Generic setting row
  settingRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 12,
    gap: 10,
  },
  settingRowLeft:  { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  settingRowText:  { flex: 1 },
  settingRowLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  settingRowDesc:  { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  // Quality chips
  qualityChips: { flexDirection: "row", gap: 6 },
  qualityChip: {
    alignItems: "center", borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  qualityChipTxt: { fontSize: 12, fontFamily: "Inter_700Bold" },
  qualityChipSub: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 1 },

  // Vehicle card
  vehicleCardRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 12,
    gap: 12,
  },
  vehicleImgWrap: {
    width: 90, height: 58,
    alignItems: "center", justifyContent: "center",
  },
  vehicleCardText: { flex: 1 },
  vehicleRowName:  { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  vehicleRowSub:   { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  vehiclePickerRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 11,
    gap: 12,
  },

  // Tips
  tipsCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    borderRadius: 12, borderWidth: 1,
    padding: 12, marginTop: 16,
  },
  tipsTxt: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },

  // CTA
  ctaWrap: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  ctaWarning: {
    fontSize: 12, fontFamily: "Inter_400Regular",
    textAlign: "center", marginBottom: 8,
  },
  ctaBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, borderRadius: 16,
    paddingVertical: 16,
  },
  ctaBtnTxt: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#FFF" },

  // Quick-start toggle
  quickStartRow: {
    flexDirection: "row", alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    marginBottom: 10, gap: 10,
  },
  quickStartText: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  quickStartLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  quickStartDesc:  { fontSize: 12, fontFamily: "Inter_400Regular" },
});
