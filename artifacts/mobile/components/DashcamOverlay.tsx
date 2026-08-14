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
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useDashcam } from "@/context/DashcamContext";
import { useApp } from "@/context/AppContext";
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { setDashcamAudioMode } from "@/utils/sound";

// ── Lazy-load expo-camera so the web bundle is not broken ─────────────────────
let CameraView: any    = null;
let useCameraPermissions: any = null;
let useMicrophonePermissions: any = null;
if (Platform.OS !== "web") {
  try {
    const mod = require("expo-camera");
    CameraView               = mod.CameraView;
    useCameraPermissions     = mod.useCameraPermissions;
    useMicrophonePermissions = mod.useMicrophonePermissions;
  } catch {
    // Expo Go may not have the native camera module — degrade gracefully
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDuration(s: number): string {
  const h   = Math.floor(s / 3600).toString().padStart(2, "0");
  const m   = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

function fmtStorage(bytes: number): string {
  const gb = bytes / 1_073_741_824;
  if (gb >= 0.1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1_048_576)} MB`;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const KEEP_AWAKE_TAG = "msafiri-dashcam";
const PANEL_HEIGHT   = 340; // px — settings sheet height

// ─── Component ───────────────────────────────────────────────────────────────

export default function DashcamOverlay() {
  const {
    isRecording, isDashcamOpen, backgroundRecordPending, recordingEpoch,
    settings, storageUsedBytes, segments,
    startDashcam, stopDashcam, lockCurrentClip, updateSettings, clearUnlocked,
    closeDashcam, clearBackgroundRecordPending, setCameraRef,
    onSegmentStart, onSegmentComplete,
  } = useDashcam();

  const { currentLat, currentLng } = useApp();
  // Track the most recent VALID GPS fix so a brief signal gap at the moment a
  // 2-minute segment completes doesn't cause that clip to be saved with no
  // location.  Updated only when both components are non-null.
  const lastValidCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (currentLat != null && currentLng != null) {
      lastValidCoordsRef.current = { lat: currentLat, lng: currentLng };
    }
  }, [currentLat, currentLng]);

  const insets = useSafeAreaInsets();

  const localCameraRef  = useRef<any>(null);
  const loopCancelRef   = useRef(false);
  const segmentStartRef = useRef(Date.now());

  // Track whether the CameraView has already fired onCameraReady. The view is
  // always mounted (translated off-screen when idle) so onCameraReady fires
  // once at app start — not again when backgroundRecordPending is set later.
  // This ref lets us start recording immediately if the camera is already warm.
  const cameraReadyRef = useRef(false);

  // Mirror backgroundRecordPending in a ref so onCameraReady (which runs once
  // as a stale closure captured at mount) can still read the CURRENT value.
  // Without this, slow devices like iPhone 13 Pro Max where the camera finishes
  // initialising AFTER auto-start is triggered will never kick off recording.
  const backgroundRecordPendingRef = useRef(backgroundRecordPending);
  useEffect(() => {
    backgroundRecordPendingRef.current = backgroundRecordPending;
  }, [backgroundRecordPending]);

  // Total recording elapsed time (not per-segment)
  const [totalDuration, setTotalDuration] = useState(0);
  const totalStartRef = useRef<number>(0);

  // Screenshot flash animation
  const flashOpacity = useRef(new Animated.Value(0)).current;

  // Alert banner state — triggered when a new locked clip starts saving
  const [alertVisible, setAlertVisible]     = useState(false);
  const [alertCountdown, setAlertCountdown] = useState(30);
  const [alertTitle, setAlertTitle]         = useState("Impact Detected");
  const prevLockedRef = useRef(0);

  // ── Camera-angle preview ────────────────────────────────────────────────────
  // When the driver starts the dashcam silently from the drive screen we briefly
  // show the live camera feed (4 s countdown, or tap "Looks good →") so they can
  // verify the mounting angle before the preview is covered.
  //
  // This also fixes the core recording bug: opacity:0 on the parent View tells
  // the OS compositor to skip rendering the entire subtree, so the CameraView
  // never gets a real native surface and recordAsync() returns null on every
  // attempt.  Instead we always keep the CameraView at opacity:1 and place an
  // opaque cover View on top of it when it should be invisible.
  const [showAnglePreview, setShowAnglePreview] = useState(false);
  const [angleCountdown, setAngleCountdown]     = useState(4);
  const angleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const angleTickRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const dismissAnglePreview = useCallback(() => {
    setShowAnglePreview(false);
    if (angleTimerRef.current)  { clearTimeout(angleTimerRef.current);  angleTimerRef.current  = null; }
    if (angleTickRef.current)   { clearInterval(angleTickRef.current);   angleTickRef.current   = null; }
  }, []);

  // If backgroundRecordPending is set while the camera is already warm (the
  // normal case — CameraView is always mounted and onCameraReady fired at app
  // start), immediately kick off recording without waiting for a second
  // onCameraReady that will never arrive.
  useEffect(() => {
    if (backgroundRecordPending && cameraReadyRef.current) {
      startDashcam();
      clearBackgroundRecordPending();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundRecordPending]);

  // Trigger angle preview when background recording starts
  useEffect(() => {
    if (!backgroundRecordPending) return;
    setAngleCountdown(4);
    setShowAnglePreview(true);
    // Tick down the counter each second
    angleTickRef.current = setInterval(() => {
      setAngleCountdown((n) => {
        if (n <= 1) {
          // Timer expired — let the interval cleanup handle itself
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    // Auto-dismiss after 4 s
    angleTimerRef.current = setTimeout(() => {
      setShowAnglePreview(false);
      if (angleTickRef.current) { clearInterval(angleTickRef.current); angleTickRef.current = null; }
      angleTimerRef.current = null;
    }, 4000);
    return () => {
      if (angleTimerRef.current) { clearTimeout(angleTimerRef.current);  angleTimerRef.current  = null; }
      if (angleTickRef.current)  { clearInterval(angleTickRef.current);   angleTickRef.current   = null; }
    };
  }, [backgroundRecordPending]);

  // First-time guide modal
  const [guideVisible, setGuideVisible]     = useState(false);
  const GUIDE_KEY = "dashcam_guide_seen_v1";
  useEffect(() => {
    if (!isDashcamOpen) return;
    AsyncStorage.getItem(GUIDE_KEY).then((seen) => {
      if (!seen) setGuideVisible(true);
    }).catch(() => {});
  }, [isDashcamOpen]);

  const dismissGuide = useCallback(() => {
    setGuideVisible(false);
    AsyncStorage.setItem(GUIDE_KEY, "1").catch(() => {});
  }, []);

  // Settings panel
  const [settingsOpen, setSettingsOpen]     = useState(false);
  const settingsPanelY = useRef(new Animated.Value(PANEL_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const [permission, requestPermission] = useCameraPermissions
    ? useCameraPermissions()
    : [{ granted: true }, async () => ({ granted: true })];

  const [micPermission, requestMicPermission] = useMicrophonePermissions
    ? useMicrophonePermissions()
    : [{ granted: true }, async () => ({ granted: true })];

  // Whether the camera should record audio. Computed directly from settings
  // and mic permission — expo-camera v17 controls this via the CameraView
  // `mute` prop, NOT via a recordAsync option (the `muted` key in
  // recordAsync is silently ignored by this version of the library).
  const audioMuted = !settings.audioEnabled || !(micPermission?.granted ?? false);

  // ── Register camera ref with DashcamContext ────────────────────────────────
  const cameraCallbackRef = useCallback(
    (ref: any) => {
      localCameraRef.current = ref;
      setCameraRef(ref);
    },
    [setCameraRef]
  );

  // ── Audio session: keep BT music alive during recording ──────────────────
  // iOS AVCaptureSession claims the audio route the moment recordAsync() is
  // called — even with muted:true — because the encoder pipeline initialises
  // an audio track regardless. Without MixWithOthers, the system tears down
  // the A2DP (Bluetooth) route and music stops.
  //
  // Fix: engage PlayAndRecord + MixWithOthers whenever the camera is rolling,
  // irrespective of whether the mic is on. This lets BT music coexist with
  // both muted and audio-enabled recording.
  // Restores DuckOthers (baseline) the moment recording stops.
  useEffect(() => {
    if (Platform.OS === "web" || !isRecording) return;
    setDashcamAudioMode(true);
    return () => { setDashcamAudioMode(false); };
  }, [isRecording]);

  // ── Keep screen awake while dashcam is active ─────────────────────────────
  // keepAwakeActive tracks whether activateKeepAwakeAsync completed successfully
  // so we never call deactivateKeepAwake before the lock was acquired (which
  // throws on web and crashes the preview).
  const keepAwakeActiveRef = useRef(false);
  useEffect(() => {
    if (isRecording || isDashcamOpen || backgroundRecordPending) {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG)
        .then(() => { keepAwakeActiveRef.current = true; })
        .catch(() => {});
    } else if (keepAwakeActiveRef.current) {
      keepAwakeActiveRef.current = false;
      try { deactivateKeepAwake(KEEP_AWAKE_TAG); } catch { /* ignore */ }
    }
  }, [isRecording, isDashcamOpen, backgroundRecordPending]);

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
      const autoLocked = segments.find(
        (s) => s.locked && s.lockReason && s.lockReason !== "manual"
      );
      setAlertTitle(autoLocked ? "Impact Detected" : "Clip Locked");
      setAlertVisible(true);
      setAlertCountdown(30);
    }
    prevLockedRef.current = lockedPending;
  }, [segments]);

  useEffect(() => {
    if (!alertVisible) return;
    if (alertCountdown <= 0) { setAlertVisible(false); return; }
    const t = setTimeout(() => setAlertCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [alertVisible, alertCountdown]);

  // ── Settings panel open/close ─────────────────────────────────────────────
  const openSettings = useCallback(() => {
    setSettingsOpen(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.parallel([
      Animated.spring(settingsPanelY, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 220 }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [settingsPanelY, backdropOpacity]);

  const closeSettings = useCallback(() => {
    Animated.parallel([
      Animated.timing(settingsPanelY, { toValue: PANEL_HEIGHT, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setSettingsOpen(false));
  }, [settingsPanelY, backdropOpacity]);

  // ── Recording loop ────────────────────────────────────────────────────────
  // Depends on `recordingEpoch` in addition to `isRecording` so that the loop
  // restarts when the app returns to foreground after an iOS background
  // interruption (in which case isRecording stays true but the CameraView's
  // recordAsync was already interrupted — DashcamContext bumps recordingEpoch
  // to trigger a fresh loop iteration without toggling isRecording).
  useEffect(() => {
    if (!isRecording || Platform.OS === "web") return;
    loopCancelRef.current = false;

    async function loop() {
      // Consecutive-failure counter — a single recordAsync rejection used to
      // `break` the loop instantly, so a camera that wasn't quite ready yet
      // (common when auto-started from the drive screen right after
      // onCameraReady) left the REC indicator on while saving zero clips.
      // Instead: back off briefly and retry; only give up after several
      // consecutive failures. Reset on every successful segment.
      let consecutiveFailures = 0;
      const MAX_FAILURES = 6;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      // Camera warm-up: onCameraReady fires slightly before the hardware is
      // actually ready to record. Starting recordAsync immediately often yields
      // a null result on the first segment, eating one of our failure slots.
      // A short pause here lets the camera fully initialise.
      await sleep(900);
      if (loopCancelRef.current) return;

      while (!loopCancelRef.current) {
        if (!localCameraRef.current) {
          // Camera ref not attached yet — wait instead of aborting.
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_FAILURES) break;
          await sleep(500);
          continue;
        }
        try {
          segmentStartRef.current = Date.now();
          // Snapshot the active vehicle's storage paths BEFORE recordAsync so
          // onSegmentComplete writes to the vehicle that was active when this
          // segment STARTED, even if the driver switches vehicles mid-clip.
          onSegmentStart();
          const result = await localCameraRef.current.recordAsync({
            maxDuration: 120,
          });
          if (result?.uri) {
            consecutiveFailures = 0;
            const durationS = Math.round((Date.now() - segmentStartRef.current) / 1000);
            // Use the most recent valid GPS fix — persisted across momentary
            // signal gaps so a brief dropout at the 120 s mark doesn't strip
            // location from the clip.
            const coords = lastValidCoordsRef.current ?? undefined;
            await onSegmentComplete(result.uri, durationS, coords);
          } else if (!loopCancelRef.current) {
            // Resolved with no file (camera interrupted / not ready) — retry.
            consecutiveFailures++;
            if (consecutiveFailures >= MAX_FAILURES) break;
            await sleep(700);
          }
        } catch (err) {
          if (loopCancelRef.current) break;
          console.warn("[Dashcam] recordAsync failed, retrying:", err);
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_FAILURES) break;
          await sleep(700);
        }
      }
    }

    loop().then(() => {
      // If the loop exited because MAX_FAILURES was hit (not because stop was
      // requested), loopCancelRef is still false — the REC indicator would stay
      // on forever because stopAndSaveDashcam defers setIsRecording(false) to
      // onSegmentComplete, which never fires when every recordAsync fails.
      // Call stopDashcam() here to reset isRecording immediately.
      if (!loopCancelRef.current) {
        stopDashcam();
      }
    });
    return () => {
      loopCancelRef.current = true;
      localCameraRef.current?.stopRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, recordingEpoch]);

  // ── Screenshot ────────────────────────────────────────────────────────────
  const takeSnapshot = useCallback(async () => {
    if (!localCameraRef.current) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      Animated.sequence([
        Animated.timing(flashOpacity, { toValue: 1, duration: 80, useNativeDriver: true }),
        Animated.timing(flashOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
      await localCameraRef.current.takePictureAsync({ quality: 0.9, skipProcessing: false });
    } catch { /* silently fail */ }
  }, [flashOpacity]);

  // ── Don't render on web or when fully idle ────────────────────────────────
  if (Platform.OS === "web") return null;
  if (!isRecording && !isDashcamOpen && !backgroundRecordPending) return null;

  // ── Permission gate ────────────────────────────────────────────────────────
  // Without camera permission the CameraView never produces a picture, so
  // rendering the full dashcam UI is misleading. Show a dedicated
  // permission-request state instead — controls and preview only mount once
  // the permission is actually granted.
  //
  // IMPORTANT: skip this gate when backgroundRecordPending is true.
  // DashcamContext.startBackgroundRecording() already called requestCameraPermission()
  // and verified the grant before setting backgroundRecordPending. The Overlay's own
  // useCameraPermissions() hook instance may not have re-synced with the OS yet on
  // first mount (separate hook state), so permission?.granted can transiently read
  // false even though permission was just granted. Blocking here returns null,
  // prevents the CameraView from mounting, and leaves the dashcam stuck in
  // "Starting…" indefinitely because onCameraReady never fires.
  if (!permission?.granted && !backgroundRecordPending) {
    if (!isDashcamOpen) return null; // background start already handles denial
    return (
      <View style={[StyleSheet.absoluteFill, styles.permScreen]}>
        <TouchableOpacity
          style={[styles.permCloseBtn, { top: insets.top + 10 }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); closeDashcam(); }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>
        <View style={styles.permIconWrap}>
          <Ionicons name="videocam-off-outline" size={44} color="#FF3B30" />
        </View>
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Text style={styles.permBody}>
          The dashcam records the road ahead using your phone's camera. Allow
          camera access to start recording — clips stay on your device unless
          you lock them.
        </Text>
        <TouchableOpacity
          style={styles.permGrantBtn}
          activeOpacity={0.85}
          onPress={async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            const res = await requestPermission();
            if (!res?.granted && res?.canAskAgain === false) {
              // Permanently denied — the system dialog won't show again.
              Linking.openSettings().catch(() => {});
            }
          }}
        >
          <Ionicons name="videocam-outline" size={18} color="#fff" />
          <Text style={styles.permGrantTxt}>Allow Camera Access</Text>
        </TouchableOpacity>
        {permission?.canAskAgain === false && (
          <Text style={styles.permHint}>
            Camera was denied earlier — enable it in your phone's Settings.
          </Text>
        )}
      </View>
    );
  }

  // In background-record-pending mode the overlay mounts silently (opacity 0,
  // no pointer events) just long enough for the CameraView to warm up. Once
  // onCameraReady fires, startDashcam() is called, backgroundRecordPending is
  // cleared, and we transition into the normal invisible-recording state.
  const showUI = isDashcamOpen && !backgroundRecordPending;
  const qualityLabel = settings.quality === "1080p" ? "1080P" : "720P";
  const isHD         = settings.quality === "1080p";
  // The rolling window keeps at most 5 unlocked clips at a time (~10 min max).
  // Show how many unlocked clips are currently on device as a simple counter.
  const unlockedCount = segments.filter((s) => !s.locked && !s.savedForReview).length;

  // When the dashcam is recording silently in the background (not showUI,
  // not showAnglePreview) we need the CameraView alive for recordAsync() but
  // we must NOT cover the drive screen with anything visible.
  //
  // opacity:0 on the parent causes the OS compositor to skip the entire
  // subtree — the camera gets no native surface and recordAsync() returns null.
  //
  // An opaque black cover View inside an absoluteFill container (our previous
  // approach) hid the camera but ALSO covered the drive screen, producing a
  // black screen after the angle preview was dismissed.
  //
  // Solution: translate the whole overlay 5 000 px above the viewport when it
  // is background-only. The CameraView is rendered at full size with normal
  // opacity (compositor allocates a real surface), recording continues, and
  // nothing is visible to the driver. translateY does NOT affect compositing.
  // Gate background-translate on isRecording, NOT on backgroundRecordPending.
  // When backgroundRecordPending is first set, showAnglePreview is still false
  // for one render cycle (the effect that sets it runs asynchronously). If we
  // included !backgroundRecordPending here the overlay would translate to -6000y
  // on that first render, preventing the OS from giving the CameraView a real
  // surface — causing onCameraReady to never fire and leaving autostart stuck
  // in "Starting". Only translate off-screen once recording is actually live.
  const isBackgroundOnly = isRecording && !showUI && !showAnglePreview;
  const overlayZIndex    = showUI ? 9999 : showAnglePreview ? 500 : 2;

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { zIndex: overlayZIndex },
        isBackgroundOnly && { transform: [{ translateY: -6000 }] },
      ]}
      pointerEvents={showUI || showAnglePreview ? "auto" : "none"}
    >
      {/* ── Camera feed ──────────────────────────────────────────────────────
          Always rendered at opacity:1 so the OS compositor allocates a real
          native surface (AVPreviewLayer / SurfaceTexture). Visibility to the
          driver is controlled by the translateY trick above, NOT by opacity. */}
      {CameraView && (
        <CameraView
          ref={cameraCallbackRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="video"
          videoQuality={settings.quality === "720p" ? "720p" : "1080p"}
          mute={audioMuted}
          onCameraReady={() => {
            cameraReadyRef.current = true;
            // Fallback: if backgroundRecordPending was set before the camera
            // finished warming up (slow device / very first launch), start now.
            // Read from ref — the JSX closure captures a stale false value.
            if (backgroundRecordPendingRef.current) {
              startDashcam();
              clearBackgroundRecordPending();
            }
          }}
        />
      )}

      {/* ── Camera-angle preview ─────────────────────────────────────────────
          Shown for 4 s when the driver starts the dashcam from the drive
          screen. The live camera feed is visible (overlay is on-screen, no
          black cover) so they can verify the mounting angle before recording
          begins. Tapping the button or letting the countdown expire calls
          dismissAnglePreview(), which sets showAnglePreview=false and
          isBackgroundOnly=true, translating the overlay off-screen while
          recording continues invisibly in the background. */}
      {showAnglePreview && !showUI && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {/* Dark gradient at the bottom so the card text is legible */}
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.75)"]}
            style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 220 }}
            pointerEvents="none"
          />
          {/* Countdown badge — top-right */}
          <View style={[styles.angleBadge, { top: insets.top + 12 }]}>
            <View style={styles.angleBadgeDot} />
            <Text style={styles.angleBadgeTxt}>Starting in {angleCountdown}s</Text>
          </View>
          {/* Bottom card */}
          <View style={[styles.angleCard, { bottom: insets.bottom + 24 }]}>
            <Ionicons name="camera-outline" size={22} color="#fff" style={{ marginBottom: 6 }} />
            <Text style={styles.angleCardTitle}>Check camera angle</Text>
            <Text style={styles.angleCardSub}>
              Make sure the road ahead is centred in view. Recording starts automatically.
            </Text>
            <TouchableOpacity
              style={styles.angleCardBtn}
              onPress={dismissAnglePreview}
              activeOpacity={0.82}
            >
              <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
              <Text style={styles.angleCardBtnTxt}>Looks good — start recording</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Screenshot flash */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: "#fff", opacity: flashOpacity }]}
        pointerEvents="none"
      />

      {/* ── First-time guide modal ────────────────────────────────────────── */}
      <Modal
        visible={guideVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={dismissGuide}
      >
        <View style={styles.guideBackdrop}>
          <View style={[styles.guideSheet, { paddingBottom: insets.bottom + 20 }]}>
            {/* Header */}
            <View style={styles.guideHeader}>
              <View style={styles.guideIconWrap}>
                <Text style={{ fontSize: 36 }}>🎥</Text>
              </View>
              <Text style={styles.guideTitle}>How Dashcam Works</Text>
              <Text style={styles.guideSub}>
                Your phone records the road while you drive. Here's what you need to know.
              </Text>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ marginTop: 4 }}>
              {([
                {
                  icon: "film-outline",
                  color: "#60A5FA",
                  title: "2-minute rolling clips",
                  body: "The dashcam records in 2-minute segments, looping continuously. Old unlocked clips are overwritten when your storage limit is reached.",
                },
                {
                  icon: "lock-closed-outline",
                  color: "#F59E0B",
                  title: "Lock a clip to keep it forever",
                  body: "Tap 🔒 Lock Clip at any time during a drive — or tap it on the drive screen — to permanently protect the current clip. Locked clips are uploaded to cloud storage and never auto-deleted.",
                },
                {
                  icon: "cloud-upload-outline",
                  color: "#34D399",
                  title: "What gets saved to cloud",
                  body: "Only locked clips are uploaded. Unlocked clips stay on your device only and are removed when you run out of storage. Lock anything important — crashes, near-misses, incidents.",
                },
                {
                  icon: "trash-outline",
                  color: "#F87171",
                  title: "What gets deleted",
                  body: "When your storage limit is reached (default 1 GB), the oldest unlocked clips are deleted automatically. Locked clips are never automatically deleted.",
                },
                {
                  icon: "car-sport-outline",
                  color: "#A78BFA",
                  title: "Driving is required",
                  body: "The dashcam only records during an active drive. Start a drive from the Drive tab, then turn on the dashcam from the drive screen or this overlay.",
                },
              ] as { icon: any; color: string; title: string; body: string }[]).map((item, i) => (
                <View key={i} style={styles.guideRow}>
                  <View style={[styles.guideRowIcon, { backgroundColor: item.color + "1a" }]}>
                    <Ionicons name={item.icon} size={22} color={item.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.guideRowTitle}>{item.title}</Text>
                    <Text style={styles.guideRowBody}>{item.body}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={styles.guideCta}
              onPress={dismissGuide}
              activeOpacity={0.85}
            >
              <Ionicons name="videocam-outline" size={18} color="#fff" />
              <Text style={styles.guideCtaTxt}>Got it — start recording</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {showUI && (
        <View style={styles.overlay} pointerEvents="box-none">

          {/* ── Top gradient + status bar ──────────────────────────── */}
          <LinearGradient
            colors={["rgba(0,0,0,0.78)", "rgba(0,0,0,0.0)"]}
            style={[styles.topGradient, { paddingTop: insets.top + 10 }]}
            pointerEvents="box-none"
          >
            <View style={styles.topBar}>
              {/* Left: REC / READY — tap collapses the UI */}
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

              {/* Center: HH:MM:SS */}
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

            {isRecording && (
              <Text style={styles.storageHint}>
                {unlockedCount}/5 clips · {fmtStorage(storageUsedBytes)} used
              </Text>
            )}
          </LinearGradient>

          {/* ── Screenshot button — floating top-right ─────────────── */}
          <TouchableOpacity
            style={[styles.snapshotBtn, { top: insets.top + 58 }]}
            onPress={takeSnapshot}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="camera-outline" size={22} color="#fff" />
          </TouchableOpacity>

          {/* Spacer */}
          <View style={{ flex: 1 }} pointerEvents="none" />

          {/* ── Bottom section ─────────────────────────────────────── */}
          <View style={styles.bottomSection}>

            {/* Alert banner */}
            {alertVisible && (
              <TouchableOpacity
                style={styles.alertCard}
                onPress={() => setAlertVisible(false)}
                activeOpacity={0.85}
              >
                <View style={styles.alertIcon}>
                  <Ionicons name="warning" size={20} color="#FF3B30" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.alertTitle}>{alertTitle}</Text>
                  <Text style={styles.alertSub}>Saving video clip…</Text>
                </View>
                <Text style={styles.alertCountdown}>{alertCountdown}s</Text>
              </TouchableOpacity>
            )}

            {/* Control bar */}
            <View style={[styles.controlBar, { paddingBottom: insets.bottom + 12 }]}>

              {/* Gallery — closes overlay so clips page is visible; recording continues */}
              <TouchableOpacity
                style={styles.ctrlItem}
                onPress={() => {
                  Haptics.selectionAsync();
                  closeDashcam();          // hides overlay; camera keeps recording in bg
                  router.push("/dashcam-videos" as any);
                }}
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
                  <Ionicons
                    name="lock-closed-outline"
                    size={24}
                    color={isRecording ? "#fff" : "#ffffff44"}
                  />
                </View>
                <Text style={[styles.ctrlLabel, !isRecording && { color: "#ffffff44" }]}>Lock Video</Text>
              </TouchableOpacity>

              {/* Center: Record / Stop */}
              <View style={styles.ctrlCenterWrap}>
                {!isRecording ? (
                  <TouchableOpacity
                    style={styles.recordBtn}
                    onPress={async () => {
                      // Camera permission is guaranteed by the gate above; ask
                      // for the mic here so audio-enabled recording never throws.
                      if (settings.audioEnabled && !micPermission?.granted) {
                        try { await requestMicPermission(); } catch { /* muted fallback */ }
                      }
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                      startDashcam();
                    }}
                    activeOpacity={0.85}
                  >
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

              {/* Settings — opens inline panel */}
              <TouchableOpacity
                style={styles.ctrlItem}
                onPress={openSettings}
                activeOpacity={0.7}
              >
                <View style={[styles.ctrlIconWrap, settingsOpen && styles.ctrlIconActive]}>
                  <Ionicons name="settings-outline" size={24} color="#fff" />
                </View>
                <Text style={styles.ctrlLabel}>Settings</Text>
              </TouchableOpacity>

            </View>
          </View>

          {/* ── Settings panel (slide-up sheet within dashcam) ──────── */}
          {settingsOpen && (
            <>
              {/* Backdrop — tap to dismiss */}
              <Animated.View
                style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}
                pointerEvents="auto"
              >
                <Pressable style={{ flex: 1 }} onPress={closeSettings} />
              </Animated.View>

              {/* Panel */}
              <Animated.View
                style={[
                  styles.settingsPanel,
                  { paddingBottom: insets.bottom + 16 },
                  { transform: [{ translateY: settingsPanelY }] },
                ]}
              >
                {/* Handle */}
                <View style={styles.panelHandle} />
                <Text style={styles.panelTitle}>Dashcam Settings</Text>

                <ScrollView showsVerticalScrollIndicator={false} style={{ marginTop: 4 }}>

                  {/* ── Video Quality ─────────────────────────────── */}
                  <Text style={styles.sectionLabel}>VIDEO QUALITY</Text>
                  <View style={styles.chipRow}>
                    {(["720p", "1080p"] as const).map((q) => (
                      <TouchableOpacity
                        key={q}
                        style={[styles.chip, settings.quality === q && styles.chipActive]}
                        onPress={() => { Haptics.selectionAsync(); updateSettings({ quality: q }); }}
                      >
                        <Ionicons
                          name="videocam-outline"
                          size={15}
                          color={settings.quality === q ? "#fff" : "#ffffff88"}
                        />
                        <Text style={[styles.chipText, settings.quality === q && styles.chipTextActive]}>
                          {q === "1080p" ? "1080p FHD" : "720p HD"}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* ── Rolling window info ───────────────────── */}
                  <Text style={[styles.sectionLabel, { marginTop: 18 }]}>LOCAL STORAGE</Text>
                  <View style={styles.storageBarRow}>
                    <View style={styles.storageBarBg}>
                      <View style={[styles.storageBarFill, { width: `${Math.round((unlockedCount / 5) * 100)}%` as any }]} />
                    </View>
                    <Text style={styles.storageBarLabel}>
                      {unlockedCount}/5 clips · {fmtStorage(storageUsedBytes)} on device
                    </Text>
                  </View>
                  <Text style={[styles.storageBarLabel, { marginTop: 6, opacity: 0.6 }]}>
                    The last 5 clips are kept as a rolling buffer. Lock clips to save them beyond the trip.
                  </Text>

                  {/* ── Toggles ──────────────────────────────────── */}
                  <Text style={[styles.sectionLabel, { marginTop: 18 }]}>OPTIONS</Text>

                  <View style={styles.toggleRow}>
                    <View style={styles.toggleInfo}>
                      <Ionicons name="mic-outline" size={18} color="#fff" />
                      <View>
                        <Text style={styles.toggleLabel}>Microphone</Text>
                        <Text style={styles.toggleSub}>Record ambient audio</Text>
                      </View>
                    </View>
                    <Switch
                      value={settings.audioEnabled}
                      onValueChange={(v) => updateSettings({ audioEnabled: v })}
                      trackColor={{ false: "#333", true: "#FF3B30" }}
                      thumbColor="#fff"
                    />
                  </View>

                  <View style={[styles.toggleRow, { marginTop: 2 }]}>
                    <View style={styles.toggleInfo}>
                      <Ionicons name="wifi-outline" size={18} color="#fff" />
                      <View>
                        <Text style={styles.toggleLabel}>Wi-Fi upload only</Text>
                        <Text style={styles.toggleSub}>Locked clips upload on Wi-Fi</Text>
                      </View>
                    </View>
                    <Switch
                      value={settings.wifiOnlyUpload}
                      onValueChange={(v) => updateSettings({ wifiOnlyUpload: v })}
                      trackColor={{ false: "#333", true: "#FF3B30" }}
                      thumbColor="#fff"
                    />
                  </View>

                  {/* ── Actions ──────────────────────────────────── */}
                  <Text style={[styles.sectionLabel, { marginTop: 18 }]}>STORAGE</Text>

                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={styles.actionBtn}
                      onPress={() => {
                        Haptics.selectionAsync();
                        closeSettings();
                        closeDashcam();
                        router.push("/dashcam-videos" as any);
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="film-outline" size={18} color="#fff" />
                      <Text style={styles.actionBtnText}>View Clips</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionBtnDanger]}
                      onPress={() => {
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                        clearUnlocked();
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="trash-outline" size={18} color="#FF3B30" />
                      <Text style={[styles.actionBtnText, { color: "#FF3B30" }]}>Clear Unlocked</Text>
                    </TouchableOpacity>
                  </View>

                </ScrollView>
              </Animated.View>
            </>
          )}

        </View>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: "space-between" },

  // Top gradient
  topGradient: { paddingHorizontal: 16, paddingBottom: 28 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  recRow: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 80 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#FF3B30" },
  recText: {
    color: "#FF3B30", fontSize: 15, fontWeight: "800", letterSpacing: 1,
    // @ts-ignore
    fontVariant: ["tabular-nums"],
  },
  readyText: { color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: "700", letterSpacing: 1 },
  timerText: {
    color: "#fff", fontSize: 22, fontWeight: "700",
    // @ts-ignore
    fontVariant: ["tabular-nums"],
    letterSpacing: 1,
  },
  qualityRow: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 80, justifyContent: "flex-end" },
  qualityText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  fhdBadge: {
    borderWidth: 1.5, borderColor: "#fff",
    paddingHorizontal: 5, paddingVertical: 1,
    borderRadius: 3,
  },
  fhdText: { color: "#fff", fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  storageHint: {
    color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "500",
    textAlign: "center", marginTop: 6,
  },

  // Screenshot button
  snapshotBtn: {
    position: "absolute", right: 16,
    width: 46, height: 46, borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.2)",
  },

  // Bottom section
  bottomSection: { gap: 0 },

  // Alert banner
  alertCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: 12, marginBottom: 8,
    backgroundColor: "rgba(18,18,18,0.9)",
    borderRadius: 14, padding: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.1)",
  },
  alertIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "rgba(255,59,48,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  alertTitle: { color: "#fff", fontSize: 14, fontWeight: "700" },
  alertSub:   { color: "rgba(255,255,255,0.5)", fontSize: 12, marginTop: 2 },
  alertCountdown: {
    color: "#FF3B30", fontSize: 15, fontWeight: "800",
    // @ts-ignore
    fontVariant: ["tabular-nums"],
  },

  // Control bar
  controlBar: {
    flexDirection: "row", alignItems: "flex-start", justifyContent: "space-around",
    backgroundColor: "rgba(12,12,12,0.93)",
    paddingTop: 18, paddingHorizontal: 8,
  },
  ctrlItem: { flex: 1, alignItems: "center", gap: 6 },
  ctrlIconWrap: {
    width: 46, height: 46, borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center", justifyContent: "center",
  },
  ctrlIconDisabled: { backgroundColor: "rgba(255,255,255,0.03)" },
  ctrlIconMuted:    { backgroundColor: "rgba(255,59,48,0.12)" },
  ctrlIconActive:   { backgroundColor: "rgba(255,255,255,0.18)", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
  ctrlLabel: { color: "#fff", fontSize: 11, fontWeight: "500" },
  ctrlCenterWrap: { flex: 1, alignItems: "center", marginTop: -12 },

  // Record / Stop buttons
  recordBtn: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 3.5, borderColor: "rgba(255,255,255,0.85)",
    alignItems: "center", justifyContent: "center",
  },
  recordInner: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#FF3B30" },
  stopBtn: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: "#FF3B30",
    alignItems: "center", justifyContent: "center",
  },
  stopInner: { width: 26, height: 26, borderRadius: 4, backgroundColor: "#fff" },

  // ── Permission gate screen ──────────────────────────────────────────────────
  permScreen: {
    backgroundColor: "#0B0B0B", zIndex: 9999,
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 32,
  },
  permCloseBtn: {
    position: "absolute", right: 18,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  permIconWrap: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: "rgba(255,59,48,0.12)",
    alignItems: "center", justifyContent: "center",
    marginBottom: 20,
  },
  permTitle: { color: "#fff", fontSize: 20, fontWeight: "800", marginBottom: 10, textAlign: "center" },
  permBody: {
    color: "rgba(255,255,255,0.65)", fontSize: 14, lineHeight: 21,
    textAlign: "center", marginBottom: 26,
  },
  permGrantBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#FF3B30", borderRadius: 26,
    paddingHorizontal: 24, paddingVertical: 14,
  },
  permGrantTxt: { color: "#fff", fontSize: 15, fontWeight: "700" },
  permHint: {
    color: "rgba(255,255,255,0.45)", fontSize: 12,
    textAlign: "center", marginTop: 14,
  },

  // ── Settings panel ──────────────────────────────────────────────────────────
  settingsPanel: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "rgba(14,14,14,0.97)",
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12,
    maxHeight: PANEL_HEIGHT + 80,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.1)",
  },
  panelHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignSelf: "center", marginBottom: 14,
  },
  panelTitle: { color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 6 },
  sectionLabel: {
    color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: "700",
    letterSpacing: 0.8, marginBottom: 10,
  },

  // Quality / storage chips
  chipRow: { flexDirection: "row", gap: 10 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 9,
    borderRadius: 20, borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  chipActive: { backgroundColor: "#FF3B30", borderColor: "#FF3B30" },
  chipText:   { color: "rgba(255,255,255,0.65)", fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: "#fff" },

  // Storage bar
  storageBarRow: { marginTop: 10, gap: 6 },
  storageBarBg: {
    height: 4, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.12)", overflow: "hidden",
  },
  storageBarFill: { height: "100%", backgroundColor: "#FF3B30", borderRadius: 2 },
  storageBarLabel: { color: "rgba(255,255,255,0.4)", fontSize: 11 },

  // Toggle rows
  toggleRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.08)",
  },
  toggleInfo: { flexDirection: "row", alignItems: "center", gap: 12 },
  toggleLabel: { color: "#fff", fontSize: 14, fontWeight: "500" },
  toggleSub:   { color: "rgba(255,255,255,0.4)", fontSize: 11, marginTop: 1 },

  // ── First-time guide modal ──────────────────────────────────────────────────
  guideBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "flex-end",
  },
  guideSheet: {
    backgroundColor: "#111",
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 24,
    maxHeight: "88%",
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.1)",
  },
  guideHeader: { alignItems: "center", marginBottom: 20 },
  guideIconWrap: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center", justifyContent: "center",
    marginBottom: 14,
  },
  guideTitle: {
    color: "#fff", fontSize: 20, fontWeight: "800",
    textAlign: "center", marginBottom: 8,
  },
  guideSub: {
    color: "rgba(255,255,255,0.55)", fontSize: 14, lineHeight: 20,
    textAlign: "center",
  },
  guideRow: {
    flexDirection: "row", gap: 14, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.07)",
  },
  guideRowIcon: {
    width: 44, height: 44, borderRadius: 13,
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  guideRowTitle: {
    color: "#fff", fontSize: 14, fontWeight: "700", marginBottom: 4,
  },
  guideRowBody: {
    color: "rgba(255,255,255,0.55)", fontSize: 13, lineHeight: 18,
  },
  guideCta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#00A845", borderRadius: 18,
    paddingVertical: 15, marginTop: 20,
  },
  guideCtaTxt: { color: "#fff", fontSize: 15, fontWeight: "700" },

  // Action buttons
  actionRow: { flexDirection: "row", gap: 10, marginTop: 12, marginBottom: 8 },
  actionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.12)",
  },
  actionBtnDanger: { backgroundColor: "rgba(255,59,48,0.08)", borderColor: "rgba(255,59,48,0.2)" },
  actionBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },

  // Camera-angle preview
  angleBadge: {
    position: "absolute", right: 14, flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  angleBadgeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#EF4444" },
  angleBadgeTxt: { color: "#fff", fontSize: 13, fontWeight: "600" },
  angleCard: {
    position: "absolute", left: 16, right: 16,
    backgroundColor: "rgba(0,0,0,0.60)", borderRadius: 20,
    paddingHorizontal: 20, paddingVertical: 20, alignItems: "center", gap: 4,
    borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.15)",
  },
  angleCardTitle: { color: "#fff", fontSize: 17, fontWeight: "700", letterSpacing: -0.3 },
  angleCardSub: {
    color: "rgba(255,255,255,0.65)", fontSize: 13, lineHeight: 18,
    textAlign: "center", marginTop: 2, marginBottom: 10,
  },
  angleCardBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#00A845", borderRadius: 14,
    paddingHorizontal: 22, paddingVertical: 13,
  },
  angleCardBtnTxt: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
