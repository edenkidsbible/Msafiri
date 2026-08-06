import { Router, type Request, type Response } from "express";
import { db, communityReportsTable, brakingEventsTable, hazardClustersTable } from "@workspace/db";
import { sql, gte, eq } from "drizzle-orm";
import { subDays, format, startOfDay } from "date-fns";

const router = Router();

// GET /admin/stats
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const today = startOfDay(new Date());
    const sevenDaysAgo = subDays(today, 6);

    const [totals, byType, byStatus, todayCount, last7DaysRaw] = await Promise.all([
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

      db.select({
        day:   sql<string>`date_trunc('day', created_at)::date::text`,
        count: sql<number>`count(*)::int`,
      })
        .from(communityReportsTable)
        .where(gte(communityReportsTable.createdAt, sevenDaysAgo))
        .groupBy(sql`date_trunc('day', created_at)`)
        .orderBy(sql`date_trunc('day', created_at)`),
    ]);

    // Fill in missing days with 0
    const dayMap: Record<string, number> = {};
    for (const row of last7DaysRaw) {
      dayMap[row.day] = row.count;
    }
    const reportsByDay = Array.from({ length: 7 }, (_, i) => {
      const d = subDays(today, 6 - i);
      const key = format(d, "yyyy-MM-dd");
      return { date: key, count: dayMap[key] ?? 0 };
    });

    return res.json({
      totalReports:   totals[0]?.total   ?? 0,
      activeReports:  totals[0]?.active  ?? 0,
      expiredReports: totals[0]?.expired ?? 0,
      reportsToday:   todayCount[0]?.count ?? 0,
      byType:   byType.map((r)   => ({ label: r.label,  count: r.count })),
      byStatus: byStatus.map((r) => ({ label: r.label,  count: r.count })),
      reportsByDay,
    });
  } catch (err) {
    console.error("GET /admin/stats error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /admin/hazard-stats ────────────────────────────────────────────────────
// Summary metrics for the auto road-hazard detection system.
router.get("/hazard-stats", async (_req: Request, res: Response) => {
  try {
    const since7d = subDays(new Date(), 7);

    const [totalEvents, activeClusters, autoReports, topHotspots] = await Promise.all([
      // Total braking events in the last 7 days
      db.select({ count: sql<number>`count(*)::int` })
        .from(brakingEventsTable)
        .where(gte(brakingEventsTable.createdAt, since7d)),

      // Active clusters (device_count ≥ 5)
      db.select({ count: sql<number>`count(*)::int` })
        .from(hazardClustersTable)
        .where(sql`${hazardClustersTable.deviceCount} >= 5`),

      // Auto-created reports all time
      db.select({ count: sql<number>`count(*)::int` })
        .from(communityReportsTable)
        .where(eq(communityReportsTable.source, "auto")),

      // Top 5 hotspot clusters by device count
      db.select({
        reportId:     hazardClustersTable.reportId,
        lat:          hazardClustersTable.clusterLat,
        lng:          hazardClustersTable.clusterLng,
        dominantType: hazardClustersTable.dominantType,
        deviceCount:  hazardClustersTable.deviceCount,
        eventCount:   hazardClustersTable.eventCount,
        roadName:     communityReportsTable.roadName,
      })
        .from(hazardClustersTable)
        .leftJoin(communityReportsTable, eq(hazardClustersTable.reportId, communityReportsTable.id))
        .orderBy(sql`${hazardClustersTable.deviceCount} desc`)
        .limit(5),
    ]);

    return res.json({
      totalEvents7d:      totalEvents[0]?.count ?? 0,
      activeClusters:     activeClusters[0]?.count ?? 0,
      autoCreatedReports: autoReports[0]?.count ?? 0,
      topHotspots: topHotspots.map((h) => ({
        reportId:     h.reportId,
        lat:          h.lat,
        lng:          h.lng,
        dominantType: h.dominantType,
        deviceCount:  h.deviceCount,
        eventCount:   h.eventCount,
        roadName:     h.roadName ?? null,
      })),
    });
  } catch (err) {
    console.error("GET /admin/hazard-stats error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
