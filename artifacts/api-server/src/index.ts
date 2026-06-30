import app from "./app";
import { logger } from "./lib/logger";
import { db, adminUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import { startExpireReportsJob } from "./jobs/expireReports";

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
  const ADMIN_EMAIL = "admin@safedrive.co.ke";
  try {
    const [existing] = await db
      .select({ id: adminUsersTable.id })
      .from(adminUsersTable)
      .where(eq(adminUsersTable.email, ADMIN_EMAIL));

    if (!existing) {
      const passwordHash = await bcrypt.hash("SafeDrive2024!", 12);
      await db.insert(adminUsersTable).values({
        email: ADMIN_EMAIL,
        name: "Super Admin",
        passwordHash,
        role: "admin",
      });
      logger.info("Default admin account created: admin@safedrive.co.ke");
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
  await seedDefaultAdmin();
  startExpireReportsJob();
});
