import { Router, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, speedBumpsTable } from "@workspace/db";

const router = Router();

function toClient(row: typeof speedBumpsTable.$inferSelect) {
  return {
    id: row.id,
    osmType: row.osmType,
    osmId: row.osmId,
    featureType: row.featureType,
    name: row.name,
    road: row.road,
    description: row.description,
    lat: row.lat,
    lng: row.lng,
    direction: row.direction,
    source: row.source,
    alertEnabled: row.alertEnabled,
    verified: row.verified,
  };
}

router.get("/speed-bumps", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(speedBumpsTable)
      .where(
        and(
          eq(speedBumpsTable.status, "active"),
          eq(speedBumpsTable.alertEnabled, true),
        ),
      );
    return res.json({ bumps: rows.map(toClient) });
  } catch (err) {
    _req.log?.error?.({ err }, "GET /speed-bumps failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;