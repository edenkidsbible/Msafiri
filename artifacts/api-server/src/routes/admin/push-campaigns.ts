import { Router, type Request, type Response } from "express";
import { db, pushTokensTable, pushCampaignsTable } from "@workspace/db";
import { desc, eq, and, gte, lte, sql, isNotNull } from "drizzle-orm";
import { sendPushNotifications, sendSilentPing, flushBadTokensFromReceipts } from "../../lib/expoPush.js";
import { logAudit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";

const router = Router();

// GET /admin/push/devices — device stats
router.get("/push/devices", async (_req: Request, res: Response) => {
  try {
    const [platformRows, bgRows] = await Promise.all([
      db
        .select({
          platform: pushTokensTable.platform,
          count: sql<number>`count(*)::int`,
        })
        .from(pushTokensTable)
        .groupBy(pushTokensTable.platform),
      db
        .select({
          platform: pushTokensTable.platform,
          bgWakeupCount: sql<number>`count(*)::int`,
          lastBgWakeupAt: sql<string | null>`max(last_bg_wakeup_at)`,
        })
        .from(pushTokensTable)
        .where(sql`last_bg_wakeup_at is not null`)
        .groupBy(pushTokensTable.platform),
    ]);

    const total = platformRows.reduce((sum, r) => sum + r.count, 0);
    const byPlatform: Record<string, number> = {};
    for (const r of platformRows) {
      byPlatform[r.platform] = r.count;
    }

    const bgWakeupByPlatform: Record<string, number> = {};
    let bgWakeupTotal = 0;
    let lastBgWakeupAt: string | null = null;
    for (const r of bgRows) {
      bgWakeupByPlatform[r.platform] = r.bgWakeupCount;
      bgWakeupTotal += r.bgWakeupCount;
      if (r.lastBgWakeupAt && (!lastBgWakeupAt || r.lastBgWakeupAt > lastBgWakeupAt)) {
        lastBgWakeupAt = r.lastBgWakeupAt;
      }
    }

    return res.json({ total, byPlatform, bgWakeupTotal, bgWakeupByPlatform, lastBgWakeupAt });
  } catch (err) {
    console.error("GET /admin/push/devices error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/push/devices/list — per-device rows for the admin wakeup table.
// Supports pagination via ?page=1&limit=100. Returns total so the UI can show
// all devices without a silent truncation.
router.get("/push/devices/list", async (req: Request, res: Response) => {
  try {
    const page  = Math.max(1, parseInt((req.query["page"]  as string) ?? "1",  10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt((req.query["limit"] as string) ?? "100", 10) || 100));
    const offset = (page - 1) * limit;

    const [rows, countRows] = await Promise.all([
      db
        .select({
          deviceId:       pushTokensTable.deviceId,
          platform:       pushTokensTable.platform,
          lastSeenAt:     pushTokensTable.lastSeenAt,
          lastBgWakeupAt: pushTokensTable.lastBgWakeupAt,
        })
        .from(pushTokensTable)
        .orderBy(desc(pushTokensTable.lastSeenAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(pushTokensTable),
    ]);

    const total = countRows[0]?.total ?? 0;

    return res.json({
      total,
      page,
      limit,
      devices: rows.map((r) => ({
        deviceId:       r.deviceId,
        platform:       r.platform,
        lastSeenAt:     r.lastSeenAt?.toISOString() ?? null,
        lastBgWakeupAt: r.lastBgWakeupAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    console.error("GET /admin/push/devices/list error:", err);
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
        targetCount: c.targetCount ?? null,
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
        channelId: "msafiri_general",
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
        actor:      { id: actor?.id ?? "system", name: actor?.name ?? "Admin", role: actor?.role ?? "admin" },
        action:     "push_send",
        targetType: "push_campaign",
        targetId:   campaign.id,
        details:    { message: `Sent "${title}" to ${ok} devices (${failed} failed)` },
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
      actor:      { id: actor?.id ?? "system", name: actor?.name ?? "Admin", role: actor?.role ?? "admin" },
      action:     "push_schedule",
      targetType: "push_campaign",
      targetId:   campaign.id,
      details:    { message: `Scheduled "${title}" for ${scheduledAt}` },
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

// POST /admin/push/silent-ping — send a silent wake-up to all dormant devices
// (inactive for 3+ days). No visible notification — the client's background
// task uses the wakeup slot to refresh its push token and location.
router.post("/push/silent-ping", async (req: Request, res: Response) => {
  const actor = (req as any).adminUser;
  try {
    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const tokens = await db
      .select({ token: pushTokensTable.token, platform: pushTokensTable.platform })
      .from(pushTokensTable)
      .where(lte(pushTokensTable.lastSeenAt, cutoff));

    if (tokens.length === 0) {
      return res.json({ sent: 0, failed: 0, dormantDevices: 0 });
    }

    // Pass platform so sendSilentPing can set APNs-5 priority for iOS and
    // FCM high priority for Android (required to bypass Doze mode).
    const { ok, failed } = await sendSilentPing(tokens);

    // Record in campaigns table for audit trail
    const [campaign] = await db
      .insert(pushCampaignsTable)
      .values({
        title:       "(Silent wake-up ping)",
        body:        "",
        type:        "silent_ping",
        status:      "sent",
        sentAt:      new Date(),
        sentCount:   ok,
        failedCount: failed,
        targetCount: tokens.length,
        createdBy:   actor?.name ?? "admin",
      })
      .returning();

    await logAudit({
      actor:      { id: actor?.id ?? "system", name: actor?.name ?? "Admin", role: actor?.role ?? "admin" },
      action:     "push_send",
      targetType: "push_campaign",
      targetId:   campaign.id,
      details:    { message: `Silent wake-up ping to ${ok} dormant devices (${failed} failed)` },
    });

    logger.info({ dormantDevices: tokens.length, ok, failed }, "Silent wake-up ping sent");
    return res.json({ sent: ok, failed, dormantDevices: tokens.length });
  } catch (err) {
    console.error("POST /admin/push/silent-ping error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /admin/push/receipts — flush pending receipts and report bad tokens
router.post("/push/receipts", async (_req: Request, res: Response) => {
  try {
    const badTokens = await flushBadTokensFromReceipts();
    if (badTokens.length > 0) {
      // Remove permanently-invalid tokens from the DB
      const { inArray } = await import("drizzle-orm");
      await db.delete(pushTokensTable).where(inArray(pushTokensTable.token, badTokens));
    }
    return res.json({ checked: true, badTokensPurged: badTokens.length, badTokens });
  } catch (err) {
    console.error("POST /admin/push/receipts error:", err);
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
