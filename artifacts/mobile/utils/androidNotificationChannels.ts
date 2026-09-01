import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

export const ANDROID_GENERAL_CHANNEL_ID = "msafiri_general";
export const ANDROID_ALERTS_CHANNEL_ID = "msafiri_alerts";
export const ANDROID_NAV_CHANNEL_ID = "msafiri_nav";

// ── Per-type voice alert channels ─────────────────────────────────────────────
// Android 8+ (API 26+) plays the notification channel's sound, not the
// per-notification content sound.  We create one channel per alert type so
// the correct Yna Agalo clip plays for each hazard category.
//
// IMPORTANT: Android ignores sound / importance updates on existing channel IDs.
// These use the `msafiri_voice_` prefix (distinct from `msafiri_alerts`) so
// they are created fresh on every install and never conflict with the legacy channel.
const VOICE_CHANNEL_TYPES = [
  "camera", "police", "zone", "alcoblow", "accident", "traffic",
  "roadblock", "roadworks", "hazard", "pothole", "debris", "breakdown",
  "weather", "closure", "clear", "speed_bump",
] as const;

type VoiceChannelType = typeof VOICE_CHANNEL_TYPES[number];

// Channel sound and importance are immutable after Android creates a channel.
// Increment this suffix whenever the packaged Yna files or channel sound setup
// changes so existing installs receive fresh, correctly configured channels.
const VOICE_CHANNEL_VERSION = "v2";

function voiceChannelId(type: VoiceChannelType): string {
  return `msafiri_voice_${VOICE_CHANNEL_VERSION}_${type}`;
}

/**
 * Returns the per-type voice notification channel ID for a given alert type.
 * Falls back to the generic `msafiri_alerts` channel for unknown types.
 */
export function resolveAndroidVoiceChannelId(type: string): string {
  if ((VOICE_CHANNEL_TYPES as readonly string[]).includes(type)) {
    return voiceChannelId(type as VoiceChannelType);
  }
  return ANDROID_ALERTS_CHANNEL_ID;
}

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

      // ── Existing channels ─────────────────────────────────────────────
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

      // ── Per-type Yna Agalo voice channels ────────────────────────────
      // Each channel plays the matching Yna Agalo voice clip for its hazard
      // type. Versioned IDs guarantee that an existing install which cached a
      // missing/silent sound on an older channel receives a fresh channel.
      const VOICE_CHANNEL_DEFS: Array<{ type: VoiceChannelType; label: string }> = [
        { type: "camera",     label: "Speed Camera Alerts"      },
        { type: "police",     label: "Police Checkpoint Alerts"  },
        { type: "zone",       label: "Speed Zone Alerts"         },
        { type: "alcoblow",   label: "Alcoblow Alerts"           },
        { type: "accident",   label: "Accident Alerts"           },
        { type: "traffic",    label: "Traffic Alerts"            },
        { type: "roadblock",  label: "Roadblock Alerts"          },
        { type: "roadworks",  label: "Road Works Alerts"         },
        { type: "hazard",     label: "Hazard Alerts"             },
        { type: "pothole",    label: "Pothole Alerts"            },
        { type: "debris",     label: "Debris Alerts"             },
        { type: "breakdown",  label: "Breakdown Alerts"          },
        { type: "weather",    label: "Weather Alerts"            },
        { type: "closure",    label: "Road Closure Alerts"       },
        { type: "clear",      label: "Road Clear Alerts"         },
        { type: "speed_bump", label: "Speed Bump Alerts"         },
      ];

      await Promise.all(
        VOICE_CHANNEL_DEFS.map(({ type, label }) =>
          Notifications.setNotificationChannelAsync(voiceChannelId(type), {
            name: label,
            importance: Notifications.AndroidImportance.HIGH,
            sound: `${type}.mp3`,
            vibrationPattern: [0, 200, 100, 200],
            lightColor: "#00C853",
          }),
        ),
      );

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

      // Validate the channels that background drive alerts actually target,
      // rather than only checking the generic fallback channel.
      const voiceChannels = await Promise.all(
        VOICE_CHANNEL_TYPES.map((type) =>
          Notifications.getNotificationChannelAsync(voiceChannelId(type)),
        ),
      );
      if (
        voiceChannels.some(
          (channel) =>
            !channel ||
            channel.importance < Notifications.AndroidImportance.HIGH ||
            !channel.sound,
        )
      ) {
        console.warn(
          "[androidNotifications] One or more voice alert channels are unavailable or silent.",
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