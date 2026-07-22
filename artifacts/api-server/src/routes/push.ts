import { Router, type Request, type Response } from "express";
import { db, pushTokensTable } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";

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
