/**
 * admin/dashcam.ts — Admin-only dashcam monitoring endpoints.
 *
 * Routes:
 *   GET  /admin/dashcam/devices   — Per-device clip counts (gated on "dashboard" feature)
 */

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { dashcamClipsTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";

const router = Router();

const MAX_CLIPS_PER_DEVICE = 100;

/**
 * GET /admin/dashcam/devices
 *
 * Returns a summary of dashcam clip usage per enrolled device, sorted by
 * clip count descending. Used to identify drivers close to or at quota so
 * operators can reach out before uploads start silently failing.
 *
 * Response:
 *   {
 *     devices: Array<{
 *       deviceId: string;
 *       clipCount: number;        // total clips in cloud
 *       unlockedCount: number;    // clips eligible for eviction
 *       lockedCount: number;      // clips the driver has explicitly saved
 *       percentOfQuota: number;   // 0–100 (may exceed 100 in edge cases)
 *       quota: number;            // max clips per device (100)
 *     }>;
 *     quota: number;
 *   }
 */
router.get("/dashcam/devices", async (_req: Request, res: Response) => {
  try {
    const rows = await db.execute<{
      device_id: string;
      clip_count: string;
      unlocked_count: string;
    }>(sql`
      SELECT
        device_id,
        COUNT(*)::text                                    AS clip_count,
        COUNT(*) FILTER (WHERE locked = false)::text     AS unlocked_count
      FROM dashcam_clips
      GROUP BY device_id
      ORDER BY clip_count DESC
    `);

    const devices = ((rows as any).rows ?? rows).map((r: any) => {
      const clipCount     = parseInt(r.clip_count, 10);
      const unlockedCount = parseInt(r.unlocked_count, 10);
      return {
        deviceId:       r.device_id,
        clipCount,
        unlockedCount,
        lockedCount:    clipCount - unlockedCount,
        percentOfQuota: Math.round((clipCount / MAX_CLIPS_PER_DEVICE) * 100),
        quota:          MAX_CLIPS_PER_DEVICE,
      };
    });

    return res.json({ devices, quota: MAX_CLIPS_PER_DEVICE });
  } catch (err) {
    console.error("GET /admin/dashcam/devices error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
