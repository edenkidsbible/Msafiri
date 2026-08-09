/**
 * dashcam.ts — API routes for the Msafiri dashcam feature.
 *
 * Device enrollment model:
 * ──────────────────────────────────────────────────────────
 * POST /dashcam/register auto-enrolls any device that presents a valid
 * X-Device-Id + X-Dashcam-Secret pair, subject to an IP-backed rate limit.
 *
 * Cloud retention policy:
 * ──────────────────────────────────────────────────────────
 * Every uploaded clip gets an expires_at timestamp:
 *   • Manual lock  (lockReason = "manual")            → 30 days from recording
 *   • Auto lock    (anything else)                    → 24 hours from recording
 *   • Pinned clip  (POST /dashcam/clip/:id/pin)       → 60 days from recording
 *   • Unpin        (DELETE /dashcam/clip/:id/pin)     → restored to original window
 *
 * An hourly job deletes R2 objects + DB rows where expires_at < NOW() and
 * pinned = FALSE.  Drivers can pin up to MAX_PINS_PER_DEVICE (5) clips at once.
 *
 * Routes:
 *   POST   /api/dashcam/register         → auto-enroll device
 *   POST   /api/dashcam/upload-url       → presigned R2 PUT URL + intent
 *   POST   /api/dashcam/clip             → finalize upload
 *   GET    /api/dashcam/clips            → list clips for a device
 *   GET    /api/dashcam/clip/:id/url     → presigned GET URL (playback/download)
 *   DELETE /api/dashcam/clip/:id         → delete clip from R2 + DB
 *   POST   /api/dashcam/clip/:id/pin     → pin a clip (extends to 60 days)
 *   DELETE /api/dashcam/clip/:id/pin     → unpin a clip (restores base expiry)
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
import { eq, and, desc, sql, gt, isNull, lt, count } from "drizzle-orm";
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
const MAX_PINS_PER_DEVICE     = 5;
const INTENT_TTL_MS           = 30 * 60 * 1_000; // 30 minutes

// Cloud retention windows (ms from recording date)
const RETAIN_MANUAL_MS = 30 * 24 * 60 * 60 * 1_000; // 30 days
const RETAIN_AUTO_MS   =      24 * 60 * 60 * 1_000; // 24 hours
const RETAIN_PINNED_MS = 60 * 24 * 60 * 60 * 1_000; // 60 days

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
 * Compute the cloud expiry timestamp for a clip.
 * - "manual" lockReason → 30 days from recording start
 * - anything else       → 24 hours from recording start
 */
function computeExpiresAt(lockReason: string | null, startedAt: Date): Date {
  const retainMs = lockReason === "manual" ? RETAIN_MANUAL_MS : RETAIN_AUTO_MS;
  return new Date(startedAt.getTime() + retainMs);
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

// ── Background cleanup: expire stale intents ──────────────────────────────────

async function expireStaleRows() {
  try {
    await db.execute(sql`
      DELETE FROM dashcam_upload_intents
      WHERE expires_at < NOW() AND fulfilled_at IS NULL
    `);
  } catch (err) {
    logger.warn({ err }, "dashcam: stale intent cleanup failed");
  }
}

setInterval(expireStaleRows, 5 * 60_000);

// ── Hourly auto-deletion of expired cloud clips ────────────────────────────────
//
// Deletes R2 objects + DB rows for clips where:
//   • expires_at < NOW()    (past their retention window)
//   • pinned = FALSE        (pinned clips have extended retention)
//
// Pinned clips always have an expires_at set to startedAt + 60 days,
// so they are still cleaned up — just later than the base window.

async function deleteExpiredClips() {
  try {
    const now = new Date();
    const expired = await db
      .select({ id: dashcamClipsTable.id, fileKey: dashcamClipsTable.fileKey })
      .from(dashcamClipsTable)
      .where(
        and(
          lt(dashcamClipsTable.expiresAt, now),
          eq(dashcamClipsTable.pinned, false)
        )
      );

    if (expired.length === 0) return;

    for (const clip of expired) {
      // Fire-and-forget R2 deletion — DB row is the source of truth
      if (isR2Configured()) {
        deleteObject(clip.fileKey).catch((err) =>
          logger.warn({ err, key: clip.fileKey }, "dashcam: expired clip R2 delete failed")
        );
      }
      await db.delete(dashcamClipsTable).where(eq(dashcamClipsTable.id, clip.id));
    }

    logger.info({ count: expired.length }, "dashcam: auto-deleted expired clips");
  } catch (err) {
    logger.warn({ err }, "dashcam: expired clip cleanup failed");
  }
}

// Run once on startup (catches anything that expired while server was down),
// then every hour thereafter.
setTimeout(deleteExpiredClips, 30_000);
setInterval(deleteExpiredClips, 60 * 60_000);

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/dashcam/register
 */
router.post("/dashcam/register", async (req: Request, res: Response) => {
  const auth = extractAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "X-Device-Id and X-Dashcam-Secret headers are required" });
  }

  const { deviceId, secret } = auth;
  const secretHash = computeSecretHash(deviceId, secret);

  try {
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
 * Issues a presigned R2 PUT URL and atomically reserves quota.
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

        const rows = (result as any).rows ?? result;
        const total = parseInt((rows[0] as any)?.total ?? "0", 10);

        if (total >= MAX_CLIPS_PER_DEVICE) {
          quotaExceeded = true;
          return;
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
      error: `Cloud storage full (${MAX_CLIPS_PER_DEVICE} clips). Delete old clips to free up space.`,
      code:  "QUOTA_FULL",
    });
  }

  try {
    const uploadUrl = await getPresignedUploadUrl(key);
    logger.info({ deviceId, clipId, lockReason }, "dashcam: issued upload URL");
    return res.json({ uploadUrl, fileKey: key, clipId });
  } catch (err) {
    db.delete(dashcamUploadIntentsTable)
      .where(eq(dashcamUploadIntentsTable.clipId, clipId))
      .catch(() => {});
    logger.error({ err }, "dashcam: presigned URL generation failed");
    return res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * POST /api/dashcam/clip
 *
 * Finalises an upload. Sets expires_at based on lockReason.
 *   manual → startedAt + 30 days
 *   auto   → startedAt + 24 hours
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

  if (!fileKey.startsWith(`dashcam/${deviceId}/`)) {
    return res.status(403).json({ error: "fileKey does not belong to this device" });
  }

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
    const recordingStart = startedAt ? new Date(startedAt) : new Date();
    const clipExpiresAt  = computeExpiresAt(lockReason ?? null, recordingStart);

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
        startedAt:        recordingStart,
        uploadedAt:       new Date(),
        lat:              lat ?? null,
        lng:              lng ?? null,
        speedKmh:         speedKmh ?? null,
        deviceSecretHash: secretHash,
        pinned:           false,
        expiresAt:        clipExpiresAt,
      })
      .returning();

    await db
      .update(dashcamUploadIntentsTable)
      .set({ fulfilledAt: new Date() })
      .where(eq(dashcamUploadIntentsTable.id, intent.id));

    logger.info(
      { deviceId, clipId: row.id, lockReason, expiresAt: clipExpiresAt },
      "dashcam: clip metadata saved"
    );
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

/**
 * POST /api/dashcam/clip/:id/pin
 *
 * Pins a clip, extending its cloud retention to 60 days from recording date.
 * A device can have at most MAX_PINS_PER_DEVICE (5) pinned clips at once.
 */
router.post("/dashcam/clip/:id/pin", async (req: Request, res: Response) => {
  const auth = extractAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const { deviceId, secret } = auth;
  const secretHash = computeSecretHash(deviceId, secret);
  const { id }     = req.params as { id: string };

  try {
    const clip = await findOwnedClip(id, deviceId, secretHash);
    if (!clip) return res.status(404).json({ error: "Clip not found or access denied" });

    if (clip.pinned) return res.json({ ok: true }); // already pinned — idempotent

    // Count existing pins for this device
    const [{ pinCount }] = await db
      .select({ pinCount: count() })
      .from(dashcamClipsTable)
      .where(
        and(
          eq(dashcamClipsTable.deviceId, deviceId),
          eq(dashcamClipsTable.pinned, true)
        )
      );

    if (Number(pinCount) >= MAX_PINS_PER_DEVICE) {
      return res.status(429).json({
        error: `Pin limit reached (${MAX_PINS_PER_DEVICE} max). Unpin a clip to pin this one.`,
        code:  "PIN_LIMIT",
      });
    }

    // Extend expiry to 60 days from recording date
    const pinnedExpiresAt = new Date(clip.startedAt.getTime() + RETAIN_PINNED_MS);

    await db
      .update(dashcamClipsTable)
      .set({ pinned: true, expiresAt: pinnedExpiresAt })
      .where(eq(dashcamClipsTable.id, id));

    logger.info({ deviceId, clipId: id, expiresAt: pinnedExpiresAt }, "dashcam: clip pinned");
    return res.json({ ok: true, expiresAt: pinnedExpiresAt });
  } catch (err) {
    logger.error({ err }, "dashcam: failed to pin clip");
    return res.status(500).json({ error: "Failed to pin clip" });
  }
});

/**
 * DELETE /api/dashcam/clip/:id/pin
 *
 * Unpins a clip, restoring its standard expiry window based on lockReason.
 */
router.delete("/dashcam/clip/:id/pin", async (req: Request, res: Response) => {
  const auth = extractAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const { deviceId, secret } = auth;
  const secretHash = computeSecretHash(deviceId, secret);
  const { id }     = req.params as { id: string };

  try {
    const clip = await findOwnedClip(id, deviceId, secretHash);
    if (!clip) return res.status(404).json({ error: "Clip not found or access denied" });

    if (!clip.pinned) return res.json({ ok: true }); // already unpinned — idempotent

    // Restore base expiry from lockReason
    const restoredExpiresAt = computeExpiresAt(clip.lockReason, clip.startedAt);

    await db
      .update(dashcamClipsTable)
      .set({ pinned: false, expiresAt: restoredExpiresAt })
      .where(eq(dashcamClipsTable.id, id));

    logger.info({ deviceId, clipId: id, expiresAt: restoredExpiresAt }, "dashcam: clip unpinned");
    return res.json({ ok: true, expiresAt: restoredExpiresAt });
  } catch (err) {
    logger.error({ err }, "dashcam: failed to unpin clip");
    return res.status(500).json({ error: "Failed to unpin clip" });
  }
});

export default router;
