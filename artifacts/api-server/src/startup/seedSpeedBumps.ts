import { db, speedBumpsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import osmSpeedBumps from "../data/osmSpeedBumps.json";

type SeedBump = {
  osmType: string;
  osmId: string;
  featureType: string;
  name: string;
  road: string | null;
  lat: number;
  lng: number;
  direction: string | null;
  status: string;
  verified: boolean;
  alertEnabled: boolean;
  source: string;
  sourceTags: Record<string, string>;
};

export async function seedSpeedBumps(): Promise<void> {
  const rows = (osmSpeedBumps as unknown as SeedBump[]).map((row) =>
    row.featureType === "rumble_strip"
      ? { ...row, alertEnabled: false }
      : row,
  );
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += 100) {
    const result = await db
      .insert(speedBumpsTable)
      .values(rows.slice(offset, offset + 100))
      .onConflictDoNothing({
        target: [
          speedBumpsTable.source,
          speedBumpsTable.osmType,
          speedBumpsTable.osmId,
        ],
      })
      .returning({ id: speedBumpsTable.id });
    inserted += result.length;
  }
  logger.info(
    { bundled: rows.length, inserted },
    "OSM speed-bump catalogue synchronized",
  );
}