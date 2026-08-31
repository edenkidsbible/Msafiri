import { Router, type Request, type Response } from "express";
import { db, pushTokensTable } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import { sendPushNotifications } from "../lib/expoPush.js";

const router = Router();

// POST /push/register
router.post("/push/register", async (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ error: "Invalid request body" });
  }
  const { deviceId, token, platform, lat, lng, vendorId } = req.body as {
    deviceId: string;
    token: string;
    platform?: string;
    lat?: number;
    lng?: number;
    // Stable cross-reinstall fingerprint: iOS IDFV or Android androidId.
    // Absent for older clients — server degrades gracefully to token-only dedup.
    vendorId?: string | null;
  };

  if (!deviceId || !token) {
    return res.status(400).json({ error: "deviceId and token are required" });
  }

  try {
    // Only native platforms participate in platform-targeted app releases.
    // Treat unexpected or older clients as unknown rather than accidentally
    // including them in either iOS or Android audiences.
    const registeredPlatform = platform === "ios" || platform === "android"
      ? platform
      : "unknown";

    // ── Stale-row cleanup ──────────────────────────────────────────────────
    // Two scenarios cause the same physical device to accumulate multiple rows:
    //
    // A) Same token, new deviceId: happens when the app reinstalls on a device
    //    that keeps the same APNs/FCM token (rare but possible). The existing
    //    token-match delete handles this.
    //
    // B) New token, new deviceId: the common iOS case — reinstall wipes
    //    AsyncStorage (new deviceId) AND triggers a new APNs token rotation.
    //    The old row stays valid for up to 30 minutes until the receipt purge
    //    runs and APNs confirms the old token as stale. During that window the
    //    same iPhone receives two copies of every notification. Passing the iOS
    //    identifierForVendor (IDFV) or Android androidId lets us detect this
    //    "same physical device, new row" situation and evict the stale row
    //    immediately at registration time.
    //
    // Both deletes are safe no-ops if nothing matches.
    await db
      .delete(pushTokensTable)
      .where(and(eq(pushTokensTable.token, token), ne(pushTokensTable.deviceId, deviceId)));

    if (vendorId) {
      await db
        .delete(pushTokensTable)
        .where(and(eq(pushTokensTable.vendorId, vendorId), ne(pushTokensTable.deviceId, deviceId)));
    }

    await db
      .insert(pushTokensTable)
      .values({
        deviceId,
        token,
        platform: registeredPlatform,
        vendorId: vendorId ?? null,
        lastLat: lat ?? null,
        lastLng: lng ?? null,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: pushTokensTable.deviceId,
        set: {
          token,
          platform: registeredPlatform,
          ...(vendorId ? { vendorId } : {}),
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

// POST /push/location — update the last-known position for a registered device.
// When source="background_task" the lat/lng fields are optional: the server
// stamps lastBgWakeupAt unconditionally so even devices without a cached
// location still produce a confirmed background-task heartbeat.
router.post("/push/location", async (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ error: "Invalid request body" });
  }
  const { deviceId, lat, lng, source } = req.body as {
    deviceId: string;
    lat?: number;
    lng?: number;
    source?: string;
  };

  const isBgTask = source === "background_task";

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId is required" });
  }
  // For non-background calls (regular location updates) lat+lng are still required
  if (!isBgTask && (lat == null || lng == null)) {
    return res.status(400).json({ error: "deviceId, lat, and lng are required" });
  }

  try {
    const now = new Date();
    await db
      .update(pushTokensTable)
      .set({
        ...(lat != null && lng != null ? { lastLat: lat, lastLng: lng } : {}),
        lastSeenAt: now,
        ...(isBgTask ? { lastBgWakeupAt: now } : {}),
      })
      .where(eq(pushTokensTable.deviceId, deviceId));
    return res.json({ success: true });
  } catch (err) {
    console.error("PUT /push/location error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── Rotating welcome messages ─────────────────────────────────────────────────
const WELCOME_MESSAGES = [
  { title: "Pro unlocked! 🎉", body: "Live alerts, speed cams & community reports — all yours. Drive safe!" },
  { title: "You're in! 🚗", body: "Hazards, cameras & road alerts live. Open Msafiri to see what's ahead." },
  { title: "Welcome aboard! 🛡️", body: "Real-time road intel unlocked. We've got your back on every trip." },
];

// POST /push/welcome — send a one-time welcome notification after a subscription purchase.
// The server gates on welcomeSentAt so duplicate calls from the mobile app are silently ignored.
router.post("/push/welcome", async (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ error: "Invalid request body" });
  }
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
  { title: "Safe trip? 🙌", body: "Seen something? A quick report takes 10 secs and helps thousands of drivers." },
  { title: "Made it! ✅", body: "Spot any hazards or cameras? Report in 10 secs and help other drivers." },
  { title: "Journey done! 🚗", body: "Saw a pothole or checkpoint? Takes 10 secs to report — keeps everyone safer." },
];

// POST /push/trip-complete — nudge the driver to report road conditions after navigation ends.
// Rate-limited to once per 24 hours per device to avoid fatigue.
router.post("/push/trip-complete", async (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ error: "Invalid request body" });
  }
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
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ error: "Invalid request body" });
  }
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
