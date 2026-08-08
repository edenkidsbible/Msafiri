/**
 * DashcamContext.tsx
 *
 * Manages dashcam recording state, local segment storage, and cloud upload
 * queue. The CameraView lives in DashcamOverlay; this context is the
 * coordination layer.
 *
 * Device enrollment & authentication:
 *   Each device generates a persistent `dashcamSecret` UUID on first launch
 *   (AsyncStorage key SECRET_KEY). Before uploading anything, the device:
 *     1. Calls GET /dashcam/enrollment-token (returns a server HMAC token)
 *     2. Calls POST /dashcam/register with the token + X-Dashcam-Secret header
 *   Subsequent API calls authenticate with X-Device-Id + X-Dashcam-Secret.
 *   The server verifies ownership via SHA-256(deviceId+":"+secret) stored in
 *   the dashcam_devices table; per-clip hash columns guard read/delete.
 *
 * Upload queue persistence:
 *   Pending/failed uploads are stored in AsyncStorage and re-enqueued on app
 *   launch. The `hydrated` flag is set only AFTER segments are loaded and the
 *   queue is rebuilt, so the registration+upload effect never races with hydration.
 *   A NetInfo listener also retriggers uploads on Wi-Fi reconnect.
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
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import * as Notifications from "expo-notifications";
import { Alert, AppState, Platform } from "react-native";
import { API_BASE } from "@/utils/apiClient";
import type { CameraView } from "expo-camera";
import {
  vehicleSegmentsKey,
  vehicleSegmentsDir as _vehicleSegmentsDir,
  computeSegmentDestUri,
  detectVehicleSwitch,
  buildDashcamSegment,
} from "@/utils/dashcamSegmentRouting";

// Dynamically load useCameraPermissions so this context stays web-safe.
// On web the fallback is "always granted" (no camera access needed).
let useCameraPermissions: (() => [{ granted: boolean }, () => Promise<{ granted: boolean }>]) | null = null;
let useMicrophonePermissions: (() => [{ granted: boolean }, () => Promise<{ granted: boolean }>]) | null = null;
if (Platform.OS !== "web") {
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
  lockReason?: string;
  /**
   * "lost" — the local file was purged by the OS before the upload could
   * complete. The clip is unrecoverable; it stays in the list so the driver
   * can see that footage was lost rather than disappearing silently.
   */
  uploadStatus: "none" | "pending" | "uploading" | "uploaded" | "failed" | "lost";
  fileKey?: string;     // R2 key once uploaded
  serverId?: string;    // DB id once saved on server
  retryCount?: number;  // upload attempts so far (for bounded backoff)
  lat?: number;         // GPS coords at recording start
  lng?: number;
}

export interface DashcamSettings {
  quality: "720p" | "1080p";
  audioEnabled: boolean;
  storageCap: number;       // bytes — oldest unlocked evicted when exceeded
  wifiOnlyUpload: boolean;  // default true
}

interface DashcamContextValue {
  isRecording: boolean;
  isDashcamOpen: boolean;
  /** True while the camera is warming up for a silent background recording.
   *  The overlay mounts at opacity 0; DashcamOverlay auto-calls startDashcam()
   *  in onCameraReady and then clears this flag. */
  backgroundRecordPending: boolean;
  segments: DashcamSegment[];
  storageUsedBytes: number;
  currentSegmentDuration: number;  // seconds elapsed in current 2-min segment
  uploadPending: number;
  settings: DashcamSettings;
  /**
   * Incremented each time we need the recording loop in DashcamOverlay to
   * restart — specifically when returning to foreground after an iOS background
   * interruption. The loop effect depends on this so it fires again without
   * isRecording having toggled.
   */
  recordingEpoch: number;
  /**
   * The push-notification device ID loaded from AsyncStorage key
   * "@msafiri/deviceId" — the same key used by usePushNotifications.ts and
   * stored in push_tokens. Must be used for ALL dashcam API requests so that
   * enrollment, upload, and gallery auth resolve to the correct push_tokens row.
   */
  pushDeviceId: string | null;
  /**
   * True when the server has returned a quota-full response. Cleared when the
   * driver successfully deletes a cloud clip (or the app is restarted). Used
   * to surface a persistent banner in the dashcam UI so the driver knows they
   * must delete old cloud clips before new ones will back up.
   */
  cloudQuotaFull: boolean;
  /**
   * Call after a successful cloud-clip deletion to clear the quota-full banner
   * and trigger a fresh upload attempt for any remaining pending segments.
   */
  clearCloudQuotaFull: () => void;
  openDashcam: () => void;
  closeDashcam: () => void;
  startDashcam: () => void;
  stopDashcam: () => void;
  /**
   * Lock the current clip then stop recording. Call this from the drive screen
   * so the final segment is always saved and uploaded instead of discarded as
   * an unlocked local-only clip.
   */
  stopAndSaveDashcam: () => void;
  /** Start recording silently without showing the dashcam overlay UI.
   *  Requests camera permission if not yet granted — shows the system dialog.
   *  Resolves to false if permission was denied (nothing starts). */
  startBackgroundRecording: () => Promise<boolean>;
  /**
   * Proactively request both camera AND microphone permissions before the user
   * taps the dashcam button. Should be called from the drive screen's
   * useFocusEffect so first-time users see both prompts in the right sequence
   * (iOS will not reliably show two system dialogs back-to-back without a gap).
   * Safe to call repeatedly — skips any already-determined permission.
   * Returns { cameraGranted, micGranted }.
   */
  requestDashcamPermissions: () => Promise<{ cameraGranted: boolean; micGranted: boolean }>;
  /** Called by DashcamOverlay once the camera is ready and recording starts. */
  clearBackgroundRecordPending: () => void;
  lockCurrentClip: (reason?: string) => void;
  deleteSegment: (id: string) => Promise<void>;
  clearUnlocked: () => Promise<void>;
  updateSettings: (partial: Partial<DashcamSettings>) => Promise<void>;
  // Internal — called by DashcamOverlay
  setCameraRef: (ref: CameraView | null) => void;
  /**
   * Must be called by DashcamOverlay immediately before each recordAsync() call.
   * Snapshots the active vehicle's storage paths so that onSegmentComplete always
   * writes to the vehicle that was active when recording STARTED — not the vehicle
   * that happens to be active when the clip finishes (which may differ if the
   * driver switched vehicles mid-segment).
   */
  onSegmentStart: () => void;
  onSegmentComplete: (tempUri: string, durationS?: number, coords?: { lat: number; lng: number }) => Promise<void>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SETTINGS_KEY = "dashcam_settings_v1";
const SECRET_KEY   = "dashcam_secret_v1";

// ── Vehicle-scoped storage helpers ────────────────────────────────────────────
// Clips are stored separately for each vehicle so switching cars shows only
// that vehicle's footage. Settings (quality, wifi-only, etc.) stay global.
// vehicleSegmentsKey and vehicleSegmentsDir are imported from
// utils/dashcamSegmentRouting.js — change the logic there, not here.
const LEGACY_SEGMENTS_KEY = "dashcam_segments_v1"; // pre-multi-vehicle key — migrated once

// Thin wrapper: injects FileSystem.documentDirectory so call-sites stay concise.
const vehicleSegmentsDir  = (vKey: string) =>
  _vehicleSegmentsDir(vKey, FileSystem.documentDirectory ?? "");

// Must match the AsyncStorage key in hooks/usePushNotifications.ts so that
// the device ID used for dashcam enrollment resolves to the same row in
// push_tokens that usePushNotifications registered. AppContext.deviceId
// (key: "sdk_device_id") is a different key and a different device ID.
const PUSH_DEVICE_ID_KEY = "@msafiri/deviceId";

// Exponential backoff delays for failed uploads (ms): 15s, 60s, 5min, 15min
const UPLOAD_RETRY_BACKOFF = [15_000, 60_000, 5 * 60_000, 15 * 60_000];
const MAX_UPLOAD_RETRIES   = UPLOAD_RETRY_BACKOFF.length;

const DEFAULT_SETTINGS: DashcamSettings = {
  quality: "1080p",
  audioEnabled: false,         // mic off by default — driver can enable anytime
  storageCap: 1_073_741_824,  // 1 GB
  wifiOnlyUpload: true,
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

// ─── Context ─────────────────────────────────────────────────────────────────

const DashcamContext = createContext<DashcamContextValue | null>(null);

export function useDashcam(): DashcamContextValue {
  const ctx = useContext(DashcamContext);
  if (!ctx) throw new Error("useDashcam must be used inside DashcamProvider");
  return ctx;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function DashcamProvider({ children }: { children: React.ReactNode }) {
  // NOTE: AppContext.deviceId uses AsyncStorage key "sdk_device_id" — a
  // different key from the push-notification device ID ("@msafiri/deviceId").
  // Dashcam enrollment requires the PUSH device ID because that is what
  // push_tokens stores. We load it ourselves from AsyncStorage during hydration
  // and expose it via pushDeviceIdRef; AppContext.deviceId is NOT used here.

  // ── Active vehicle — determines which segment store to read/write ───────────
  const { activeVehicleId } = useVehicle();
  const vehicleKey = activeVehicleId ?? "default";

  // Refs for the current vehicle's storage paths. Updated when vehicleKey
  // changes so onSegmentComplete always writes to the right directory without
  // needing to restart the recording loop.
  const segmentsAsyncKeyRef = useRef(vehicleSegmentsKey(vehicleKey));
  const segmentsFsDirRef    = useRef(vehicleSegmentsDir(vehicleKey));

  const [isRecording, setIsRecording]             = useState(false);
  const [isDashcamOpen, setIsDashcamOpen]         = useState(false);
  const [backgroundRecordPending, setBackgroundRecordPending] = useState(false);
  const [segments, setSegments]             = useState<DashcamSegment[]>([]);
  const [settings, setSettings]             = useState<DashcamSettings>(DEFAULT_SETTINGS);
  const [currentSegmentDuration, setCurrentSegmentDuration] = useState(0);
  /** Bumped each time we need the recording loop in DashcamOverlay to restart
   *  after an iOS background interruption. */
  const [recordingEpoch, setRecordingEpoch] = useState(0);
  /**
   * `hydrated` becomes true only AFTER AsyncStorage is loaded AND the upload
   * queue is rebuilt. Enrollment/upload effects gate on this flag.
   */
  const [hydrated, setHydrated]             = useState(false);
  /** The push-notification device ID — same key as usePushNotifications. */
  const [pushDeviceId, setPushDeviceId]     = useState<string | null>(null);
  /**
   * Set to true when the server returns a quota-full 429 on upload-url.
   * Cleared on a successful upload or when the driver deletes a cloud clip.
   */
  const [cloudQuotaFull, setCloudQuotaFull] = useState(false);
  // Ref counterpart — read from effects and callbacks without triggering re-renders
  const cloudQuotaFullRef = useRef(false);

  // ── Segment-start snapshot refs ───────────────────────────────────────────
  // Captured by onSegmentStart() immediately before each recordAsync() call.
  // onSegmentComplete reads THESE refs instead of segmentsFsDirRef so that a
  // vehicle switch that happens while a clip is in-flight doesn't redirect the
  // completed clip to the new vehicle's folder/store.
  const recordingSegmentDirRef      = useRef(vehicleSegmentsDir(vehicleKey));
  const recordingSegmentAsyncKeyRef = useRef(vehicleSegmentsKey(vehicleKey));

  // Refs — avoid re-renders on GPS/interval ticks
  // Camera permission — requested before the first background recording attempt.
  // Falls back to "always granted" on web (useCameraPermissions is null there).
  const [cameraPermission, requestCameraPermission] = useCameraPermissions
    ? useCameraPermissions()
    : [{ granted: true } as { granted: boolean }, async () => ({ granted: true })];
  const requestCameraPermissionRef = useRef(requestCameraPermission);
  useEffect(() => { requestCameraPermissionRef.current = requestCameraPermission; }, [requestCameraPermission]);

  // Microphone permission — needed by recordAsync when audio is enabled.
  // Denial is non-fatal: the overlay records muted instead of failing silently.
  const [micPermission, requestMicPermission] = useMicrophonePermissions
    ? useMicrophonePermissions()
    : [{ granted: true } as { granted: boolean }, async () => ({ granted: true })];
  const requestMicPermissionRef = useRef(requestMicPermission);
  useEffect(() => { requestMicPermissionRef.current = requestMicPermission; }, [requestMicPermission]);

  const cameraRef              = useRef<CameraView | null>(null);
  const lockNextRef            = useRef<string | null>(null);
  const isRecordingRef         = useRef(false);
  const segmentStartRef        = useRef<number>(0);
  const segmentsRef            = useRef<DashcamSegment[]>([]);
  const settingsRef            = useRef<DashcamSettings>(DEFAULT_SETTINGS);
  const uploadQueueRef         = useRef<string[]>([]);
  const uploadActiveRef        = useRef(false);
  const secretRef              = useRef<string>("");
  const hydratedRef            = useRef(false);  // for use inside closure callbacks
  const pushDeviceIdRef        = useRef<string | null>(null);
  /** True when the app went to background while recording was active.
   *  Used to auto-restart the recording loop when the app returns to foreground. */
  const backgroundedWhileRecordingRef = useRef(false);
  // Stable ref to processUploadQueue so setTimeout callbacks always call the
  // latest version without adding it to dependency arrays (which would create
  // circular deps since processUploadQueue's setTimeout calls itself).
  const processUploadQueueRef  = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => { segmentsRef.current = segments; }, [segments]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { cloudQuotaFullRef.current = cloudQuotaFull; }, [cloudQuotaFull]);

  // ── Hydrate from AsyncStorage ──────────────────────────────────────────────
  // IMPORTANT: setHydrated(true) is called only after the upload queue is
  // fully rebuilt, preventing a race between hydration and the upload effect.
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

        // 2. Get-or-create the push-notification device ID.
        // Uses the SAME key AND the same ID format as usePushNotifications.ts so
        // both contexts always share the same stable identifier.
        //
        // WHY "get or create" instead of just read:
        //   DashcamProvider mounts before RootLayoutNav (where usePushNotifications
        //   runs). On a first install (or cleared storage), a plain read would return
        //   null and all enrollment/upload behavior would be gated off for the
        //   entire session. Since both callers use an atomic "read → create if absent
        //   → write" pattern against the same key, the first caller generates the
        //   ID and the second caller reads it — order independent.
        let pid = await AsyncStorage.getItem(PUSH_DEVICE_ID_KEY);
        if (!pid) {
          pid = `${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          await AsyncStorage.setItem(PUSH_DEVICE_ID_KEY, pid);
        }
        pushDeviceIdRef.current = pid;
        setPushDeviceId(pid);

        // 3. Load settings
        const rawSettings = await AsyncStorage.getItem(SETTINGS_KEY);
        if (rawSettings) {
          const s = { ...DEFAULT_SETTINGS, ...JSON.parse(rawSettings) };
          setSettings(s);
          settingsRef.current = s;
        }

        // 4. Load + verify segments (vehicle-scoped; migrate from legacy key on first run)
        let rawSegsStr = await AsyncStorage.getItem(segmentsAsyncKeyRef.current);
        if (!rawSegsStr) {
          // One-time migration: move segments from the pre-multi-vehicle key to
          // this vehicle's key, then clear the legacy entry so it doesn't get
          // re-applied when a second vehicle is added.
          const legacy = await AsyncStorage.getItem(LEGACY_SEGMENTS_KEY);
          if (legacy) {
            rawSegsStr = legacy;
            AsyncStorage.setItem(segmentsAsyncKeyRef.current, legacy).catch(() => {});
            AsyncStorage.removeItem(LEGACY_SEGMENTS_KEY).catch(() => {});
          }
        }
        if (rawSegsStr) {
          const loaded: DashcamSegment[] = JSON.parse(rawSegsStr);
          const verified = await Promise.all(
            loaded.map(async (s) => {
              // Uploaded/lost segments no longer need a local file
              if (s.uploadStatus === "uploaded" || s.uploadStatus === "lost") return s;
              try {
                const info = await FileSystem.getInfoAsync(s.uri);
                if (info.exists) return s;
                // Locked clips whose file was purged by the OS are surfaced as
                // "lost" so the driver can see that footage was lost rather than
                // it disappearing silently. Unlocked clips are simply dropped.
                if (s.locked) return { ...s, uploadStatus: "lost" as const };
                return null;
              } catch {
                if (s.locked) return { ...s, uploadStatus: "lost" as const };
                return null;
              }
            })
          );
          const live = verified.filter(Boolean) as DashcamSegment[];
          setSegments(live);
          segmentsRef.current = live;

          // Rebuild upload queue from pending/failed segments (sorted oldest-first).
          // Failed segments that have already exhausted MAX_UPLOAD_RETRIES are
          // terminal and must NOT be re-enqueued — same guard applied in the
          // NetInfo reconnect listener so the boundary is enforced across both
          // paths (relaunch and connectivity restore).
          const toUpload = live
            .filter((s) =>
              s.uploadStatus === "pending" ||
              (s.uploadStatus === "failed" && (s.retryCount ?? 0) < MAX_UPLOAD_RETRIES)
            )
            .sort((a, b) => a.startedAt - b.startedAt)
            .map((s) => s.id);
          uploadQueueRef.current = toUpload;
        }

        // 5. Ensure segments directory exists for the active vehicle
        await FileSystem.makeDirectoryAsync(segmentsFsDirRef.current, { intermediates: true });
      } catch (err) {
        console.warn("[Dashcam] hydration error:", err);
      } finally {
        // Signal readiness AFTER queue is rebuilt — the upload effect gates on this
        hydratedRef.current = true;
        setHydrated(true);
      }
    })();
  }, []);

  // ── Persist segments on change (vehicle-scoped key) ───────────────────────
  useEffect(() => {
    AsyncStorage.setItem(segmentsAsyncKeyRef.current, JSON.stringify(segments)).catch(() => {});
  }, [segments]);

  // ── Reload segments when the active vehicle changes ────────────────────────
  // Skip the first render — initial hydration already loaded the right data.
  const isFirstVehicleMount = useRef(true);
  useEffect(() => {
    if (isFirstVehicleMount.current) {
      isFirstVehicleMount.current = false;
      return;
    }
    // Update storage refs for the newly-active vehicle
    segmentsAsyncKeyRef.current = vehicleSegmentsKey(vehicleKey);
    segmentsFsDirRef.current    = vehicleSegmentsDir(vehicleKey);

    (async () => {
      await FileSystem.makeDirectoryAsync(segmentsFsDirRef.current, { intermediates: true }).catch(() => {});
      const raw = await AsyncStorage.getItem(segmentsAsyncKeyRef.current);
      const loaded: DashcamSegment[] = raw ? JSON.parse(raw) : [];
      const verified = await Promise.all(
        loaded.map(async (s) => {
          if (s.uploadStatus === "uploaded" || s.uploadStatus === "lost") return s;
          try {
            const info = await FileSystem.getInfoAsync(s.uri);
            if (info.exists) return s;
            if (s.locked) return { ...s, uploadStatus: "lost" as const };
            return null;
          } catch {
            if (s.locked) return { ...s, uploadStatus: "lost" as const };
            return null;
          }
        })
      );
      const live = verified.filter(Boolean) as DashcamSegment[];
      setSegments(live);
      segmentsRef.current = live;
      const toUpload = live
        .filter((s) => s.uploadStatus === "pending" || (s.uploadStatus === "failed" && (s.retryCount ?? 0) < MAX_UPLOAD_RETRIES))
        .sort((a, b) => a.startedAt - b.startedAt)
        .map((s) => s.id);
      uploadQueueRef.current = toUpload;
      if (toUpload.length > 0) processUploadQueue();
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

  // ── iOS background handling ────────────────────────────────────────────────
  // On iOS, CameraView.recordAsync is interrupted when the app is backgrounded.
  // Strategy: detect AppState → background while recording, immediately stop the
  // current segment cleanly (so it's locked + queued for upload), then bump
  // recordingEpoch when the app returns to foreground so DashcamOverlay's
  // recording loop restarts without isRecording ever toggling to false.
  // isRecording remains true throughout — the pill stays "● REC".
  //
  // On Android background recording is allowed (FOREGROUND_SERVICE permission
  // is declared), so we only apply this on iOS.
  useEffect(() => {
    if (Platform.OS !== "ios") return;

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" || nextState === "inactive") {
        // Only act if the dashcam is actively recording
        if (!isRecordingRef.current) return;
        backgroundedWhileRecordingRef.current = true;

        // Lock the current segment: sets lockNextRef then calls stopRecording().
        // DashcamOverlay's recordAsync resolves, onSegmentComplete fires with
        // lockReason="background", the clip is saved and queued for upload.
        lockNextRef.current = "background";
        cameraRef.current?.stopRecording();

        // Post an immediate local notification so the driver knows a clip was saved.
        Notifications.scheduleNotificationAsync({
          content: {
            title: "Dashcam clip saved",
            body: "A clip was saved automatically because the app moved to the background. Tap to review.",
            data: { type: "dashcam_background_save" },
          },
          trigger: null,
        }).catch(() => {});
      } else if (nextState === "active") {
        if (!backgroundedWhileRecordingRef.current) return;
        backgroundedWhileRecordingRef.current = false;
        // Bump epoch to restart the recording loop in DashcamOverlay.
        // The CameraView is still mounted (isRecording never went false), so
        // the new recordAsync call will start a fresh segment immediately.
        setRecordingEpoch((e) => e + 1);
      }
    });

    return () => subscription.remove();
    // refs only — no state deps needed; the effect must remain stable
  }, []);

  const storageUsedBytes = useMemo(
    () => segments.reduce((sum, s) => sum + s.sizeBytes, 0),
    [segments]
  );

  const uploadPending = useMemo(
    () => segments.filter((s) => s.uploadStatus === "pending" || s.uploadStatus === "uploading").length,
    [segments]
  );

  // ── Evict oldest unlocked segments when over storage cap ───────────────────
  const evictIfNeeded = useCallback((segs: DashcamSegment[]): DashcamSegment[] => {
    let total = segs.reduce((sum, s) => sum + s.sizeBytes, 0);
    if (total <= settingsRef.current.storageCap) return segs;
    const result = [...segs];
    while (total > settingsRef.current.storageCap) {
      const idx = result.findIndex((s) => !s.locked);
      if (idx === -1) break;
      const [evicted] = result.splice(idx, 1);
      total -= evicted.sizeBytes;
      FileSystem.deleteAsync(evicted.uri, { idempotent: true }).catch(() => {});
    }
    return result;
  }, []);

  // ── Upload queue processor ─────────────────────────────────────────────────
  // On any upload failure the segment is kept as "failed" and a bounded
  // exponential-backoff retry is scheduled (15 s, 60 s, 5 min, 15 min).
  // After MAX_UPLOAD_RETRIES the item is removed from the queue permanently.
  // This means transient API or R2 failures recover automatically without
  // requiring a NetInfo connectivity transition or app relaunch.
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

      // ── Pre-upload file-existence check ─────────────────────────────────────
      // The OS may have purged the segment file (low-storage eviction of the
      // tmp/cache directory, or an unexpected restart) even though the clip is
      // still listed as "pending" in AsyncStorage. Detect this before making any
      // network calls so we never retry indefinitely for a missing file.
      if (seg.uploadStatus !== "uploaded") {
        try {
          const fileInfo = await FileSystem.getInfoAsync(seg.uri);
          if (!fileInfo.exists) {
            uploadQueueRef.current.shift();
            setSegments((prev) =>
              prev.map((s) =>
                s.id === segId ? { ...s, uploadStatus: "lost" as const } : s
              )
            );
            console.warn("[Dashcam] clip file missing before upload — marked lost:", segId, seg.uri);
            continue;
          }
        } catch {
          // If we can't even stat the file, treat it as lost to avoid an
          // upload attempt that will fail with an unreadable error anyway.
          uploadQueueRef.current.shift();
          setSegments((prev) =>
            prev.map((s) =>
              s.id === segId ? { ...s, uploadStatus: "lost" as const } : s
            )
          );
          console.warn("[Dashcam] could not stat clip file — marked lost:", segId, seg.uri);
          continue;
        }
      }

      try {
        setSegments((prev) =>
          prev.map((s) => s.id === segId ? { ...s, uploadStatus: "uploading" as const } : s)
        );

        const headers = authHeaders(pushDeviceIdRef.current!, secretRef.current);

        // 1. Get presigned upload URL + intent reservation
        const urlRes = await fetch(`${API_BASE}/dashcam/upload-url`, {
          method: "POST",
          headers,
          body: JSON.stringify({ lockReason: seg.lockReason ?? "manual" }),
        });
        if (!urlRes.ok) {
          if (urlRes.status === 429) {
            const body = await urlRes.json().catch(() => ({})) as { error?: string; code?: string };
            // Distinguish quota-full from serialization-failure 429s.
            // Serialization failures are transient and should retry normally.
            // Quota-full means every subsequent upload will also fail — bail out.
            if (body?.code === "QUOTA_FULL" || body?.error?.toLowerCase().includes("quota")) {
              cloudQuotaFullRef.current = true;
              setCloudQuotaFull(true);
              // Notify the driver so they know to open the gallery and delete old clips
              Notifications.scheduleNotificationAsync({
                content: {
                  title: "Cloud storage full",
                  body: "Delete old clips in the dashcam gallery to continue backing up.",
                  data: { type: "dashcam_quota_full" },
                },
                trigger: null,
              }).catch(() => {});
              // Permanently mark ALL pending/retryable segments as terminal
              // (retryCount = MAX_UPLOAD_RETRIES) so they are never re-queued by
              // the connectivity-restore listener or app relaunch — uploads will
              // keep failing until the driver frees space.
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
              // Drain the entire queue — no point attempting the remaining items
              uploadQueueRef.current = [];
              break;
            }
          }
          throw new Error(`Upload URL: ${urlRes.status}`);
        }
        const { uploadUrl, fileKey, clipId } = (await urlRes.json()) as {
          uploadUrl: string; fileKey: string; clipId: string;
        };

        // 2. Upload video to R2
        const fileRes = await fetch(seg.uri);
        const blob    = await fileRes.blob();
        const putRes  = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "video/mp4" },
          body: blob,
        });
        if (!putRes.ok) throw new Error(`R2 PUT: ${putRes.status}`);

        // 3. Save clip metadata (validates intent)
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
        // A successful upload means the server has room — clear the quota banner
        // (server may have auto-evicted an old clip to make space)
        setCloudQuotaFull(false);
        uploadQueueRef.current.shift();
      } catch (err) {
        console.warn("[Dashcam] upload failed for", segId, err);
        uploadQueueRef.current.shift(); // remove from front

        // Determine how many retries this segment has had
        const nextRetryCount = (seg.retryCount ?? 0) + 1;

        if (nextRetryCount > MAX_UPLOAD_RETRIES) {
          // Give up — segment stays as "failed" but won't be retried again
          setSegments((prev) =>
            prev.map((s) =>
              s.id === segId
                ? { ...s, uploadStatus: "failed" as const, retryCount: nextRetryCount }
                : s
            )
          );
        } else {
          // Bounded exponential backoff: mark as failed, schedule retry.
          // Uses processUploadQueueRef to avoid circular useCallback deps.
          setSegments((prev) =>
            prev.map((s) =>
              s.id === segId
                ? { ...s, uploadStatus: "failed" as const, retryCount: nextRetryCount }
                : s
            )
          );
          const delay = UPLOAD_RETRY_BACKOFF[nextRetryCount - 1] ?? UPLOAD_RETRY_BACKOFF.at(-1)!;
          setTimeout(() => {
            // Only retry if the segment is still in the failed state
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

  // Keep the ref pointing at the latest processUploadQueue so setTimeout
  // callbacks (inside processUploadQueue itself) can call the latest version
  // without creating circular useCallback dependency chains.
  useEffect(() => {
    processUploadQueueRef.current = processUploadQueue;
  }, [processUploadQueue]);

  // ── Retry uploads on connectivity change (only after hydration is complete) ─
  // On reconnect: re-add failed segments to uploadQueueRef BEFORE calling the
  // processor so they are included in the retry pass, not just on next launch.
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (!hydratedRef.current) return;
      const wifiOnly    = settingsRef.current.wifiOnlyUpload;
      const isWifi      = state.type === "wifi";
      const isConnected = !!state.isConnected;

      if (isConnected && (!wifiOnly || isWifi)) {
        // Re-enqueue failed segments not already queued — skip terminal failures
        // (retryCount >= MAX_UPLOAD_RETRIES) to enforce the bounded-retry guarantee
        // across connectivity restores as well as within the backoff timeout path.
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
  //
  // POST /dashcam/register on hydration. The server auto-enrolls any device
  // that presents a valid deviceId+secret pair, subject to an IP rate limit.
  // No push-token registration is required, so enrollment succeeds immediately
  // on first launch without racing against usePushNotifications.
  //
  //   Already enrolled  → { ok: true, registered: false } → start uploading
  //   Newly enrolled    → { ok: true, registered: true  } → start uploading
  //   Rate limited (429) → retry with backoff (defensive; unlikely on first try)
  //   Network error      → retry with backoff
  //
  // Depends on pushDeviceId (not AppContext.deviceId) because push_tokens
  // stores the @msafiri/deviceId key, not sdk_device_id.
  useEffect(() => {
    if (!hydrated || !pushDeviceId || !API_BASE) return;
    const secret = secretRef.current;
    if (!secret) return;

    let cancelled = false;
    // Backoff delays for transient failures (rate limit, network error): 5s, 15s, 30s, 60s
    const ENROLL_BACKOFF = [5_000, 15_000, 30_000, 60_000];

    const attempt = async (tryIndex: number) => {
      if (cancelled) return;
      try {
        const res = await fetch(`${API_BASE}/dashcam/register`, {
          method: "POST",
          headers: authHeaders(pushDeviceId, secret),
        });
        if (res.ok) {
          // Both "registered: true" (new) and "registered: false" (existing) mean
          // the device is enrolled — kick off any pending uploads.
          processUploadQueueRef.current();
          return;
        }
        if (res.status === 409) {
          // Conflicting secret — permanent failure, do not retry
          console.warn("[Dashcam] enrollment conflict: device registered with a different secret");
          return;
        }
        // 429 (rate limit) or other transient error — retry with backoff
        const delay = ENROLL_BACKOFF[tryIndex] ?? ENROLL_BACKOFF.at(-1)!;
        console.warn(`[Dashcam] enrollment error ${res.status}, retrying in ${delay / 1000}s`);
        setTimeout(() => attempt(tryIndex + 1), delay);
      } catch (err) {
        const delay = ENROLL_BACKOFF[tryIndex] ?? ENROLL_BACKOFF.at(-1)!;
        console.warn(`[Dashcam] enrollment failed, retrying in ${delay / 1000}s`, err);
        setTimeout(() => attempt(tryIndex + 1), delay);
      }
    };

    attempt(0);
    return () => { cancelled = true; };
  }, [hydrated, pushDeviceId]);

  // ─── Public API ─────────────────────────────────────────────────────────────

  const openDashcam  = useCallback(() => setIsDashcamOpen(true), []);
  const closeDashcam = useCallback(() => setIsDashcamOpen(false), []);

  /**
   * Request camera then microphone permissions with a gap between them so iOS
   * has time to dismiss one system dialog before showing the next.
   * Safe to call when permissions are already granted — skips those.
   */
  const requestDashcamPermissions = useCallback(async (): Promise<{ cameraGranted: boolean; micGranted: boolean }> => {
    let cameraGranted = cameraPermission?.granted ?? false;
    let micGranted    = micPermission?.granted    ?? false;

    if (!cameraGranted) {
      try {
        const res = await requestCameraPermissionRef.current();
        cameraGranted = res?.granted ?? false;
      } catch { cameraGranted = false; }
    }

    if (!micGranted) {
      // iOS will not reliably show a second system dialog immediately after
      // the first — give it 500 ms to fully dismiss the camera prompt first.
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      try {
        const res = await requestMicPermissionRef.current();
        micGranted = res?.granted ?? false;
      } catch { micGranted = false; }
    }

    return { cameraGranted, micGranted };
  }, [cameraPermission?.granted, micPermission?.granted]);

  /** Start recording silently — requests camera permission if needed (system
   *  dialog), then mounts overlay at opacity 0 so onCameraReady auto-starts.
   *  Returns false if the user denied the permission request. */
  const startBackgroundRecording = useCallback(async (): Promise<boolean> => {
    if (isRecordingRef.current) return true; // already recording

    // Request camera permission if not yet granted.
    if (!cameraPermission?.granted) {
      // Show a plain-language explanation before the system dialog so drivers
      // understand WHY the permission is needed. Only shown on first ask
      // ("undetermined"); denied users go straight to the system dialog which
      // will inform them to visit Settings.
      if ((cameraPermission as any)?.status === "undetermined") {
        await new Promise<void>((resolve) =>
          Alert.alert(
            "Dashcam Access",
            "Msafiri records continuous video while you drive — clips stay private on your device and are never uploaded without your permission. A microphone will also be requested so clips include audio.\n\nTap Continue to grant camera access.",
            [{ text: "Continue", onPress: () => resolve() }],
            { cancelable: false },
          )
        );
      }
      const result = await requestCameraPermissionRef.current();
      if (!result?.granted) return false; // denied — don't start
    }

    // Always request microphone (not just when audioEnabled) — on iOS both
    // must be determined before CameraView mounts, and the system dialogs
    // need a short gap between them to display reliably.
    if (!micPermission?.granted) {
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      try { await requestMicPermissionRef.current(); } catch { /* muted fallback */ }
    }

    setBackgroundRecordPending(true);
    return true;
  }, [cameraPermission?.granted, micPermission?.granted]);

  /** Called by DashcamOverlay once onCameraReady fires and startDashcam() has
   *  been called, so we clear the pending flag and the overlay stays invisible. */
  const clearBackgroundRecordPending = useCallback(() => {
    setBackgroundRecordPending(false);
  }, []);

  const startDashcam = useCallback(() => {
    isRecordingRef.current  = true;
    segmentStartRef.current = Date.now();
    setIsRecording(true);
  }, []);

  const stopDashcam = useCallback(() => {
    isRecordingRef.current = false;
    setIsRecording(false);
    setBackgroundRecordPending(false); // clear any warm-up that never completed
    cameraRef.current?.stopRecording();
  }, []);

  /**
   * Lock the current in-progress segment AND stop recording in one action.
   * Sets lockNextRef BEFORE calling stopRecording so the recording loop saves
   * the final segment as a locked/uploadable clip rather than discarding it
   * as an unlocked local-only segment. Called by the drive screen's dashcam
   * toggle so every driver-initiated stop produces a saved clip.
   *
   * IMPORTANT — race-condition fix: we intentionally do NOT call
   * setIsRecording(false) here. Doing so causes React to re-render
   * DashcamOverlay, which returns null (all three guard flags become false)
   * and unmounts the CameraView BEFORE the pending recordAsync call can
   * resolve and the final clip can be written to disk. On Android especially,
   * an unmounted CameraView causes recordAsync to reject rather than resolve
   * with a URI, silently dropping the clip.
   *
   * Instead: isRecordingRef is set to false immediately (prevents re-entry),
   * and onSegmentComplete detects this ref/state mismatch after the clip is
   * safely on disk, then applies setIsRecording(false) there.
   */
  const stopAndSaveDashcam = useCallback(() => {
    if (!isRecordingRef.current) return;
    lockNextRef.current = "manual";   // mark the final segment for upload
    isRecordingRef.current = false;   // prevent re-entry; onSegmentComplete reads this
    setBackgroundRecordPending(false); // hide "Starting…" pill immediately
    cameraRef.current?.stopRecording(); // resolve the pending recordAsync
    // setIsRecording(false) is deferred to onSegmentComplete — see comment above
  }, []);

  /**
   * Lock the current in-progress segment. Calls stopRecording() so the current
   * recordAsync resolves; the DashcamOverlay loop processes the result and
   * calls onSegmentComplete with the lockReason from lockNextRef.
   */
  const lockCurrentClip = useCallback((reason = "manual") => {
    lockNextRef.current = reason;
    cameraRef.current?.stopRecording();
  }, []);

  const setCameraRef = useCallback((ref: CameraView | null) => {
    cameraRef.current = ref;
  }, []);

  /**
   * Snapshot the active vehicle's storage paths at segment-start time.
   * Must be called by DashcamOverlay immediately before each recordAsync() so
   * that onSegmentComplete always writes to the vehicle that was active when
   * the clip STARTED, not the one active when it FINISHES.
   */
  const onSegmentStart = useCallback(() => {
    recordingSegmentDirRef.current      = segmentsFsDirRef.current;
    recordingSegmentAsyncKeyRef.current = segmentsAsyncKeyRef.current;
  }, []);

  const onSegmentComplete = useCallback(
    async (tempUri: string, durationS?: number, coords?: { lat: number; lng: number }) => {
      const lockReason = lockNextRef.current;
      lockNextRef.current = null;

      segmentStartRef.current = Date.now();
      setCurrentSegmentDuration(0);

      const id = `seg_${Date.now()}`;

      // Use the paths captured at segment-START time (by onSegmentStart), not the
      // current refs. This prevents a vehicle switch that happens mid-segment from
      // redirecting the completed clip to the new vehicle's folder/store.
      // computeSegmentDestUri and detectVehicleSwitch are imported from
      // utils/dashcamSegmentRouting.js — the unit tests exercise those functions
      // directly against this same import.
      const capturedDir      = recordingSegmentDirRef.current;
      const capturedAsyncKey = recordingSegmentAsyncKeyRef.current;
      const destUri          = computeSegmentDestUri(capturedDir, id);

      // Detect whether the vehicle changed while this segment was in-flight.
      const vehicleSwitchedMidSegment = detectVehicleSwitch(capturedAsyncKey, segmentsAsyncKeyRef.current);

      try {
        // Ensure the destination directory exists before every save — not just
        // at hydration. If the OS cleared the directory (low-storage purge,
        // first install before hydration completed, etc.) a missing directory
        // causes moveAsync to throw, and the clip is silently lost. This call
        // is idempotent: it no-ops if the directory already exists.
        await FileSystem.makeDirectoryAsync(capturedDir, { intermediates: true });

        await FileSystem.moveAsync({ from: tempUri, to: destUri });
        const info      = await FileSystem.getInfoAsync(destUri);
        const sizeBytes = (info as any).size ?? 0;

        // buildDashcamSegment is imported from utils/dashcamSegmentRouting.js.
        const segment: DashcamSegment = buildDashcamSegment({
          id, destUri, durationS: durationS ?? 120, sizeBytes,
          lockReason: lockReason ?? null, coords,
        }) as DashcamSegment;

        if (vehicleSwitchedMidSegment) {
          // The driver switched vehicles while this segment was recording.
          // React state + segmentsAsyncKeyRef now belong to the NEW vehicle, so
          // we must NOT call setSegments (that would add this clip to the wrong
          // vehicle's list). Instead write directly to the OLD vehicle's
          // AsyncStorage key so the clip appears there the next time the driver
          // selects that vehicle from the garage.
          try {
            const existing = await AsyncStorage.getItem(capturedAsyncKey);
            const prev: DashcamSegment[] = existing ? JSON.parse(existing) : [];
            await AsyncStorage.setItem(capturedAsyncKey, JSON.stringify([...prev, segment]));
          } catch (storageErr) {
            console.warn("[Dashcam] failed to persist mid-switch segment to old vehicle store:", storageErr);
          }
          // Locked clips will be picked up for upload the next time the user
          // switches back to that vehicle (the vehicle-switch effect re-queues
          // pending/failed segments on load).
        } else {
          // Normal path — vehicle has not changed.
          setSegments((prev) => {
            const next = evictIfNeeded([...prev, segment]);
            segmentsRef.current = next;
            return next;
          });

          if (lockReason) {
            uploadQueueRef.current.push(id);
            processUploadQueue();
          }
        }

        // Deferred stop: stopAndSaveDashcam() sets isRecordingRef.current = false
        // WITHOUT calling setIsRecording(false), to keep CameraView mounted until
        // this point. Now that the clip is safely on disk, apply the state update
        // so DashcamOverlay can unmount cleanly.
        if (!isRecordingRef.current) {
          setIsRecording(false);
        }
      } catch (err) {
        // Log with enough detail to diagnose future failures.
        console.warn("[Dashcam] onSegmentComplete error — clip NOT saved:", err);
        // Surface to the user only for manually-locked clips where they
        // explicitly intended to keep the footage.
        if (lockReason === "manual") {
          const { Alert } = require("react-native");
          Alert.alert(
            "Clip Could Not Be Saved",
            "There was a problem saving this dashcam clip to your device. " +
            "Check that you have enough storage space and try again.",
          );
        }
      }
    },
    [evictIfNeeded, processUploadQueue]
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

      // If the deleted clip was a cloud clip, a slot just opened — clear the
      // quota banner so the driver knows uploads will work again.
      if (seg.serverId) {
        cloudQuotaFullRef.current = false;
        setCloudQuotaFull(false);
      }
    },
    [pushDeviceId]
  );

  /**
   * Called from the gallery after a successful cloud-clip deletion to clear
   * the quota-full banner. Only needed for server-only clips that are deleted
   * directly via the API (not through deleteSegment). This does not
   * automatically re-queue failed uploads — the driver must record new clips
   * or the queue will retry on the next connectivity restore.
   */
  const clearCloudQuotaFull = useCallback(() => {
    cloudQuotaFullRef.current = false;
    setCloudQuotaFull(false);
  }, []);

  const clearUnlocked = useCallback(async () => {
    const unlocked = segmentsRef.current.filter((s) => !s.locked);
    await Promise.all(
      unlocked.map((s) => FileSystem.deleteAsync(s.uri, { idempotent: true }))
    );
    const unlockedIds = new Set(unlocked.map((s) => s.id));
    setSegments((prev) => {
      const next = prev.filter((s) => s.locked);
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

  const value = useMemo<DashcamContextValue>(
    () => ({
      isRecording, isDashcamOpen, backgroundRecordPending, segments, storageUsedBytes,
      currentSegmentDuration, uploadPending, settings,
      pushDeviceId, recordingEpoch, cloudQuotaFull,
      openDashcam, closeDashcam, startDashcam, stopDashcam, stopAndSaveDashcam,
      startBackgroundRecording, requestDashcamPermissions, clearBackgroundRecordPending,
      lockCurrentClip, deleteSegment, clearUnlocked, updateSettings,
      clearCloudQuotaFull,
      setCameraRef, onSegmentStart, onSegmentComplete,
    }),
    [
      isRecording, isDashcamOpen, backgroundRecordPending, segments, storageUsedBytes,
      currentSegmentDuration, uploadPending, settings,
      pushDeviceId, recordingEpoch, cloudQuotaFull,
      openDashcam, closeDashcam, startDashcam, stopDashcam, stopAndSaveDashcam,
      startBackgroundRecording, requestDashcamPermissions, clearBackgroundRecordPending,
      lockCurrentClip, deleteSegment, clearUnlocked, updateSettings,
      clearCloudQuotaFull,
      setCameraRef, onSegmentStart, onSegmentComplete,
    ]
  );

  return (
    <DashcamContext.Provider value={value}>{children}</DashcamContext.Provider>
  );
}
