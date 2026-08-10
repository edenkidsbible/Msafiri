/**
 * Data Backup routes
 *
 * POST /backup/sync — upload vehicle + settings snapshot (used by OTP recovery flow)
 */
import { Router, type Request, type Response } from "express";
import { db, deviceBackupsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// ── POST /backup/sync ──────────────────────────────────────────────────────────
router.post("/backup/sync", async (req: Request, res: Response) => {
  const { deviceId, vehicles, settings } = req.body as {
    deviceId?: string;
    vehicles?: unknown[];
    settings?: Record<string, unknown>;
  };
  if (!deviceId) return res.status(400).json({ error: "deviceId is required" });

  const vehiclesJson = JSON.stringify(vehicles ?? []);
  const settingsJson = JSON.stringify(settings ?? {});

  const updated = await db
    .update(deviceBackupsTable)
    .set({ vehiclesJson, settingsJson, lastBackupAt: new Date() })
    .where(eq(deviceBackupsTable.deviceId, deviceId))
    .returning({ id: deviceBackupsTable.id });

  if (updated.length === 0) {
    // Auto-create record if none exists yet (first sync after OTP link)
    await db.insert(deviceBackupsTable).values({
      recoveryCode: "",   // legacy column — no longer used
      deviceId,
      vehiclesJson,
      settingsJson,
    });
  }

  return res.json({ ok: true });
});

export default router;
