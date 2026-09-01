import { Router, type Request, type Response } from "express";
import { and, count, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import {
  appSettingsTable, blockedDevicesTable, communityReportsTable, db, roadChannelPresenceTable,
  roadChannelUpdatesTable, roadChannelUserReportsTable, roadChannelVoiceReportsTable,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { ensureCompatibleFormat, speechToText } from "@workspace/integrations-openai-ai-server/audio";
import { createCommunityReport, TTL_SECONDS } from "./reports.js";
import {
  downloadAsBuffer, getPresignedDownloadUrl, getPresignedUploadUrl, headObject, isR2Configured,
} from "../lib/r2Storage.js";
import { logger } from "../lib/logger.js";
import {
  nearbyPilotCorridors, PILOT_CORRIDORS, pilotDirection, resolvePilotCorridor,
} from "../lib/roadChannelPilot.js";

const router = Router();
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const PRESENCE_TTL_MS = 5 * 60 * 1000;
const ALLOWED_AUDIO_TYPES = new Set(["audio/mpeg", "audio/mp4", "audio/m4a", "audio/wav", "audio/webm", "audio/ogg"]);
const ALLOWED_REPORT_TYPES = new Set(Object.keys(TTL_SECONDS));
const TERMS_VERSION = "road-channels-pilot-v1";
const AUDIO_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CATEGORY_TO_TYPE: Record<string, string> = {
  traffic: "traffic",
  accident: "accident",
  police_checkpoint: "police",
  roadworks: "roadworks",
  hazard: "hazard",
  speed_camera: "camera",
  flooding: "weather",
  breakdown: "breakdown",
};
const PROFANITY_PATTERN = /\b(fuck|shit|bitch|asshole|cunt)\b/i;

const requestWindows = new Map<string, number[]>();

function channelFor(value: unknown): string | null {
  return resolvePilotCorridor(value)?.id ?? null;
}
function channelName(channel: string): string {
  return resolvePilotCorridor(channel)?.name ?? channel;
}
function validDevice(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 200;
}
function validCoordinates(lat: unknown, lng: unknown): lat is number {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -5.1 && lat <= 5.3 && lng >= 33.5 && lng <= 42.1;
}
function permit(deviceId: string, action: string, max: number, ms = 60_000): boolean {
  const key = `${action}:${deviceId}`, now = Date.now();
  const kept = (requestWindows.get(key) ?? []).filter((at) => at > now - ms);
  if (kept.length >= max) return false;
  kept.push(now); requestWindows.set(key, kept);
  return true;
}
async function blocked(deviceId: string): Promise<boolean> {
  const [row] = await db.select({ id: blockedDevicesTable.deviceId }).from(blockedDevicesTable)
    .where(eq(blockedDevicesTable.deviceId, deviceId));
  return !!row;
}
async function enabled(): Promise<boolean> {
  const [row] = await db.select({ value: appSettingsTable.roadChannelsEnabled })
    .from(appSettingsTable).where(eq(appSettingsTable.id, "singleton"));
  return row?.value ?? true;
}
async function requireEnabled(res: Response): Promise<boolean> {
  if (await enabled()) return true;
  res.status(503).json({ error: "Road Channels pilot is not enabled" });
  return false;
}
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}
function decodeCursor(value: unknown): Date | null {
  if (typeof value !== "string" || value.length > 300) return null;
  try {
    const [iso] = Buffer.from(value, "base64url").toString("utf8").split("|");
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}
async function activeMember(channel: string, deviceId: string): Promise<boolean> {
  const [row] = await db.select({ lastSeenAt: roadChannelPresenceTable.lastSeenAt })
    .from(roadChannelPresenceTable)
    .where(and(
      eq(roadChannelPresenceTable.channel, channel),
      eq(roadChannelPresenceTable.deviceId, deviceId),
      gt(roadChannelPresenceTable.lastSeenAt, new Date(Date.now() - PRESENCE_TTL_MS)),
    ));
  return !!row;
}
async function refreshPresence(
  channel: string,
  deviceId: string,
  lat: number,
  lng: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Serialize all channel switches for one device. This closes the
    // delete/insert interleaving race without exposing a global lock.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${deviceId}))`);
    await tx.delete(roadChannelPresenceTable).where(and(
      eq(roadChannelPresenceTable.deviceId, deviceId),
      ne(roadChannelPresenceTable.channel, channel),
    ));
    await tx.insert(roadChannelPresenceTable).values({
      channel, deviceId, lat, lng, lastSeenAt: new Date(),
    }).onConflictDoUpdate({
      target: [roadChannelPresenceTable.channel, roadChannelPresenceTable.deviceId],
      // Preserve muted and joinedAt while refreshing location/lease fields.
      set: { lat, lng, lastSeenAt: new Date() },
    });
  });
}
function voiceKey(deviceId: string, id: string): string {
  // Encoded device id prevents path separator/prefix tricks while preserving ownership.
  return `road-channels/${encodeURIComponent(deviceId)}/${id}.audio`;
}

router.get("/road-channels", async (_req, res) => {
  if (!await requireEnabled(res)) return;
  res.json({ enabled: true, channels: PILOT_CORRIDORS.map((corridor) => corridor.id) });
});

router.get("/road-channels/discovery", async (req, res) => {
  if (!await requireEnabled(res)) return;
  const requestedRoads = Array.isArray(req.query.roadName)
    ? req.query.roadName
    : [req.query.roadName];
  const namedChannels = [...new Set(requestedRoads.map(channelFor).filter((id): id is string => !!id))];
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const requestedRadius = Number(req.query.radiusM);
  const radiusM = Number.isFinite(requestedRadius)
    ? Math.max(100, Math.min(5_000, requestedRadius))
    : 5_000;
  const nearby = Number.isFinite(lat) && Number.isFinite(lng)
    ? nearbyPilotCorridors(lat, lng, radiusM)
    : [];
  const distanceByChannel = new Map(nearby.map(({ corridor, distanceM }) => [corridor.id, distanceM]));
  const channels = [...new Set([
    ...namedChannels,
    ...nearby.map(({ corridor }) => corridor.id),
  ])];
  if (channels.length === 0) return res.json({ channels: [] });
  const presenceRows = await db.select({
    channel: roadChannelPresenceTable.channel,
    value: count(),
  }).from(roadChannelPresenceTable)
    .where(and(
      inArray(roadChannelPresenceTable.channel, channels),
      gt(roadChannelPresenceTable.lastSeenAt, new Date(Date.now() - PRESENCE_TTL_MS)),
    ))
    .groupBy(roadChannelPresenceTable.channel);
  const presenceByChannel = new Map(presenceRows.map((row) => [row.channel, Number(row.value)]));
  return res.json({
    channels: channels.map((channel, index) => {
      const corridor = resolvePilotCorridor(channel)!;
      return {
        id: channel,
        name: `${channelName(channel)} Channel`,
        road: channelName(channel),
        direction: pilotDirection(corridor, Number(req.query.heading)),
        memberCount: presenceByChannel.get(channel) ?? 0,
        nearby: distanceByChannel.has(channel),
        distanceM: distanceByChannel.has(channel)
          ? Math.round(distanceByChannel.get(channel)!)
          : null,
      };
    }),
  });
});

router.post("/road-channels/presence", async (req: Request, res: Response) => {
  if (!await requireEnabled(res)) return;
  const { deviceId, location, channelId } = req.body as {
    deviceId?: unknown;
    location?: { latitude?: unknown; longitude?: unknown };
    channelId?: unknown;
  };
  const channel = channelFor(channelId);
  const lat = location?.latitude, lng = location?.longitude;
  if (!channel) return res.status(404).json({ error: "Unsupported road channel" });
  if (!validDevice(deviceId) || !validCoordinates(lat, lng)) return res.status(400).json({ error: "Valid deviceId and location required" });
  if (!permit(deviceId, "presence", 20) || await blocked(deviceId)) return res.status(403).json({ error: "Device is not permitted to update presence" });
  await refreshPresence(channel, deviceId, lat, lng as number);
  return res.status(204).end();
});

router.post("/road-channels/:channel/presence", async (req: Request, res: Response) => {
  if (!await requireEnabled(res)) return;
  const channel = channelFor(req.params.channel);
  const { deviceId, lat, lng } = req.body as Record<string, unknown>;
  if (!channel) return res.status(404).json({ error: "Unsupported road channel" });
  if (!validDevice(deviceId) || !validCoordinates(lat, lng)) return res.status(400).json({ error: "Valid deviceId, lat and lng required" });
  if (!permit(deviceId, "presence", 20) || await blocked(deviceId)) return res.status(403).json({ error: "Device is not permitted to update presence" });
  const latitude = lat as number, longitude = lng as number;
  await refreshPresence(channel, deviceId, latitude, longitude);
  return res.status(204).end();
});

router.post("/road-channels/:channel/leave", async (req: Request, res: Response) => {
  if (!await requireEnabled(res)) return;
  const channel = channelFor(req.params.channel);
  const { deviceId } = req.body as { deviceId?: unknown };
  if (!channel || !validDevice(deviceId)) return res.status(400).json({ error: "Valid channel and deviceId required" });
  await db.delete(roadChannelPresenceTable).where(and(
    eq(roadChannelPresenceTable.channel, channel),
    eq(roadChannelPresenceTable.deviceId, deviceId),
  ));
  return res.status(204).end();
});

router.post("/road-channels/:channel/mute", async (req: Request, res: Response) => {
  if (!await requireEnabled(res)) return;
  const channel = channelFor(req.params.channel);
  const { deviceId, muted } = req.body as { deviceId?: unknown; muted?: unknown };
  if (!channel || !validDevice(deviceId) || typeof muted !== "boolean") {
    return res.status(400).json({ error: "Valid channel, deviceId and muted state required" });
  }
  if (!await activeMember(channel, deviceId)) return res.status(403).json({ error: "Join this channel first" });
  await db.update(roadChannelPresenceTable).set({ muted })
    .where(and(eq(roadChannelPresenceTable.channel, channel), eq(roadChannelPresenceTable.deviceId, deviceId)));
  return res.status(204).end();
});

router.get("/road-channels/:channel/presence", async (req, res) => {
  if (!await requireEnabled(res)) return;
  const channel = channelFor(req.params.channel);
  if (!channel) return res.status(404).json({ error: "Unsupported road channel" });
  const rows = await db.select({ direction: roadChannelPresenceTable.direction, muted: roadChannelPresenceTable.muted })
    .from(roadChannelPresenceTable).where(and(eq(roadChannelPresenceTable.channel, channel), gt(roadChannelPresenceTable.lastSeenAt, new Date(Date.now() - PRESENCE_TTL_MS))));
  const directions = rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.direction] = (counts[row.direction] ?? 0) + 1;
    return counts;
  }, {});
  return res.json({ channel, activeCount: rows.length, mutedCount: rows.filter((row) => row.muted).length, directions });
});

router.get("/road-channels/:channel/feed", async (req, res) => {
  if (!await requireEnabled(res)) return;
  const channel = channelFor(req.params.channel);
  const deviceId = req.query.deviceId;
  if (!channel) return res.status(404).json({ error: "Unsupported road channel" });
  if (!validDevice(deviceId) || !await activeMember(channel, deviceId)) {
    return res.status(403).json({ error: "Join this active road channel before fetching updates" });
  }
  const cursorAt = decodeCursor(req.query.cursor);
  const rows = await db.select().from(roadChannelUpdatesTable)
    .where(and(
      eq(roadChannelUpdatesTable.channel, channel),
      ...(cursorAt ? [gt(roadChannelUpdatesTable.createdAt, cursorAt)] : []),
    ))
    .orderBy(desc(roadChannelUpdatesTable.createdAt)).limit(50);
  rows.reverse();
  const voiceIds = rows.map((row) => row.voiceReportId).filter((id): id is string => !!id);
  const voices = voiceIds.length > 0
    ? await db.select().from(roadChannelVoiceReportsTable)
        .where(inArray(roadChannelVoiceReportsTable.id, voiceIds))
    : [];
  const voiceById = new Map(voices.map((voice) => [voice.id, voice]));
  const updates = await Promise.all(rows.flatMap((row) => {
    const voice = row.voiceReportId ? voiceById.get(row.voiceReportId) : null;
    if (!voice || voice.moderationStatus !== "approved" || voice.status !== "confirmed"
      || !voice.expiresAt || voice.expiresAt <= new Date()) return [];
    const remainingSeconds = Math.floor((voice.expiresAt.getTime() - Date.now()) / 1000);
    return [Promise.resolve(getPresignedDownloadUrl(voice.objectKey, remainingSeconds)).then((audioUrl) => ({
      id: row.id,
      kind: row.kind,
      type: voice.proposedType,
      summary: voice.summary,
      road: channelName(row.channel),
      reportId: row.reportId,
      audioUrl,
      createdAt: row.createdAt.toISOString(),
    }))];
  }));
  const nextCursor = rows.length > 0
    ? encodeCursor(rows[rows.length - 1]!.createdAt, rows[rows.length - 1]!.id)
    : (typeof req.query.cursor === "string" ? req.query.cursor : null);
  return res.json({ channel, items: updates, updates, nextCursor });
});

router.post("/road-channels/:channel/updates/:updateId/report", async (req: Request, res: Response) => {
  if (!await requireEnabled(res)) return;
  const channel = channelFor(req.params.channel);
  const { deviceId, reason } = req.body as { deviceId?: unknown; reason?: unknown };
  if (!channel || !validDevice(deviceId) || typeof reason !== "string" || reason.trim().length < 3 || reason.length > 280) {
    return res.status(400).json({ error: "Valid channel, deviceId and reason required" });
  }
  if (!await activeMember(channel, deviceId)) return res.status(403).json({ error: "Join this channel first" });
  const updateId = req.params.updateId as string;
  const [update] = await db.select({ id: roadChannelUpdatesTable.id }).from(roadChannelUpdatesTable)
    .where(and(eq(roadChannelUpdatesTable.id, updateId), eq(roadChannelUpdatesTable.channel, channel)));
  if (!update) return res.status(404).json({ error: "Channel update not found" });
  try {
    await db.insert(roadChannelUserReportsTable).values({
      updateId: update.id,
      reporterDeviceId: deviceId,
      reason: reason.trim(),
    });
  } catch {
    return res.status(409).json({ error: "You already reported this update" });
  }
  return res.status(201).json({ reported: true });
});

router.post("/road-channels/:channel/voice/upload-url", async (req, res) => {
  if (!await requireEnabled(res)) return;
  const channel = channelFor(req.params.channel);
  const { deviceId, contentType, sizeBytes, lat, lng } = req.body as Record<string, unknown>;
  if (!channel) return res.status(404).json({ error: "Unsupported road channel" });
  if (!validDevice(deviceId) || typeof contentType !== "string" || !ALLOWED_AUDIO_TYPES.has(contentType) ||
      !Number.isInteger(sizeBytes) || (sizeBytes as number) < 1 || (sizeBytes as number) > MAX_AUDIO_BYTES || !validCoordinates(lat, lng)) {
    return res.status(400).json({ error: "Valid deviceId, Kenyan coordinates, supported audio type and audio size (max 10MB) required" });
  }
  if (!isR2Configured()) return res.status(503).json({ error: "Voice uploads are temporarily unavailable" });
  if (!permit(deviceId, "voice-upload", 5, 60 * 60_000) || await blocked(deviceId)) return res.status(403).json({ error: "Device is not permitted to upload voice reports" });
  if (!await activeMember(channel, deviceId)) return res.status(403).json({ error: "Join this active road channel before contributing" });
  const id = crypto.randomUUID(), objectKey = voiceKey(deviceId, id);
  await db.insert(roadChannelVoiceReportsTable).values({
    id, channel, deviceId, objectKey, contentType, sizeBytes: sizeBytes as number,
    lat: lat as number, lng: lng as number, expiresAt: new Date(Date.now() + AUDIO_RETENTION_MS),
  });
  const uploadUrl = await getPresignedUploadUrl(objectKey, contentType);
  return res.status(201).json({ voiceReportId: id, uploadUrl, expiresInSeconds: 900, objectKey });
});

router.post("/road-channels/voice/:id/interpret", async (req, res) => {
  if (!await requireEnabled(res)) return;
  const { deviceId } = req.body as { deviceId?: unknown };
  if (!validDevice(deviceId)) return res.status(400).json({ error: "Valid deviceId required" });
  if (!permit(deviceId, "voice-interpret", 5, 60 * 60_000) || await blocked(deviceId)) return res.status(403).json({ error: "Device is not permitted to interpret voice reports" });
  const [voice] = await db.select().from(roadChannelVoiceReportsTable).where(eq(roadChannelVoiceReportsTable.id, req.params.id));
  if (!voice) return res.status(404).json({ error: "Voice report not found" });
  if (voice.deviceId !== deviceId) return res.status(403).json({ error: "Voice report belongs to another device" });
  if (voice.status === "confirmed") return res.status(409).json({ error: "Voice report already confirmed" });
  const object = await headObject(voice.objectKey);
  if (!object || object.size < 1 || object.size > MAX_AUDIO_BYTES || !object.contentType || !ALLOWED_AUDIO_TYPES.has(object.contentType)) {
    return res.status(400).json({ error: "Uploaded audio is missing or fails size/type validation" });
  }
  try {
    const compatible = await ensureCompatibleFormat(await downloadAsBuffer(voice.objectKey));
    const transcript = await speechToText(compatible.buffer, compatible.format);
    const completion = await openai.chat.completions.create({
      model: "gpt-5.6-luna", max_completion_tokens: 300,
      messages: [{
        role: "system",
        content: `Classify a short Kenyan driver road report, including English, Swahili, and common Sheng. Return only JSON: {"type": one of ${JSON.stringify([...ALLOWED_REPORT_TYPES])} or null, "summary": a concise factual sentence, "speedLimit": an integer 30-110 or null, "cameraType": "fixed", "mobile", or null}. Map "speed camera", "camera", "speed trap", or a clearly described enforcement camera to type "camera". Never invent a speed, camera type, location, or event. Use null type when the audio is unclear or is not a current road condition.`,
      }, { role: "user", content: transcript }],
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as {
      type?: unknown; summary?: unknown; speedLimit?: unknown; cameraType?: unknown;
    };
    const proposedType = typeof parsed.type === "string" && ALLOWED_REPORT_TYPES.has(parsed.type) ? parsed.type : null;
    const proposedSpeedLimit = typeof parsed.speedLimit === "number" && Number.isInteger(parsed.speedLimit)
      && parsed.speedLimit >= 30 && parsed.speedLimit <= 110 ? parsed.speedLimit : null;
    const proposedCameraType = parsed.cameraType === "fixed" || parsed.cameraType === "mobile" ? parsed.cameraType : null;
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 280) : null;
    const moderationStatus = PROFANITY_PATTERN.test(`${transcript} ${summary ?? ""}`) ? "rejected" : "pending";
    await db.update(roadChannelVoiceReportsTable).set({
      transcript, summary, proposedType, proposedSpeedLimit, proposedCameraType,
      status: "interpreted", interpretedAt: new Date(), sizeBytes: object.size,
      moderationStatus,
      moderationReason: moderationStatus === "rejected" ? "Automated language safety check" : null,
    })
      .where(eq(roadChannelVoiceReportsTable.id, voice.id));
    return res.json({
      voiceReportId: voice.id,
      transcript,
      proposedType,
      summary,
      road: channelName(voice.channel),
      speedLimit: proposedSpeedLimit,
      cameraType: proposedCameraType,
      moderationStatus,
      requiresConfirmation: true,
    });
  } catch (err) {
    logger.warn({ err, voiceReportId: voice.id }, "Road channel voice interpretation failed");
    return res.status(502).json({ error: "Could not interpret this voice report" });
  }
});

router.post("/road-channels/voice/:id/confirm", async (req, res) => {
  if (!await requireEnabled(res)) return;
  const { deviceId, type, selectedCategory, communityGuidelinesAccepted } = req.body as {
    deviceId?: unknown;
    type?: unknown;
    selectedCategory?: unknown;
    communityGuidelinesAccepted?: unknown;
  };
  if (!validDevice(deviceId) || typeof type !== "string" || !ALLOWED_REPORT_TYPES.has(type)) return res.status(400).json({ error: "Valid deviceId and allowed report type required" });
  if (!permit(deviceId, "voice-confirm", 10) || await blocked(deviceId)) return res.status(403).json({ error: "Device is not permitted to confirm voice reports" });
  const [voice] = await db.select().from(roadChannelVoiceReportsTable).where(eq(roadChannelVoiceReportsTable.id, req.params.id));
  if (!voice) return res.status(404).json({ error: "Voice report not found" });
  if (voice.deviceId !== deviceId) return res.status(403).json({ error: "Voice report belongs to another device" });
  if (!await activeMember(voice.channel, deviceId)) return res.status(403).json({ error: "An active joined channel is required" });
  if (communityGuidelinesAccepted !== true) return res.status(412).json({ error: "Accept the Road Channels community guidelines before contributing" });
  if (voice.moderationStatus === "rejected") return res.status(409).json({ error: "This recording cannot be shared. Please record a factual road update." });
  if (voice.status !== "interpreted" || voice.proposedType !== type || voice.lat == null || voice.lng == null) return res.status(409).json({ error: "Interpret this report and explicitly confirm its proposed type first" });
  const confirmedType = typeof selectedCategory === "string" ? CATEGORY_TO_TYPE[selectedCategory] : undefined;
  if (!confirmedType || confirmedType !== type) {
    return res.status(409).json({ error: "The selected category must match the interpreted report type" });
  }
  const ttl = TTL_SECONDS[confirmedType] ?? null;
  const report = await createCommunityReport({
    type: confirmedType,
    lat: voice.lat,
    lng: voice.lng,
    deviceId,
    roadName: channelName(voice.channel),
    expiresAt: ttl ? new Date(Date.now() + ttl * 1000) : null,
    observationContext: "on_location",
    observedAt: new Date(),
    speedLimit: confirmedType === "camera" ? voice.proposedSpeedLimit ?? undefined : undefined,
    cameraType: confirmedType === "camera" ? (voice.proposedCameraType as "fixed" | "mobile" | null) ?? undefined : undefined,
    source: "road_channel",
    forceModeration: true,
  });
  await db.update(roadChannelVoiceReportsTable).set({
    status: "confirmed",
    confirmedAt: new Date(),
    reportId: report.id,
    proposedType: confirmedType,
    termsVersion: TERMS_VERSION,
    termsAcceptedAt: new Date(),
  }).where(eq(roadChannelVoiceReportsTable.id, voice.id));
  await db.insert(roadChannelUpdatesTable).values({ channel: voice.channel, deviceId, kind: "voice_report_confirmed", reportId: report.id, voiceReportId: voice.id });
  return res.status(201).json({ reportId: report.id, status: report.status });
});

export default router;