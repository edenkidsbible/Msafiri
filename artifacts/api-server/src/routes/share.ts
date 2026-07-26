import { Router, type Request, type Response } from "express";
import { db, sharingSessionsTable } from "@workspace/db";
import { eq, and, isNull, lt } from "drizzle-orm";
import { randomBytes } from "crypto";
import { logger } from "../lib/logger.js";
import { pushLiveActivityUpdate, type LiveActivityContentState } from "../lib/apns.js";

const router: Router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(s: string): boolean { return UUID_RE.test(s); }

// 8 unambiguous chars (no I/O/0/1) — e.g. "A3X9K2QP"
const SHORT_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateShortCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes).map(b => SHORT_CHARS[b % SHORT_CHARS.length]).join("");
}

// ── Constants ─────────────────────────────────────────────────────────────────

// 8 hour session cap — sessions cannot live longer than this even if the app
// crashes before sending a DELETE.
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

// Validate an APNs Live Activity push token (64-byte hex, 128 hex chars)
const PUSH_TOKEN_RE = /^[0-9a-f]{64,512}$/i;
function isValidPushToken(s: string): boolean { return PUSH_TOKEN_RE.test(s); }

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
// Body: { deviceId, driverName?, destinationName?, destinationLat?, destinationLng?, lat?, lng? }
// Returns: { token, expiresAt }
router.post("/share/session", async (req: Request, res: Response) => {
  const { deviceId, driverName, destinationName, destinationLat, destinationLng, lat, lng } = req.body ?? {};
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
        shortCode:       generateShortCode(),
        driverName:      typeof driverName === "string" && driverName.trim() ? driverName.trim() : null,
        destinationName: destinationName ?? null,
        destinationLat:  destinationLat  != null ? Number(destinationLat)  : null,
        destinationLng:  destinationLng  != null ? Number(destinationLng)  : null,
        lat: lat != null ? Number(lat) : null,
        lng: lng != null ? Number(lng) : null,
        expiresAt,
      })
      .returning({
        token:     sharingSessionsTable.token,
        shortCode: sharingSessionsTable.shortCode,
        expiresAt: sharingSessionsTable.expiresAt,
      });

    logger.info({ token: session.token, shortCode: session.shortCode }, "share session created");
    res.json({ token: session.token, shortCode: session.shortCode, expiresAt: session.expiresAt });
  } catch (err) {
    logger.error(err, "failed to create share session");
    res.status(500).json({ error: "failed to create session" });
  }
});

// ── PATCH /share/:token/activity-token — store the Live Activity push token ───
// Called by the mobile app right after startActivity() returns a push token.
// The token is used by the ping handler below to push ContentState updates
// directly via APNs when the app process is fully suspended.
// Body: { deviceId, pushToken }
router.patch("/share/:token/activity-token", async (req: Request, res: Response) => {
  const token = req.params["token"] as string;
  if (!isValidUuid(token)) { res.status(404).json({ error: "session not found" }); return; }

  const { deviceId, pushToken } = req.body ?? {};
  if (!deviceId || typeof deviceId !== "string") {
    res.status(400).json({ error: "deviceId required" }); return;
  }
  if (!pushToken || typeof pushToken !== "string" || !isValidPushToken(pushToken)) {
    res.status(400).json({ error: "pushToken must be a hex-encoded APNs token" }); return;
  }

  const [session] = await db
    .select({ deviceId: sharingSessionsTable.deviceId, endedAt: sharingSessionsTable.endedAt, expiresAt: sharingSessionsTable.expiresAt })
    .from(sharingSessionsTable)
    .where(eq(sharingSessionsTable.token, token));

  if (!session) { res.status(404).json({ error: "session not found" }); return; }
  if (session.deviceId !== deviceId) { res.status(403).json({ error: "forbidden" }); return; }
  if (session.endedAt || session.expiresAt < new Date()) {
    res.status(410).json({ error: "session ended" }); return;
  }

  await db
    .update(sharingSessionsTable)
    .set({ liveActivityPushToken: pushToken })
    .where(eq(sharingSessionsTable.token, token));

  logger.info({ token, tokenPrefix: pushToken.slice(0, 8) }, "Live Activity push token stored");
  res.json({ ok: true });
});

// ── PATCH /share/:token/ping — driver sends a GPS update ─────────────────────
// Body: { deviceId, lat, lng, speedKmh?, durationRemainingS?, distanceRemainingM?,
//         nextInstruction?, distToNextM?, destinationName?, speedLimitKmh?,
//         isSharingTrip? }
// After updating the DB row, fires a Live Activity remote push if a push token
// is stored for the session, so the Dynamic Island / Lock Screen updates even
// when the app is fully suspended.
router.patch("/share/:token/ping", async (req: Request, res: Response) => {
  const token = req.params["token"] as string;
  if (!isValidUuid(token)) { res.status(404).json({ error: "session not found" }); return; }
  const {
    deviceId, lat, lng, speedKmh, durationRemainingS, distanceRemainingM,
    nextInstruction, distToNextM, destinationName, speedLimitKmh, isSharingTrip,
  } = req.body ?? {};

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
      deviceId:              sharingSessionsTable.deviceId,
      endedAt:               sharingSessionsTable.endedAt,
      expiresAt:             sharingSessionsTable.expiresAt,
      liveActivityPushToken: sharingSessionsTable.liveActivityPushToken,
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

  // ── Remote Live Activity push ─────────────────────────────────────────────
  // Fire-and-forget so that a slow/failing APNs request never delays the ping
  // response that the driver's app is waiting on.
  if (session.liveActivityPushToken) {
    const contentState: LiveActivityContentState = {
      speedKmh:        speedKmh        != null ? Number(speedKmh)        : 0,
      speedLimitKmh:   speedLimitKmh   != null ? Number(speedLimitKmh)   : null,
      nextInstruction: typeof nextInstruction === "string" ? nextInstruction : null,
      distToNextM:     distToNextM     != null ? Number(distToNextM)     : null,
      destinationName: typeof destinationName === "string" ? destinationName : null,
      isSharingTrip:   typeof isSharingTrip === "boolean" ? isSharingTrip : true,
      lastUpdatedAt:   Date.now() / 1000,
    };
    // Do not await — keep the ping response fast
    pushLiveActivityUpdate(session.liveActivityPushToken, contentState).catch(() => {});
  }

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

// ── GET /share/:code — viewer polls for the latest state ──────────────────────
// Accepts either an 8-char shortCode (new) or a full UUID (backward compat).
// Public — no auth required. Lazy-expires stale sessions before returning.
router.get("/share/:code", async (req: Request, res: Response) => {
  const code = (req.params["code"] as string).toUpperCase();

  await expireStale();

  const selectFields = {
    lat:                sharingSessionsTable.lat,
    lng:                sharingSessionsTable.lng,
    speedKmh:           sharingSessionsTable.speedKmh,
    durationRemainingS: sharingSessionsTable.durationRemainingS,
    distanceRemainingM: sharingSessionsTable.distanceRemainingM,
    driverName:         sharingSessionsTable.driverName,
    destinationName:    sharingSessionsTable.destinationName,
    destinationLat:     sharingSessionsTable.destinationLat,
    destinationLng:     sharingSessionsTable.destinationLng,
    lastPingAt:         sharingSessionsTable.lastPingAt,
    endedAt:            sharingSessionsTable.endedAt,
    expiresAt:          sharingSessionsTable.expiresAt,
    createdAt:          sharingSessionsTable.createdAt,
  };

  // Try short code first; fall back to UUID for backward compatibility
  const isUuid = isValidUuid(code);
  const [session] = await db
    .select(selectFields)
    .from(sharingSessionsTable)
    .where(
      isUuid
        ? eq(sharingSessionsTable.token, code.toLowerCase())
        : eq(sharingSessionsTable.shortCode, code),
    );

  if (!session) { res.status(404).json({ error: "session not found" }); return; }

  const ended = !!session.endedAt || session.expiresAt < new Date();
  res.json({ ...session, ended });
});

export default router;
