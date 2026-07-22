import { Router, type Request, type Response } from "express";
import { db, pushTokensTable } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import { sendPushNotifications } from "../lib/expoPush.js";

const router = Router();

// POST /push/register
router.post("/push/register", async (req: Request, res: Response) => {
  const { deviceId, token, platform, lat, lng } = req.body as {
    deviceId: string;
    token: string;
    platform?: string;
    lat?: number;
    lng?: number;
  };

  if (!deviceId || !token) {
    return res.status(400).json({ error: "deviceId and token are required" });
  }

  try {
    // Remove any stale rows that share this token with a different deviceId.
    // This happens when a user reinstalls — AsyncStorage is wiped so a new
    // deviceId is generated, but APNs/FCM issues the same push token. Without
    // this delete the same physical device accumulates multiple rows and
    // receives one notification copy per row.
    await db
      .delete(pushTokensTable)
      .where(and(eq(pushTokensTable.token, token), ne(pushTokensTable.deviceId, deviceId)));

    await db
      .insert(pushTokensTable)
      .values({
        deviceId,
        token,
        platform: platform ?? "unknown",
        lastLat: lat ?? null,
        lastLng: lng ?? null,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: pushTokensTable.deviceId,
        set: {
          token,
          platform: platform ?? "unknown",
          ...(lat != null && lng != null ? { lastLat: lat, lastLng: lng } : {}),
          lastSeenAt: new Date(),
        },
      });
    return res.json({ success: true });
  } catch (err) {
    console.error("POST /push/register error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /push/location — update the last-known position for a registered device
router.post("/push/location", async (req: Request, res: Response) => {
  const { deviceId, lat, lng } = req.body as {
    deviceId: string;
    lat: number;
    lng: number;
  };

  if (!deviceId || lat == null || lng == null) {
    return res.status(400).json({ error: "deviceId, lat, and lng are required" });
  }

  try {
    await db
      .update(pushTokensTable)
      .set({ lastLat: lat, lastLng: lng, lastSeenAt: new Date() })
      .where(eq(pushTokensTable.deviceId, deviceId));
    return res.json({ success: true });
  } catch (err) {
    console.error("PUT /push/location error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── Rotating welcome messages ─────────────────────────────────────────────────
const WELCOME_MESSAGES = [
  { title: "🎉 Welcome to Msafiri Kenya Pro!", body: "You now have full access to live road alerts, speed cameras, and community reports. Stay safe out there!" },
  { title: "🚗 You're in, Msafiri Pro!", body: "Live hazards, speed cameras, and road alerts — all yours. Open the app and see what's ahead." },
  { title: "🛡️ Welcome aboard, driver!", body: "Real-time road intelligence, now unlocked. Msafiri Kenya has your back on every trip." },
];

// POST /push/welcome — send a one-time welcome notification after a subscription purchase.
// The server gates on welcomeSentAt so duplicate calls from the mobile app are silently ignored.
router.post("/push/welcome", async (req: Request, res: Response) => {
  const { deviceId } = req.body as { deviceId: string };
  if (!deviceId) return res.status(400).json({ error: "deviceId required" });

  try {
    const [row] = await db
      .select()
      .from(pushTokensTable)
      .where(eq(pushTokensTable.deviceId, deviceId));

    if (!row) return res.json({ sent: false, reason: "no_token" });
    if (row.welcomeSentAt) return res.json({ sent: false, reason: "already_sent" });

    const pick = WELCOME_MESSAGES[Math.floor(Date.now() / 86400000) % WELCOME_MESSAGES.length]!;

    await sendPushNotifications([{
      to: row.token,
      title: pick.title,
      body: pick.body,
      sound: "default",
      channelId: "msafiri_general",
      data: { type: "welcome" },
    }]);

    await db
      .update(pushTokensTable)
      .set({ welcomeSentAt: new Date() })
      .where(eq(pushTokensTable.deviceId, deviceId));

    return res.json({ sent: true });
  } catch (err) {
    console.error("POST /push/welcome error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── Rotating post-trip messages ───────────────────────────────────────────────
const TRIP_COMPLETE_MESSAGES = [
  { title: "🙌 Hope you had a safe trip!", body: "Seen anything on the road? A quick report takes 10 seconds and helps thousands of drivers." },
  { title: "✅ Made it safely!", body: "Want to help other drivers? Report any hazards or cameras you spotted on the way." },
  { title: "🚗 Journey complete!", body: "Spotted a pothole or checkpoint? Takes 10 seconds to report and keeps everyone safer." },
];

// POST /push/trip-complete — nudge the driver to report road conditions after navigation ends.
// Rate-limited to once per 24 hours per device to avoid fatigue.
router.post("/push/trip-complete", async (req: Request, res: Response) => {
  const { deviceId } = req.body as { deviceId: string };
  if (!deviceId) return res.status(400).json({ error: "deviceId required" });

  try {
    const [row] = await db
      .select()
      .from(pushTokensTable)
      .where(eq(pushTokensTable.deviceId, deviceId));

    if (!row) return res.json({ sent: false, reason: "no_token" });

    // Rate limit: at most one post-trip nudge per 24 hours per device
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (row.lastTripNotifAt && row.lastTripNotifAt > oneDayAgo) {
      return res.json({ sent: false, reason: "rate_limited" });
    }

    const pick = TRIP_COMPLETE_MESSAGES[Math.floor(Date.now() / 86400000) % TRIP_COMPLETE_MESSAGES.length]!;

    await sendPushNotifications([{
      to: row.token,
      title: pick.title,
      body: pick.body,
      sound: "default",
      channelId: "msafiri_general",
      data: { type: "trip_complete" },
    }]);

    await db
      .update(pushTokensTable)
      .set({ lastTripNotifAt: new Date() })
      .where(eq(pushTokensTable.deviceId, deviceId));

    return res.json({ sent: true });
  } catch (err) {
    console.error("POST /push/trip-complete error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /push/deregister
router.delete("/push/deregister", async (req: Request, res: Response) => {
  const { deviceId } = req.body as { deviceId: string };

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId is required" });
  }

  try {
    await db
      .delete(pushTokensTable)
      .where(eq(pushTokensTable.deviceId, deviceId));
    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /push/deregister error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
