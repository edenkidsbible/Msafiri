import { Router, type Request, type Response } from "express";
import {
  blockedDevicesTable,
  db,
  roadChannelUpdatesTable,
  roadChannelUserReportsTable,
  roadChannelVoiceReportsTable,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { logAudit } from "../../lib/audit.js";
import type { AdminJwtPayload } from "../../middleware/adminAuth.js";
import { requireFeature } from "../../middleware/adminAuth.js";
import { deleteObject, getPresignedDownloadUrl } from "../../lib/r2Storage.js";

const router = Router();

type ModerationAction = "approve" | "hide" | "remove";

function actorFor(req: Request): AdminJwtPayload {
  return req.adminUser as AdminJwtPayload;
}

// This router intentionally operates only on the Road Channels contribution
// tables. It never changes a linked community report: ordinary incident report
// moderation remains in the separate reports admin surface.
router.get("/road-channels/moderation", requireFeature("road_channels"), async (req: Request, res: Response) => {
  try {
    const [voices, reportCounts, blocked] = await Promise.all([
      db.select().from(roadChannelVoiceReportsTable).orderBy(desc(roadChannelVoiceReportsTable.createdAt)).limit(200),
      db.select({
        voiceReportId: roadChannelUpdatesTable.voiceReportId,
        reportCount: sql<number>`count(${roadChannelUserReportsTable.id})::int`,
      })
        .from(roadChannelUpdatesTable)
        .leftJoin(roadChannelUserReportsTable, eq(roadChannelUserReportsTable.updateId, roadChannelUpdatesTable.id))
        .where(sql`${roadChannelUpdatesTable.voiceReportId} is not null`)
        .groupBy(roadChannelUpdatesTable.voiceReportId),
      db.select().from(blockedDevicesTable).orderBy(desc(blockedDevicesTable.createdAt)),
    ]);
    const reportsByVoice = new Map(reportCounts.map((row) => [row.voiceReportId, row.reportCount]));
    const blockedIds = new Set(blocked.map((row) => row.deviceId));
    const records = await Promise.all(voices.map(async (voice) => ({
      id: voice.id,
      channel: voice.channel,
      deviceId: voice.deviceId,
      contentType: voice.contentType,
      sizeBytes: voice.sizeBytes,
      lat: voice.lat,
      lng: voice.lng,
      transcript: voice.transcript,
      summary: voice.summary,
      proposedType: voice.proposedType,
      durationMs: voice.durationMs,
      status: voice.status,
      moderationStatus: voice.moderationStatus,
      moderationReason: voice.moderationReason,
      createdAt: voice.createdAt.toISOString(),
      confirmedAt: voice.confirmedAt?.toISOString() ?? null,
      reportCount: reportsByVoice.get(voice.id) ?? 0,
      deviceBlocked: blockedIds.has(voice.deviceId),
      // Never expose object keys. This short-lived URL is only returned to
      // authenticated admins who have the Road Channels moderation grant.
      playbackUrl: voice.expiresAt && voice.expiresAt > new Date()
        ? await getPresignedDownloadUrl(
            voice.objectKey,
            Math.floor((voice.expiresAt.getTime() - Date.now()) / 1000),
          )
        : null,
    })));
    return res.json({
      records,
      blockedDevices: blocked.map((row) => ({
        deviceId: row.deviceId,
        reason: row.reason,
        blockedBy: row.blockedBy,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Could not list Road Channels moderation records");
    return res.status(500).json({ error: "Could not load Road Channels moderation records" });
  }
});

router.patch("/road-channels/moderation/:id", requireFeature("road_channels"), async (req: Request, res: Response) => {
  try {
    const { action, reason } = req.body as { action?: unknown; reason?: unknown };
    if (action !== "approve" && action !== "hide" && action !== "remove") {
      return res.status(400).json({ error: "action must be approve, hide, or remove" });
    }
    if (reason !== undefined && (typeof reason !== "string" || reason.length > 500)) {
      return res.status(400).json({ error: "reason must be a string of 500 characters or fewer" });
    }
    const id = req.params.id as string;
    const [voice] = await db.select().from(roadChannelVoiceReportsTable).where(eq(roadChannelVoiceReportsTable.id, id));
    if (!voice) return res.status(404).json({ error: "Road Channels voice report not found" });
    const actor = actorFor(req);
    const moderationReason = typeof reason === "string" && reason.trim() ? reason.trim() : null;

    if (action === "remove") {
      const updates = await db.select({ id: roadChannelUpdatesTable.id }).from(roadChannelUpdatesTable)
        .where(eq(roadChannelUpdatesTable.voiceReportId, voice.id));
      const updateIds = updates.map((update) => update.id);
      // Delete the private source object before deleting its database pointer,
      // so a storage failure never leaves an unmoderatable orphan behind.
      await deleteObject(voice.objectKey);
      if (updateIds.length) {
        await db.delete(roadChannelUserReportsTable).where(inArray(roadChannelUserReportsTable.updateId, updateIds));
      }
      await db.delete(roadChannelUpdatesTable).where(eq(roadChannelUpdatesTable.voiceReportId, voice.id));
      await db.delete(roadChannelVoiceReportsTable).where(eq(roadChannelVoiceReportsTable.id, voice.id));
      await logAudit({
        actor,
        action: "road_channel.voice.remove",
        targetType: "road_channel_voice_report",
        targetId: voice.id,
        details: { channel: voice.channel, deviceId: voice.deviceId, reportCount: updateIds.length },
      });
      return res.json({ success: true, action });
    }

    const moderationStatus = action === "approve" ? "approved" : "hidden";
    await db.update(roadChannelVoiceReportsTable).set({
      moderationStatus,
      moderationReason,
    }).where(eq(roadChannelVoiceReportsTable.id, voice.id));
    await logAudit({
      actor,
      action: `road_channel.voice.${action}`,
      targetType: "road_channel_voice_report",
      targetId: voice.id,
      details: { channel: voice.channel, deviceId: voice.deviceId, reason: moderationReason },
    });
    return res.json({ success: true, action, moderationStatus });
  } catch (err) {
    req.log.error({ err }, "Could not moderate Road Channels voice report");
    return res.status(500).json({ error: "Could not moderate Road Channels voice report" });
  }
});

router.post("/road-channels/blocked-devices", requireFeature("road_channels"), async (req: Request, res: Response) => {
  try {
    const { deviceId, reason } = req.body as { deviceId?: unknown; reason?: unknown };
    if (typeof deviceId !== "string" || !deviceId.trim()) return res.status(400).json({ error: "deviceId is required" });
    if (reason !== undefined && (typeof reason !== "string" || reason.length > 500)) {
      return res.status(400).json({ error: "reason must be a string of 500 characters or fewer" });
    }
    const actor = actorFor(req);
    const [blocked] = await db.insert(blockedDevicesTable).values({
      deviceId: deviceId.trim(),
      reason: typeof reason === "string" && reason.trim() ? reason.trim() : null,
      blockedBy: actor.name,
    }).onConflictDoUpdate({
      target: blockedDevicesTable.deviceId,
      set: { reason: typeof reason === "string" && reason.trim() ? reason.trim() : null, blockedBy: actor.name },
    }).returning();
    await logAudit({
      actor,
      action: "road_channel.device.block",
      targetType: "device",
      targetId: blocked.deviceId,
      details: { reason: blocked.reason },
    });
    return res.status(201).json({ deviceId: blocked.deviceId, reason: blocked.reason, blockedBy: blocked.blockedBy, createdAt: blocked.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Could not block Road Channels contributor device");
    return res.status(500).json({ error: "Could not block contributor device" });
  }
});

router.delete("/road-channels/blocked-devices/:deviceId", requireFeature("road_channels"), async (req: Request, res: Response) => {
  try {
    const deviceId = req.params.deviceId as string;
    const [existing] = await db.select().from(blockedDevicesTable).where(eq(blockedDevicesTable.deviceId, deviceId));
    if (!existing) return res.status(404).json({ error: "Blocked device not found" });
    await db.delete(blockedDevicesTable).where(and(eq(blockedDevicesTable.deviceId, deviceId)));
    await logAudit({ actor: actorFor(req), action: "road_channel.device.unblock", targetType: "device", targetId: deviceId });
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Could not unblock Road Channels contributor device");
    return res.status(500).json({ error: "Could not unblock contributor device" });
  }
});

export default router;