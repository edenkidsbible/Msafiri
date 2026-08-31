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
    const roadChannelsEnabled = row?.roadChannelsEnabled ?? false;
    return res.json({ navigationEnabled, roadChannelsEnabled });
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
    const { navigationEnabled, roadChannelsEnabled } = req.body as {
      navigationEnabled?: boolean;
      roadChannelsEnabled?: boolean;
    };
    if (navigationEnabled === undefined && roadChannelsEnabled === undefined) {
      return res.status(400).json({ error: "At least one setting is required" });
    }
    if (navigationEnabled !== undefined && typeof navigationEnabled !== "boolean") {
      return res.status(400).json({ error: "navigationEnabled must be a boolean" });
    }
    if (roadChannelsEnabled !== undefined && typeof roadChannelsEnabled !== "boolean") {
      return res.status(400).json({ error: "roadChannelsEnabled must be a boolean" });
    }

    const [current] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, "singleton"));
    const nextNavigation = navigationEnabled ?? current?.navigationEnabled ?? true;
    const nextRoadChannels = roadChannelsEnabled ?? current?.roadChannelsEnabled ?? false;
    await db
      .insert(appSettingsTable)
      .values({
        id: "singleton",
        navigationEnabled: nextNavigation,
        roadChannelsEnabled: nextRoadChannels,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: appSettingsTable.id,
        set: {
          navigationEnabled: nextNavigation,
          roadChannelsEnabled: nextRoadChannels,
          updatedAt: new Date(),
        },
      });

    const actor = (req as any).adminUser as AdminJwtPayload;
    await logAudit({
      actor: { id: actor.id, name: actor.name, role: actor.role },
      action: "update_app_settings",
      targetType: "app_settings",
      targetId: "singleton",
      details: { navigationEnabled: nextNavigation, roadChannelsEnabled: nextRoadChannels },
    });

    return res.json({ navigationEnabled: nextNavigation, roadChannelsEnabled: nextRoadChannels });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update settings" });
  }
});

export default router;
