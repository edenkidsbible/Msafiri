import { Router, type Request, type Response } from "express";
import { db, sharingSessionsTable } from "@workspace/db";
import { eq, and, isNull, lt } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router: Router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(s: string): boolean { return UUID_RE.test(s); }

// ── Constants ─────────────────────────────────────────────────────────────────

// 8 hour session cap — sessions cannot live longer than this even if the app
// crashes before sending a DELETE.
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Lazily mark any sessions past their expiresAt as ended. Runs before reads
// so viewers get an accurate "ended" state without a scheduled job.
async function expireStale() {
  await db
    .update(sharingSessionsTable)
    .set({ endedAt: new Date() })
    .where(
      and(
        lt(sharingSessionsTable.expiresAt, new Date()),
        isNull(sharingSessionsTable.endedAt),
      )
    );
}

// ── POST /share/session — create a new sharing session ────────────────────────
// Body: { deviceId, destinationName?, destinationLat?, destinationLng?, lat?, lng? }
// Returns: { token, expiresAt }
router.post("/share/session", async (req: Request, res: Response) => {
  const { deviceId, destinationName, destinationLat, destinationLng, lat, lng } = req.body ?? {};
  if (!deviceId || typeof deviceId !== "string") {
    res.status(400).json({ error: "deviceId required" });
    return;
  }

  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  try {
    const [session] = await db
      .insert(sharingSessionsTable)
      .values({
        deviceId,
        destinationName: destinationName ?? null,
        destinationLat:  destinationLat  != null ? Number(destinationLat)  : null,
        destinationLng:  destinationLng  != null ? Number(destinationLng)  : null,
        lat: lat != null ? Number(lat) : null,
        lng: lng != null ? Number(lng) : null,
        expiresAt,
      })
      .returning({ token: sharingSessionsTable.token, expiresAt: sharingSessionsTable.expiresAt });

    logger.info({ token: session.token }, "share session created");
    res.json({ token: session.token, expiresAt: session.expiresAt });
  } catch (err) {
    logger.error(err, "failed to create share session");
    res.status(500).json({ error: "failed to create session" });
  }
});

// ── PATCH /share/:token/ping — driver sends a GPS update ─────────────────────
// Body: { deviceId, lat, lng, speedKmh?, durationRemainingS?, distanceRemainingM? }
router.patch("/share/:token/ping", async (req: Request, res: Response) => {
  const token = req.params["token"] as string;
  if (!isValidUuid(token)) { res.status(404).json({ error: "session not found" }); return; }
  const { deviceId, lat, lng, speedKmh, durationRemainingS, distanceRemainingM } = req.body ?? {};

  if (!deviceId || typeof deviceId !== "string") {
    res.status(400).json({ error: "deviceId required" });
    return;
  }
  if (lat == null || lng == null) {
    res.status(400).json({ error: "lat and lng required" });
    return;
  }

  const [session] = await db
    .select({
      deviceId:  sharingSessionsTable.deviceId,
      endedAt:   sharingSessionsTable.endedAt,
      expiresAt: sharingSessionsTable.expiresAt,
    })
    .from(sharingSessionsTable)
    .where(eq(sharingSessionsTable.token, token));

  if (!session) { res.status(404).json({ error: "session not found" }); return; }
  if (session.deviceId !== deviceId) { res.status(403).json({ error: "forbidden" }); return; }
  if (session.endedAt || session.expiresAt < new Date()) {
    res.status(410).json({ error: "session ended" });
    return;
  }

  await db
    .update(sharingSessionsTable)
    .set({
      lat:                Number(lat),
      lng:                Number(lng),
      speedKmh:           speedKmh           != null ? Number(speedKmh)           : null,
      durationRemainingS: durationRemainingS != null ? Math.round(Number(durationRemainingS)) : null,
      distanceRemainingM: distanceRemainingM != null ? Number(distanceRemainingM) : null,
      lastPingAt:         new Date(),
    })
    .where(eq(sharingSessionsTable.token, token));

  res.json({ ok: true });
});

// ── DELETE /share/:token — driver ends the session ────────────────────────────
// Body: { deviceId }
router.delete("/share/:token", async (req: Request, res: Response) => {
  const token = req.params["token"] as string;
  if (!isValidUuid(token)) { res.status(404).json({ error: "session not found" }); return; }
  const { deviceId } = req.body ?? {};

  if (!deviceId || typeof deviceId !== "string") {
    res.status(400).json({ error: "deviceId required" });
    return;
  }

  const [session] = await db
    .select({ deviceId: sharingSessionsTable.deviceId })
    .from(sharingSessionsTable)
    .where(eq(sharingSessionsTable.token, token));

  if (!session) { res.status(404).json({ error: "session not found" }); return; }
  if (session.deviceId !== deviceId) { res.status(403).json({ error: "forbidden" }); return; }

  await db
    .update(sharingSessionsTable)
    .set({ endedAt: new Date() })
    .where(eq(sharingSessionsTable.token, token));

  logger.info({ token }, "share session ended by driver");
  res.json({ ok: true });
});

// ── GET /share/:token — viewer polls for the latest state ─────────────────────
// Public — no auth required. Lazy-expires stale sessions before returning.
router.get("/share/:token", async (req: Request, res: Response) => {
  const token = req.params["token"] as string;
  if (!isValidUuid(token)) { res.status(404).json({ error: "session not found" }); return; }

  await expireStale();

  const [session] = await db
    .select({
      lat:                sharingSessionsTable.lat,
      lng:                sharingSessionsTable.lng,
      speedKmh:           sharingSessionsTable.speedKmh,
      durationRemainingS: sharingSessionsTable.durationRemainingS,
      distanceRemainingM: sharingSessionsTable.distanceRemainingM,
      destinationName:    sharingSessionsTable.destinationName,
      destinationLat:     sharingSessionsTable.destinationLat,
      destinationLng:     sharingSessionsTable.destinationLng,
      lastPingAt:         sharingSessionsTable.lastPingAt,
      endedAt:            sharingSessionsTable.endedAt,
      expiresAt:          sharingSessionsTable.expiresAt,
      createdAt:          sharingSessionsTable.createdAt,
    })
    .from(sharingSessionsTable)
    .where(eq(sharingSessionsTable.token, token));

  if (!session) { res.status(404).json({ error: "session not found" }); return; }

  const ended = !!session.endedAt || session.expiresAt < new Date();
  res.json({ ...session, ended });
});

export default router;
