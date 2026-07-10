import { Router, type Request, type Response } from "express";
import { db, creatorApplicationsTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { logAudit } from "../../lib/audit.js";

const router = Router();

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

router.patch("/creators/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const { status } = req.body;

    if (!["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ error: "status must be approved, rejected, or pending" });
    }

    const [updated] = await db
      .update(creatorApplicationsTable)
      .set({ status, updatedAt: new Date() })
      .where(eq(creatorApplicationsTable.id, id))
      .returning({
        id:   creatorApplicationsTable.id,
        name: creatorApplicationsTable.name,
      });

    if (!updated) {
      return res.status(404).json({ error: "Application not found" });
    }

    const actor = (req as any).admin;
    await logAudit({
      actor: { id: actor.id, name: actor.name, role: actor.role },
      action: `creator_application_${status}`,
      targetType: "creator_application",
      targetId: id,
      details: { applicantName: updated.name, newStatus: status },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("PATCH /admin/creators/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
