import { Router, type Request, type Response } from "express";
import { db, deviceTrialSessionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router = Router();

/** Number of free drive sessions before the trial expires. */
const FREE_TRIAL_SESSIONS = 3;

/**
 * POST /trial/session
 * Records one completed drive session for the given stable device ID.
 * Creates a row if none exists; increments the counter otherwise (upsert).
 *
 * Body: { stableDeviceId: string }
 * Returns: { sessionCount: number; trialExpired: boolean }
 */
router.post("/trial/session", async (req: Request, res: Response) => {
  const { stableDeviceId } = (req.body ?? {}) as { stableDeviceId?: unknown };

  if (!stableDeviceId || typeof stableDeviceId !== "string" || stableDeviceId.trim() === "") {
    return res.status(400).json({ error: "stableDeviceId required" });
  }

  try {
    await db.execute(sql`
      INSERT INTO device_trial_sessions (stable_device_id, session_count, created_at, updated_at)
      VALUES (${stableDeviceId}, 1, NOW(), NOW())
      ON CONFLICT (stable_device_id) DO UPDATE
        SET session_count = device_trial_sessions.session_count + 1,
            updated_at    = NOW()
    `);

    const [row] = await db
      .select()
      .from(deviceTrialSessionsTable)
      .where(eq(deviceTrialSessionsTable.stableDeviceId, stableDeviceId))
      .limit(1);

    const count = row?.sessionCount ?? 1;
    return res.json({ sessionCount: count, trialExpired: count >= FREE_TRIAL_SESSIONS });
  } catch (err) {
    console.error("[trial] POST /trial/session error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /trial/status?stableDeviceId=xxx
 * Returns the current session count and whether the trial has expired.
 * Returns { sessionCount: 0, trialExpired: false } for unknown device IDs
 * so fresh installs are correctly treated as in-trial.
 */
router.get("/trial/status", async (req: Request, res: Response) => {
  const stableDeviceId = req.query["stableDeviceId"] as string | undefined;

  if (!stableDeviceId || stableDeviceId.trim() === "") {
    return res.status(400).json({ error: "stableDeviceId required" });
  }

  try {
    const [row] = await db
      .select()
      .from(deviceTrialSessionsTable)
      .where(eq(deviceTrialSessionsTable.stableDeviceId, stableDeviceId))
      .limit(1);

    const count = row?.sessionCount ?? 0;
    return res.json({ sessionCount: count, trialExpired: count >= FREE_TRIAL_SESSIONS });
  } catch (err) {
    console.error("[trial] GET /trial/status error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
