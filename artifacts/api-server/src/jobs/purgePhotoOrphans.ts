/**
 * purgePhotoOrphans.ts
 *
 * Background job that removes accident_photos rows whose R2 object never
 * arrived — i.e. the client called the presign endpoint but the subsequent
 * direct PUT (or the /confirm call) was lost (network drop, app kill, etc.).
 *
 * Detection criteria
 * ──────────────────
 *   storageUrl IS NULL   → confirm was never called / confirm HEAD-check failed
 *   fileKey IS NOT NULL  → a presign was issued (object key is known)
 *   createdAt < now - GRACE_MS  → give the client a window to complete the PUT
 *
 * Rows whose R2 object is present are left alone — the mobile client will
 * retry /confirm and the inline HEAD-check there will set storageUrl.
 * Only rows with a genuinely absent object are deleted.
 */

import { db, accidentPhotosTable } from "@workspace/db";
import { and, eq, isNull, isNotNull, lt } from "drizzle-orm";
import * as r2 from "../lib/r2Storage";
import { logger } from "../lib/logger";

/** Minimum age of an unconfirmed row before it is eligible for sweep. */
const GRACE_MS = 60 * 60 * 1000; // 1 hour

/** How often the sweep runs automatically. */
const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface PurgeResult {
  checked: number;
  orphansRemoved: number;
  errors: number;
}

/**
 * Run a single reconciliation pass.
 * Safe to call manually (e.g. from an admin endpoint) as well as from the
 * scheduled interval — all operations are idempotent.
 */
export async function runPurgePhotoOrphans(): Promise<PurgeResult> {
  if (!r2.isR2Configured()) {
    logger.debug("purgePhotoOrphans: R2 not configured, skipping");
    return { checked: 0, orphansRemoved: 0, errors: 0 };
  }

  const cutoff = new Date(Date.now() - GRACE_MS);

  // Fetch all unconfirmed rows that are old enough to be eligible.
  const candidates = await db
    .select({
      id:        accidentPhotosTable.id,
      fileKey:   accidentPhotosTable.fileKey,
      createdAt: accidentPhotosTable.createdAt,
    })
    .from(accidentPhotosTable)
    .where(
      and(
        isNull(accidentPhotosTable.storageUrl),
        isNotNull(accidentPhotosTable.fileKey),
        lt(accidentPhotosTable.createdAt, cutoff),
      ),
    );

  if (candidates.length === 0) {
    logger.debug("purgePhotoOrphans: no candidates");
    return { checked: 0, orphansRemoved: 0, errors: 0 };
  }

  logger.info({ count: candidates.length }, "purgePhotoOrphans: checking candidates");

  let orphansRemoved = 0;
  let errors = 0;

  for (const row of candidates) {
    if (!row.fileKey) continue; // type narrowing — already filtered above
    try {
      const exists = await r2.headObject(row.fileKey);
      if (exists !== null) {
        // Object landed in R2 — leave the row for the client to /confirm.
        continue;
      }
      // Object is absent: remove the DB row so the Crash Vault won't show a
      // broken-image placeholder for this photo.
      // re-check storageUrl so we never delete a row that was confirmed
      // concurrently between our SELECT and this DELETE.
      const deleted = await db
        .delete(accidentPhotosTable)
        .where(
          and(
            eq(accidentPhotosTable.id, row.id),
            isNull(accidentPhotosTable.storageUrl),
          ),
        )
        .returning({ id: accidentPhotosTable.id });
      if (deleted.length === 0) continue; // confirmed concurrently — skip
      orphansRemoved++;
      logger.info({ photoId: row.id, fileKey: row.fileKey }, "purgePhotoOrphans: removed orphan");
    } catch (err) {
      errors++;
      logger.warn({ err, photoId: row.id, fileKey: row.fileKey }, "purgePhotoOrphans: HEAD check failed");
    }
  }

  logger.info(
    { checked: candidates.length, orphansRemoved, errors },
    "purgePhotoOrphans: sweep complete",
  );

  return { checked: candidates.length, orphansRemoved, errors };
}

/** Start the periodic sweep. Returns the interval handle for tests / teardown. */
export function startPurgePhotoOrphansJob(): NodeJS.Timeout {
  logger.info({ intervalMs: INTERVAL_MS }, "purgePhotoOrphans job started");

  // Run once shortly after startup (offset by 30 s so it doesn't compete with
  // the schema migration and seed tasks that finish first).
  const initial = setTimeout(() => {
    runPurgePhotoOrphans().catch((err) =>
      logger.warn({ err }, "purgePhotoOrphans: initial run failed"),
    );
  }, 30_000);
  // Keep TS happy — the interval is what callers care about; the initial
  // setTimeout is fire-and-forget.
  initial.unref?.();

  return setInterval(() => {
    runPurgePhotoOrphans().catch((err) =>
      logger.warn({ err }, "purgePhotoOrphans: interval run failed"),
    );
  }, INTERVAL_MS);
}
