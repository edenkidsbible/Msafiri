/**
 * Custom vehicle capture & deduplication.
 *
 * GET  /custom-vehicles          — full list (for mobile picker merge)
 * POST /custom-vehicles          — submit / increment a custom make+model
 *
 * Deduplication: two users submitting the same (makeSlug, modelSlug) pair
 * will share one row; only the submittedCount increments.
 *
 * Image generation: when a new record is created the server queues an async
 * job to generate and upload a car image to R2 at:
 *   car-images/{makeSlug}/{modelSlug}.png
 * The mobile app polls via imageStatus ("pending" → "done").
 */

import { Router, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { db, customVehiclesTable } from "@workspace/db";
import * as r2 from "../lib/r2Storage.js";

const router = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Attempt to generate and upload a car image for the given make/model.
 * Requires OPENAI_API_KEY to be set.  Silently skips when unavailable.
 */
async function generateAndUploadCarImage(
  makeSlug: string,
  modelSlug: string,
  makeName: string,
  modelName: string,
  recordId: string,
): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !r2.isR2Configured()) return;

  try {
    const fetch = (await import("node-fetch")).default as typeof globalThis.fetch;
    const resp = await (fetch as any)("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: `Professional studio side three-quarter view photograph of a ${makeName} ${modelName} car, pure white background, no logos, no badges, no text, sharp realistic detail, product photography`,
        n: 1,
        size: "1024x1024",
        response_format: "url",
      }),
    });

    if (!resp.ok) {
      console.warn(`[custom-vehicles] DALL-E generation failed: ${resp.status}`);
      return;
    }

    const json = (await resp.json()) as { data: Array<{ url: string }> };
    const imageUrl = json.data?.[0]?.url;
    if (!imageUrl) return;

    // Download the generated image
    const imgResp = await (fetch as any)(imageUrl);
    if (!imgResp.ok) return;
    const arrayBuffer = await imgResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to R2
    const key = `car-images/${makeSlug}/${modelSlug}.png`;
    await r2.uploadBuffer(key, buffer, "image/png");

    // Mark as done
    await db
      .update(customVehiclesTable)
      .set({ imageStatus: "done" })
      .where(eq(customVehiclesTable.id, recordId));

    console.log(`[custom-vehicles] Image ready: ${key}`);
  } catch (err) {
    console.error("[custom-vehicles] generateAndUploadCarImage error:", err);
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
      // Increment counter and return existing record
      const [updated] = await db
        .update(customVehiclesTable)
        .set({ submittedCount: existing.submittedCount + 1 })
        .where(eq(customVehiclesTable.id, existing.id))
        .returning();
      return res.json({ ...updated, isNew: false });
    }

    // New record
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

    // Fire-and-forget image generation
    generateAndUploadCarImage(makeSlug, modelSlug, makeName, modelName, record.id).catch(
      () => {},
    );

    return res.status(201).json({ ...record, isNew: true });
  } catch (err) {
    console.error("POST /custom-vehicles error:", err);
    return res.status(500).json({ error: "Failed to save custom vehicle" });
  }
});

export default router;
