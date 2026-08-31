/**
 * driveSessionApi.ts — Mobile client for the drive-session / driving-score API.
 *
 * A session is created when the driver taps "Start Drive", updated every 30 s,
 * and finalised when they tap "End Trip".  All calls are fire-and-forget safe:
 * callers should catch errors silently so an API failure never blocks the UI.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiGet, apiPost, apiPatch, API_BASE } from "@/utils/apiClient";
import Purchases from "react-native-purchases";

// ── Offline session queue ─────────────────────────────────────────────────────
//
// When startDriveSession fails (device offline) we generate a local placeholder
// ID, persist the session start data to AsyncStorage, and return the local ID so
// the drive screen can still reference it for the end call.  endDriveSession
// recognises the local prefix and appends the finalStats to the queued record
// instead of hitting the server.  flushOfflineSessions() replays every queued
// item against the server once connectivity is restored.

const OFFLINE_QUEUE_KEY = "msafiri_offline_sessions_v1";
export const LOCAL_PREFIX = "local-";

/** AsyncStorage key for the trial session count — kept in sync with useTrialSessions.ts. */
const TRIAL_CACHE_KEY = "@msafiri/trialSessionCount";

interface QueuedSession {
  localId:         string;
  startedAt:       string;          // ISO-8601 of when the trip actually started
  deviceId:        string;
  startLat?:       number | null;
  startLng?:       number | null;
  vehicleId?:      string | null;
  sharedVehicleId?: string | null;
  endData?: {
    endLat?:            number | null;
    endLng?:            number | null;
    distanceM:          number;
    durationS:          number;
    avgSpeedKmh:        number;
    maxSpeedKmh:        number;
    harshBrakes:        number;
    harshAccels:        number;
    sharpTurns:         number;
    speedingMinutes:    number;
    smoothMinutes:      number;
    speedCameraAlerts?: number;
    policeAlerts?:      number;
    hazardsEncountered?: number;
  };
  /** Server-assigned session ID saved after a successful drive-session POST.
   *  When set, retries skip the POST phase and go straight to trial recording. */
  flushedServerId?: string;
  /** True once the /trial/session POST has been confirmed server-side for this
   *  session.  Kept false until confirmed so retries complete a partial flush. */
  trialRecorded?: boolean;
}

async function readQueue(): Promise<QueuedSession[]> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedSession[]) : [];
  } catch { return []; }
}

async function writeQueue(q: QueuedSession[]): Promise<void> {
  try {
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q));
  } catch { /* non-fatal */ }
}

/**
 * Replay all queued offline sessions against the server.
 * Call this whenever the device comes back online.
 * Sessions that still fail (intermittent) remain in the queue for the next attempt.
 */
export async function flushOfflineSessions(deviceId: string): Promise<void> {
  const queue = await readQueue();
  if (queue.length === 0) return;

  const remaining: QueuedSession[] = [];
  for (const item of queue) {
    if (!item.endData) {
      // Trip was started but never ended (app killed mid-trip) — discard stale entry
      continue;
    }

    const needsTrial = (item.endData.distanceM ?? 0) >= 50;
    let flushedServerId = item.flushedServerId;
    let trialRecorded   = item.trialRecorded ?? false;

    // ── Phase 1: POST the drive session (skipped if already done on a prior attempt) ──
    if (!flushedServerId) {
      try {
        const { id } = await apiPost<{ id: string }>("/drive-sessions", {
          deviceId:        item.deviceId,
          startLat:        item.startLat        ?? null,
          startLng:        item.startLng        ?? null,
          vehicleId:       item.vehicleId       ?? null,
          sharedVehicleId: item.sharedVehicleId ?? null,
        });
        await apiPost(`/drive-sessions/${id}/end`, { deviceId: item.deviceId, ...item.endData });
        flushedServerId = id;
      } catch {
        remaining.push(item); // still offline — retry next time
        continue;
      }
    }

    // ── Phase 2: Record the trial session if qualifying and not yet confirmed ──
    // We call the server directly (no optimistic fallback) so a failure keeps the
    // item in the queue for a retry rather than silently losing the count.
    if (needsTrial && !trialRecorded) {
      try {
        const info    = await Purchases.getCustomerInfo();
        const stableId = info.originalAppUserId;
        if (!stableId || !API_BASE) throw new Error("RC not ready");
        const res = await fetch(`${API_BASE}/trial/session`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ stableDeviceId: stableId }),
        });
        if (!res.ok) throw new Error(`/trial/session returned ${res.status}`);
        const data = (await res.json()) as { sessionCount: number };
        // Sync the server-confirmed count to the AsyncStorage cache so
        // useTrialSessions() reads the correct value on the next app focus.
        await AsyncStorage.setItem(TRIAL_CACHE_KEY, String(data.sessionCount));
        trialRecorded = true;
      } catch {
        // Trial server unreachable — keep in queue so we retry on the next
        // reconnect, but store flushedServerId so Phase 1 is not repeated.
        remaining.push({ ...item, flushedServerId, trialRecorded: false });
        continue;
      }
    }

    // Both phases complete — item is fully flushed; drop it from the queue.
  }
  await writeQueue(remaining);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DriveSession {
  id:                 string;
  deviceId:           string;
  startedAt:          string; // ISO-8601
  endedAt:            string | null;
  startLat:           number | null;
  startLng:           number | null;
  endLat:             number | null;
  endLng:             number | null;
  distanceM:          number;
  durationS:          number | null;
  avgSpeedKmh:        number | null;
  maxSpeedKmh:        number | null;
  score:              number | null;
  harshBrakes:        number;
  harshAccels:        number;
  sharpTurns:         number;
  speedingMinutes:    number;
  smoothMinutes:      number;
  speedCameraAlerts:  number;
  policeAlerts:       number;
  hazardsEncountered: number;
  createdAt:          string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the score colour for a given score value (0–100). */
export function scoreColor(score: number): string {
  if (score >= 95) return "#00C853";
  if (score >= 90) return "#43A047";
  if (score >= 80) return "#FBC02D";
  if (score >= 70) return "#FB8C00";
  return "#E53935";
}

/** Returns the text label for a given score value (0–100). */
export function scoreLabel(score: number): string {
  if (score >= 95) return "Excellent";
  if (score >= 90) return "Great";
  if (score >= 80) return "Good";
  if (score >= 70) return "Fair";
  return "Needs Improvement";
}

/** Human-readable duration from seconds, e.g. "1h 23m" or "42m". */
export function formatDuration(s: number): string {
  if (s <= 0) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── API calls ─────────────────────────────────────────────────────────────────

/**
 * Create a new drive session on the server.
 * Returns the session ID or null on failure.
 */
export async function startDriveSession(
  deviceId:        string,
  startLat?:       number | null,
  startLng?:       number | null,
  vehicleId?:      string | null,
  sharedVehicleId?: string | null,
): Promise<string> {
  try {
    const { id } = await apiPost<{ id: string }>("/drive-sessions", {
      deviceId,
      startLat:        startLat        ?? null,
      startLng:        startLng        ?? null,
      vehicleId:       vehicleId       ?? null,
      sharedVehicleId: sharedVehicleId ?? null,
    });
    return id;
  } catch {
    // Offline — queue the session locally so it can be replayed on reconnect.
    // Return a local placeholder ID so the drive screen can still reference it.
    const localId = LOCAL_PREFIX + Date.now();
    const queue   = await readQueue();
    queue.push({
      localId,
      startedAt:       new Date().toISOString(),
      deviceId,
      startLat,
      startLng,
      vehicleId,
      sharedVehicleId,
    });
    await writeQueue(queue);
    return localId;
  }
}

/**
 * Push a mid-trip stats snapshot to the server.
 * Silently no-ops if any argument is missing.
 */
export async function updateDriveSession(
  sessionId: string,
  deviceId:  string,
  stats: {
    distanceM?:          number;
    maxSpeedKmh?:        number;
    avgSpeedKmh?:        number;
    harshBrakes?:        number;
    harshAccels?:        number;
    sharpTurns?:         number;
    speedingMinutes?:    number;
    smoothMinutes?:      number;
    speedCameraAlerts?:  number;
    policeAlerts?:       number;
  },
): Promise<void> {
  await apiPatch(`/drive-sessions/${sessionId}`, { deviceId, ...stats });
}

/**
 * Finalise the session, compute the server-side driving score, and return it.
 */
export async function endDriveSession(
  sessionId: string,
  deviceId:  string,
  finalStats: {
    endLat?:            number | null;
    endLng?:            number | null;
    distanceM:          number;
    durationS:          number;
    avgSpeedKmh:        number;
    maxSpeedKmh:        number;
    harshBrakes:        number;
    harshAccels:        number;
    sharpTurns:         number;
    speedingMinutes:    number;
    smoothMinutes:      number;
    speedCameraAlerts?: number;
    policeAlerts?:      number;
    hazardsEncountered?: number;
  },
): Promise<{ score: number; endedAt: string }> {
  // If this is an offline-queued session, attach the end data and return a
  // synthetic response — the real server call happens in flushOfflineSessions().
  if (sessionId.startsWith(LOCAL_PREFIX)) {
    const queue = await readQueue();
    const idx   = queue.findIndex((s) => s.localId === sessionId);
    if (idx >= 0) {
      queue[idx].endData = finalStats;
      await writeQueue(queue);
    }
    return { score: 0, endedAt: new Date().toISOString() };
  }
  return apiPost<{ score: number; endedAt: string }>(
    `/drive-sessions/${sessionId}/end`,
    { deviceId, ...finalStats },
  );
}

/**
 * Fetch a single drive session by id (device-scoped).
 */
export async function getDriveSession(
  deviceId:  string,
  sessionId: string,
): Promise<DriveSession> {
  return apiGet<DriveSession>(
    `/drive-sessions/${encodeURIComponent(sessionId)}?deviceId=${encodeURIComponent(deviceId)}`,
  );
}

/**
 * Fetch aggregate stats (distance, duration, trip count) across ALL co-drivers
 * of a shared vehicle. Only totals are returned — per-session details and
 * individual driving scores are never surfaced to other members.
 */
export async function getSharedVehicleStats(
  sharedVehicleId: string,
): Promise<{ totalDistM: number; totalDurS: number; totalTrips: number }> {
  return apiGet<{ totalDistM: number; totalDurS: number; totalTrips: number }>(
    `/drive-sessions/shared-stats?sharedVehicleId=${encodeURIComponent(sharedVehicleId)}`,
  );
}

/**
 * Fetch aggregate totals (distance, duration, trip count) for a personal
 * vehicle from the server. Unlike listDriveSessions this is a server-side SUM
 * so it covers ALL completed trips regardless of pagination limits.
 */
export async function getPersonalVehicleStats(
  deviceId: string,
  vehicleId?: string | null,
  includeNullVehicle?: boolean,
): Promise<{ totalDistM: number; totalDurS: number; totalTrips: number }> {
  let url = `/drive-sessions/personal-stats?deviceId=${encodeURIComponent(deviceId)}`;
  if (vehicleId) {
    url += `&vehicleId=${encodeURIComponent(vehicleId)}`;
    if (includeNullVehicle) url += `&includeNullVehicle=true`;
  }
  return apiGet<{ totalDistM: number; totalDurS: number; totalTrips: number }>(url);
}

/**
 * Fetch the completed drive sessions for a device (newest first).
 *
 * @param vehicleId          - Filter to a specific vehicle. Omit to return all.
 * @param includeNullVehicle - When true, also include legacy rows that have no
 *                             vehicle_id (pre-tracking sessions). Pass true when
 *                             the default vehicle is selected so those old trips
 *                             still appear in its history.
 */
export async function listDriveSessions(
  deviceId: string,
  limit  = 20,
  offset = 0,
  vehicleId?: string | null,
  includeNullVehicle?: boolean,
): Promise<{ sessions: DriveSession[]; total: number }> {
  let url = `/drive-sessions?deviceId=${encodeURIComponent(deviceId)}&limit=${limit}&offset=${offset}`;
  if (vehicleId) {
    url += `&vehicleId=${encodeURIComponent(vehicleId)}`;
    if (includeNullVehicle) url += `&includeNullVehicle=true`;
  }
  return apiGet<{ sessions: DriveSession[]; total: number }>(url);
}
