import { Router, type Request, type Response } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logAudit } from "../../lib/audit.js";
import type { AdminJwtPayload } from "../../middleware/adminAuth.js";

const router = Router();

/**
 * GET /admin/settings
 * Returns current app settings. Requires admin JWT (enforced by parent router).
 */
router.get("/settings", async (_req: Request, res: Response) => {
  try {
    const [row] = await db
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.id, "singleton"));

    const navigationEnabled = row?.navigationEnabled ?? true;
    return res.json({ navigationEnabled });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load settings" });
  }
});

/**
 * PUT /admin/settings
 * Updates app settings. Requires admin JWT (enforced by parent router).
 */
router.put("/settings", async (req: Request, res: Response) => {
  try {
    const { navigationEnabled } = req.body as { navigationEnabled?: boolean };
    if (typeof navigationEnabled !== "boolean") {
      return res.status(400).json({ error: "navigationEnabled must be a boolean" });
    }

    await db
      .insert(appSettingsTable)
      .values({ id: "singleton", navigationEnabled, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettingsTable.id,
        set: { navigationEnabled, updatedAt: new Date() },
      });

    const actor = (req as any).adminUser as AdminJwtPayload;
    await logAudit({
      actor: { id: actor.id, name: actor.name, role: actor.role },
      action: "update_app_settings",
      targetType: "app_settings",
      targetId: "singleton",
      details: { navigationEnabled },
    });

    return res.json({ navigationEnabled });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update settings" });
  }
});

export default router;
