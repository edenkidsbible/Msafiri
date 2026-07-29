import { Router, type Request, type Response } from "express";
import { db, appReleasesTable, pushTokensTable, pushCampaignsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logAudit } from "../../lib/audit.js";
import { sendPushNotifications } from "../../lib/expoPush.js";

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

// POST /admin/releases/:id/publish — publish (draft → live) + auto push notification
router.post("/releases/:id/publish", async (req: Request, res: Response) => {
  const actor = (req as any).adminUser;
  const id = req.params["id"] as string;

  try {
    const [release] = await db
      .update(appReleasesTable)
      .set({ status: "live", publishedAt: new Date() })
      .where(eq(appReleasesTable.id, id))
      .returning();

    if (!release) {
      return res.status(404).json({ error: "Release not found" });
    }

    await logAudit({
      actor:      { id: actor?.id ?? "system", name: actor?.name ?? "Admin", role: actor?.role ?? "admin" },
      action:     "release_publish",
      targetType: "app_release",
      targetId:   id,
      details:    { message: `Published release v${release.version}${release.isForceUpdate ? " (FORCE UPDATE)" : ""}` },
    });

    // ── Automatically send a push notification to all registered devices ──
    // Force updates get a more urgent title/body; soft updates are informational.
    const notifTitle = release.isForceUpdate
      ? "Critical Update Required"
      : `New Update Available — v${release.version}`;
    const notifBody = release.isForceUpdate
      ? `Version ${release.version} is required to continue using Msafiri. Please update now.`
      : (release.releaseNotes
          ? release.releaseNotes.slice(0, 120) + (release.releaseNotes.length > 120 ? "…" : "")
          : `Msafiri v${release.version} is now available. Tap to update.`);

    const notifData = {
      type:           "app_update",
      version:        release.version,
      isForceUpdate:  release.isForceUpdate,
      releaseNotes:   release.releaseNotes ?? "",
      storeUrlIos:    release.storeUrlIos ?? "",
      storeUrlAndroid: release.storeUrlAndroid ?? "",
    };

    try {
      const tokens = await db.select({ token: pushTokensTable.token }).from(pushTokensTable);
      if (tokens.length > 0) {
        const messages = tokens.map((t) => ({
          to:        t.token,
          title:     notifTitle,
          body:      notifBody,
          sound:     "default" as const,
          channelId: "msafiri_alerts",
          data:      notifData,
        }));

        const { ok, failed } = await sendPushNotifications(messages);

        // Record in push_campaigns table for audit trail
        await db.insert(pushCampaignsTable).values({
          title:       notifTitle,
          body:        notifBody,
          dataJson:    JSON.stringify(notifData),
          type:        "broadcast",
          status:      "sent",
          sentAt:      new Date(),
          sentCount:   ok,
          failedCount: failed,
          targetCount: tokens.length,
          createdBy:   actor?.name ?? "admin",
        });

        console.log(`[releases] Published v${release.version}: push sent to ${ok}/${tokens.length} devices`);
      }
    } catch (pushErr) {
      // Push failure must never block the publish response
      console.error("[releases] Push notification error after publish:", pushErr);
    }

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
