/**
 * Background drive-session alert task.
 *
 * When the driver has an active trip and the app is backgrounded or the screen
 * is locked, this task receives background GPS updates from expo-location and
 * evaluates them against a locally cached set of speed zones and community
 * reports. If the driver is approaching an alertable zone (within ALERT_DIST
 * but outside IN_ZONE_DIST), a local notification fires with the alert tone.
 *
 * IMPORTANT: `defineBackgroundDriveAlertsTask()` must be called at the top
 * level of the app entry point (before any React components mount) —
 * expo-task-manager requires tasks to be registered synchronously at startup.
 *
 * ── AsyncStorage contract (written by AppContext, read here) ─────────────────
 *   @msafiri/bgDriveActive      "true" | "false"
 *   @msafiri/bgSessionId        string  — new UUID each time a trip starts;
 *                                         used to scope per-session dedup
 *   @msafiri/bgZonesCache       JSON BgZoneEntry[]   — compact zone list
 *   @msafiri/bgReportsCache     JSON BgReportEntry[] — compact active reports
 *   @msafiri/bgNotifiedAlerts   JSON BgNotifiedMap   — dedup state, reset
 *                                                      when session ID changes
 */

import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export const BG_DRIVE_ALERTS_TASK = "MSAFIRI_BG_DRIVE_ALERTS";

// ── AsyncStorage keys (exported so AppContext can write them) ─────────────────
export const BG_DRIVE_ACTIVE_KEY    = "@msafiri/bgDriveActive";
export const BG_SESSION_ID_KEY      = "@msafiri/bgSessionId";
export const BG_ZONES_CACHE_KEY     = "@msafiri/bgZonesCache";
export const BG_REPORTS_CACHE_KEY   = "@msafiri/bgReportsCache";
const        BG_NOTIFIED_ALERTS_KEY = "@msafiri/bgNotifiedAlerts";

// ── Alert thresholds (match foreground AppContext values) ─────────────────────
const ALERT_DIST   = 600; // m — outer boundary: notify when approaching
const IN_ZONE_DIST = 250; // m — inner boundary: driver is already inside, skip

// Don't re-notify the same zone/report within 5 minutes even if the driver
// circles back. This matches the foreground dismiss-cooldown behaviour.
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

// ── Data types ────────────────────────────────────────────────────────────────

/** Compact zone entry persisted by AppContext for the background task. */
export interface BgZoneEntry {
  id: string;
  lat: number;
  lng: number;
  type: string;
  speedLimit?: number | null;
  name: string;
}

/** Compact community-report entry persisted by AppContext. */
export interface BgReportEntry {
  id: string;
  lat: number;
  lng: number;
  type: string;
  speedLimit?: number | null;
}

/** Per-session notification dedup map stored in AsyncStorage. */
interface BgNotifiedMap {
  /** Matches the session ID written at trip start. If mismatched, the whole
   *  map is discarded so stale dedup entries from a prior drive never block
   *  alerts on the current one. */
  sessionId: string;
  /** alertId → epoch ms of the last notification for that alert. */
  notified: Record<string, number>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

const TYPE_LABELS: Record<string, string> = {
  camera:    "Speed camera",
  police:    "Police checkpoint",
  alcoblow:  "Alcoblow checkpoint",
  hazard:    "Hazard",
  accident:  "Accident",
  pothole:   "Pothole",
  roadblock: "Roadblock",
  roadworks: "Road works",
  traffic:   "Traffic",
  weather:   "Weather hazard",
  debris:    "Debris on road",
  breakdown: "Breakdown",
  closure:   "Road closure",
};

// ─── Task definition ──────────────────────────────────────────────────────────

/**
 * Register the background alert task with expo-task-manager.
 * Call once at module load time in `app/_layout.tsx`.
 */
export function defineBackgroundDriveAlertsTask(): void {
  if (Platform.OS === "web") return;
  if (TaskManager.isTaskDefined(BG_DRIVE_ALERTS_TASK)) return;

  TaskManager.defineTask(
    BG_DRIVE_ALERTS_TASK,
    async ({
      data,
      error,
    }: TaskManager.TaskManagerTaskBody<{ locations: Location.LocationObject[] }>) => {
      try {
        if (error) {
          console.warn("[bgDriveAlerts] error:", error.message);
          return;
        }

        // ── 1. Guard: only run when a drive session is active ──────────────
        const activeRaw = await AsyncStorage.getItem(BG_DRIVE_ACTIVE_KEY);
        if (activeRaw !== "true") return;

        // ── 2. Extract the latest GPS fix from this background invocation ──
        const locations =
          (data as any)?.locations as Location.LocationObject[] | undefined;
        if (!locations?.length) return;
        const loc = locations[locations.length - 1];
        const lat = loc.coords.latitude;
        const lng = loc.coords.longitude;

        // ── 3. Load all data in parallel ───────────────────────────────────
        const [sessionIdRaw, zonesRaw, reportsRaw, notifiedRaw] =
          await Promise.all([
            AsyncStorage.getItem(BG_SESSION_ID_KEY),
            AsyncStorage.getItem(BG_ZONES_CACHE_KEY),
            AsyncStorage.getItem(BG_REPORTS_CACHE_KEY),
            AsyncStorage.getItem(BG_NOTIFIED_ALERTS_KEY),
          ]);

        const sessionId = sessionIdRaw ?? "unknown";

        // Parse + validate the dedup map; reset on session change so a new
        // drive's alerts are never suppressed by the prior drive's entries.
        let notifiedMap: BgNotifiedMap;
        try {
          const parsed = notifiedRaw
            ? (JSON.parse(notifiedRaw) as BgNotifiedMap)
            : null;
          notifiedMap =
            parsed?.sessionId === sessionId
              ? parsed
              : { sessionId, notified: {} };
        } catch {
          notifiedMap = { sessionId, notified: {} };
        }

        let zones: BgZoneEntry[] = [];
        let reports: BgReportEntry[] = [];
        try { zones   = zonesRaw   ? (JSON.parse(zonesRaw)   as BgZoneEntry[])   : []; } catch {}
        try { reports = reportsRaw ? (JSON.parse(reportsRaw) as BgReportEntry[]) : []; } catch {}

        // ── 4. Evaluate all zones + reports, pick the closest alertable one ─
        // Mirrors the foreground winner-selection logic in AppContext:
        // only zones in (IN_ZONE_DIST, ALERT_DIST] qualify.
        type Winner = {
          id: string;
          type: string;
          dist: number;
          speedLimit?: number | null;
          name: string;
        };
        let winner: Winner | null = null;

        for (const z of zones) {
          const d = haversine(lat, lng, z.lat, z.lng);
          if (d <= IN_ZONE_DIST || d > ALERT_DIST) continue;
          if (!winner || d < winner.dist) {
            winner = { id: z.id, type: z.type, dist: d, speedLimit: z.speedLimit, name: z.name };
          }
        }

        for (const r of reports) {
          const d = haversine(lat, lng, r.lat, r.lng);
          if (d <= IN_ZONE_DIST || d > ALERT_DIST) continue;
          if (!winner || d < winner.dist) {
            winner = {
              id:        r.id,
              type:      r.type,
              dist:      d,
              speedLimit: r.speedLimit,
              name:      TYPE_LABELS[r.type] ?? r.type,
            };
          }
        }

        if (!winner) return;

        // ── 5. Session-scoped dedup: skip if already notified recently ─────
        const now = Date.now();
        const lastAt = notifiedMap.notified[winner.id] ?? 0;
        if (now - lastAt < ALERT_COOLDOWN_MS) return;

        // ── 6. Fire the lock-screen notification ───────────────────────────
        const label = TYPE_LABELS[winner.type] ?? "Alert";
        const distKm =
          winner.dist >= 1000
            ? `${(winner.dist / 1000).toFixed(1)} km`
            : `${Math.round(winner.dist)} m`;
        const speedPart = winner.speedLimit ? ` – ${winner.speedLimit} km/h` : "";

        await Notifications.scheduleNotificationAsync({
          content: {
            title: `⚠️ ${label} ahead`,
            body:  `${label} ahead${speedPart} · ${distKm}`,
            sound: "alert_tone.mp3",
            data:  { source: "bg_drive_alert", type: winner.type },
          },
          // On Android the notification channel (which carries the alert tone
          // and HIGH importance) must be set in the trigger, not in content —
          // expo-notifications ignores a content-level channelId field.
          trigger: Platform.OS === "android"
            ? { channelId: "msafiri_alerts" }
            : null,
        });

        // ── 7. Persist the updated dedup map ───────────────────────────────
        notifiedMap.notified[winner.id] = now;
        // Prune entries older than 2× cooldown to keep the map small
        for (const [id, ts] of Object.entries(notifiedMap.notified)) {
          if (now - ts > 2 * ALERT_COOLDOWN_MS) delete notifiedMap.notified[id];
        }
        await AsyncStorage.setItem(
          BG_NOTIFIED_ALERTS_KEY,
          JSON.stringify(notifiedMap),
        );
      } catch (e) {
        console.warn("[bgDriveAlerts] unhandled error:", e);
      }
    },
  );
}

// ─── Task lifecycle ───────────────────────────────────────────────────────────

/**
 * Start the background alert location task.
 * Returns true if the task was started (or was already running).
 * Returns false when background location permission has not been granted.
 */
export async function startBgDriveAlertsTask(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const { status } = await Location.getBackgroundPermissionsAsync();
    if (status !== "granted") return false;

    const isRunning = await Location.hasStartedLocationUpdatesAsync(
      BG_DRIVE_ALERTS_TASK,
    ).catch(() => false);
    if (isRunning) return true;

    await Location.startLocationUpdatesAsync(BG_DRIVE_ALERTS_TASK, {
      accuracy: Location.Accuracy.Balanced,
      // Wake the task every 50 m — enough granularity to catch a zone at
      // 600 m with several trigger opportunities while still being battery-
      // friendly.
      distanceInterval: 50,
      // No blue status-bar pill on iOS; the share task already shows one
      // when trip sharing is on, and this task runs silently.
      showsBackgroundLocationIndicator: false,
    });
    return true;
  } catch (e) {
    console.warn("[bgDriveAlerts] start failed:", e);
    return false;
  }
}

/**
 * Stop the background alert location task.
 */
export async function stopBgDriveAlertsTask(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(
      BG_DRIVE_ALERTS_TASK,
    ).catch(() => false);
    if (isRunning) await Location.stopLocationUpdatesAsync(BG_DRIVE_ALERTS_TASK);
  } catch {
    // Ignore — task may not be registered yet
  }
}
