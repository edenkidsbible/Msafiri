/**
 * Daily backup job — runs once per day at 23:00 EAT (20:00 UTC).
 *
 * buildBackupSnapshot() — queries every important table and returns the full
 *   data object. Shared between the scheduled job and the on-demand admin API.
 *
 * runDailyBackup() — always runs pg_dump → R2 (primary disaster-recovery
 *   backup) when R2 is configured, then optionally sends a JSON + CSV email
 *   snapshot to BACKUP_EMAIL_ADDRESS if that env var is set. The two paths
 *   are independent: a missing email address never prevents the R2 dump, and
 *   an email failure never rolls back the already-uploaded dump.
 */

import { db } from "@workspace/db";
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
import { sendDailyBackupEmail } from "../lib/email.js";
import { tryDumpToR2, tryPruneOldDumps } from "../lib/pgDump.js";
import { isR2Configured } from "../lib/r2Storage.js";
import { logger } from "../lib/logger.js";

// Target hour in UTC — 20:00 UTC = 23:00 EAT
const TARGET_UTC_HOUR = 20;

// ── Report CSV (matches admin import format) ───────────────────────────────────

const CSV_HEADER = "id,type,status,roadName,lat,lng,speedLimit,adminVerified,confirmCount,denyCount,createdAt,expiresAt";

function escapeCsv(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function reportToCsvLine(r: Record<string, unknown>): string {
  return [
    r.id, r.type, r.status, r.roadName, r.lat, r.lng, r.speedLimit,
    r.adminVerified, r.confirmCount, r.denyCount,
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

// ── Snapshot ───────────────────────────────────────────────────────────────────

export interface BackupSnapshot {
  version:    number;
  exportedAt: string;
  stats:      Record<string, number>;
  tables:     Record<string, unknown[]>;
}

/**
 * Queries every important table and returns the full backup snapshot.
 * This is the single source of truth — used by both the scheduled email job
 * and the on-demand admin export/run endpoints.
 *
 * Tables deliberately excluded:
 *   • audit_logs             — very large event log, not worth restoring
 *   • sharing_sessions       — ephemeral real-time sessions
 *   • dashcam_enrollment_*   — transient OTPs
 *   • dashcam_upload_intents — transient upload tokens
 *   • dashcam_reg_ratelimit  — ephemeral rate-limit buckets
 *   • crash_trigger_events   — raw sensor event log, very large
 *   • emergency_alerts_log   — historical event log
 *   • admin_notifications    — ephemeral inbox items
 *   • dashcam_devices        — device auth (secrets are hashed; restored via OTP flow)
 *
 * Binary assets (dashcam clips, accident photos, PDFs, TTS audio, car images)
 * live in Cloudflare R2 and are NOT included — they are already persistent and
 * survive restarts independently. The backup includes the Postgres *metadata*
 * rows (fileKey references) so R2 objects remain accessible after a restore.
 */
export async function buildBackupSnapshot(): Promise<BackupSnapshot> {
  const fetch = async <T>(label: string, query: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await query();
    } catch (err) {
      logger.warn({ err }, `[dailyBackup] Failed to query ${label} — omitted from snapshot`);
      return [];
    }
  };

  const [
    communityReports,
    speedZones,
    savedPlaces,
    plannedTrips,
    deviceBackups,
    sharedVehicles,
    vehicleMembers,
    vehicleJoinRequests,
    emergencyContacts,
    pushTokens,
    courseChapters,
    courseLessons,
    courseQuizQuestions,
    userCourseProgress,
    userCourseBookmarks,
    pois,
    appSettings,
    adminUsers,
    blogPosts,
    appReleases,
    creatorApplications,
    promoCodes,
    accidentRecords,
    accidentPhotos,
    accidentWitnesses,
    accidentTimelineEvents,
    dashcamClips,
    brakingEvents,
    hazardClusters,
    pushCampaigns,
    blockedDevices,
    customVehicles,
  ] = await Promise.all([
    fetch("community_reports",        () => db.select().from(communityReportsTable).orderBy(communityReportsTable.createdAt)),
    fetch("speed_zones",              () => db.select().from(speedZonesTable).orderBy(speedZonesTable.createdAt)),
    fetch("saved_places",             () => db.select().from(savedPlacesTable).orderBy(savedPlacesTable.createdAt)),
    fetch("planned_trips",            () => db.select().from(plannedTripsTable).orderBy(plannedTripsTable.createdAt)),
    fetch("device_backups",           () => db.select().from(deviceBackupsTable)),
    fetch("shared_vehicles",          () => db.select().from(sharedVehiclesTable).orderBy(sharedVehiclesTable.createdAt)),
    fetch("vehicle_members",          () => db.select().from(vehicleMembersTable).orderBy(vehicleMembersTable.createdAt)),
    fetch("vehicle_join_requests",    () => db.select().from(vehicleJoinRequestsTable).orderBy(vehicleJoinRequestsTable.createdAt)),
    fetch("emergency_contacts",       () => db.select().from(emergencyContactsTable).orderBy(emergencyContactsTable.createdAt)),
    fetch("push_tokens",              () => db.select().from(pushTokensTable).orderBy(pushTokensTable.createdAt)),
    fetch("course_chapters",          () => db.select().from(courseChaptersTable).orderBy(courseChaptersTable.order)),
    fetch("course_lessons",           () => db.select().from(courseLessonsTable).orderBy(courseLessonsTable.order)),
    fetch("course_quiz_questions",    () => db.select().from(courseQuizQuestionsTable)),
    fetch("user_course_progress",     () => db.select().from(userCourseProgressTable)),
    fetch("user_course_bookmarks",    () => db.select().from(userCourseBookmarksTable)),
    fetch("pois",                     () => db.select().from(poisTable).orderBy(poisTable.createdAt)),
    fetch("app_settings",             () => db.select().from(appSettingsTable)),
    fetch("admin_users",              () => db.select().from(adminUsersTable).orderBy(adminUsersTable.createdAt)),
    fetch("blog_posts",               () => db.select().from(blogPostsTable).orderBy(blogPostsTable.createdAt)),
    fetch("app_releases",             () => db.select().from(appReleasesTable).orderBy(appReleasesTable.createdAt)),
    fetch("creator_applications",     () => db.select().from(creatorApplicationsTable).orderBy(creatorApplicationsTable.createdAt)),
    fetch("promo_codes",              () => db.select().from(promoCodesTable).orderBy(promoCodesTable.createdAt)),
    fetch("accident_records",         () => db.select().from(accidentRecordsTable).orderBy(accidentRecordsTable.createdAt)),
    fetch("accident_photos",          () => db.select().from(accidentPhotosTable).orderBy(accidentPhotosTable.createdAt)),
    fetch("accident_witnesses",       () => db.select().from(accidentWitnessesTable).orderBy(accidentWitnessesTable.createdAt)),
    fetch("accident_timeline_events", () => db.select().from(accidentTimelineEventsTable).orderBy(accidentTimelineEventsTable.occurredAt)),
    fetch("dashcam_clips",            () => db.select().from(dashcamClipsTable).orderBy(dashcamClipsTable.createdAt)),
    fetch("braking_events",           () => db.select().from(brakingEventsTable).orderBy(brakingEventsTable.createdAt)),
    fetch("hazard_clusters",          () => db.select().from(hazardClustersTable).orderBy(hazardClustersTable.createdAt)),
    fetch("push_campaigns",           () => db.select().from(pushCampaignsTable).orderBy(pushCampaignsTable.createdAt)),
    fetch("blocked_devices",          () => db.select().from(blockedDevicesTable).orderBy(blockedDevicesTable.createdAt)),
    fetch("custom_vehicles",          () => db.select().from(customVehiclesTable).orderBy(customVehiclesTable.createdAt)),
  ]);

  const tables = {
    communityReports,
    speedZones,
    savedPlaces,
    plannedTrips,
    deviceBackups,
    sharedVehicles,
    vehicleMembers,
    vehicleJoinRequests,
    emergencyContacts,
    pushTokens,
    courseChapters,
    courseLessons,
    courseQuizQuestions,
    userCourseProgress,
    userCourseBookmarks,
    pois,
    appSettings,
    adminUsers,
    blogPosts,
    appReleases,
    creatorApplications,
    promoCodes,
    accidentRecords,
    accidentPhotos,
    accidentWitnesses,
    accidentTimelineEvents,
    dashcamClips,
    brakingEvents,
    hazardClusters,
    pushCampaigns,
    blockedDevices,
    customVehicles,
  } as Record<string, unknown[]>;

  const stats: Record<string, number> = {};
  for (const [k, v] of Object.entries(tables)) stats[k] = v.length;

  return {
    version:    2,
    exportedAt: new Date().toISOString(),
    stats,
    tables,
  };
}

// ── Scheduled job ──────────────────────────────────────────────────────────────

async function runDailyBackup(): Promise<void> {
  logger.info("[dailyBackup] Starting daily backup…");
  const date = eatDateString();

  // ── pg_dump → R2 (primary backup — always runs when R2 is configured) ──────
  // This is the disaster-recovery restore point. It runs independently of the
  // email snapshot so a missing BACKUP_EMAIL_ADDRESS never prevents it.
  if (isR2Configured()) {
    const dump = await tryDumpToR2();
    if (dump) {
      logger.info(
        { key: dump.key, sizeBytes: dump.sizeBytes, durationMs: dump.durationMs },
        "[dailyBackup] pg_dump uploaded to R2",
      );
    } else {
      logger.warn("[dailyBackup] pg_dump to R2 failed");
    }

    // Prune dumps older than 30 days (best-effort, never throws)
    await tryPruneOldDumps();
  } else {
    logger.warn("[dailyBackup] R2 not configured — skipping pg_dump");
  }

  // ── Email snapshot (optional — only when BACKUP_EMAIL_ADDRESS is set) ───────
  // Runs after the R2 dump so a slow snapshot/email never delays the primary backup.
  const toEmail = process.env["BACKUP_EMAIL_ADDRESS"];
  if (!toEmail) {
    logger.info("[dailyBackup] BACKUP_EMAIL_ADDRESS not set — skipping email snapshot");
    return;
  }

  try {
    const snapshot = await buildBackupSnapshot();
    const { tables, stats } = snapshot;

    // Build reports CSV for direct admin import
    const reports = tables.communityReports as Array<Record<string, unknown>>;
    const csvLines = [CSV_HEADER, ...reports.map(reportToCsvLine)];
    const csvContent = csvLines.join("\n");
    const jsonContent = JSON.stringify(snapshot, null, 2);

    const ok = await sendDailyBackupEmail({
      toEmail,
      date,
      stats,
      csvContent,
      jsonContent,
    });

    if (ok) {
      logger.info({ stats, toEmail }, `[dailyBackup] Backup email sent for ${date}`);
    } else {
      logger.error("[dailyBackup] Backup email failed — check RESEND_API_KEY and BACKUP_EMAIL_ADDRESS");
    }
  } catch (err) {
    // A snapshot/email failure must never abort the job — the R2 dump already succeeded above.
    logger.error({ err }, "[dailyBackup] Email snapshot failed — R2 dump was already uploaded");
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let lastRanDate = "";

export function startDailyBackupJob(): void {
  setInterval(() => {
    const now = new Date();
    const utcHour  = now.getUTCHours();
    const todayDate = now.toISOString().slice(0, 10);

    if (utcHour === TARGET_UTC_HOUR && lastRanDate !== todayDate) {
      lastRanDate = todayDate;
      runDailyBackup().catch((err) =>
        logger.error({ err }, "[dailyBackup] Unhandled error in runDailyBackup"),
      );
    }
  }, 60_000);

  logger.info(`[dailyBackup] Scheduled — will run daily at ${TARGET_UTC_HOUR}:00 UTC (23:00 EAT)`);
}

// Re-export so admin routes can trigger a backup on demand
export { runDailyBackup };
