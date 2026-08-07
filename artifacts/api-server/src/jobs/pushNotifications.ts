import { db, pushTokensTable, pushCampaignsTable, communityReportsTable, plannedTripsTable } from "@workspace/db";
import { and, eq, lte, gte, isNull, or, ne, isNotNull, inArray } from "drizzle-orm";
import { sendPushNotifications, flushBadTokensFromReceipts } from "../lib/expoPush.js";
import { logger } from "../lib/logger.js";

// ─── Rotating daily messages ─────────────────────────────────────────────────

const MORNING_MESSAGES = [
  { title: "🌅 Good morning, Msafiri!", body: "Check live road hazards before heading out. Stay one step ahead on Kenyan roads." },
  { title: "🚗 Morning road check!", body: "Traffic reports just updated. See what's ahead on your route today." },
  { title: "☀️ Start your day safely", body: "Speed cameras and roadblocks refreshed. Tap to see today's road conditions." },
  { title: "🛡️ Drive smart today", body: "New incidents reported overnight. Check conditions on your route before you go." },
  { title: "🌄 Ready to drive?", body: "Msafiri has live alerts for your area. Stay informed, stay safe." },
  { title: "🚦 Morning commute?", body: "See live hazards, speed cameras, and police checkpoints near you right now." },
  { title: "📍 Know before you go", body: "Potholes, road works, and accidents flagged near you. Open Msafiri now." },
];

// Weekend mornings skew toward errands/road-trip framing instead of "commute".
const MORNING_MESSAGES_WEEKEND = [
  { title: "🌤️ Weekend plans?", body: "Check live road conditions before you head out for the day." },
  { title: "🚙 Saturday road check", body: "Heading out today? See hazards, cameras, and checkpoints on your route first." },
  { title: "☕ Good morning!", body: "Whatever's on today's plan, check the roads first. Msafiri has the latest reports." },
  { title: "🧭 Weekend road trip?", body: "See live conditions before a longer drive. Stay safe out there." },
  { title: "🏡 Errands today?", body: "Quick check of live hazards near you before you get going." },
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

// Weekend evenings skew toward "heading out" rather than "rush hour home".
const EVENING_MESSAGES_WEEKEND = [
  { title: "🌇 Heading out tonight?", body: "Check live road conditions before your evening plans." },
  { title: "🎉 Evening plans?", body: "See hazards and checkpoints near you before you leave for the night." },
  { title: "🍽️ Dinner plans?", body: "Live traffic and hazard reports updated. Check your route before you go." },
  { title: "🌆 Weekend evening check", body: "Roads getting busy for the weekend rush. See what's ahead before you leave." },
];

// New midday slot — the third daily notification.
const MIDDAY_MESSAGES = [
  { title: "🕐 Midday road check", body: "Quick look before you're back on the road — see new hazards reported near you." },
  { title: "🍱 Lunch break?", body: "Check for fresh road works or accidents before you head back out." },
  { title: "📡 Midday update", body: "New reports have come in this morning. Tap to see what's changed on your route." },
  { title: "🚧 Afternoon ahead", body: "Road conditions can shift fast. Check live hazards before your next drive." },
];

const MIDDAY_MESSAGES_WEEKEND = [
  { title: "🛍️ Out and about?", body: "Check live hazards and speed cameras before your next stop today." },
  { title: "🚙 Midday check-in", body: "Roads busy today? See the latest reports before you continue your weekend plans." },
  { title: "☀️ Halfway through your day", body: "Quick check of live road conditions before you head to your next spot." },
];

// Friday & Saturday night — the two big Kenyan going-out nights. Focused on
// alcoblow checkpoints, hazards, and debris, which are far more common and
// harder to spot after dark.
const WEEKEND_NIGHT_MESSAGES = [
  { title: "🚨 Heading out tonight?", body: "Alcohol checkpoints, hazards, and debris are more common late at night. Check live alerts before you drive." },
  { title: "🍻 Driving after a night out?", body: "Police alcoblow checks are common tonight. See live checkpoint reports near you on Msafiri." },
  { title: "🌃 Late-night safety check", body: "Debris and unlit hazards are harder to spot at night. Check your route before you go." },
  { title: "🚔 Weekend night alert", body: "Checkpoints and hazards reported near you tonight. Stay safe — check Msafiri before hitting the road." },
  { title: "🛑 Before you drive tonight", body: "Live alcoblow and roadblock reports just updated. Know what's ahead before you leave." },
];

// ─── Weekly engagement nudge (active users only) ─────────────────────────────

const ENGAGEMENT_MESSAGES = [
  { title: "📍 Seen anything on the road?", body: "Report a hazard, camera, or pothole and help fellow drivers. Takes just 10 seconds!" },
  { title: "🤝 Be the city's eyes", body: "Every report you add keeps Kenyan roads safer. Share what you see today!" },
  { title: "🏆 Your reports matter", body: "Spot a pothole or roadblock? Add a quick report and earn community trust." },
  { title: "📡 Help drivers near you", body: "Drivers are relying on live reports right now. See something? Say something." },
];

// ─── Feature marketing catalog ────────────────────────────────────────────────
// 9 features × 4 inactivity tiers. Copy escalates from friendly reminder (T1)
// through bold/bragging (T2-T3) to full value-proposition pitch (T4).
// Per-device rotation is handled by pickFeatureForDevice() — different users
// see different features, and the same user sees a different one each tier.

interface FeatureMsg { title: string; body: string; }
interface FeatureDef { id: string; t1: FeatureMsg; t2: FeatureMsg; t3: FeatureMsg; t4: FeatureMsg; }

const FEATURE_CATALOG: FeatureDef[] = [
  {
    id: "dashcam",
    t1: {
      title: "📹 Your built-in dashcam is waiting",
      body: "Record your drive automatically — no extra device, no extra cost. Tap to activate in Msafiri.",
    },
    t2: {
      title: "📹 Dashcam apps charge Ksh 5,000+. Yours is free.",
      body: "Msafiri records your drive in the background. Evidence is everything in an accident. You're not using it.",
    },
    t3: {
      title: "📹 Without footage, it's your word against theirs",
      body: "Every unrecorded drive is a risk. Msafiri's dashcam is already on your phone — you just haven't turned it on.",
    },
    t4: {
      title: "📹 How do you prove what happened without footage?",
      body: "Thousands of Msafiri drivers record every trip. Insurance claims, police disputes, hit-and-runs — footage wins every time. Still not recording?",
    },
  },
  {
    id: "speed_cameras",
    t1: {
      title: "📸 Speed camera on your route?",
      body: "Msafiri gets real reports from real drivers. Know before you're caught — not after.",
    },
    t2: {
      title: "📸 Kenyan traffic fines go up every year",
      body: "Speed cameras, police traps, and checkpoints — all reported live. Other apps guess. Msafiri's community knows.",
    },
    t3: {
      title: "📸 Every Msafiri driver sees cameras you don't",
      body: "Real-time speed camera alerts from drivers on your exact road, right now. You're driving blind without us.",
    },
    t4: {
      title: "📸 You've paid fines that Msafiri could've prevented",
      body: "Speed cameras, alcoblow checkpoints, police traps — all reported by real drivers in real time. Still driving without us?",
    },
  },
  {
    id: "alcoblow",
    t1: {
      title: "🍺 Alcoblow checkpoint ahead?",
      body: "Msafiri drivers report checkpoints in real time. Know what's on your route before you encounter it.",
    },
    t2: {
      title: "🍺 Checkpoint reports near you — updated by the minute",
      body: "Community-reported alcoblow checkpoints, roadblocks, and police traps. Not on any other Kenyan app like this.",
    },
    t3: {
      title: "🍺 Every other Kenyan app is guessing",
      body: "Msafiri's alcoblow alerts come from actual drivers on your road. Live. Not yesterday's data. Not a guess.",
    },
    t4: {
      title: "🍺 You've been driving without a checkpoint warning system",
      body: "Police checkpoints, alcoblow traps, surprise roadblocks — Msafiri drivers see them first. Come back and drive with eyes open.",
    },
  },
  {
    id: "trip_sharing",
    t1: {
      title: "🛡️ Share your trip with someone you trust",
      body: "One tap lets family or friends follow your journey live — until you arrive safely.",
    },
    t2: {
      title: "🛡️ Someone worries every time you drive alone",
      body: "Msafiri trip sharing lets loved ones track your drive in real time. No other Kenyan driving app does this.",
    },
    t3: {
      title: "🛡️ Most accidents happen on familiar roads",
      body: "Send a live trip share before you drive. If something happens, someone will know exactly where you are.",
    },
    t4: {
      title: "🛡️ Nobody knew where you were on your last drive",
      body: "Msafiri trip sharing is the closest thing to a safety net on Kenyan roads. It takes 10 seconds. Still not using it?",
    },
  },
  {
    id: "crash_assistant",
    t1: {
      title: "🚨 Accident? Msafiri guides you step by step",
      body: "From photos to police reports — the Crash Assistant walks you through everything at the scene.",
    },
    t2: {
      title: "🚨 Most accident claims fail due to missing evidence",
      body: "Msafiri's Crash Assistant documents everything at the scene — photos, location, statements, insurance details. All in one app.",
    },
    t3: {
      title: "🚨 Other apps show you the map. We help you survive the aftermath.",
      body: "Crash Assistant, dashcam footage, and accident documentation — all in one Kenyan app. Nothing else comes close.",
    },
    t4: {
      title: "🚨 If you were in an accident today, would you know what to do?",
      body: "Step-by-step guidance, auto-documentation, dashcam clips, insurance submission — Msafiri has you covered end to end.",
    },
  },
  {
    id: "audio_course",
    t1: {
      title: "🎧 Kenyan roads have rules you might not know",
      body: "The Msafiri audio course covers what every driver on these roads should understand. Listen while you drive.",
    },
    t2: {
      title: "🎧 Most Kenyan drivers have never read the Highway Code",
      body: "We turned it into a 10-minute audio course you can finish on your commute. Already inside the app — free.",
    },
    t3: {
      title: "🎧 The safety course other driving apps don't have",
      body: "An audio course built specifically for Kenyan roads — speed zones, rules, hazards. Exclusive to Msafiri.",
    },
    t4: {
      title: "🎧 You drive every day. But do you know all the rules?",
      body: "The Msafiri audio course is already waiting for you. 10 minutes. Could save you a fine — or much worse.",
    },
  },
  {
    id: "car_service",
    t1: {
      title: "🔧 Need a mechanic or fuel station near you?",
      body: "Find trusted garages, fuel stations, and car wash spots near you — already inside Msafiri under 'Nearby'.",
    },
    t2: {
      title: "🔧 Still calling around for a mechanic?",
      body: "Msafiri shows trusted garages and service centres near your location. No other Kenyan driving app does this in one place.",
    },
    t3: {
      title: "🔧 5 apps for 5 needs. Or just Msafiri.",
      body: "Navigation, hazards, speed cameras, service centres, dashcam — one app. You already have it. Use it.",
    },
    t4: {
      title: "🔧 You've been managing too many apps for your car",
      body: "Msafiri handles everything — from live alerts on the road to finding a mechanic after. Come back and simplify.",
    },
  },
  {
    id: "community_hazards",
    t1: {
      title: "⚠️ New hazards reported near you",
      body: "Drivers near you are flagging fresh incidents right now. Live road intel from real people on your roads.",
    },
    t2: {
      title: "⚠️ Your community is reporting hazards you're missing",
      body: "Potholes, accidents, debris, road works — all live on Msafiri. No other app has this from actual Kenyan drivers.",
    },
    t3: {
      title: "⚠️ Kenyan roads change by the hour. So do our alerts.",
      body: "Real-time community hazard reports from drivers on your roads. Not from a government database updated monthly.",
    },
    t4: {
      title: "⚠️ You've been driving without live road intelligence",
      body: "Msafiri has the largest community of Kenyan drivers reporting live hazards. Every drive without it is a drive blind.",
    },
  },
  {
    id: "one_app",
    t1: {
      title: "📱 One app for everything on the road",
      body: "Hazards, speed cameras, trip sharing, dashcam, crash help — all in Msafiri. Already on your phone.",
    },
    t2: {
      title: "📱 You installed 4 apps for what Msafiri does alone",
      body: "Navigation + hazards + cameras + dashcam + crash assistant. One app. Free. Kenyan-built.",
    },
    t3: {
      title: "📱 No other Kenyan driving app comes close",
      body: "We're not being modest — Msafiri has features no competitor offers in a single app. Come see what you've been missing.",
    },
    t4: {
      title: "📱 You're still using 5 apps that Msafiri replaces for free",
      body: "Speed cameras, alcoblow, dashcam, crash assistant, trip sharing, audio course, nearby services — all in one. Still away?",
    },
  },
];

// Per-device feature rotation: hash deviceId + tier so different users see
// different features, and the same user sees a different feature as tiers escalate.
function pickFeatureForDevice(deviceId: string, tier: 1 | 2 | 3 | 4): FeatureDef {
  let hash = 5381;
  for (let i = 0; i < deviceId.length; i++) {
    hash = ((hash << 5) + hash + deviceId.charCodeAt(i)) >>> 0;
  }
  // Offset by tier×7 so tier escalation reliably shifts to a different feature.
  const idx = (hash + tier * 7) % FEATURE_CATALOG.length;
  return FEATURE_CATALOG[idx]!;
}

// Minimum gap between re-engagement pings per inactivity tier.
// Longer inactive → less frequent (we don't want to spam truly dormant users).
const TIER_COOLDOWN_DAYS: Record<1 | 2 | 3 | 4, number> = {
  1: 4,   // 3–6 days inactive: friendly check-in every 4 days
  2: 6,   // 7–13 days: bolder pitch every 6 days
  3: 8,   // 14–29 days: controversial nudge every 8 days
  4: 14,  // 30+ days: full value-prop every 2 weeks — don't overdo it
};

function getInactivityTier(inactiveDays: number): 1 | 2 | 3 | 4 {
  if (inactiveDays >= 30) return 4;
  if (inactiveDays >= 14) return 3;
  if (inactiveDays >= 7)  return 2;
  return 1;
}

// ─── Re-engagement job ────────────────────────────────────────────────────────

async function checkReengagement(): Promise<void> {
  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

  // Fetch all devices inactive for 3+ days — cooldown filtering is per-tier in JS.
  const inactive = await db
    .select()
    .from(pushTokensTable)
    .where(lte(pushTokensTable.lastSeenAt, threeDaysAgo));

  if (inactive.length === 0) return;

  // Apply per-device, per-tier cooldown and build send list.
  const picks: Array<{ row: typeof inactive[number]; msg: FeatureMsg }> = [];

  for (const row of inactive) {
    const inactiveDays = Math.floor((now.getTime() - row.lastSeenAt.getTime()) / 86400000);
    const tier = getInactivityTier(inactiveDays);
    const cooldownMs = TIER_COOLDOWN_DAYS[tier] * 24 * 60 * 60 * 1000;
    const cooldownCutoff = new Date(now.getTime() - cooldownMs);

    // Skip if already re-engaged recently enough for this tier's cooldown.
    if (row.lastReengagedAt && row.lastReengagedAt > cooldownCutoff) continue;

    const feature = pickFeatureForDevice(row.deviceId, tier);
    const msg = feature[`t${tier}` as "t1" | "t2" | "t3" | "t4"];
    picks.push({ row, msg });
  }

  if (picks.length === 0) return;

  const { ok, failed } = await sendPushNotifications(
    picks.map(({ row, msg }) => ({
      to: row.token,
      title: msg.title,
      body: msg.body,
      sound: "default" as const,
      channelId: "msafiri_alerts",   // use the high-importance channel
      data: { type: "re_engagement" },
    }))
  );

  // Reset the cooldown clock for every notified device.
  await db
    .update(pushTokensTable)
    .set({ lastReengagedAt: now })
    .where(inArray(pushTokensTable.deviceId, picks.map((p) => p.row.deviceId)));

  logger.info(
    { total: inactive.length, sent: picks.length, ok, failed },
    "Re-engagement feature-marketing notifications sent"
  );
}

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function alreadySentToday(type: string): Promise<boolean> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setUTCHours(23, 59, 59, 999);

  // Include "sending" so that a campaign already in-flight (inserted but not
  // yet marked "sent") blocks a concurrent job tick from firing a duplicate.
  // Without this, two ticks within the 5-minute daily window can both pass
  // the guard before either finishes writing status = "sent".
  const rows = await db
    .select({ id: pushCampaignsTable.id })
    .from(pushCampaignsTable)
    .where(
      and(
        eq(pushCampaignsTable.type, type),
        or(
          eq(pushCampaignsTable.status, "sent"),
          eq(pushCampaignsTable.status, "sending")
        ),
        gte(pushCampaignsTable.createdAt, todayStart),
        lte(pushCampaignsTable.createdAt, todayEnd)
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
    tokens.map((t) => ({ to: t.token, title, body, sound: "default" as const, channelId: "msafiri_general", data: { type } }))
  );

  await db
    .update(pushCampaignsTable)
    .set({ status: "sent", sentAt: new Date(), sentCount: ok, failedCount: failed })
    .where(eq(pushCampaignsTable.id, campaign.id));

  logger.info({ type, ok, failed }, "Auto push campaign sent");
}

// Active-only variant — only delivers to devices seen in the last 3 days.
// Used for daily operational notifications (morning/midday/evening/etc.) so
// inactive users don't receive road-condition alerts they can't act on; the
// re-engagement system handles them separately with feature-marketing copy.
const ACTIVE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

async function sendActiveCampaign(type: string, title: string, body: string): Promise<void> {
  if (await alreadySentToday(type)) return;

  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS);
  const tokens = await db
    .select({ token: pushTokensTable.token })
    .from(pushTokensTable)
    .where(gte(pushTokensTable.lastSeenAt, cutoff));

  if (tokens.length === 0) {
    logger.info({ type }, "No active push tokens — skipping daily campaign");
    return;
  }

  const [campaign] = await db
    .insert(pushCampaignsTable)
    .values({ title, body, type, status: "sending", createdBy: "system" })
    .returning();

  const { ok, failed } = await sendPushNotifications(
    tokens.map((t) => ({ to: t.token, title, body, sound: "default" as const, channelId: "msafiri_general", data: { type } }))
  );

  await db
    .update(pushCampaignsTable)
    .set({ status: "sent", sentAt: new Date(), sentCount: ok, failedCount: failed, targetCount: tokens.length })
    .where(eq(pushCampaignsTable.id, campaign.id));

  logger.info({ type, activeTokens: tokens.length, ok, failed }, "Active-only daily campaign sent");
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
        channelId: "msafiri_general",
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

// Shift `now` by the EAT offset so hour/day/minute reads are all in Kenya's
// local time, including correct day-of-week rollover near UTC midnight
// (a naive `now.getUTCDay()` reads the wrong day for ~3 hours a day).
function toEat(now: Date): Date {
  return new Date(now.getTime() + 3 * 60 * 60 * 1000);
}

// Saturday(6) & Sunday(0) get "weekend" content framing for the 3 daily sends.
function isWeekendDay(eatDay: number): boolean {
  return eatDay === 0 || eatDay === 6;
}

// Friday(5) & Saturday(6) nights are Kenya's two big going-out nights — the
// ones where alcoblow checkpoints, hazards, and debris are most relevant.
function isNightSafetyDay(eatDay: number): boolean {
  return eatDay === 5 || eatDay === 6;
}

async function checkDailyTriggers(): Promise<void> {
  const now = new Date();
  const eat = toEat(now);
  const eatDay = eat.getUTCDay();
  const eatHour = eat.getUTCHours();
  const min = eat.getUTCMinutes();
  const weekend = isWeekendDay(eatDay);

  // 6:00–6:05 AM EAT → morning reminder (active users only)
  if (eatHour === 6 && min < 5) {
    const msg = pickMessage(weekend ? MORNING_MESSAGES_WEEKEND : MORNING_MESSAGES);
    await sendActiveCampaign("daily_morning", msg.title, msg.body);
  }

  // 1:00–1:05 PM EAT → midday reminder (active users only)
  if (eatHour === 13 && min < 5) {
    const msg = pickMessage(weekend ? MIDDAY_MESSAGES_WEEKEND : MIDDAY_MESSAGES);
    await sendActiveCampaign("daily_midday", msg.title, msg.body);
  }

  // 4:30–4:35 PM EAT → evening reminder (active users only)
  if (eatHour === 16 && min >= 30 && min < 35) {
    const msg = pickMessage(weekend ? EVENING_MESSAGES_WEEKEND : EVENING_MESSAGES);
    await sendActiveCampaign("daily_evening", msg.title, msg.body);
  }

  // 9:00–9:05 PM EAT, Friday & Saturday only → weekend night safety (active users only)
  if (isNightSafetyDay(eatDay) && eatHour === 21 && min < 5) {
    const msg = pickMessage(WEEKEND_NIGHT_MESSAGES);
    await sendActiveCampaign("weekend_night_safety", msg.title, msg.body);
  }

  // Wednesday 12:00–12:05 PM EAT → weekly engagement nudge (active users only)
  if (eatDay === 3 && eatHour === 12 && min < 5) {
    const msg = pickMessage(ENGAGEMENT_MESSAGES);
    await sendActiveCampaign("engagement", msg.title, msg.body);
  }

  // 10:00–10:05 AM EAT daily → re-engagement for devices inactive 3+ days
  // (per-device cooldown inside checkReengagement means this is safe to run
  // every day — devices that were just re-engaged won't be hit again for 4 days)
  if (eatHour === 10 && min < 5) {
    await checkReengagement();
  }
}

// ─── Startup catch-up ─────────────────────────────────────────────────────────
// If the server was down during a scheduled window, the normal 5-minute guard
// never fires and that notification is permanently skipped. On startup we check
// every window that has already passed today and immediately send any that were
// missed. alreadySentToday() still guards against duplicates, so this is safe
// even if the server restarts multiple times in a day.
//
// Staleness gate: only catch up if the window closed ≤ 90 minutes ago.
// A "Good morning!" notification at 2 PM after a long outage is confusing and
// annoying — if the server was down for more than 90 minutes it's better to
// simply skip that window and let the next scheduled one fire normally.
const MAX_CATCHUP_LAG_MIN = 90;

async function catchUpMissedTriggers(): Promise<void> {
  const now = new Date();
  const eat = toEat(now);
  const eatDay = eat.getUTCDay();
  const eatHour = eat.getUTCHours();
  const eatMin = eat.getUTCMinutes();
  // Total EAT minutes since midnight — used to compare against window start times.
  const eatTotalMin = eatHour * 60 + eatMin;
  const weekend = isWeekendDay(eatDay);

  // Helper: true if window closed recently enough to be worth catching up.
  const freshEnough = (windowCloseMin: number) =>
    eatTotalMin > windowCloseMin &&
    eatTotalMin - windowCloseMin <= MAX_CATCHUP_LAG_MIN;

  // Morning window closed at 06:05 EAT
  if (freshEnough(6 * 60 + 5)) {
    const msg = pickMessage(weekend ? MORNING_MESSAGES_WEEKEND : MORNING_MESSAGES);
    await sendActiveCampaign("daily_morning", msg.title, msg.body);
  }

  // Midday window closed at 13:05 EAT
  if (freshEnough(13 * 60 + 5)) {
    const msg = pickMessage(weekend ? MIDDAY_MESSAGES_WEEKEND : MIDDAY_MESSAGES);
    await sendActiveCampaign("daily_midday", msg.title, msg.body);
  }

  // Evening window closed at 16:35 EAT
  if (freshEnough(16 * 60 + 35)) {
    const msg = pickMessage(weekend ? EVENING_MESSAGES_WEEKEND : EVENING_MESSAGES);
    await sendActiveCampaign("daily_evening", msg.title, msg.body);
  }

  // Weekend night safety window closed at 21:05 EAT (Fri & Sat only)
  if (isNightSafetyDay(eatDay) && freshEnough(21 * 60 + 5)) {
    const msg = pickMessage(WEEKEND_NIGHT_MESSAGES);
    await sendActiveCampaign("weekend_night_safety", msg.title, msg.body);
  }

  // Wednesday engagement window closed at 12:05 EAT
  if (eatDay === 3 && freshEnough(12 * 60 + 5)) {
    const msg = pickMessage(ENGAGEMENT_MESSAGES);
    await sendActiveCampaign("engagement", msg.title, msg.body);
  }

  // Re-engagement window closed at 10:05 EAT
  if (freshEnough(10 * 60 + 5)) {
    await checkReengagement();
  }
}

// ─── Planned-trip departure advice ───────────────────────────────────────────

// Types that meaningfully affect a drive — these are what we warn about ahead
// of a planned departure. "camera" is excluded (not disruptive to a route).
const DISRUPTIVE_TYPES = new Set([
  "accident", "traffic", "roadblock", "hazard", "pothole",
  "debris", "breakdown", "weather", "closure",
]);

const ROUTE_CORRIDOR_M = 300; // how close a report must be to the route line to count as "on route"
const ADVICE_WINDOW_MIN_MS = 20 * 60 * 1000; // start of the notify window before plannedAt
const ADVICE_WINDOW_MAX_MS = 35 * 60 * 1000; // end of the notify window before plannedAt

interface GoogleRoute {
  distanceM: number;
  durationS: number;
  coords: { lat: number; lng: number }[];
}

// Decode Google's standard encoded-polyline format
function decodePolyline(encoded: string): { lat: number; lng: number }[] {
  const coords: { lat: number; lng: number }[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b: number, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    coords.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return coords;
}

async function fetchGoogleRoute(fromLat: number, fromLng: number, toLat: number, toLng: number): Promise<GoogleRoute | null> {
  const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (!apiKey) {
    logger.warn("Planned trip advice: GOOGLE_ROUTES_API_KEY not set, skipping route fetch");
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type":     "application/json",
        "X-Goog-Api-Key":   apiKey,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin:      { location: { latLng: { latitude: fromLat, longitude: fromLng } } },
        destination: { location: { latLng: { latitude: toLat,   longitude: toLng   } } },
        travelMode:        "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        polylineEncoding:  "ENCODED_POLYLINE",
      }),
      signal: controller.signal,
    });
    const data = (await res.json()) as any;
    if (!data.routes?.length) return null;
    const r = data.routes[0];
    return {
      distanceM: r.distanceMeters ?? 0,
      durationS: parseInt((r.duration ?? "0s").replace("s", ""), 10),
      coords:    decodePolyline(r.polyline?.encodedPolyline ?? ""),
    };
  } catch (err) {
    logger.warn({ err }, "Planned trip advice: Google Routes fetch failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Returns true if any point of the route polyline is within `maxM` of (lat, lng). */
function isNearRoute(route: GoogleRoute, lat: number, lng: number, maxM: number): boolean {
  return route.coords.some((c) => haversineKm(c.lat, c.lng, lat, lng) * 1000 <= maxM);
}

function formatEatTime(d: Date): string {
  return d.toLocaleTimeString("en-KE", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Nairobi" });
}

async function sendTripAdvice(deviceId: string, token: string, tripId: string, label: string, plannedAt: Date, route: GoogleRoute | null): Promise<void> {
  let title: string;
  let body: string;

  if (!route) {
    title = `🗺️ Trip to ${label} coming up`;
    body = `You planned to leave around ${formatEatTime(plannedAt)}. Open Msafiri to check live road conditions before you go.`;
  } else {
    const reports = await db
      .select()
      .from(communityReportsTable)
      .where(and(ne(communityReportsTable.status, "expired"), ne(communityReportsTable.status, "denied")));

    const onRoute = reports.filter(
      (r) => DISRUPTIVE_TYPES.has(r.type) && isNearRoute(route, r.lat, r.lng, ROUTE_CORRIDOR_M)
    );

    if (onRoute.length === 0) {
      title = `✅ Good time to leave for ${label}`;
      body = `The road ahead looks clear. Your planned ${formatEatTime(plannedAt)} departure looks like a good time to go.`;
    } else {
      const worst = onRoute[0];
      const typeLabel = worst.type.charAt(0).toUpperCase() + worst.type.slice(1);
      title = `⚠️ Heads up before you leave for ${label}`;
      body = onRoute.length === 1
        ? `${typeLabel} reported on your route to ${label}. Consider leaving a little earlier or checking for an alternative route.`
        : `${onRoute.length} incidents (including ${typeLabel.toLowerCase()}) reported on your route to ${label}. Consider leaving earlier or an alternative route.`;
    }
  }

  const data = { type: "trip_advice", tripId, lat: route?.coords[0]?.lat, lng: route?.coords[0]?.lng };

  const { ok, failed } = await sendPushNotifications([
    { to: token, title, body, sound: "default", channelId: "msafiri_general", data },
  ]);

  await db
    .update(plannedTripsTable)
    .set({ status: "notified", notifiedAt: new Date() })
    .where(eq(plannedTripsTable.id, tripId));

  logger.info({ deviceId, tripId, ok, failed }, "Planned trip departure advice sent");
}

async function checkPlannedTrips(): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() + ADVICE_WINDOW_MIN_MS);
  const windowEnd = new Date(now.getTime() + ADVICE_WINDOW_MAX_MS);

  const due = await db
    .select()
    .from(plannedTripsTable)
    .where(
      and(
        eq(plannedTripsTable.status, "upcoming"),
        gte(plannedTripsTable.plannedAt, windowStart),
        lte(plannedTripsTable.plannedAt, windowEnd)
      )
    );

  if (due.length === 0) return;

  for (const trip of due) {
    try {
      const [tokenRow] = await db
        .select()
        .from(pushTokensTable)
        .where(eq(pushTokensTable.deviceId, trip.deviceId));

      if (!tokenRow) {
        // No registered push token for this device — nothing we can send.
        await db.update(plannedTripsTable).set({ status: "notified", notifiedAt: now }).where(eq(plannedTripsTable.id, trip.id));
        continue;
      }

      const route = tokenRow.lastLat != null && tokenRow.lastLng != null
        ? await fetchGoogleRoute(tokenRow.lastLat, tokenRow.lastLng, trip.destLat, trip.destLng)
        : null;

      await sendTripAdvice(trip.deviceId, tokenRow.token, trip.id, trip.label, trip.plannedAt, route);
    } catch (err) {
      logger.error({ err, tripId: trip.id }, "Failed to process planned trip advice");
    }
  }
}

// ─── Job entry point ──────────────────────────────────────────────────────────

async function runJob(): Promise<void> {
  await processScheduledCampaigns();
  await checkDailyTriggers();
  await checkPlannedTrips();
}

// ── Receipt-based bad token purge ─────────────────────────────────────────────
// Runs every 30 minutes (receipts are available ~15–30 min after send).
// Deletes any push_tokens that APNs/FCM confirmed as permanently invalid.
async function purgeDeadTokens(): Promise<void> {
  try {
    const badTokens = await flushBadTokensFromReceipts();
    if (badTokens.length === 0) return;
    for (const token of badTokens) {
      await db.delete(pushTokensTable).where(eq(pushTokensTable.token, token));
    }
    logger.info({ count: badTokens.length }, "Purged dead push tokens via receipt check");
  } catch (err) {
    logger.warn({ err }, "purgeDeadTokens failed");
  }
}

export function startPushNotificationsJob(): NodeJS.Timeout {
  logger.info("pushNotifications job started");

  // Fire catch-up first (sends any windows already passed today that were missed
  // because the server was down), then immediately run the normal job tick.
  catchUpMissedTriggers()
    .catch((err) => logger.warn({ err }, "pushNotifications: catch-up failed"))
    .finally(() => {
      runJob().catch((err) =>
        logger.warn({ err }, "pushNotifications: initial run failed")
      );
    });

  // Receipt purge — wait 30 min after startup for the first check, then every 30 min
  setTimeout(() => {
    purgeDeadTokens();
    setInterval(purgeDeadTokens, 30 * 60 * 1000);
  }, 30 * 60 * 1000);

  return setInterval(() => {
    runJob().catch((err) =>
      logger.warn({ err }, "pushNotifications: interval run failed")
    );
  }, 60 * 1000);
}
