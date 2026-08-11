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
}

export interface DashcamSettings {
  quality: "720p" | "1080p";
  audioEnabled: boolean;
  wifiOnlyUpload: boolean;
}

interface DashcamContextValue {
  isRecording: boolean;
  isDashcamOpen: boolean;
  backgroundRecordPending: boolean;
  segments: DashcamSegment[];
  storageUsedBytes: number;
  currentSegmentDuration: number;
  uploadPending: number;
  settings: DashcamSettings;
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
  requestDashcamPermissions: () => Promise<{ cameraGranted: boolean; micGranted: boolean }>;
  clearBackgroundRecordPending: () => void;
  /** Lock the currently recording clip (stops the clip, queues it for upload). */
  lockCurrentClip: (reason?: string) => void;
  /**
   * Lock a saved-for-review clip and queue it for cloud upload.
   * Enforces the 5-clip manual-lock limit.
   */
  lockSavedClip: (id: string) => void;
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
  // audioEnabled intentionally defaults to true — users expect audio in clips.
  // The individual dashcam settings panel lets them disable it if needed.
  quality: "1080p",
  audioEnabled: true,
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

  // ── Core refs ─────────────────────────────────────────────────────────────
  const cameraRef              = useRef<CameraView | null>(null);
  const lockNextRef            = useRef<string | null>(null);
  const isRecordingRef         = useRef(false);
  const segmentStartRef        = useRef<number>(0);
  const segmentsRef            = useRef<DashcamSegment[]>([]);
  const settingsRef            = useRef<DashcamSettings>(DEFAULT_SETTINGS);
  const uploadQueueRef         = useRef<string[]>([]);
  const uploadActiveRef        = useRef(false);
  const secretRef              = useRef<string>("");
  const hydratedRef            = useRef(false);
  const pushDeviceIdRef        = useRef<string | null>(null);
  const backgroundedWhileRecordingRef = useRef(false);
  const processUploadQueueRef  = useRef<() => Promise<void>>(() => Promise.resolve());
  /** ID of the 4-hour "review your clips" reminder so it can be cancelled early. */
  const reviewReminderIdRef    = useRef<string | null>(null);

  useEffect(() => { segmentsRef.current = segments; }, [segments]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { cloudQuotaFullRef.current = cloudQuotaFull; }, [cloudQuotaFull]);

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

        // 3. Load settings
        const rawSettings = await AsyncStorage.getItem(SETTINGS_KEY);
        if (rawSettings) {
          const s = { ...DEFAULT_SETTINGS, ...JSON.parse(rawSettings) };
          setSettings(s);
          settingsRef.current = s;
        }

        // 4. Load + verify segments
        let rawSegsStr = await AsyncStorage.getItem(segmentsAsyncKeyRef.current);
        if (!rawSegsStr) {
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

        // 5. Ensure segments directory exists
        await FileSystem.makeDirectoryAsync(segmentsFsDirRef.current, { intermediates: true });
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
      await FileSystem.makeDirectoryAsync(segmentsFsDirRef.current, { intermediates: true }).catch(() => {});
      const raw = await AsyncStorage.getItem(segmentsAsyncKeyRef.current);
      const loaded: DashcamSegment[] = raw ? JSON.parse(raw) : [];
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
      const live = verified.filter(Boolean) as DashcamSegment[];
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
  // When the app backgrounds while recording, we:
  //  1. Mark the last 5 unlocked clips as savedForReview (so they survive).
  //  2. Stop the current clip cleanly (no lock — the clip saves as unlocked).
  //  3. Bump recordingEpoch on foreground so the loop restarts.
  // isRecording stays true throughout — the REC pill stays on.
  useEffect(() => {
    if (Platform.OS !== "ios") return;

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" || nextState === "inactive") {
        if (!isRecordingRef.current) return;
        backgroundedWhileRecordingRef.current = true;

        // Mark last 5 unlocked clips as savedForReview before stopping, then
        // cap total review clips to MAX_REVIEW_CLIPS (10 = 2 trips × 5).
        setSegments((prev) => {
          const rolling = prev
            .filter((s) => !s.locked && !s.savedForReview)
            .sort((a, b) => b.startedAt - a.startedAt)
            .slice(0, UNLOCKED_ROLLING_WINDOW);
          if (rolling.length === 0) return prev;
          const reviewIds = new Set(rolling.map((s) => s.id));
          const withReview = prev.map((s) =>
            reviewIds.has(s.id) ? { ...s, savedForReview: true } : s
          );
          const capped = applyReviewCap(withReview);
          segmentsRef.current = capped;
          return capped;
        });
        // Persist immediately — the app may be killed before the async
        // setSegments effect runs, losing the savedForReview flags.
        AsyncStorage.setItem(
          segmentsAsyncKeyRef.current,
          JSON.stringify(segmentsRef.current),
        ).catch(() => {});
        setPendingTripReview(true);
        scheduleReviewReminder();

        // Stop the in-flight clip cleanly (no lock — becomes unlocked)
        cameraRef.current?.stopRecording();

        Notifications.scheduleNotificationAsync({
          content: {
            title: "Dashcam clips saved",
            body: "Your last 5 clips are saved for review. Tap to lock the ones you want to keep.",
            data: { type: "dashcam_background_save" },
          },
          trigger: null,
        }).catch(() => {});
      } else if (nextState === "active") {
        if (!backgroundedWhileRecordingRef.current) return;
        backgroundedWhileRecordingRef.current = false;
        setRecordingEpoch((e) => e + 1);
      }
    });

    return () => subscription.remove();
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

    for (const s of toDelete) {
      FileSystem.deleteAsync(s.uri, { idempotent: true }).catch(() => {});
    }

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

    for (const s of toDelete) {
      FileSystem.deleteAsync(s.uri, { idempotent: true }).catch(() => {});
    }

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

  const openDashcam  = useCallback(() => setIsDashcamOpen(true), []);
  const closeDashcam = useCallback(() => setIsDashcamOpen(false), []);

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
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      try {
        const res = await requestMicPermissionRef.current();
        micGranted = res?.granted ?? false;
      } catch { micGranted = false; }
    }

    return { cameraGranted, micGranted };
  }, [cameraPermission?.granted, micPermission?.granted]);

  const startBackgroundRecording = useCallback(async (): Promise<boolean> => {
    if (isRecordingRef.current) return true;

    if (!cameraPermission?.granted) {
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
      if (!result?.granted) return false;
    }

    if (!micPermission?.granted) {
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      try { await requestMicPermissionRef.current(); } catch { /* muted fallback */ }
    }

    setBackgroundRecordPending(true);
    return true;
  }, [cameraPermission?.granted, micPermission?.granted]);

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
    isRecordingRef.current = false;   // prevent re-entry; signals trip-end to onSegmentComplete
    setBackgroundRecordPending(false);
    cameraRef.current?.stopRecording();
  }, []);

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
   * Lock a saved-for-review clip and queue it for cloud upload.
   * Converts savedForReview → locked/manual and enforces the 5-clip limit.
   */
  const lockSavedClip = useCallback((id: string) => {
    const seg = segmentsRef.current.find((s) => s.id === id && s.savedForReview);
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
  }, []);

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

      const capturedDir      = recordingSegmentDirRef.current;
      const capturedAsyncKey = recordingSegmentAsyncKeyRef.current;
      const destUri          = computeSegmentDestUri(capturedDir, id);

      const vehicleSwitchedMidSegment = detectVehicleSwitch(capturedAsyncKey, segmentsAsyncKeyRef.current);

      try {
        await FileSystem.makeDirectoryAsync(capturedDir, { intermediates: true });
        await FileSystem.moveAsync({ from: tempUri, to: destUri });
        const info      = await FileSystem.getInfoAsync(destUri);
        const sizeBytes = (info as any).size ?? 0;

        const base = buildDashcamSegment({
          id, destUri, durationS: durationS ?? 120, sizeBytes,
          lockReason: lockReason ?? null, coords,
        });
        const segment: DashcamSegment = {
          ...base,
          lockType: lockReason
            ? (lockReason === "manual" ? "manual" : "auto")
            : undefined,
        } as DashcamSegment;

        if (vehicleSwitchedMidSegment) {
          try {
            const existing = await AsyncStorage.getItem(capturedAsyncKey);
            const prev: DashcamSegment[] = existing ? JSON.parse(existing) : [];
            await AsyncStorage.setItem(capturedAsyncKey, JSON.stringify([...prev, segment]));
          } catch (storageErr) {
            console.warn("[Dashcam] failed to persist mid-switch segment:", storageErr);
          }
        } else {
          // Determine whether recording was stopped (trip end)
          const tripEnded = !isRecordingRef.current;

          setSegments((prev) => {
            // Apply the rolling window (max 5 unlocked, not savedForReview, not locked)
            const withNew = applyRollingWindow([...prev, segment]);

            // If the trip just ended, mark last 5 unlocked clips as savedForReview
            // then cap the total review pool to MAX_REVIEW_CLIPS (10 = 2 trips).
            if (tripEnded) {
              const rolling = withNew
                .filter((s) => !s.locked && !s.savedForReview)
                .sort((a, b) => b.startedAt - a.startedAt)
                .slice(0, UNLOCKED_ROLLING_WINDOW);
              const reviewIds = new Set(rolling.map((s) => s.id));
              const withReview = withNew.map((s) =>
                reviewIds.has(s.id) ? { ...s, savedForReview: true } : s
              );
              const capped = applyReviewCap(withReview);
              segmentsRef.current = capped;
              return capped;
            }

            segmentsRef.current = withNew;
            return withNew;
          });

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
            AsyncStorage.setItem(
              capturedAsyncKey,
              JSON.stringify(segmentsRef.current),
            ).catch(() => {});
            setPendingTripReview(true);
            scheduleReviewReminder();
            setIsRecording(false);
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
        if (!isRecordingRef.current) {
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
    [applyRollingWindow, processUploadQueue, scheduleReviewReminder]
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

  const value = useMemo<DashcamContextValue>(
    () => ({
      isRecording, isDashcamOpen, backgroundRecordPending, segments, storageUsedBytes,
      currentSegmentDuration, uploadPending, settings,
      pushDeviceId, recordingEpoch, cloudQuotaFull, pendingTripReview,
      openDashcam, closeDashcam, startDashcam, stopDashcam, stopAndSaveDashcam,
      startBackgroundRecording, requestDashcamPermissions, clearBackgroundRecordPending,
      lockCurrentClip, lockSavedClip, dismissTripReview,
      deleteSegment, clearUnlocked, updateSettings,
      clearCloudQuotaFull, pinSegment, unpinSegment,
      setCameraRef, onSegmentStart, onSegmentComplete,
    }),
    [
      isRecording, isDashcamOpen, backgroundRecordPending, segments, storageUsedBytes,
      currentSegmentDuration, uploadPending, settings,
      pushDeviceId, recordingEpoch, cloudQuotaFull, pendingTripReview,
      openDashcam, closeDashcam, startDashcam, stopDashcam, stopAndSaveDashcam,
      startBackgroundRecording, requestDashcamPermissions, clearBackgroundRecordPending,
      lockCurrentClip, lockSavedClip, dismissTripReview,
      deleteSegment, clearUnlocked, updateSettings,
      clearCloudQuotaFull, pinSegment, unpinSegment,
      setCameraRef, onSegmentStart, onSegmentComplete,
    ]
  );

  return (
    <DashcamContext.Provider value={value}>{children}</DashcamContext.Provider>
  );
}
