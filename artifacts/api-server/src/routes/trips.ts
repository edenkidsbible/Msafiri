import { Router, type Request, type Response } from "express";
import { db, savedPlacesTable, plannedTripsTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";

const router: Router = Router();

// ── Saved places ───────────────────────────────────────────────────────────

// GET /saved-places?deviceId=
router.get("/saved-places", async (req: Request, res: Response) => {
  try {
    const deviceId = req.query.deviceId as string;
    if (!deviceId) return res.status(400).json({ error: "deviceId is required" });

    const rows = await db
      .select()
      .from(savedPlacesTable)
      .where(eq(savedPlacesTable.deviceId, deviceId))
      .orderBy(asc(savedPlacesTable.createdAt));

    return res.json({
      places: rows.map((r) => ({
        id: r.id,
        label: r.label,
        kind: r.kind,
        address: r.address,
        lat: r.lat,
        lng: r.lng,
        usualTimeMinutes: r.usualTimeMinutes,
        createdAt: r.createdAt.getTime(),
      })),
    });
  } catch (err) {
    console.error("GET /saved-places error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /saved-places
router.post("/saved-places", async (req: Request, res: Response) => {
  try {
    const { deviceId, label, kind, address, lat, lng, usualTimeMinutes } = req.body as {
      deviceId: string; label: string; kind?: string; address?: string;
      lat: number; lng: number; usualTimeMinutes?: number | null;
    };

    if (!deviceId || !label || lat == null || lng == null) {
      return res.status(400).json({ error: "deviceId, label, lat, lng are required" });
    }

    const [inserted] = await db
      .insert(savedPlacesTable)
      .values({
        deviceId, label, kind: kind ?? "custom", address: address ?? null,
        lat, lng, usualTimeMinutes: usualTimeMinutes ?? null,
      })
      .returning();

    return res.status(201).json({
      id: inserted.id, label: inserted.label, kind: inserted.kind, address: inserted.address,
      lat: inserted.lat, lng: inserted.lng, usualTimeMinutes: inserted.usualTimeMinutes,
      createdAt: inserted.createdAt.getTime(),
    });
  } catch (err) {
    console.error("POST /saved-places error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /saved-places/:id
router.patch("/saved-places/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const { deviceId, label, kind, address, lat, lng, usualTimeMinutes } = req.body as {
      deviceId: string; label?: string; kind?: string; address?: string;
      lat?: number; lng?: number; usualTimeMinutes?: number | null;
    };
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    const [place] = await db.select().from(savedPlacesTable).where(eq(savedPlacesTable.id, id));
    if (!place) return res.status(404).json({ error: "Not found" });
    if (place.deviceId !== deviceId) return res.status(403).json({ error: "Not your saved place" });

    const updates: Record<string, unknown> = {};
    if (label !== undefined) updates["label"] = label;
    if (kind !== undefined) updates["kind"] = kind;
    if (address !== undefined) updates["address"] = address;
    if (lat !== undefined) updates["lat"] = lat;
    if (lng !== undefined) updates["lng"] = lng;
    if (usualTimeMinutes !== undefined) updates["usualTimeMinutes"] = usualTimeMinutes;

    const [updated] = await db
      .update(savedPlacesTable)
      .set(updates as any)
      .where(eq(savedPlacesTable.id, id))
      .returning();

    return res.json({
      id: updated.id, label: updated.label, kind: updated.kind, address: updated.address,
      lat: updated.lat, lng: updated.lng, usualTimeMinutes: updated.usualTimeMinutes,
    });
  } catch (err) {
    console.error("PATCH /saved-places/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /saved-places/:id
router.delete("/saved-places/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const { deviceId } = req.body as { deviceId: string };
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    const [place] = await db.select().from(savedPlacesTable).where(eq(savedPlacesTable.id, id));
    if (!place) return res.status(404).json({ error: "Not found" });
    if (place.deviceId !== deviceId) return res.status(403).json({ error: "Not your saved place" });

    await db.delete(savedPlacesTable).where(eq(savedPlacesTable.id, id));
    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /saved-places/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── Planned trips ────────────────────────────────────────────────────────────

// GET /planned-trips?deviceId=
router.get("/planned-trips", async (req: Request, res: Response) => {
  try {
    const deviceId = req.query.deviceId as string;
    if (!deviceId) return res.status(400).json({ error: "deviceId is required" });

    const rows = await db
      .select()
      .from(plannedTripsTable)
      .where(eq(plannedTripsTable.deviceId, deviceId))
      .orderBy(asc(plannedTripsTable.plannedAt));

    return res.json({
      trips: rows.map((r) => ({
        id: r.id,
        savedPlaceId: r.savedPlaceId,
        label: r.label,
        destLat: r.destLat,
        destLng: r.destLng,
        plannedAt: r.plannedAt.getTime(),
        status: r.status,
        notifiedAt: r.notifiedAt?.getTime() ?? null,
        createdAt: r.createdAt.getTime(),
      })),
    });
  } catch (err) {
    console.error("GET /planned-trips error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /planned-trips
router.post("/planned-trips", async (req: Request, res: Response) => {
  try {
    const { deviceId, savedPlaceId, label, destLat, destLng, plannedAt } = req.body as {
      deviceId: string; savedPlaceId?: string | null; label: string;
      destLat: number; destLng: number; plannedAt: number;
    };

    if (!deviceId || !label || destLat == null || destLng == null || !plannedAt) {
      return res.status(400).json({ error: "deviceId, label, destLat, destLng, plannedAt are required" });
    }

    const [inserted] = await db
      .insert(plannedTripsTable)
      .values({
        deviceId, savedPlaceId: savedPlaceId ?? null, label,
        destLat, destLng, plannedAt: new Date(plannedAt), status: "upcoming",
      })
      .returning();

    return res.status(201).json({
      id: inserted.id, savedPlaceId: inserted.savedPlaceId, label: inserted.label,
      destLat: inserted.destLat, destLng: inserted.destLng,
      plannedAt: inserted.plannedAt.getTime(), status: inserted.status,
      createdAt: inserted.createdAt.getTime(),
    });
  } catch (err) {
    console.error("POST /planned-trips error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /planned-trips/:id — cancel, mark completed, or reschedule
router.patch("/planned-trips/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const { deviceId, status, plannedAt } = req.body as {
      deviceId: string; status?: string; plannedAt?: number;
    };
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    const [trip] = await db.select().from(plannedTripsTable).where(eq(plannedTripsTable.id, id));
    if (!trip) return res.status(404).json({ error: "Not found" });
    if (trip.deviceId !== deviceId) return res.status(403).json({ error: "Not your planned trip" });

    const updates: Record<string, unknown> = {};
    if (status !== undefined) updates["status"] = status;
    if (plannedAt !== undefined) {
      updates["plannedAt"] = new Date(plannedAt);
      // Rescheduling a trip should re-arm the departure-advice notification
      updates["status"] = "upcoming";
      updates["notifiedAt"] = null;
    }

    const [updated] = await db
      .update(plannedTripsTable)
      .set(updates as any)
      .where(eq(plannedTripsTable.id, id))
      .returning();

    return res.json({
      id: updated.id, status: updated.status, plannedAt: updated.plannedAt.getTime(),
    });
  } catch (err) {
    console.error("PATCH /planned-trips/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /planned-trips/:id
router.delete("/planned-trips/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const { deviceId } = req.body as { deviceId: string };
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    const [trip] = await db.select().from(plannedTripsTable).where(eq(plannedTripsTable.id, id));
    if (!trip) return res.status(404).json({ error: "Not found" });
    if (trip.deviceId !== deviceId) return res.status(403).json({ error: "Not your planned trip" });

    await db.delete(plannedTripsTable).where(eq(plannedTripsTable.id, id));
    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /planned-trips/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
