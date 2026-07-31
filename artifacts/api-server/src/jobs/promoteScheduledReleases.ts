import { db, appReleasesTable, pushTokensTable, pushCampaignsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendPushNotifications } from "../lib/expoPush";

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
      const notifTitle = r.isForceUpdate
        ? `Msafiri just got better 🚀`
        : `What's new in Msafiri v${r.version} ✨`;
      const notifBody = r.isForceUpdate
        ? `v${r.version} is ready for you — a quick update and you're back on the road.`
        : (r.releaseNotes
            ? r.releaseNotes.slice(0, 120) + (r.releaseNotes.length > 120 ? "…" : "")
            : `Msafiri v${r.version} is here. Tap to see what's new.`);

      const notifData = {
        type:            "app_update",
        version:         r.version,
        isForceUpdate:   r.isForceUpdate,
        releaseNotes:    r.releaseNotes ?? "",
        storeUrlIos:     r.storeUrlIos ?? "",
        storeUrlAndroid: r.storeUrlAndroid ?? "",
      };

      const tokens = await db.select({ token: pushTokensTable.token }).from(pushTokensTable);
      if (tokens.length > 0) {
        const messages = tokens.map((t) => ({
          to:        t.token,
          title:     notifTitle,
          body:      notifBody,
          sound:     "default" as const,
          channelId: "msafiri_alerts",
          data:      notifData,
        }));

        const { ok, failed } = await sendPushNotifications(messages);

        await db.insert(pushCampaignsTable).values({
          title:       notifTitle,
          body:        notifBody,
          dataJson:    JSON.stringify(notifData),
          type:        "broadcast",
          status:      "sent",
          sentAt:      now,
          sentCount:   ok,
          failedCount: failed,
          targetCount: tokens.length,
          createdBy:   "scheduler",
        });

        logger.info({ version: r.version, ok, total: tokens.length }, "promoteScheduledReleases: push sent");
      }
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
