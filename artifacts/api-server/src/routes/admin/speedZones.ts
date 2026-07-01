import { Router, type Request, type Response } from "express";
import { db, speedZonesTable } from "@workspace/db";
import { eq, sql, ilike, or, desc } from "drizzle-orm";

const router = Router();

const VALID_TYPES = ["camera", "police", "zone"];
const VALID_MODES = ["point", "stretch"];

function toClient(z: typeof speedZonesTable.$inferSelect) {
  return {
    id: z.id,
    name: z.name,
    road: z.road,
    type: z.type,
    mode: z.mode,
    speedLimit: z.speedLimit,
    description: z.description,
    lat: z.lat,
    lng: z.lng,
    startLat: z.startLat,
    startLng: z.startLng,
    endLat: z.endLat,
    endLng: z.endLng,
    status: z.status,
    createdBy: z.createdBy,
    createdAt: z.createdAt.toISOString(),
    updatedAt: z.updatedAt.toISOString(),
  };
}

// GET /admin/speed-zones?page=&limit=&type=&mode=&status=&search=
router.get("/speed-zones", async (req: Request, res: Response) => {
  try {
    const page  = Math.max(1, parseInt((req.query.page  as string) ?? "1"));
    const limit = Math.min(200, Math.max(1, parseInt((req.query.limit as string) ?? "100")));
    const offset = (page - 1) * limit;
    const type   = req.query.type   as string | undefined;
    const mode   = req.query.mode   as string | undefined;
    const status = req.query.status as string | undefined;
    const search = req.query.search as string | undefined;

    const conditions: any[] = [];
    if (type)   conditions.push(eq(speedZonesTable.type, type));
    if (mode)   conditions.push(eq(speedZonesTable.mode, mode));
    if (status) conditions.push(eq(speedZonesTable.status, status));
    if (search) {
      conditions.push(
        or(
          ilike(speedZonesTable.name, `%${search}%`),
          ilike(speedZonesTable.road, `%${search}%`)
        )
      );
    }

    const where = conditions.length > 0
      ? sql`${conditions.reduce((a, b) => sql`${a} AND ${b}`)}`
      : undefined;

    const [countResult, rows] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` })
        .from(speedZonesTable)
        .where(where),
      db.select()
        .from(speedZonesTable)
        .where(where)
        .orderBy(desc(speedZonesTable.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const total = countResult[0]?.count ?? 0;

    return res.json({ zones: rows.map(toClient), total, page, limit });
  } catch (err) {
    console.error("GET /admin/speed-zones error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /admin/speed-zones
router.post("/speed-zones", async (req: Request, res: Response) => {
  try {
    const {
      name, road, type, mode, speedLimit, description,
      lat, lng, startLat, startLng, endLat, endLng,
    } = req.body as {
      name: string; road?: string; type: string; mode?: string;
      speedLimit?: number; description?: string;
      lat?: number; lng?: number;
      startLat?: number; startLng?: number; endLat?: number; endLng?: number;
    };

    if (!name || !type) {
      return res.status(400).json({ error: "name and type required" });
    }
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of ${VALID_TYPES.join(", ")}` });
    }
    const zoneMode = mode ?? "point";
    if (!VALID_MODES.includes(zoneMode)) {
      return res.status(400).json({ error: `mode must be one of ${VALID_MODES.join(", ")}` });
    }
    if (zoneMode === "point" && (lat == null || lng == null)) {
      return res.status(400).json({ error: "lat and lng required for point mode" });
    }
    if (zoneMode === "stretch" && (startLat == null || startLng == null || endLat == null || endLng == null)) {
      return res.status(400).json({ error: "startLat, startLng, endLat, endLng required for stretch mode" });
    }

    const caller = (req as any).adminUser;

    const [inserted] = await db
      .insert(speedZonesTable)
      .values({
        name,
        road: road ?? null,
        type,
        mode: zoneMode,
        speedLimit: speedLimit ?? null,
        description: description ?? null,
        lat: zoneMode === "point" ? lat : null,
        lng: zoneMode === "point" ? lng : null,
        startLat: zoneMode === "stretch" ? startLat : null,
        startLng: zoneMode === "stretch" ? startLng : null,
        endLat: zoneMode === "stretch" ? endLat : null,
        endLng: zoneMode === "stretch" ? endLng : null,
        createdBy: caller?.id ?? null,
      })
      .returning();

    return res.status(201).json(toClient(inserted));
  } catch (err) {
    console.error("POST /admin/speed-zones error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /admin/speed-zones/:id
router.patch("/speed-zones/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const {
      name, road, type, mode, speedLimit, description, status,
      lat, lng, startLat, startLng, endLat, endLng,
    } = req.body as {
      name?: string; road?: string | null; type?: string; mode?: string;
      speedLimit?: number | null; description?: string | null; status?: string;
      lat?: number | null; lng?: number | null;
      startLat?: number | null; startLng?: number | null; endLat?: number | null; endLng?: number | null;
    };

    const [existing] = await db
      .select()
      .from(speedZonesTable)
      .where(eq(speedZonesTable.id, id));

    if (!existing) return res.status(404).json({ error: "Not found" });

    if (type !== undefined && !VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of ${VALID_TYPES.join(", ")}` });
    }
    if (mode !== undefined && !VALID_MODES.includes(mode)) {
      return res.status(400).json({ error: `mode must be one of ${VALID_MODES.join(", ")}` });
    }
    if (status !== undefined && !["active", "inactive"].includes(status)) {
      return res.status(400).json({ error: "status must be 'active' or 'inactive'" });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name        !== undefined) updates["name"] = name;
    if (road        !== undefined) updates["road"] = road;
    if (type        !== undefined) updates["type"] = type;
    if (mode        !== undefined) updates["mode"] = mode;
    if (speedLimit  !== undefined) updates["speedLimit"] = speedLimit;
    if (description !== undefined) updates["description"] = description;
    if (status      !== undefined) updates["status"] = status;
    if (lat         !== undefined) updates["lat"] = lat;
    if (lng         !== undefined) updates["lng"] = lng;
    if (startLat    !== undefined) updates["startLat"] = startLat;
    if (startLng    !== undefined) updates["startLng"] = startLng;
    if (endLat      !== undefined) updates["endLat"] = endLat;
    if (endLng      !== undefined) updates["endLng"] = endLng;

    const [updated] = await db
      .update(speedZonesTable)
      .set(updates as any)
      .where(eq(speedZonesTable.id, id))
      .returning();

    return res.json(toClient(updated));
  } catch (err) {
    console.error("PATCH /admin/speed-zones/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /admin/speed-zones/:id
router.delete("/speed-zones/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;

    const [existing] = await db
      .select()
      .from(speedZonesTable)
      .where(eq(speedZonesTable.id, id));

    if (!existing) return res.status(404).json({ error: "Not found" });

    await db.delete(speedZonesTable).where(eq(speedZonesTable.id, id));
    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /admin/speed-zones/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
