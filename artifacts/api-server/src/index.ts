import app from "./app";
import { logger } from "./lib/logger";
import { db, adminUsersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcrypt";
import { startExpireReportsJob } from "./jobs/expireReports";
import { startPushNotificationsJob } from "./jobs/pushNotifications";
import { startDailyBackupJob } from "./jobs/dailyBackup";
import { seedCourseIfEmpty } from "./startup/seedCourse";
import { backfillCourseAudio } from "./startup/backfillCourseAudio";
import { backfillR2Media } from "./startup/backfillR2Media";
import { dedupPushTokens } from "./startup/dedupPushTokens";
import { migrateSchema } from "./startup/migrateSchema";
import { syncStaticZones } from "./startup/syncStaticZones";
import { seedPois } from "./startup/seedPois";
import { seedOpsData } from "./startup/seedOpsData";
import { retryPendingCarImages, retryPendingLogos } from "./routes/customVehicles.js";
import { startHereTrafficJob } from "./jobs/hereTraffic";
import { startPromoteScheduledReleasesJob } from "./jobs/promoteScheduledReleases";
import { startClusterHazardsJob } from "./jobs/clusterHazards";
import { startPurgePhotoOrphansJob } from "./jobs/purgePhotoOrphans";
import { startAbandonDraftAccidentsJob } from "./jobs/abandonDraftAccidents";
import { setupOpsChatWs } from "./lib/opsChatHub";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

if (!process.env.ADMIN_JWT_SECRET) {
  throw new Error(
    "ADMIN_JWT_SECRET environment variable is required but not set.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function seedDefaultAdmin() {
  const ADMIN_EMAIL = "admin@msafirikenya.com";
  try {
    const [existing] = await db
      .select({ id: adminUsersTable.id })
      .from(adminUsersTable)
      .where(eq(adminUsersTable.email, ADMIN_EMAIL));

    if (!existing) {
      const passwordHash = await bcrypt.hash("Msafiri2024!", 12);
      await db.insert(adminUsersTable).values({
        email: ADMIN_EMAIL,
        name: "Super Admin",
        passwordHash,
        role: "admin",
        mustChangePassword: true,
      });
      logger.info("Default admin account created: admin@msafirikenya.com (must change password on first login)");
    }
  } catch (err) {
    logger.warn({ err }, "Could not seed default admin — may already exist or DB unavailable");
  }
}

/**
 * Auto-link every admin_user to ops_team_members so the Team page is
 * populated on a fresh install without any manual "add member" step.
 *
 * Runs AFTER seedDefaultAdmin so the default admin account (created in
 * that step) is guaranteed to be present before we attempt the INSERT.
 *
 * Role mapping: founder → founder | admin → admin | moderator → member | * → member
 *
 * The INSERT uses ON CONFLICT (admin_user_id) DO NOTHING which is safe
 * because migrateSchema() creates a UNIQUE INDEX on that column before
 * this function is called.  Concurrent restarts therefore cannot produce
 * duplicate rows.
 */
async function seedOpsTeamMembers() {
  try {
    await db.execute(sql`
      INSERT INTO ops_team_members (admin_user_id, role)
      SELECT
        au.id::text,
        CASE au.role
          WHEN 'founder'   THEN 'founder'
          WHEN 'admin'     THEN 'admin'
          WHEN 'moderator' THEN 'member'
          ELSE                  'member'
        END
      FROM admin_users au
      ON CONFLICT (admin_user_id) DO NOTHING
    `);
  } catch (err) {
    logger.warn({ err }, "seedOpsTeamMembers: could not auto-link admin accounts");
  }
}

const server = app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // ── Startup tasks wrapped in an aggregate catch ───────────────────────────
  // A failure in any one task (e.g. a DB migration hiccup, an empty seed file)
  // must not leave the process stuck in a half-started state with no error
  // message.  We log the error and exit cleanly so the process manager can
  // restart the server rather than serving requests from a broken state.
  try {
    await migrateSchema();
    await seedDefaultAdmin();
    await seedOpsTeamMembers();
    await syncStaticZones();
    await seedCourseIfEmpty();
    await backfillCourseAudio();
    await dedupPushTokens();
    await seedPois();
    await seedOpsData(logger);
  } catch (startupErr) {
    logger.error({ err: startupErr }, "Startup task failed — exiting");
    process.exit(1);
  }

  // Background jobs are started after all startup tasks succeed so they
  // never run against a partially-migrated schema.
  startExpireReportsJob();
  startPushNotificationsJob();
  startDailyBackupJob();
  startHereTrafficJob();
  startPromoteScheduledReleasesJob();
  startClusterHazardsJob();
  startPurgePhotoOrphansJob();
  startAbandonDraftAccidentsJob();

  // One-time (idempotent) copy of legacy media into R2 — runs in the
  // background so startup latency is unaffected.
  backfillR2Media().catch((err) =>
    logger.error({ err }, "R2 media backfill crashed"),
  );

  // Retry any custom vehicle images left in "pending" state (e.g. from a
  // previous server run before the Wikipedia-based lookup was in place).
  retryPendingCarImages().catch((err) =>
    logger.error({ err }, "retryPendingCarImages crashed"),
  );

  // Retry any custom make logos left in "pending" state.
  retryPendingLogos().catch((err) =>
    logger.error({ err }, "retryPendingLogos crashed"),
  );
});

// WebSocket hub for the ops team chat (/api/ops/chat/ws). Attached to the
// HTTP server directly — Express never sees upgrade requests.
setupOpsChatWs(server);
