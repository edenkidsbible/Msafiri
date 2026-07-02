import { Router, type Request, type Response } from "express";
import { db, communityReportsTable } from "@workspace/db";
import { eq, sql, ilike, or, desc, inArray } from "drizzle-orm";
import { logAudit, createNotification } from "../../lib/audit.js";
import type { AdminJwtPayload } from "../../middleware/adminAuth.js";

const router = Router();

// GET /admin/reports?page=&limit=&type=&status=&search=
router.get("/reports", async (req: Request, res: Response) => {
  try {
    const page  = Math.max(1, parseInt((req.query.page  as string) ?? "1"));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? "50")));
    const offset = (page - 1) * limit;
    const type   = req.query.type   as string | undefined;
    const status = req.query.status as string | undefined;
    const search = req.query.search as string | undefined;

    const conditions: any[] = [];
    if (type)   conditions.push(eq(communityReportsTable.type, type));
    if (status) conditions.push(eq(communityReportsTable.status, status));
    if (search) {
      conditions.push(
        or(
          ilike(communityReportsTable.roadName, `%${search}%`),
          ilike(communityReportsTable.type, `%${search}%`)
        )
      );
    }

    const where = conditions.length > 0
      ? sql`${conditions.reduce((a, b) => sql`${a} AND ${b}`)}`
      : undefined;

    const [countResult, rows] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` })
        .from(communityReportsTable)
        .where(where),
      db.select()
        .from(communityReportsTable)
        .where(where)
        .orderBy(desc(communityReportsTable.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const total = countResult[0]?.count ?? 0;

    return res.json({
      reports: rows.map((r) => ({
        id:           r.id,
        type:         r.type,
        lat:          r.lat,
        lng:          r.lng,
        deviceId:     r.deviceId,
        status:       r.status,
        confirmCount: r.confirmCount,
        denyCount:    r.denyCount,
        speedLimit:   r.speedLimit,
        roadName:     r.roadName,
        createdAt:    r.createdAt.toISOString(),
        expiresAt:    r.expiresAt?.toISOString() ?? null,
      })),
      total,
      page,
      limit,
    });
  } catch (err) {
    console.error("GET /admin/reports error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/reports/export — CSV download
router.get("/reports/export", async (req: Request, res: Response) => {
  try {
    const type   = req.query.type   as string | undefined;
    const status = req.query.status as string | undefined;

    const conditions: any[] = [];
    if (type)   conditions.push(eq(communityReportsTable.type, type));
    if (status) conditions.push(eq(communityReportsTable.status, status));

    const where = conditions.length > 0
      ? sql`${conditions.reduce((a, b) => sql`${a} AND ${b}`)}`
      : undefined;

    const rows = await db
      .select()
      .from(communityReportsTable)
      .where(where)
      .orderBy(desc(communityReportsTable.createdAt))
      .limit(10000);

    const headers = ["id", "type", "status", "roadName", "lat", "lng", "speedLimit", "confirmCount", "denyCount", "createdAt", "expiresAt"];
    const csvLines = [
      headers.join(","),
      ...rows.map((r) =>
        [
          r.id,
          r.type,
          r.status,
          `"${(r.roadName ?? "").replace(/"/g, '""')}"`,
          r.lat,
          r.lng,
          r.speedLimit ?? "",
          r.confirmCount,
          r.denyCount,
          r.createdAt.toISOString(),
          r.expiresAt?.toISOString() ?? "",
        ].join(",")
      ),
    ];

    const actor = (req as any).adminUser as AdminJwtPayload;
    await logAudit({ actor, action: "report.export", details: { count: rows.length, type, status } });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="reports-${Date.now()}.csv"`);
    return res.send(csvLines.join("\n"));
  } catch (err) {
    console.error("GET /admin/reports/export error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /admin/reports
router.post("/reports", async (req: Request, res: Response) => {
  try {
    const { type, lat, lng, deviceId, status, speedLimit, roadName } = req.body as {
      type: string; lat: number; lng: number;
      deviceId?: string; status?: string;
      speedLimit?: number; roadName?: string;
    };

    if (!type || lat == null || lng == null) {
      return res.status(400).json({ error: "type, lat, lng required" });
    }

    const [inserted] = await db
      .insert(communityReportsTable)
      .values({
        type,
        lat,
        lng,
        deviceId: deviceId ?? "admin",
        status: status ?? "active",
        speedLimit: speedLimit ?? null,
        roadName: roadName ?? null,
      })
      .returning();

    const actor = (req as any).adminUser as AdminJwtPayload;
    await logAudit({ actor, action: "report.create", targetType: "report", targetId: inserted.id, details: { type, roadName } });

    return res.status(201).json({
      id:           inserted.id,
      type:         inserted.type,
      lat:          inserted.lat,
      lng:          inserted.lng,
      deviceId:     inserted.deviceId,
      status:       inserted.status,
      confirmCount: inserted.confirmCount,
      denyCount:    inserted.denyCount,
      speedLimit:   inserted.speedLimit,
      roadName:     inserted.roadName,
      createdAt:    inserted.createdAt.toISOString(),
      expiresAt:    inserted.expiresAt?.toISOString() ?? null,
    });
  } catch (err) {
    console.error("POST /admin/reports error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /admin/reports/bulk — bulk action
router.post("/reports/bulk", async (req: Request, res: Response) => {
  try {
    const { action, ids } = req.body as { action: "confirm" | "deny" | "delete"; ids: string[] };

    if (!action || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "action and ids[] required" });
    }
    if (!["confirm", "deny", "delete"].includes(action)) {
      return res.status(400).json({ error: "action must be confirm|deny|delete" });
    }

    let affected = 0;
    if (action === "delete") {
      const result = await db
        .delete(communityReportsTable)
        .where(inArray(communityReportsTable.id, ids));
      affected = ids.length;
    } else {
      const newStatus = action === "confirm" ? "confirmed" : "denied";
      await db
        .update(communityReportsTable)
        .set({ status: newStatus })
        .where(inArray(communityReportsTable.id, ids));
      affected = ids.length;
    }

    const actor = (req as any).adminUser as AdminJwtPayload;
    await logAudit({ actor, action: `report.bulk_${action}`, details: { ids, count: affected } });

    const actionLabel = action === "delete" ? "deleted" : action === "confirm" ? "confirmed" : "denied";
    await createNotification({
      title:   `Bulk action: ${affected} reports ${actionLabel}`,
      message: `${actor.name} (${actor.role}) ${actionLabel} ${affected} incident report${affected !== 1 ? "s" : ""}.`,
      type:    action === "delete" ? "warning" : "success",
    });

    return res.json({ success: true, affected });
  } catch (err) {
    console.error("POST /admin/reports/bulk error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /admin/reports/:id
router.patch("/reports/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const { type, lat, lng, status, speedLimit, roadName, confirmCount, denyCount } = req.body as {
      type?: string; lat?: number; lng?: number; status?: string;
      speedLimit?: number | null; roadName?: string | null;
      confirmCount?: number; denyCount?: number;
    };

    const [existing] = await db
      .select()
      .from(communityReportsTable)
      .where(eq(communityReportsTable.id, id));

    if (!existing) return res.status(404).json({ error: "Not found" });

    const updates: Record<string, unknown> = {};
    if (type         !== undefined) updates["type"]         = type;
    if (lat          !== undefined) updates["lat"]          = lat;
    if (lng          !== undefined) updates["lng"]          = lng;
    if (status       !== undefined) updates["status"]       = status;
    if (speedLimit   !== undefined) updates["speedLimit"]   = speedLimit;
    if (roadName     !== undefined) updates["roadName"]     = roadName;
    if (confirmCount !== undefined) updates["confirmCount"] = confirmCount;
    if (denyCount    !== undefined) updates["denyCount"]    = denyCount;

    const [updated] = await db
      .update(communityReportsTable)
      .set(updates as any)
      .where(eq(communityReportsTable.id, id))
      .returning();

    const actor = (req as any).adminUser as AdminJwtPayload;
    await logAudit({ actor, action: "report.update", targetType: "report", targetId: id, details: updates });

    return res.json({
      id:           updated.id,
      type:         updated.type,
      lat:          updated.lat,
      lng:          updated.lng,
      deviceId:     updated.deviceId,
      status:       updated.status,
      confirmCount: updated.confirmCount,
      denyCount:    updated.denyCount,
      speedLimit:   updated.speedLimit,
      roadName:     updated.roadName,
      createdAt:    updated.createdAt.toISOString(),
      expiresAt:    updated.expiresAt?.toISOString() ?? null,
    });
  } catch (err) {
    console.error("PATCH /admin/reports/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /admin/reports/:id
router.delete("/reports/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;

    const [existing] = await db
      .select()
      .from(communityReportsTable)
      .where(eq(communityReportsTable.id, id));

    if (!existing) return res.status(404).json({ error: "Not found" });

    await db
      .delete(communityReportsTable)
      .where(eq(communityReportsTable.id, id));

    const actor = (req as any).adminUser as AdminJwtPayload;
    await logAudit({ actor, action: "report.delete", targetType: "report", targetId: id, details: { type: existing.type } });

    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /admin/reports/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
