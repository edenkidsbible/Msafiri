/**
 * Admin → System routes
 *
 * GET  /system/backup/export   — download the full backup JSON immediately
 * POST /system/backup/run      — trigger backup (sends email + returns JSON)
 * POST /system/backup/restore  — upsert-restore from an uploaded backup JSON
 */

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql, getTableColumns } from "drizzle-orm";
import {
  communityReportsTable,
  speedZonesTable,
  savedPlacesTable,
  plannedTripsTable,
  deviceBackupsTable,
  sharedVehiclesTable,
  vehicleMembersTable,
  vehicleJoinRequestsTable,
  emergencyContactsTable,
  pushTokensTable,
  courseChaptersTable,
  courseLessonsTable,
  courseQuizQuestionsTable,
  userCourseProgressTable,
  userCourseBookmarksTable,
  poisTable,
  appSettingsTable,
  adminUsersTable,
  blogPostsTable,
  appReleasesTable,
  creatorApplicationsTable,
  promoCodesTable,
  accidentRecordsTable,
  accidentPhotosTable,
  accidentWitnessesTable,
  accidentTimelineEventsTable,
  dashcamClipsTable,
  brakingEventsTable,
  hazardClustersTable,
  pushCampaignsTable,
  blockedDevicesTable,
  customVehiclesTable,
} from "@workspace/db";
import { buildBackupSnapshot, runDailyBackup } from "../../jobs/dailyBackup.js";
import { dumpToR2, tryDumpToR2 } from "../../lib/pgDump.js";
import { isR2Configured } from "../../lib/r2Storage.js";
import { logger } from "../../lib/logger.js";


const router = Router();

// ── Upsert helper ─────────────────────────────────────────────────────────────
// Generic: reads column metadata from the Drizzle table, builds
// INSERT … ON CONFLICT (id) DO UPDATE SET … = EXCLUDED.…
// so the restore is idempotent regardless of whether rows already exist.

type AnyTable = Parameters<typeof getTableColumns>[0];

async function upsertRows(
  table: AnyTable,
  rows: Record<string, unknown>[],
  pkField = "id",
): Promise<number> {
  if (!rows.length) return 0;

  const cols     = getTableColumns(table);
  const pkColDef = cols[pkField];
  if (!pkColDef) throw new Error(`No column "${pkField}" on table`);

  // Build the SET clause: every non-PK column = EXCLUDED."snake_case_name"
  const updateSet: Record<string, unknown> = {};
  for (const [jsKey, colDef] of Object.entries(cols)) {
    if (jsKey === pkField) continue;
    // Use sql.raw so we get EXCLUDED."col_name" without extra quoting from Drizzle
    const dbColName = (colDef as any).name as string;
    updateSet[jsKey] = sql.raw(`excluded."${dbColName}"`);
  }

  // Backup JSON has ISO timestamp strings; Drizzle's PgTimestamp.mapToDriverValue()
  // requires Date objects — convert them before handing rows to Drizzle.
  function coerceRow(row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...row };
    for (const [jsKey, colDef] of Object.entries(cols)) {
      const cType = (colDef as any).columnType as string | undefined;
      if (cType === "PgTimestamp" || cType === "PgTimestampString") {
        const v = out[jsKey];
        if (typeof v === "string" && v) out[jsKey] = new Date(v);
      }
    }
    return out;
  }

  const CHUNK = 50;
  let total   = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK).map(coerceRow);
    try {
      await (db.insert(table) as any)
        .values(batch)
        .onConflictDoUpdate({ target: pkColDef, set: updateSet });
      total += batch.length;
    } catch (err) {
      logger.warn({ err }, `[system/restore] Batch upsert failed — skipping ${batch.length} rows`);
    }
  }
  return total;
}

// ── GET /system/backup/export ─────────────────────────────────────────────────

router.get("/system/backup/export", async (_req: Request, res: Response) => {
  try {
    logger.info("[system/backup] On-demand export requested");
    const snapshot = await buildBackupSnapshot();
    const json     = JSON.stringify(snapshot, null, 2);
    const date     = new Date().toISOString().slice(0, 10);

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="msafiri-backup-${date}.json"`);
    res.send(json);
  } catch (err) {
    logger.error({ err }, "[system/backup] Export failed");
    res.status(500).json({ error: "Export failed" });
  }
});

// ── POST /system/backup/run ───────────────────────────────────────────────────
// Sends the scheduled email immediately and also returns the snapshot JSON
// so the admin can download it right away without waiting for midnight.

router.post("/system/backup/run", async (_req: Request, res: Response) => {
  try {
    logger.info("[system/backup] On-demand backup run triggered by admin");
    // Fire both in parallel: build snapshot + send email
    const snapshot = await buildBackupSnapshot();

    // Trigger the email (non-blocking for response — we still wait so we can
    // report success/failure to the admin UI)
    const toEmail = process.env["BACKUP_EMAIL_ADDRESS"];
    let emailSent = false;
    if (toEmail) {
      try {
        await runDailyBackup();
        emailSent = true;
      } catch (emailErr) {
        logger.warn({ emailErr }, "[system/backup] Email send failed — snapshot still returned");
      }
    }

    res.json({
      ok:        true,
      emailSent,
      toEmail:   toEmail ?? null,
      stats:     snapshot.stats,
      exportedAt: snapshot.exportedAt,
    });
  } catch (err) {
    logger.error({ err }, "[system/backup] On-demand run failed");
    res.status(500).json({ error: "Backup run failed" });
  }
});

// ── POST /system/backup/pg-dump ───────────────────────────────────────────────
// Runs pg_dump and uploads the binary dump to R2.
// Use this BEFORE publishing to guarantee a point-in-time snapshot of
// production data.  Returns the R2 key and file size on success.
//
// Restore procedure (if needed after a bad deploy):
//   1. Download the .dump file from R2  (db-backups/<timestamp>.dump)
//   2. Run: pg_restore --clean --if-exists -d $DATABASE_URL <file>.dump

router.post("/system/backup/pg-dump", async (_req: Request, res: Response) => {
  if (!isR2Configured()) {
    return res.status(503).json({
      error: "R2 not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME",
    });
  }
  try {
    logger.info("[system/backup/pg-dump] On-demand pg_dump triggered by admin");
    const result = await dumpToR2();
    return res.json({
      ok:         true,
      key:        result.key,
      sizeBytes:  result.sizeBytes,
      durationMs: result.durationMs,
      note:       `Dump saved to R2 at ${result.key}. To restore: pg_restore --clean --if-exists -d $DATABASE_URL <file>.dump`,
    });
  } catch (err: any) {
    logger.error({ err }, "[system/backup/pg-dump] Failed");
    return res.status(500).json({ error: err?.message ?? "pg_dump failed" });
  }
});

// ── POST /system/backup/restore ───────────────────────────────────────────────
// Accepts the full backup JSON, upserts each table in dependency order.
// Returns a per-table count of rows restored.
//
// Restore order respects FK dependencies:
//   parent tables first (chapters before lessons, shared_vehicles before members, etc.)

router.post("/system/backup/restore", async (req: Request, res: Response) => {
  const body = req.body as { tables?: Record<string, unknown[]>; version?: number };

  if (!body?.tables || typeof body.tables !== "object") {
    return res.status(400).json({ error: "Invalid backup format — expected { tables: { … } }" });
  }

  const t = body.tables;
  const counts: Record<string, number> = {};

  type Step = [string, AnyTable, string?];

  // Ordered so FK parents are restored before their children.
  const steps: Step[] = [
    // System / config
    ["adminUsers",              adminUsersTable],
    ["appSettings",             appSettingsTable],
    ["appReleases",             appReleasesTable],
    ["blockedDevices",          blockedDevicesTable,        "deviceId"],
    // Community data
    ["communityReports",        communityReportsTable],
    ["speedZones",              speedZonesTable],
    ["pois",                    poisTable],
    // Content
    ["blogPosts",               blogPostsTable],
    ["courseChapters",          courseChaptersTable],
    ["courseLessons",           courseLessonsTable],        // depends on chapters
    ["courseQuizQuestions",     courseQuizQuestionsTable],  // depends on lessons
    // Push
    ["pushTokens",              pushTokensTable],
    ["pushCampaigns",           pushCampaignsTable],
    // User data — no FK deps except implicit deviceId (not enforced as FK)
    ["savedPlaces",             savedPlacesTable],
    ["plannedTrips",            plannedTripsTable],
    ["deviceBackups",           deviceBackupsTable],
    ["emergencyContacts",       emergencyContactsTable],
    ["userCourseProgress",      userCourseProgressTable],
    ["userCourseBookmarks",     userCourseBookmarksTable],
    // Vehicles & fleet
    ["sharedVehicles",          sharedVehiclesTable],
    ["vehicleMembers",          vehicleMembersTable],
    ["vehicleJoinRequests",     vehicleJoinRequestsTable],
    ["customVehicles",          customVehiclesTable],
    // Accidents — records first, then dependent rows
    ["accidentRecords",         accidentRecordsTable],
    ["accidentPhotos",          accidentPhotosTable],
    ["accidentWitnesses",       accidentWitnessesTable],
    ["accidentTimelineEvents",  accidentTimelineEventsTable],
    // Telemetry / analytics
    ["brakingEvents",           brakingEventsTable],
    ["hazardClusters",          hazardClustersTable],
    // Dashcam metadata (binary blobs stay in R2)
    ["dashcamClips",            dashcamClipsTable],
    // Business
    ["creatorApplications",     creatorApplicationsTable],
    ["promoCodes",              promoCodesTable],
  ];

  let totalRows = 0;
  for (const [key, table, pkField] of steps) {
    const rows = (t[key] ?? []) as Record<string, unknown>[];
    try {
      const n = await upsertRows(table, rows, pkField ?? "id");
      counts[key] = n;
      totalRows  += n;
    } catch (err) {
      logger.error({ err, key }, "[system/restore] Table restore failed");
      counts[key] = -1; // signal error for this table
    }
  }

  logger.info({ counts, totalRows }, "[system/restore] Restore complete");
  return res.json({ ok: true, restoredRows: totalRows, counts });
});

export default router;
