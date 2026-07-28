/**
 * Background location task for active navigation.
 *
 * On iOS, watchPositionAsync stops delivering fixes when the screen locks
 * unless a TaskManager background location task is also running. This module
 * registers that task, keeping the iOS location engine alive for the duration
 * of every navigation session.
 *
 * Architecture:
 *  - The task callback is lightweight: it records a module-level timestamp
 *    that the foreground watchdog can read without AsyncStorage round-trips.
 *  - State updates (speed, position, alerts) continue to flow through the
 *    existing foreground watchPositionAsync handler — the background task
 *    does NOT duplicate that logic.
 *  - Android already delivers background location via the foreground-service
 *    model; startBackgroundNavTask() short-circuits on Android because the
 *    foreground watcher alone is sufficient there.
 *
 * IMPORTANT: defineNavBackgroundTask() must be called at module-load time
 * (top-level of the app entry point), before any React component mounts.
 * expo-task-manager throws if tasks are defined inside components or effects.
 */

import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import { Platform } from "react-native";

export const NAV_BACKGROUND_TASK = "msafiri-nav-bg";

// Module-level timestamp — written by the background task callback, read by
// the foreground watchdog. Using a plain variable avoids AsyncStorage latency.
let _lastBgFixAt = 0;
export function getLastBgNavFixAt(): number {
  return _lastBgFixAt;
}

// ─── Task definition ──────────────────────────────────────────────────────────

/**
 * Register the background navigation task with expo-task-manager.
 * Call once at app startup (top-level, outside any component or hook).
 */
export function defineNavBackgroundTask(): void {
  if (Platform.OS === "web") return;
  if (TaskManager.isTaskDefined(NAV_BACKGROUND_TASK)) return;

  TaskManager.defineTask(
    NAV_BACKGROUND_TASK,
    async ({ data, error }: TaskManager.TaskManagerTaskBody<{ locations: Location.LocationObject[] }>) => {
      if (error) {
        console.warn("[navBgTask] location error:", error.message);
        return;
      }
      const locations = (data as any)?.locations as Location.LocationObject[] | undefined;
      if (locations?.length) {
        // Record the timestamp so the foreground watchdog knows fixes are
        // still arriving even while the screen is locked.
        _lastBgFixAt = Date.now();
      }
    }
  );
}

// ─── Lifecycle helpers ────────────────────────────────────────────────────────

/**
 * Start the background navigation task.
 * Requires "always" / background location permission — requests it silently
 * first. Returns true if the task started successfully.
 *
 * iOS only: on Android the foreground watcher handles background location
 * natively via the FOREGROUND_SERVICE permission; no separate task needed.
 */
export async function startBackgroundNavTask(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    // Check existing background location permission; request if not yet granted.
    const { status } = await Location.getBackgroundPermissionsAsync();
    if (status !== "granted") {
      const { status: requested } = await Location.requestBackgroundPermissionsAsync();
      if (requested !== "granted") return false;
    }

    const isRunning = await Location.hasStartedLocationUpdatesAsync(NAV_BACKGROUND_TASK).catch(() => false);
    if (isRunning) return true;

    await Location.startLocationUpdatesAsync(NAV_BACKGROUND_TASK, {
      accuracy: Location.Accuracy.Highest,
      timeInterval: 1000,
      distanceInterval: 5,
      // The blue status-bar pill reassures the driver their route is still live.
      showsBackgroundLocationIndicator: true,
      // iOS requires a foreground-service-style notification for background location.
      foregroundService: {
        notificationTitle: "Navigation active",
        notificationBody: "Msafiri is guiding your route. Tap to return to the app.",
        notificationColor: "#00C853",
      },
    });
    _lastBgFixAt = Date.now(); // initialise so watchdog doesn't immediately fire
    return true;
  } catch (e) {
    console.warn("[navBgTask] startBackgroundNavTask failed:", e);
    return false;
  }
}

/**
 * Stop the background navigation task.
 * Safe to call even if the task was never started.
 */
export async function stopBackgroundNavTask(): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(NAV_BACKGROUND_TASK).catch(() => false);
    if (isRunning) {
      await Location.stopLocationUpdatesAsync(NAV_BACKGROUND_TASK);
    }
  } catch {
    // Ignore — task may not have been registered yet
  }
}
