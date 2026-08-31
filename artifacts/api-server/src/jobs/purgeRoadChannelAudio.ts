import { and, eq, lt, ne } from "drizzle-orm";
import { db, roadChannelVoiceReportsTable } from "@workspace/db";
import { deleteObject, isR2Configured } from "../lib/r2Storage.js";
import { logger } from "../lib/logger.js";

const INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function purgeExpiredRoadChannelAudio(now = new Date()): Promise<number> {
  if (!isR2Configured()) return 0;
  const expired = await db.select().from(roadChannelVoiceReportsTable)
    .where(and(
      lt(roadChannelVoiceReportsTable.expiresAt, now),
      ne(roadChannelVoiceReportsTable.status, "audio_expired"),
    ));
  let removed = 0;
  for (const voice of expired) {
    try {
      await deleteObject(voice.objectKey);
      await db.update(roadChannelVoiceReportsTable)
        .set({ status: "audio_expired" })
        .where(eq(roadChannelVoiceReportsTable.id, voice.id));
      removed += 1;
    } catch (err) {
      logger.warn({ err, voiceReportId: voice.id }, "Could not purge expired Road Channels audio");
    }
  }
  return removed;
}

export function startPurgeRoadChannelAudioJob(): void {
  const run = () => void purgeExpiredRoadChannelAudio().catch((err) =>
    logger.error({ err }, "Road Channels audio cleanup failed"));
  run();
  setInterval(run, INTERVAL_MS).unref();
}