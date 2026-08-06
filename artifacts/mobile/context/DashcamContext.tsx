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
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { API_BASE } from "@/utils/apiClient";
import type { CameraView } from "expo-camera";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DashcamSegment {
  id: string;
  uri: string;
  startedAt: number;    // epoch ms
  durationS: number;
  sizeBytes: number;
  locked: boolean;
  lockReason?: string;
  uploadStatus: "none" | "pending" | "uploading" | "uploaded" | "failed";
  fileKey?: string;     // R2 key once uploaded
  serverId?: string;    // DB id once saved on server
  retryCount?: number;  // upload attempts so far (for bounded backoff)
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
   * The push-notification device ID loaded from AsyncStorage key
   * "@msafiri/deviceId" — the same key used by usePushNotifications.ts and
   * stored in push_tokens. Must be used for ALL dashcam API requests so that
   * enrollment, upload, and gallery auth resolve to the correct push_tokens row.
   */
  pushDeviceId: string | null;
  openDashcam: () => void;
  closeDashcam: () => void;
  startDashcam: () => void;
  stopDashcam: () => void;
  /** Start recording silently without showing the dashcam overlay UI.
   *  The CameraView warms up at opacity 0; recording begins once the camera
   *  is ready. The drive-screen pill shows "● REC" immediately after. */
  startBackgroundRecording: () => void;
  /** Called by DashcamOverlay once the camera is ready and recording starts. */
  clearBackgroundRecordPending: () => void;
  lockCurrentClip: (reason?: string) => void;
  deleteSegment: (id: string) => Promise<void>;
  clearUnlocked: () => Promise<void>;
  updateSettings: (partial: Partial<DashcamSettings>) => Promise<void>;
  // Internal — called by DashcamOverlay
  setCameraRef: (ref: CameraView | null) => void;
  onSegmentComplete: (tempUri: string, durationS?: number) => Promise<void>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SEGMENTS_KEY = "dashcam_segments_v1";
const SETTINGS_KEY = "dashcam_settings_v1";
const SECRET_KEY   = "dashcam_secret_v1";
const SEGMENTS_DIR = `${FileSystem.documentDirectory ?? ""}dashcam/segments/`;

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
  audioEnabled: true,
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

  const [isRecording, setIsRecording]             = useState(false);
  const [isDashcamOpen, setIsDashcamOpen]         = useState(false);
  const [backgroundRecordPending, setBackgroundRecordPending] = useState(false);
  const [segments, setSegments]             = useState<DashcamSegment[]>([]);
  const [settings, setSettings]             = useState<DashcamSettings>(DEFAULT_SETTINGS);
  const [currentSegmentDuration, setCurrentSegmentDuration] = useState(0);
  /**
   * `hydrated` becomes true only AFTER AsyncStorage is loaded AND the upload
   * queue is rebuilt. Enrollment/upload effects gate on this flag.
   */
  const [hydrated, setHydrated]             = useState(false);
  /** The push-notification device ID — same key as usePushNotifications. */
  const [pushDeviceId, setPushDeviceId]     = useState<string | null>(null);

  // Refs — avoid re-renders on GPS/interval ticks
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
  // Stable ref to processUploadQueue so setTimeout callbacks always call the
  // latest version without adding it to dependency arrays (which would create
  // circular deps since processUploadQueue's setTimeout calls itself).
  const processUploadQueueRef  = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => { segmentsRef.current = segments; }, [segments]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

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

        // 4. Load + verify segments
        const rawSegs = await AsyncStorage.getItem(SEGMENTS_KEY);
        if (rawSegs) {
          const loaded: DashcamSegment[] = JSON.parse(rawSegs);
          const verified = await Promise.all(
            loaded.map(async (s) => {
              // Uploaded segments no longer need a local file
              if (s.uploadStatus === "uploaded") return s;
              try {
                const info = await FileSystem.getInfoAsync(s.uri);
                return info.exists ? s : null;
              } catch {
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

        // 4. Ensure segments directory exists
        await FileSystem.makeDirectoryAsync(SEGMENTS_DIR, { intermediates: true });
      } catch (err) {
        console.warn("[Dashcam] hydration error:", err);
      } finally {
        // Signal readiness AFTER queue is rebuilt — the upload effect gates on this
        hydratedRef.current = true;
        setHydrated(true);
      }
    })();
  }, []);

  // ── Persist segments on change ─────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.setItem(SEGMENTS_KEY, JSON.stringify(segments)).catch(() => {});
  }, [segments]);

  // ── Elapsed-time counter ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isRecording) { setCurrentSegmentDuration(0); return; }
    segmentStartRef.current = Date.now();
    const id = setInterval(() => {
      setCurrentSegmentDuration(Math.floor((Date.now() - segmentStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isRecording]);

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
        if (!urlRes.ok) throw new Error(`Upload URL: ${urlRes.status}`);
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

  // ── Two-phase push-OTP enrollment ─────────────────────────────────────────
  //
  // Phase 1 (called on hydration): POST /dashcam/register with no otp body.
  //   If already enrolled → { ok: true, registered: false } → proceed to upload.
  //   If new device → { pending: true } → server sends visible push notification
  //   with OTP in the data payload. The push is visible so it can be:
  //     a) received in-app  via addNotificationReceivedListener (foreground)
  //     b) tapped by user   via addNotificationResponseReceivedListener (background)
  //     c) retrieved at cold start via getLastNotificationResponseAsync()
  //
  // Phase 2: extract OTP from notification data, POST /dashcam/register with { otp }.

  /** Execute Phase 2 OTP verification from any notification delivery path. */
  const verifyEnrollmentOtp = useCallback(
    (data: Record<string, unknown>) => {
      if (data.type !== "dashcam_enrollment_otp") return;
      // Ensure the OTP notification is for this specific device
      if (data.deviceId !== pushDeviceIdRef.current) return;
      const otp    = data.otp as string | undefined;
      const secret = secretRef.current;
      const did    = pushDeviceIdRef.current;
      if (!otp || !secret || !did || !API_BASE) return;

      fetch(`${API_BASE}/dashcam/register`, {
        method:  "POST",
        headers: { ...authHeaders(did, secret), "Content-Type": "application/json" },
        body:    JSON.stringify({ otp }),
      })
        .then(async (res) => {
          if (res.ok) {
            console.log("[Dashcam] enrolled via push-OTP");
            processUploadQueueRef.current();
          } else {
            console.warn("[Dashcam] enrollment Phase 2 error:", res.status);
          }
        })
        .catch((err) => console.warn("[Dashcam] enrollment Phase 2 failed:", err));
    },
    [pushDeviceId]   // re-create if pushDeviceId changes (first load)
  );

  // Phase 1: request OTP on hydration (idempotent if already enrolled).
  // Depends on pushDeviceId (not AppContext.deviceId) because push_tokens
  // stores the @msafiri/deviceId key, not sdk_device_id.
  useEffect(() => {
    if (!hydrated || !pushDeviceId || !API_BASE) return;
    const secret = secretRef.current;
    if (!secret) return;

    fetch(`${API_BASE}/dashcam/register`, {
      method: "POST",
      headers: authHeaders(pushDeviceId, secret),
    })
      .then(async (res) => {
        if (!res.ok) { console.warn("[Dashcam] enrollment Phase 1 error:", res.status); return; }
        const data = await res.json();
        if (!data.pending) processUploadQueueRef.current(); // already enrolled
      })
      .catch((err) => console.warn("[Dashcam] enrollment Phase 1 failed:", err));
  }, [hydrated, pushDeviceId]);

  // Phase 2a: foreground — OTP notification received while app is in foreground
  useEffect(() => {
    if (!pushDeviceId) return;
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, unknown> | undefined;
      if (data) verifyEnrollmentOtp(data);
    });
    return () => sub.remove();
  }, [pushDeviceId, verifyEnrollmentOtp]);

  // Phase 2b: background — user tapped the OTP notification while app was backgrounded
  useEffect(() => {
    if (!pushDeviceId) return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      if (data) verifyEnrollmentOtp(data);
    });
    return () => sub.remove();
  }, [pushDeviceId, verifyEnrollmentOtp]);

  // Phase 2c: cold start — retrieve last notification response on mount.
  // Handles the case where the user tapped the OTP notification while the
  // app was fully closed; the response is available on next launch.
  useEffect(() => {
    if (!pushDeviceId) return;
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!response) return;
        const data = response.notification.request.content.data as Record<string, unknown> | undefined;
        if (data) verifyEnrollmentOtp(data);
      })
      .catch(() => {}); // not critical — Phase 1 on next launch re-sends OTP
  }, [pushDeviceId, verifyEnrollmentOtp]);

  // ─── Public API ─────────────────────────────────────────────────────────────

  const openDashcam  = useCallback(() => setIsDashcamOpen(true), []);
  const closeDashcam = useCallback(() => setIsDashcamOpen(false), []);

  /** Start recording silently — overlay mounts at opacity 0, camera auto-starts
   *  in onCameraReady without ever showing the dashcam UI. */
  const startBackgroundRecording = useCallback(() => {
    if (isRecordingRef.current) return; // already recording, nothing to do
    setBackgroundRecordPending(true);
  }, []);

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
    cameraRef.current?.stopRecording();
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

  const onSegmentComplete = useCallback(
    async (tempUri: string, durationS?: number) => {
      const lockReason = lockNextRef.current;
      lockNextRef.current = null;

      segmentStartRef.current = Date.now();
      setCurrentSegmentDuration(0);

      const id      = `seg_${Date.now()}`;
      const destUri = `${SEGMENTS_DIR}${id}.mp4`;

      try {
        await FileSystem.moveAsync({ from: tempUri, to: destUri });
        const info      = await FileSystem.getInfoAsync(destUri);
        const sizeBytes = (info as any).size ?? 0;

        const segment: DashcamSegment = {
          id,
          uri:          destUri,
          startedAt:    Date.now() - (durationS ?? 120) * 1000,
          durationS:    durationS ?? 120,
          sizeBytes,
          locked:       !!lockReason,
          lockReason:   lockReason ?? undefined,
          uploadStatus: lockReason ? "pending" : "none",
        };

        setSegments((prev) => {
          const next = evictIfNeeded([...prev, segment]);
          segmentsRef.current = next;
          return next;
        });

        if (lockReason) {
          uploadQueueRef.current.push(id);
          processUploadQueue();
        }
      } catch (err) {
        console.warn("[Dashcam] onSegmentComplete error:", err);
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
    },
    [pushDeviceId]
  );

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
      pushDeviceId,
      openDashcam, closeDashcam, startDashcam, stopDashcam,
      startBackgroundRecording, clearBackgroundRecordPending,
      lockCurrentClip, deleteSegment, clearUnlocked, updateSettings,
      setCameraRef, onSegmentComplete,
    }),
    [
      isRecording, isDashcamOpen, backgroundRecordPending, segments, storageUsedBytes,
      currentSegmentDuration, uploadPending, settings,
      pushDeviceId,
      openDashcam, closeDashcam, startDashcam, stopDashcam,
      startBackgroundRecording, clearBackgroundRecordPending,
      lockCurrentClip, deleteSegment, clearUnlocked, updateSettings,
      setCameraRef, onSegmentComplete,
    ]
  );

  return (
    <DashcamContext.Provider value={value}>{children}</DashcamContext.Provider>
  );
}
