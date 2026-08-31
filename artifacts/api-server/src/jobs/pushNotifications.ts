import { db, pushTokensTable, pushCampaignsTable, communityReportsTable, plannedTripsTable, deviceBackupsTable, deviceTrialSessionsTable } from "@workspace/db";
import { and, eq, lte, gte, isNull, or, ne, isNotNull, inArray, notInArray, sql } from "drizzle-orm";
import { sendPushNotifications, flushBadTokensFromReceipts, drainForeignExperienceTokens } from "../lib/expoPush.js";
import { logger } from "../lib/logger.js";

// ─── Daily feature-education rotation ────────────────────────────────────────
// Three daily notification slots (morning / midday / evening) each show a
// different app feature so users discover capabilities they may not know exist.
// Features rotate by day-of-year + slot offset, so on any given day all three
// slots highlight different features. The 9-feature × 3-slot cycle means every
// feature surfaces in every slot once every 9 days, then repeats.
//
// Slot offsets:
//   morning  → 0   (feature[dayOfYear % 9])
//   midday   → 3   (feature[(dayOfYear+3) % 9])
//   evening  → 6   (feature[(dayOfYear+6) % 9])
//
// Friday & Saturday night (9 PM) uses only the three safety-critical features
// because that audience is about to drive after a night out.

function pickDailyFeatureMsg(slotOffset: number): { title: string; body: string } {
  const idx = (getDayOfYear() + slotOffset) % FEATURE_CATALOG.length;
  return FEATURE_CATALOG[idx]!.t1;
}

// Only dashcam, trip sharing, and crash assistant are promoted at 9 PM on
// Fri/Sat — they're the features most relevant to late-night driving safety.
const NIGHT_SAFETY_FEATURE_IDS = ["dashcam", "trip_sharing", "crash_assistant"] as const;
function pickNightSafetyFeatureMsg(): { title: string; body: string } {
  const idx = getDayOfYear() % NIGHT_SAFETY_FEATURE_IDS.length;
  const featureId = NIGHT_SAFETY_FEATURE_IDS[idx]!;
  return FEATURE_CATALOG.find((f) => f.id === featureId)!.t1;
}

// ─── Weekly engagement nudge (active users only) ─────────────────────────────

const ENGAGEMENT_MESSAGES = [
  { title: "👀 Thousands rely on reports like yours", body: "Spot a camera, pothole, or checkpoint? Report it in 10 seconds and keep the community sharp." },
  { title: "📍 You know what's on these roads", body: "Add a report and give drivers behind you an edge. Takes less time than a traffic light." },
  { title: "🚨 The map is only as good as we report", body: "Fresh eyes on the road right now. See something? Say something — your report could save someone's fine or their life." },
  { title: "🏆 Other drivers need your reports", body: "Pothole? Checkpoint? Camera? Report it. Your community is counting on people like you." },
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
      title: "📹 Other dashcam apps cost Ksh 5,000+",
      body: "Msafiri records your drive in the background. Evidence is everything in an accident. You're not using it.",
    },
    t3: {
      title: "📹 No footage = your word against theirs",
      body: "Every unrecorded drive is a risk. Msafiri's dashcam is already on your phone — you just haven't turned it on.",
    },
    t4: {
      title: "📹 How do you prove what happened?",
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
      title: "📸 Msafiri could've prevented those fines",
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
      title: "🍺 Checkpoint reports near you, live",
      body: "Community-reported alcoblow checkpoints, roadblocks, and police traps. Not on any other Kenyan app like this.",
    },
    t3: {
      title: "🍺 Every other Kenyan app is guessing",
      body: "Msafiri's alcoblow alerts come from actual drivers on your road. Live. Not yesterday's data. Not a guess.",
    },
    t4: {
      title: "🍺 No checkpoint warning system yet?",
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
      title: "🛡️ Nobody tracked your last drive",
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
      title: "🚨 Most claims fail — missing evidence",
      body: "Msafiri's Crash Assistant documents everything at the scene — photos, location, statements, insurance details. All in one app.",
    },
    t3: {
      title: "🚨 We help you survive the aftermath",
      body: "Crash Assistant, dashcam footage, and accident documentation — all in one Kenyan app. Nothing else comes close.",
    },
    t4: {
      title: "🚨 Would you know what to do after a crash?",
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
      title: "🎧 Most drivers skip the Highway Code",
      body: "We turned it into a 10-minute audio course you can finish on your commute. Already inside the app — free.",
    },
    t3: {
      title: "🎧 The course no other driving app has",
      body: "An audio course built specifically for Kenyan roads — speed zones, rules, hazards. Exclusive to Msafiri.",
    },
    t4: {
      title: "🎧 You drive daily. Know all the rules?",
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
      title: "🔧 Too many apps for one car",
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
      title: "⚠️ Hazards near you — reported live",
      body: "Potholes, accidents, debris, road works — all live on Msafiri. No other app has this from actual Kenyan drivers.",
    },
    t3: {
      title: "⚠️ Roads change hourly. So do our alerts.",
      body: "Real-time community hazard reports from drivers on your roads. Not from a government database updated monthly.",
    },
    t4: {
      title: "⚠️ You're driving without live road intel",
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
      title: "📱 4 apps replaced by Msafiri alone",
      body: "Navigation + hazards + cameras + dashcam + crash assistant. One app. Free. Kenyan-built.",
    },
    t3: {
      title: "📱 No other Kenyan driving app comes close",
      body: "We're not being modest — Msafiri has features no competitor offers in a single app. Come see what you've been missing.",
    },
    t4: {
      title: "📱 Still using 5 apps Msafiri replaces?",
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

  // DISTINCT ON device_id — same dedup rationale as sendActiveCampaign.
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (device_id) token
    FROM   push_tokens
    ORDER  BY device_id, last_seen_at DESC
  `);
  const tokens = rows.rows as { token: string }[];

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
// Used for daily feature-education notifications so inactive users don't
// receive app-feature promotions while they're away; the re-engagement system
// handles them separately with escalating feature-marketing copy.
//
// Send-time dedup: DISTINCT ON (device_id) ORDER BY last_seen_at DESC ensures
// at most one token per logical device even when a reinstall has left behind a
// stale row with a different device_id (the common iOS "two notifications for
// the same iPhone" cause between reinstall and the 30-min receipt purge).
const ACTIVE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

async function sendActiveCampaign(type: string, title: string, body: string): Promise<void> {
  if (await alreadySentToday(type)) return;

  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS);

  // DISTINCT ON device_id: if the same physical device has two rows (e.g.
  // post-reinstall stale row + new row), only the most-recently-seen token is
  // sent, preventing duplicate delivery to the same handset.
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (device_id) token
    FROM   push_tokens
    WHERE  last_seen_at >= ${cutoff}
    ORDER  BY device_id, last_seen_at DESC
  `);
  const tokens = rows.rows as { token: string }[];

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

// ─── Recovery phone nudge ─────────────────────────────────────────────────────
// Sent once per week (Monday 9 AM EAT) to devices that have a push token but
// have not yet linked a recovery phone number. The campaign type key includes
// the week number so alreadySentToday won't block it the following Monday.

const RECOVERY_PHONE_NUDGE_MESSAGES = [
  {
    title: "🔐 Your Msafiri data has no recovery phone",
    body: "If you change devices you'll lose all your vehicles and settings. Add a recovery phone — it takes 30 seconds.",
  },
  {
    title: "📱 One step protects everything in Msafiri",
    body: "Add a recovery phone number so you can restore your account on any new device. Tap to set it up now.",
  },
  {
    title: "⚠️ Lose your phone = lose your data?",
    body: "Link a recovery phone in Msafiri and you'll always be able to get your vehicles and settings back.",
  },
];

// ─── Post-trial nudge sequence ────────────────────────────────────────────────
// After a device's free trial expires, send up to 3 re-engagement pushes:
//   Stage 0 → 1 : ~30–120 min after expiry  ("Your free drives are complete")
//   Stage 1 → 2 : ~20–30 hours after expiry ("Driving today?")
//   Stage 2 → 3 : ~2–5 days after expiry    ("Your Msafiri offer is still waiting")
// Runs on every 30-min tick; nudge_stage gates against double-sending.

const TRIAL_NUDGE_STAGES: Record<number, { minS: number; maxS: number; title: string; body: string }> = {
  0: {
    minS:  30 * 60, maxS: 120 * 60,
    title: "Your free drives are complete 🎉",
    body:  "Keep Msafiri with you on every journey. Unlock your first month at our introductory price.",
  },
  1: {
    minS: 20 * 3600, maxS: 30 * 3600,
    title: "Driving today?",
    body:  "Your 3 free Msafiri drives are complete. Subscribe to keep speed-camera alerts, Dashcam and road intelligence active.",
  },
  2: {
    minS: 2 * 86400, maxS: 5 * 86400,
    title: "Your Msafiri offer is still waiting",
    body:  "Get your first month at the introductory price and keep every drive protected.",
  },
};

async function sendTrialExpiredNudges(): Promise<void> {
  const rows = await db.execute(sql`
    SELECT dts.id,
           dts.device_id,
           dts.nudge_stage,
           EXTRACT(EPOCH FROM (NOW() - dts.trial_expired_at))::int AS expired_seconds
      FROM device_trial_sessions dts
     WHERE dts.trial_expired_at IS NOT NULL
       AND dts.nudge_stage < 3
       AND dts.device_id IS NOT NULL
  `);

  const records = rows.rows as {
    id: string; device_id: string; nudge_stage: number; expired_seconds: number;
  }[];

  for (const rec of records) {
    const stage = TRIAL_NUDGE_STAGES[rec.nudge_stage];
    if (!stage) continue;
    if (rec.expired_seconds < stage.minS || rec.expired_seconds > stage.maxS) continue;

    // Look up the push token for this device
    const tokenRows = await db.execute(sql`
      SELECT token FROM push_tokens WHERE device_id = ${rec.device_id} LIMIT 1
    `);
    const token = (tokenRows.rows as { token: string }[])[0]?.token;
    if (!token) {
      // No token — skip to next stage to avoid retrying forever on this device
      await db.execute(sql`
        UPDATE device_trial_sessions SET nudge_stage = ${rec.nudge_stage + 1} WHERE id = ${rec.id}
      `);
      continue;
    }

    try {
      await sendPushNotifications([{
        to: token,
        title: stage.title,
        body: stage.body,
        sound: "default" as const,
        channelId: "msafiri_general",
        data: { type: "trial_expired_nudge", screen: "/" },
      }]);
    } catch {
      continue; // leave stage unchanged; will retry next cycle
    }

    await db.execute(sql`
      UPDATE device_trial_sessions SET nudge_stage = ${rec.nudge_stage + 1} WHERE id = ${rec.id}
    `);
    logger.info({ deviceId: rec.device_id, fromStage: rec.nudge_stage }, "Trial-expired nudge sent");
  }
}

async function nudgeUnlinkedDevices(): Promise<void> {
  // Use ISO week number so the key changes each Monday and alreadySentToday
  // only deduplicates within the same calendar day.
  const now    = new Date();
  const eat    = toEat(now);
  const weekNo = Math.ceil(
    ((eat.getTime() - new Date(Date.UTC(eat.getUTCFullYear(), 0, 1)).getTime()) / 86400000 + 1) / 7
  );
  const campaignType = `recovery_phone_nudge_w${weekNo}`;
  if (await alreadySentToday(campaignType)) return;

  // Find push tokens whose device has no linked phone number.
  const rows = await db.execute(sql`
    SELECT pt.token
    FROM   push_tokens pt
    WHERE  pt.device_id NOT IN (
             SELECT db.device_id
             FROM   device_backups db
             WHERE  db.phone_number IS NOT NULL
           )
  `);
  const tokens = (rows.rows as { token: string }[]).map((r) => r.token);

  if (tokens.length === 0) {
    logger.info({ campaignType }, "recovery_phone_nudge: all devices have a recovery phone — skipping");
    return;
  }

  const msg = pickMessage(RECOVERY_PHONE_NUDGE_MESSAGES);

  const [campaign] = await db
    .insert(pushCampaignsTable)
    .values({ title: msg.title, body: msg.body, type: campaignType, status: "sending", createdBy: "system" })
    .returning();

  const { ok, failed } = await sendPushNotifications(
    tokens.map((t) => ({
      to: t,
      title: msg.title,
      body: msg.body,
      sound: "default" as const,
      channelId: "msafiri_alerts",
      data: { type: "recovery_phone_nudge", screen: "/link-phone" },
    }))
  );

  await db
    .update(pushCampaignsTable)
    .set({ status: "sent", sentAt: new Date(), sentCount: ok, failedCount: failed, targetCount: tokens.length })
    .where(eq(pushCampaignsTable.id, campaign.id));

  logger.info({ campaignType, targets: tokens.length, ok, failed }, "Recovery phone nudge sent");
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

// Friday(5) & Saturday(6) nights are Kenya's two big going-out nights — the
// ones where safety features (dashcam, trip sharing, crash assistant) are
// most worth promoting.
function isNightSafetyDay(eatDay: number): boolean {
  return eatDay === 5 || eatDay === 6;
}

async function checkDailyTriggers(): Promise<void> {
  const now = new Date();
  const eat = toEat(now);
  const eatDay = eat.getUTCDay();
  const eatHour = eat.getUTCHours();
  const min = eat.getUTCMinutes();

  // 6:00–6:05 AM EAT → morning feature education (active users only)
  if (eatHour === 6 && min < 5) {
    const msg = pickDailyFeatureMsg(0);
    await sendActiveCampaign("daily_morning", msg.title, msg.body);
  }

  // 1:00–1:05 PM EAT → midday feature education (active users only)
  if (eatHour === 13 && min < 5) {
    const msg = pickDailyFeatureMsg(3);
    await sendActiveCampaign("daily_midday", msg.title, msg.body);
  }

  // 4:30–4:35 PM EAT → evening feature education (active users only)
  if (eatHour === 16 && min >= 30 && min < 35) {
    const msg = pickDailyFeatureMsg(6);
    await sendActiveCampaign("daily_evening", msg.title, msg.body);
  }

  // 9:00–9:05 PM EAT, Friday & Saturday only → night-safety feature education
  if (isNightSafetyDay(eatDay) && eatHour === 21 && min < 5) {
    const msg = pickNightSafetyFeatureMsg();
    await sendActiveCampaign("weekend_night_safety", msg.title, msg.body);
  }

  // Wednesday 12:00–12:05 PM EAT → weekly reporting engagement nudge
  if (eatDay === 3 && eatHour === 12 && min < 5) {
    const msg = pickMessage(ENGAGEMENT_MESSAGES);
    await sendActiveCampaign("engagement", msg.title, msg.body);
  }

  // Monday 9:00–9:05 AM EAT → weekly nudge to devices without a recovery phone
  if (eatDay === 1 && eatHour === 9 && min < 5) {
    await nudgeUnlinkedDevices();
  }

  // 10:00–10:05 AM EAT daily → re-engagement for devices inactive 3+ days
  // (per-device cooldown inside checkReengagement means this is safe to run
  // every day — devices that were just re-engaged won't be hit again for 4 days)
  if (eatHour === 10 && min < 5) {
    await checkReengagement();
  }

  // Every cycle → post-trial nudge sequence (self-gated by nudge_stage per device)
  await sendTrialExpiredNudges();
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

  // Helper: true if window closed recently enough to be worth catching up.
  const freshEnough = (windowCloseMin: number) =>
    eatTotalMin > windowCloseMin &&
    eatTotalMin - windowCloseMin <= MAX_CATCHUP_LAG_MIN;

  // Morning window closed at 06:05 EAT
  if (freshEnough(6 * 60 + 5)) {
    const msg = pickDailyFeatureMsg(0);
    await sendActiveCampaign("daily_morning", msg.title, msg.body);
  }

  // Midday window closed at 13:05 EAT
  if (freshEnough(13 * 60 + 5)) {
    const msg = pickDailyFeatureMsg(3);
    await sendActiveCampaign("daily_midday", msg.title, msg.body);
  }

  // Evening window closed at 16:35 EAT
  if (freshEnough(16 * 60 + 35)) {
    const msg = pickDailyFeatureMsg(6);
    await sendActiveCampaign("daily_evening", msg.title, msg.body);
  }

  // Weekend night safety window closed at 21:05 EAT (Fri & Sat only)
  if (isNightSafetyDay(eatDay) && freshEnough(21 * 60 + 5)) {
    const msg = pickNightSafetyFeatureMsg();
    await sendActiveCampaign("weekend_night_safety", msg.title, msg.body);
  }

  // Wednesday engagement window closed at 12:05 EAT
  if (eatDay === 3 && freshEnough(12 * 60 + 5)) {
    const msg = pickMessage(ENGAGEMENT_MESSAGES);
    await sendActiveCampaign("engagement", msg.title, msg.body);
  }

  // Monday recovery phone nudge window closed at 09:05 EAT
  if (eatDay === 1 && freshEnough(9 * 60 + 5)) {
    await nudgeUnlinkedDevices();
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
    title = `🗺️ Trip to ${label} in ~30 minutes`;
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

// ─── Auto-expire planned trips ────────────────────────────────────────────────
// Any trip whose plannedAt timestamp is in the past and still has status
// "upcoming" or "notified" is moved to "completed" so clients can show it in
// the Past tab instead of the Upcoming list.
async function markExpiredTrips(): Promise<void> {
  const now = new Date();
  await db
    .update(plannedTripsTable)
    .set({ status: "completed" })
    .where(
      and(
        or(
          eq(plannedTripsTable.status, "upcoming"),
          eq(plannedTripsTable.status, "notified"),
        ),
        lte(plannedTripsTable.plannedAt, now),
      )
    );
}

// ─── Job entry point ──────────────────────────────────────────────────────────

async function runJob(): Promise<void> {
  await processScheduledCampaigns();
  await checkDailyTriggers();
  await checkPlannedTrips();
  await markExpiredTrips();
}

// ── Receipt-based bad token purge ─────────────────────────────────────────────
// Runs every 30 minutes (receipts are available ~15–30 min after send).
// Deletes any push_tokens that APNs/FCM confirmed as permanently invalid.
async function purgeDeadTokens(): Promise<void> {
  try {
    // Receipt-based purge: APNs/FCM confirmed these tokens as permanently invalid.
    const badTokens = await flushBadTokensFromReceipts();
    for (const token of badTokens) {
      await db.delete(pushTokensTable).where(eq(pushTokensTable.token, token));
    }
    if (badTokens.length > 0) {
      logger.info({ count: badTokens.length }, "Purged dead push tokens via receipt check");
    }

    // Foreign-experience purge: tokens that belong to a different Expo project
    // (collected when PUSH_TOO_MANY_EXPERIENCE_IDS is returned by the push API).
    const foreignTokens = drainForeignExperienceTokens();
    for (const token of foreignTokens) {
      await db.delete(pushTokensTable).where(eq(pushTokensTable.token, token));
    }
    if (foreignTokens.length > 0) {
      logger.info({ count: foreignTokens.length }, "Purged foreign-experience push tokens");
    }
  } catch (err) {
    logger.warn({ err }, "purgeDeadTokens failed");
  }
}

export function startPushNotificationsJob(): NodeJS.Timeout {
  // Push campaigns must only run in production.  The dev server shares the same
  // DB as production, so running jobs here would double-send every notification.
  if (process.env.NODE_ENV !== "production") {
    logger.info("pushNotifications job: dev mode — campaigns disabled (production only)");
    return setInterval(() => {}, 24 * 60 * 60 * 1000);
  }

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
