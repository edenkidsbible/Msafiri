import { db, pushTokensTable, pushCampaignsTable, communityReportsTable } from "@workspace/db";
import { and, eq, lte, gte, isNull, or, ne, isNotNull } from "drizzle-orm";
import { sendPushNotifications } from "../lib/expoPush.js";
import { logger } from "../lib/logger.js";

// ─── Rotating daily messages ─────────────────────────────────────────────────

const MORNING_MESSAGES = [
  { title: "🌅 Good morning, safe driver!", body: "Check live road hazards before heading out. Stay one step ahead on Kenyan roads." },
  { title: "🚗 Morning road check!", body: "Traffic reports just updated. See what's ahead on your route today." },
  { title: "☀️ Start your day safely", body: "Speed cameras and roadblocks refreshed. Tap to see today's road conditions." },
  { title: "🛡️ Drive smart today", body: "New incidents reported overnight. Check conditions on your route before you go." },
  { title: "🌄 Ready to drive?", body: "Msafiri has live alerts for your area. Stay informed, stay safe." },
  { title: "🚦 Morning commute?", body: "See live hazards, speed cameras, and police checkpoints near you right now." },
  { title: "📍 Know before you go", body: "Potholes, road works, and accidents flagged near you. Open Msafiri now." },
];

const EVENING_MESSAGES = [
  { title: "🌆 Evening rush!", body: "Traffic building up? Check live hazards and cameras near you before heading home." },
  { title: "🚦 Rush hour alert", body: "Accidents and congestion reported. Plan your route home with live Msafiri data." },
  { title: "🌙 Heading home?", body: "Check the latest road conditions and beat the evening traffic." },
  { title: "⚠️ Evening road updates", body: "New reports near you. Tap to see what's happening on the roads right now." },
  { title: "🛣️ Know your route home", body: "Live speed zones and hazards updated for your evening drive." },
  { title: "🏘️ Almost home!", body: "See police checkpoints and roadblocks near you before the last stretch home." },
  { title: "🌛 Evening safety check", body: "Visibility dropping. Check for unlit hazards and road works near you." },
];

const ENGAGEMENT_MESSAGES = [
  { title: "📍 Seen anything on the road?", body: "Report a hazard, camera, or pothole and help fellow drivers. Takes just 10 seconds!" },
  { title: "🤝 Be the city's eyes", body: "Every report you add keeps Kenyan roads safer. Share what you see today!" },
  { title: "🏆 Your reports matter", body: "Spot a pothole or roadblock? Add a quick report and earn community trust." },
  { title: "📡 Help drivers near you", body: "Drivers are relying on live reports right now. See something? Say something." },
];

function getDayOfYear(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function pickMessage<T extends { title: string; body: string }>(arr: T[]): T {
  return arr[getDayOfYear() % arr.length]!;
}

// ─── Geo helpers ──────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;

/** Returns the great-circle distance in kilometres between two lat/lng points. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const INCIDENT_NOTIFY_RADIUS_KM = 5;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function alreadySentToday(type: string): Promise<boolean> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setUTCHours(23, 59, 59, 999);

  const rows = await db
    .select({ id: pushCampaignsTable.id })
    .from(pushCampaignsTable)
    .where(
      and(
        eq(pushCampaignsTable.type, type),
        eq(pushCampaignsTable.status, "sent"),
        gte(pushCampaignsTable.sentAt, todayStart),
        lte(pushCampaignsTable.sentAt, todayEnd)
      )
    )
    .limit(1);

  return rows.length > 0;
}

async function sendAutoCampaign(type: string, title: string, body: string): Promise<void> {
  if (await alreadySentToday(type)) return;

  const tokens = await db
    .select({ token: pushTokensTable.token })
    .from(pushTokensTable);

  if (tokens.length === 0) {
    logger.info({ type }, "No push tokens registered yet — skipping auto campaign");
    return;
  }

  const [campaign] = await db
    .insert(pushCampaignsTable)
    .values({ title, body, type, status: "sending", createdBy: "system" })
    .returning();

  const { ok, failed } = await sendPushNotifications(
    tokens.map((t) => ({ to: t.token, title, body, sound: "default" as const, data: { type } }))
  );

  await db
    .update(pushCampaignsTable)
    .set({ status: "sent", sentAt: new Date(), sentCount: ok, failedCount: failed })
    .where(eq(pushCampaignsTable.id, campaign.id));

  logger.info({ type, ok, failed }, "Auto push campaign sent");
}

// ─── Scheduled campaign processor ────────────────────────────────────────────

async function processScheduledCampaigns(): Promise<void> {
  const now = new Date();

  const due = await db
    .select()
    .from(pushCampaignsTable)
    .where(
      and(
        eq(pushCampaignsTable.status, "scheduled"),
        lte(pushCampaignsTable.scheduledAt, now)
      )
    );

  for (const campaign of due) {
    try {
      await db
        .update(pushCampaignsTable)
        .set({ status: "sending" })
        .where(eq(pushCampaignsTable.id, campaign.id));

      const tokens = await db
        .select({ token: pushTokensTable.token })
        .from(pushTokensTable);

      const messages = tokens.map((t) => ({
        to: t.token,
        title: campaign.title,
        body: campaign.body,
        sound: "default" as const,
        data: campaign.dataJson ? (JSON.parse(campaign.dataJson) as Record<string, unknown>) : {},
      }));

      const { ok, failed } = await sendPushNotifications(messages);

      await db
        .update(pushCampaignsTable)
        .set({ status: "sent", sentAt: new Date(), sentCount: ok, failedCount: failed })
        .where(eq(pushCampaignsTable.id, campaign.id));

      logger.info({ id: campaign.id, ok, failed }, "Scheduled push campaign sent");
    } catch (err) {
      await db
        .update(pushCampaignsTable)
        .set({ status: "failed" })
        .where(eq(pushCampaignsTable.id, campaign.id));
      logger.error({ err, id: campaign.id }, "Failed to send scheduled push campaign");
    }
  }
}

// ─── Daily time-based triggers (Kenya = UTC+3) ────────────────────────────────

async function checkDailyTriggers(): Promise<void> {
  const now = new Date();
  const eatHour = (now.getUTCHours() + 3) % 24;
  const min = now.getUTCMinutes();

  // 7:00–7:05 AM EAT → morning reminder
  if (eatHour === 7 && min < 5) {
    const msg = pickMessage(MORNING_MESSAGES);
    await sendAutoCampaign("daily_morning", msg.title, msg.body);
  }

  // 5:30–5:35 PM EAT → evening reminder
  if (eatHour === 17 && min >= 30 && min < 35) {
    const msg = pickMessage(EVENING_MESSAGES);
    await sendAutoCampaign("daily_evening", msg.title, msg.body);
  }

  // Wednesday 12:00–12:05 PM EAT → weekly engagement nudge
  if (now.getUTCDay() === 3 && eatHour === 12 && min < 5) {
    const msg = pickMessage(ENGAGEMENT_MESSAGES);
    await sendAutoCampaign("engagement", msg.title, msg.body);
  }
}

// ─── Incident confirmation notifications ─────────────────────────────────────

async function checkIncidentConfirmations(): Promise<void> {
  const now = new Date();
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  const qualifying = await db
    .select()
    .from(communityReportsTable)
    .where(
      and(
        or(
          eq(communityReportsTable.status, "active"),
          eq(communityReportsTable.status, "confirmed")
        ),
        ne(communityReportsTable.type, "camera"),
        // Report must be at least 30 minutes old
        lte(communityReportsTable.createdAt, thirtyMinAgo),
        // Must not have had a notification in the last 2 hours
        or(
          isNull(communityReportsTable.lastNotifiedAt),
          lte(communityReportsTable.lastNotifiedAt, twoHoursAgo)
        ),
        // Must not have received a vote in the last 30 minutes
        or(
          isNull(communityReportsTable.lastVotedAt),
          lte(communityReportsTable.lastVotedAt, thirtyMinAgo)
        )
      )
    );

  if (qualifying.length === 0) return;

  // Fetch all tokens that have a known location (needed for proximity filtering).
  // Also fetch tokens without a location so we can count the total pool.
  const allTokens = await db
    .select({
      token: pushTokensTable.token,
      lastLat: pushTokensTable.lastLat,
      lastLng: pushTokensTable.lastLng,
    })
    .from(pushTokensTable);

  if (allTokens.length === 0) return;

  for (const report of qualifying) {
    const typeLabel = report.type.charAt(0).toUpperCase() + report.type.slice(1);
    const road = report.roadName ? ` on ${report.roadName}` : "";
    const title = `Is ${typeLabel} still there?`;
    const body = `Is ${typeLabel}${road} still active? Help other drivers — tap to confirm.`;
    const data = { type: "incident_check", reportId: report.id, lat: report.lat, lng: report.lng };

    // Filter to only devices that are within 5 km of the incident.
    // Devices with no recorded location are excluded — they will be reached
    // by the proximity-triggered in-app prompt instead.
    const nearbyTokens = allTokens.filter((t) => {
      if (t.lastLat == null || t.lastLng == null) return false;
      return haversineKm(t.lastLat, t.lastLng, report.lat, report.lng) <= INCIDENT_NOTIFY_RADIUS_KM;
    });

    const totalDevices = allTokens.length;
    const targetDevices = nearbyTokens.length;

    logger.info(
      { reportId: report.id, totalDevices, targetDevices },
      "Incident confirmation: filtering push tokens by proximity"
    );

    if (nearbyTokens.length === 0) {
      // No nearby devices with a known location — record a skipped campaign
      // so the admin log shows the attempt.
      await db
        .insert(pushCampaignsTable)
        .values({
          title,
          body,
          type: "incident_check",
          status: "sent",
          sentAt: now,
          sentCount: 0,
          failedCount: 0,
          targetCount: 0,
          createdBy: "system",
          dataJson: JSON.stringify(data),
        });

      await db
        .update(communityReportsTable)
        .set({ lastNotifiedAt: now })
        .where(eq(communityReportsTable.id, report.id));

      logger.info({ reportId: report.id }, "Incident confirmation: no nearby devices, skipped send");
      continue;
    }

    const [campaign] = await db
      .insert(pushCampaignsTable)
      .values({
        title,
        body,
        type: "incident_check",
        status: "sending",
        createdBy: "system",
        dataJson: JSON.stringify(data),
        targetCount: targetDevices,
      })
      .returning();

    const { ok, failed } = await sendPushNotifications(
      nearbyTokens.map((t) => ({
        to: t.token,
        title,
        body,
        sound: "alert_tone.mp3",
        channelId: "incident-alerts",
        data,
      }))
    );

    await db
      .update(pushCampaignsTable)
      .set({ status: "sent", sentAt: now, sentCount: ok, failedCount: failed, targetCount: targetDevices })
      .where(eq(pushCampaignsTable.id, campaign.id));

    await db
      .update(communityReportsTable)
      .set({ lastNotifiedAt: now })
      .where(eq(communityReportsTable.id, report.id));

    logger.info(
      { reportId: report.id, ok, failed, targetDevices, totalDevices },
      "Incident confirmation push sent to nearby drivers"
    );
  }
}

// ─── Job entry point ──────────────────────────────────────────────────────────

// Run incident checks every 15 minutes independently of the 1-minute main loop
let lastIncidentCheckAt = 0;
const INCIDENT_CHECK_INTERVAL_MS = 15 * 60 * 1000;

async function runJob(): Promise<void> {
  await processScheduledCampaigns();
  await checkDailyTriggers();

  const now = Date.now();
  if (now - lastIncidentCheckAt >= INCIDENT_CHECK_INTERVAL_MS) {
    lastIncidentCheckAt = now;
    await checkIncidentConfirmations();
  }
}

export function startPushNotificationsJob(): NodeJS.Timeout {
  logger.info("pushNotifications job started");

  runJob().catch((err) =>
    logger.warn({ err }, "pushNotifications: initial run failed")
  );

  return setInterval(() => {
    runJob().catch((err) =>
      logger.warn({ err }, "pushNotifications: interval run failed")
    );
  }, 60 * 1000);
}
