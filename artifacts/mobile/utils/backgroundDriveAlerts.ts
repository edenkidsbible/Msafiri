/**
 * Background drive-session alert task.
 *
 * When the driver has an active trip and the app is backgrounded or the screen
 * is locked, this task receives background GPS updates from expo-location and
 * evaluates them against a locally cached set of speed zones and community
 * reports. If the driver is approaching an alertable zone (within ALERT_DIST
 * but outside IN_ZONE_DIST), a local notification fires with the alert tone.
 *
 * ── Adaptive accuracy ──────────────────────────────────────────────────────
 * To reduce battery / heat on long empty-road stretches, the task switches
 * between two GPS accuracy modes automatically:
 *
 *   High (default)  — GPS hardware, 25 m distance interval, 5 s time interval.
 *                     Used whenever a zone or report is within 2 km OR within
 *                     2 minutes of the last alert trigger.
 *   Balanced        — Cell/Wi-Fi, 100 m distance interval, 15 s time interval.
 *                     Activated when no zone/report is within 2 km AND no alert
 *                     has fired for more than 2 minutes.  Uses ~40–60 % less
 *                     GPS power on long highway stretches (Google Maps pattern).
 *
 * Mode transitions are effected by stopping and restarting the location
 * subscription with new parameters (the only way expo-location allows it).
 * The current mode is persisted in AsyncStorage so `startBgDriveAlertsTask`
 * can resume in the correct mode after an app restart.
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
 *   @msafiri/bgAccuracyMode     "high" | "balanced"  — current adaptive mode
 *   @msafiri/bgLastAlertAt      string (epoch ms)    — when the last alert fired
 */

import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import {
  ANDROID_ALERTS_CHANNEL_ID,
  ensureAndroidNotificationChannels,
  resolveAndroidVoiceChannelId,
} from "@/utils/androidNotificationChannels";
import { getRoadName } from "@/utils/snapToRoad";

export const BG_DRIVE_ALERTS_TASK = "MSAFIRI_BG_DRIVE_ALERTS";

// ── AsyncStorage keys (exported so AppContext can write/read them) ─────────────
export const BG_DRIVE_ACTIVE_KEY    = "@msafiri/bgDriveActive";
export const BG_SESSION_ID_KEY      = "@msafiri/bgSessionId";
export const BG_ZONES_CACHE_KEY     = "@msafiri/bgZonesCache";
export const BG_REPORTS_CACHE_KEY   = "@msafiri/bgReportsCache";
export const BG_LAST_FIX_KEY        = "@msafiri/bgLastFix";   // ← foreground recovery
export const BG_ALERT_OWNER_KEY     = "@msafiri/bgAlertOwner";
export const BG_ROAD_CONTEXT_KEY    = "@msafiri/bgRoadContext";
const        BG_NOTIFIED_ALERTS_KEY = "@msafiri/bgNotifiedAlerts";
const        BG_ACCURACY_MODE_KEY   = "@msafiri/bgAccuracyMode";   // "high" | "balanced"
const        BG_LAST_ALERT_AT_KEY   = "@msafiri/bgLastAlertAt";    // epoch ms string

// ── Alert thresholds (match foreground AppContext values) ─────────────────────
const ALERT_DIST   = 600; // m — outer boundary: notify when approaching
const IN_ZONE_DIST = 250; // m — inner boundary: driver is already inside, skip

// ── Adaptive accuracy thresholds ──────────────────────────────────────────────
/** Drop to Balanced if no alert has fired for longer than this. */
const ADAPTIVE_QUIET_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Re-arm to High accuracy if ANY zone or report is closer than this.
 * Must be well above ALERT_DIST (600 m) so we switch back to High *before*
 * the driver enters the alert window — not after.
 */
const REARM_DIST = 2000; // 2 km

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
  road?: string | null;
}

/** Compact community-report entry persisted by AppContext. */
export interface BgReportEntry {
  id: string;
  lat: number;
  lng: number;
  type: string;
  speedLimit?: number | null;
  road?: string | null;
}

export interface BgRoadContext {
  road: string | null;
  heading: number | null;
  lat: number;
  lng: number;
  ts: number;
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

type AccuracyMode = "high" | "balanced";

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

function bearingDeg(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const f1 = (fromLat * Math.PI) / 180;
  const f2 = (toLat * Math.PI) / 180;
  const dl = ((toLng - fromLng) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function alongTrackDistanceM(
  driverLat: number,
  driverLng: number,
  driverHeading: number,
  targetLat: number,
  targetLng: number,
): number {
  const dist = haversine(driverLat, driverLng, targetLat, targetLng);
  const targetBearing = bearingDeg(driverLat, driverLng, targetLat, targetLng);
  const deltaRad = ((targetBearing - driverHeading + 540) % 360 - 180) * (Math.PI / 180);
  return dist * Math.cos(deltaRad);
}

function normalizeRoad(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\b(road|rd|street|st|avenue|ave|highway|hwy|superhighway|way|bypass|lane|drive|dr|place)\b/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const ROAD_ALIASES: ReadonlyArray<ReadonlyArray<string>> = [
  ["thika", "northern"],
  ["mombasa", "airport north"],
];

function roadsMatch(aRoad: string | null | undefined, bRoad: string | null | undefined): boolean {
  if (!aRoad || !bRoad) return false;
  const a = normalizeRoad(aRoad);
  const b = normalizeRoad(bRoad);
  if (!a || !b) return false;
  if (a === b) return true;
  return ROAD_ALIASES.some((group) => group.includes(a) && group.includes(b));
}

/** Reject alerts that are merely in front of the vehicle but sit laterally on
 * a branch, service road, or nearby parallel road. */
function followsCurrentTravelCorridor(
  driverLat: number,
  driverLng: number,
  driverHeading: number | null,
  targetLat: number,
  targetLng: number,
): boolean {
  if (driverHeading == null) return true;
  const distanceM = haversine(driverLat, driverLng, targetLat, targetLng);
  const angle = Math.abs(
    ((bearingDeg(driverLat, driverLng, targetLat, targetLng) - driverHeading + 540) % 360) - 180,
  );
  if (angle > 35) return false;
  const lateralM = Math.abs(distanceM * Math.sin(angle * Math.PI / 180));
  return lateralM <= 75;
}

// ── Notification sound helpers ────────────────────────────────────────────────

/** Speed limits that have a dedicated Yna Agalo CAF bundled for iOS. */
const BUNDLED_SPEED_LIMITS = new Set([30, 50, 60, 80, 100, 110]);

/**
 * Resolves the iOS notification sound filename (.caf) for a given alert type
 * and optional speed limit. Returns the bundled CAF name when available, or
 * `true` (system default) as a safe fallback.
 *
 * UNUserNotificationCenter silently ignores .mp3 files — only .caf / .wav /
 * .aiff play as notification sounds on iOS.
 */
function resolveIosNotificationSound(
  type: string,
  speedLimit?: number | null,
): string | true {
  // Speed-limit-specific camera / zone variants come first (Task #10 assets)
  if ((type === "camera" || type === "zone") && speedLimit != null && BUNDLED_SPEED_LIMITS.has(speedLimit)) {
    return `${type}_${speedLimit}.caf`;
  }
  const BUNDLED: ReadonlySet<string> = new Set([
    "camera", "police", "zone", "alcoblow", "accident", "traffic",
    "roadblock", "roadworks", "hazard", "pothole", "debris", "breakdown",
    "weather", "closure", "clear", "speed_bump",
  ]);
  return BUNDLED.has(type) ? `${type}.caf` : true;
}

const TYPE_LABELS: Record<string, string> = {
  camera:     "Speed camera",
  police:     "Police checkpoint",
  alcoblow:   "Alcoblow checkpoint",
  hazard:     "Hazard",
  accident:   "Accident",
  pothole:    "Pothole",
  speed_bump: "Speed bump",
  roadblock:  "Roadblock",
  roadworks:  "Road works",
  traffic:    "Traffic",
  weather:    "Weather hazard",
  debris:     "Debris on road",
  breakdown:  "Breakdown",
  closure:    "Road closure",
};

/**
 * Location options for a given accuracy mode.
 *
 *   High     — GPS hardware, 25 m / 5 s cadence.  Used near zones or just
 *              after an alert so we never miss the 600 m alert window.
 *   Balanced — Cell/Wi-Fi, 100 m / 15 s cadence.  Used on long empty
 *              stretches; ~40–60 % less GPS power draw.
 */
function locationOptions(mode: AccuracyMode): Parameters<typeof Location.startLocationUpdatesAsync>[1] {
  const base = {
    showsBackgroundLocationIndicator: true,
    ...(Platform.OS === "android" ? {
      foregroundService: {
        notificationTitle:   "Msafiri Drive Mode",
        notificationBody:    "Monitoring for nearby hazards and speed zones",
        notificationColor:   "#00C853",
        killServiceOnDestroy: false,
      },
    } : {}),
  };

  if (mode === "balanced") {
    return {
      ...base,
      // Balanced: cell/Wi-Fi positioning, larger wakeup intervals.
      // At 100 km/h, 100 m ≈ one wakeup every 3.6 s — still well above the
      // 2 km re-arm gate that switches us back to High before any zone matters.
      accuracy:         Location.Accuracy.Balanced,
      distanceInterval: 100,
      timeInterval:     15_000,
    };
  }

  // High (default): GPS hardware.
  return {
    ...base,
    // 25 m at 100 km/h ≈ 1 wakeup/s — reliable for 600 m alert window.
    accuracy:         Location.Accuracy.High,
    distanceInterval: 25,
    timeInterval:     5_000,
  };
}

/**
 * Restart the location subscription with a new accuracy mode.
 * Called fire-and-forget from within the task handler so the current
 * invocation completes without waiting for the new subscription to register.
 *
 * Guards against concurrent restarts and missing permissions.
 */
async function switchAccuracyModeNow(mode: AccuracyMode): Promise<void> {
  try {
    const [{ status }, activeRaw, ownerRaw] = await Promise.all([
      Location.getBackgroundPermissionsAsync(),
      AsyncStorage.getItem(BG_DRIVE_ACTIVE_KEY),
      AsyncStorage.getItem(BG_ALERT_OWNER_KEY),
    ]);
    if (
      status !== "granted" ||
      activeRaw !== "true" ||
      ownerRaw !== "background"
    ) return;

    // Persist *before* stopping so that if something throws, the target mode
    // is recorded and the next startBgDriveAlertsTask call picks it up.
    await AsyncStorage.setItem(BG_ACCURACY_MODE_KEY, mode);

    const isRunning = await Location.hasStartedLocationUpdatesAsync(
      BG_DRIVE_ALERTS_TASK,
    ).catch(() => false);

    if (isRunning) {
      await Location.stopLocationUpdatesAsync(BG_DRIVE_ALERTS_TASK);
    }

    try {
      const [stillActive, stillOwner] = await Promise.all([
        AsyncStorage.getItem(BG_DRIVE_ACTIVE_KEY),
        AsyncStorage.getItem(BG_ALERT_OWNER_KEY),
      ]);
      if (stillActive !== "true" || stillOwner !== "background") return;
      await Location.startLocationUpdatesAsync(
        BG_DRIVE_ALERTS_TASK,
        locationOptions(mode),
      );
      console.log(`[bgDriveAlerts] switched accuracy to ${mode}`);
    } catch (startErr) {
      // The stop succeeded but the restart failed. The background task is now
      // dead — no more GPS updates, no more alerts for the rest of the drive.
      // Attempt a recovery restart with the default High mode so at minimum
      // the driver still receives alerts, even if at full power draw.
      console.warn("[bgDriveAlerts] restart after mode switch failed, recovering:", startErr);
      try {
        const [stillActive, stillOwner] = await Promise.all([
          AsyncStorage.getItem(BG_DRIVE_ACTIVE_KEY),
          AsyncStorage.getItem(BG_ALERT_OWNER_KEY),
        ]);
        if (stillActive !== "true" || stillOwner !== "background") return;
        await Location.startLocationUpdatesAsync(
          BG_DRIVE_ALERTS_TASK,
          locationOptions("high"),
        );
        await AsyncStorage.setItem(BG_ACCURACY_MODE_KEY, "high");
        console.log("[bgDriveAlerts] recovery restart succeeded (high mode)");
      } catch (recoveryErr) {
        console.warn("[bgDriveAlerts] recovery restart also failed:", recoveryErr);
      }
    }
  } catch (e) {
    console.warn("[bgDriveAlerts] switchAccuracyMode failed:", e);
  }
}

let lifecycleQueue: Promise<void> = Promise.resolve();

function enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const result = lifecycleQueue.catch(() => {}).then(operation);
  lifecycleQueue = result.then(() => undefined, () => undefined);
  return result;
}

let desiredAccuracyMode: AccuracyMode | null = null;
let accuracySwitchScheduled = false;

function requestAccuracyModeSwitch(mode: AccuracyMode): void {
  desiredAccuracyMode = mode;
  if (accuracySwitchScheduled) return;
  accuracySwitchScheduled = true;
  void enqueueLifecycle(async () => {
    while (desiredAccuracyMode) {
      const target = desiredAccuracyMode;
      desiredAccuracyMode = null;
      await switchAccuracyModeNow(target);
    }
  }).finally(() => {
    accuracySwitchScheduled = false;
    if (desiredAccuracyMode) requestAccuracyModeSwitch(desiredAccuracyMode);
  });
}

let taskInvocationRunning = false;

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
      if (taskInvocationRunning) return;
      taskInvocationRunning = true;
      try {
        if (error) {
          console.warn("[bgDriveAlerts] error:", error.message);
          return;
        }

        // ── 1. Guard: only run when a drive session is active ──────────────
        const [activeRaw, ownerRaw] = await Promise.all([
          AsyncStorage.getItem(BG_DRIVE_ACTIVE_KEY),
          AsyncStorage.getItem(BG_ALERT_OWNER_KEY),
        ]);
        if (activeRaw !== "true" || ownerRaw !== "background") return;

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
        const [sessionIdRaw, zonesRaw, reportsRaw, notifiedRaw, accuracyModeRaw, lastAlertAtRaw, roadContextRaw] =
          await Promise.all([
            AsyncStorage.getItem(BG_SESSION_ID_KEY),
            AsyncStorage.getItem(BG_ZONES_CACHE_KEY),
            AsyncStorage.getItem(BG_REPORTS_CACHE_KEY),
            AsyncStorage.getItem(BG_NOTIFIED_ALERTS_KEY),
            AsyncStorage.getItem(BG_ACCURACY_MODE_KEY),
            AsyncStorage.getItem(BG_LAST_ALERT_AT_KEY),
            AsyncStorage.getItem(BG_ROAD_CONTEXT_KEY),
          ]);

        const sessionId   = sessionIdRaw ?? "unknown";
        const currentMode = (accuracyModeRaw as AccuracyMode | null) ?? "high";
        const lastAlertAt = lastAlertAtRaw ? parseInt(lastAlertAtRaw, 10) : 0;

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
        let roadContext: BgRoadContext | null = null;
        try { zones   = zonesRaw   ? (JSON.parse(zonesRaw)   as BgZoneEntry[])   : []; } catch {}
        try { reports = reportsRaw ? (JSON.parse(reportsRaw) as BgReportEntry[]) : []; } catch {}
        try { roadContext = roadContextRaw ? (JSON.parse(roadContextRaw) as BgRoadContext) : null; } catch {}
        let currentRoad =
          roadContext &&
          now - roadContext.ts <= 2 * 60_000 &&
          haversine(lat, lng, roadContext.lat, roadContext.lng) <= 200
            ? roadContext.road
            : null;
        if (!currentRoad) {
          currentRoad = await getRoadName(lat, lng).catch(() => null);
          if (currentRoad) {
            roadContext = {
              road: currentRoad,
              heading: loc.coords.heading ?? null,
              lat,
              lng,
              ts: now,
            };
            await AsyncStorage.setItem(BG_ROAD_CONTEXT_KEY, JSON.stringify(roadContext));
          }
        }
        const currentHeading =
          loc.coords.heading != null && loc.coords.heading >= 0
            ? loc.coords.heading
            : roadContext && now - roadContext.ts <= 30_000
              ? roadContext.heading
              : null;

        // ── 5. Evaluate all zones + reports, pick the closest alertable one ─
        // Simultaneously track the nearest distance across ALL zones/reports
        // (regardless of the alert window) for the adaptive-accuracy gate.
        type Winner = {
          id: string;
          type: string;
          dist: number;
          speedLimit?: number | null;
          name: string;
          road?: string | null;
          /** Alert pin coordinates — passed through to the notification tap handler
           *  so the map can focus and pulse-highlight the exact location. */
          lat: number;
          lng: number;
        };
        let winner: Winner | null = null;
        let nearestDist = Infinity; // nearest zone/report at any distance

        for (const z of zones) {
          const d = haversine(lat, lng, z.lat, z.lng);
          if (d < nearestDist) nearestDist = d;
          if (d <= IN_ZONE_DIST || d > ALERT_DIST) continue;
          if (z.road && !roadsMatch(currentRoad, z.road)) continue;
          if (currentHeading != null && alongTrackDistanceM(lat, lng, currentHeading, z.lat, z.lng) <= 0) continue;
          if (!followsCurrentTravelCorridor(lat, lng, currentHeading, z.lat, z.lng)) continue;
          if (!winner || d < winner.dist) {
            winner = { id: z.id, type: z.type, dist: d, speedLimit: z.speedLimit, name: z.name, road: z.road, lat: z.lat, lng: z.lng };
          }
        }

        for (const r of reports) {
          const d = haversine(lat, lng, r.lat, r.lng);
          if (d < nearestDist) nearestDist = d;
          if (d <= IN_ZONE_DIST || d > ALERT_DIST) continue;
          if (r.road && !roadsMatch(currentRoad, r.road)) continue;
          if (currentHeading != null && alongTrackDistanceM(lat, lng, currentHeading, r.lat, r.lng) <= 0) continue;
          if (!followsCurrentTravelCorridor(lat, lng, currentHeading, r.lat, r.lng)) continue;
          if (!winner || d < winner.dist) {
            winner = {
              id:         r.id,
              type:       r.type,
              dist:       d,
              speedLimit: r.speedLimit,
              name:       TYPE_LABELS[r.type] ?? r.type,
              road:       r.road,
              lat:        r.lat,
              lng:        r.lng,
            };
          }
        }

        // ── 5b. Adaptive accuracy: decide whether to switch modes ──────────
        //
        //  Switch to Balanced when ALL of:
        //    • no zone/report is within REARM_DIST (2 km)
        //    • no alert has fired in the last ADAPTIVE_QUIET_MS (2 min)
        //
        //  Restore to High when ANY of:
        //    • a zone/report is within REARM_DIST (2 km)   ← re-arm before alert window
        //    • an alert fired within the last ADAPTIVE_QUIET_MS (2 min)
        //
        //  The 2 km gate gives a comfortable ~2–3 s runway at 100 km/h between
        //  the mode switch and actually entering the 600 m alert window.
        {
          const zoneNearby   = nearestDist <= REARM_DIST;
          const alertRecent  = (now - lastAlertAt) < ADAPTIVE_QUIET_MS;
          const targetMode: AccuracyMode = (zoneNearby || alertRecent) ? "high" : "balanced";

          if (targetMode !== currentMode) {
            // Fire-and-forget: switching involves a stop+start which is
            // async but we don't need the result for this invocation.
            requestAccuracyModeSwitch(targetMode);
          }
        }

        if (!winner) return;

        // Infer speed limit from the nearest zone within 300 m when a camera or
        // zone entry has no limit stored.  This mirrors the foreground AppContext
        // logic so the background notification body shows the correct km/h.
        if (!winner.speedLimit && (winner.type === "camera" || winner.type === "zone")) {
          const nearestWithLimit = zones
            .filter((z) =>
              z.speedLimit &&
              z.id !== winner!.id &&
              (!winner!.road || !z.road || roadsMatch(winner!.road, z.road))
            )
            .map((z) => ({ limit: z.speedLimit!, dist: haversine(lat, lng, z.lat, z.lng) }))
            .filter((z) => z.dist <= 300)
            .sort((a, b) => a.dist - b.dist)[0];
          if (nearestWithLimit) winner = { ...winner, speedLimit: nearestWithLimit.limit };
        }

        // ── 6. Session-scoped dedup: skip if already notified recently ─────
        const lastAt = notifiedMap.notified[winner.id] ?? 0;
        if (now - lastAt < ALERT_COOLDOWN_MS) return;

        if (
          Platform.OS === "android" &&
          !(await ensureAndroidNotificationChannels())
        ) {
          console.warn("[bgDriveAlerts] Android notification channel unavailable; retaining alert for retry.");
          return;
        }

        // Ownership may have changed while this task was evaluating candidates
        // (for example the driver unlocked the phone). Re-check immediately
        // before delivery so a final queued background invocation cannot race
        // the foreground alert path.
        if ((await AsyncStorage.getItem(BG_ALERT_OWNER_KEY)) !== "background") {
          return;
        }

        // ── 7. Fire the lock-screen / banner notification ──────────────────
        const label = TYPE_LABELS[winner.type] ?? "Alert";
        const distKm =
          winner.dist >= 1000
            ? `${(winner.dist / 1000).toFixed(1)} km`
            : `${Math.round(winner.dist)} m`;
        const speedPart = winner.speedLimit ? ` – ${winner.speedLimit} km/h` : "";

        // ── Resolve type-specific voice sound ─────────────────────────
        // iOS:     .caf file played by UNUserNotificationCenter. .mp3 is
        //          silently ignored — must be .caf / .wav / .aiff.
        //          Speed-limit-specific files used when available (Task #10).
        // Android: Sound comes from the notification CHANNEL on API 26+;
        //          per-type msafiri_voice_* channels each carry their own
        //          Yna Agalo clip. Content-level sound is ignored on Oreo+.
        const iosSound = Platform.OS === "ios"
          ? resolveIosNotificationSound(winner.type, winner.speedLimit)
          : undefined;
        const androidChannelId = Platform.OS === "android"
          ? resolveAndroidVoiceChannelId(winner.type)
          : undefined;

        await Notifications.scheduleNotificationAsync({
          content: {
            title: `⚠️ ${label} ahead`,
            body:  `${label} ahead${speedPart} · ${distKm}`,
            sound: iosSound,
            // lat/lng/alertId let the notification tap handler open the map
            // and pulse-highlight the exact alert pin.
            data:  { source: "bg_drive_alert", type: winner.type, alertId: winner.id, lat: winner.lat, lng: winner.lng },
          },
          trigger: Platform.OS === "android"
            ? { channelId: androidChannelId ?? ANDROID_ALERTS_CHANNEL_ID }
            : null,
        });

        // ── 8. Persist updated dedup map + last-alert timestamp ───────────
        notifiedMap.notified[winner.id] = now;
        // Prune entries older than 2× cooldown to keep the map small
        for (const [id, ts] of Object.entries(notifiedMap.notified)) {
          if (now - ts > 2 * ALERT_COOLDOWN_MS) delete notifiedMap.notified[id];
        }
        await Promise.all([
          AsyncStorage.setItem(
            BG_NOTIFIED_ALERTS_KEY,
            JSON.stringify(notifiedMap),
          ),
          // Record when the last alert fired so the adaptive-accuracy logic
          // has a fresh reference on the next task invocation.
          AsyncStorage.setItem(BG_LAST_ALERT_AT_KEY, String(now)),
        ]);
      } catch (e) {
        console.warn("[bgDriveAlerts] unhandled error:", e);
      } finally {
        taskInvocationRunning = false;
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
 * Reads the persisted accuracy mode from AsyncStorage so that a task which was
 * stopped and restarted (e.g. after an app restart mid-drive) resumes in the
 * same mode it had been running in rather than always defaulting to High.
 * On a fresh drive start, no mode is stored yet → defaults to High.
 */
export async function startBgDriveAlertsTask(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  return enqueueLifecycle(async () => {
    try {
      const { status } = await Location.getBackgroundPermissionsAsync();
      if (status !== "granted") return false;

      const isRunning = await Location.hasStartedLocationUpdatesAsync(
        BG_DRIVE_ALERTS_TASK,
      ).catch(() => false);
      if (isRunning) return true;

      // Restore the accuracy mode from the last run, defaulting to High for a
      // fresh session (no stored mode) so we never miss an early zone.
      const storedMode = await AsyncStorage.getItem(BG_ACCURACY_MODE_KEY).catch(() => null);
      const mode: AccuracyMode = (storedMode as AccuracyMode | null) ?? "high";

      await Location.startLocationUpdatesAsync(BG_DRIVE_ALERTS_TASK, locationOptions(mode));
      return true;
    } catch (e) {
      console.warn("[bgDriveAlerts] start failed:", e);
      return false;
    }
  });
}

/**
 * Stop the background alert location task.
 * Also clears the persisted last-fix so stale position isn't injected on the
 * next foreground return after a very long gap.
 * Resets the accuracy mode to High so the next drive starts fresh.
 */
export async function stopBgDriveAlertsTask(): Promise<void> {
  if (Platform.OS === "web") return;
  desiredAccuracyMode = null;
  return enqueueLifecycle(async () => {
    try {
      const isRunning = await Location.hasStartedLocationUpdatesAsync(
        BG_DRIVE_ALERTS_TASK,
      ).catch(() => false);
      if (isRunning) await Location.stopLocationUpdatesAsync(BG_DRIVE_ALERTS_TASK);
    } catch {
      // Ignore — task may not be registered yet
    }
    // Reset adaptive state for the next drive session.
    await Promise.all([
      AsyncStorage.removeItem(BG_ACCURACY_MODE_KEY).catch(() => {}),
      AsyncStorage.removeItem(BG_LAST_ALERT_AT_KEY).catch(() => {}),
    ]);
  });
}
