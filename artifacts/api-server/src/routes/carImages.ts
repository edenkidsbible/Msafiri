/**
 * Car image proxy — serves car images stored in R2.
 * Route: GET /car-images/:makeId/:modelId
 *
 * R2 key patterns:
 *   car-images/{makeId}/{modelId}.png   ← original source
 *   car-images/{makeId}/{modelId}.webp  ← cached conversion (created on demand)
 *
 * WebP conversion (lazy, cached):
 *   If the client sends `Accept: image/webp` (React Native on iOS/Android does
 *   this automatically), the server checks for a pre-converted .webp in R2.
 *   On a miss it downloads the .png, converts it with sharp, stores the .webp
 *   back in R2, then serves it.  Subsequent requests hit the cached WebP
 *   directly — no reprocessing.  Falls back silently to PNG on any error.
 *
 *   Typical savings: 40–60 % vs PNG for the same visual quality.
 */

import { Router, type Request, type Response } from "express";
import sharp from "sharp";
import * as r2 from "../lib/r2Storage.js";

const router = Router();

// ── Key helpers ───────────────────────────────────────────────────────────────

export function carImageKey(makeId: string, modelId: string): string {
  return `car-images/${makeId}/${modelId}.png`;
}

function webpKey(makeId: string, modelId: string): string {
  return `car-images/${makeId}/${modelId}.webp`;
}

// ── Shared headers ────────────────────────────────────────────────────────────

function cacheHeaders(contentType: string, size: number) {
  return {
    "Content-Type": contentType,
    "Content-Length": String(size),
    "Cache-Control": "public, max-age=2592000, immutable", // 30 days
    "Accept-Ranges": "bytes",
    "Vary": "Accept",
  };
}

// ── WebP conversion + R2 upload (fire-and-forget safe) ───────────────────────

/**
 * Download the PNG, convert to WebP, upload to R2, and return the WebP buffer.
 * Throws if the source PNG doesn't exist or conversion fails — callers catch.
 */
async function convertAndCache(makeId: string, modelId: string): Promise<Buffer> {
  const png = await r2.downloadAsBuffer(carImageKey(makeId, modelId));

  const webp = await sharp(png)
    .webp({ quality: 82, effort: 4 })   // quality 82 ≈ visually lossless for car photos
    .toBuffer();

  // Upload in the background so the first-ever request doesn't wait for the PUT.
  r2.uploadBuffer(webpKey(makeId, modelId), webp, "image/webp").catch((err) =>
    console.error(`[car-images] WebP upload failed for ${makeId}/${modelId}:`, err),
  );

  return webp;
}

// ── Route handler ─────────────────────────────────────────────────────────────

router.get("/car-images/:makeId/:modelId", async (req: Request, res: Response) => {
  try {
    const { makeId, modelId } = req.params as { makeId: string; modelId: string };

    // Slug validation — only lowercase letters, digits, hyphens.
    if (!/^[a-z0-9-]+$/.test(makeId) || !/^[a-z0-9-]+$/.test(modelId)) {
      return res.status(400).json({ error: "Invalid make/model id" });
    }

    if (!r2.isR2Configured()) {
      return res.status(503).json({ error: "Image storage not configured" });
    }

    const acceptsWebP = req.headers.accept?.includes("image/webp") ?? false;

    // ── WebP path ────────────────────────────────────────────────────────────
    if (acceptsWebP) {
      try {
        // 1. Check for cached WebP in R2.
        const cachedMeta = await r2.headObject(webpKey(makeId, modelId));

        if (cachedMeta) {
          // Cache hit — stream directly.
          const { body } = await r2.getObjectStream(webpKey(makeId, modelId));
          res.writeHead(200, cacheHeaders("image/webp", cachedMeta.size));
          body.pipe(res);
          return;
        }

        // 2. Cache miss — verify the source PNG exists before converting.
        const pngMeta = await r2.headObject(carImageKey(makeId, modelId));
        if (!pngMeta) {
          return res.status(404).json({ error: "Image not found" });
        }

        // 3. Convert PNG → WebP, store in R2, serve the result.
        const webpBuf = await convertAndCache(makeId, modelId);
        res.writeHead(200, cacheHeaders("image/webp", webpBuf.length));
        res.end(webpBuf);
        return;
      } catch (webpErr) {
        // Conversion failed — fall through to PNG below.
        console.warn(`[car-images] WebP conversion failed for ${makeId}/${modelId}, serving PNG:`, webpErr);
      }
    }

    // ── PNG path (fallback + non-WebP clients) ───────────────────────────────
    const pngKey = carImageKey(makeId, modelId);
    const meta = await r2.headObject(pngKey);
    if (!meta) {
      return res.status(404).json({ error: "Image not found" });
    }

    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      const rangeMatch = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
      if (!rangeMatch) {
        res.setHeader("Content-Range", `bytes */${meta.size}`);
        return res.status(416).json({ error: "Range Not Satisfiable" });
      }
      const start = parseInt(rangeMatch[1], 10);
      const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : meta.size - 1;
      if (isNaN(start) || isNaN(end) || start > end || start >= meta.size || end >= meta.size) {
        res.setHeader("Content-Range", `bytes */${meta.size}`);
        return res.status(416).json({ error: "Range Not Satisfiable" });
      }
      const { body, contentLength, contentRange } = await r2.getObjectStream(pngKey, `bytes=${start}-${end}`);
      res.writeHead(206, {
        "Content-Range": contentRange ?? `bytes ${start}-${end}/${meta.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(contentLength || end - start + 1),
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=2592000, immutable",
        "Vary": "Accept",
      });
      body.pipe(res);
      return;
    }

    const { body } = await r2.getObjectStream(pngKey);
    res.writeHead(200, cacheHeaders("image/png", meta.size));
    body.pipe(res);
    return;
  } catch (err) {
    console.error("GET /car-images error:", err);
    return res.status(404).json({ error: "Image not found" });
  }
});

export default router;
