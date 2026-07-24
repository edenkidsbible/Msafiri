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

// ─── Re-engagement messages (3 tiers by inactivity duration) ─────────────────

const REENGAGEMENT_3DAY = [
  { title: "👀 Road conditions change daily", body: "See what's happening on Kenyan roads near you. New reports since your last visit." },
  { title: "🚗 Miss anything on the roads?", body: "Live hazards, checkpoints, and cameras updated. Check in before your next drive." },
  { title: "🛣️ Back on the road soon?", body: "Fresh reports are in from drivers near you. Tap to see what's changed." },
];

const REENGAGEMENT_7DAY = [
  { title: "🚦 New road alerts near you", body: "Drivers near you have reported new road alerts this week. Stay ahead." },
  { title: "📡 A week of road reports", body: "A lot has changed on Kenyan roads this week. Come back and see what's near you." },
  { title: "📍 38 new alerts near you", body: "Community reports have been active this week. See what drivers are flagging near you." },
];

const REENGAGEMENT_14DAY = [
  { title: "🛣️ We miss you, driver!", body: "Come back and stay ahead of traffic, speed cameras, and road hazards near you." },
  { title: "🚗 Roads have changed since you left", body: "New hazards, cameras, and checkpoints reported near your area. Open Msafiri to catch up." },
  { title: "🌍 Kenyan roads need your eyes", body: "Your reports help thousands of drivers. Come back and keep your community safe." },
];

const ENGAGEMENT_MESSAGES = [
  { title: "📍 Seen anything on the road?", body: "Report a hazard, camera, or pothole and help fellow drivers. Takes just 10 seconds!" },
  { title: "🤝 Be the city's eyes", body: "Every report you add keeps Kenyan roads safer. Share what you see today!" },
  { title: "🏆 Your reports matter", body: "Spot a pothole or roadblock? Add a quick report and earn community trust." },
  { title: "📡 Help drivers near you", body: "Drivers are relying on live reports right now. See something? Say something." },
];

// ─── Re-engagement job ────────────────────────────────────────────────────────

async function checkReengagement(): Promise<void> {
  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const fourDaysAgo  = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);

  // Devices inactive for 3+ days that haven't had a re-engagement push in the
  // last 4 days (prevents a fresh-returned user from being re-engaged again
  // within the same dormancy window; the 4-day gap also spaces out the
  // 3d → 7d → 14d tiers naturally as inactivity accumulates).
  const eligible = await db
    .select()
    .from(pushTokensTable)
    .where(
      and(
        lte(pushTokensTable.lastSeenAt, threeDaysAgo),
        or(
          isNull(pushTokensTable.lastReengagedAt),
          lte(pushTokensTable.lastReengagedAt, fourDaysAgo)
        )
      )
    );

  if (eligible.length === 0) return;

  const picks = eligible.map((row) => {
    const inactiveDays = Math.floor((now.getTime() - row.lastSeenAt.getTime()) / 86400000);
    const pool = inactiveDays >= 14 ? REENGAGEMENT_14DAY
               : inactiveDays >= 7  ? REENGAGEMENT_7DAY
               :                      REENGAGEMENT_3DAY;
    return { row, msg: pool[getDayOfYear() % pool.length]! };
  });

  const { ok, failed } = await sendPushNotifications(
    picks.map(({ row, msg }) => ({
      to: row.token,
      title: msg.title,
      body: msg.body,
      sound: "default" as const,
      channelId: "msafiri_general",
      data: { type: "re_engagement" },
    }))
  );

  // Update lastReengagedAt for every targeted device so the cooldown resets
  await db
    .update(pushTokensTable)
    .set({ lastReengagedAt: now })
    .where(inArray(pushTokensTable.deviceId, eligible.map((r) => r.deviceId)));

  logger.info({ count: eligible.length, ok, failed }, "Re-engagement notifications sent");
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

  // 6:00–6:05 AM EAT → morning reminder (1 of 3 daily sends)
  if (eatHour === 6 && min < 5) {
    const msg = pickMessage(weekend ? MORNING_MESSAGES_WEEKEND : MORNING_MESSAGES);
    await sendAutoCampaign("daily_morning", msg.title, msg.body);
  }

  // 1:00–1:05 PM EAT → midday reminder (2 of 3 daily sends — new)
  if (eatHour === 13 && min < 5) {
    const msg = pickMessage(weekend ? MIDDAY_MESSAGES_WEEKEND : MIDDAY_MESSAGES);
    await sendAutoCampaign("daily_midday", msg.title, msg.body);
  }

  // 4:30–4:35 PM EAT → evening reminder (3 of 3 daily sends)
  if (eatHour === 16 && min >= 30 && min < 35) {
    const msg = pickMessage(weekend ? EVENING_MESSAGES_WEEKEND : EVENING_MESSAGES);
    await sendAutoCampaign("daily_evening", msg.title, msg.body);
  }

  // 9:00–9:05 PM EAT, Friday & Saturday only → weekend night safety
  // (alcoblow checkpoints, hazards, debris — a 4th send on the two nights
  // it matters most).
  if (isNightSafetyDay(eatDay) && eatHour === 21 && min < 5) {
    const msg = pickMessage(WEEKEND_NIGHT_MESSAGES);
    await sendAutoCampaign("weekend_night_safety", msg.title, msg.body);
  }

  // Wednesday 12:00–12:05 PM EAT → weekly engagement nudge
  if (eatDay === 3 && eatHour === 12 && min < 5) {
    const msg = pickMessage(ENGAGEMENT_MESSAGES);
    await sendAutoCampaign("engagement", msg.title, msg.body);
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
async function catchUpMissedTriggers(): Promise<void> {
  const now = new Date();
  const eat = toEat(now);
  const eatDay = eat.getUTCDay();
  const eatHour = eat.getUTCHours();
  const eatMin = eat.getUTCMinutes();
  // Total EAT minutes since midnight — used to compare against window start times.
  const eatTotalMin = eatHour * 60 + eatMin;
  const weekend = isWeekendDay(eatDay);

  // Morning window closed at 06:05 EAT
  if (eatTotalMin > 6 * 60 + 5) {
    const msg = pickMessage(weekend ? MORNING_MESSAGES_WEEKEND : MORNING_MESSAGES);
    await sendAutoCampaign("daily_morning", msg.title, msg.body);
  }

  // Midday window closed at 13:05 EAT
  if (eatTotalMin > 13 * 60 + 5) {
    const msg = pickMessage(weekend ? MIDDAY_MESSAGES_WEEKEND : MIDDAY_MESSAGES);
    await sendAutoCampaign("daily_midday", msg.title, msg.body);
  }

  // Evening window closed at 16:35 EAT
  if (eatTotalMin > 16 * 60 + 35) {
    const msg = pickMessage(weekend ? EVENING_MESSAGES_WEEKEND : EVENING_MESSAGES);
    await sendAutoCampaign("daily_evening", msg.title, msg.body);
  }

  // Weekend night safety window closed at 21:05 EAT (Fri & Sat only)
  if (isNightSafetyDay(eatDay) && eatTotalMin > 21 * 60 + 5) {
    const msg = pickMessage(WEEKEND_NIGHT_MESSAGES);
    await sendAutoCampaign("weekend_night_safety", msg.title, msg.body);
  }

  // Wednesday engagement window closed at 12:05 EAT
  if (eatDay === 3 && eatTotalMin > 12 * 60 + 5) {
    const msg = pickMessage(ENGAGEMENT_MESSAGES);
    await sendAutoCampaign("engagement", msg.title, msg.body);
  }

  // Re-engagement window closed at 10:05 EAT
  if (eatTotalMin > 10 * 60 + 5) {
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

interface OSRMRoute {
  distanceM: number;
  durationS: number;
  coords: { lat: number; lng: number }[];
}

async function fetchOSRMRoute(fromLat: number, fromLng: number, toLat: number, toLng: number): Promise<OSRMRoute | null> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const data = (await res.json()) as any;
    if (data.code !== "Ok" || !data.routes?.length) return null;
    const r = data.routes[0];
    return {
      distanceM: r.distance,
      durationS: r.duration,
      coords: (r.geometry.coordinates as [number, number][]).map(([lng, lat]) => ({ lat, lng })),
    };
  } catch (err) {
    logger.warn({ err }, "Planned trip advice: OSRM route fetch failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Returns true if any point of the route polyline is within `maxM` of (lat, lng). */
function isNearRoute(route: OSRMRoute, lat: number, lng: number, maxM: number): boolean {
  return route.coords.some((c) => haversineKm(c.lat, c.lng, lat, lng) * 1000 <= maxM);
}

function formatEatTime(d: Date): string {
  return d.toLocaleTimeString("en-KE", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Nairobi" });
}

async function sendTripAdvice(deviceId: string, token: string, tripId: string, label: string, plannedAt: Date, route: OSRMRoute | null): Promise<void> {
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
        ? await fetchOSRMRoute(tokenRow.lastLat, tokenRow.lastLng, trip.destLat, trip.destLng)
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
