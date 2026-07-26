/**
 * useLiveActivity — iOS Dynamic Island / Lock Screen Live Activity hook.
 *
 * Mirrors the Android navigation notification lifecycle (see AppContext.tsx)
 * but drives the native ActivityKit bridge instead of an Expo notification.
 *
 * • Starts a Live Activity when navigation or trip-sharing becomes active.
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
} from "@/modules/live-activity";

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
}: LiveActivityInput): void {
  const activityActiveRef = useRef(false);
  const lastSpeedUpdateRef = useRef(0);

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
  });

  // ── Effect 1: structural changes (nav on/off, sharing, step advance) ────────
  useEffect(() => {
    // iOS only — no-op on Android and web.
    if (Platform.OS !== "ios") return;

    const isActive = navigationActive || isSharingTrip;

    if (!isActive) {
      if (activityActiveRef.current) {
        activityActiveRef.current = false;
        endActivity().catch(() => {});
      }
      return;
    }

    if (!activityActiveRef.current) {
      activityActiveRef.current = true;
      startActivity(buildState()).catch(() => {});
    } else {
      updateActivity(buildState()).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationActive, isSharingTrip, currentStepIdx, nextInstruction, destinationName]);

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
