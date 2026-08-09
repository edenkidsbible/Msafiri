/**
 * clipRedirect.ts — Branded short-link redirects for dashcam clips.
 *
 * GET /c/:token
 *
 * Public — no authentication required.  Looks up a clip by its share_token,
 * generates a fresh presigned R2 download URL, and issues a 302 redirect.
 *
 * The short link never expires on its own; the redirect simply 404s once the
 * underlying clip is deleted by the standard retention policy.
 */

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { dashcamClipsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isR2Configured, getPresignedDownloadUrl } from "../lib/r2Storage.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.get("/c/:token", async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };

  if (!token || token.length > 32) {
    return res.status(400).send("Invalid link.");
  }

  if (!isR2Configured()) {
    return res.status(503).send("Video storage is not configured.");
  }

  try {
    const [clip] = await db
      .select({ id: dashcamClipsTable.id, fileKey: dashcamClipsTable.fileKey })
      .from(dashcamClipsTable)
      .where(eq(dashcamClipsTable.shareToken, token))
      .limit(1);

    if (!clip) {
      return res.status(404).send(
        "This clip link has expired or the clip was deleted.",
      );
    }

    const downloadUrl = await getPresignedDownloadUrl(clip.fileKey);
    // 302 so browsers re-fetch on the next visit (presigned URLs expire in 1 h).
    return res.redirect(302, downloadUrl);
  } catch (err) {
    logger.error({ err, token }, "clipRedirect: failed to resolve short link");
    return res.status(500).send("Could not load clip. Please try again.");
  }
});

export default router;
