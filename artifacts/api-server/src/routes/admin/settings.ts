import { Router, type Request, type Response } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logAudit } from "../../lib/audit.js";

const router = Router();

const REVIEWER_MODE_KEY = "reviewer_mode_enabled";

async function getReviewerModeEnabled(): Promise<boolean> {
  const rows = await db
    .select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, REVIEWER_MODE_KEY))
    .limit(1);
  // Default true when key doesn't exist yet — existing reviewer sessions
  // continue working until an admin explicitly disables.
  if (rows.length === 0) return true;
  return rows[0].value === "true";
}

// GET /admin/settings
router.get("/settings", async (_req: Request, res: Response) => {
  try {
    const reviewerModeEnabled = await getReviewerModeEnabled();
    return res.json({ reviewerModeEnabled });
  } catch (err) {
    console.error("GET /admin/settings error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /admin/settings/reviewer-mode
router.patch("/settings/reviewer-mode", async (req: Request, res: Response) => {
  const actor = (req as any).adminUser;
  const { enabled } = req.body as { enabled: boolean };

  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "'enabled' must be a boolean" });
  }

  try {
    await db
      .insert(appSettingsTable)
      .values({
        key:       REVIEWER_MODE_KEY,
        value:     enabled ? "true" : "false",
        updatedBy: actor?.name ?? "admin",
      })
      .onConflictDoUpdate({
        target: appSettingsTable.key,
        set: {
          value:     enabled ? "true" : "false",
          updatedBy: actor?.name ?? "admin",
          updatedAt: new Date(),
        },
      });

    await logAudit({
      actor:      { id: String(actor?.id ?? ""), name: actor?.name ?? "Admin", role: actor?.role ?? "admin" },
      action:     enabled ? "reviewer_mode_enabled" : "reviewer_mode_disabled",
      targetType: "app_settings",
      targetId:   REVIEWER_MODE_KEY,
      details:    { enabled },
    });

    return res.json({ reviewerModeEnabled: enabled });
  } catch (err) {
    console.error("PATCH /admin/settings/reviewer-mode error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
