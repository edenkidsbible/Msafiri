/**
 * Public settings endpoint consumed by the mobile app.
 * No auth required — only exposes non-sensitive flags.
 */
import { Router, type Request, type Response } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// GET /settings/reviewer-mode
// Mobile app checks this on startup. If the admin has disabled reviewer mode
// after a review cycle, the app clears any locally-stored bypass.
router.get("/settings/reviewer-mode", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, "reviewer_mode_enabled"))
      .limit(1);

    // Default open when no row exists (backward-compat for existing reviewer sessions)
    const enabled = rows.length === 0 ? true : rows[0].value === "true";
    return res.json({ enabled });
  } catch (err) {
    console.error("GET /settings/reviewer-mode error:", err);
    // Fail open on DB errors — don't accidentally lock out an active review
    return res.json({ enabled: true });
  }
});

export default router;
