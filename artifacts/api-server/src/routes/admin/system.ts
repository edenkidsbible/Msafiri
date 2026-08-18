/**
 * Admin → System routes
 *
 * GET  /system/backup/export               — download the full backup JSON immediately
 * GET  /system/backup/pg-dump/latest       — most recent R2 dump metadata (key, size, timestamp)
 * GET  /system/backup/pg-dump/list         — all R2 dumps sorted newest-first
 * GET  /system/backup/pg-dump/download     — run fresh pg_dump, upload to R2, stream .dump to browser
 * GET  /system/backup/pg-dump/fetch?key=   — stream an existing R2 dump by key (no fresh dump)
 * POST /system/backup/run                  — trigger backup (sends email + returns JSON)
 * POST /system/backup/pg-dump              — run pg_dump, upload to R2, return metadata only
 * POST /system/backup/pg-dump/restore      — restore DB from a specific R2 dump key via pg_restore
 * POST /system/backup/restore              — upsert-restore from an uploaded backup JSON
 */

import { Router, type Request, type Response } from "express";
import { spawn } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
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
import { dumpToR2, tryDumpToR2, runPgDump } from "../../lib/pgDump.js";
import { isR2Configured, listObjectsWithPrefix, uploadBuffer, downloadAsBuffer } from "../../lib/r2Storage.js";
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

// ── GET /system/backup/pg-dump/latest ────────────────────────────────────────
// Returns metadata for the most recent R2 dump (key, size, lastModified).

router.get("/system/backup/pg-dump/latest", async (_req: Request, res: Response) => {
  if (!isR2Configured()) {
    return res.json({ configured: false, backup: null });
  }
  try {
    const objects = await listObjectsWithPrefix("db-backups/");
    if (!objects.length) return res.json({ configured: true, backup: null });
    // Sort descending by key (ISO timestamp filenames sort naturally)
    objects.sort((a, b) => b.key.localeCompare(a.key));
    const latest = objects[0];
    return res.json({
      configured: true,
      backup: {
        key:          latest.key,
        sizeBytes:    latest.size,
        lastModified: latest.lastModified?.toISOString() ?? null,
      },
    });
  } catch (err: any) {
    logger.error({ err }, "[system/backup/pg-dump/latest] Failed to list R2 objects");
    return res.status(500).json({ error: err?.message ?? "Failed to list backups" });
  }
});

// ── GET /system/backup/pg-dump/download ──────────────────────────────────────
// Runs a fresh pg_dump, uploads to R2 (if configured), and streams the binary
// .dump file to the browser for direct download.

router.get("/system/backup/pg-dump/download", async (_req: Request, res: Response) => {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    return res.status(503).json({ error: "DATABASE_URL not set — cannot run pg_dump" });
  }

  try {
    logger.info("[system/backup/pg-dump/download] On-demand pg_dump download triggered by admin");
    const now = new Date();
    const tag = now.toISOString()
      .replace("T", "_")
      .replace(/:/g, "-")
      .slice(0, 19);
    const key = `db-backups/${tag}.dump`;

    const buffer = await runPgDump(databaseUrl);

    // Best-effort upload to R2 so this download also serves as a backup
    if (isR2Configured()) {
      uploadBuffer(key, buffer, "application/octet-stream").catch((err) =>
        logger.warn({ err }, "[system/backup/pg-dump/download] R2 upload failed — still serving download"),
      );
    }

    const filename = `msafiri-db-${tag}.dump`;
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", buffer.length);
    return res.send(buffer);
  } catch (err: any) {
    logger.error({ err }, "[system/backup/pg-dump/download] Failed");
    return res.status(500).json({ error: err?.message ?? "pg_dump failed" });
  }
});

// ── GET /system/backup/pg-dump/list ──────────────────────────────────────────
// Returns all R2 dumps under db-backups/ sorted newest-first.

router.get("/system/backup/pg-dump/list", async (_req: Request, res: Response) => {
  if (!isR2Configured()) return res.json({ configured: false, backups: [] });
  try {
    const objects = await listObjectsWithPrefix("db-backups/");
    objects.sort((a, b) => b.key.localeCompare(a.key));
    return res.json({
      configured: true,
      backups: objects.map((o) => ({
        key:          o.key,
        sizeBytes:    o.size,
        lastModified: o.lastModified?.toISOString() ?? null,
      })),
    });
  } catch (err: any) {
    logger.error({ err }, "[system/backup/pg-dump/list] Failed");
    return res.status(500).json({ error: err?.message ?? "Failed to list backups" });
  }
});

// ── GET /system/backup/pg-dump/fetch?key= ────────────────────────────────────
// Streams an EXISTING R2 dump to the browser by key — does NOT create a fresh dump.

router.get("/system/backup/pg-dump/fetch", async (req: Request, res: Response) => {
  const key = req.query["key"] as string | undefined;
  if (!key || !key.startsWith("db-backups/")) {
    return res.status(400).json({ error: "key parameter missing or must start with db-backups/" });
  }
  if (!isR2Configured()) return res.status(503).json({ error: "R2 not configured" });
  try {
    logger.info({ key }, "[system/backup/pg-dump/fetch] Streaming existing dump from R2");
    const buffer   = await downloadAsBuffer(key);
    const filename = `msafiri-db-${key.split("/").pop() ?? "backup.dump"}`;
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", buffer.length);
    return res.send(buffer);
  } catch (err: any) {
    logger.error({ err, key }, "[system/backup/pg-dump/fetch] Failed");
    return res.status(500).json({ error: err?.message ?? "Download from R2 failed" });
  }
});

// ── POST /system/backup/pg-dump/restore ──────────────────────────────────────
// Downloads a specific R2 dump by key, writes it to a temp file, then runs
// pg_restore --clean --if-exists against the live database.
// ⚠️ DESTRUCTIVE — drops and recreates all restored objects.

router.post("/system/backup/pg-dump/restore", async (req: Request, res: Response) => {
  const { key } = req.body as { key?: string };
  if (!key || !key.startsWith("db-backups/")) {
    return res.status(400).json({ error: "key must start with db-backups/" });
  }
  if (!isR2Configured()) return res.status(503).json({ error: "R2 not configured" });

  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) return res.status(503).json({ error: "DATABASE_URL not set" });

  const tmpFile = join(tmpdir(), `msafiri-restore-${Date.now()}.dump`);
  const start   = Date.now();

  try {
    logger.info({ key }, "[system/backup/pg-dump/restore] Downloading dump from R2…");
    const buffer = await downloadAsBuffer(key);
    await writeFile(tmpFile, buffer);

    logger.info({ key, sizeBytes: buffer.length }, "[system/backup/pg-dump/restore] Running pg_restore…");

    const { exitCode, stderr } = await new Promise<{ exitCode: number | null; stderr: string }>(
      (resolve) => {
        const proc = spawn("pg_restore", [
          "--clean",
          "--if-exists",
          "--no-acl",
          "--no-owner",
          "-d", databaseUrl,
          tmpFile,
        ]);
        let stderrOut = "";
        proc.stderr.on("data", (d: Buffer) => { stderrOut += d.toString(); });
        proc.on("close", (code) => resolve({ exitCode: code, stderr: stderrOut }));
        proc.on("error", (err) => resolve({ exitCode: -1, stderr: err.message }));
      },
    );

    const durationMs = Date.now() - start;

    // pg_restore exits 1 on warnings (harmless); only code ≥2 means real failure
    if (exitCode !== null && exitCode >= 2) {
      logger.error({ key, exitCode, stderr }, "[system/backup/pg-dump/restore] pg_restore failed");
      return res.status(500).json({
        ok: false,
        error: `pg_restore exited with code ${exitCode}`,
        stderr: stderr.slice(-2000),
        durationMs,
      });
    }

    logger.info({ key, exitCode, durationMs }, "[system/backup/pg-dump/restore] Restore complete");
    return res.json({ ok: true, durationMs, warnings: stderr.trim() || null });
  } catch (err: any) {
    logger.error({ err, key }, "[system/backup/pg-dump/restore] Unexpected error");
    return res.status(500).json({ ok: false, error: err?.message ?? "Restore failed" });
  } finally {
    unlink(tmpFile).catch(() => {});
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
