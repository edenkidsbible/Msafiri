/**
 * useLiveActivity — iOS Dynamic Island / Lock Screen Live Activity hook.
 *
 * Mirrors the Android navigation notification lifecycle (see AppContext.tsx)
 * but drives the native ActivityKit bridge instead of an Expo notification.
 *
 * • Starts a Live Activity when navigation or trip-sharing becomes active.
 * • Uploads the APNs push token to the server so it can push ContentState
 *   updates directly when the app process is fully suspended by iOS.
 * • Listens for token rotations and re-uploads each new token.
 * • Updates it when the current step, speed, speed limit, or share status
 *   changes (step/share changes immediately; speed throttled to ≤1 Hz).
 * • Ends it when both navigation and sharing stop.
 *
 * Safe to call on Android and web — all effects gate on Platform.OS.
 */
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import {
  startActivity,
  updateActivity,
  endActivity,
  onPushTokenUpdate,
} from "@/modules/live-activity";
import { apiPatch } from "@/utils/apiClient";

export interface LiveActivityInput {
  navigationActive: boolean;
  isSharingTrip: boolean;
  currentSpeed: number;
  currentSpeedLimit: number | null;
  /** Instruction string for the current navigation step */
  nextInstruction: string | null;
  distToNextM: number | null;
  destinationName: string | null;
  /** currentStepIdx — used as a change trigger for step advances */
  currentStepIdx: number;
  /**
   * The sharing session token (UUID) returned by POST /share/session.
   * When provided, the Live Activity push token is uploaded to the server
   * so it can push ContentState updates directly via APNs.
   */
  shareToken: string | null;
  /** Device ID used for authenticated API calls */
  deviceId: string | null;
}

const SPEED_THROTTLE_MS = 1000; // update at most once per second for speed

export function useLiveActivity({
  navigationActive,
  isSharingTrip,
  currentSpeed,
  currentSpeedLimit,
  nextInstruction,
  distToNextM,
  destinationName,
  currentStepIdx,
  shareToken,
  deviceId,
}: LiveActivityInput): void {
  const activityActiveRef = useRef(false);
  const lastSpeedUpdateRef = useRef(0);
  /** Latest ActivityKit push token (hex). Persisted in a ref so it can be
   *  uploaded later if the sharing session starts after the activity does. */
  const latestPushTokenRef = useRef<string | null>(null);

  // Stable refs for values that don't need to re-trigger effects.
  const shareTokenRef = useRef(shareToken);
  shareTokenRef.current = shareToken;
  const deviceIdRef = useRef(deviceId);
  deviceIdRef.current = deviceId;

  // Capture the latest state in a ref so Effect 2 can read it without a
  // dependency that would re-run Effect 1 on every GPS fix.
  const stateRef = useRef({
    navigationActive,
    isSharingTrip,
    currentSpeed,
    currentSpeedLimit,
    nextInstruction,
    distToNextM,
    destinationName,
  });
  stateRef.current = {
    navigationActive,
    isSharingTrip,
    currentSpeed,
    currentSpeedLimit,
    nextInstruction,
    distToNextM,
    destinationName,
  };

  const buildState = () => ({
    speedKmh: stateRef.current.currentSpeed,
    speedLimitKmh: stateRef.current.currentSpeedLimit,
    nextInstruction: stateRef.current.nextInstruction,
    distToNextM: stateRef.current.distToNextM,
    destinationName: stateRef.current.destinationName,
    isSharingTrip: stateRef.current.isSharingTrip,
    // Unix timestamp in seconds — the widget greys out the speed when this
    // is >15 s old, indicating the app was suspended by iOS mid-trip.
    lastUpdatedAt: Date.now() / 1000,
  });

  /**
   * Store a push token and upload it to the server if a sharing session is
   * already active.  Storing in the ref ensures the token can be re-sent
   * when the sharing session starts *after* the Live Activity does.
   */
  const storePushToken = (pushTokenHex: string) => {
    latestPushTokenRef.current = pushTokenHex;
    const tk  = shareTokenRef.current;
    const did = deviceIdRef.current;
    if (!tk || !did) return; // will be uploaded by Effect 3 when shareToken arrives
    apiPatch(`/share/${tk}/activity-token`, { deviceId: did, pushToken: pushTokenHex })
      .catch((err) => {
        // Non-fatal — local JS updates keep the activity alive while foregrounded.
        console.warn("[useLiveActivity] Failed to upload Live Activity push token:", err);
      });
  };

  // ── Effect 0: subscribe to push-token rotation events ──────────────────────
  // ActivityKit may rotate the push token during a long activity (e.g. after
  // an APNs error).  Store and re-upload each new token.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const sub = onPushTokenUpdate((token) => {
      storePushToken(token);
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Effect 1: structural changes (nav on/off, sharing, step advance) ────────
  useEffect(() => {
    // iOS only — no-op on Android and web.
    if (Platform.OS !== "ios") return;

    const isActive = navigationActive || isSharingTrip;

    if (!isActive) {
      if (activityActiveRef.current) {
        activityActiveRef.current = false;
        latestPushTokenRef.current = null;
        endActivity().catch(() => {});
      }
      return;
    }

    if (!activityActiveRef.current) {
      activityActiveRef.current = true;
      startActivity(buildState()).then((pushToken) => {
        if (pushToken) storePushToken(pushToken);
      }).catch(() => {});
    } else {
      updateActivity(buildState()).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationActive, isSharingTrip, currentStepIdx, nextInstruction, destinationName]);

  // ── Effect 3: upload stored push token when sharing session becomes available
  // Handles the common "start navigation first, then start sharing" path:
  // the Live Activity is already running and we have a push token in the ref,
  // but shareToken was null when startActivity resolved.  This effect fires
  // whenever shareToken changes and uploads the stored token if present.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (!shareToken || !deviceId) return;
    if (!activityActiveRef.current) return;
    const token = latestPushTokenRef.current;
    if (!token) return;
    apiPatch(`/share/${shareToken}/activity-token`, { deviceId, pushToken: token })
      .catch((err) => {
        console.warn("[useLiveActivity] Failed to upload push token on session bind:", err);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareToken, deviceId]);

  // ── Effect 2: speed / limit changes, throttled to ≤1 Hz ────────────────────
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (!activityActiveRef.current) return;

    const now = Date.now();
    if (now - lastSpeedUpdateRef.current < SPEED_THROTTLE_MS) return;
    lastSpeedUpdateRef.current = now;

    updateActivity(buildState()).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSpeed, currentSpeedLimit]);
}
