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
 *   @msafiri/bgLastFix          JSON { lat, lng, speed, accuracy, ts }
 *                                         — most recent background GPS fix,
 *                                           read by AppContext on foreground
 *                                           return to eliminate the position
 *                                           "jump" when the screen unlocks
 */

import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export const BG_DRIVE_ALERTS_TASK = "MSAFIRI_BG_DRIVE_ALERTS";

// ── AsyncStorage keys (exported so AppContext can write/read them) ─────────────
export const BG_DRIVE_ACTIVE_KEY    = "@msafiri/bgDriveActive";
export const BG_SESSION_ID_KEY      = "@msafiri/bgSessionId";
export const BG_ZONES_CACHE_KEY     = "@msafiri/bgZonesCache";
export const BG_REPORTS_CACHE_KEY   = "@msafiri/bgReportsCache";
export const BG_LAST_FIX_KEY        = "@msafiri/bgLastFix";   // ← new: foreground recovery
const        BG_NOTIFIED_ALERTS_KEY = "@msafiri/bgNotifiedAlerts";

// ── Alert thresholds (match foreground AppContext values) ─────────────────────
const ALERT_DIST   = 600; // m — outer boundary: notify when approaching
const IN_ZONE_DIST = 250; // m — inner boundary: driver is already inside, skip

// Don't re-notify the same zone/report within 5 minutes even if the driver
// circles back. This matches the foreground dismiss-cooldown behaviour.
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

// Maximum age of a GPS fix accepted from the background task batch.
// Stale fixes (cached by the OS after the device was still) can trigger
// false alerts at the wrong location.
const FIX_MAX_AGE_MS = 20_000; // 20 s

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

/** Persisted last-known background GPS fix for foreground recovery. */
export interface BgLastFix {
  lat: number;
  lng: number;
  speedMs: number | null;
  accuracyM: number | null;
  ts: number; // epoch ms when the fix was recorded
}

/** Per-session notification dedup map stored in AsyncStorage. */
interface BgNotifiedMap {
  sessionId: string;
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

        // ── 2. Extract the freshest GPS fix from this background invocation ─
        // The OS may batch multiple locations; use the most recent one.
        // Discard any fix that is too old — the OS sometimes delivers cached
        // fixes (e.g. from when the device was parked) rather than a live one.
        const locations =
          (data as any)?.locations as Location.LocationObject[] | undefined;
        if (!locations?.length) return;

        const now = Date.now();
        // Sort descending by timestamp and pick the freshest.
        const sorted = [...locations].sort(
          (a, b) => b.timestamp - a.timestamp,
        );
        // Find the freshest fix that is within the staleness window.
        const loc = sorted.find(
          (l) => now - l.timestamp <= FIX_MAX_AGE_MS,
        ) ?? sorted[0]; // fall back to freshest even if stale

        // If the best fix is more than 60s old the device has not moved
        // recently; skip this invocation rather than evaluating a cold cache.
        if (now - loc.timestamp > 60_000) return;

        const lat = loc.coords.latitude;
        const lng = loc.coords.longitude;
        const accuracyM = loc.coords.accuracy;

        // ── 3. Persist this fix so AppContext can consume it on foreground ──
        const lastFix: BgLastFix = {
          lat,
          lng,
          speedMs: loc.coords.speed ?? null,
          accuracyM: accuracyM ?? null,
          ts: loc.timestamp,
        };
        // Fire-and-forget; don't await — alert logic proceeds immediately.
        AsyncStorage.setItem(BG_LAST_FIX_KEY, JSON.stringify(lastFix)).catch(() => {});

        // ── 4. Load all data in parallel ───────────────────────────────────
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

        // ── 5. Evaluate all zones + reports, pick the closest alertable one ─
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
              id:         r.id,
              type:       r.type,
              dist:       d,
              speedLimit: r.speedLimit,
              name:       TYPE_LABELS[r.type] ?? r.type,
            };
          }
        }

        if (!winner) return;

        // ── 6. Session-scoped dedup: skip if already notified recently ─────
        const lastAt = notifiedMap.notified[winner.id] ?? 0;
        if (now - lastAt < ALERT_COOLDOWN_MS) return;

        // ── 7. Fire the lock-screen / banner notification ──────────────────
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

            // ── Sound ──────────────────────────────────────────────────────
            // iOS: local notification sounds MUST be .wav / .aiff / .caf —
            //      .mp3 is silently ignored by UNUserNotificationCenter.
            //      `true` → system uses the app's default notification sound.
            // Android: sound comes from the notification CHANNEL (configured
            //      in usePushNotifications); the content-level sound field is
            //      ignored on API 26+ (Oreo+), so we leave it unset there.
            sound: Platform.OS === "ios" ? true : undefined,

            data:  { source: "bg_drive_alert", type: winner.type },
          },
          trigger: Platform.OS === "android"
            // The msafiri_alerts channel carries HIGH importance + sound.
            // Setting channelId here is the correct way to route on Android 8+.
            ? { channelId: "msafiri_alerts" }
            : null,
        });

        // ── 8. Persist the updated dedup map ───────────────────────────────
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
 *
 * Accuracy and interval choices:
 *   High accuracy  — uses GPS hardware, not cell/Wi-Fi. Gives 3-15 m fixes vs
 *                    the 50-150 m typical of Balanced mode, which is critical
 *                    for the 600 m alert window and precise distance display.
 *   distanceInterval: 10 m — wake the task every ~10 m of movement. At
 *                    100 km/h that's a wakeup every ~0.36 s; the OS schedules
 *                    these as a batch but the density ensures we don't miss a
 *                    600 m alert window on high-speed roads.
 *   timeInterval: 5000 ms — also fire on a 5 s timer so a stationary driver
 *                    near a hazard gets a notification without needing to move
 *                    another 10 m first.
 *   showsBackgroundLocationIndicator: true — shows the blue GPS pill on iOS.
 *                    More importantly it signals to the iOS scheduler that
 *                    this task requires timely location updates, granting it
 *                    higher wakeup priority (similar to navigation apps).
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
      // High accuracy: GPS hardware. Balanced would use cell/Wi-Fi (~100 m),
      // too imprecise for reliable 600 m alert detection at driving speeds.
      accuracy: Location.Accuracy.High,

      // Wake on every 25 m of movement. At 100 km/h that's ~1 wakeup/second,
      // still well within the 1 km alert detection window and ~2.5× fewer
      // background task wakeups than the previous 10 m setting (which was
      // 2.8 wakeups/s at highway speed — excessive heat/battery drain).
      distanceInterval: 25,

      // Also fire on a time cadence so a stationary driver sitting 400 m from
      // a speed camera still gets notified without needing to move first.
      timeInterval: 5000,

      // Show the blue GPS status-bar pill on iOS. This tells the iOS location
      // scheduler that updates are navigation-critical, granting higher wakeup
      // fidelity and priority (same treatment as turn-by-turn navigation apps).
      showsBackgroundLocationIndicator: true,

      // Android foreground service: required for reliable background location
      // on Android 8+. Without this, Doze mode can kill the task mid-drive.
      // The notification tells the user the app is tracking their drive.
      ...(Platform.OS === "android" ? {
        foregroundService: {
          notificationTitle:   "Msafiri Drive Mode",
          notificationBody:    "Monitoring for nearby hazards and speed zones",
          notificationColor:   "#00C853",
          killServiceOnDestroy: false,
        },
      } : {}),
    });
    return true;
  } catch (e) {
    console.warn("[bgDriveAlerts] start failed:", e);
    return false;
  }
}

/**
 * Stop the background alert location task.
 * Also clears the persisted last-fix so stale position isn't injected on the
 * next foreground return after a very long gap.
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
