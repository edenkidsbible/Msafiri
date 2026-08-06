import app from "./app";
import { logger } from "./lib/logger";
import { db, adminUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import { startExpireReportsJob } from "./jobs/expireReports";
import { startPushNotificationsJob } from "./jobs/pushNotifications";
import { startDailyBackupJob } from "./jobs/dailyBackup";
import { seedCourseIfEmpty } from "./startup/seedCourse";
import { backfillCourseAudio } from "./startup/backfillCourseAudio";
import { dedupPushTokens } from "./startup/dedupPushTokens";
import { migrateSchema } from "./startup/migrateSchema";
import { syncStaticZones } from "./startup/syncStaticZones";
import { seedPois } from "./startup/seedPois";
import { startHereTrafficJob } from "./jobs/hereTraffic";
import { startPromoteScheduledReleasesJob } from "./jobs/promoteScheduledReleases";
import { startClusterHazardsJob } from "./jobs/clusterHazards";

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

app.listen(port, async (err) => {
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
    await syncStaticZones();
    await seedCourseIfEmpty();
    await backfillCourseAudio();
    await dedupPushTokens();
    await seedPois();
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
});
