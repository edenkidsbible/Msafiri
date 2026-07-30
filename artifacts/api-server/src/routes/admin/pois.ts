/**
 * Admin POI management routes.
 *
 * GET    /admin/pois           — paginated list with search / type / status filters
 * POST   /admin/pois           — create a new POI
 * PATCH  /admin/pois/:id       — update a POI (any field)
 * DELETE /admin/pois/:id       — deactivate (sets status=inactive); hard-deletes if ?hard=1
 */

import { Router, type Request, type Response } from "express";
import { db, poisTable } from "@workspace/db";
import { eq, sql, ilike, or, and, desc } from "drizzle-orm";

const router = Router();

const VALID_TYPES    = ["fuel", "food", "shopping", "hospital"];
const VALID_STATUSES = ["active", "inactive"];

function toClient(p: typeof poisTable.$inferSelect) {
  return {
    id:        p.id,
    name:      p.name,
    brand:     p.brand,
    type:      p.type,
    lat:       p.lat,
    lng:       p.lng,
    address:   p.address,
    hours:     p.hours,
    status:    p.status,
    staticId:  p.staticId,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// ── GET /admin/pois ───────────────────────────────────────────────────────────

router.get("/pois", async (req: Request, res: Response): Promise<void> => {
  const page   = Math.max(1, parseInt((req.query.page   as string) ?? "1"));
  const limit  = Math.min(200, Math.max(1, parseInt((req.query.limit  as string) ?? "50")));
  const offset = (page - 1) * limit;
  const type   = req.query.type   as string | undefined;
  const status = req.query.status as string | undefined;
  const search = req.query.search as string | undefined;

  try {
    const conditions = [];
    if (type   && VALID_TYPES.includes(type))       conditions.push(eq(poisTable.type, type));
    if (status && VALID_STATUSES.includes(status))  conditions.push(eq(poisTable.status, status));
    if (search) {
      conditions.push(
        or(
          ilike(poisTable.name,    `%${search}%`),
          ilike(poisTable.brand,   `%${search}%`),
          ilike(poisTable.address, `%${search}%`)
        )
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(poisTable)
        .where(where)
        .orderBy(desc(poisTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: sql<number>`COUNT(*)::int` }).from(poisTable).where(where),
    ]);

    res.json({ pois: rows.map(toClient), total, page, limit });
  } catch (err) {
    console.error("[admin/pois] list error:", err);
    res.status(500).json({ error: "Failed to list POIs" });
  }
});

// ── POST /admin/pois ──────────────────────────────────────────────────────────

router.post("/pois", async (req: Request, res: Response): Promise<void> => {
  const { name, brand, type, lat, lng, address, hours } = req.body ?? {};

  if (!name || !brand || !type || lat == null || lng == null || !address) {
    res.status(400).json({ error: "name, brand, type, lat, lng, and address are required" });
    return;
  }
  if (!VALID_TYPES.includes(type)) {
    res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(", ")}` });
    return;
  }
  if (isNaN(Number(lat)) || isNaN(Number(lng))) {
    res.status(400).json({ error: "lat and lng must be numbers" });
    return;
  }

  try {
    const [created] = await db.insert(poisTable).values({
      name,
      brand,
      type,
      lat:     Number(lat),
      lng:     Number(lng),
      address,
      hours:   hours ?? null,
      status:  "active",
    }).returning();

    res.status(201).json(toClient(created));
  } catch (err) {
    console.error("[admin/pois] create error:", err);
    res.status(500).json({ error: "Failed to create POI" });
  }
});

// ── PATCH /admin/pois/:id ─────────────────────────────────────────────────────

router.patch("/pois/:id", async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { name, brand, type, lat, lng, address, hours, status } = req.body ?? {};

  if (type   && !VALID_TYPES.includes(type))     { res.status(400).json({ error: "Invalid type" });   return; }
  if (status && !VALID_STATUSES.includes(status)) { res.status(400).json({ error: "Invalid status" }); return; }
  if ((lat != null && isNaN(Number(lat))) || (lng != null && isNaN(Number(lng)))) {
    res.status(400).json({ error: "lat and lng must be numbers" });
    return;
  }

  try {
    const updates: Partial<typeof poisTable.$inferInsert & { updatedAt: Date }> = { updatedAt: new Date() };
    if (name    != null) updates.name    = name;
    if (brand   != null) updates.brand   = brand;
    if (type    != null) updates.type    = type;
    if (lat     != null) updates.lat     = Number(lat);
    if (lng     != null) updates.lng     = Number(lng);
    if (address != null) updates.address = address;
    if (hours   !== undefined) updates.hours  = hours ?? null;
    if (status  != null) updates.status  = status;

    const [updated] = await db
      .update(poisTable)
      .set(updates)
      .where(eq(poisTable.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "POI not found" }); return; }
    res.json(toClient(updated));
  } catch (err) {
    console.error("[admin/pois] update error:", err);
    res.status(500).json({ error: "Failed to update POI" });
  }
});

// ── DELETE /admin/pois/:id ────────────────────────────────────────────────────

router.delete("/pois/:id", async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const hard   = req.query.hard === "1";

  try {
    if (hard) {
      const [deleted] = await db
        .delete(poisTable)
        .where(eq(poisTable.id, id))
        .returning({ id: poisTable.id });
      if (!deleted) { res.status(404).json({ error: "POI not found" }); return; }
      res.json({ deleted: true });
      return;
    }

    // Soft-delete: set status=inactive
    const [updated] = await db
      .update(poisTable)
      .set({ status: "inactive", updatedAt: new Date() })
      .where(eq(poisTable.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "POI not found" }); return; }
    res.json(toClient(updated));
  } catch (err) {
    console.error("[admin/pois] delete error:", err);
    res.status(500).json({ error: "Failed to delete POI" });
  }
});

export default router;
