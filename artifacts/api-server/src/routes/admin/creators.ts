import { Router, type Request, type Response } from "express";
import { db, creatorApplicationsTable, promoCodesTable } from "@workspace/db";
import { desc, eq, isNull, sql } from "drizzle-orm";
import { logAudit } from "../../lib/audit.js";
import { sendCreatorPromoCode } from "../../lib/email.js";

const router = Router();

// GET /admin/creators
router.get("/creators", async (_req: Request, res: Response) => {
  try {
    const [applications, stats] = await Promise.all([
      db
        .select()
        .from(creatorApplicationsTable)
        .orderBy(desc(creatorApplicationsTable.createdAt))
        .limit(500),
      db
        .select({
          status: creatorApplicationsTable.status,
          count: sql<number>`count(*)::int`,
        })
        .from(creatorApplicationsTable)
        .groupBy(creatorApplicationsTable.status),
    ]);

    const counts = { pending: 0, approved: 0, rejected: 0, total: 0 };
    for (const s of stats) {
      const key = s.status as "pending" | "approved" | "rejected";
      if (key in counts) counts[key] = s.count;
      counts.total += s.count;
    }

    return res.json({
      applications: applications.map((a) => ({
        id:        a.id,
        deviceId:  a.deviceId,
        name:      a.name,
        email:     a.email,
        reason:    a.reason ?? null,
        status:    a.status,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
      counts,
    });
  } catch (err) {
    console.error("GET /admin/creators error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/creators/codes/stats
router.get("/creators/codes/stats", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        platform:  promoCodesTable.platform,
        total:     sql<number>`count(*)::int`,
        used:      sql<number>`count(case when application_id is not null then 1 end)::int`,
      })
      .from(promoCodesTable)
      .groupBy(promoCodesTable.platform);

    const stats: Record<string, { total: number; used: number; remaining: number }> = {
      ios:     { total: 0, used: 0, remaining: 0 },
      android: { total: 0, used: 0, remaining: 0 },
    };

    for (const r of rows) {
      const p = r.platform as "ios" | "android";
      if (p in stats) {
        stats[p] = { total: r.total, used: r.used, remaining: r.total - r.used };
      }
    }

    return res.json(stats);
  } catch (err) {
    console.error("GET /admin/creators/codes/stats error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /admin/creators/codes  — bulk upload promo codes
router.post("/creators/codes", async (req: Request, res: Response) => {
  try {
    const { platform, codes } = req.body as { platform: string; codes: string[] };

    if (!["ios", "android"].includes(platform)) {
      return res.status(400).json({ error: "platform must be ios or android" });
    }
    if (!Array.isArray(codes) || codes.length === 0) {
      return res.status(400).json({ error: "codes must be a non-empty array" });
    }

    const rows = codes
      .map((c) => c.trim())
      .filter(Boolean)
      .map((code) => ({ platform, code }));

    // Insert, silently ignore duplicate codes (unique constraint)
    let inserted = 0;
    for (const row of rows) {
      try {
        await db.insert(promoCodesTable).values(row).onConflictDoNothing();
        inserted++;
      } catch {
        // skip
      }
    }

    const actor = (req as any).admin;
    await logAudit({
      actor: { id: actor.id, name: actor.name, role: actor.role },
      action: "promo_codes_uploaded",
      targetType: "promo_codes",
      targetId: platform,
      details: { platform, attempted: rows.length, inserted },
    });

    return res.json({ success: true, inserted, attempted: rows.length });
  } catch (err) {
    console.error("POST /admin/creators/codes error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /admin/creators/:id  — approve/reject application
router.patch("/creators/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const { status } = req.body;

    if (!["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ error: "status must be approved, rejected, or pending" });
    }

    const [existing] = await db
      .select()
      .from(creatorApplicationsTable)
      .where(eq(creatorApplicationsTable.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Application not found" });
    }

    const [updated] = await db
      .update(creatorApplicationsTable)
      .set({ status, updatedAt: new Date() })
      .where(eq(creatorApplicationsTable.id, id))
      .returning();

    const actor = (req as any).admin;
    await logAudit({
      actor: { id: actor.id, name: actor.name, role: actor.role },
      action: `creator_application_${status}`,
      targetType: "creator_application",
      targetId: id,
      details: { applicantEmail: existing.email, newStatus: status },
    });

    // When approving: pick an unused code and email it
    let codeAssigned   = false;
    let emailSent      = false;
    let noCodesLeft    = false;

    if (status === "approved" && existing.status !== "approved") {
      // Detect the platform by OS hint in user-agent or just pick iOS first, Android second
      // Strategy: pick any available code for either platform (iOS first, then Android)
      const [iosCode] = await db
        .select()
        .from(promoCodesTable)
        .where(sql`platform = 'ios' AND application_id IS NULL`)
        .limit(1);

      const [androidCode] = await db
        .select()
        .from(promoCodesTable)
        .where(sql`platform = 'android' AND application_id IS NULL`)
        .limit(1);

      const chosen = iosCode ?? androidCode;

      if (chosen) {
        await db
          .update(promoCodesTable)
          .set({ applicationId: id, sentAt: new Date() })
          .where(eq(promoCodesTable.id, chosen.id));

        codeAssigned = true;

        emailSent = await sendCreatorPromoCode({
          toEmail:  existing.email,
          toName:   existing.name,
          code:     chosen.code,
          platform: chosen.platform as "ios" | "android",
        });
      } else {
        noCodesLeft = true;
      }
    }

    return res.json({ success: true, codeAssigned, emailSent, noCodesLeft });
  } catch (err) {
    console.error("PATCH /admin/creators/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
