/**
 * Admin-triggered maintenance jobs.
 * POST /admin/jobs/:jobName  — runs the named job synchronously and returns stats.
 * Restricted to the "app_settings" permission (super-admins only).
 */
import { Router, type Request, type Response } from "express";
import { runPurgePhotoOrphans } from "../../jobs/purgePhotoOrphans.js";
import { runAbandonDraftAccidents } from "../../jobs/abandonDraftAccidents.js";
import { logger } from "../../lib/logger.js";

const router = Router();

router.post("/:jobName", async (req: Request, res: Response) => {
  const { jobName } = req.params as { jobName: string };

  switch (jobName) {
    case "purge-photo-orphans": {
      try {
        const result = await runPurgePhotoOrphans();
        logger.info(
          { actor: (req as any).adminUser?.email, result },
          "admin: manual purge-photo-orphans run",
        );
        res.json({ ok: true, job: jobName, result });
      } catch (err) {
        logger.error({ err }, "admin: purge-photo-orphans failed");
        res.status(500).json({ error: "Job failed — check server logs" });
      }
      break;
    }

    case "abandon-draft-accidents": {
      try {
        const result = await runAbandonDraftAccidents();
        logger.info(
          { actor: (req as any).adminUser?.email, result },
          "admin: manual abandon-draft-accidents run",
        );
        res.json({ ok: true, job: jobName, result });
      } catch (err) {
        logger.error({ err }, "admin: abandon-draft-accidents failed");
        res.status(500).json({ error: "Job failed — check server logs" });
      }
      break;
    }

    default:
      res.status(404).json({ error: `Unknown job: ${jobName}` });
  }
});

export default router;
