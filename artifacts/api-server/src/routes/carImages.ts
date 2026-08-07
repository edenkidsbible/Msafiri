/**
 * Car image proxy — serves transparent PNG car images stored in R2.
 * Route: GET /car-images/:makeId/:modelId
 *
 * R2 key pattern: car-images/{makeId}/{modelId}.png
 *
 * The mobile app calls this endpoint; it streams the PNG from R2 with a
 * long cache header.  Returns 404 when the image is missing so the app can
 * fall back to its emoji placeholder.
 */

import { Router, type Request, type Response } from "express";
import * as r2 from "../lib/r2Storage.js";

const router = Router();

function carImageKey(makeId: string, modelId: string): string {
  return `car-images/${makeId}/${modelId}.png`;
}

// GET /car-images/:makeId/:modelId
router.get("/car-images/:makeId/:modelId", async (req: Request, res: Response) => {
  try {
    const { makeId, modelId } = req.params as { makeId: string; modelId: string };

    // Basic slug validation — only allow lowercase letters, digits, hyphens.
    if (!/^[a-z0-9-]+$/.test(makeId) || !/^[a-z0-9-]+$/.test(modelId)) {
      return res.status(400).json({ error: "Invalid make/model id" });
    }

    if (!r2.isR2Configured()) {
      return res.status(503).json({ error: "Image storage not configured" });
    }

    const key = carImageKey(makeId, modelId);
    const meta = await r2.headObject(key);

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
      const { body, contentLength, contentRange } = await r2.getObjectStream(key, `bytes=${start}-${end}`);
      res.writeHead(206, {
        "Content-Range": contentRange ?? `bytes ${start}-${end}/${meta.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(contentLength || end - start + 1),
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=2592000", // 30 days
      });
      body.pipe(res);
      return;
    }

    const { body, contentLength } = await r2.getObjectStream(key);
    res.writeHead(200, {
      "Accept-Ranges": "bytes",
      "Content-Length": String(contentLength || meta.size),
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=2592000", // 30 days
    });
    body.pipe(res);
    return;
  } catch (err) {
    console.error("GET /car-images error:", err);
    return res.status(404).json({ error: "Image not found" });
  }
});

export { carImageKey };
export default router;
