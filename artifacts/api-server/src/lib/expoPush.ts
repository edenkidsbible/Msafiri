import { logger } from "./logger.js";

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
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
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
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
