import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

export const ANDROID_GENERAL_CHANNEL_ID = "msafiri_general";
export const ANDROID_ALERTS_CHANNEL_ID = "msafiri_alerts";
export const ANDROID_NAV_CHANNEL_ID = "msafiri_nav";

let setupPromise: Promise<boolean> | null = null;

/**
 * Creates the Android channels used by every local and remote Msafiri alert.
 *
 * This intentionally has no iOS side effects. It is shared by the foreground
 * push hook and the background location task so neither path can schedule a
 * notification before the Android channel exists.
 */
export async function ensureAndroidNotificationChannels(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  if (setupPromise) return setupPromise;

  setupPromise = (async () => {
    try {
      // These legacy channels were created at DEFAULT priority and can never be
      // upgraded by Android. Removing them does not affect the active channels.
      await Promise.all([
        Notifications.deleteNotificationChannelAsync("default").catch(() => {}),
        Notifications.deleteNotificationChannelAsync("incident-alerts").catch(() => {}),
      ]);

      await Promise.all([
        Notifications.setNotificationChannelAsync(ANDROID_GENERAL_CHANNEL_ID, {
          name: "General Notifications",
          importance: Notifications.AndroidImportance.HIGH,
          sound: "default",
          vibrationPattern: [0, 150, 100, 150],
        }),
        Notifications.setNotificationChannelAsync(ANDROID_ALERTS_CHANNEL_ID, {
          name: "Incident Alerts",
          importance: Notifications.AndroidImportance.HIGH,
          sound: "alert_tone.mp3",
          vibrationPattern: [0, 200, 100, 200],
          lightColor: "#00C853",
        }),
        Notifications.setNotificationChannelAsync(ANDROID_NAV_CHANNEL_ID, {
          name: "Navigation Status",
          importance: Notifications.AndroidImportance.LOW,
          sound: undefined,
          vibrationPattern: undefined,
          enableVibrate: false,
        }),
      ]);

      const alertsChannel = await Notifications.getNotificationChannelAsync(
        ANDROID_ALERTS_CHANNEL_ID,
      );
      if (!alertsChannel || alertsChannel.importance < Notifications.AndroidImportance.HIGH) {
        console.warn(
          "[androidNotifications] Incident Alerts channel is unavailable or muted. " +
          "Open Android notification settings and enable sound for Msafiri.",
        );
        return false;
      }
      return true;
    } catch (error) {
      console.warn("[androidNotifications] Channel setup failed:", error);
      return false;
    }
  })();

  const result = await setupPromise;
  if (!result) setupPromise = null;
  return result;
}