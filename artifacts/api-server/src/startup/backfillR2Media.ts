/**
 * backfillR2Media — runs (in the background) at API server startup.
 *
 * One-time copy of legacy media from Replit Object Storage into the external
 * Cloudflare R2 bucket so all reads can be served from R2 and the Replit
 * bucket can eventually be emptied. Covers:
 *   - course lesson audio    (prefix "audio/")
 *   - cached TTS alert clips (prefix "tts/alert/")
 *   - accident photos        (file_key column in accident_photos table)
 *   - accident PDF reports   (pdf_file_key column in accident_records table)
 *
 * Idempotent: objects already present in R2 are skipped (HEAD-only check) and
 * DB references already pointing to R2 keys are untouched. Safe to run on
 * every restart until the Replit bucket is emptied.
 *
 * Requires both R2 credentials and the legacy Replit bucket to be available;
 * exits quietly when either is absent.
 */

import { objectStorageClient } from "../lib/objectStorage";
import * as r2 from "../lib/r2Storage";
import { db, accidentPhotosTable, accidentRecordsTable } from "@workspace/db";
import { isNull, isNotNull, eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const PREFIXES = ["audio/", "tts/alert/"];

function guessContentType(name: string): string {
  if (name.endsWith(".mp3")) return "audio/mpeg";
  if (name.endsWith(".m4a")) return "audio/m4a";
  if (name.endsWith(".aac")) return "audio/aac";
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".heic") || name.endsWith(".heif")) return "image/heic";
  if (name.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

/**
 * Parse a legacy Replit Object Storage key (format: "/bucketName/objectPath").
 * Returns { bucketName, objectName } or null if the path is not legacy format.
 */
function parseLegacyKey(fileKey: string): { bucketName: string; objectName: string } | null {
  if (!fileKey.startsWith("/")) return null; // Already an R2 key
  const withoutLeadingSlash = fileKey.slice(1);
  const slashIdx = withoutLeadingSlash.indexOf("/");
  if (slashIdx === -1) return null;
  return {
    bucketName: withoutLeadingSlash.slice(0, slashIdx),
    objectName: withoutLeadingSlash.slice(slashIdx + 1),
  };
}

async function copyFromReplit(
  bucketName: string,
  objectName: string,
  r2Key: string,
): Promise<boolean> {
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  const [exists] = await file.exists();
  if (!exists) return false;

  const [buf] = await file.download();
  const [meta] = await file.getMetadata();
  const contentType =
    (meta?.contentType as string | undefined) || guessContentType(objectName);
  await r2.uploadBuffer(r2Key, buf as Buffer, contentType);
  return true;
}

export async function backfillR2Media(): Promise<void> {
  if (!r2.isR2Configured()) {
    logger.info("R2 media backfill — R2 not configured, skipping");
    return;
  }
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) {
    logger.info("R2 media backfill — no legacy bucket configured, skipping");
    return;
  }

  let copied = 0;
  let skipped = 0;
  let failed = 0;

  // ── Course audio & TTS (prefix scan) ──────────────────────────────────────
  for (const prefix of PREFIXES) {
    let files;
    try {
      [files] = await objectStorageClient.bucket(bucketId).getFiles({ prefix });
    } catch (err) {
      logger.warn({ err, prefix }, "R2 media backfill — legacy list failed");
      continue;
    }

    for (const file of files) {
      const key = file.name;
      try {
        if (await r2.headObject(key)) { skipped++; continue; }
        const [buf] = await file.download();
        const [meta] = await file.getMetadata();
        const contentType =
          (meta?.contentType as string | undefined) || guessContentType(key);
        await r2.uploadBuffer(key, buf as Buffer, contentType);
        copied++;
      } catch (err) {
        failed++;
        logger.warn({ err, key }, "R2 media backfill — copy failed");
      }
    }
  }

  // ── Accident photos ────────────────────────────────────────────────────────
  // Legacy keys start with "/" (Replit bucket-prefixed path).
  // New R2 keys: "accidents/<accidentId>/photos/<photoId>"
  let legacyPhotos: Array<{ id: string; accidentId: string; fileKey: string }> = [];
  try {
    const photoRows = await db
      .select({
        id: accidentPhotosTable.id,
        accidentId: accidentPhotosTable.accidentId,
        fileKey: accidentPhotosTable.fileKey,
      })
      .from(accidentPhotosTable)
      .where(isNotNull(accidentPhotosTable.fileKey));
    // Filter to only legacy keys (starts with "/")
    legacyPhotos = photoRows
      .filter((p) => p.fileKey !== null && (p.fileKey as string).startsWith("/"))
      .map((p) => ({ id: p.id, accidentId: p.accidentId, fileKey: p.fileKey as string }));
  } catch (err) {
    logger.warn({ err }, "R2 media backfill — could not query accident photos");
  }

  for (const photo of legacyPhotos) {
    const parsed = parseLegacyKey(photo.fileKey);
    if (!parsed) { skipped++; continue; }

    const r2Key = `accidents/${photo.accidentId}/photos/${photo.id}`;
    try {
      if (await r2.headObject(r2Key)) {
        // Already in R2 — update DB reference if needed
        await db
          .update(accidentPhotosTable)
          .set({ fileKey: r2Key })
          .where(eq(accidentPhotosTable.id, photo.id));
        skipped++;
        continue;
      }
      const ok = await copyFromReplit(parsed.bucketName, parsed.objectName, r2Key);
      if (ok) {
        // Update DB to point to R2 key only after successful copy
        await db
          .update(accidentPhotosTable)
          .set({ fileKey: r2Key })
          .where(eq(accidentPhotosTable.id, photo.id));
        copied++;
      } else {
        failed++;
        logger.warn({ photoId: photo.id, key: photo.fileKey }, "R2 backfill — accident photo not found in Replit");
      }
    } catch (err) {
      failed++;
      logger.warn({ err, photoId: photo.id }, "R2 backfill — accident photo copy failed");
    }
  }

  // ── Accident PDF reports ───────────────────────────────────────────────────
  let legacyPdfs: Array<{ id: string; pdfFileKey: string }> = [];
  try {
    const rows = await db
      .select({
        id: accidentRecordsTable.id,
        pdfFileKey: accidentRecordsTable.pdfFileKey,
      })
      .from(accidentRecordsTable)
      .where(isNotNull(accidentRecordsTable.pdfFileKey));
    legacyPdfs = rows
      .filter((r) => r.pdfFileKey !== null && (r.pdfFileKey as string).startsWith("/"))
      .map((r) => ({ id: r.id, pdfFileKey: r.pdfFileKey as string }));
  } catch (err) {
    logger.warn({ err }, "R2 media backfill — could not query accident records");
  }

  for (const rec of legacyPdfs) {
    const parsed = parseLegacyKey(rec.pdfFileKey);
    if (!parsed) { skipped++; continue; }

    const r2Key = `accidents/${rec.id}/report.pdf`;
    try {
      if (await r2.headObject(r2Key)) {
        await db
          .update(accidentRecordsTable)
          .set({ pdfFileKey: r2Key })
          .where(eq(accidentRecordsTable.id, rec.id));
        skipped++;
        continue;
      }
      const ok = await copyFromReplit(parsed.bucketName, parsed.objectName, r2Key);
      if (ok) {
        await db
          .update(accidentRecordsTable)
          .set({ pdfFileKey: r2Key })
          .where(eq(accidentRecordsTable.id, rec.id));
        copied++;
      } else {
        failed++;
        logger.warn({ recordId: rec.id }, "R2 backfill — accident PDF not found in Replit");
      }
    } catch (err) {
      failed++;
      logger.warn({ err, recordId: rec.id }, "R2 backfill — accident PDF copy failed");
    }
  }

  logger.info({ copied, skipped, failed }, "R2 media backfill — complete");
}
