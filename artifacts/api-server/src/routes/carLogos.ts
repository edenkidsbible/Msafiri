/**
 * Car brand logo proxy — serves make logos stored in R2.
 * Route: GET /car-logos/:makeId
 *
 * R2 key pattern:
 *   car-logos/{makeId}.png   ← source PNG (~200×100 transparent bg)
 *   car-logos/{makeId}.webp  ← cached conversion (created on demand)
 *
 * Returns 404 when the logo is not in R2 (mobile falls back to emoji).
 */

import { Router, type Request, type Response } from "express";
import sharp from "sharp";
import * as r2 from "../lib/r2Storage.js";

const router = Router();

// ── Key helpers ───────────────────────────────────────────────────────────────

export function carLogoKey(makeId: string): string {
  return `car-logos/${makeId}.png`;
}

function carLogoWebpKey(makeId: string): string {
  return `car-logos/${makeId}.webp`;
}

// ── Shared headers ────────────────────────────────────────────────────────────

function cacheHeaders(contentType: string, size: number) {
  return {
    "Content-Type": contentType,
    "Content-Length": String(size),
    "Cache-Control": "public, max-age=2592000, immutable", // 30 days
    "Vary": "Accept",
  };
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.get("/car-logos/:makeId", async (req: Request, res: Response) => {
  try {
    const { makeId } = req.params as { makeId: string };

    // Slug validation — only lowercase letters, digits, hyphens.
    if (!/^[a-z0-9-]+$/.test(makeId)) {
      return res.status(400).json({ error: "Invalid make id" });
    }

    if (!r2.isR2Configured()) {
      return res.status(503).json({ error: "Image storage not configured" });
    }

    const acceptsWebP = req.headers.accept?.includes("image/webp") ?? false;

    // ── WebP path ────────────────────────────────────────────────────────────
    if (acceptsWebP) {
      try {
        const cachedMeta = await r2.headObject(carLogoWebpKey(makeId));
        if (cachedMeta) {
          const { body } = await r2.getObjectStream(carLogoWebpKey(makeId));
          res.writeHead(200, cacheHeaders("image/webp", cachedMeta.size));
          body.pipe(res);
          return;
        }

        const pngMeta = await r2.headObject(carLogoKey(makeId));
        if (!pngMeta) {
          return res.status(404).json({ error: "Logo not found" });
        }

        // Convert PNG → WebP and cache in R2
        const png = await r2.downloadAsBuffer(carLogoKey(makeId));
        const webp = await sharp(png)
          .webp({ quality: 85, effort: 4 })
          .toBuffer();

        r2.uploadBuffer(carLogoWebpKey(makeId), webp, "image/webp").catch((err) =>
          console.error(`[car-logos] WebP upload failed for ${makeId}:`, err),
        );

        res.writeHead(200, cacheHeaders("image/webp", webp.length));
        res.end(webp);
        return;
      } catch {
        // Fall through to PNG
      }
    }

    // ── PNG path ─────────────────────────────────────────────────────────────
    const pngKey = carLogoKey(makeId);
    const meta = await r2.headObject(pngKey);
    if (!meta) {
      return res.status(404).json({ error: "Logo not found" });
    }

    const { body } = await r2.getObjectStream(pngKey);
    res.writeHead(200, cacheHeaders("image/png", meta.size));
    body.pipe(res);
    return;
  } catch (err) {
    console.error("GET /car-logos error:", err);
    return res.status(404).json({ error: "Logo not found" });
  }
});

export default router;
