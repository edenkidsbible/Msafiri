/**
 * Trial session tracking for the session-based free trial.
 *
 * A store-backed introductory trial includes at most FREE_TRIAL_SESSIONS
 * completed drive sessions. The count survives app
 * reinstall because it is keyed by RevenueCat's `originalAppUserId`, which
 * persists via the user's Apple ID (iOS) or Play Store account (Android).
 *
 * Exports:
 *  - useTrialSessions()       — React hook for _layout.tsx routing gate and
 *                               drive.tsx auto-start gate.
 *  - recordTrialSession()     — Standalone async function; call after each
 *                               completed drive session (no hook instance needed).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Purchases from "react-native-purchases";
import { API_BASE } from "@/utils/apiClient";

// Keep the constant in sync with the server (artifacts/api-server/src/routes/trial.ts).
export const FREE_TRIAL_SESSIONS = 3;

/** AsyncStorage key for the cached session count (offline & instant read). */
const CACHE_KEY = "@msafiri/trialSessionCount";

// ─────────────────────────────────────────────────────────────────────────────
// Standalone async function (no React state, safe to call from anywhere)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Records one completed drive session on the server and updates the local
 * AsyncStorage cache.  Falls back to an optimistic local increment when
 * offline so the cache stays close to truth.
 *
 * Returns the new server-confirmed session count, or null on failure.
 */
export async function recordTrialSession(deviceId?: string): Promise<number | null> {
  try {
    const info = await Purchases.getCustomerInfo();
    const stableId = info.originalAppUserId;
    if (!stableId || !API_BASE) return null;

    const res = await fetch(`${API_BASE}/trial/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stableDeviceId: stableId, ...(deviceId ? { deviceId } : {}) }),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { sessionCount: number };
    await AsyncStorage.setItem(CACHE_KEY, String(data.sessionCount));
    return data.sessionCount;
  } catch {
    // Offline or RC unavailable — optimistic local increment
    try {
      const cached = await AsyncStorage.getItem(CACHE_KEY);
      const next = (parseInt(cached ?? "0", 10) || 0) + 1;
      await AsyncStorage.setItem(CACHE_KEY, String(next));
      return next;
    } catch {
      return null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// React hook
// ─────────────────────────────────────────────────────────────────────────────

export interface TrialSessionStatus {
  sessionsUsed: number;
  trialExpired: boolean;
  /** True until the AsyncStorage cache has been read (resolves in < 50 ms). */
  isLoading: boolean;
  /**
   * Records a completed session AND updates local hook state so that
   * `trialExpired` reflects the new count immediately — no remount required.
   */
  recordSession: (deviceId?: string) => Promise<void>;
}

export function useTrialSessions(): TrialSessionStatus {
  const [sessionsUsed, setSessionsUsed] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  // Stable ref so fetchStatus closure doesn't capture a stale setter.
  const setSessionsRef = useRef(setSessionsUsed);
  setSessionsRef.current = setSessionsUsed;

  const fetchFromServer = useCallback(async () => {
    try {
      const info = await Purchases.getCustomerInfo();
      const stableId = info.originalAppUserId;
      if (!stableId || !API_BASE) return;

      const res = await fetch(
        `${API_BASE}/trial/status?stableDeviceId=${encodeURIComponent(stableId)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { sessionCount: number };
      setSessionsRef.current(data.sessionCount);
      await AsyncStorage.setItem(CACHE_KEY, String(data.sessionCount));
    } catch {
      // Offline — keep the cached value
    }
  }, []);

  // 1. Read cache immediately (< 50 ms) → isLoading = false
  // 2. Fetch fresh from server in the background (updates state asynchronously)
  useEffect(() => {
    AsyncStorage.getItem(CACHE_KEY)
      .then((cached) => {
        setSessionsUsed(parseInt(cached ?? "0", 10) || 0);
      })
      .catch(() => {})
      .finally(() => {
        setIsLoading(false);
        // Fire-and-forget server sync; any update flows through the setter ref.
        fetchFromServer();
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Records a session on the server and refreshes local state. */
  const recordSession = useCallback(async (deviceId?: string) => {
    const newCount = await recordTrialSession(deviceId);
    if (newCount !== null) {
      setSessionsUsed(newCount);
    }
  }, []);

  return {
    sessionsUsed,
    trialExpired: sessionsUsed >= FREE_TRIAL_SESSIONS,
    isLoading,
    recordSession,
  };
}
