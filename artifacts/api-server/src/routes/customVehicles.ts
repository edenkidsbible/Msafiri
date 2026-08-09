/**
 * Custom vehicle capture & deduplication.
 *
 * GET  /custom-vehicles          — full list (for mobile picker merge)
 * POST /custom-vehicles          — submit / increment a custom make+model
 *
 * Deduplication: two users submitting the same (makeSlug, modelSlug) pair
 * will share one row; only the submittedCount increments.
 *
 * Image sourcing (model photo): when a new record is created the server queues
 * an async job that fetches the manufacturer press photo from Wikipedia's
 * pageimages API.  Stored in R2 at: car-images/{makeSlug}/{modelSlug}.png
 *
 * imageStatus lifecycle:
 *   "pending"   → job queued, not yet complete
 *   "done"      → real photo found and stored in R2
 *   "not_found" → Wikipedia had no usable image; app shows emoji fallback
 *
 * Logo sourcing (make logo): a second parallel job fetches the brand logo from
 * the Wikipedia make article.  Stored in R2 at: car-logos/{makeSlug}.png
 * (same key the existing /api/car-logos/:makeId route already serves).
 *
 * logoStatus lifecycle:
 *   "pending"   → lookup queued
 *   "done"      → logo in R2 (or make already has a pre-seeded logo)
 *   "not_found" → Wikipedia had no suitable logo thumbnail
 */

import { Router, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { db, customVehiclesTable } from "@workspace/db";
import * as r2 from "../lib/r2Storage.js";

const execFileAsync = promisify(execFile);

const router = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

// The server's start command always runs from artifacts/api-server/, so
// process.cwd() is reliable and avoids import.meta.url esbuild complications.
const REMBG_SCRIPT = path.resolve(process.cwd(), "scripts/remove_bg.py");

/**
 * Remove the background from a car press photo using the rembg AI model
 * (U2-Net). Unlike the old ImageMagick flood-fill this works on ANY
 * background — studio white, brick walls, roads, car parks, etc. — by
 * doing semantic foreground/background segmentation.
 *
 * The result is a transparent PNG32 ready for direct upload to R2.
 * It never needs flattening — the transparency is intentional so the car
 * "floats" on whatever surface the UI places it on.
 */
async function removeBackground(input: Buffer): Promise<Buffer> {
  // Pre-resize to ≤ 800 px wide — u2netp processes ~800 px in 30–60 s on CPU;
  // full 1200 px images took 3–5 min and caused timeout kills.
  const resized = await sharp(input)
    .resize({ width: 800, withoutEnlargement: true })
    .png()
    .toBuffer();

  const id     = `car-bg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmpIn  = path.join(os.tmpdir(), `${id}-in.png`);
  const tmpOut = path.join(os.tmpdir(), `${id}-out.png`);

  try {
    await fs.writeFile(tmpIn, resized);
    // Use temp files (not stdin/stdout) to avoid pipe-close issues.
    // Allow up to 5 minutes — u2netp is ~3–5× faster than u2net.
    await execFileAsync("python3", [REMBG_SCRIPT, tmpIn, tmpOut], {
      timeout: 5 * 60 * 1000,
    });
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
      if (!r.ok) { console.warn(`[custom-vehicles] Wikipedia download ${r.status}: ${src}`); return null; }
      const buf = Buffer.from(await r.arrayBuffer());
      // Convert whatever format Wikipedia returns (JPEG, PNG, WebP) to PNG.
      return await sharp(buf).png().toBuffer();
    } catch (err) {
      console.warn("[custom-vehicles] downloadAsPng error:", err);
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

    // Remove the background using rembg (U2-Net AI model) — works on any
    // background type (studio, road, brick wall, parking lot, etc.).
    // Result is a transparent PNG32; the car floats on whatever surface
    // the UI renders it on (green hero card, dark garage tile, white sheet).
    // Falls back to the raw Wikipedia PNG if rembg fails.
    let finalPng = png;
    try {
      finalPng = await removeBackground(png);
      console.log(`[custom-vehicles] AI background removed (${(finalPng.length / 1024).toFixed(0)} KB)`);
    } catch (bgErr) {
      console.warn("[custom-vehicles] rembg failed — storing original PNG:", bgErr);
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

// ── Make logo fetching ────────────────────────────────────────────────────────

/**
 * Fetch the official make logo from Wikipedia's pageimages API.
 *
 * Strategy:
 *  1. Direct title candidates for the brand article (e.g. "Haima Automobile")
 *  2. OpenSearch fallback to find the best matching brand article
 *
 * Returns a PNG Buffer (normalised via sharp to max 400 px wide), or null.
 * We deliberately do NOT run rembg on logos — brand logos on Wikipedia are
 * already clean assets, and CarLogoImage renders them on a white pill anyway.
 */
async function fetchWikipediaLogo(makeName: string): Promise<Buffer | null> {
  const WP = "https://en.wikipedia.org/w/api.php";

  function pageImagesUrl(title: string): string {
    const u = new URL(WP);
    u.searchParams.set("action", "query");
    u.searchParams.set("titles", title);
    u.searchParams.set("prop", "pageimages");
    u.searchParams.set("pithumbsize", "400");
    u.searchParams.set("format", "json");
    u.searchParams.set("redirects", "1");
    return u.toString();
  }

  async function downloadLogoAsPng(src: string): Promise<Buffer | null> {
    try {
      const r = await fetch(src, { headers: { "User-Agent": "MsafiriKenya/1.0 (make-logo-lookup)" } });
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      return await sharp(buf)
        .resize({ width: 400, withoutEnlargement: true })
        .png()
        .toBuffer();
    } catch (err) {
      console.warn("[custom-vehicles] logo downloadAsPng error:", err);
      return null;
    }
  }

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

  // ── Step 1: direct title candidates ─────────────────────────────────────────
  const candidates = [
    makeName,                                     // "Haima"
    `${makeName} Automobile`,                     // "Haima Automobile"
    `${makeName} Motor`,                          // "Haima Motor"
    `${makeName} (automobile manufacturer)`,      // disambiguation
    `${makeName} Motors`,
  ];

  for (const title of candidates) {
    try {
      const resp = await fetch(pageImagesUrl(title), {
        headers: { "User-Agent": "MsafiriKenya/1.0 (make-logo-lookup)" },
      });
      if (!resp.ok) continue;
      const src = extractThumbnail(await resp.json());
      if (src) {
        const png = await downloadLogoAsPng(src);
        if (png) return png;
      }
    } catch { /* try next */ }
  }

  // ── Step 2: OpenSearch fallback ──────────────────────────────────────────────
  try {
    const su = new URL(WP);
    su.searchParams.set("action", "opensearch");
    su.searchParams.set("search", `${makeName} car manufacturer`);
    su.searchParams.set("limit", "5");
    su.searchParams.set("format", "json");

    const sr = await fetch(su.toString(), {
      headers: { "User-Agent": "MsafiriKenya/1.0 (make-logo-lookup)" },
    });
    if (sr.ok) {
      const [, titles] = (await sr.json()) as [string, string[]];
      for (const title of (titles ?? [])) {
        const lTitle = title.toLowerCase();
        if (!lTitle.includes(makeName.toLowerCase())) continue;
        try {
          const resp = await fetch(pageImagesUrl(title), {
            headers: { "User-Agent": "MsafiriKenya/1.0 (make-logo-lookup)" },
          });
          if (!resp.ok) continue;
          const src = extractThumbnail(await resp.json());
          if (src) {
            const png = await downloadLogoAsPng(src);
            if (png) return png;
          }
        } catch { /* try next */ }
      }
    }
  } catch { /* fall through */ }

  return null;
}

/**
 * Fetch and upload the make logo to R2 at car-logos/{makeSlug}.png.
 * Updates logoStatus on ALL rows sharing this makeSlug when done.
 */
async function fetchAndStoreMakeLogo(
  makeSlug: string,
  makeName: string,
): Promise<void> {
  if (!r2.isR2Configured()) return;

  try {
    const logoKey = `car-logos/${makeSlug}.png`;

    // Skip if R2 already has the logo (e.g. from pre-seeded known makes).
    const existing = await r2.headObject(logoKey);
    if (existing) {
      await db
        .update(customVehiclesTable)
        .set({ logoStatus: "done" })
        .where(eq(customVehiclesTable.makeSlug, makeSlug));
      return;
    }

    const png = await fetchWikipediaLogo(makeName);

    if (!png) {
      console.warn(`[custom-vehicles] No Wikipedia logo found for make: ${makeName}`);
      await db
        .update(customVehiclesTable)
        .set({ logoStatus: "not_found" })
        .where(eq(customVehiclesTable.makeSlug, makeSlug));
      return;
    }

    await r2.uploadBuffer(logoKey, png, "image/png");
    await db
      .update(customVehiclesTable)
      .set({ logoStatus: "done" })
      .where(eq(customVehiclesTable.makeSlug, makeSlug));

    console.log(`[custom-vehicles] Make logo stored: ${logoKey} (${(png.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    console.error(`[custom-vehicles] fetchAndStoreMakeLogo error for ${makeName}:`, err);
  }
}

/**
 * Startup hook: process any custom makes whose logos haven't been fetched yet.
 * Processes distinct makes (not per row) — one logo covers all models of a make.
 * Known makes (knownMakeId set) are marked "done" immediately without a fetch.
 */
export async function retryPendingLogos(): Promise<void> {
  if (!r2.isR2Configured()) return;
  try {
    const pendingRows = await db
      .select({
        makeSlug: customVehiclesTable.makeSlug,
        makeName: customVehiclesTable.makeName,
        knownMakeId: customVehiclesTable.knownMakeId,
      })
      .from(customVehiclesTable)
      .where(eq(customVehiclesTable.logoStatus, "pending"));

    if (pendingRows.length === 0) return;

    // Deduplicate to one entry per make slug.
    const seen = new Set<string>();
    const distinctMakes: Array<{ makeSlug: string; makeName: string; knownMakeId: string | null }> = [];
    for (const row of pendingRows) {
      if (!seen.has(row.makeSlug)) {
        seen.add(row.makeSlug);
        distinctMakes.push(row);
      }
    }

    console.log(`[custom-vehicles] Fetching logos for ${distinctMakes.length} make(s)…`);

    for (const make of distinctMakes) {
      // Known makes already have pre-seeded logos — just mark them done
      // (or the headObject check in fetchAndStoreMakeLogo will catch it).
      await fetchAndStoreMakeLogo(make.makeSlug, make.makeName);
    }
  } catch (err) {
    console.error("[custom-vehicles] retryPendingLogos error:", err);
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

    // Known makes already have pre-seeded logos in R2 — skip the logo fetch.
    const initialLogoStatus = knownMakeId ? "done" : "pending";

    // New record — set both statuses to pending, fetch assets in background
    const [record] = await db
      .insert(customVehiclesTable)
      .values({
        makeName: makeName.trim(),
        modelName: modelName.trim(),
        makeSlug,
        modelSlug,
        knownMakeId: knownMakeId ?? null,
        imageStatus: "pending",
        logoStatus: initialLogoStatus,
        submittedCount: 1,
      })
      .returning();

    // Fire-and-forget — real Wikipedia photo lookup
    fetchAndStoreCarImage(makeSlug, modelSlug, makeName.trim(), modelName.trim(), record.id).catch(() => {});

    // Fire-and-forget — brand logo lookup (only needed for fully custom makes)
    if (!knownMakeId) {
      fetchAndStoreMakeLogo(makeSlug, makeName.trim()).catch(() => {});
    }

    return res.status(201).json({ ...record, isNew: true });
  } catch (err) {
    console.error("POST /custom-vehicles error:", err);
    return res.status(500).json({ error: "Failed to save custom vehicle" });
  }
});

export default router;
