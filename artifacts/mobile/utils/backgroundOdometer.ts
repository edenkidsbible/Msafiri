/**
 * Background odometer task.
 *
 * The GPS watch in AppContext (`handleLocation` via `watchPositionAsync`) only
 * receives fixes while the app is foregrounded. This task keeps driving
 * distance accumulating when the app is backgrounded or the screen is locked
 * — for BOTH active trips and the continuous (no-trip) odometer — so the
 * vehicle-care odometer no longer drifts low on locked-phone drives.
 *
 * ── Single-owner accounting model (no double-counting) ───────────────────────
 *  • While the app is backgrounded, THIS task is the sole owner of distance.
 *    It persists only a session-scoped ledger (pending metres + last fix); it
 *    never writes to vehicle-care storage itself.
 *  • On foreground resume, AppContext consumes the ledger exactly once and
 *    routes the metres to ONE destination: the active trip's distance (so the
 *    single trip-end credit includes the background segment) or a direct
 *    durable odometer credit when no trip is live.
 *  • While the task is running, the foreground accumulators are gated off
 *    (see `bgOdoActiveRef` in AppContext), so even if the OS keeps the
 *    foreground watch alive in background, fixes are not counted twice.
 *  • If the app is killed while backgrounded, the ledger persists and is
 *    consumed once on the next launch.
 *
 * ── Race-safe handoff protocol (session ownership) ───────────────────────────
 * `stopLocationUpdatesAsync` prevents NEW task invocations but cannot cancel
 * one already executing; that invocation could write a stale balance back
 * AFTER the foreground consumed it, double-crediting on the next consume.
 * The protocol makes such stale writes harmless:
 *
 *   SESSION key — an ownership token. Written (fresh id) by `begin`, removed
 *                 by `consume`. A task invocation is only authorized to
 *                 accumulate while the token exists, and stamps every state
 *                 write with the token it read.
 *   STATE key   — JSON { sessionId, pendingM, prev }.
 *
 *   `consume` credits the state ONLY when state.sessionId === SESSION token,
 *   then deletes both keys. A stale in-flight invocation that writes after
 *   consume produces state stamped with a token that no longer exists (or no
 *   longer matches a newer session), so every later consume discards it.
 *   Worst case under interleaving is a few lost metres from one GPS batch —
 *   never a double credit.
 *
 * The pure protocol functions (`bgOdoAccumulateCore`, `bgOdoBeginCore`,
 * `bgOdoConsumeCore`) operate on a minimal async key-value interface so the
 * handoff logic is unit-testable without native modules
 * (see __tests__/backgroundOdometer.test.mjs).
 *
 * IMPORTANT: `defineBackgroundOdometerTask()` must be called at the top level
 * of the app entry point (app/_layout.tsx) — expo-task-manager requires tasks
 * to be registered synchronously at startup.
 */

import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export const BG_ODOMETER_TASK = "MSAFIRI_BG_ODOMETER";

// ── AsyncStorage keys ─────────────────────────────────────────────────────────
export const BG_ODO_SESSION_KEY = "@msafiri/bgOdoSession";
export const BG_ODO_STATE_KEY   = "@msafiri/bgOdoState";

// Ignore GPS jumps ≥ 500 m between consecutive fixes (signal-loss artefacts) —
// matches the foreground trip / continuous-odometer filters in AppContext.
const MAX_SEGMENT_M = 500;

export interface BgOdoFix { lat: number; lng: number; t: number }

export interface BgOdoState {
  sessionId: string;
  pendingM: number;
  prev: BgOdoFix | null;
}

/** Minimal async key-value store — satisfied by AsyncStorage. */
export interface KvStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function bgOdoHaversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180;
  const f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(df / 2) ** 2 +
    Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Pure protocol core (unit-tested) ─────────────────────────────────────────

/**
 * Begin a new background stint: writes a fresh session token and a zeroed
 * ledger seeded with the foreground's last known position (so the gap between
 * the last foreground fix and the first background fix still counts).
 */
export async function bgOdoBeginCore(
  store: KvStore,
  seed: { lat: number; lng: number } | null,
): Promise<string> {
  const sessionId =
    Date.now().toString(36) + Math.random().toString(36).slice(2);
  const state: BgOdoState = {
    sessionId,
    pendingM: 0,
    prev: seed ? { lat: seed.lat, lng: seed.lng, t: Date.now() } : null,
  };
  // State first, then the token: an invocation racing this begin either sees
  // no token (no-op) or a token whose state already exists and matches.
  await store.setItem(BG_ODO_STATE_KEY, JSON.stringify(state));
  await store.setItem(BG_ODO_SESSION_KEY, sessionId);
  return sessionId;
}

/**
 * Task-invocation core: accumulate a batch of fixes into the session ledger.
 * No-ops when no session token exists (stopped/consumed); resets the ledger
 * when its session stamp doesn't match the current token.
 */
export async function bgOdoAccumulateCore(
  store: KvStore,
  fixes: BgOdoFix[],
): Promise<void> {
  if (!fixes.length) return;

  const sessionId = await store.getItem(BG_ODO_SESSION_KEY);
  if (!sessionId) return; // not authorized — stint was stopped or consumed

  let state: BgOdoState | null = null;
  try {
    const raw = await store.getItem(BG_ODO_STATE_KEY);
    state = raw ? (JSON.parse(raw) as BgOdoState) : null;
  } catch {}
  if (!state || state.sessionId !== sessionId) {
    state = { sessionId, pendingM: 0, prev: null };
  }

  let prev = state.prev;
  let pendingM = state.pendingM;
  for (const fix of fixes) {
    if (prev) {
      const d = bgOdoHaversine(prev.lat, prev.lng, fix.lat, fix.lng);
      if (d > 0 && d < MAX_SEGMENT_M) pendingM += d;
    }
    prev = fix;
  }

  await store.setItem(
    BG_ODO_STATE_KEY,
    JSON.stringify({ sessionId, pendingM, prev } satisfies BgOdoState),
  );
}

/**
 * Consume the stint's ledger exactly once. Credits the state only when its
 * session stamp matches the live token, then deletes both keys, so a stale
 * task write landing after this call is discarded by every later consume.
 */
export async function bgOdoConsumeCore(store: KvStore): Promise<{
  pendingM: number;
  lastFix: { lat: number; lng: number } | null;
}> {
  const [sessionId, stateRaw] = await Promise.all([
    store.getItem(BG_ODO_SESSION_KEY),
    store.getItem(BG_ODO_STATE_KEY),
  ]);
  await Promise.all([
    store.removeItem(BG_ODO_SESSION_KEY),
    store.removeItem(BG_ODO_STATE_KEY),
  ]);

  if (!sessionId || !stateRaw) return { pendingM: 0, lastFix: null };
  let state: BgOdoState | null = null;
  try { state = JSON.parse(stateRaw) as BgOdoState; } catch {}
  if (!state || state.sessionId !== sessionId) return { pendingM: 0, lastFix: null };

  const lastFix =
    state.prev && typeof state.prev.lat === "number" && typeof state.prev.lng === "number"
      ? { lat: state.prev.lat, lng: state.prev.lng }
      : null;
  return { pendingM: state.pendingM > 0 ? state.pendingM : 0, lastFix };
}

// ─── Task definition ──────────────────────────────────────────────────────────

/**
 * Register the background odometer task with expo-task-manager.
 * Call once at module load time in `app/_layout.tsx`.
 */
export function defineBackgroundOdometerTask(): void {
  if (Platform.OS === "web") return;
  if (TaskManager.isTaskDefined(BG_ODOMETER_TASK)) return;

  TaskManager.defineTask(
    BG_ODOMETER_TASK,
    async ({
      data,
      error,
    }: TaskManager.TaskManagerTaskBody<{ locations: Location.LocationObject[] }>) => {
      try {
        if (error) {
          console.warn("[bgOdometer] error:", error.message);
          return;
        }
        const locations =
          (data as any)?.locations as Location.LocationObject[] | undefined;
        if (!locations?.length) return;
        // Walk every fix in the batch so multi-fix deliveries (common on
        // Android when the OS batches background updates) all count.
        const fixes: BgOdoFix[] = locations.map((loc) => ({
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          t: loc.timestamp ?? Date.now(),
        }));
        await bgOdoAccumulateCore(AsyncStorage, fixes);
      } catch (e) {
        console.warn("[bgOdometer] unhandled error:", e);
      }
    },
  );
}

// ─── Task lifecycle ───────────────────────────────────────────────────────────

/**
 * Start background odometer tracking for a new stint. Called by AppContext
 * when the app is backgrounded (through its serialized reconciler).
 *
 * Returns true if the task is running with a fresh session.
 * Returns false when background location permission has not been granted.
 */
export async function startBackgroundOdometerTask(
  seed?: { lat: number; lng: number } | null,
): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const { status } = await Location.getBackgroundPermissionsAsync();
    if (status !== "granted") return false;

    await bgOdoBeginCore(AsyncStorage, seed ?? null);

    const isRunning = await Location.hasStartedLocationUpdatesAsync(
      BG_ODOMETER_TASK,
    ).catch(() => false);
    if (isRunning) return true;

    await Location.startLocationUpdatesAsync(BG_ODOMETER_TASK, {
      accuracy: Location.Accuracy.Balanced,
      // Wake every 100 m — matches the foreground flush granularity while
      // staying battery-friendly; odometer accuracy doesn't need tighter fixes.
      distanceInterval: 100,
      // Silent: no iOS blue pill (the share task shows one when sharing is on).
      showsBackgroundLocationIndicator: false,
    });
    return true;
  } catch (e) {
    console.warn("[bgOdometer] start failed:", e);
    return false;
  }
}

/** Stop the background odometer location task. */
export async function stopBackgroundOdometerTask(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(
      BG_ODOMETER_TASK,
    ).catch(() => false);
    if (isRunning) await Location.stopLocationUpdatesAsync(BG_ODOMETER_TASK);
  } catch {
    // Ignore — task may not be registered yet
  }
}

/**
 * Consume the background stint's ledger exactly once (session-checked).
 * Returns the pending metres and the last background fix so the caller can
 * resume measuring from it.
 */
export async function consumeBackgroundOdometer(): Promise<{
  pendingM: number;
  lastFix: { lat: number; lng: number } | null;
}> {
  if (Platform.OS === "web") return { pendingM: 0, lastFix: null };
  try {
    return await bgOdoConsumeCore(AsyncStorage);
  } catch {
    return { pendingM: 0, lastFix: null };
  }
}
