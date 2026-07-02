import { Router, type Request, type Response } from "express";
import { db, pushTokensTable, pushCampaignsTable } from "@workspace/db";
import { desc, eq, and, gte, lte, sql } from "drizzle-orm";
import { sendPushNotifications } from "../../lib/expoPush.js";
import { logAudit } from "../../lib/audit.js";

const router = Router();

// GET /admin/push/devices — device stats
router.get("/push/devices", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        platform: pushTokensTable.platform,
        count: sql<number>`count(*)::int`,
      })
      .from(pushTokensTable)
      .groupBy(pushTokensTable.platform);

    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const byPlatform: Record<string, number> = {};
    for (const r of rows) {
      byPlatform[r.platform] = r.count;
    }

    return res.json({ total, byPlatform });
  } catch (err) {
    console.error("GET /admin/push/devices error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/push/campaigns
router.get("/push/campaigns", async (_req: Request, res: Response) => {
  try {
    const campaigns = await db
      .select()
      .from(pushCampaignsTable)
      .orderBy(desc(pushCampaignsTable.createdAt))
      .limit(100);

    return res.json({
      campaigns: campaigns.map((c) => ({
        id:          c.id,
        title:       c.title,
        body:        c.body,
        type:        c.type,
        status:      c.status,
        scheduledAt: c.scheduledAt?.toISOString() ?? null,
        sentAt:      c.sentAt?.toISOString() ?? null,
        sentCount:   c.sentCount,
        failedCount: c.failedCount,
        createdBy:   c.createdBy,
        createdAt:   c.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("GET /admin/push/campaigns error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /admin/push/campaigns — create and optionally send immediately
router.post("/push/campaigns", async (req: Request, res: Response) => {
  const actor = (req as any).adminUser;
  const { title, body, data, scheduledAt } = req.body as {
    title: string;
    body: string;
    data?: Record<string, unknown>;
    scheduledAt?: string;
  };

  if (!title || !body) {
    return res.status(400).json({ error: "title and body are required" });
  }

  try {
    const isImmediate = !scheduledAt;

    const [campaign] = await db
      .insert(pushCampaignsTable)
      .values({
        title,
        body,
        dataJson: data ? JSON.stringify(data) : null,
        type: isImmediate ? "broadcast" : "scheduled",
        status: isImmediate ? "sending" : "scheduled",
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        createdBy: actor?.name ?? "admin",
      })
      .returning();

    if (isImmediate) {
      const tokens = await db
        .select({ token: pushTokensTable.token })
        .from(pushTokensTable);

      const messages = tokens.map((t) => ({
        to: t.token,
        title,
        body,
        sound: "default" as const,
        data: data ?? {},
      }));

      const { ok, failed } = await sendPushNotifications(messages);

      await db
        .update(pushCampaignsTable)
        .set({
          status: "sent",
          sentAt: new Date(),
          sentCount: ok,
          failedCount: failed,
        })
        .where(eq(pushCampaignsTable.id, campaign.id));

      await logAudit({
        actorId:    actor?.id ?? "system",
        actorName:  actor?.name ?? "Admin",
        actorRole:  actor?.role ?? "admin",
        action:     "push_send",
        targetType: "push_campaign",
        targetId:   campaign.id,
        details:    `Sent "${title}" to ${ok} devices (${failed} failed)`,
      });

      return res.json({
        id:         campaign.id,
        title,
        body,
        type:       "broadcast",
        status:     "sent",
        sentCount:  ok,
        failedCount: failed,
        createdBy:  campaign.createdBy,
        createdAt:  campaign.createdAt.toISOString(),
        sentAt:     new Date().toISOString(),
        scheduledAt: null,
      });
    }

    await logAudit({
      actorId:    actor?.id ?? "system",
      actorName:  actor?.name ?? "Admin",
      actorRole:  actor?.role ?? "admin",
      action:     "push_schedule",
      targetType: "push_campaign",
      targetId:   campaign.id,
      details:    `Scheduled "${title}" for ${scheduledAt}`,
    });

    return res.status(201).json({
      id:          campaign.id,
      title,
      body,
      type:        "scheduled",
      status:      "scheduled",
      sentCount:   0,
      failedCount: 0,
      createdBy:   campaign.createdBy,
      createdAt:   campaign.createdAt.toISOString(),
      sentAt:      null,
      scheduledAt: campaign.scheduledAt?.toISOString() ?? null,
    });
  } catch (err) {
    console.error("POST /admin/push/campaigns error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /admin/push/campaigns/:id
router.delete("/push/campaigns/:id", async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  try {
    await db.delete(pushCampaignsTable).where(eq(pushCampaignsTable.id, id));
    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /admin/push/campaigns/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
