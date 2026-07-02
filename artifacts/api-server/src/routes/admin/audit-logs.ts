import { Router, type Request, type Response } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { desc, sql, eq, and, gte } from "drizzle-orm";

const router = Router();

// GET /admin/audit-logs?page=&limit=&action=&since=
router.get("/audit-logs", async (req: Request, res: Response) => {
  try {
    const page  = Math.max(1, parseInt((req.query.page  as string) ?? "1"));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? "50")));
    const offset = (page - 1) * limit;
    const action = req.query.action as string | undefined;
    const since  = req.query.since  as string | undefined;

    const conditions: any[] = [];
    if (action) conditions.push(eq(auditLogsTable.action, action));
    if (since)  conditions.push(gte(auditLogsTable.createdAt, new Date(since)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` })
        .from(auditLogsTable)
        .where(where),
      db.select()
        .from(auditLogsTable)
        .where(where)
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    return res.json({
      logs: rows.map((r) => ({
        id:         r.id,
        actorId:    r.actorId,
        actorName:  r.actorName,
        actorRole:  r.actorRole,
        action:     r.action,
        targetType: r.targetType,
        targetId:   r.targetId,
        details:    r.details ? JSON.parse(r.details) : null,
        createdAt:  r.createdAt.toISOString(),
      })),
      total: countResult[0]?.count ?? 0,
      page,
      limit,
    });
  } catch (err) {
    console.error("GET /admin/audit-logs error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
