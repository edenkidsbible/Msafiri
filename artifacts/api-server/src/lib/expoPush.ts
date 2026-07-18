import { logger } from "./logger.js";

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  // "default" plays the OS default tone; a filename (e.g. "alert_tone.mp3")
  // plays the custom sound bundled via the expo-notifications config plugin
  // on iOS. Android ignores this field entirely and instead uses whatever
  // sound is attached to `channelId` on the device (see usePushNotifications.ts).
  sound?: "default" | string | null;
  // Must match a channel id created client-side via setNotificationChannelAsync,
  // or Android falls back to the "default" channel (system default sound).
  channelId?: string;
  badge?: number;
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK_SIZE = 100;

// When set, the Authorization header ties push requests to your Expo account
// so Expo uses your project's registered APNs/FCM credentials and applies the
// paid-tier rate limits instead of the anonymous (very low) free limit.
const EXPO_ACCESS_TOKEN = process.env.EXPO_ACCESS_TOKEN ?? null;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export async function sendPushNotifications(
  messages: PushMessage[]
): Promise<{ ok: number; failed: number }> {
  if (messages.length === 0) return { ok: 0, failed: 0 };

  let ok = 0;
  let failed = 0;

  for (const chunk of chunkArray(messages, CHUNK_SIZE)) {
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      };
      if (EXPO_ACCESS_TOKEN) {
        headers["Authorization"] = `Bearer ${EXPO_ACCESS_TOKEN}`;
      }

      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(chunk),
      });

      if (!response.ok) {
        logger.error({ status: response.status }, "Expo push API HTTP error");
        failed += chunk.length;
        continue;
      }

      const result = (await response.json()) as { data: ExpoPushTicket[] };
      for (const ticket of result.data ?? []) {
        if (ticket.status === "ok") {
          ok++;
        } else {
          failed++;
          logger.warn({ ticket }, "Expo push ticket error");
        }
      }
    } catch (err) {
      logger.error({ err }, "Failed to send push chunk");
      failed += chunk.length;
    }
  }

  return { ok, failed };
}
