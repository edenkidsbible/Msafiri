import * as fs from "fs";
import * as path from "path";
import { db, speedZonesTable } from "@workspace/db";
import { isNotNull } from "drizzle-orm";

// Resolve the mobile speedZones.ts file relative to the api-server working directory.
const SPEED_ZONES_FILE = path.resolve(process.cwd(), "../mobile/data/speedZones.ts");

/**
 * Patch a single static zone's lat/lng in speedZones.ts.
 * Best-effort — never throws; the DB record is the authoritative source of truth.
 */
export function patchStaticZoneFile(staticId: string, lat: number, lng: number): void {
  try {
    const src = fs.readFileSync(SPEED_ZONES_FILE, "utf-8");
    const lines = src.split("\n");
    let patched = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes(`"${staticId}"`) && !line.includes(`'${staticId}'`)) continue;
      const updated = line
        .replace(/\blat:\s*-?\d+(?:\.\d+)?/, `lat: ${lat}`)
        .replace(/\blng:\s*-?\d+(?:\.\d+)?/, `lng: ${lng}`);
      if (updated !== line) {
        lines[i] = updated;
        patched = true;
        break;
      }
    }
    if (patched) {
      fs.writeFileSync(SPEED_ZONES_FILE, lines.join("\n"), "utf-8");
      console.info(`[zone-sync] ${staticId} → lat=${lat}, lng=${lng}`);
    } else {
      console.warn(`[zone-sync] "${staticId}" not in speedZones.ts — DB updated only`);
    }
  } catch (err) {
    console.error("[zone-sync] Failed to patch speedZones.ts:", err);
  }
}

/**
 * On startup, replay every DB-relocated static zone back into speedZones.ts so
 * that the next mobile build picks up all past admin relocations automatically.
 * Safe to run on every cold start — it is idempotent (only updates if value differs).
 */
export async function syncStaticZones(): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(speedZonesTable)
      .where(isNotNull(speedZonesTable.staticId));

    let synced = 0;
    for (const row of rows) {
      if (row.staticId && row.lat != null && row.lng != null) {
        patchStaticZoneFile(row.staticId, row.lat, row.lng);
        synced++;
      }
    }

    console.info(`[zone-sync] startup sync complete — ${synced} zone(s) patched`);
  } catch (err) {
    console.error("[zone-sync] startup sync failed:", err);
  }
}
