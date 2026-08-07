/**
 * backfillR2Media — legacy migration, now retired.
 *
 * All media has been verified migrated from Replit Object Storage to
 * Cloudflare R2 (confirmed zero legacy keys in accident_photos.file_key,
 * accident_records.pdf_file_key, and course_lessons.audio_url).
 *
 * This export is a no-op so the import site in index.ts compiles unchanged.
 */

import { logger } from "../lib/logger";
import { db, accidentPhotosTable, accidentRecordsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function backfillR2Media(): Promise<void> {
  // Startup safety check: warn loudly if any legacy keys somehow reappear.
  try {
    const [photoRow] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(accidentPhotosTable)
      .where(sql`file_key LIKE '/%'`);
    const [pdfRow] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(accidentRecordsTable)
      .where(sql`pdf_file_key LIKE '/%'`);

    const legacyCount = (photoRow?.cnt ?? 0) + (pdfRow?.cnt ?? 0);
    if (legacyCount > 0) {
      logger.warn(
        { legacyPhotoKeys: photoRow?.cnt, legacyPdfKeys: pdfRow?.cnt },
        "R2 migration check — legacy Replit Object Storage keys detected; re-run the migration script"
      );
    } else {
      logger.info("R2 migration check — no legacy keys found, storage fully on R2");
    }
  } catch (err) {
    logger.warn({ err }, "R2 migration check — DB check failed (non-fatal)");
  }
}
