import {
  db,
  creatorApplicationsTable,
  creatorBenefitsTable,
  communityReportsTable,
  pushTokensTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { sendPushNotifications } from "../lib/expoPush.js";
import { sendCreatorActivityReminder } from "../lib/email.js";
import { logger } from "../lib/logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_AFTER_DAYS = 3;
const REVOKE_AFTER_DAYS = 7;
const REMINDER_COOLDOWN_DAYS = 3;

export type CreatorActivityDecision = "none" | "remind" | "revoke";

export function selectActivityAnchor(
  offerStartedAt: Date | null,
  lastReportAt: Date | null,
): Date | null {
  if (!offerStartedAt) return null;
  if (!lastReportAt || lastReportAt < offerStartedAt) return offerStartedAt;
  return lastReportAt;
}

export function evaluateCreatorActivity(input: {
  now: Date;
  activityAnchor: Date;
  lastReminderAt: Date | null;
}): { decision: CreatorActivityDecision; inactiveDays: number } {
  const inactiveDays = Math.floor((input.now.getTime() - input.activityAnchor.getTime()) / DAY_MS);
  if (inactiveDays >= REVOKE_AFTER_DAYS) return { decision: "revoke", inactiveDays };
  const reminderCutoff = input.now.getTime() - REMINDER_COOLDOWN_DAYS * DAY_MS;
  if (
    inactiveDays >= REMINDER_AFTER_DAYS &&
    (!input.lastReminderAt || input.lastReminderAt.getTime() <= reminderCutoff)
  ) {
    return { decision: "remind", inactiveDays };
  }
  return { decision: "none", inactiveDays };
}

export async function runCreatorMonitoring(): Promise<{
  checked: number;
  reminded: number;
  revoked: number;
}> {
  const now = new Date();
  const creators = await db
    .select({
      applicationId: creatorBenefitsTable.applicationId,
      deviceId: creatorBenefitsTable.deviceId,
      benefitStatus: creatorBenefitsTable.status,
      offerStartedAt: creatorBenefitsTable.offerStartedAt,
      lastReminderAt: creatorBenefitsTable.lastReminderAt,
      reminderCount: creatorBenefitsTable.reminderCount,
      name: creatorApplicationsTable.name,
      email: creatorApplicationsTable.email,
      pushToken: pushTokensTable.token,
    })
    .from(creatorBenefitsTable)
    .innerJoin(
      creatorApplicationsTable,
      eq(creatorApplicationsTable.id, creatorBenefitsTable.applicationId),
    )
    .leftJoin(pushTokensTable, eq(pushTokensTable.deviceId, creatorBenefitsTable.deviceId))
    .where(
      and(
        eq(creatorApplicationsTable.status, "approved"),
        eq(creatorBenefitsTable.bindingVerified, true),
        inArray(creatorBenefitsTable.status, ["active", "cancel_pending", "grace"]),
      ),
    );

  if (creators.length === 0) return { checked: 0, reminded: 0, revoked: 0 };

  const activity = await db
    .select({
      deviceId: communityReportsTable.deviceId,
      lastReportAt: sql<Date | null>`max(${communityReportsTable.createdAt})`,
    })
    .from(communityReportsTable)
    .where(
      and(
        inArray(communityReportsTable.deviceId, creators.map((c) => c.deviceId)),
        eq(communityReportsTable.source, "manual"),
        eq(communityReportsTable.adminVerified, true),
      ),
    )
    .groupBy(communityReportsTable.deviceId);
  const lastReportByDevice = new Map(activity.map((row) => [row.deviceId, row.lastReportAt]));

  let reminded = 0;
  let revoked = 0;
  for (const creator of creators) {
    const anchor = selectActivityAnchor(
      creator.offerStartedAt,
      lastReportByDevice.get(creator.deviceId) ?? null,
    );
    if (!anchor) continue;
    const result = evaluateCreatorActivity({
      now,
      activityAnchor: anchor,
      lastReminderAt: creator.lastReminderAt,
    });

    if (result.decision === "revoke") {
      await db
        .update(creatorBenefitsTable)
        .set({
          status: "revoked",
          revokedAt: now,
          revocationReason: "inactivity_7_days",
          updatedAt: now,
        })
        .where(eq(creatorBenefitsTable.applicationId, creator.applicationId));
      revoked++;
      continue;
    }

    if (result.decision === "remind") {
      const [pushResult, emailSent] = await Promise.all([
        creator.pushToken
          ? sendPushNotifications([{
              to: creator.pushToken,
              title: "Your creator benefit needs activity",
              body: `No qualifying report for ${result.inactiveDays} days. Submit a genuine road report when it is safe.`,
              sound: "default",
              channelId: "msafiri_general",
              data: { type: "creator_activity_reminder" },
            }])
          : Promise.resolve({ ok: 0, failed: 0 }),
        sendCreatorActivityReminder({
          toEmail: creator.email,
          toName: creator.name,
          inactiveDays: result.inactiveDays,
        }),
      ]);
      await db
        .update(creatorBenefitsTable)
        .set({
          lastReminderAt: now,
          reminderCount: creator.reminderCount + 1,
          updatedAt: now,
        })
        .where(eq(creatorBenefitsTable.applicationId, creator.applicationId));
      logger.info(
        { applicationId: creator.applicationId, pushOk: pushResult.ok, emailSent },
        "Creator inactivity reminder processed",
      );
      reminded++;
    }
  }
  return { checked: creators.length, reminded, revoked };
}

export function startCreatorMonitoringJob(): NodeJS.Timeout {
  if (process.env.NODE_ENV !== "production") {
    logger.info("creatorMonitoring job: dev mode — disabled");
    return setInterval(() => {}, DAY_MS);
  }
  runCreatorMonitoring().catch((err) => logger.warn({ err }, "creatorMonitoring initial run failed"));
  return setInterval(() => {
    runCreatorMonitoring().catch((err) => logger.warn({ err }, "creatorMonitoring interval failed"));
  }, 6 * 60 * 60 * 1000);
}