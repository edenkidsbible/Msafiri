/**
 * dedupPushTokens — runs at API server startup.
 *
 * Removes duplicate push_tokens rows that share the same Expo push token
 * but carry different device_ids. This accumulates when a user reinstalls
 * the app: AsyncStorage is wiped so a new deviceId is minted, but APNs/FCM
 * issues the same push token, causing a fresh row to be inserted alongside
 * the old one instead of replacing it.
 *
 * For each duplicated token, we keep the row with the most-recent
 * last_seen_at (the active install) and delete the rest.
 *
 * The registration route now also deletes stale rows on each registration,
 * so this is mainly a one-time cleanup for databases that accumulated
 * duplicates before that fix was deployed.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

export async function dedupPushTokens(): Promise<void> {
  try {
    // Find tokens that appear more than once
    const dupeRows = await db.execute(sql`
      SELECT COUNT(*)::int AS dupe_count
      FROM (
        SELECT token
        FROM push_tokens
        GROUP BY token
        HAVING COUNT(*) > 1
      ) dupes
    `);

    const dupeCount = Number((dupeRows.rows[0] as Record<string, unknown>)?.dupe_count ?? 0);

    if (dupeCount === 0) {
      logger.info("Push token dedup — no duplicates found, skipping");
      return;
    }

    logger.info({ dupeCount }, "Push token dedup — removing duplicate token rows…");

    // Delete every row that is NOT the most-recent row for its token
    const result = await db.execute(sql`
      DELETE FROM push_tokens
      WHERE id NOT IN (
        SELECT DISTINCT ON (token) id
        FROM push_tokens
        ORDER BY token, last_seen_at DESC
      )
    `);

    const deleted = result.rowCount ?? "?";
    logger.info({ deleted }, "Push token dedup — complete");
  } catch (err) {
    logger.error({ err }, "Push token dedup failed");
  }
}
