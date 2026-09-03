import { Router, type Request, type Response } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, speedBumpsTable } from "@workspace/db";

const router = Router();
const VALID_STATUSES = ["active", "inactive"];

function toClient(row: typeof speedBumpsTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/speed-bumps", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const conditions = [];
    if (req.query.status) conditions.push(eq(speedBumpsTable.status, String(req.query.status)));
    if (req.query.featureType) conditions.push(eq(speedBumpsTable.featureType, String(req.query.featureType)));
    if (req.query.verified === "true" || req.query.verified === "false") {
      conditions.push(eq(speedBumpsTable.verified, req.query.verified === "true"));
    }
    if (req.query.search) {
      const q = `%${String(req.query.search)}%`;
      conditions.push(or(
        ilike(speedBumpsTable.name, q),
        ilike(speedBumpsTable.road, q),
        ilike(speedBumpsTable.osmId, q),
      )!);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const [count, rows] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(speedBumpsTable).where(where),
      db.select().from(speedBumpsTable).where(where)
        .orderBy(desc(speedBumpsTable.updatedAt))
        .limit(limit).offset((page - 1) * limit),
    ]);
    return res.json({ bumps: rows.map(toClient), total: count[0]?.count ?? 0, page, limit });
  } catch (err) {
    req.log?.error?.({ err }, "GET /admin/speed-bumps failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/speed-bumps", async (req: Request, res: Response) => {
  try {
    const { name, road, description, featureType, lat, lng, direction, alertEnabled } = req.body;
    if (!name || !featureType || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "name, featureType, lat and lng are required" });
    }
    const [row] = await db.insert(speedBumpsTable).values({
      name, road: road || null, description: description || null, featureType,
      lat, lng, direction: direction || null, alertEnabled: alertEnabled !== false,
      osmType: "manual", osmId: crypto.randomUUID(), source: "admin",
      verified: true, createdBy: req.adminUser?.id ?? null,
    }).returning();
    return res.status(201).json(toClient(row));
  } catch (err) {
    req.log?.error?.({ err }, "POST /admin/speed-bumps failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/speed-bumps/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const allowed = ["name", "road", "description", "featureType", "lat", "lng", "direction", "alertEnabled", "verified", "status"] as const;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of allowed) if (key in req.body) patch[key] = req.body[key];
    if (patch.status && !VALID_STATUSES.includes(String(patch.status))) {
      return res.status(400).json({ error: "status must be active or inactive" });
    }
    const [row] = await db.update(speedBumpsTable).set(patch)
      .where(eq(speedBumpsTable.id, id)).returning();
    if (!row) return res.status(404).json({ error: "Speed bump not found" });
    return res.json(toClient(row));
  } catch (err) {
    req.log?.error?.({ err }, "PATCH /admin/speed-bumps failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/speed-bumps/:id", async (req: Request, res: Response) => {
  try {
    const [row] = await db.delete(speedBumpsTable)
      .where(eq(speedBumpsTable.id, req.params.id as string)).returning({ id: speedBumpsTable.id });
    if (!row) return res.status(404).json({ error: "Speed bump not found" });
    return res.json({ success: true });
  } catch (err) {
    req.log?.error?.({ err }, "DELETE /admin/speed-bumps failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;