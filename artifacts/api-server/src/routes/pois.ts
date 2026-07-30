/**
 * Public POI endpoint — returns nearby points of interest from the DB.
 *
 * GET /api/pois?lat=&lng=&radius=
 *   lat, lng  — driver position (required)
 *   radius    — metres to search (default 8000, max 50000)
 */

import { Router, type Request, type Response } from "express";
import { db, poisTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

router.get("/pois", async (req: Request, res: Response): Promise<void> => {
  const lat    = parseFloat(req.query.lat    as string);
  const lng    = parseFloat(req.query.lng    as string);
  const radius = Math.min(50000, Math.max(100, parseFloat((req.query.radius as string) || "8000")));

  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({ error: "lat and lng are required numeric parameters" });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(poisTable)
      .where(eq(poisTable.status, "active"));

    const nearby = rows
      .filter((p) => haversine(lat, lng, p.lat, p.lng) <= radius)
      .slice(0, 50)
      .map((p) => ({
        id:      p.id,
        name:    p.name,
        brand:   p.brand,
        type:    p.type,
        lat:     p.lat,
        lng:     p.lng,
        address: p.address,
        hours:   p.hours ?? undefined,
      }));

    res.json({ pois: nearby });
  } catch (err) {
    console.error("[pois] DB error:", err);
    res.status(500).json({ error: "Failed to fetch POIs" });
  }
});

export default router;
