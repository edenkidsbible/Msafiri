/**
 * abandonDraftAccidents.ts
 *
 * Background job that marks stale "draft" accident records as "abandoned".
 *
 * A record is eligible when:
 *   status = 'draft'          → the Crash Assistant was never completed
 *   createdAt < now - TTL_MS  → the driver has had ample time to finish
 *
 * "abandoned" is a terminal status: the record is never shown in the Crash
 * Vault again, but it is kept in the DB for potential support diagnostics
 * (unlike a hard delete which would lose location/speed context forever).
 *
 * The job runs once daily.  It can also be triggered on-demand via the admin
 * endpoint POST /admin/jobs/abandon-draft-accidents.
 */

import { db, accidentRecordsTable } from "@workspace/db";
import { and, eq, lt } from "drizzle-orm";
import { logger } from "../lib/logger";

/** Draft records older than this are eligible for abandonment. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** How often the sweep runs automatically. */
const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface AbandonResult {
  abandoned: number;
}

/**
 * Run a single sweep.
 * Idempotent — safe to call from an admin endpoint or a test.
 */
export async function runAbandonDraftAccidents(): Promise<AbandonResult> {
  const cutoff = new Date(Date.now() - TTL_MS);

  const updated = await db
    .update(accidentRecordsTable)
    .set({ status: "abandoned" })
    .where(
      and(
        eq(accidentRecordsTable.status, "draft"),
        lt(accidentRecordsTable.createdAt, cutoff),
      ),
    )
    .returning({ id: accidentRecordsTable.id });

  if (updated.length > 0) {
    logger.info({ count: updated.length }, "abandonDraftAccidents: marked stale drafts as abandoned");
  } else {
    logger.debug("abandonDraftAccidents: no stale drafts found");
  }

  return { abandoned: updated.length };
}

/** Start the daily sweep. Returns the interval handle for teardown. */
export function startAbandonDraftAccidentsJob(): NodeJS.Timeout {
  logger.info({ intervalMs: INTERVAL_MS }, "abandonDraftAccidents job started");

  // Offset initial run by 60 s so it doesn't compete with startup tasks.
  const initial = setTimeout(() => {
    runAbandonDraftAccidents().catch((err) =>
      logger.warn({ err }, "abandonDraftAccidents: initial run failed"),
    );
  }, 60_000);
  initial.unref?.();

  return setInterval(() => {
    runAbandonDraftAccidents().catch((err) =>
      logger.warn({ err }, "abandonDraftAccidents: interval run failed"),
    );
  }, INTERVAL_MS);
}
