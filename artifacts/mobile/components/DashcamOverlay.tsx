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

import React, { useCallback, useEffect, useRef } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useDashcam } from "@/context/DashcamContext";
import { useColors } from "@/hooks/useColors";
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

function fmtDuration(s: number): string {
  const m   = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

function fmtStorage(bytes: number): string {
  const GB = bytes / 1_073_741_824;
  if (GB >= 0.1) return `${GB.toFixed(1)} GB`;
  const MB = bytes / 1_048_576;
  return `${Math.round(MB)} MB`;
}

function storageRemaining(used: number, cap: number): string {
  const freeBytes = Math.max(0, cap - used);
  const freeMins  = freeBytes / (4 * 1_048_576); // ~4 MB/min average
  if (freeMins >= 60) return `~${Math.floor(freeMins / 60)}h remaining`;
  return `~${Math.round(freeMins)}m remaining`;
}

// ─── Component ───────────────────────────────────────────────────────────────

const KEEP_AWAKE_TAG = "msafiri-dashcam";

export default function DashcamOverlay() {
  const {
    isRecording, isDashcamOpen,
    settings, storageUsedBytes, currentSegmentDuration,
    startDashcam, stopDashcam, lockCurrentClip,
    closeDashcam, setCameraRef, onSegmentComplete,
  } = useDashcam();
  const c      = useColors();
  const insets = useSafeAreaInsets();

  const localCameraRef  = useRef<any>(null);
  const loopCancelRef   = useRef(false);
  const segmentStartRef = useRef(Date.now());

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
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    }
  }, [isRecording, isDashcamOpen]);

  // ── Recording loop ────────────────────────────────────────────────────────
  // IMPORTANT: the cancel flag is checked AFTER processing each completed
  // segment, so the final in-progress clip is never discarded on Stop.
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

          // Always persist the segment if we received a URI,
          // even when the cancel flag was set during recording.
          if (result?.uri) {
            const durationS = Math.round(
              (Date.now() - segmentStartRef.current) / 1000
            );
            await onSegmentComplete(result.uri, durationS);
          }
        } catch {
          // Camera error or stopRecording threw — exit loop
          break;
        }

        // Only continue looping if we haven't been asked to stop
        if (loopCancelRef.current) break;
      }
    }

    loop();

    return () => {
      loopCancelRef.current = true;
      // stopRecording() causes the current recordAsync to resolve so the
      // cleanup in the loop above can persist the final segment.
      localCameraRef.current?.stopRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  // ── Don't render on web or when fully idle ────────────────────────────────
  if (Platform.OS === "web") return null;
  if (!isRecording && !isDashcamOpen) return null;

  const showUI = isDashcamOpen;

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

      {showUI && (
        <View style={styles.overlay}>
          {/* ── Top bar ─────────────────────────────────────────────── */}
          <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => {
                closeDashcam();
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="chevron-down" size={26} color="#fff" />
            </TouchableOpacity>

            <View style={styles.recRow}>
              {isRecording ? (
                <>
                  <View style={styles.recDot} />
                  <Text style={styles.recText}>REC</Text>
                  <Text style={styles.recTimer}>
                    {"  "}{fmtDuration(currentSegmentDuration)}
                  </Text>
                </>
              ) : (
                <Text style={styles.readyText}>DASHCAM</Text>
              )}
            </View>

            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => {
                router.push("/dashcam-clips" as any);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="film-outline" size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* ── Storage indicator ────────────────────────────────────── */}
          {isRecording && (
            <View style={styles.storageRow}>
              <Ionicons name="server-outline" size={13} color="#ffffffcc" />
              <Text style={styles.storageText}>
                {storageRemaining(storageUsedBytes, settings.storageCap)}
              </Text>
            </View>
          )}

          <View style={{ flex: 1 }} />

          {/* ── Bottom controls ──────────────────────────────────────── */}
          <View style={[styles.bottomControls, { paddingBottom: insets.bottom + 24 }]}>
            {/* Settings pills */}
            <View style={styles.settingsRow}>
              <View style={[styles.settingPill, settings.audioEnabled && styles.settingPillActive]}>
                <Ionicons
                  name={settings.audioEnabled ? "mic" : "mic-off"}
                  size={15}
                  color={settings.audioEnabled ? "#fff" : "#ffffff88"}
                />
                <Text style={[styles.pillText, !settings.audioEnabled && { color: "#ffffff88" }]}>
                  {settings.audioEnabled ? "Audio ON" : "Audio OFF"}
                </Text>
              </View>
              <View style={styles.settingPill}>
                <Ionicons name="videocam-outline" size={15} color="#ffffffcc" />
                <Text style={styles.pillText}>{settings.quality.toUpperCase()}</Text>
              </View>
            </View>

            {/* Record / Stop + Lock row */}
            <View style={styles.actionRow}>
              {!isRecording ? (
                <TouchableOpacity
                  style={styles.recordBtn}
                  onPress={async () => {
                    if (!permission?.granted) {
                      await requestPermission();
                      return;
                    }
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                    startDashcam();
                  }}
                  activeOpacity={0.85}
                >
                  <View style={styles.recordInner} />
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.stopBtn}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                      stopDashcam();
                    }}
                    activeOpacity={0.85}
                  >
                    <View style={styles.stopInner} />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.lockBtn}
                    onPress={() => {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      lockCurrentClip("manual");
                    }}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="lock-closed" size={20} color="#fff" />
                    <Text style={styles.lockText}>Lock Clip</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {!permission?.granted && (
              <Text style={styles.permissionHint}>
                Camera permission required to record.
              </Text>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.25)" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  iconBtn: {
    width: 40, height: 40,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: 20,
  },
  recRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, gap: 4,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FF3B30" },
  recText: { color: "#FF3B30", fontSize: 13, fontWeight: "700", letterSpacing: 1 },
  recTimer: {
    color: "#fff", fontSize: 14, fontWeight: "600",
    // @ts-ignore — fontVariant is supported on native
    fontVariant: ["tabular-nums"],
  },
  readyText: { color: "#ffffffcc", fontSize: 13, fontWeight: "700", letterSpacing: 1.5 },
  storageRow: {
    flexDirection: "row", alignItems: "center", gap: 4,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 12,
  },
  storageText: { color: "#ffffffcc", fontSize: 12, fontWeight: "500" },
  bottomControls: { paddingHorizontal: 24, gap: 16 },
  settingsRow: { flexDirection: "row", gap: 10, justifyContent: "center" },
  settingPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.2)",
  },
  settingPillActive: { borderColor: "rgba(255,255,255,0.5)" },
  pillText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  actionRow: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 28,
  },
  recordBtn: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 4, borderColor: "#fff",
    alignItems: "center", justifyContent: "center",
  },
  recordInner: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#FF3B30" },
  stopBtn: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 4, borderColor: "#fff",
    alignItems: "center", justifyContent: "center",
  },
  stopInner: { width: 28, height: 28, borderRadius: 4, backgroundColor: "#FF3B30" },
  lockBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#1976D2",
    paddingHorizontal: 20, paddingVertical: 14,
    borderRadius: 30,
  },
  lockText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  permissionHint: { color: "#ffffff99", fontSize: 13, textAlign: "center" },
});
