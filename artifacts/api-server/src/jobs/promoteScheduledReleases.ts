import { db, appReleasesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { fireReleasePush } from "../lib/releasePush";

// Check every 60 seconds — fine-grained enough for scheduled releases
const INTERVAL_MS = 60 * 1000;

async function runPromoteScheduled(): Promise<void> {
  const now = new Date();

  const scheduled = await db
    .select()
    .from(appReleasesTable)
    .where(eq(appReleasesTable.status, "scheduled"));

  for (const r of scheduled) {
    if (!r.scheduledAt || r.scheduledAt > now) continue;

    // Promote to live
    await db
      .update(appReleasesTable)
      .set({ status: "live", publishedAt: now })
      .where(eq(appReleasesTable.id, r.id));

    logger.info({ version: r.version }, "promoteScheduledReleases: release promoted to live");

    // Fire push notification
    try {
      await fireReleasePush(r, "scheduler");
    } catch (pushErr) {
      logger.error({ err: pushErr, version: r.version }, "promoteScheduledReleases: push failed after promotion");
    }
  }
}

export function startPromoteScheduledReleasesJob(): NodeJS.Timeout {
  logger.info({ intervalMs: INTERVAL_MS }, "promoteScheduledReleases job started");

  runPromoteScheduled().catch((err) =>
    logger.warn({ err }, "promoteScheduledReleases: initial run failed")
  );

  return setInterval(() => {
    runPromoteScheduled().catch((err) =>
      logger.warn({ err }, "promoteScheduledReleases: interval run failed")
    );
  }, INTERVAL_MS);
}
