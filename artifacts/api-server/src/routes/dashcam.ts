/**
 * dashcam.ts — API routes for the Msafiri dashcam feature.
 *
 * Device enrollment model:
 * ──────────────────────────────────────────────────────────
 * POST /dashcam/register auto-enrolls any device that presents a valid
 * X-Device-Id + X-Dashcam-Secret pair, subject to an IP-backed rate limit.
 *
 * Authentication is device-level: the dashcamSecret is a random UUID (128 bits
 * of entropy) generated on first launch and stored only in the device's
 * AsyncStorage. The server stores SHA-256(deviceId+":"+secret) and verifies it
 * on every subsequent API call. An attacker who does not possess the device's
 * secret cannot impersonate it, regardless of whether they know the deviceId.
 *
 * The IP rate limit (3 new enrollments per IP per hour) is the primary
 * anti-abuse control for the open enrollment endpoint. Storage abuse beyond that
 * is bounded by the per-device clip quota (MAX_CLIPS_PER_DEVICE).
 *
 * The previous two-phase push-OTP flow was removed: it required the user to tap
 * a push notification to complete enrollment, causing persistent 403s when the
 * notification was dismissed. An intermediate attempt gated enrollment on a
 * push_tokens row, but /push/register is unauthenticated and that row is not a
 * reliable proof of identity — it was removed in favour of the secret-hash gate.
 *
 * Atomic upload quota:
 * ──────────────────────────────────────────────────────────
 * POST /dashcam/upload-url runs inside a SERIALIZABLE transaction. The count
 * of (persisted clips + outstanding intents) and the intent INSERT are part of
 * the same serializable snapshot. PostgreSQL will abort one of two concurrent
 * transactions that both observe quota capacity, issuing a serialization-failure
 * error (code 40001), which is returned as HTTP 429.
 *
 * POST /dashcam/clip validates that the clipId/fileKey came from an issued
 * intent and that the intent is unexpired and unfulfilled.
 *
 * Additional controls:
 *   - DB-backed IP rate limit on new enrollments (3/IP/hr, survives restarts)
 *   - req.ip via Express trust proxy (not raw X-Forwarded-For)
 *   - Per-clip ownership: SHA-256(deviceId+":"+secret) stored on each clip row
 *   - Stale intents (expired, unfulfilled) cleaned up every 5 minutes
 *
 * Routes:
 *   POST /api/dashcam/register         → auto-enroll device (IP rate limit + secret-hash auth)
 *   POST /api/dashcam/upload-url       → presigned R2 PUT URL + serializable intent reservation
 *   POST /api/dashcam/clip             → finalize upload (validates intent)
 *   GET  /api/dashcam/clips            → list clips for a device
 *   GET  /api/dashcam/clip/:id/url     → presigned GET URL for playback/sharing
 *   DELETE /api/dashcam/clip/:id       → delete a clip from R2 + DB
 */

import { Router, type Request, type Response } from "express";
import { createHash } from "crypto";
import { db } from "@workspace/db";
import {
  dashcamClipsTable,
  dashcamDevicesTable,
  dashcamRegRatelimitTable,
  dashcamUploadIntentsTable,
} from "@workspace/db";
import { eq, and, desc, sql, count, gt, isNull } from "drizzle-orm";
import {
  isR2Configured,
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  deleteObject,
  clipKey,
} from "../lib/r2Storage.js";
import { logger } from "../lib/logger.js";
import { randomUUID } from "crypto";

const router = Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_REG_PER_IP_PER_HOUR = 3;
const MAX_CLIPS_PER_DEVICE    = 100;
const INTENT_TTL_MS           = 30 * 60 * 1_000; // 30 minutes

// ── Auth helpers ──────────────────────────────────────────────────────────────

function computeSecretHash(deviceId: string, secret: string): string {
  return createHash("sha256").update(`${deviceId}:${secret}`).digest("hex");
}

function extractAuth(req: Request): { deviceId: string; secret: string } | null {
  const deviceId = (req.headers["x-device-id"] as string | undefined)?.trim();
  const secret   = (req.headers["x-dashcam-secret"] as string | undefined)?.trim();
  if (!deviceId || !secret) return null;
  return { deviceId, secret };
}

function ipHash(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

/**
 * DB-backed IP rate limiter — persists across restarts.
 * Returns true (allowed) or false (over limit).
 */
async function checkDbRateLimit(ip: string): Promise<boolean> {
  const hash    = ipHash(ip);
  const oneHour = new Date(Date.now() - 3_600_000);

  await db.execute(sql`
    INSERT INTO dashcam_reg_ratelimit (ip_hash, count, window_start)
    VALUES (${hash}, 1, NOW())
    ON CONFLICT (ip_hash) DO UPDATE
      SET count        = CASE
                           WHEN dashcam_reg_ratelimit.window_start < ${oneHour}
                           THEN 1
                           ELSE dashcam_reg_ratelimit.count + 1
                         END,
          window_start = CASE
                           WHEN dashcam_reg_ratelimit.window_start < ${oneHour}
                           THEN NOW()
                           ELSE dashcam_reg_ratelimit.window_start
                         END
  `);

  const [row] = await db
    .select()
    .from(dashcamRegRatelimitTable)
    .where(eq(dashcamRegRatelimitTable.ipHash, hash))
    .limit(1);

  return !row || row.count <= MAX_REG_PER_IP_PER_HOUR;
}

async function isDeviceRegistered(
  deviceId: string,
  secretHash: string,
  txDb: typeof db = db
): Promise<boolean> {
  const [row] = await txDb
    .select()
    .from(dashcamDevicesTable)
    .where(
      and(
        eq(dashcamDevicesTable.deviceId, deviceId),
        eq(dashcamDevicesTable.secretHash, secretHash)
      )
    )
    .limit(1);
  return !!row;
}

async function findOwnedClip(clipId: string, deviceId: string, secretHash: string) {
  const [clip] = await db
    .select()
    .from(dashcamClipsTable)
    .where(
      and(
        eq(dashcamClipsTable.id, clipId),
        eq(dashcamClipsTable.deviceId, deviceId)
      )
    )
    .limit(1);
  if (!clip) return null;
  if (clip.deviceSecretHash && clip.deviceSecretHash !== secretHash) return null;
  return clip;
}

// ── Background cleanup: expire stale intents & enrollment requests ────────────

async function expireStaleRows() {
  try {
    await db.execute(sql`
      DELETE FROM dashcam_upload_intents
      WHERE expires_at < NOW() AND fulfilled_at IS NULL
    `);
  } catch (err) {
    logger.warn({ err }, "dashcam: stale row cleanup failed");
  }
}

setInterval(expireStaleRows, 5 * 60_000);

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/dashcam/register
 *
 * Auto-enrollment via device secret:
 *   - Already enrolled, matching secret → { ok: true, registered: false }
 *   - Already enrolled, different secret → 409
 *   - New device, within IP rate limit → enroll → { ok: true, registered: true }
 *   - New device, IP rate limit exceeded → 429
 *
 * The enrollment gate is the IP rate limit (3 new devices/IP/hr) plus the
 * per-device secret hash stored in dashcam_devices. No push_tokens check is
 * performed: that row is not a reliable proof of identity because /push/register
 * is unauthenticated. The real credential is the dashcamSecret UUID known only
 * to the device.
 */
router.post("/dashcam/register", async (req: Request, res: Response) => {
  const auth = extractAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "X-Device-Id and X-Dashcam-Secret headers are required" });
  }

  const { deviceId, secret } = auth;
  const secretHash = computeSecretHash(deviceId, secret);

  try {
    // Fast path: already enrolled
    const [existing] = await db
      .select()
      .from(dashcamDevicesTable)
      .where(eq(dashcamDevicesTable.deviceId, deviceId))
      .limit(1);

    if (existing) {
      if (existing.secretHash !== secretHash) {
        return res.status(409).json({ error: "Device registered with a different secret" });
      }
      return res.json({ ok: true, registered: false });
    }

    // New device — apply IP rate limit, then enroll.
    // The secret hash is the real authentication credential; the rate limit
    // is the anti-abuse control for the open enrollment endpoint.
    const ip      = req.ip ?? "unknown";
    const allowed = await checkDbRateLimit(ip);
    if (!allowed) {
      return res.status(429).json({
        error: "Too many enrollment attempts from this network — try again in an hour",
      });
    }

    await db.insert(dashcamDevicesTable).values({ deviceId, secretHash });
    logger.info({ deviceId }, "dashcam: device enrolled");
    return res.json({ ok: true, registered: true });
  } catch (err) {
    logger.error({ err }, "dashcam: registration failed");
    return res.status(500).json({ error: "Registration failed" });
  }
});

/**
 * POST /api/dashcam/upload-url
 *
 * Issues a presigned R2 PUT URL and atomically reserves quota via a
 * SERIALIZABLE transaction. The count of (persisted clips + outstanding intents)
 * and the intent INSERT share a serializable snapshot — PostgreSQL will abort
 * one of two concurrent transactions that both observe quota availability,
 * returning a serialization-failure error (code 40001) converted to HTTP 429.
 */
router.post("/dashcam/upload-url", async (req: Request, res: Response) => {
  if (!isR2Configured()) {
    return res.status(503).json({ error: "Cloud storage not configured" });
  }

  const auth = extractAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "X-Device-Id and X-Dashcam-Secret headers are required" });
  }

  const { deviceId, secret } = auth;
  const secretHash = computeSecretHash(deviceId, secret);

  if (!(await isDeviceRegistered(deviceId, secretHash))) {
    return res.status(403).json({
      error: "Device not enrolled — call POST /api/dashcam/register first",
    });
  }

  const { lockReason } = req.body ?? {};
  const clipId    = randomUUID();
  const key       = clipKey(deviceId, clipId);
  const expiresAt = new Date(Date.now() + INTENT_TTL_MS);

  let quotaExceeded = false;

  try {
    await db.transaction(
      async (tx) => {
        // Read total quota usage (clips + outstanding intents) in the same
        // serializable snapshot as the INSERT below. Any concurrent transaction
        // that reads the same count and also inserts will cause PostgreSQL to
        // detect a read/write conflict and abort one (error code 40001).
        const result = await tx.execute<{ total: string }>(sql`
          SELECT (
            COALESCE((SELECT COUNT(*) FROM dashcam_clips WHERE device_id = ${deviceId}), 0)
            +
            COALESCE((SELECT COUNT(*) FROM dashcam_upload_intents
             WHERE device_id = ${deviceId}
               AND expires_at > NOW()
               AND fulfilled_at IS NULL), 0)
          )::text AS total
        `);

        // Drizzle execute returns rows in result.rows for pg driver
        const rows = (result as any).rows ?? result;
        const total = parseInt((rows[0] as any)?.total ?? "0", 10);

        if (total >= MAX_CLIPS_PER_DEVICE) {
          quotaExceeded = true;
          return; // abort transaction cleanly — no intent inserted
        }

        await tx.insert(dashcamUploadIntentsTable).values({
          deviceId,
          clipId,
          fileKey:   key,
          expiresAt,
        });
      },
      { isolationLevel: "serializable" }
    );
  } catch (err: any) {
    // PostgreSQL serialization failure — another concurrent request won the race
    if (err?.code === "40001") {
      return res.status(429).json({
        error: "Concurrent upload in progress — retry in a moment",
      });
    }
    logger.error({ err }, "dashcam: upload-url transaction failed");
    return res.status(500).json({ error: "Failed to reserve upload slot" });
  }

  if (quotaExceeded) {
    return res.status(429).json({
      error: `Cloud storage full (${MAX_CLIPS_PER_DEVICE} clips). Delete old clips in the dashcam gallery to free up space.`,
      code:  "QUOTA_FULL",
    });
  }

  try {
    const uploadUrl = await getPresignedUploadUrl(key);
    logger.info({ deviceId, clipId, lockReason }, "dashcam: issued upload URL with intent");
    return res.json({ uploadUrl, fileKey: key, clipId });
  } catch (err) {
    // Intent was created but URL generation failed — clean up intent so quota isn't consumed
    db.delete(dashcamUploadIntentsTable)
      .where(eq(dashcamUploadIntentsTable.clipId, clipId))
      .catch(() => {});
    logger.error({ err }, "dashcam: presigned URL generation failed");
    return res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * POST /api/dashcam/clip
 * Finalises an upload. Validates that clipId and fileKey match an outstanding
 * (unexpired, unfulfilled) intent, marks it fulfilled, and saves clip metadata.
 */
router.post("/dashcam/clip", async (req: Request, res: Response) => {
  const auth = extractAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "X-Device-Id and X-Dashcam-Secret headers are required" });
  }

  const { deviceId, secret } = auth;
  const secretHash = computeSecretHash(deviceId, secret);

  if (!(await isDeviceRegistered(deviceId, secretHash))) {
    return res.status(403).json({ error: "Device not enrolled" });
  }

  const {
    clipId, fileKey, durationS, sizeBytes, lockReason,
    startedAt, lat, lng, speedKmh,
  } = req.body ?? {};

  if (!clipId) return res.status(400).json({ error: "clipId is required" });
  if (!fileKey) return res.status(400).json({ error: "fileKey is required" });

  // Anti-spoofing: key must be scoped to this device's prefix
  if (!fileKey.startsWith(`dashcam/${deviceId}/`)) {
    return res.status(403).json({ error: "fileKey does not belong to this device" });
  }

  // Validate that this clipId came from an issued upload-url intent
  const now = new Date();
  const [intent] = await db
    .select()
    .from(dashcamUploadIntentsTable)
    .where(
      and(
        eq(dashcamUploadIntentsTable.clipId, clipId),
        eq(dashcamUploadIntentsTable.deviceId, deviceId),
        gt(dashcamUploadIntentsTable.expiresAt, now),
        isNull(dashcamUploadIntentsTable.fulfilledAt)
      )
    )
    .limit(1);

  if (!intent) {
    return res.status(403).json({
      error: "No valid upload intent for this clipId — obtain a presigned URL first",
    });
  }

  if (intent.fileKey !== fileKey) {
    return res.status(403).json({ error: "fileKey does not match the issued upload intent" });
  }

  try {
    const [row] = await db
      .insert(dashcamClipsTable)
      .values({
        id:               clipId,
        deviceId,
        fileKey,
        durationS:        durationS ?? null,
        sizeBytes:        sizeBytes ?? null,
        locked:           true,
        lockReason:       lockReason ?? "manual",
        startedAt:        startedAt ? new Date(startedAt) : new Date(),
        uploadedAt:       new Date(),
        lat:              lat ?? null,
        lng:              lng ?? null,
        speedKmh:         speedKmh ?? null,
        deviceSecretHash: secretHash,
      })
      .returning();

    await db
      .update(dashcamUploadIntentsTable)
      .set({ fulfilledAt: new Date() })
      .where(eq(dashcamUploadIntentsTable.id, intent.id));

    logger.info({ deviceId, clipId: row.id }, "dashcam: clip metadata saved");
    return res.status(201).json({ id: row.id });
  } catch (err) {
    logger.error({ err }, "dashcam: failed to save clip metadata");
    return res.status(500).json({ error: "Failed to save clip metadata" });
  }
});

/**
 * GET /api/dashcam/clips
 */
router.get("/dashcam/clips", async (req: Request, res: Response) => {
  const auth = extractAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "X-Device-Id and X-Dashcam-Secret headers are required" });
  }

  const { deviceId, secret } = auth;
  const secretHash = computeSecretHash(deviceId, secret);

  try {
    const rows = await db
      .select()
      .from(dashcamClipsTable)
      .where(
        and(
          eq(dashcamClipsTable.deviceId, deviceId),
          eq(dashcamClipsTable.deviceSecretHash, secretHash)
        )
      )
      .orderBy(desc(dashcamClipsTable.startedAt))
      .limit(50);

    return res.json({ clips: rows });
  } catch (err) {
    logger.error({ err }, "dashcam: failed to fetch clips");
    return res.status(500).json({ error: "Failed to fetch clips" });
  }
});

/**
 * GET /api/dashcam/clip/:id/url
 */
router.get("/dashcam/clip/:id/url", async (req: Request, res: Response) => {
  if (!isR2Configured()) {
    return res.status(503).json({ error: "Cloud storage not configured" });
  }

  const auth = extractAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "X-Device-Id and X-Dashcam-Secret headers are required" });
  }

  const { deviceId, secret } = auth;
  const secretHash = computeSecretHash(deviceId, secret);
  const { id }     = req.params as { id: string };

  try {
    const clip = await findOwnedClip(id, deviceId, secretHash);
    if (!clip) return res.status(404).json({ error: "Clip not found or access denied" });

    const downloadUrl = await getPresignedDownloadUrl(clip.fileKey);
    return res.json({ downloadUrl, expiresIn: 3600 });
  } catch (err) {
    logger.error({ err }, "dashcam: failed to generate download URL");
    return res.status(500).json({ error: "Failed to generate download URL" });
  }
});

/**
 * DELETE /api/dashcam/clip/:id
 */
router.delete("/dashcam/clip/:id", async (req: Request, res: Response) => {
  const auth = extractAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "X-Device-Id and X-Dashcam-Secret headers are required" });
  }

  const { deviceId, secret } = auth;
  const secretHash = computeSecretHash(deviceId, secret);
  const { id }     = req.params as { id: string };

  try {
    const clip = await findOwnedClip(id, deviceId, secretHash);
    if (!clip) return res.status(404).json({ error: "Clip not found or access denied" });

    if (isR2Configured()) {
      deleteObject(clip.fileKey).catch((err) =>
        logger.warn({ err, key: clip.fileKey }, "dashcam: R2 delete failed")
      );
    }

    await db.delete(dashcamClipsTable).where(eq(dashcamClipsTable.id, id));
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "dashcam: failed to delete clip");
    return res.status(500).json({ error: "Failed to delete clip" });
  }
});

export default router;
