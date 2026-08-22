/**
 * backgroundNotificationTask.ts
 *
 * Registers an expo-notifications background task that runs whenever the app
 * receives a push notification while backgrounded (iOS content-available: 1,
 * Android FCM high-priority).
 *
 * What the task does:
 *   1. If the stored push token is missing or older than 7 days, refreshes it
 *      via getExpoPushTokenAsync and re-registers with the server.
 *   2. POSTs the last known device location to /push/location so server-side
 *      geo-targeting stays accurate even for dormant users who never foreground
 *      the app.
 *
 * Registration: call `defineBackgroundNotificationTask()` at app startup
 * (module-level, before any component mounts) — the same pattern as
 * backgroundShare.ts.  Then call `Notifications.registerTaskAsync(BG_NOTIFICATION_TASK)`
 * inside usePushNotifications after push permission is granted.
 *
 * Storage keys: exported so usePushNotifications can write fresh values that
 * this task reads (the two files must stay in sync).
 */

import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export const BG_NOTIFICATION_TASK = "MSAFIRI_BG_NOTIFICATION";

// ─── Shared AsyncStorage keys ─────────────────────────────────────────────────
// Kept in sync with usePushNotifications.ts — the foreground hook writes these
// and the background task reads them.
export const TOKEN_REGISTERED_AT_KEY = "@msafiri/tokenRegisteredAt";
export const LAST_LOCATION_KEY       = "@msafiri/lastLocation";

// Internal keys (also used by usePushNotifications — do not rename)
const DEVICE_ID_KEY = "@msafiri/deviceId";
const TOKEN_KEY     = "@msafiri/pushToken";

// Resolved at build time from app.config.js → extra.eas.projectId.
// Must match app.config.js extra.eas.projectId exactly — a mismatch means
// getExpoPushTokenAsync issues a token for the wrong Expo project and Expo's
// push gateway cannot deliver it to this app's APNs/FCM credentials.
const EAS_PROJECT_ID = "35b79893-fc03-4518-bfcd-31ac65c262f4";

/** Re-register token if it is absent or older than this. */
const TOKEN_REFRESH_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Task definition ──────────────────────────────────────────────────────────

/**
 * Register the background notification task with expo-task-manager.
 * Must be called once at module load time — before any React component mounts.
 */
export function defineBackgroundNotificationTask(): void {
  if (Platform.OS === "web") return;
  // defineTask throws if called twice with the same name
  if (TaskManager.isTaskDefined(BG_NOTIFICATION_TASK)) return;

  TaskManager.defineTask(
    BG_NOTIFICATION_TASK,
    async ({ error }: TaskManager.TaskManagerTaskBody<{ notification: Notifications.Notification }>) => {
      try {
        if (error) {
          console.warn("[bgNotifTask] Task error:", error.message);
          return;
        }

        const [deviceId, token, registeredAtStr, locationRaw] = await Promise.all([
          AsyncStorage.getItem(DEVICE_ID_KEY),
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(TOKEN_REGISTERED_AT_KEY),
          AsyncStorage.getItem(LAST_LOCATION_KEY),
        ]);

        if (!deviceId) return; // app not yet initialised

        const domain = process.env.EXPO_PUBLIC_DOMAIN ?? "";
        if (!domain) return;

        // ── 1. Refresh push token if stale ──────────────────────────────────
        const registeredAt = registeredAtStr ? parseInt(registeredAtStr, 10) : 0;
        const tokenStale = !token || (Date.now() - registeredAt) > TOKEN_REFRESH_AGE_MS;
        let activeToken = token;

        if (tokenStale) {
          try {
            // Dynamic import so Expo Go (missing native modules) doesn't crash.
            const Constants = (await import("expo-constants")).default;
            const projectId =
              (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
                ?.eas?.projectId ?? EAS_PROJECT_ID;

            const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
            activeToken = tokenData.data;

            await fetch(`https://${domain}/api/push/register`, {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify({
                deviceId,
                token:    activeToken,
                platform: Platform.OS,
              }),
            });

            await Promise.all([
              AsyncStorage.setItem(TOKEN_KEY, activeToken),
              AsyncStorage.setItem(TOKEN_REGISTERED_AT_KEY, String(Date.now())),
            ]);
          } catch (refreshErr) {
            // Non-fatal — stale token stays; next wakeup will retry
            console.warn("[bgNotifTask] Token refresh failed:", refreshErr);
          }
        }

        // ── 2. Heartbeat + optional location sync ──────────────────────────
        // Always POST to /push/location with source="background_task" so the
        // server stamps lastBgWakeupAt unconditionally — even if no cached
        // location is available. This is the confirmed proof that the background
        // task executed on this device (critical for diagnosing iOS silent pushes).
        try {
          const locationFields: { lat?: number; lng?: number } = {};
          if (locationRaw) {
            try {
              const parsed = JSON.parse(locationRaw) as { lat?: number; lng?: number };
              if (parsed.lat != null && parsed.lng != null) {
                locationFields.lat = parsed.lat;
                locationFields.lng = parsed.lng;
              }
            } catch {
              // Malformed stored location — heartbeat still fires below
            }
          }

          await fetch(`https://${domain}/api/push/location`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ deviceId, source: "background_task", ...locationFields }),
          });
        } catch {
          // Non-critical — silently swallow
        }
      } catch (err) {
        console.warn("[bgNotifTask] Unhandled error:", err);
      }
    }
  );
}
