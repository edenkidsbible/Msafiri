import { Router, type Request, type Response } from "express";
import { db, appReleasesTable, pushTokensTable, pushCampaignsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logAudit } from "../../lib/audit.js";
import { sendPushNotifications } from "../../lib/expoPush.js";

const router = Router();

// ── Helper: fire push notifications when a release goes live ──────────────────
async function fireReleasePush(release: typeof appReleasesTable.$inferSelect, actorName: string) {
  const notifTitle = release.isForceUpdate
    ? `Msafiri just got better 🚀`
    : `What's new in Msafiri v${release.version} ✨`;
  const notifBody = release.isForceUpdate
    ? `v${release.version} is ready for you — a quick update and you're back on the road.`
    : (release.releaseNotes
        ? release.releaseNotes.slice(0, 120) + (release.releaseNotes.length > 120 ? "…" : "")
        : `Msafiri v${release.version} is here. Tap to see what's new.`);

  const notifData = {
    type:            "app_update",
    version:         release.version,
    isForceUpdate:   release.isForceUpdate,
    releaseNotes:    release.releaseNotes ?? "",
    storeUrlIos:     release.storeUrlIos ?? "",
    storeUrlAndroid: release.storeUrlAndroid ?? "",
  };

  const tokens = await db.select({ token: pushTokensTable.token }).from(pushTokensTable);
  if (tokens.length === 0) return;

  const messages = tokens.map((t) => ({
    to:        t.token,
    title:     notifTitle,
    body:      notifBody,
    sound:     "default" as const,
    channelId: "msafiri_alerts",
    data:      notifData,
  }));

  const { ok, failed } = await sendPushNotifications(messages);

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
    createdBy:   actorName,
  });

  console.log(`[releases] Published v${release.version}: push sent to ${ok}/${tokens.length} devices`);
}

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
        scheduledAt:        r.scheduledAt?.toISOString() ?? null,
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
    releaseNotes, isForceUpdate, storeUrlIos, storeUrlAndroid, scheduledAt,
  } = req.body as {
    version:         string;
    buildNumber?:    number;
    platform?:       string;
    releaseType?:    string;
    releaseNotes?:   string;
    isForceUpdate?:  boolean;
    storeUrlIos?:    string;
    storeUrlAndroid?: string;
    scheduledAt?:    string;
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
        scheduledAt:     scheduledAt ? new Date(scheduledAt) : null,
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
      scheduledAt: release.scheduledAt?.toISOString() ?? null,
    });
  } catch (err) {
    console.error("POST /admin/releases error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /admin/releases/:id — update a draft/scheduled release
router.patch("/releases/:id", async (req: Request, res: Response) => {
  const actor = (req as any).adminUser;
  const id = req.params["id"] as string;
  const {
    version, buildNumber, platform, releaseType,
    releaseNotes, isForceUpdate, storeUrlIos, storeUrlAndroid, scheduledAt,
  } = req.body as Partial<{
    version:         string;
    buildNumber:     number;
    platform:        string;
    releaseType:     string;
    releaseNotes:    string;
    isForceUpdate:   boolean;
    storeUrlIos:     string;
    storeUrlAndroid: string;
    scheduledAt:     string | null;
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
    if (scheduledAt !== undefined)     updateFields["scheduledAt"]      = scheduledAt ? new Date(scheduledAt) : null;

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

// POST /admin/releases/:id/publish — publish (draft → live or scheduled) + auto push notification
router.post("/releases/:id/publish", async (req: Request, res: Response) => {
  const actor = (req as any).adminUser;
  const id = req.params["id"] as string;

  try {
    const existing = await db
      .select()
      .from(appReleasesTable)
      .where(eq(appReleasesTable.id, id))
      .then((rows) => rows[0]);

    if (!existing) {
      return res.status(404).json({ error: "Release not found" });
    }

    const now = new Date();
    const scheduledTime = existing.scheduledAt;
    const goLiveNow = !scheduledTime || scheduledTime <= now;

    const newStatus = goLiveNow ? "live" : "scheduled";

    const [release] = await db
      .update(appReleasesTable)
      .set({
        status:      newStatus,
        publishedAt: goLiveNow ? now : null,
      })
      .where(eq(appReleasesTable.id, id))
      .returning();

    await logAudit({
      actor:      { id: actor?.id ?? "system", name: actor?.name ?? "Admin", role: actor?.role ?? "admin" },
      action:     "release_publish",
      targetType: "app_release",
      targetId:   id,
      details:    {
        message: goLiveNow
          ? `Published release v${release.version}${release.isForceUpdate ? " (FORCE UPDATE)" : ""}`
          : `Scheduled release v${release.version} for ${scheduledTime?.toISOString()}`,
      },
    });

    // Only fire push if going live immediately
    if (goLiveNow) {
      try {
        await fireReleasePush(release, actor?.name ?? "admin");
      } catch (pushErr) {
        // Push failure must never block the publish response
        console.error("[releases] Push notification error after publish:", pushErr);
      }
    }

    return res.json({ success: true, status: newStatus, scheduledAt: release.scheduledAt?.toISOString() ?? null });
  } catch (err) {
    console.error("POST /admin/releases/:id/publish error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /admin/releases/:id/unschedule — revert a scheduled release back to draft
router.post("/releases/:id/unschedule", async (req: Request, res: Response) => {
  const actor = (req as any).adminUser;
  const id = req.params["id"] as string;

  try {
    const [release] = await db
      .update(appReleasesTable)
      .set({ status: "draft", scheduledAt: null })
      .where(eq(appReleasesTable.id, id))
      .returning();

    if (!release) {
      return res.status(404).json({ error: "Release not found" });
    }

    await logAudit({
      actor:      { id: actor?.id ?? "system", name: actor?.name ?? "Admin", role: actor?.role ?? "admin" },
      action:     "release_unschedule",
      targetType: "app_release",
      targetId:   id,
      details:    { message: `Unscheduled release v${release.version}` },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("POST /admin/releases/:id/unschedule error:", err);
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
