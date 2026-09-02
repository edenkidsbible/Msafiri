/**
 * DashcamContext.tsx
 *
 * Manages dashcam recording state, local segment storage, and cloud upload
 * queue.
 *
 * Storage model (revised):
 * ──────────────────────────────────────────────────────────
 * UNLOCKED clips  — live rolling window, max 5 on device at any time.
 *   The oldest is automatically deleted when the 6th clip is saved.
 *   These are NEVER uploaded to the cloud.
 *
 * SAVED-FOR-REVIEW clips  — the last 5 unlocked clips preserved when a trip
 *   ends, the app backgrounds, or the app closes mid-trip.  Shown to the
 *   driver as "Review last trip" so they can lock clips they care about.
 *   Not uploaded until the driver explicitly locks them.  Cleared when the
 *   driver dismisses the review banner.
 *
 * MANUALLY LOCKED clips  — driver tapped the lock button or locked a
 *   saved-for-review clip.  Max 5 on device.  Uploaded to cloud (30-day
 *   cloud retention, extendable to 60 days by pinning).
 *
 * AUTO-LOCKED clips  — system-detected events (crash, hazard, etc.).
 *   Max 20 on device.  Uploaded to cloud (24-hour cloud retention by default).
 *
 * Cloud retention:
 *   manual → 30 days from recording date
 *   auto   → 24 hours from recording date
 *   pinned → 60 days (max 5 pins per device, server-enforced)
 *
 * Device enrollment & auth — same as before (SHA-256 device secret).
 * Upload queue — same bounded-retry/backoff logic as before.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVehicle } from "@/context/VehicleContext";
import { useApp } from "@/context/AppContext";
import { useLiveLocation } from "@/context/LocationContext";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import * as Notifications from "expo-notifications";
import { Alert, AppState, Platform } from "react-native";
import { API_BASE } from "@/utils/apiClient";
import type { CameraView } from "expo-camera";
import {
  getAndroidCameraPermissionState,
  getAndroidMicrophonePermissionGranted,
  requestAndroidCameraPermission,
  requestAndroidMicrophonePermission,
  type AndroidCameraPermissionState,
} from "@/utils/androidCameraPermissions";
import { setDashcamAudioMode } from "@/utils/sound";
import {
  vehicleSegmentsKey,
  vehicleSegmentsDir as _vehicleSegmentsDir,
  computeSegmentDestUri,
  detectVehicleSwitch,
  buildDashcamSegment,
} from "@/utils/dashcamSegmentRouting";

let useCameraPermissions: (() => [{ granted: boolean }, () => Promise<{ granted: boolean }>]) | null = null;
let useMicrophonePermissions: (() => [{ granted: boolean }, () => Promise<{ granted: boolean }>]) | null = null;
if (Platform.OS === "ios") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("expo-camera");
  useCameraPermissions = mod.useCameraPermissions ?? null;
  useMicrophonePermissions = mod.useMicrophonePermissions ?? null;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DashcamSegment {
  id: string;
  uri: string;
  startedAt: number;    // epoch ms
  durationS: number;
  sizeBytes: number;
  locked: boolean;
  /** "manual" = driver-locked; "auto" = system-locked (crash, background, etc.) */
  lockType?: "manual" | "auto";
  lockReason?: string;
  /**
   * True for the last-5 clips preserved at trip end / app background.
   * These sit on device waiting for driver review — not yet uploaded.
   * Cleared when the driver locks or dismisses them.
   */
  savedForReview?: boolean;
  /** True when the driver has pinned this cloud clip (extends retention to 60 days). */
  pinned?: boolean;
  /**
   * "lost" — the local file was purged by the OS before upload could complete.
   * Retained in UI so the driver can see footage was lost rather than it
   * disappearing silently.
   */
  uploadStatus: "none" | "pending" | "uploading" | "uploaded" | "failed" | "lost";
  fileKey?: string;     // R2 key once uploaded
  serverId?: string;    // DB id once saved on server
  retryCount?: number;
  lat?: number;
  lng?: number;
  /** Speed at the moment this segment began recording, in km/h (rounded integer).
   *  Null/undefined for clips recorded before this field was introduced. */
  speedKmh?: number;
}

export interface DashcamSettings {
  quality: "720p";
  audioEnabled: boolean;
  wifiOnlyUpload: boolean;
}

interface DashcamContextValue {
  isRecording: boolean;
  /** Stable ref — mirrors isRecording but readable synchronously from the recording loop. */
  isRecordingRef: React.MutableRefObject<boolean>;
  /** True while Road Channels exclusively owns the dashcam release sequence. */
  voiceHandoffActiveRef: React.MutableRefObject<boolean>;
  /** True for the full period Road Channels owns or is acquiring the microphone. */
  voiceCaptureActive: boolean;
  isDashcamOpen: boolean;
  backgroundRecordPending: boolean;
  segments: DashcamSegment[];
  storageUsedBytes: number;
  currentSegmentDuration: number;
  uploadPending: number;
  settings: DashcamSettings;
  /** Android reads the OS grant directly; iOS mirrors expo-camera's hook state. */
  cameraPermissionState: AndroidCameraPermissionState;
  microphonePermissionGranted: boolean;
  recordingEpoch: number;
  pushDeviceId: string | null;
  cloudQuotaFull: boolean;
  /**
   * True when there are saved-for-review clips waiting for the driver to
   * review after a trip. Show a "Review last trip" prompt when this is true.
   */
  pendingTripReview: boolean;
  clearCloudQuotaFull: () => void;
  openDashcam: () => void;
  closeDashcam: () => void;
  startDashcam: () => void;
  stopDashcam: () => void;
  /** Stop recording without auto-locking; last 5 clips are saved for review. */
  stopAndSaveDashcam: () => void;
  startBackgroundRecording: () => Promise<boolean>;
  /**
   * Finish and save the current segment, then fully release CameraView/audio
   * capture for a short Road Channels microphone recording.
   * Returns true when a running dashcam was paused and should later resume.
   */
  pauseForVoiceReport: () => Promise<boolean>;
  /** Release the Road Channels microphone lease and resume when requested. */
  resumeAfterVoiceReport: (shouldResume: boolean) => Promise<void>;
  requestDashcamPermissions: (options?: { requestCamera?: boolean; requestMicrophone?: boolean }) => Promise<{ cameraGranted: boolean; micGranted: boolean }>;
  refreshDashcamCameraPermission: () => Promise<AndroidCameraPermissionState>;
  clearBackgroundRecordPending: () => void;
  /** Lock the currently recording clip (stops the clip, queues it for upload). */
  lockCurrentClip: (reason?: string) => void;
  /**
   * Lock a saved-for-review clip and queue it for cloud upload.
   * Enforces the 5-clip manual-lock limit.
   */
  lockSavedClip: (id: string) => void;
  /**
   * Lock an existing local clip from the gallery and queue it for cloud upload.
   * This is separate from lockCurrentClip, which stops the active camera recording.
   */
  lockSegment: (id: string) => void;
  /**
   * Delete all saved-for-review clips and clear the review banner.
   * Called when the driver dismisses the review without locking anything.
   */
  dismissTripReview: () => Promise<void>;
  deleteSegment: (id: string) => Promise<void>;
  clearUnlocked: () => Promise<void>;
  updateSettings: (partial: Partial<DashcamSettings>) => Promise<void>;
  /** Pin a cloud clip (extends retention to 60 days). Max 5 pins. */
  pinSegment: (id: string) => Promise<void>;
  /** Unpin a cloud clip (restores standard 30-day / 24-hour retention). */
  unpinSegment: (id: string) => Promise<void>;
  /**
   * Restart the recording loop without stopping isRecording.
   * Called by DashcamOverlay when the loop exits due to consecutive failures
   * so the dashcam auto-recovers instead of silently turning off.
   */
  bumpRecordingEpoch: () => void;
  // Internal — called by DashcamOverlay
  setCameraRef: (ref: CameraView | null) => void;
  onSegmentStart: () => void;
  onSegmentComplete: (tempUri: string, durationS?: number, coords?: { lat: number; lng: number }) => Promise<void>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SETTINGS_KEY       = "dashcam_settings_v1";
const SECRET_KEY         = "dashcam_secret_v1";
const LEGACY_SEGMENTS_KEY = "dashcam_segments_v1";

const vehicleSegmentsDir = (vKey: string) =>
  _vehicleSegmentsDir(vKey, FileSystem.documentDirectory ?? "");

const PUSH_DEVICE_ID_KEY = "@msafiri/deviceId";

// Exponential backoff delays for failed uploads (ms): 15s, 60s, 5min, 15min
const UPLOAD_RETRY_BACKOFF = [15_000, 60_000, 5 * 60_000, 15 * 60_000];
const MAX_UPLOAD_RETRIES   = UPLOAD_RETRY_BACKOFF.length;

/** Max unlocked clips kept in the live rolling window during a trip. */
const UNLOCKED_ROLLING_WINDOW = 5;
/** Max saved-for-review clips kept across all trips (5 per trip × 2 trips). */
const MAX_REVIEW_CLIPS        = 10;
/** Max manually locked clips allowed on-device at once. */
const MAX_MANUAL_LOCKS_LOCAL  = 5;
/** Max auto-locked clips allowed on-device at once (silently dropped when full). */
const MAX_AUTO_LOCKS_LOCAL    = 20;

const DEFAULT_SETTINGS: DashcamSettings = {
  // 720p only: 1080p encoding was the single largest hardware heat source
  // during a trip. 720p is sufficient for incident evidence and insurance claims.
  quality: "720p",
  // Audio off by default: keeping the mic open blocks Bluetooth audio and
  // adds continuous audio encoding overhead. Drivers can enable it when needed.
  audioEnabled: false,
  // Upload over any connection by default — most drivers in Kenya use mobile
  // data while driving and would never reach Wi-Fi before a session ends.
  // Users can opt in to Wi-Fi-only in Settings if data usage is a concern.
  wifiOnlyUpload: false,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function authHeaders(deviceId: string, secret: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Device-Id": deviceId,
    "X-Dashcam-Secret": secret,
  };
}

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Recover completed files that reached documentDirectory but whose metadata
 * commit was interrupted by process termination. CameraView does not expose
 * the URI of a still-active recording, so only completed/moved files can be
 * recovered after a force-close.
 */
async function recoverOrphanedSegmentFiles(
  dir: string,
  indexed: DashcamSegment[],
): Promise<DashcamSegment[]> {
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const knownUris = new Set(indexed.map((s) => s.uri));
  const names = await FileSystem.readDirectoryAsync(dir);
  const recovered: DashcamSegment[] = [];

  for (const name of names) {
    const match = /^seg_(\d+).*\.mp4$/i.exec(name);
    if (!match) continue;
    const uri = `${dir}${name}`;
    if (knownUris.has(uri)) continue;
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) continue;
      const timestamp = Number(match[1]);
      recovered.push({
        id: name.replace(/\.mp4$/i, ""),
        uri,
        startedAt: Number.isFinite(timestamp) ? timestamp : Date.now(),
        durationS: 0,
        sizeBytes: (info as any).size ?? 0,
        locked: false,
        savedForReview: true,
        uploadStatus: "none",
      });
    } catch {
      // A file can disappear between directory listing and stat; ignore it.
    }
  }
  return recovered;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const DashcamContext = createContext<DashcamContextValue | null>(null);

export function useDashcam(): DashcamContextValue {
  const ctx = useContext(DashcamContext);
  if (!ctx) throw new Error("useDashcam must be used inside DashcamProvider");
  return ctx;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function DashcamProvider({ children }: { children: React.ReactNode }) {
  // ── GPS speed — read at segment-start to tag each clip with its opening speed
  const { locationGranted, gpsLastFixAtRef } = useApp();
  const { currentSpeed } = useLiveLocation();
  const currentSpeedRef = useRef(currentSpeed);
  const locationGrantedRef = useRef(locationGranted);

  useEffect(() => { currentSpeedRef.current = currentSpeed; }, [currentSpeed]);
  useEffect(() => { locationGrantedRef.current = locationGranted; }, [locationGranted]);

  // ── Active vehicle ─────────────────────────────────────────────────────────
  const { activeVehicleId } = useVehicle();
  const vehicleKey = activeVehicleId ?? "default";

  // Kept as a ref so processUploadQueue can read the latest vehicleId without
  // needing it in the useCallback dep array (avoids restarting an in-flight
  // upload when the driver switches vehicles mid-drive).
  const activeVehicleIdRef = useRef(activeVehicleId);
  useEffect(() => { activeVehicleIdRef.current = activeVehicleId; }, [activeVehicleId]);

  const segmentsAsyncKeyRef = useRef(vehicleSegmentsKey(vehicleKey));
  const segmentsFsDirRef    = useRef(vehicleSegmentsDir(vehicleKey));

  const [isRecording, setIsRecording]             = useState(false);
  const [isDashcamOpen, setIsDashcamOpen]         = useState(false);
  const [backgroundRecordPending, setBackgroundRecordPending] = useState(false);
  const [voiceCaptureActive, setVoiceCaptureActive] = useState(false);
  const [segments, setSegments]                   = useState<DashcamSegment[]>([]);
  const [settings, setSettings]                   = useState<DashcamSettings>(DEFAULT_SETTINGS);
  const [currentSegmentDuration, setCurrentSegmentDuration] = useState(0);
  const [recordingEpoch, setRecordingEpoch]       = useState(0);
  const [hydrated, setHydrated]                   = useState(false);
  const [pushDeviceId, setPushDeviceId]           = useState<string | null>(null);
  const [cloudQuotaFull, setCloudQuotaFull]       = useState(false);
  /** True when there are saved-for-review clips waiting for the driver. */
  const [pendingTripReview, setPendingTripReview] = useState(false);

  const cloudQuotaFullRef = useRef(false);

  // ── Segment-start snapshot refs ───────────────────────────────────────────
  const recordingSegmentDirRef      = useRef(vehicleSegmentsDir(vehicleKey));
  const recordingSegmentAsyncKeyRef = useRef(vehicleSegmentsKey(vehicleKey));
  /** Speed snapped at the moment each segment begins — attached to the completed clip. */
  const segmentStartSpeedRef = useRef<number | null>(null);

  // ── Permission refs ───────────────────────────────────────────────────────
  const [cameraPermission, requestCameraPermission] = useCameraPermissions
    ? useCameraPermissions()
    : [{ granted: true } as { granted: boolean }, async () => ({ granted: true })];
  const requestCameraPermissionRef = useRef(requestCameraPermission);
  useEffect(() => { requestCameraPermissionRef.current = requestCameraPermission; }, [requestCameraPermission]);

  const [micPermission, requestMicPermission] = useMicrophonePermissions
    ? useMicrophonePermissions()
    : [{ granted: true } as { granted: boolean }, async () => ({ granted: true })];
  const requestMicPermissionRef = useRef(requestMicPermission);
  useEffect(() => { requestMicPermissionRef.current = requestMicPermission; }, [requestMicPermission]);

  // Android's expo-camera hook can retain an incorrect denial cache on some
  // OEM builds. Keep one provider-owned state sourced from PermissionsAndroid
  // instead, so every dashcam entry point sees the same real OS result.
  const [androidCameraPermission, setAndroidCameraPermission] =
    useState<AndroidCameraPermissionState>({
      granted: false,
      canAskAgain: true,
      status: "undetermined",
    });
  const [androidMicrophoneGranted, setAndroidMicrophoneGranted] = useState(false);

  const refreshDashcamCameraPermission = useCallback(async (): Promise<AndroidCameraPermissionState> => {
    if (Platform.OS === "android") {
      const next = await getAndroidCameraPermissionState();
      setAndroidCameraPermission(next);
      return next;
    }

    const nativePermission = cameraPermission as any;
    return {
      granted: nativePermission?.granted ?? false,
      canAskAgain: nativePermission?.canAskAgain !== false,
      status: nativePermission?.granted
        ? "granted"
        : nativePermission?.status === "denied"
          ? "denied"
          : "undetermined",
    };
  }, [cameraPermission]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const refreshAndroidPermissions = () => {
      refreshDashcamCameraPermission().catch(() => {});
      getAndroidMicrophonePermissionGranted()
        .then(setAndroidMicrophoneGranted)
        .catch(() => setAndroidMicrophoneGranted(false));
    };
    refreshAndroidPermissions();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshAndroidPermissions();
    });
    return () => subscription.remove();
  }, [refreshDashcamCameraPermission]);

  const cameraPermissionState: AndroidCameraPermissionState =
    Platform.OS === "android"
      ? androidCameraPermission
      : {
          granted: (cameraPermission as any)?.granted ?? false,
          canAskAgain: (cameraPermission as any)?.canAskAgain !== false,
          status: (cameraPermission as any)?.granted
            ? "granted"
            : (cameraPermission as any)?.status === "denied"
              ? "denied"
              : "undetermined",
        };
  const microphonePermissionGranted = Platform.OS === "android"
    ? androidMicrophoneGranted
    : (micPermission as any)?.granted ?? false;

  // ── Core refs ─────────────────────────────────────────────────────────────
  const cameraRef              = useRef<CameraView | null>(null);
  const lockNextRef            = useRef<string | null>(null);
  const isRecordingRef         = useRef(false);
  // Cleared by onSegmentComplete (normal path) or the 12 s safety timer in
  // stopAndSaveDashcam (fallback). Guards against double-execution.
  const pendingTripEndRef      = useRef(false);
  const voiceHandoffPendingRef = useRef(false);
  const voiceHandoffPromiseRef = useRef<Promise<boolean> | null>(null);
  const voiceHandoffResolveRef = useRef<((paused: boolean) => void) | null>(null);
  const voiceHandoffRejectRef  = useRef<((error: Error) => void) | null>(null);
  const voiceHandoffReleaseRef = useRef<Promise<void> | null>(null);
  const voiceHandoffTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceHandoffFailureRef = useRef<Error | null>(null);
  const cameraDetachResolveRef = useRef<(() => void) | null>(null);
  const restartAfterDetachRef  = useRef(false);
  const voiceCaptureLeaseRef   = useRef(false);
  const deferredDashcamStartRef = useRef(false);
  const segmentStartRef        = useRef<number>(0);
  const segmentsRef            = useRef<DashcamSegment[]>([]);
  const settingsRef            = useRef<DashcamSettings>(DEFAULT_SETTINGS);
  const uploadQueueRef         = useRef<string[]>([]);
  const uploadActiveRef        = useRef(false);
  const secretRef              = useRef<string>("");
  const hydratedRef            = useRef(false);
  const pushDeviceIdRef        = useRef<string | null>(null);
  const backgroundedWhileRecordingRef = useRef(false);
  /** True when an OS interruption requested the in-flight segment to finish. */
  const lifecycleSavePendingRef = useRef(false);
  const interruptionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const processUploadQueueRef  = useRef<() => Promise<void>>(() => Promise.resolve());
  /** ID of the 4-hour "review your clips" reminder so it can be cancelled early. */
  const reviewReminderIdRef    = useRef<string | null>(null);

  useEffect(() => { segmentsRef.current = segments; }, [segments]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { cloudQuotaFullRef.current = cloudQuotaFull; }, [cloudQuotaFull]);

  // A native camera can occasionally mount without firing either
  // onCameraReady or onMountError. Never leave Drive Mode displaying
  // "Starting…" forever: cancel the pending start and surface the full dashcam
  // screen so the driver can retry or open permission settings.
  useEffect(() => {
    if (!backgroundRecordPending) return;
    const timeout = setTimeout(() => {
      if (isRecordingRef.current) return;
      console.warn("[Dashcam] background start timed out before camera became ready");
      setBackgroundRecordPending(false);
      setIsDashcamOpen(true);
      Alert.alert(
        "Dashcam couldn't start",
        "Check camera access and make sure another app is not using the camera, then try again.",
      );
    }, 15_000);
    return () => clearTimeout(timeout);
  }, [backgroundRecordPending]);

  // ── Hydrate from AsyncStorage ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        // 1. Load or generate device secret
        let secret = await AsyncStorage.getItem(SECRET_KEY);
        if (!secret) {
          secret = generateUUID();
          await AsyncStorage.setItem(SECRET_KEY, secret);
        }
        secretRef.current = secret;

        // 2. Push device ID (shared key with usePushNotifications)
        let pid = await AsyncStorage.getItem(PUSH_DEVICE_ID_KEY);
        if (!pid) {
          pid = `${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          await AsyncStorage.setItem(PUSH_DEVICE_ID_KEY, pid);
        }
        pushDeviceIdRef.current = pid;
        setPushDeviceId(pid);

        // 3. Load settings — isolated try/catch so a corrupt value doesn't
        //    abort the rest of hydration (segments, device state).
        try {
          const rawSettings = await AsyncStorage.getItem(SETTINGS_KEY);
          if (rawSettings) {
            const s = { ...DEFAULT_SETTINGS, ...JSON.parse(rawSettings) };
            setSettings(s);
            settingsRef.current = s;
          }
        } catch {
          console.warn("[Dashcam] corrupt settings — using defaults");
        }

        // 4. Load + verify segments — also isolated so a bad cache doesn't
        //    prevent the rest of the context from becoming usable.
        let rawSegsStr: string | null = null;
        try {
          rawSegsStr = await AsyncStorage.getItem(segmentsAsyncKeyRef.current);
          if (!rawSegsStr) {
            const legacy = await AsyncStorage.getItem(LEGACY_SEGMENTS_KEY);
            if (legacy) {
              rawSegsStr = legacy;
              AsyncStorage.setItem(segmentsAsyncKeyRef.current, legacy).catch(() => {});
              AsyncStorage.removeItem(LEGACY_SEGMENTS_KEY).catch(() => {});
            }
          }
        } catch {
          console.warn("[Dashcam] error reading segments cache — starting empty");
        }

        if (rawSegsStr) {
          const loaded: DashcamSegment[] = JSON.parse(rawSegsStr);
          const verified = await Promise.all(
            loaded.map(async (s) => {
              if (s.uploadStatus === "uploaded" || s.uploadStatus === "lost") return s;
              try {
                const info = await FileSystem.getInfoAsync(s.uri);
                if (info.exists) return s;
                if (s.locked || s.savedForReview) return { ...s, uploadStatus: "lost" as const };
                return null;
              } catch {
                if (s.locked || s.savedForReview) return { ...s, uploadStatus: "lost" as const };
                return null;
              }
            })
          );
          let live = verified.filter(Boolean) as DashcamSegment[];

          // Any unlocked clips that survived from a previous session (not already
          // marked savedForReview) are leftovers from an interrupted trip.
          // Mark them as savedForReview so the driver can review them on return.
          let hadLegacyUnlocked = false;
          live = live.map((s) => {
            if (!s.locked && !s.savedForReview) {
              hadLegacyUnlocked = true;
              return { ...s, savedForReview: true };
            }
            return s;
          });

          setSegments(live);
          segmentsRef.current = live;

          if (hadLegacyUnlocked || live.some((s) => s.savedForReview)) {
            setPendingTripReview(true);
          }

          // Rebuild upload queue
          const toUpload = live
            .filter((s) =>
              s.uploadStatus === "pending" ||
              (s.uploadStatus === "failed" && (s.retryCount ?? 0) < MAX_UPLOAD_RETRIES)
            )
            .sort((a, b) => a.startedAt - b.startedAt)
            .map((s) => s.id);
          uploadQueueRef.current = toUpload;
        }

        // 5. Recover completed files whose metadata write was interrupted by a
        // process kill. This makes force-close recovery independent of React
        // effects and AsyncStorage timing.
        const recovered = await recoverOrphanedSegmentFiles(
          segmentsFsDirRef.current,
          segmentsRef.current,
        );
        if (recovered.length > 0) {
          const next = [...segmentsRef.current, ...recovered]
            .sort((a, b) => b.startedAt - a.startedAt);
          await AsyncStorage.setItem(
            segmentsAsyncKeyRef.current,
            JSON.stringify(next),
          );
          segmentsRef.current = next;
          setSegments(next);
          setPendingTripReview(true);
        }
      } catch (err) {
        console.warn("[Dashcam] hydration error:", err);
      } finally {
        hydratedRef.current = true;
        setHydrated(true);
      }
    })();
  }, []);

  // ── Persist segments on change ─────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.setItem(segmentsAsyncKeyRef.current, JSON.stringify(segments)).catch(() => {});
  }, [segments]);

  // ── Reload segments on vehicle change ─────────────────────────────────────
  const isFirstVehicleMount = useRef(true);
  useEffect(() => {
    if (isFirstVehicleMount.current) {
      isFirstVehicleMount.current = false;
      return;
    }
    segmentsAsyncKeyRef.current = vehicleSegmentsKey(vehicleKey);
    segmentsFsDirRef.current    = vehicleSegmentsDir(vehicleKey);

    (async () => {
      try {
        await FileSystem.makeDirectoryAsync(segmentsFsDirRef.current, { intermediates: true }).catch(() => {});
        const raw = await AsyncStorage.getItem(segmentsAsyncKeyRef.current);
        let loaded: DashcamSegment[] = [];
        if (raw) {
          try { loaded = JSON.parse(raw); } catch { /* corrupt cache — start empty */ }
        }
        const verified = await Promise.all(
          loaded.map(async (s) => {
            if (s.uploadStatus === "uploaded" || s.uploadStatus === "lost") return s;
            try {
              const info = await FileSystem.getInfoAsync(s.uri);
              if (info.exists) return s;
              if (s.locked || s.savedForReview) return { ...s, uploadStatus: "lost" as const };
              return null;
            } catch {
              if (s.locked || s.savedForReview) return { ...s, uploadStatus: "lost" as const };
              return null;
            }
          })
        );
        let live = verified.filter(Boolean) as DashcamSegment[];
        const recovered = await recoverOrphanedSegmentFiles(
          segmentsFsDirRef.current,
          live,
        ).catch(() => []);
        if (recovered.length > 0) {
          live = [...live, ...recovered].sort((a, b) => b.startedAt - a.startedAt);
          await AsyncStorage.setItem(segmentsAsyncKeyRef.current, JSON.stringify(live));
        }
        setSegments(live);
        segmentsRef.current = live;

        if (live.some((s) => s.savedForReview)) {
          setPendingTripReview(true);
        } else {
          setPendingTripReview(false);
        }

        const toUpload = live
          .filter((s) => s.uploadStatus === "pending" || (s.uploadStatus === "failed" && (s.retryCount ?? 0) < MAX_UPLOAD_RETRIES))
          .sort((a, b) => a.startedAt - b.startedAt)
          .map((s) => s.id);
        uploadQueueRef.current = toUpload;
        if (toUpload.length > 0) processUploadQueue();
      } catch (err) {
        console.warn("[Dashcam] vehicle-change hydration error:", err);
        // Leave state as empty — safer than an unhandled rejection
        setSegments([]);
        segmentsRef.current = [];
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleKey]);

  // ── Elapsed-time counter ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isRecording) { setCurrentSegmentDuration(0); return; }
    segmentStartRef.current = Date.now();
    const id = setInterval(() => {
      setCurrentSegmentDuration(Math.floor((Date.now() - segmentStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isRecording]);

  // ── Cross-platform interruption/background handling ───────────────────────
  // When the app backgrounds or remains inactive during a real interruption:
  //  1. Mark the last 5 unlocked clips as savedForReview (so they survive).
  //  2. Stop the current clip cleanly (no lock — the clip saves as unlocked).
  //  3. Bump recordingEpoch on foreground so the loop restarts.
  // isRecording stays true throughout — the REC pill stays on.
  //
  // Transient "inactive" events (for example a notification banner) are
  // debounced. Calls and other sustained interruptions remain inactive long
  // enough to finish the current file, while brief banners do not churn the
  // camera. The dashcam stays logically active and resumes on foreground.
  useEffect(() => {
    const preserveAndStopCurrent = async () => {
      if (!isRecordingRef.current || lifecycleSavePendingRef.current) return;
      lifecycleSavePendingRef.current = true;
      backgroundedWhileRecordingRef.current = true;

      const previous = segmentsRef.current;
      const rolling = previous
        .filter((s) => !s.locked && !s.savedForReview)
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, UNLOCKED_ROLLING_WINDOW);

      if (rolling.length > 0) {
        const reviewIds = new Set(rolling.map((s) => s.id));
        const updated = applyReviewCap(previous.map((s) =>
          reviewIds.has(s.id) ? { ...s, savedForReview: true } : s
        ));
        // Commit metadata before updating UI or deleting anything. The process
        // may be suspended immediately after this callback returns.
        try {
          await AsyncStorage.setItem(
            segmentsAsyncKeyRef.current,
            JSON.stringify(updated),
          );
          segmentsRef.current = updated;
          setSegments(updated);
          const retainedIds = new Set(updated.map((s) => s.id));
          previous
            .filter((s) => !retainedIds.has(s.id))
            .forEach((s) => FileSystem.deleteAsync(s.uri, { idempotent: true }).catch(() => {}));
        } catch (err) {
          console.warn("[Dashcam] could not commit interruption snapshot:", err);
        }
      }

      setPendingTripReview(true);
      scheduleReviewReminder();
      cameraRef.current?.stopRecording();
    };

    const subscription = AppState.addEventListener("change", (nextState) => {
      appStateRef.current = nextState;
      if (nextState === "background") {
        if (interruptionTimerRef.current) clearTimeout(interruptionTimerRef.current);
        interruptionTimerRef.current = null;
        void preserveAndStopCurrent();
      } else if (nextState === "inactive") {
        if (!isRecordingRef.current || interruptionTimerRef.current) return;
        interruptionTimerRef.current = setTimeout(() => {
          interruptionTimerRef.current = null;
          if (appStateRef.current !== "active") void preserveAndStopCurrent();
        }, 1_500);
      } else if (nextState === "active") {
        if (interruptionTimerRef.current) clearTimeout(interruptionTimerRef.current);
        interruptionTimerRef.current = null;
        lifecycleSavePendingRef.current = false;
        if (!backgroundedWhileRecordingRef.current) return;
        backgroundedWhileRecordingRef.current = false;
        setRecordingEpoch((e) => e + 1);
      }
    });

    return () => {
      subscription.remove();
      if (interruptionTimerRef.current) clearTimeout(interruptionTimerRef.current);
    };
  // The listener is intentionally registered once. It reads all mutable
  // recording/segment state from refs, and the callbacks are safe to close over
  // because they are initialized before the effect executes after commit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const storageUsedBytes = useMemo(
    () => segments.reduce((sum, s) => sum + s.sizeBytes, 0),
    [segments]
  );

  const uploadPending = useMemo(
    () => segments.filter((s) => s.uploadStatus === "pending" || s.uploadStatus === "uploading").length,
    [segments]
  );

  // ── Rolling window for unlocked clips ──────────────────────────────────────
  // Keeps at most UNLOCKED_ROLLING_WINDOW (5) truly unlocked clips — those that
  // are neither locked nor savedForReview. The oldest is deleted when a 6th is
  // added, giving a ~10-minute rolling buffer during any trip.
  const applyRollingWindow = useCallback((segs: DashcamSegment[]): DashcamSegment[] => {
    const rolling = segs.filter((s) => !s.locked && !s.savedForReview);
    if (rolling.length <= UNLOCKED_ROLLING_WINDOW) return segs;

    const sorted   = [...rolling].sort((a, b) => a.startedAt - b.startedAt);
    const toDelete = sorted.slice(0, rolling.length - UNLOCKED_ROLLING_WINDOW);
    const deleteIds = new Set(toDelete.map((s) => s.id));

    return segs.filter((s) => !deleteIds.has(s.id));
  }, []);

  // ── Review-clip cap ────────────────────────────────────────────────────────
  // Keeps at most MAX_REVIEW_CLIPS (10 = 5 per trip × 2 trips) savedForReview
  // clips. Called after every trip-end savedForReview pass so old trips' review
  // clips are evicted automatically, giving a rolling 2-trip buffer.
  const applyReviewCap = useCallback((segs: DashcamSegment[]): DashcamSegment[] => {
    const review = segs.filter((s) => s.savedForReview);
    if (review.length <= MAX_REVIEW_CLIPS) return segs;

    const sorted   = [...review].sort((a, b) => a.startedAt - b.startedAt);
    const toDelete = sorted.slice(0, review.length - MAX_REVIEW_CLIPS);
    const deleteIds = new Set(toDelete.map((s) => s.id));

    return segs.filter((s) => !deleteIds.has(s.id));
  }, []);

  // ── Upload queue processor ─────────────────────────────────────────────────
  const processUploadQueue = useCallback(async () => {
    if (uploadActiveRef.current) return;
    if (uploadQueueRef.current.length === 0) return;
    if (!pushDeviceIdRef.current || !secretRef.current || !API_BASE) return;

    if (settingsRef.current.wifiOnlyUpload) {
      const net = await NetInfo.fetch();
      if (net.type !== "wifi") return;
    } else {
      const net = await NetInfo.fetch();
      if (!net.isConnected) return;
    }

    uploadActiveRef.current = true;

    while (uploadQueueRef.current.length > 0) {
      const segId = uploadQueueRef.current[0];
      const seg   = segmentsRef.current.find((s) => s.id === segId);

      if (!seg) { uploadQueueRef.current.shift(); continue; }

      if (seg.uploadStatus !== "uploaded") {
        try {
          const fileInfo = await FileSystem.getInfoAsync(seg.uri);
          if (!fileInfo.exists) {
            uploadQueueRef.current.shift();
            setSegments((prev) =>
              prev.map((s) => s.id === segId ? { ...s, uploadStatus: "lost" as const } : s)
            );
            console.warn("[Dashcam] clip missing before upload — marked lost:", segId);
            continue;
          }
        } catch {
          uploadQueueRef.current.shift();
          setSegments((prev) =>
            prev.map((s) => s.id === segId ? { ...s, uploadStatus: "lost" as const } : s)
          );
          console.warn("[Dashcam] could not stat clip — marked lost:", segId);
          continue;
        }
      }

      try {
        setSegments((prev) =>
          prev.map((s) => s.id === segId ? { ...s, uploadStatus: "uploading" as const } : s)
        );

        const headers = authHeaders(pushDeviceIdRef.current!, secretRef.current);

        // 1. Get presigned upload URL
        const urlRes = await fetch(`${API_BASE}/dashcam/upload-url`, {
          method: "POST",
          headers,
          body: JSON.stringify({ lockReason: seg.lockReason ?? "manual" }),
        });
        if (!urlRes.ok) {
          if (urlRes.status === 429) {
            const body = await urlRes.json().catch(() => ({})) as { error?: string; code?: string };
            if (body?.code === "QUOTA_FULL" || body?.error?.toLowerCase().includes("quota")) {
              cloudQuotaFullRef.current = true;
              setCloudQuotaFull(true);
              Notifications.scheduleNotificationAsync({
                content: {
                  title: "Cloud storage full",
                  body: "Delete old clips in the dashcam gallery to continue backing up.",
                  data: { type: "dashcam_quota_full" },
                },
                trigger: null,
              }).catch(() => {});
              setSegments((prev) => {
                const next = prev.map((s) => {
                  if (
                    s.uploadStatus === "pending" ||
                    s.uploadStatus === "uploading" ||
                    (s.uploadStatus === "failed" && (s.retryCount ?? 0) < MAX_UPLOAD_RETRIES)
                  ) {
                    return { ...s, uploadStatus: "failed" as const, retryCount: MAX_UPLOAD_RETRIES };
                  }
                  return s;
                });
                segmentsRef.current = next;
                return next;
              });
              uploadQueueRef.current = [];
              break;
            }
          }
          throw new Error(`Upload URL: ${urlRes.status}`);
        }
        const { uploadUrl, fileKey, clipId } = (await urlRes.json()) as {
          uploadUrl: string; fileKey: string; clipId: string;
        };

        // 2. Upload to R2
        const fileRes = await fetch(seg.uri);
        const blob    = await fileRes.blob();
        const putRes  = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "video/mp4" },
          body: blob,
        });
        if (!putRes.ok) throw new Error(`R2 PUT: ${putRes.status}`);

        // 3. Save clip metadata
        const metaRes = await fetch(`${API_BASE}/dashcam/clip`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            clipId,
            fileKey,
            durationS:  seg.durationS,
            sizeBytes:  seg.sizeBytes,
            lockReason: seg.lockReason,
            startedAt:  new Date(seg.startedAt).toISOString(),
            lat:        seg.lat ?? null,
            lng:        seg.lng ?? null,
            speedKmh:   seg.speedKmh ?? null,
            vehicleId:  activeVehicleIdRef.current ?? null,
          }),
        });
        if (!metaRes.ok) throw new Error(`Metadata: ${metaRes.status}`);
        const { id: serverId } = (await metaRes.json()) as { id: string };

        setSegments((prev) =>
          prev.map((s) =>
            s.id === segId
              ? { ...s, uploadStatus: "uploaded" as const, fileKey, serverId, retryCount: 0 }
              : s
          )
        );
        setCloudQuotaFull(false);
        uploadQueueRef.current.shift();
      } catch (err) {
        console.warn("[Dashcam] upload failed for", segId, err);
        uploadQueueRef.current.shift();

        const nextRetryCount = (seg.retryCount ?? 0) + 1;

        if (nextRetryCount > MAX_UPLOAD_RETRIES) {
          setSegments((prev) =>
            prev.map((s) =>
              s.id === segId
                ? { ...s, uploadStatus: "failed" as const, retryCount: nextRetryCount }
                : s
            )
          );
        } else {
          setSegments((prev) =>
            prev.map((s) =>
              s.id === segId
                ? { ...s, uploadStatus: "failed" as const, retryCount: nextRetryCount }
                : s
            )
          );
          const delay = UPLOAD_RETRY_BACKOFF[nextRetryCount - 1] ?? UPLOAD_RETRY_BACKOFF.at(-1)!;
          setTimeout(() => {
            const current = segmentsRef.current.find((s) => s.id === segId);
            if (current?.uploadStatus === "failed") {
              uploadQueueRef.current.push(segId);
              processUploadQueueRef.current();
            }
          }, delay);
        }
      }
    }

    uploadActiveRef.current = false;
  }, [pushDeviceId]);

  useEffect(() => {
    processUploadQueueRef.current = processUploadQueue;
  }, [processUploadQueue]);

  // ── Retry on connectivity restore ──────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (!hydratedRef.current) return;
      const wifiOnly    = settingsRef.current.wifiOnlyUpload;
      const isWifi      = state.type === "wifi";
      const isConnected = !!state.isConnected;

      if (isConnected && (!wifiOnly || isWifi)) {
        const inQueue = new Set(uploadQueueRef.current);
        const failedIds = segmentsRef.current
          .filter((s) =>
            s.uploadStatus === "failed" &&
            !inQueue.has(s.id) &&
            (s.retryCount ?? 0) < MAX_UPLOAD_RETRIES
          )
          .sort((a, b) => a.startedAt - b.startedAt)
          .map((s) => s.id);
        if (failedIds.length > 0) {
          uploadQueueRef.current = [...uploadQueueRef.current, ...failedIds];
        }
        processUploadQueueRef.current();
      }
    });
    return () => unsubscribe();
  }, []);

  // ── Auto-enrollment ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hydrated || !pushDeviceId || !API_BASE) return;
    const secret = secretRef.current;
    if (!secret) return;

    let cancelled = false;
    const ENROLL_BACKOFF = [5_000, 15_000, 30_000, 60_000];

    const attempt = async (tryIndex: number) => {
      if (cancelled) return;
      try {
        const res = await fetch(`${API_BASE}/dashcam/register`, {
          method: "POST",
          headers: authHeaders(pushDeviceId, secret),
        });
        if (res.ok) {
          processUploadQueueRef.current();
          return;
        }
        if (res.status === 409) {
          console.warn("[Dashcam] enrollment conflict: device registered with a different secret");
          return;
        }
        const delay = ENROLL_BACKOFF[tryIndex] ?? ENROLL_BACKOFF.at(-1)!;
        setTimeout(() => attempt(tryIndex + 1), delay);
      } catch (err) {
        const delay = ENROLL_BACKOFF[tryIndex] ?? ENROLL_BACKOFF.at(-1)!;
        setTimeout(() => attempt(tryIndex + 1), delay);
      }
    };

    attempt(0);
    return () => { cancelled = true; };
  }, [hydrated, pushDeviceId]);

  // ─── Public API ─────────────────────────────────────────────────────────────

  const openDashcam = useCallback(() => {
    if (voiceCaptureLeaseRef.current || voiceHandoffPendingRef.current) return;
    setIsDashcamOpen(true);
  }, []);
  const closeDashcam = useCallback(() => setIsDashcamOpen(false), []);

  const requestDashcamPermissions = useCallback(async (
    options: { requestCamera?: boolean; requestMicrophone?: boolean } = {},
  ): Promise<{ cameraGranted: boolean; micGranted: boolean }> => {
    if (Platform.OS === "android") {
      let cameraGranted = (await refreshDashcamCameraPermission()).granted;
      let micGranted = await getAndroidMicrophonePermissionGranted().catch(() => false);
      setAndroidMicrophoneGranted(micGranted);

      if (options.requestCamera !== false && !cameraGranted) {
        const next = await requestAndroidCameraPermission().catch(() => null);
        if (next) {
          setAndroidCameraPermission(next);
          cameraGranted = next.granted;
        }
      }

      if (options.requestMicrophone !== false && !micGranted) {
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
        micGranted = await requestAndroidMicrophonePermission().catch(() => false);
        setAndroidMicrophoneGranted(micGranted);
      }

      return { cameraGranted, micGranted };
    }

    let cameraGranted = cameraPermission?.granted ?? false;
    let micGranted    = micPermission?.granted    ?? false;

    if (!cameraGranted) {
      try {
        const res = await requestCameraPermissionRef.current();
        cameraGranted = res?.granted ?? false;
      } catch { cameraGranted = false; }
    }

    if (!micGranted) {
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      try {
        const res = await requestMicPermissionRef.current();
        micGranted = res?.granted ?? false;
      } catch { micGranted = false; }
    }

    return { cameraGranted, micGranted };
  }, [cameraPermission?.granted, micPermission?.granted, refreshDashcamCameraPermission]);

  const startBackgroundRecording = useCallback(async (): Promise<boolean> => {
    if (voiceCaptureLeaseRef.current || voiceHandoffPendingRef.current) {
      deferredDashcamStartRef.current = true;
      return false;
    }
    if (isRecordingRef.current) return true;

    // Recording startup only consumes an existing camera grant. Permission
    // prompts belong to Start Driving, the checklist, or an explicit Dashcam
    // button — never to an automatic transition on the Drive screen.
    const cameraState = await refreshDashcamCameraPermission().catch(() => null);
    if (!cameraState?.granted) return false;

    setBackgroundRecordPending(true);
    return true;
  }, [refreshDashcamCameraPermission]);

  const finishVoiceHandoffPause = useCallback(async (): Promise<void> => {
    if (!voiceHandoffPendingRef.current) return;
    if (voiceHandoffReleaseRef.current) return voiceHandoffReleaseRef.current;

    const release = (async () => {
      if (voiceHandoffTimerRef.current) clearTimeout(voiceHandoffTimerRef.current);
      voiceHandoffTimerRef.current = null;

      // Force the overlay and CameraView to unmount. A state update alone is
      // not an ownership acknowledgement, so wait for setCameraRef(null).
      setBackgroundRecordPending(false);
      setIsDashcamOpen(false);
      setIsRecording(false);
      if (cameraRef.current) {
        await new Promise<void>((resolve, reject) => {
          cameraDetachResolveRef.current = resolve;
          setTimeout(() => {
            if (cameraDetachResolveRef.current !== resolve) return;
            cameraDetachResolveRef.current = null;
            reject(new Error("Dashcam camera did not release the microphone."));
          }, 5_000);
        });
      }

      // This is the canonical navigation/TTS baseline and must complete before
      // the Road Channels recorder is allowed to configure PlayAndRecord.
      await setDashcamAudioMode(false);
      voiceHandoffPendingRef.current = false;
      const handoffFailure = voiceHandoffFailureRef.current;
      if (handoffFailure) {
        voiceHandoffRejectRef.current?.(handoffFailure);
        // Camera detach and audio release were acknowledged, so restarting is
        // now safe. Voice capture will not begin.
        setTimeout(() => { void startBackgroundRecording(); }, 250);
      } else {
        voiceCaptureLeaseRef.current = true;
        setVoiceCaptureActive(true);
        voiceHandoffResolveRef.current?.(true);
      }
    })().catch((error: unknown) => {
      voiceHandoffPendingRef.current = false;
      const message = error instanceof Error ? error : new Error("Could not safely pause the dashcam.");
      voiceHandoffRejectRef.current?.(message);
      // Voice capture fails closed. If the CameraView later acknowledges
      // detachment, setCameraRef(null) will safely restart the dashcam.
      restartAfterDetachRef.current = cameraRef.current != null;
      if (!cameraRef.current) setTimeout(() => { void startBackgroundRecording(); }, 250);
    }).finally(() => {
      voiceHandoffResolveRef.current = null;
      voiceHandoffRejectRef.current = null;
      voiceHandoffPromiseRef.current = null;
      voiceHandoffReleaseRef.current = null;
      voiceHandoffFailureRef.current = null;
    });
    voiceHandoffReleaseRef.current = release;
    return release;
  }, [startBackgroundRecording]);

  const pauseForVoiceReport = useCallback(async (): Promise<boolean> => {
    if (voiceCaptureLeaseRef.current) {
      throw new Error("Road Channels already owns the microphone.");
    }
    if (!isRecordingRef.current && !backgroundRecordPending) {
      voiceCaptureLeaseRef.current = true;
      setVoiceCaptureActive(true);
      return false;
    }
    if (voiceHandoffPromiseRef.current) return voiceHandoffPromiseRef.current;

    voiceHandoffPendingRef.current = true;
    voiceHandoffFailureRef.current = null;
    const pending = new Promise<boolean>((resolve, reject) => {
      voiceHandoffResolveRef.current = resolve;
      voiceHandoffRejectRef.current = reject;
    });
    voiceHandoffPromiseRef.current = pending;

    const hadActiveSegment = isRecordingRef.current;
    // Prevent onCameraReady and the record loop from starting another segment.
    isRecordingRef.current = false;
    setBackgroundRecordPending(false);
    setIsDashcamOpen(false);
    if (hadActiveSegment) cameraRef.current?.stopRecording();

    if (hadActiveSegment) {
      // Normal completion saves the segment and calls finish. Null/failed
      // completion must NOT grant microphone ownership. Fail the voice request
      // after six seconds but retain handoff classification while the camera
      // finishes. A longer safety valve may detach/restart the dashcam, but
      // voice capture remains cancelled.
      voiceHandoffTimerRef.current = setTimeout(() => {
        const timeoutError = new Error(
          "The dashcam is taking too long to save its current segment. Road Channels recording was cancelled.",
        );
        voiceHandoffFailureRef.current = timeoutError;
        voiceHandoffRejectRef.current?.(timeoutError);
        voiceHandoffResolveRef.current = null;
        voiceHandoffRejectRef.current = null;
        voiceHandoffPromiseRef.current = null;
        voiceHandoffTimerRef.current = setTimeout(() => {
          void finishVoiceHandoffPause();
        }, 14_000);
      }, 6_000);
    } else {
      // A pending CameraView start has no segment to save.
      void finishVoiceHandoffPause();
    }
    return pending;
  }, [backgroundRecordPending, finishVoiceHandoffPause]);

  const resumeAfterVoiceReport = useCallback(async (shouldResume: boolean): Promise<void> => {
    voiceCaptureLeaseRef.current = false;
    setVoiceCaptureActive(false);
    const restart = shouldResume || deferredDashcamStartRef.current;
    deferredDashcamStartRef.current = false;
    if (restart && !isRecordingRef.current) await startBackgroundRecording();
  }, [startBackgroundRecording]);

  const clearBackgroundRecordPending = useCallback(() => {
    setBackgroundRecordPending(false);
  }, []);

  const startDashcam = useCallback(() => {
    isRecordingRef.current  = true;
    segmentStartRef.current = Date.now();
    setIsRecording(true);
  }, []);

  const stopDashcam = useCallback(() => {
    console.log("[Dashcam] stopDashcam() called");
    isRecordingRef.current = false;
    setIsRecording(false);
    setBackgroundRecordPending(false);
    cameraRef.current?.stopRecording();
  }, []);

  // ── Review-reminder notification helpers ─────────────────────────────────
  // Schedules a local notification ~4 hours after clips are saved for review,
  // in case the driver leaves the app without locking anything. Cancelled the
  // moment the driver locks or dismisses all review clips.

  const scheduleReviewReminder = useCallback(async () => {
    // Cancel any stale reminder first (e.g. back-to-back trips)
    if (reviewReminderIdRef.current) {
      Notifications.cancelScheduledNotificationAsync(reviewReminderIdRef.current).catch(() => {});
      reviewReminderIdRef.current = null;
    }
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: "Review your dashcam clips",
          body: "Your last trip's footage is saved and waiting. Tap to lock the clips you want to keep before they're gone.",
          data: { type: "dashcam_review_reminder" },
        },
        trigger: { seconds: 4 * 60 * 60, repeats: false } as any,
      });
      reviewReminderIdRef.current = id;
    } catch {
      // Non-critical — scheduling failures are silently ignored
    }
  }, []);

  const cancelReviewReminder = useCallback(() => {
    if (!reviewReminderIdRef.current) return;
    Notifications.cancelScheduledNotificationAsync(reviewReminderIdRef.current).catch(() => {});
    reviewReminderIdRef.current = null;
  }, []);

  /**
   * Stop recording without auto-locking the final clip.
   * The last 5 unlocked clips are marked savedForReview in onSegmentComplete
   * so the driver can review them and lock what they care about.
   *
   * IMPORTANT — race-condition fix: setIsRecording(false) is NOT called here.
   * It is deferred to onSegmentComplete (same pattern as before) to keep
   * CameraView mounted until the final clip is safely on disk.
   */
  const stopAndSaveDashcam = useCallback(() => {
    if (!isRecordingRef.current) return;
    console.log("[Dashcam] stopAndSaveDashcam() called");
    isRecordingRef.current    = false; // signals trip-end to onSegmentComplete
    pendingTripEndRef.current = true;  // safety timer clears this if onSegmentComplete doesn't
    setBackgroundRecordPending(false);
    cameraRef.current?.stopRecording();

    // Safety valve: if stopRecording() returns a null result (common when the
    // clip was still short or the audio session was interrupted), the recording
    // loop's null-stall counter ticks up and the loop keeps restarting without
    // ever calling onSegmentComplete — so setIsRecording(false) is never called,
    // the overlay stays on-screen indefinitely, and clips are never marked
    // savedForReview.  After 12 s we force both so the post-trip review card
    // always appears and the dashcam overlay always unmounts.
    setTimeout(() => {
      if (!pendingTripEndRef.current) return; // onSegmentComplete already handled it
      pendingTripEndRef.current = false;
      console.log("[Dashcam] force-stop safety timer fired — marking clips for review");

      const rolling = segmentsRef.current
        .filter((s) => !s.locked && !s.savedForReview)
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, UNLOCKED_ROLLING_WINDOW);
      if (rolling.length > 0) {
        const reviewIds = new Set(rolling.map((s) => s.id));
        const updated   = applyReviewCap(
          segmentsRef.current.map((s) =>
            reviewIds.has(s.id) ? { ...s, savedForReview: true } : s
          )
        );
        segmentsRef.current = updated;
        setSegments(updated);
        AsyncStorage.setItem(segmentsAsyncKeyRef.current, JSON.stringify(updated)).catch(() => {});
        setPendingTripReview(true);
        scheduleReviewReminder();
      }
      setIsRecording(false);
    }, 12_000);
  }, [applyReviewCap, scheduleReviewReminder]);

  /**
   * Lock the currently recording clip.
   * Enforces local limits:
   *  • manual → max 5 on device (alerts user if full)
   *  • auto   → max 20 on device (silently dropped if full)
   */
  const lockCurrentClip = useCallback((reason = "manual") => {
    const isManual = reason === "manual";

    if (isManual) {
      const manualCount = segmentsRef.current.filter(
        (s) => s.locked && s.lockType === "manual"
      ).length;
      if (manualCount >= MAX_MANUAL_LOCKS_LOCAL) {
        Alert.alert(
          "Manual Lock Limit",
          "You already have 5 manually locked clips. Delete an older one to save a new clip.",
        );
        return;
      }
    } else {
      const autoCount = segmentsRef.current.filter(
        (s) => s.locked && s.lockType === "auto"
      ).length;
      if (autoCount >= MAX_AUTO_LOCKS_LOCAL) {
        // Auto-lock silently dropped — don't interrupt the driver with a dialog
        console.warn("[Dashcam] auto-lock limit (20) reached, clip not locked");
        return;
      }
    }

    lockNextRef.current = reason;
    cameraRef.current?.stopRecording();
  }, []);

  /**
   * Lock any completed local clip from the gallery and queue it for cloud upload.
   * This must not use lockCurrentClip: that function stops the active camera
   * recording and has no effect on a completed segment.
   */
  const lockSegment = useCallback((id: string) => {
    const seg = segmentsRef.current.find((s) => s.id === id && !s.locked);
    if (!seg) return;

    const manualCount = segmentsRef.current.filter(
      (s) => s.locked && s.lockType === "manual"
    ).length;
    if (manualCount >= MAX_MANUAL_LOCKS_LOCAL) {
      Alert.alert(
        "Manual Lock Limit",
        "You already have 5 manually locked clips. Delete an older one to save a new clip.",
      );
      return;
    }

    setSegments((prev) => {
      const next = prev.map((s) =>
        s.id === id
          ? {
              ...s,
              locked: true,
              lockType: "manual" as const,
              lockReason: "manual",
              savedForReview: false,
              uploadStatus: "pending" as const,
            }
          : s
      );
      segmentsRef.current = next;
      return next;
    });

    // If no review clips remain the driver has handled everything — cancel the reminder
    if (!segmentsRef.current.some((s) => s.savedForReview)) {
      cancelReviewReminder();
    }

    uploadQueueRef.current.push(id);
    processUploadQueueRef.current();
  }, [cancelReviewReminder]);

  /**
   * Backwards-compatible review-card action. The gallery uses lockSegment so
   * completed rolling clips can also be protected before they are evicted.
   */
  const lockSavedClip = useCallback((id: string) => {
    const seg = segmentsRef.current.find((s) => s.id === id && s.savedForReview);
    if (!seg) return;
    lockSegment(id);
  }, [lockSegment]);

  /**
   * Delete all saved-for-review clips and clear the review banner.
   * Called when the driver dismisses the review without locking anything.
   */
  const dismissTripReview = useCallback(async () => {
    const toDelete = segmentsRef.current.filter((s) => s.savedForReview && !s.locked);
    // allSettled instead of all — a single file-deletion failure must NOT abort
    // the state update; the UI should clear even if a clip's file is already gone.
    await Promise.allSettled(
      toDelete.map((s) => FileSystem.deleteAsync(s.uri, { idempotent: true }))
    );
    const deleteIds = new Set(toDelete.map((s) => s.id));
    setSegments((prev) => {
      const next = prev.filter((s) => !deleteIds.has(s.id));
      segmentsRef.current = next;
      return next;
    });
    // Driver has resolved all clips — no need to remind them
    cancelReviewReminder();
    setPendingTripReview(false);
  }, [cancelReviewReminder]);

  const setCameraRef = useCallback((ref: CameraView | null) => {
    cameraRef.current = ref;
    if (!ref && cameraDetachResolveRef.current) {
      const resolve = cameraDetachResolveRef.current;
      cameraDetachResolveRef.current = null;
      resolve();
    }
    if (!ref && restartAfterDetachRef.current) {
      restartAfterDetachRef.current = false;
      setTimeout(() => { void startBackgroundRecording(); }, 250);
    }
  }, [startBackgroundRecording]);

  const onSegmentStart = useCallback(() => {
    recordingSegmentDirRef.current      = segmentsFsDirRef.current;
    recordingSegmentAsyncKeyRef.current = segmentsAsyncKeyRef.current;
    // Only store the speed when there is a valid, recent GPS fix:
    //  • locationGranted     — the OS is actively supplying position updates
    //  • speed > 0           — at least one real moving fix has been received
    //  • gpsLastFixAt < 10 s — a GPS fix was accepted within the freshness window
    //
    // gpsLastFixAtRef is stamped on every accepted handleLocation invocation in
    // AppContext — not rate-limited like setCurrentSpeed — so it reliably detects
    // a stalled GPS feed regardless of whether the displayed speed integer changed.
    // Any condition failing means we have no trustworthy reading; store null so
    // the watermark / player label is omitted rather than showing a misleading value.
    const speed = currentSpeedRef.current;
    const hasRecentFix =
      locationGrantedRef.current &&
      speed > 0 &&
      Date.now() - gpsLastFixAtRef.current < 10_000;
    segmentStartSpeedRef.current = hasRecentFix ? speed : null;
  }, [gpsLastFixAtRef]);

  const onSegmentComplete = useCallback(
    async (tempUri: string, durationS?: number, coords?: { lat: number; lng: number }) => {
      const lockReason = lockNextRef.current;
      lockNextRef.current = null;

      segmentStartRef.current = Date.now();
      setCurrentSegmentDuration(0);

      const id = `seg_${Date.now()}`;

      const capturedDir      = recordingSegmentDirRef.current;
      const capturedAsyncKey = recordingSegmentAsyncKeyRef.current;
      const destUri          = computeSegmentDestUri(capturedDir, id);

      const vehicleSwitchedMidSegment = detectVehicleSwitch(capturedAsyncKey, segmentsAsyncKeyRef.current);

      try {
        await FileSystem.makeDirectoryAsync(capturedDir, { intermediates: true });
        // moveAsync is preferred (faster, atomic) but can fail when the source
        // is on a different volume or has already been partially evicted by iOS
        // under memory pressure.  Fall back to copyAsync + delete so the clip
        // is never silently lost due to a cross-volume move restriction.
        try {
          await FileSystem.moveAsync({ from: tempUri, to: destUri });
        } catch {
          await FileSystem.copyAsync({ from: tempUri, to: destUri });
          FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
        }
        const info      = await FileSystem.getInfoAsync(destUri);
        const sizeBytes = (info as any).size ?? 0;

        const capturedSpeedKmh = segmentStartSpeedRef.current;
        segmentStartSpeedRef.current = null;

        const base = buildDashcamSegment({
          id, destUri, durationS: durationS ?? 120, sizeBytes,
          lockReason: lockReason ?? null, coords,
        });
        const segment: DashcamSegment = {
          ...base,
          lockType: lockReason
            ? (lockReason === "manual" ? "manual" : "auto")
            : undefined,
          ...(capturedSpeedKmh != null
            ? { speedKmh: Math.round(capturedSpeedKmh) }
            : {}),
        } as DashcamSegment;

        if (vehicleSwitchedMidSegment) {
          try {
            const existing = await AsyncStorage.getItem(capturedAsyncKey);
            const prev: DashcamSegment[] = existing ? JSON.parse(existing) : [];
            await AsyncStorage.setItem(capturedAsyncKey, JSON.stringify([...prev, segment]));
            if (voiceHandoffPendingRef.current) {
              // The segment still belongs to the vehicle active when capture
              // began, but a vehicle switch must not strand the microphone
              // handoff after that segment has been safely persisted.
              await finishVoiceHandoffPause();
            }
          } catch (storageErr) {
            console.warn("[Dashcam] failed to persist mid-switch segment:", storageErr);
            if (voiceHandoffPendingRef.current) {
              voiceHandoffFailureRef.current = new Error(
                "The current dashcam segment could not be saved, so Road Channels recording was cancelled.",
              );
              await finishVoiceHandoffPause();
            }
          }
        } else {
          // Determine whether recording was stopped (trip end)
          const voiceHandoff = voiceHandoffPendingRef.current;
          const tripEnded = !isRecordingRef.current && !voiceHandoff;
          const lifecycleSave = lifecycleSavePendingRef.current;
          const previous = segmentsRef.current;
          let next = applyRollingWindow([...previous, segment]);

          // Trip-end and OS-interruption completions both preserve the newest
          // five local clips for review. This includes the segment that just
          // finished, rather than only the clips that existed before stopping.
          if (tripEnded || lifecycleSave) {
            const rolling = next
              .filter((s) => !s.locked && !s.savedForReview)
              .sort((a, b) => b.startedAt - a.startedAt)
              .slice(0, UNLOCKED_ROLLING_WINDOW);
            const reviewIds = new Set(rolling.map((s) => s.id));
            next = applyReviewCap(next.map((s) =>
              reviewIds.has(s.id) ? { ...s, savedForReview: true } : s
            ));
          }

          // Durability boundary: the file is already in documentDirectory.
          // Persist the complete replacement index before exposing it in state
          // or deleting clips evicted from the rolling window.
          await AsyncStorage.setItem(capturedAsyncKey, JSON.stringify(next));
          segmentsRef.current = next;
          setSegments(next);
          const retainedIds = new Set(next.map((s) => s.id));
          previous
            .filter((s) => !retainedIds.has(s.id))
            .forEach((s) => FileSystem.deleteAsync(s.uri, { idempotent: true }).catch(() => {}));

          // Queue locked clips for upload
          if (lockReason) {
            uploadQueueRef.current.push(id);
            processUploadQueue();
          }

          // Trip ended → persist saved-for-review segments immediately (don't
          // rely solely on the async setSegments effect — a kill-between-render
          // would lose the savedForReview flags and the review banner would not
          // re-appear on the next cold start).
          if (tripEnded) {
            pendingTripEndRef.current = false; // safety timer no longer needed
            setPendingTripReview(true);
            scheduleReviewReminder();
            setIsRecording(false);
          } else if (lifecycleSave) {
            lifecycleSavePendingRef.current = false;
            setPendingTripReview(true);
            scheduleReviewReminder();
          } else if (voiceHandoff) {
            // The segment was saved as an ordinary rolling clip. Do not mark
            // the trip ended or create a review reminder for this short pause.
            finishVoiceHandoffPause();
          }
        }

      } catch (err) {
        console.warn("[Dashcam] onSegmentComplete error — clip NOT saved:", err);
        if (lockReason === "manual") {
          const { Alert: RNAlert } = require("react-native");
          RNAlert.alert(
            "Clip Could Not Be Saved",
            "There was a problem saving this dashcam clip. Check that you have enough storage space.",
          );
        }
        // Still complete the deferred stop if trip ended
        if (voiceHandoffPendingRef.current) {
          voiceHandoffFailureRef.current = new Error(
            "The current dashcam segment could not be saved, so Road Channels recording was cancelled.",
          );
          finishVoiceHandoffPause();
        } else if (!isRecordingRef.current) {
          pendingTripEndRef.current = false; // safety timer no longer needed
          AsyncStorage.setItem(
            capturedAsyncKey,
            JSON.stringify(segmentsRef.current),
          ).catch(() => {});
          setPendingTripReview(true);
          scheduleReviewReminder();
          setIsRecording(false);
        }
      }
    },
    [applyReviewCap, applyRollingWindow, finishVoiceHandoffPause, processUploadQueue, scheduleReviewReminder]
  );

  const deleteSegment = useCallback(
    async (id: string) => {
      const seg = segmentsRef.current.find((s) => s.id === id);
      if (!seg) return;

      await FileSystem.deleteAsync(seg.uri, { idempotent: true });

      if (seg.serverId && pushDeviceIdRef.current && secretRef.current && API_BASE) {
        fetch(`${API_BASE}/dashcam/clip/${seg.serverId}`, {
          method: "DELETE",
          headers: {
            "X-Device-Id":      pushDeviceIdRef.current,
            "X-Dashcam-Secret": secretRef.current,
          },
        }).catch((err) => console.warn("[Dashcam] server delete failed:", err));
      }

      setSegments((prev) => {
        const next = prev.filter((s) => s.id !== id);
        segmentsRef.current = next;
        return next;
      });
      uploadQueueRef.current = uploadQueueRef.current.filter((qId) => qId !== id);

      if (seg.serverId) {
        cloudQuotaFullRef.current = false;
        setCloudQuotaFull(false);
      }
    },
    [pushDeviceId]
  );

  const clearCloudQuotaFull = useCallback(() => {
    cloudQuotaFullRef.current = false;
    setCloudQuotaFull(false);
  }, []);

  /**
   * Delete all live unlocked clips (does NOT touch savedForReview or locked clips).
   */
  const clearUnlocked = useCallback(async () => {
    const unlocked = segmentsRef.current.filter((s) => !s.locked && !s.savedForReview);
    await Promise.all(
      unlocked.map((s) => FileSystem.deleteAsync(s.uri, { idempotent: true }))
    );
    const unlockedIds = new Set(unlocked.map((s) => s.id));
    setSegments((prev) => {
      const next = prev.filter((s) => !unlockedIds.has(s.id));
      segmentsRef.current = next;
      return next;
    });
    uploadQueueRef.current = uploadQueueRef.current.filter(
      (id) => !unlockedIds.has(id)
    );
  }, []);

  const updateSettings = useCallback(async (partial: Partial<DashcamSettings>) => {
    const next = { ...settingsRef.current, ...partial };
    settingsRef.current = next;
    setSettings(next);
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }, []);

  /**
   * Pin a cloud clip — extends its cloud retention to 60 days.
   * Enforced server-side (max 5 pins per device).
   */
  const pinSegment = useCallback(async (id: string) => {
    const seg = segmentsRef.current.find((s) => s.id === id);
    if (!seg?.serverId || !pushDeviceIdRef.current || !secretRef.current || !API_BASE) return;

    try {
      const res = await fetch(`${API_BASE}/dashcam/clip/${seg.serverId}/pin`, {
        method: "POST",
        headers: authHeaders(pushDeviceIdRef.current, secretRef.current),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { code?: string; error?: string };
        if (body.code === "PIN_LIMIT") {
          Alert.alert("Pin Limit Reached", "You can only pin 5 clips. Unpin a clip to pin this one.");
          return;
        }
        throw new Error(`Pin failed: ${res.status}`);
      }
      setSegments((prev) => {
        const next = prev.map((s) => s.id === id ? { ...s, pinned: true } : s);
        segmentsRef.current = next;
        return next;
      });
    } catch (err) {
      console.warn("[Dashcam] pin failed:", err);
      Alert.alert("Error", "Could not pin this clip. Try again.");
    }
  }, [pushDeviceId]);

  /**
   * Unpin a cloud clip — restores the standard 30-day / 24-hour retention.
   */
  const unpinSegment = useCallback(async (id: string) => {
    const seg = segmentsRef.current.find((s) => s.id === id);
    if (!seg?.serverId || !pushDeviceIdRef.current || !secretRef.current || !API_BASE) return;

    try {
      const res = await fetch(`${API_BASE}/dashcam/clip/${seg.serverId}/pin`, {
        method: "DELETE",
        headers: authHeaders(pushDeviceIdRef.current, secretRef.current),
      });
      if (!res.ok) throw new Error(`Unpin failed: ${res.status}`);
      setSegments((prev) => {
        const next = prev.map((s) => s.id === id ? { ...s, pinned: false } : s);
        segmentsRef.current = next;
        return next;
      });
    } catch (err) {
      console.warn("[Dashcam] unpin failed:", err);
      Alert.alert("Error", "Could not unpin this clip.");
    }
  }, [pushDeviceId]);

  const bumpRecordingEpoch = useCallback(() => setRecordingEpoch((e) => e + 1), []);

  const value = useMemo<DashcamContextValue>(
    () => ({
      isRecording, isRecordingRef, voiceHandoffActiveRef: voiceHandoffPendingRef, voiceCaptureActive,
      isDashcamOpen, backgroundRecordPending, segments, storageUsedBytes,
      currentSegmentDuration, uploadPending, settings, cameraPermissionState, microphonePermissionGranted,
      pushDeviceId, recordingEpoch, cloudQuotaFull, pendingTripReview,
      openDashcam, closeDashcam, startDashcam, stopDashcam, stopAndSaveDashcam,
      startBackgroundRecording, pauseForVoiceReport, resumeAfterVoiceReport,
      requestDashcamPermissions, refreshDashcamCameraPermission, clearBackgroundRecordPending,
      lockCurrentClip, lockSavedClip, lockSegment, dismissTripReview,
      deleteSegment, clearUnlocked, updateSettings,
      clearCloudQuotaFull, pinSegment, unpinSegment,
      bumpRecordingEpoch,
      setCameraRef, onSegmentStart, onSegmentComplete,
    }),
    [
      isRecording, voiceCaptureActive, isDashcamOpen, backgroundRecordPending, segments, storageUsedBytes,
      currentSegmentDuration, uploadPending, settings, cameraPermissionState, microphonePermissionGranted,
      pushDeviceId, recordingEpoch, cloudQuotaFull, pendingTripReview,
      openDashcam, closeDashcam, startDashcam, stopDashcam, stopAndSaveDashcam,
      startBackgroundRecording, pauseForVoiceReport, resumeAfterVoiceReport,
      requestDashcamPermissions, refreshDashcamCameraPermission, clearBackgroundRecordPending,
      lockCurrentClip, lockSavedClip, lockSegment, dismissTripReview,
      deleteSegment, clearUnlocked, updateSettings,
      clearCloudQuotaFull, pinSegment, unpinSegment,
      bumpRecordingEpoch,
      setCameraRef, onSegmentStart, onSegmentComplete,
    ]
  );

  return (
    <DashcamContext.Provider value={value}>{children}</DashcamContext.Provider>
  );
}
