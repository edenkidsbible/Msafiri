import { db, communityReportsTable } from "@workspace/db";
import { and, lt, ne } from "drizzle-orm";
import { logger } from "../lib/logger";

const INTERVAL_MS = 60 * 1000;

async function runExpireReports(): Promise<void> {
  const result = await db
    .update(communityReportsTable)
    .set({ status: "expired" })
    .where(
      and(
        lt(communityReportsTable.expiresAt, new Date()),
        ne(communityReportsTable.status, "expired"),
        ne(communityReportsTable.status, "denied"),
        // Reports awaiting first moderator review must never auto-expire —
        // they'd silently vanish from the moderation queue without a decision.
        ne(communityReportsTable.status, "pending_review")
      )
    )
    .returning({ id: communityReportsTable.id });

  if (result.length > 0) {
    logger.info({ count: result.length }, "expireReports: expired stale reports");
  }
}

export function startExpireReportsJob(): NodeJS.Timeout {
  logger.info({ intervalMs: INTERVAL_MS }, "expireReports job started");

  runExpireReports().catch((err) =>
    logger.warn({ err }, "expireReports: initial run failed")
  );

  return setInterval(() => {
    runExpireReports().catch((err) =>
      logger.warn({ err }, "expireReports: interval run failed")
    );
  }, INTERVAL_MS);
}
