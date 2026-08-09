/**
 * Custom vehicle capture & deduplication.
 *
 * GET  /custom-vehicles          — full list (for mobile picker merge)
 * POST /custom-vehicles          — submit / increment a custom make+model
 *
 * Deduplication: two users submitting the same (makeSlug, modelSlug) pair
 * will share one row; only the submittedCount increments.
 *
 * Image sourcing: when a new record is created the server queues an async
 * job that fetches the real manufacturer press photo from Wikipedia's
 * pageimages API (free, no API key, uses official article thumbnail).
 * The image is stored in R2 at: car-images/{makeSlug}/{modelSlug}.png
 *
 * imageStatus lifecycle:
 *   "pending"   → job queued, not yet complete
 *   "done"      → real photo found and stored in R2
 *   "not_found" → Wikipedia had no usable image; app shows emoji fallback
 */

import { Router, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { db, customVehiclesTable } from "@workspace/db";
import * as r2 from "../lib/r2Storage.js";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

const router = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Remove the background from a car press photo using ImageMagick's flood-fill.
 *
 * Wikipedia manufacturer press photos use uniform white or light-grey
 * backgrounds which flood-fill handles perfectly.  Seeds from all 4 corners
 * with 20% fuzz (captures near-white anti-aliased edges without eating into
 * the car body).
 *
 * Returns a PNG32 buffer with a transparency channel — matches the format
 * of our other car assets.
 */
async function removeBackground(input: Buffer): Promise<Buffer> {
  const id = `car-bg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmpIn  = path.join(os.tmpdir(), `${id}-in.png`);
  const tmpOut = path.join(os.tmpdir(), `${id}-out.png`);
  try {
    await fs.writeFile(tmpIn, input);
    await execFileAsync("magick", [
      tmpIn,
      "-fuzz", "8%",
      "-fill", "none",
      // Flood-fill transparent starting from all four corners so the
      // entire surrounding background is erased even when it isn't
      // perfectly uniform (e.g. slight gradient from studio lighting).
      "-draw", "color 0,0 floodfill",
      "-draw", "color 0,%[fx:h-1] floodfill",
      "-draw", "color %[fx:w-1],0 floodfill",
      "-draw", "color %[fx:w-1],%[fx:h-1] floodfill",
      `PNG32:${tmpOut}`,
    ]);
    return await fs.readFile(tmpOut);
  } finally {
    await Promise.all([
      fs.unlink(tmpIn).catch(() => {}),
      fs.unlink(tmpOut).catch(() => {}),
    ]);
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Fetch the real manufacturer press photo from Wikipedia's pageimages API.
 *
 * Strategy:
 *  1. Direct title lookup: "{makeName} {modelName}" (handles redirects)
 *  2. If no thumbnail, OpenSearch to find the best matching article
 *  3. Extract the thumbnail URL and download it
 *
 * Returns a PNG Buffer (normalised via sharp), or null if nothing was found.
 */
async function fetchWikipediaCarImage(
  makeName: string,
  modelName: string,
): Promise<Buffer | null> {
  const WP = "https://en.wikipedia.org/w/api.php";

  /** Build pageimages query URL for a given title. */
  function pageImagesUrl(title: string): string {
    const u = new URL(WP);
    u.searchParams.set("action", "query");
    u.searchParams.set("titles", title);
    u.searchParams.set("prop", "pageimages");
    u.searchParams.set("pithumbsize", "1200");
    u.searchParams.set("format", "json");
    u.searchParams.set("redirects", "1");
    return u.toString();
  }

  /** Download a Wikipedia thumbnail URL and convert to PNG. */
  async function downloadAsPng(src: string): Promise<Buffer | null> {
    try {
      const r = await fetch(src, { headers: { "User-Agent": "MsafiriKenya/1.0 (car-image-lookup)" } });
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      // Convert whatever format Wikipedia returns (JPEG, PNG, WebP) to PNG.
      return await sharp(buf).png().toBuffer();
    } catch {
      return null;
    }
  }

  /** Pull the thumbnail URL out of a Wikipedia API response. */
  function extractThumbnail(data: unknown): string | null {
    try {
      const pages = (data as any).query?.pages;
      if (!pages) return null;
      const page = Object.values(pages)[0] as any;
      if (!page || page.missing !== undefined) return null;
      return page.thumbnail?.source ?? null;
    } catch {
      return null;
    }
  }

  // ── Step 1: direct title lookup ───────────────────────────────────────────
  const candidates = [
    `${makeName} ${modelName}`,          // "Volkswagen Arteon"
    `${makeName} ${modelName} (automobile)`,
    `${makeName} ${modelName} (car)`,
  ];

  for (const title of candidates) {
    try {
      const resp = await fetch(pageImagesUrl(title), {
        headers: { "User-Agent": "MsafiriKenya/1.0 (car-image-lookup)" },
      });
      if (!resp.ok) continue;
      const src = extractThumbnail(await resp.json());
      if (src) {
        const png = await downloadAsPng(src);
        if (png) return png;
      }
    } catch { /* try next */ }
  }

  // ── Step 2: OpenSearch to find best article title ─────────────────────────
  try {
    const su = new URL(WP);
    su.searchParams.set("action", "opensearch");
    su.searchParams.set("search", `${makeName} ${modelName} car`);
    su.searchParams.set("limit", "5");
    su.searchParams.set("format", "json");

    const sr = await fetch(su.toString(), {
      headers: { "User-Agent": "MsafiriKenya/1.0 (car-image-lookup)" },
    });
    if (sr.ok) {
      const [, titles] = (await sr.json()) as [string, string[]];
      for (const title of (titles ?? [])) {
        // Only consider articles whose title plausibly relates to the model
        const lTitle = title.toLowerCase();
        if (
          !lTitle.includes(makeName.toLowerCase()) &&
          !lTitle.includes(modelName.toLowerCase())
        ) continue;

        try {
          const resp = await fetch(pageImagesUrl(title), {
            headers: { "User-Agent": "MsafiriKenya/1.0 (car-image-lookup)" },
          });
          if (!resp.ok) continue;
          const src = extractThumbnail(await resp.json());
          if (src) {
            const png = await downloadAsPng(src);
            if (png) return png;
          }
        } catch { /* try next */ }
      }
    }
  } catch { /* fall through */ }

  return null;
}

/**
 * Fetch real manufacturer press photo and upload to R2.
 * Updates imageStatus to "done" or "not_found" when finished.
 */
async function fetchAndStoreCarImage(
  makeSlug: string,
  modelSlug: string,
  makeName: string,
  modelName: string,
  recordId: string,
): Promise<void> {
  if (!r2.isR2Configured()) return;

  try {
    const png = await fetchWikipediaCarImage(makeName, modelName);

    if (!png) {
      console.warn(`[custom-vehicles] No Wikipedia image found for: ${makeName} ${modelName}`);
      await db
        .update(customVehiclesTable)
        .set({ imageStatus: "not_found" })
        .where(eq(customVehiclesTable.id, recordId));
      return;
    }

    // Process the press photo:
    //  1. Flood-fill from corners (8% fuzz) to erase the uniform white/grey
    //     studio background — keeps the car body intact since car bodies
    //     have shadows/reflections that push them above the 8% threshold.
    //  2. Flatten remaining transparency onto white — avoids the dark
    //     bleed-through that would otherwise show on dark-mode card surfaces.
    // Falls back to the original PNG if ImageMagick is unavailable.
    let finalPng = png;
    try {
      const withoutBg = await removeBackground(png);
      // Flatten transparent holes onto a clean white background.
      // Result: photo always looks like a crisp white-background product card —
      // safe on any colour (green hero gradient, dark garage card, etc.).
      finalPng = await sharp(withoutBg)
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .png()
        .toBuffer();
      console.log(`[custom-vehicles] Background processed (${(finalPng.length / 1024).toFixed(0)} KB)`);
    } catch (bgErr) {
      console.warn("[custom-vehicles] Background processing failed — storing original PNG:", bgErr);
    }

    const key = `car-images/${makeSlug}/${modelSlug}.png`;
    await r2.uploadBuffer(key, finalPng, "image/png");

    await db
      .update(customVehiclesTable)
      .set({ imageStatus: "done" })
      .where(eq(customVehiclesTable.id, recordId));

    console.log(`[custom-vehicles] Real photo stored: ${key} (${(finalPng.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    console.error("[custom-vehicles] fetchAndStoreCarImage error:", err);
  }
}

// ── Startup: retry pending records ────────────────────────────────────────────
// Called by the server startup sequence.  Picks up any records that were left
// in "pending" (e.g. from a previous failed or skipped generation run).
export async function retryPendingCarImages(): Promise<void> {
  if (!r2.isR2Configured()) return;
  try {
    const pending = await db
      .select()
      .from(customVehiclesTable)
      .where(eq(customVehiclesTable.imageStatus, "pending"));

    if (pending.length === 0) return;
    console.log(`[custom-vehicles] Retrying ${pending.length} pending image(s)…`);

    for (const row of pending) {
      // Run sequentially to avoid hammering Wikipedia
      await fetchAndStoreCarImage(
        row.makeSlug, row.modelSlug, row.makeName, row.modelName, row.id,
      );
    }
  } catch (err) {
    console.error("[custom-vehicles] retryPendingCarImages error:", err);
  }
}

// ── GET /custom-vehicles ──────────────────────────────────────────────────────

router.get("/custom-vehicles", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(customVehiclesTable)
      .orderBy(customVehiclesTable.submittedCount);
    return res.json(rows);
  } catch (err) {
    console.error("GET /custom-vehicles error:", err);
    return res.status(500).json({ error: "Failed to fetch custom vehicles" });
  }
});

// ── POST /custom-vehicles ─────────────────────────────────────────────────────

router.post("/custom-vehicles", async (req: Request, res: Response) => {
  try {
    const { makeName, modelName, knownMakeId } = req.body as {
      makeName: string;
      modelName: string;
      knownMakeId?: string | null;
    };

    if (!makeName?.trim() || !modelName?.trim()) {
      return res.status(400).json({ error: "makeName and modelName are required" });
    }

    const makeSlug = slugify(makeName);
    const modelSlug = slugify(modelName);

    if (!makeSlug || !modelSlug) {
      return res.status(400).json({ error: "Could not derive slug from provided names" });
    }

    // Deduplication check
    const [existing] = await db
      .select()
      .from(customVehiclesTable)
      .where(
        and(
          eq(customVehiclesTable.makeSlug, makeSlug),
          eq(customVehiclesTable.modelSlug, modelSlug),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(customVehiclesTable)
        .set({ submittedCount: existing.submittedCount + 1 })
        .where(eq(customVehiclesTable.id, existing.id))
        .returning();
      return res.json({ ...updated, isNew: false });
    }

    // New record — set to pending immediately, fetch image in background
    const [record] = await db
      .insert(customVehiclesTable)
      .values({
        makeName: makeName.trim(),
        modelName: modelName.trim(),
        makeSlug,
        modelSlug,
        knownMakeId: knownMakeId ?? null,
        imageStatus: "pending",
        submittedCount: 1,
      })
      .returning();

    // Fire-and-forget — real Wikipedia photo lookup
    fetchAndStoreCarImage(makeSlug, modelSlug, makeName.trim(), modelName.trim(), record.id).catch(() => {});

    return res.status(201).json({ ...record, isNew: true });
  } catch (err) {
    console.error("POST /custom-vehicles error:", err);
    return res.status(500).json({ error: "Failed to save custom vehicle" });
  }
});

export default router;
