import { Router, type Request, type Response } from "express";
import { db, communityReportsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

// GET /admin/stats
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totals, byType, byStatus, todayCount] = await Promise.all([
      db.select({
        total:   sql<number>`count(*)::int`,
        active:  sql<number>`count(*) filter (where status not in ('expired','denied'))::int`,
        expired: sql<number>`count(*) filter (where status = 'expired')::int`,
      }).from(communityReportsTable),

      db.select({
        label: communityReportsTable.type,
        count: sql<number>`count(*)::int`,
      })
        .from(communityReportsTable)
        .groupBy(communityReportsTable.type),

      db.select({
        label: communityReportsTable.status,
        count: sql<number>`count(*)::int`,
      })
        .from(communityReportsTable)
        .groupBy(communityReportsTable.status),

      db.select({ count: sql<number>`count(*)::int` })
        .from(communityReportsTable)
        .where(sql`created_at >= ${today}`),
    ]);

    return res.json({
      totalReports:   totals[0]?.total   ?? 0,
      activeReports:  totals[0]?.active  ?? 0,
      expiredReports: totals[0]?.expired ?? 0,
      reportsToday:   todayCount[0]?.count ?? 0,
      byType:   byType.map((r)   => ({ label: r.label,  count: r.count })),
      byStatus: byStatus.map((r) => ({ label: r.label,  count: r.count })),
    });
  } catch (err) {
    console.error("GET /admin/stats error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
