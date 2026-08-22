import { logger } from "./logger.js";

export interface PushMessage {
  to: string;
  /** Visible notifications require title. Data-only (background) pushes should
   *  omit title and body entirely — empty strings can cause the OS to treat the
   *  payload as a visible notification rather than a silent background delivery. */
  title?: string;
  body?: string;
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
  // Expo's documented field for APNs content-available: 1 (note the underscore
  // prefix — this is what the Expo push gateway maps to the APNs flag).
  // Tells iOS to wake the app briefly in the background so it can refresh its
  // push token and location. Must be paired with UIBackgroundModes:
  // ["remote-notification"] in app.config. Omit for normal-priority silent
  // refresh pushes — those should not burn a background execution slot.
  _contentAvailable?: boolean;
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

// Tokens that belong to a different Expo project/experience than this one.
// Collected when Expo returns PUSH_TOO_MANY_EXPERIENCE_IDS and drained by
// the receipt-purge job so they are removed from the DB.
const foreignExperienceTokens = new Set<string>();

// Prevents a double-clicked campaign or overlapping job tick from delivering
// an identical payload twice to one device. This is intentionally short: it
// only suppresses true duplicate sends, not subsequent real alerts.
const RECENT_DUPLICATE_WINDOW_MS = 60_000;
const recentlySentPayloads = new Map<string, number>();

/**
 * Returns and clears all tokens flagged as belonging to a foreign Expo
 * experience (a different project than the one this server is configured for).
 * Call this from the periodic dead-token purge job.
 */
export function drainForeignExperienceTokens(): string[] {
  const tokens = [...foreignExperienceTokens];
  foreignExperienceTokens.clear();
  return tokens;
}

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

  // A device can retain its Expo token across a reinstall while its local
  // device ID changes. Guarding at the sending boundary keeps legacy duplicate
  // rows (and overlapping audience queries) from producing two identical
  // notifications on the same phone.
  const seenTokens = new Set<string>();
  const uniqueMessages = messages.filter((message) => {
    if (seenTokens.has(message.to)) return false;
    seenTokens.add(message.to);
    return true;
  });

  const now = Date.now();
  for (const [key, sentAt] of recentlySentPayloads) {
    if (now - sentAt > RECENT_DUPLICATE_WINDOW_MS) recentlySentPayloads.delete(key);
  }
  const deliveryMessages = uniqueMessages.filter((message) => {
    const key = `${message.to}\u0000${message.title ?? ""}\u0000${message.body ?? ""}\u0000${JSON.stringify(message.data ?? {})}`;
    if (recentlySentPayloads.has(key)) return false;
    recentlySentPayloads.set(key, now);
    return true;
  });

  const duplicatesDropped = messages.length - deliveryMessages.length;
  if (duplicatesDropped > 0) {
    logger.warn({ duplicatesDropped }, "Suppressed duplicate Expo pushes");
  }

  // Default every message to priority "high" so FCM delivers immediately
  // (bypasses Doze mode / batching) and APNs uses priority 10.
  // Call sites override `priority` and `_contentAvailable` explicitly — do NOT
  // add `_contentAvailable` as a blanket default here because Apple rejects
  // content-available pushes sent at APNs priority 10 (should be priority 5).
  const normalized = deliveryMessages.map((m) => ({ priority: "high" as const, ...m }));

  for (const chunk of chunkArray(normalized, CHUNK_SIZE)) {
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: makeHeaders(),
        body: JSON.stringify(chunk),
      });

      if (!response.ok) {
        let errorBody: unknown;
        try { errorBody = await response.json(); } catch { errorBody = await response.text().catch(() => "(unreadable)"); }

        // PUSH_TOO_MANY_EXPERIENCE_IDS: the batch contains tokens from multiple
        // Expo projects (e.g. after migrating to a new Expo account).  Split by
        // project, queue the minority group for DB purge, and retry with the
        // largest group (which should be our current project).
        const errCode = (errorBody as any)?.errors?.[0]?.code;
        if (errCode === "PUSH_TOO_MANY_EXPERIENCE_IDS") {
          const details: Record<string, string[]> = (errorBody as any).errors[0].details ?? {};
          const groups = Object.entries(details);
          // Largest group = our current project; all others are stale/foreign.
          groups.sort((a, b) => b[1].length - a[1].length);
          const [ourExp, ourTokens] = groups[0] ?? ["", []];
          const ourSet = new Set(ourTokens);
          for (const [exp, tokens] of groups.slice(1)) {
            logger.warn({ exp, count: tokens.length }, "Purging push tokens from foreign Expo experience");
            tokens.forEach((t) => foreignExperienceTokens.add(t));
          }
          logger.warn({ ourExp, kept: ourTokens.length, purged: chunk.length - ourTokens.length }, "PUSH_TOO_MANY_EXPERIENCE_IDS — retrying with current-project tokens only");

          // Retry with only the tokens that belong to our project.
          const retryChunk = chunk.filter((m) => ourSet.has(m.to));
          if (retryChunk.length > 0) {
            try {
              const retryRes = await fetch(EXPO_PUSH_URL, {
                method: "POST",
                headers: makeHeaders(),
                body: JSON.stringify(retryChunk),
              });
              if (retryRes.ok) {
                const retryResult = (await retryRes.json()) as { data: ExpoPushTicket[] };
                (retryResult.data ?? []).forEach((ticket, i) => {
                  if (ticket.status === "ok") {
                    ok++;
                    if (ticket.id && retryChunk[i]?.to) pendingReceipts.set(ticket.id, retryChunk[i].to);
                  } else {
                    failed++;
                    logger.warn({ ticket }, "Expo push ticket error (retry after experience split)");
                  }
                });
              } else {
                failed += retryChunk.length;
              }
            } catch (retryErr) {
              failed += retryChunk.length;
            }
          }
          // Count foreign tokens as failed (they can't receive pushes anyway).
          failed += chunk.length - retryChunk.length;
          continue;
        }

        logger.error({ status: response.status, body: errorBody, sampleToken: chunk[0]?.to?.slice(0, 30) }, "Expo push API HTTP error");
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
 * Send a silent data-only wake-up ping to the supplied push tokens.
 * No visible notification is shown — the client's background notification task
 * uses the wakeup slot to refresh its push token and location on the server.
 * Intended for dormant users who haven't opened the app in several days.
 *
 * Platform split is required:
 *   iOS   → priority "normal" (APNs priority 5) — Apple rejects content-available
 *            pushes sent at APNs priority 10 ("high") and will not invoke the task.
 *   Android → priority "high" so FCM bypasses Doze mode and wakes the app.
 *
 * title/body are intentionally absent — data-only payloads must omit them;
 * empty strings can cause the OS to treat the message as a visible notification.
 */
export async function sendSilentPing(
  tokens: { token: string; platform?: string | null }[]
): Promise<{ ok: number; failed: number }> {
  if (tokens.length === 0) return { ok: 0, failed: 0 };

  const iosTokens   = tokens.filter((t) => t.platform === "ios").map((t) => t.token);
  const otherTokens = tokens.filter((t) => t.platform !== "ios").map((t) => t.token);

  const makePing = (to: string, priority: "normal" | "high") => ({
    to,
    priority,
    _contentAvailable: true as const,
    data: { type: "silent_ping" },
  });

  const [iosResult, androidResult] = await Promise.all([
    iosTokens.length > 0
      ? sendPushNotifications(iosTokens.map((t) => makePing(t, "normal")))
      : Promise.resolve({ ok: 0, failed: 0 }),
    otherTokens.length > 0
      ? sendPushNotifications(otherTokens.map((t) => makePing(t, "high")))
      : Promise.resolve({ ok: 0, failed: 0 }),
  ]);

  return {
    ok:     iosResult.ok     + androidResult.ok,
    failed: iosResult.failed + androidResult.failed,
  };
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
