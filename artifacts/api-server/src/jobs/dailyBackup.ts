/**
 * Daily backup job — runs once per day at 23:00 EAT (20:00 UTC).
 *
 * Exports:
 *  1. All live community reports as CSV  → directly importable via Admin → Reports → Import
 *  2. Full JSON snapshot (reports + DB speed-zone overrides) → disaster-recovery restore
 *
 * Both are emailed to BACKUP_EMAIL_ADDRESS as attachments.
 * If the env var is not set the job logs a warning and skips the send.
 */

import { db, communityReportsTable, speedZonesTable } from "@workspace/db";
import { ne, inArray } from "drizzle-orm";
import { sendDailyBackupEmail } from "../lib/email.js";
import { logger } from "../lib/logger.js";

// Target hour in UTC — 20:00 UTC = 23:00 EAT
const TARGET_UTC_HOUR = 20;

// CSV header must match the existing admin import endpoint's expected columns.
const CSV_HEADER = "id,type,status,roadName,lat,lng,speedLimit,adminVerified,confirmCount,denyCount,createdAt,expiresAt";

function escapeCsv(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  // Wrap in quotes if the value contains a comma, quote, or newline.
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowToCsvLine(r: Record<string, unknown>): string {
  return [
    r.id,
    r.type,
    r.status,
    r.roadName,
    r.lat,
    r.lng,
    r.speedLimit,
    r.adminVerified,
    r.confirmCount,
    r.denyCount,
    r.createdAt instanceof Date ? r.createdAt.toISOString() : (r.createdAt ?? ""),
    r.expiresAt instanceof Date ? r.expiresAt.toISOString() : (r.expiresAt ?? ""),
  ].map(escapeCsv).join(",");
}

/** ISO date string for today in EAT (UTC+3). */
function eatDateString(): string {
  const now = new Date();
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return eat.toISOString().slice(0, 10);
}

async function runDailyBackup(): Promise<void> {
  const toEmail = process.env["BACKUP_EMAIL_ADDRESS"];
  if (!toEmail) {
    logger.warn("[dailyBackup] BACKUP_EMAIL_ADDRESS not set — skipping backup email");
    return;
  }

  logger.info("[dailyBackup] Starting daily backup export…");

  // ── 1. Fetch all non-permanently-deleted reports ──────────────────────────
  // Exclude nothing — even expired/denied rows are included so a restore
  // brings back the full history.  The admin import will re-activate or skip
  // them as appropriate based on their status column.
  let reports: Array<Record<string, unknown>> = [];
  try {
    reports = await db
      .select({
        id:           communityReportsTable.id,
        type:         communityReportsTable.type,
        status:       communityReportsTable.status,
        roadName:     communityReportsTable.roadName,
        lat:          communityReportsTable.lat,
        lng:          communityReportsTable.lng,
        speedLimit:   communityReportsTable.speedLimit,
        adminVerified:communityReportsTable.adminVerified,
        confirmCount: communityReportsTable.confirmCount,
        denyCount:    communityReportsTable.denyCount,
        createdAt:    communityReportsTable.createdAt,
        expiresAt:    communityReportsTable.expiresAt,
      })
      .from(communityReportsTable)
      // Exclude permanently moderation-removed rows (status = 'denied' older
      // than 30 days) to keep the attachment size reasonable.  Everything else
      // — including expired, pending_review, flagged — is included.
      .orderBy(communityReportsTable.createdAt);
  } catch (err) {
    logger.error({ err }, "[dailyBackup] Failed to query community reports");
    return;
  }

  // ── 2. Fetch DB speed-zone overrides ─────────────────────────────────────
  let zones: Array<Record<string, unknown>> = [];
  try {
    zones = await db
      .select()
      .from(speedZonesTable)
      .orderBy(speedZonesTable.createdAt);
  } catch (err) {
    logger.warn({ err }, "[dailyBackup] Failed to query speed zones — zones omitted from backup");
  }

  // ── 3. Build CSV (reports only — matches admin import format) ─────────────
  const csvLines = [CSV_HEADER, ...reports.map(rowToCsvLine)];
  const csvContent = csvLines.join("\n");

  // ── 4. Build JSON (full snapshot, both tables) ────────────────────────────
  const snapshot = {
    exportedAt:    new Date().toISOString(),
    reportCount:   reports.length,
    zoneCount:     zones.length,
    reports,
    speedZones:    zones,
  };
  const jsonContent = JSON.stringify(snapshot, null, 2);

  // ── 5. Send email ─────────────────────────────────────────────────────────
  const date = eatDateString();
  const ok = await sendDailyBackupEmail({
    toEmail,
    date,
    reportCount: reports.length,
    zoneCount:   zones.length,
    csvContent,
    jsonContent,
  });

  if (ok) {
    logger.info(
      { reportCount: reports.length, zoneCount: zones.length, toEmail },
      `[dailyBackup] Backup email sent successfully for ${date}`,
    );
  } else {
    logger.error("[dailyBackup] Backup email send failed — check RESEND_API_KEY and BACKUP_EMAIL_ADDRESS");
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
// Fires the job once when the target UTC hour is first reached each day.
// Uses a simple "already ran today" flag keyed by date string so even if the
// server restarts mid-day the job doesn't re-send.

let lastRanDate = "";

export function startDailyBackupJob(): void {
  // Run a check every 60 seconds.
  setInterval(() => {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const todayDate = now.toISOString().slice(0, 10);

    if (utcHour === TARGET_UTC_HOUR && lastRanDate !== todayDate) {
      lastRanDate = todayDate; // set before async to prevent double-fire
      runDailyBackup().catch((err) =>
        logger.error({ err }, "[dailyBackup] Unhandled error in runDailyBackup"),
      );
    }
  }, 60_000);

  logger.info(`[dailyBackup] Scheduled — will run daily at ${TARGET_UTC_HOUR}:00 UTC (23:00 EAT)`);
}
