import { Router, type Request, type Response } from "express";
import { and, count, desc, eq, gt } from "drizzle-orm";
import {
  blockedDevicesTable, communityReportsTable, db, roadChannelPresenceTable,
  roadChannelUpdatesTable, roadChannelVoiceReportsTable,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { ensureCompatibleFormat, speechToText } from "@workspace/integrations-openai-ai-server/audio";
import { createCommunityReport, TTL_SECONDS } from "./reports.js";
import { downloadAsBuffer, getPresignedUploadUrl, headObject, isR2Configured } from "../lib/r2Storage.js";
import { logger } from "../lib/logger.js";

const router = Router();
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const PRESENCE_TTL_MS = 5 * 60 * 1000;
const ALLOWED_AUDIO_TYPES = new Set(["audio/mpeg", "audio/mp4", "audio/m4a", "audio/wav", "audio/webm", "audio/ogg"]);
const ALLOWED_REPORT_TYPES = new Set(Object.keys(TTL_SECONDS));

// Deliberately small pilot. Aliases resolve to one canonical channel identifier.
const CHANNEL_ALIASES: Record<string, string> = {
  "thika superhighway": "thika-superhighway", "thika road": "thika-superhighway", "a2": "thika-superhighway",
  "mombasa road": "mombasa-road", "nairobi mombasa road": "mombasa-road", "a8": "mombasa-road", "a109": "mombasa-road",
  "waiyaki way": "waiyaki-way", "nairobi nakuru highway": "nairobi-nakuru-highway", "a104": "nairobi-nakuru-highway",
  "ngong road": "ngong-road", "outer ring road": "outer-ring-road", "nairobi expressway": "nairobi-expressway",
  "langata road": "langata-road", "lang'ata road": "langata-road",
  "kiambu road": "kiambu-road", "limuru road": "limuru-road",
  "eastern bypass": "eastern-bypass", "northern bypass": "northern-bypass",
  "southern bypass": "southern-bypass", "kangundo road": "kangundo-road",
};
const requestWindows = new Map<string, number[]>();

function channelFor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return CHANNEL_ALIASES[value.trim().toLowerCase().replace(/[–—-]/g, " ").replace(/\s+/g, " ")] ?? null;
}
function channelName(channel: string): string {
  return channel.split("-").map((part) => part === "a2" ? "A2" : `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
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
function voiceKey(deviceId: string, id: string): string {
  // Encoded device id prevents path separator/prefix tricks while preserving ownership.
  return `road-channels/${encodeURIComponent(deviceId)}/${id}.audio`;
}

router.get("/road-channels", (_req, res) => {
  const channels = [...new Set(Object.values(CHANNEL_ALIASES))];
  res.json({ channels, aliases: CHANNEL_ALIASES });
});

router.get("/road-channels/discovery", async (req, res) => {
  const channel = channelFor(req.query.roadName);
  if (!channel) return res.json({ channels: [] });
  const [presence] = await db.select({ value: count() }).from(roadChannelPresenceTable)
    .where(and(eq(roadChannelPresenceTable.channel, channel), gt(roadChannelPresenceTable.lastSeenAt, new Date(Date.now() - PRESENCE_TTL_MS))));
  return res.json({
    channels: [{
      id: channel,
      name: `${channelName(channel)} Channel`,
      road: channelName(channel),
      memberCount: Number(presence?.value ?? 0),
    }],
  });
});

router.post("/road-channels/presence", async (req: Request, res: Response) => {
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
  await db.insert(roadChannelPresenceTable).values({ channel, deviceId, lat, lng: lng as number, lastSeenAt: new Date() })
    .onConflictDoUpdate({ target: [roadChannelPresenceTable.channel, roadChannelPresenceTable.deviceId], set: { lat, lng: lng as number, lastSeenAt: new Date() } });
  return res.status(204).end();
});

router.post("/road-channels/:channel/presence", async (req: Request, res: Response) => {
  const channel = channelFor(req.params.channel);
  const { deviceId, lat, lng } = req.body as Record<string, unknown>;
  if (!channel) return res.status(404).json({ error: "Unsupported road channel" });
  if (!validDevice(deviceId) || !validCoordinates(lat, lng)) return res.status(400).json({ error: "Valid deviceId, lat and lng required" });
  if (!permit(deviceId, "presence", 20) || await blocked(deviceId)) return res.status(403).json({ error: "Device is not permitted to update presence" });
  const latitude = lat as number, longitude = lng as number;
  await db.insert(roadChannelPresenceTable).values({ channel, deviceId, lat: latitude, lng: longitude, lastSeenAt: new Date() })
    .onConflictDoUpdate({ target: [roadChannelPresenceTable.channel, roadChannelPresenceTable.deviceId], set: { lat: latitude, lng: longitude, lastSeenAt: new Date() } });
  return res.status(204).end();
});

router.get("/road-channels/:channel/presence", async (req, res) => {
  const channel = channelFor(req.params.channel);
  if (!channel) return res.status(404).json({ error: "Unsupported road channel" });
  const rows = await db.select({ lat: roadChannelPresenceTable.lat, lng: roadChannelPresenceTable.lng, lastSeenAt: roadChannelPresenceTable.lastSeenAt })
    .from(roadChannelPresenceTable).where(and(eq(roadChannelPresenceTable.channel, channel), gt(roadChannelPresenceTable.lastSeenAt, new Date(Date.now() - PRESENCE_TTL_MS))));
  return res.json({ channel, activeCount: rows.length, presence: rows.map((row) => ({ ...row, lastSeenAt: row.lastSeenAt.getTime() })) });
});

router.get("/road-channels/:channel/feed", async (req, res) => {
  const channel = channelFor(req.params.channel);
  if (!channel) return res.status(404).json({ error: "Unsupported road channel" });
  const rows = await db.select().from(roadChannelUpdatesTable).where(eq(roadChannelUpdatesTable.channel, channel))
    .orderBy(desc(roadChannelUpdatesTable.createdAt)).limit(50);
  return res.json({ channel, updates: rows.map((r) => ({ id: r.id, kind: r.kind, reportId: r.reportId, createdAt: r.createdAt.getTime() })) });
});

router.post("/road-channels/:channel/voice/upload-url", async (req, res) => {
  const channel = channelFor(req.params.channel);
  const { deviceId, contentType, sizeBytes, lat, lng } = req.body as Record<string, unknown>;
  if (!channel) return res.status(404).json({ error: "Unsupported road channel" });
  if (!validDevice(deviceId) || typeof contentType !== "string" || !ALLOWED_AUDIO_TYPES.has(contentType) ||
      !Number.isInteger(sizeBytes) || (sizeBytes as number) < 1 || (sizeBytes as number) > MAX_AUDIO_BYTES || !validCoordinates(lat, lng)) {
    return res.status(400).json({ error: "Valid deviceId, Kenyan coordinates, supported audio type and audio size (max 10MB) required" });
  }
  if (!isR2Configured()) return res.status(503).json({ error: "Voice uploads are temporarily unavailable" });
  if (!permit(deviceId, "voice-upload", 5, 60 * 60_000) || await blocked(deviceId)) return res.status(403).json({ error: "Device is not permitted to upload voice reports" });
  const id = crypto.randomUUID(), objectKey = voiceKey(deviceId, id);
  await db.insert(roadChannelVoiceReportsTable).values({
    id, channel, deviceId, objectKey, contentType, sizeBytes: sizeBytes as number,
    lat: lat as number, lng: lng as number,
  });
  const uploadUrl = await getPresignedUploadUrl(objectKey, contentType);
  return res.status(201).json({ voiceReportId: id, uploadUrl, expiresInSeconds: 900, objectKey });
});

router.post("/road-channels/voice/:id/interpret", async (req, res) => {
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
    await db.update(roadChannelVoiceReportsTable).set({
      transcript, summary, proposedType, proposedSpeedLimit, proposedCameraType,
      status: "interpreted", interpretedAt: new Date(), sizeBytes: object.size,
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
      requiresConfirmation: true,
    });
  } catch (err) {
    logger.warn({ err, voiceReportId: voice.id }, "Road channel voice interpretation failed");
    return res.status(502).json({ error: "Could not interpret this voice report" });
  }
});

router.post("/road-channels/voice/:id/confirm", async (req, res) => {
  const { deviceId, type } = req.body as { deviceId?: unknown; type?: unknown };
  if (!validDevice(deviceId) || typeof type !== "string" || !ALLOWED_REPORT_TYPES.has(type)) return res.status(400).json({ error: "Valid deviceId and allowed report type required" });
  if (!permit(deviceId, "voice-confirm", 10) || await blocked(deviceId)) return res.status(403).json({ error: "Device is not permitted to confirm voice reports" });
  const [voice] = await db.select().from(roadChannelVoiceReportsTable).where(eq(roadChannelVoiceReportsTable.id, req.params.id));
  if (!voice) return res.status(404).json({ error: "Voice report not found" });
  if (voice.deviceId !== deviceId) return res.status(403).json({ error: "Voice report belongs to another device" });
  if (voice.status !== "interpreted" || voice.proposedType !== type || voice.lat == null || voice.lng == null) return res.status(409).json({ error: "Interpret this report and explicitly confirm its proposed type first" });
  const ttl = TTL_SECONDS[type] ?? null;
  const report = await createCommunityReport({
    type,
    lat: voice.lat,
    lng: voice.lng,
    deviceId,
    roadName: channelName(voice.channel),
    expiresAt: ttl ? new Date(Date.now() + ttl * 1000) : null,
    observationContext: "on_location",
    observedAt: new Date(),
    speedLimit: voice.proposedSpeedLimit ?? undefined,
    cameraType: type === "camera" ? (voice.proposedCameraType as "fixed" | "mobile" | null) ?? undefined : undefined,
    source: "road_channel",
  });
  await db.update(roadChannelVoiceReportsTable).set({ status: "confirmed", confirmedAt: new Date(), reportId: report.id }).where(eq(roadChannelVoiceReportsTable.id, voice.id));
  await db.insert(roadChannelUpdatesTable).values({ channel: voice.channel, deviceId, kind: "voice_report_confirmed", reportId: report.id, voiceReportId: voice.id });
  return res.status(201).json({ reportId: report.id, status: report.status });
});

export default router;