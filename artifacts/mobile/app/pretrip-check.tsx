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
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useDashcam } from "@/context/DashcamContext";
import { useVehicle } from "@/context/VehicleContext";
import { getMakeById, getModelById } from "@/data/carModels";
import type { SavedVehicle } from "@/utils/savedVehicles";

export const QUICK_START_KEY = "quickstart_pretrip_v1";

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

// ── Types ─────────────────────────────────────────────────────────────────────
type PermStatus = "granted" | "denied" | "undetermined";

function toStatus(granted?: boolean, canAsk?: boolean): PermStatus {
  if (granted) return "granted";
  if (canAsk === false) return "denied";
  return "undetermined";
}

// ── Sub-components ────────────────────────────────────────────────────────────
interface PermRowProps {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  description: string;
  status: PermStatus;
  loading?: boolean;
  onRequest: () => void;
  colors: ReturnType<typeof useColors>;
}

function PermRow({ icon, label, description, status, loading, onRequest, colors: c }: PermRowProps) {
  const isGranted = status === "granted";
  const isDenied  = status === "denied";

  return (
    <TouchableOpacity
      style={[styles.permRow, { borderBottomColor: c.border }]}
      onPress={isGranted ? undefined : onRequest}
      activeOpacity={isGranted ? 1 : 0.7}
      disabled={isGranted}
    >
      <View style={[styles.permIconWrap, { backgroundColor: isGranted ? "#22C55E22" : c.muted }]}>
        <Ionicons
          name={icon}
          size={18}
          color={isGranted ? "#22C55E" : isDenied ? "#EF4444" : c.primary}
        />
      </View>

      <View style={styles.permText}>
        <Text style={[styles.permLabel, { color: c.foreground }]}>{label}</Text>
        <Text style={[styles.permDesc, { color: c.mutedForeground }]} numberOfLines={2}>
          {isDenied
            ? "Denied — open Settings to enable"
            : description}
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator size="small" color={c.primary} />
      ) : isGranted ? (
        <Ionicons name="checkmark-circle" size={22} color="#22C55E" />
      ) : isDenied ? (
        <Ionicons name="close-circle" size={22} color="#EF4444" />
      ) : (
        <View style={[styles.grantPill, { backgroundColor: c.primary + "22" }]}>
          <Text style={[styles.grantPillTxt, { color: c.primary }]}>Allow</Text>
        </View>
      )}
    </TouchableOpacity>
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

  const [camPermission,   requestCamPerm]     = useCameraPermissions
    ? useCameraPermissions()
    : [null, async () => null];
  const [micPermission,   requestMicPerm]     = useMicrophonePermissions
    ? useMicrophonePermissions()
    : [null, async () => null];

  const cameraStatus = toStatus(camPermission?.granted, camPermission?.canAskAgain);
  const micStatus    = toStatus(micPermission?.granted,  micPermission?.canAskAgain);

  const [loadingPerm, setLoadingPerm] = useState<string | null>(null);

  // Check existing permission statuses on mount
  useEffect(() => {
    (async () => {
      // Foreground location
      try {
        const fg = await Location.getForegroundPermissionsAsync();
        setLocationStatus(toStatus(fg.granted, fg.canAskAgain));
      } catch { /* ignore */ }

      // Background location
      try {
        const bg = await Location.getBackgroundPermissionsAsync();
        setBgLocStatus(toStatus(bg.granted, bg.canAskAgain));
      } catch { /* ignore */ }

      // Notifications
      if (Notifications) {
        try {
          const n = await Notifications.getPermissionsAsync();
          setNotifStatus(toStatus(n.granted, n.canAskAgain));
        } catch { /* ignore */ }
      } else {
        setNotifStatus("granted"); // web / unsupported
      }
    })();
  }, []);

  const requestLocation = useCallback(async () => {
    setLoadingPerm("location");
    try {
      const fg = await Location.requestForegroundPermissionsAsync();
      setLocationStatus(toStatus(fg.granted, fg.canAskAgain));
      if (fg.granted) {
        // Also ask for background while we're here
        await new Promise(r => setTimeout(r, 600));
        const bg = await Location.requestBackgroundPermissionsAsync();
        setBgLocStatus(toStatus(bg.granted, bg.canAskAgain));
      }
    } catch { /* ignore */ }
    setLoadingPerm(null);
  }, []);

  const requestNotifs = useCallback(async () => {
    if (!Notifications) return;
    setLoadingPerm("notif");
    try {
      const n = await Notifications.requestPermissionsAsync();
      setNotifStatus(toStatus(n.granted, n.canAskAgain));
    } catch { /* ignore */ }
    setLoadingPerm(null);
  }, []);

  const requestCamera = useCallback(async () => {
    setLoadingPerm("camera");
    await requestDashcamPermissions();
    setLoadingPerm(null);
  }, [requestDashcamPermissions]);

  const requestMic = useCallback(async () => {
    setLoadingPerm("mic");
    try { await requestMicPerm(); } catch { /* ignore */ }
    setLoadingPerm(null);
  }, [requestMicPerm]);

  // ── Camera preview ─────────────────────────────────────────────────────────
  const [cameraReady, setCameraReady] = useState(false);
  const cameraGranted = camPermission?.granted ?? false;

  // ── Mic toggle with BT music warning ──────────────────────────────────────
  const toggleMic = useCallback(async (value: boolean) => {
    Haptics.selectionAsync().catch(() => {});
    await updateSettings({ audioEnabled: value });
    // Proactively request mic permission when driver enables audio
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

  // Load saved preference on mount
  useEffect(() => {
    AsyncStorage.getItem(QUICK_START_KEY)
      .then((v) => { if (v === "1") setQuickStartEnabled(true); })
      .catch(() => {});
  }, []);

  const toggleQuickStart = useCallback(async (value: boolean) => {
    Haptics.selectionAsync().catch(() => {});
    setQuickStartEnabled(value);
    try {
      if (value) {
        await AsyncStorage.setItem(QUICK_START_KEY, "1");
      } else {
        await AsyncStorage.removeItem(QUICK_START_KEY);
      }
    } catch { /* ignore */ }
  }, []);

  // ── Phone mount orientation ────────────────────────────────────────────────
  const [mountOrientation, setMountOrientation] = useState<"portrait" | "landscape">("portrait");

  // ── Start driving ──────────────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    // Commit the vehicle selection — drive screen and all downstream consumers
    // read from VehicleContext, so this is the canonical handoff point.
    if (selectedVehicleId) setActiveVehicle(selectedVehicleId);
    // Persist mount orientation BEFORE navigating so the drive screen's
    // useFocusEffect reliably reads the new value (not the previous session's).
    await AsyncStorage.setItem("msafiri:mountOrientation", mountOrientation);
    router.replace("/(tabs)/drive");
  }, [selectedVehicleId, setActiveVehicle, mountOrientation]);

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
        {/* Spacer to balance back button */}
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Permissions card ─────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>PERMISSIONS</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <PermRow
            icon="location"
            label="Location"
            description="Needed for speed alerts, route guidance and live sharing"
            status={locationStatus}
            loading={loadingPerm === "location"}
            onRequest={requestLocation}
            colors={c}
          />
          <PermRow
            icon="notifications"
            label="Notifications"
            description="Get hazard alerts and safety warnings while driving"
            status={notifStatus}
            loading={loadingPerm === "notif"}
            onRequest={requestNotifs}
            colors={c}
          />
          <PermRow
            icon="videocam"
            label="Camera"
            description="Required for Dashcam recording"
            status={cameraStatus}
            loading={loadingPerm === "camera"}
            onRequest={requestCamera}
            colors={c}
          />
          <PermRow
            icon="mic"
            label="Microphone"
            description="Optional — records audio alongside dashcam video"
            status={micStatus}
            loading={loadingPerm === "mic"}
            onRequest={requestMic}
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
              {/* Single-vehicle: just show it, no toggle needed */}
              {vehicles.length === 1 ? (
                <View style={[styles.vehicleRow, { borderBottomWidth: 0 }]}>
                  <Text style={[styles.vehicleEmoji]}>{vehicleEmoji(vehicles[0].vehicleType)}</Text>
                  <View style={styles.vehicleRowText}>
                    <Text style={[styles.vehicleRowName, { color: c.foreground }]}>
                      {vehicleDisplayName(vehicles[0])}
                    </Text>
                    <Text style={[styles.vehicleRowSub, { color: c.mutedForeground }]}>
                      {vehicles[0].isDefault ? "Default vehicle" : "Your vehicle"}
                    </Text>
                  </View>
                  <Ionicons name="checkmark-circle" size={22} color="#22C55E" />
                </View>
              ) : (
                /* Multiple vehicles: collapsed summary + expandable picker */
                <>
                  <TouchableOpacity
                    style={[styles.vehicleRow, { borderBottomWidth: vehiclePickerOpen ? StyleSheet.hairlineWidth : 0, borderBottomColor: c.border }]}
                    onPress={() => setVehiclePickerOpen(o => !o)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.vehicleEmoji}>
                      {vehicleEmoji(selectedVehicle?.vehicleType ?? "car")}
                    </Text>
                    <View style={styles.vehicleRowText}>
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
                      <Text style={styles.vehicleEmoji}>{vehicleEmoji(v.vehicleType)}</Text>
                      <View style={styles.vehicleRowText}>
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

                {/* Badge */}
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

              {/* Divider */}
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

              {/* Divider */}
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
            </View>
          </>
        )}

        {/* ── Phone mount orientation ────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: c.mutedForeground, marginTop: 20 }]}>
          PHONE MOUNT
        </Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          {/* Portrait option */}
          <TouchableOpacity
            style={[
              styles.mountOption,
              mountOrientation === "portrait" && {
                backgroundColor: c.primary + "11",
              },
            ]}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setMountOrientation("portrait");
            }}
            activeOpacity={0.7}
          >
            <View style={[
              styles.mountIconWrap,
              { backgroundColor: mountOrientation === "portrait" ? c.primary + "22" : c.muted },
            ]}>
              <Ionicons
                name="phone-portrait-outline"
                size={22}
                color={mountOrientation === "portrait" ? c.primary : c.mutedForeground}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.mountOptionTitle, { color: c.foreground }]}>Portrait</Text>
              <Text style={[styles.mountOptionDesc, { color: c.mutedForeground }]}>
                Phone upright — standard layout
              </Text>
            </View>
            {mountOrientation === "portrait"
              ? <Ionicons name="radio-button-on" size={20} color={c.primary} />
              : <Ionicons name="radio-button-off" size={20} color={c.mutedForeground} />
            }
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: c.border }]} />

          {/* Landscape option */}
          <TouchableOpacity
            style={[
              styles.mountOption,
              mountOrientation === "landscape" && {
                backgroundColor: c.primary + "11",
              },
            ]}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setMountOrientation("landscape");
            }}
            activeOpacity={0.7}
          >
            <View style={[
              styles.mountIconWrap,
              { backgroundColor: mountOrientation === "landscape" ? c.primary + "22" : c.muted },
            ]}>
              <Ionicons
                name="phone-landscape-outline"
                size={22}
                color={mountOrientation === "landscape" ? c.primary : c.mutedForeground}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.mountOptionTitle, { color: c.foreground }]}>Landscape</Text>
              <Text style={[styles.mountOptionDesc, { color: c.mutedForeground }]}>
                Phone sideways — map left, controls right
              </Text>
            </View>
            {mountOrientation === "landscape"
              ? <Ionicons name="radio-button-on" size={20} color={c.primary} />
              : <Ionicons name="radio-button-off" size={20} color={c.mutedForeground} />
            }
          </TouchableOpacity>
        </View>

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
        {/* Quick-start toggle — only offered once all essential permissions are on */}
        {allEssentialGranted && (
          <View style={[styles.quickStartRow, { borderColor: c.border }]}>
            <View style={styles.quickStartText}>
              <Ionicons name="flash" size={15} color={quickStartEnabled ? c.primary : c.mutedForeground} />
              <Text style={[styles.quickStartLabel, { color: c.foreground }]}>
                Quick start
              </Text>
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

  // Permission rows
  permRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 13,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  permIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  permText:  { flex: 1 },
  permLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  permDesc:  { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  grantPill: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 20,
  },
  grantPillTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

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

  // Vehicle selector
  vehicleRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 14,
    gap: 12,
  },
  vehiclePickerRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 13,
    gap: 12,
  },
  vehicleEmoji: { fontSize: 26, width: 34, textAlign: "center" },
  vehicleRowText:  { flex: 1 },
  vehicleRowName:  { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  vehicleRowSub:   { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

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
