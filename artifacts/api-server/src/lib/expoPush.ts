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
  // Must match a channel id created client-side via setNotificationChannelAsync.
  // Always set this for Android — without it the notification may be silently
  // discarded on Android 8+ even when FCM returns a successful receipt.
  channelId?: string;
  badge?: number;
  // "high" wakes the device immediately (bypasses FCM batching / Doze mode on
  // Android, and maps to APNs priority 10 on iOS). Without this, FCM may hold
  // the message for minutes or hours before delivering. Always "high" for user-
  // visible alerts; only use "normal" for silent background syncs.
  priority?: "default" | "normal" | "high";
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoPushReceipt {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const CHUNK_SIZE = 100;

// When set, the Authorization header ties push requests to your Expo account
// so Expo uses your project's registered APNs/FCM credentials and applies the
// paid-tier rate limits instead of the anonymous (very low) free limit.
const EXPO_ACCESS_TOKEN = process.env.EXPO_ACCESS_TOKEN ?? null;

// In-memory map of ticketId → push token, used to identify which DB token
// to purge when a receipt comes back with BadDeviceToken / DeviceNotRegistered.
// Cleared after each receipt flush. Survives for the lifetime of the process.
const pendingReceipts = new Map<string, string>();

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function makeHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  if (EXPO_ACCESS_TOKEN) h["Authorization"] = `Bearer ${EXPO_ACCESS_TOKEN}`;
  return h;
}

export async function sendPushNotifications(
  messages: PushMessage[]
): Promise<{ ok: number; failed: number }> {
  if (messages.length === 0) return { ok: 0, failed: 0 };

  let ok = 0;
  let failed = 0;

  // Default every message to priority "high" so FCM delivers immediately
  // (bypasses Doze mode / batching) and APNs uses priority 10.
  // Call sites can override by setting priority explicitly.
  const normalized = messages.map((m) => ({ priority: "high" as const, ...m }));

  for (const chunk of chunkArray(normalized, CHUNK_SIZE)) {
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: makeHeaders(),
        body: JSON.stringify(chunk),
      });

      if (!response.ok) {
        logger.error({ status: response.status }, "Expo push API HTTP error");
        failed += chunk.length;
        continue;
      }

      const result = (await response.json()) as { data: ExpoPushTicket[] };
      (result.data ?? []).forEach((ticket, i) => {
        if (ticket.status === "ok") {
          ok++;
          // Store ticketId → token so we can match receipts later
          if (ticket.id && chunk[i]?.to) {
            pendingReceipts.set(ticket.id, chunk[i].to);
          }
        } else {
          failed++;
          logger.warn({ ticket }, "Expo push ticket error");
        }
      });
    } catch (err) {
      logger.error({ err }, "Failed to send push chunk");
      failed += chunk.length;
    }
  }

  return { ok, failed };
}

/**
 * Check receipts for all pending ticket IDs and return any push tokens that
 * APNs/FCM confirmed as permanently invalid (BadDeviceToken, DeviceNotRegistered).
 * Call this ~15–30 minutes after sending to give Expo time to process delivery.
 * The caller should delete the returned tokens from the DB push_tokens table.
 */
export async function flushBadTokensFromReceipts(): Promise<string[]> {
  if (pendingReceipts.size === 0) return [];

  const ids = [...pendingReceipts.keys()];
  const badTokens: string[] = [];

  for (const chunk of chunkArray(ids, CHUNK_SIZE)) {
    try {
      const response = await fetch(EXPO_RECEIPTS_URL, {
        method: "POST",
        headers: makeHeaders(),
        body: JSON.stringify({ ids: chunk }),
      });

      if (!response.ok) {
        logger.error({ status: response.status }, "Expo receipts API HTTP error");
        continue;
      }

      const result = (await response.json()) as { data: Record<string, ExpoPushReceipt> };
      for (const [ticketId, receipt] of Object.entries(result.data ?? {})) {
        const token = pendingReceipts.get(ticketId);
        if (!token) continue;

        // Always clear processed entries regardless of status
        pendingReceipts.delete(ticketId);

        if (receipt.status === "error") {
          const errCode = receipt.details?.error ?? "";
          if (errCode === "DeviceNotRegistered" || errCode === "BadDeviceToken") {
            logger.warn({ token, errCode }, "Purging bad push token via receipt check");
            badTokens.push(token);
          } else {
            logger.warn({ ticketId, receipt }, "Expo push receipt error (non-fatal)");
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "Failed to check push receipts");
    }
  }

  return badTokens;
}
