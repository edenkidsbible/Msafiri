/**
 * driveSessionApi.ts — Mobile client for the drive-session / driving-score API.
 *
 * A session is created when the driver taps "Start Drive", updated every 30 s,
 * and finalised when they tap "End Trip".  All calls are fire-and-forget safe:
 * callers should catch errors silently so an API failure never blocks the UI.
 */

import { apiGet, apiPost, apiPatch } from "@/utils/apiClient";

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
  deviceId:  string,
  startLat?: number | null,
  startLng?: number | null,
): Promise<string> {
  const { id } = await apiPost<{ id: string }>("/drive-sessions", {
    deviceId,
    startLat: startLat ?? null,
    startLng: startLng ?? null,
  });
  return id;
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
  return apiPost<{ score: number; endedAt: string }>(
    `/drive-sessions/${sessionId}/end`,
    { deviceId, ...finalStats },
  );
}

/**
 * Fetch the completed drive sessions for a device (newest first).
 */
export async function listDriveSessions(
  deviceId: string,
  limit  = 20,
  offset = 0,
): Promise<{ sessions: DriveSession[]; total: number }> {
  return apiGet<{ sessions: DriveSession[]; total: number }>(
    `/drive-sessions?deviceId=${encodeURIComponent(deviceId)}&limit=${limit}&offset=${offset}`,
  );
}
