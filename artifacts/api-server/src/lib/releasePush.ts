import { db, appReleasesTable, pushTokensTable, pushCampaignsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";
import { sendPushNotifications } from "./expoPush.js";

type AppRelease = typeof appReleasesTable.$inferSelect;

function isDevicePlatform(platform: string): platform is "ios" | "android" {
  return platform === "ios" || platform === "android";
}

/**
 * Notify only the devices that can receive a particular release.
 *
 * "all" remains supported for intentionally broadcast releases and for older
 * records, while platform-specific releases are strictly scoped to their OS.
 */
export async function fireReleasePush(
  release: AppRelease,
  actorName: string,
): Promise<void> {
  const notifTitle = release.isForceUpdate
    ? `Msafiri just got better 🚀`
    : `What's new in Msafiri v${release.version} ✨`;
  const notifBody = release.isForceUpdate
    ? `v${release.version} is ready for you — a quick update and you're back on the road.`
    : (release.releaseNotes
        ? release.releaseNotes.slice(0, 120) + (release.releaseNotes.length > 120 ? "…" : "")
        : `Msafiri v${release.version} is here. Tap to see what's new.`);

  const notifData = {
    type:            "app_update",
    version:         release.version,
    isForceUpdate:   release.isForceUpdate,
    releaseNotes:    release.releaseNotes ?? "",
    storeUrlIos:     release.storeUrlIos ?? "",
    storeUrlAndroid: release.storeUrlAndroid ?? "",
    platform:        release.platform,
  };

  const tokens = isDevicePlatform(release.platform)
    ? await db
        .select({ token: pushTokensTable.token })
        .from(pushTokensTable)
        .where(eq(pushTokensTable.platform, release.platform))
    : await db.select({ token: pushTokensTable.token }).from(pushTokensTable);

  if (tokens.length === 0) {
    logger.info(
      { version: release.version, platform: release.platform },
      "release push skipped: no registered devices for target platform",
    );
    return;
  }

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
    sentAt:      new Date(),
    sentCount:   ok,
    failedCount: failed,
    targetCount: tokens.length,
    createdBy:   actorName,
  });

  logger.info(
    { version: release.version, platform: release.platform, ok, total: tokens.length },
    "release push sent",
  );
}