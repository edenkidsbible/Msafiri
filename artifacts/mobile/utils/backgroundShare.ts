/**
 * Background location sharing task.
 *
 * Uses expo-task-manager + expo-location to continue sending share pings
 * even when the Msafiri app is backgrounded or the screen is locked.
 *
 * IMPORTANT: `defineShareBackgroundTask()` must be called at the top level
 * of the app entry point (before any React components mount) — TaskManager
 * requires tasks to be registered synchronously on startup, not lazily.
 */

import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export const SHARE_BACKGROUND_TASK = "msafiri-share-bg";

// Must match the keys used in AppContext.tsx
const SHARE_STORAGE_KEY  = "sdk_share";
const DEVICE_STORAGE_KEY = "sdk_device_id";

// ─── Task definition ──────────────────────────────────────────────────────────

/**
 * Register the background task with expo-task-manager.
 * Call this once at app startup (top-level, outside any component).
 */
export function defineShareBackgroundTask(): void {
  if (Platform.OS === "web") return;
  // Guard: defineTask throws if called twice with the same name
  if (TaskManager.isTaskDefined(SHARE_BACKGROUND_TASK)) return;

  TaskManager.defineTask(SHARE_BACKGROUND_TASK, async ({ data, error }: TaskManager.TaskManagerTaskBody<{ locations: Location.LocationObject[] }>) => {
    if (error) {
      console.warn("[shareTask] error:", error.message);
      return;
    }

    const locations = (data as any)?.locations as Location.LocationObject[] | undefined;
    if (!locations?.length) return;

    // Use the latest fix
    const loc = locations[locations.length - 1];
    const lat = loc.coords.latitude;
    const lng = loc.coords.longitude;
    const speedKmh =
      loc.coords.speed != null && loc.coords.speed >= 0
        ? loc.coords.speed * 3.6
        : 0;

    // Read share session from AsyncStorage (only persistent store available in bg)
    const [shareRaw, deviceId] = await Promise.all([
      AsyncStorage.getItem(SHARE_STORAGE_KEY),
      AsyncStorage.getItem(DEVICE_STORAGE_KEY),
    ]);

    if (!shareRaw || !deviceId) return;

    let token: string;
    try {
      const session = JSON.parse(shareRaw) as { token: string; expiresAt?: string };
      if (!session.token) return;
      if (session.expiresAt && new Date(session.expiresAt) <= new Date()) {
        await AsyncStorage.removeItem(SHARE_STORAGE_KEY);
        return;
      }
      token = session.token;
    } catch {
      return;
    }

    const domain = process.env.EXPO_PUBLIC_DOMAIN ?? "";
    if (!domain) return;

    try {
      await fetch(`https://${domain}/api/share/${token}/ping`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, lat, lng, speedKmh }),
      });
    } catch {
      // Network error — the next location update will retry automatically
    }
  });
}

// ─── Task lifecycle ───────────────────────────────────────────────────────────

/**
 * Start sending location pings in the background.
 * Returns true if the task was started (or was already running).
 * Returns false if background location permission is not granted.
 */
export async function startBackgroundShareTask(): Promise<boolean> {
  if (Platform.OS === "web") return false;

  try {
    const { status } = await Location.getBackgroundPermissionsAsync();
    if (status !== "granted") return false;

    const isRunning = await Location.hasStartedLocationUpdatesAsync(SHARE_BACKGROUND_TASK).catch(() => false);
    if (isRunning) return true;

    await Location.startLocationUpdatesAsync(SHARE_BACKGROUND_TASK, {
      accuracy: Location.Accuracy.Balanced,
      // Fire at most every 8 seconds (matches foreground interval) or every 30 m,
      // whichever triggers first — keeps data fresh without hammering the battery.
      timeInterval: 8000,
      distanceInterval: 30,
      // iOS: show the blue status-bar pill that tells the user location is active
      showsBackgroundLocationIndicator: true,
      // Android: a persistent foreground-service notification is required for
      // background location access; this doubles as the "sharing active" badge.
      foregroundService: {
        notificationTitle: "Trip sharing is active",
        notificationBody: "Your location is being shared. Tap to return to Msafiri.",
        notificationColor: "#00C853",
      },
    });
    return true;
  } catch (e) {
    console.warn("[shareTask] startBackgroundShareTask failed:", e);
    return false;
  }
}

/**
 * Stop the background location task.
 */
export async function stopBackgroundShareTask(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(SHARE_BACKGROUND_TASK).catch(() => false);
    if (isRunning) {
      await Location.stopLocationUpdatesAsync(SHARE_BACKGROUND_TASK);
    }
  } catch {
    // Ignore — task may not have been registered yet
  }
}

/**
 * Request "always" / background location permission from the user.
 * Should be called after the driver starts a share session so the rationale
 * is clear. Returns true if the permission was granted.
 */
export async function requestBackgroundLocationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const { status } = await Location.requestBackgroundPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}
