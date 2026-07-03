import { Router, type Request, type Response } from "express";
import { db, appReleasesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logAudit } from "../../lib/audit.js";

const router = Router();

// GET /admin/releases
router.get("/releases", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(appReleasesTable)
      .orderBy(desc(appReleasesTable.createdAt));

    return res.json({
      releases: rows.map((r) => ({
        id:                 r.id,
        version:            r.version,
        buildNumber:        r.buildNumber,
        platform:           r.platform,
        releaseType:        r.releaseType,
        releaseNotes:       r.releaseNotes,
        status:             r.status,
        isForceUpdate:      r.isForceUpdate,
        storeUrlIos:        r.storeUrlIos,
        storeUrlAndroid:    r.storeUrlAndroid,
        createdBy:          r.createdBy,
        createdAt:          r.createdAt.toISOString(),
        publishedAt:        r.publishedAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    console.error("GET /admin/releases error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /admin/releases — create a new release (draft)
router.post("/releases", async (req: Request, res: Response) => {
  const actor = (req as any).adminUser;
  const {
    version, buildNumber, platform, releaseType,
    releaseNotes, isForceUpdate, storeUrlIos, storeUrlAndroid,
  } = req.body as {
    version:         string;
    buildNumber?:    number;
    platform?:       string;
    releaseType?:    string;
    releaseNotes?:   string;
    isForceUpdate?:  boolean;
    storeUrlIos?:    string;
    storeUrlAndroid?: string;
  };

  if (!version) {
    return res.status(400).json({ error: "version is required" });
  }

  try {
    const [release] = await db
      .insert(appReleasesTable)
      .values({
        version,
        buildNumber:     buildNumber ?? 1,
        platform:        platform ?? "all",
        releaseType:     releaseType ?? "patch",
        releaseNotes:    releaseNotes ?? null,
        status:          "draft",
        isForceUpdate:   isForceUpdate ?? false,
        storeUrlIos:     storeUrlIos ?? null,
        storeUrlAndroid: storeUrlAndroid ?? null,
        createdBy:       actor?.name ?? "admin",
      })
      .returning();

    await logAudit({
      actor:      { id: actor?.id ?? "system", name: actor?.name ?? "Admin", role: actor?.role ?? "admin" },
      action:     "release_create",
      targetType: "app_release",
      targetId:   release.id,
      details:    { message: `Created release v${version} (${platform ?? "all"}, ${releaseType ?? "patch"})` },
    });

    return res.status(201).json({
      ...release,
      createdAt:   release.createdAt.toISOString(),
      publishedAt: null,
    });
  } catch (err) {
    console.error("POST /admin/releases error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /admin/releases/:id — update a draft release
router.patch("/releases/:id", async (req: Request, res: Response) => {
  const actor = (req as any).adminUser;
  const id = req.params["id"] as string;
  const {
    version, buildNumber, platform, releaseType,
    releaseNotes, isForceUpdate, storeUrlIos, storeUrlAndroid,
  } = req.body as Partial<{
    version:         string;
    buildNumber:     number;
    platform:        string;
    releaseType:     string;
    releaseNotes:    string;
    isForceUpdate:   boolean;
    storeUrlIos:     string;
    storeUrlAndroid: string;
  }>;

  try {
    const updateFields: Record<string, unknown> = {};
    if (version !== undefined)         updateFields["version"]          = version;
    if (buildNumber !== undefined)     updateFields["buildNumber"]      = buildNumber;
    if (platform !== undefined)        updateFields["platform"]         = platform;
    if (releaseType !== undefined)     updateFields["releaseType"]      = releaseType;
    if (releaseNotes !== undefined)    updateFields["releaseNotes"]     = releaseNotes;
    if (isForceUpdate !== undefined)   updateFields["isForceUpdate"]    = isForceUpdate;
    if (storeUrlIos !== undefined)     updateFields["storeUrlIos"]      = storeUrlIos;
    if (storeUrlAndroid !== undefined) updateFields["storeUrlAndroid"]  = storeUrlAndroid;

    await db
      .update(appReleasesTable)
      .set(updateFields as any)
      .where(eq(appReleasesTable.id, id));

    await logAudit({
      actor:      { id: actor?.id ?? "system", name: actor?.name ?? "Admin", role: actor?.role ?? "admin" },
      action:     "release_update",
      targetType: "app_release",
      targetId:   id,
      details:    { message: `Updated release fields: ${Object.keys(updateFields).join(", ")}` },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("PATCH /admin/releases/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /admin/releases/:id/publish — publish (draft → live)
router.post("/releases/:id/publish", async (req: Request, res: Response) => {
  const actor = (req as any).adminUser;
  const id = req.params["id"] as string;

  try {
    const [release] = await db
      .update(appReleasesTable)
      .set({ status: "live", publishedAt: new Date() })
      .where(eq(appReleasesTable.id, id))
      .returning();

    await logAudit({
      actor:      { id: actor?.id ?? "system", name: actor?.name ?? "Admin", role: actor?.role ?? "admin" },
      action:     "release_publish",
      targetType: "app_release",
      targetId:   id,
      details:    { message: `Published release v${release?.version}${release?.isForceUpdate ? " (FORCE UPDATE)" : ""}` },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("POST /admin/releases/:id/publish error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /admin/releases/:id/deprecate — deprecate a live release
router.post("/releases/:id/deprecate", async (req: Request, res: Response) => {
  const actor = (req as any).adminUser;
  const id = req.params["id"] as string;

  try {
    const [release] = await db
      .update(appReleasesTable)
      .set({ status: "deprecated" })
      .where(eq(appReleasesTable.id, id))
      .returning();

    await logAudit({
      actor:      { id: actor?.id ?? "system", name: actor?.name ?? "Admin", role: actor?.role ?? "admin" },
      action:     "release_deprecate",
      targetType: "app_release",
      targetId:   id,
      details:    { message: `Deprecated release v${release?.version}` },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("POST /admin/releases/:id/deprecate error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /admin/releases/:id — delete a draft release
router.delete("/releases/:id", async (req: Request, res: Response) => {
  const actor = (req as any).adminUser;
  const id = req.params["id"] as string;

  try {
    await db.delete(appReleasesTable).where(eq(appReleasesTable.id, id));

    await logAudit({
      actor:      { id: actor?.id ?? "system", name: actor?.name ?? "Admin", role: actor?.role ?? "admin" },
      action:     "release_delete",
      targetType: "app_release",
      targetId:   id,
      details:    { message: `Deleted release` },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /admin/releases/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
