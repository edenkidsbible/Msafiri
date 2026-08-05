import { Router, type Request, type Response } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

/**
 * GET /app-settings
 * Public — no auth required. Returns feature flags the mobile client needs
 * to decide which features to expose to users.
 */
router.get("/app-settings", async (_req: Request, res: Response) => {
  try {
    const [row] = await db
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.id, "singleton"));

    // Return defaults if the singleton row hasn't been created yet
    const navigationEnabled = row?.navigationEnabled ?? true;

    return res.json({ navigationEnabled });
  } catch (err) {
    // Fail open — if the DB is temporarily unavailable, enable navigation
    // so the app doesn't degrade for all users.
    return res.json({ navigationEnabled: true });
  }
});

export default router;
