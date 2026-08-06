/**
 * DashcamOverlay.tsx
 *
 * Full-screen camera view + dashcam controls. Rendered persistently in
 * _layout.tsx so the CameraView stays mounted (and recording continues) even
 * when the user navigates back to the map view.
 *
 * Visibility:
 *   isDashcamOpen                 → full UI shown
 *   isRecording && !isDashcamOpen → camera mounted but invisible (recording continues)
 *   !isRecording && !isDashcamOpen → null (saves resources)
 *
 * Recording loop:
 *   The loop always processes the final segment before exiting — the cancel
 *   flag is checked AFTER onSegmentComplete so the last clip is never lost.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useDashcam } from "@/context/DashcamContext";
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

// ── Lazy-load expo-camera so the web bundle is not broken ─────────────────────
let CameraView: any    = null;
let useCameraPermissions: any = null;
if (Platform.OS !== "web") {
  try {
    const mod = require("expo-camera");
    CameraView             = mod.CameraView;
    useCameraPermissions   = mod.useCameraPermissions;
  } catch {
    // Expo Go may not have the native camera module — degrade gracefully
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** HH:MM:SS for total recording time */
function fmtDuration(s: number): string {
  const h   = Math.floor(s / 3600).toString().padStart(2, "0");
  const m   = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

function storageRemaining(used: number, cap: number): string {
  const freeBytes = Math.max(0, cap - used);
  const freeMins  = freeBytes / (4 * 1_048_576);
  if (freeMins >= 60) return `~${Math.floor(freeMins / 60)}h remaining`;
  return `~${Math.round(freeMins)}m remaining`;
}

// ─── Component ───────────────────────────────────────────────────────────────

const KEEP_AWAKE_TAG = "msafiri-dashcam";

export default function DashcamOverlay() {
  const {
    isRecording, isDashcamOpen,
    settings, storageUsedBytes, segments,
    startDashcam, stopDashcam, lockCurrentClip, updateSettings,
    closeDashcam, setCameraRef, onSegmentComplete,
  } = useDashcam();

  const insets = useSafeAreaInsets();

  const localCameraRef  = useRef<any>(null);
  const loopCancelRef   = useRef(false);
  const segmentStartRef = useRef(Date.now());

  // Total recording elapsed time (not per-segment)
  const [totalDuration, setTotalDuration] = useState(0);
  const totalStartRef = useRef<number>(0);

  // Screenshot flash animation
  const flashOpacity = useRef(new Animated.Value(0)).current;

  // Alert banner state — triggered when a new locked clip starts saving
  const [alertVisible, setAlertVisible]       = useState(false);
  const [alertCountdown, setAlertCountdown]   = useState(30);
  const [alertTitle, setAlertTitle]           = useState("Impact Detected");
  const prevLockedRef = useRef(0);

  const [permission, requestPermission] = useCameraPermissions
    ? useCameraPermissions()
    : [{ granted: true }, async () => ({ granted: true })];

  // ── Register camera ref with DashcamContext ────────────────────────────────
  const cameraCallbackRef = useCallback(
    (ref: any) => {
      localCameraRef.current = ref;
      setCameraRef(ref);
    },
    [setCameraRef]
  );

  // ── Keep screen awake while dashcam is active ─────────────────────────────
  useEffect(() => {
    if (isRecording || isDashcamOpen) {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    } else {
      try { deactivateKeepAwake(KEEP_AWAKE_TAG); } catch { /* not activated yet */ }
    }
  }, [isRecording, isDashcamOpen]);

  // ── Total recording duration counter ──────────────────────────────────────
  useEffect(() => {
    if (!isRecording) { setTotalDuration(0); return; }
    totalStartRef.current = Date.now();
    const id = setInterval(() => {
      setTotalDuration(Math.floor((Date.now() - totalStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isRecording]);

  // ── Alert banner on new locked segment ────────────────────────────────────
  useEffect(() => {
    const lockedPending = segments.filter(
      (s) => s.locked && (s.uploadStatus === "pending" || s.uploadStatus === "uploading")
    ).length;
    if (lockedPending > prevLockedRef.current) {
      setAlertTitle(
        segments.find((s) => s.locked && s.lockReason && s.lockReason !== "manual")
          ? "Impact Detected"
          : "Clip Locked"
      );
      setAlertVisible(true);
      setAlertCountdown(30);
    }
    prevLockedRef.current = lockedPending;
  }, [segments]);

  // Alert countdown ticker
  useEffect(() => {
    if (!alertVisible) return;
    if (alertCountdown <= 0) { setAlertVisible(false); return; }
    const t = setTimeout(() => setAlertCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [alertVisible, alertCountdown]);

  // ── Recording loop ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isRecording || Platform.OS === "web") return;

    loopCancelRef.current = false;

    async function loop() {
      while (true) {
        try {
          if (!localCameraRef.current) break;
          segmentStartRef.current = Date.now();

          const result = await localCameraRef.current.recordAsync({
            maxDuration: 120,
            muted: !settings.audioEnabled,
          });

          if (result?.uri) {
            const durationS = Math.round(
              (Date.now() - segmentStartRef.current) / 1000
            );
            await onSegmentComplete(result.uri, durationS);
          }
        } catch {
          break;
        }
        if (loopCancelRef.current) break;
      }
    }

    loop();

    return () => {
      loopCancelRef.current = true;
      localCameraRef.current?.stopRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  // ── Screenshot ────────────────────────────────────────────────────────────
  const takeSnapshot = useCallback(async () => {
    if (!localCameraRef.current) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      // Flash effect
      Animated.sequence([
        Animated.timing(flashOpacity, { toValue: 1, duration: 80, useNativeDriver: true }),
        Animated.timing(flashOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
      await localCameraRef.current.takePictureAsync({ quality: 0.9, skipProcessing: false });
    } catch { /* silently fail — camera may not support it in all modes */ }
  }, [flashOpacity]);

  // ── Don't render on web or when fully idle ────────────────────────────────
  if (Platform.OS === "web") return null;
  if (!isRecording && !isDashcamOpen) return null;

  const showUI = isDashcamOpen;
  const qualityLabel = settings.quality === "1080p" ? "1080P" : "720P";
  const isHD         = settings.quality === "1080p";

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { zIndex: showUI ? 9999 : 1, opacity: showUI ? 1 : 0 },
      ]}
      pointerEvents={showUI ? "auto" : "none"}
    >
      {/* Camera feed — always mounted while recording or open */}
      {CameraView && (
        <CameraView
          ref={cameraCallbackRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="video"
          videoQuality={settings.quality === "720p" ? "720p" : "1080p"}
        />
      )}

      {/* White flash overlay for screenshots */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: "#fff", opacity: flashOpacity, pointerEvents: "none" }]}
      />

      {showUI && (
        <View style={styles.overlay} pointerEvents="box-none">

          {/* ── Top gradient + status bar ──────────────────────────────── */}
          <LinearGradient
            colors={["rgba(0,0,0,0.75)", "rgba(0,0,0,0.0)"]}
            style={[styles.topGradient, { paddingTop: insets.top + 10 }]}
          >
            <View style={styles.topBar}>
              {/* Left: REC indicator or Ready */}
              <TouchableOpacity
                style={styles.recRow}
                onPress={() => { closeDashcam(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                {isRecording ? (
                  <>
                    <View style={styles.recDot} />
                    <Text style={styles.recText}>REC</Text>
                  </>
                ) : (
                  <Text style={styles.readyText}>● READY</Text>
                )}
              </TouchableOpacity>

              {/* Center: HH:MM:SS timer */}
              <Text style={styles.timerText}>
                {isRecording ? fmtDuration(totalDuration) : "00:00:00"}
              </Text>

              {/* Right: quality badge */}
              <View style={styles.qualityRow}>
                <Text style={styles.qualityText}>{qualityLabel}</Text>
                {isHD && (
                  <View style={styles.fhdBadge}>
                    <Text style={styles.fhdText}>FHD</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Storage remaining — subtle, just below the top bar */}
            {isRecording && (
              <Text style={styles.storageHint}>
                {storageRemaining(storageUsedBytes, settings.storageCap)}
              </Text>
            )}
          </LinearGradient>

          {/* ── Screenshot button — floating top-right ─────────────────── */}
          <TouchableOpacity
            style={[styles.snapshotBtn, { top: insets.top + 60 }]}
            onPress={takeSnapshot}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="camera-outline" size={22} color="#fff" />
          </TouchableOpacity>

          {/* ── Spacer (camera view area) ───────────────────────────────── */}
          <View style={{ flex: 1 }} pointerEvents="none" />

          {/* ── Bottom section ──────────────────────────────────────────── */}
          <View style={styles.bottomSection}>

            {/* Alert banner */}
            {alertVisible && (
              <View style={styles.alertCard}>
                <View style={styles.alertIcon}>
                  <Ionicons name="warning" size={20} color="#FF3B30" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.alertTitle}>{alertTitle}</Text>
                  <Text style={styles.alertSub}>Saving video clip…</Text>
                </View>
                <Text style={styles.alertCountdown}>{alertCountdown}s</Text>
              </View>
            )}

            {/* Control bar */}
            <View style={[styles.controlBar, { paddingBottom: insets.bottom + 12 }]}>

              {/* Gallery */}
              <TouchableOpacity
                style={styles.ctrlItem}
                onPress={() => { router.push("/dashcam-clips" as any); Haptics.selectionAsync(); }}
                activeOpacity={0.7}
              >
                <View style={styles.ctrlIconWrap}>
                  <Ionicons name="image-outline" size={26} color="#fff" />
                </View>
                <Text style={styles.ctrlLabel}>Gallery</Text>
              </TouchableOpacity>

              {/* Lock Video */}
              <TouchableOpacity
                style={styles.ctrlItem}
                onPress={() => {
                  if (!isRecording) return;
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  lockCurrentClip("manual");
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.ctrlIconWrap, !isRecording && styles.ctrlIconDisabled]}>
                  <Ionicons name="lock-closed-outline" size={24} color={isRecording ? "#fff" : "#ffffff55"} />
                </View>
                <Text style={[styles.ctrlLabel, !isRecording && { color: "#ffffff55" }]}>Lock Video</Text>
              </TouchableOpacity>

              {/* Center: Record / Stop */}
              <View style={styles.ctrlCenterWrap}>
                {!isRecording ? (
                  <TouchableOpacity
                    style={styles.recordBtn}
                    onPress={async () => {
                      if (!permission?.granted) { await requestPermission(); return; }
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                      startDashcam();
                    }}
                    activeOpacity={0.85}
                  >
                    {/* Record: red ring with red fill */}
                    <View style={styles.recordInner} />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.stopBtn}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                      stopDashcam();
                    }}
                    activeOpacity={0.85}
                  >
                    {/* Stop: white square */}
                    <View style={styles.stopInner} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Mic */}
              <TouchableOpacity
                style={styles.ctrlItem}
                onPress={() => {
                  Haptics.selectionAsync();
                  updateSettings({ audioEnabled: !settings.audioEnabled });
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.ctrlIconWrap, !settings.audioEnabled && styles.ctrlIconMuted]}>
                  <Ionicons
                    name={settings.audioEnabled ? "mic-outline" : "mic-off-outline"}
                    size={26}
                    color={settings.audioEnabled ? "#fff" : "#FF3B30"}
                  />
                </View>
                <Text style={[styles.ctrlLabel, !settings.audioEnabled && { color: "#FF3B30" }]}>
                  {settings.audioEnabled ? "Mic" : "Muted"}
                </Text>
              </TouchableOpacity>

              {/* Settings */}
              <TouchableOpacity
                style={styles.ctrlItem}
                onPress={() => {
                  Haptics.selectionAsync();
                  closeDashcam();
                  router.push("/(tabs)/settings" as any);
                }}
                activeOpacity={0.7}
              >
                <View style={styles.ctrlIconWrap}>
                  <Ionicons name="settings-outline" size={24} color="#fff" />
                </View>
                <Text style={styles.ctrlLabel}>Settings</Text>
              </TouchableOpacity>

            </View>
          </View>

          {/* Permission hint */}
          {!permission?.granted && (
            <View style={styles.permissionBanner}>
              <Ionicons name="camera-outline" size={18} color="#fff" />
              <Text style={styles.permissionText}>Camera permission required to record.</Text>
            </View>
          )}

        </View>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: "space-between" },

  // ── Top gradient bar ──────────────────────────────────────────────────────
  topGradient: { paddingHorizontal: 16, paddingBottom: 24 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  // REC indicator
  recRow: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 80 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#FF3B30" },
  recText: {
    color: "#FF3B30", fontSize: 15, fontWeight: "800", letterSpacing: 1,
    // @ts-ignore
    fontVariant: ["tabular-nums"],
  },
  readyText: { color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: "700", letterSpacing: 1 },

  // Timer
  timerText: {
    color: "#fff", fontSize: 22, fontWeight: "700",
    // @ts-ignore
    fontVariant: ["tabular-nums"],
    letterSpacing: 1,
  },

  // Quality badge
  qualityRow: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 80, justifyContent: "flex-end" },
  qualityText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  fhdBadge: {
    borderWidth: 1.5, borderColor: "#fff",
    paddingHorizontal: 5, paddingVertical: 1,
    borderRadius: 3,
  },
  fhdText: { color: "#fff", fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },

  // Storage hint
  storageHint: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11, fontWeight: "500",
    textAlign: "center", marginTop: 6,
    // @ts-ignore
    fontVariant: ["tabular-nums"],
  },

  // ── Screenshot button ─────────────────────────────────────────────────────
  snapshotBtn: {
    position: "absolute",
    right: 16,
    width: 46, height: 46,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.25)",
  },

  // ── Bottom section ────────────────────────────────────────────────────────
  bottomSection: { gap: 0 },

  // Alert banner
  alertCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: 12, marginBottom: 8,
    backgroundColor: "rgba(20,20,20,0.88)",
    borderRadius: 14, padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
  },
  alertIcon: {
    width: 36, height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(255,59,48,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  alertTitle: { color: "#fff", fontSize: 14, fontWeight: "700" },
  alertSub:   { color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: "400", marginTop: 2 },
  alertCountdown: {
    color: "#FF3B30", fontSize: 15, fontWeight: "800",
    // @ts-ignore
    fontVariant: ["tabular-nums"],
  },

  // Control bar
  controlBar: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-around",
    backgroundColor: "rgba(14,14,14,0.92)",
    paddingTop: 18,
    paddingHorizontal: 8,
  },

  // Side control items
  ctrlItem: { flex: 1, alignItems: "center", gap: 6 },
  ctrlIconWrap: {
    width: 46, height: 46,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center", justifyContent: "center",
  },
  ctrlIconDisabled: { backgroundColor: "rgba(255,255,255,0.03)" },
  ctrlIconMuted:    { backgroundColor: "rgba(255,59,48,0.10)" },
  ctrlLabel: { color: "#fff", fontSize: 11, fontWeight: "500" },

  // Center record/stop
  ctrlCenterWrap: { flex: 1, alignItems: "center", marginTop: -12 },

  // Record button: white ring, red fill
  recordBtn: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 3.5, borderColor: "rgba(255,255,255,0.85)",
    alignItems: "center", justifyContent: "center",
    backgroundColor: "transparent",
  },
  recordInner: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#FF3B30" },

  // Stop button: solid red circle, white square
  stopBtn: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: "#FF3B30",
    alignItems: "center", justifyContent: "center",
  },
  stopInner: { width: 26, height: 26, borderRadius: 4, backgroundColor: "#fff" },

  // Permission hint
  permissionBanner: {
    position: "absolute", bottom: 120, left: 0, right: 0,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "rgba(0,0,0,0.7)", paddingVertical: 10,
  },
  permissionText: { color: "#fff", fontSize: 13, fontWeight: "500" },
});
