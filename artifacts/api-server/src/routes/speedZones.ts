import { Router, type Request, type Response } from "express";
import { db, speedZonesTable } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";

const router: Router = Router();

// Haversine in metres
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180, f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180, dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
    createdAt: z.createdAt.getTime(),
  };
}

// GET /speed-zones?lat=&lng=&radius= — active zones near a point (mobile app)
router.get("/speed-zones", async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radius = parseFloat((req.query.radius as string) ?? "50000");

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: "lat and lng are required" });
    }

    const latDelta = radius / 111320;
    const lngDelta = radius / (111320 * Math.cos((lat * Math.PI) / 180));

    const rows = await db
      .select()
      .from(speedZonesTable)
      .where(eq(speedZonesTable.status, "active"));

    const result = rows
      .filter((z) => {
        if (z.mode === "point") {
          if (z.lat == null || z.lng == null) return false;
          if (
            z.lat < lat - latDelta || z.lat > lat + latDelta ||
            z.lng < lng - lngDelta || z.lng > lng + lngDelta
          ) return false;
          return haversine(lat, lng, z.lat, z.lng) <= radius;
        }
        // stretch: include if either endpoint is within radius (simple approximation)
        if (z.startLat == null || z.startLng == null || z.endLat == null || z.endLng == null) return false;
        return (
          haversine(lat, lng, z.startLat, z.startLng) <= radius ||
          haversine(lat, lng, z.endLat, z.endLng) <= radius
        );
      })
      .map(toClient);

    return res.json({ zones: result });
  } catch (err) {
    console.error("GET /speed-zones error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
