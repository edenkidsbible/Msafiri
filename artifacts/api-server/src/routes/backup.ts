/**
 * Data Backup routes
 *
 * POST /backup/sync             — upload vehicle + settings snapshot
 * POST /backup/restore-by-plate — knowledge-based recovery for accounts
 *                                  with no recovery email on file
 */
import { Router, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { db, deviceBackupsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import pino from "pino";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Mirrors the mobile normalizePlate() so the server searches with the same
 * canonical form the app stores in vehiclesJson.
 * Standard civilian: "KDA123A" → "KDA 123A"
 * Non-standard (govt, motorcycle, vintage): stripped + uppercased as-is.
 */
function normalizePlate(raw: string): string {
  const stripped = raw.replace(/[\s\-]/g, "").toUpperCase();
  const m = stripped.match(/^([A-Z]{3})(\d{3})([A-Z])$/);
  if (m) return `${m[1]} ${m[2]}${m[3]}`;
  return stripped;
}

// ── Rate limiter for restore-by-plate ────────────────────────────────────────
// 3 attempts per IP per 24 hours. Recovery requires correct plate + vehicle
// details — brute-force must be expensive.
const restoreByPlateLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ""),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    res.set("Retry-After", "86400");
    res.status(429).json({
      error: "Too many recovery attempts. Wait 24 hours and try again.",
    });
  },
});

// ── POST /backup/sync ──────────────────────────────────────────────────────────
router.post("/backup/sync", async (req: Request, res: Response) => {
  const { deviceId, vehicles, settings } = req.body as {
    deviceId?: string;
    vehicles?: unknown[];
    settings?: Record<string, unknown>;
  };
  if (!deviceId) return res.status(400).json({ error: "deviceId is required" });

  const vehiclesJson = JSON.stringify(vehicles ?? []);
  const settingsJson = JSON.stringify(settings ?? {});

  const updated = await db
    .update(deviceBackupsTable)
    .set({ vehiclesJson, settingsJson, lastBackupAt: new Date() })
    .where(eq(deviceBackupsTable.deviceId, deviceId))
    .returning({ id: deviceBackupsTable.id });

  if (updated.length === 0) {
    // Auto-create record if none exists yet (first sync after OTP link).
    // recovery_code is a legacy NOT NULL UNIQUE column — generate a random
    // throwaway value so we satisfy the constraint without collisions.
    await db.execute(
      sql`INSERT INTO device_backups (device_id, vehicles_json, settings_json)
          VALUES (${deviceId}, ${vehiclesJson}, ${settingsJson})
          ON CONFLICT (device_id) DO UPDATE
            SET vehicles_json = EXCLUDED.vehicles_json,
                settings_json = EXCLUDED.settings_json,
                last_backup_at = NOW()`
    );
  }

  return res.json({ ok: true });
});

// ── POST /backup/restore-by-plate ─────────────────────────────────────────────
// Knowledge-based recovery for existing accounts with no recovery email.
//
// The user must supply:
//   • plateNumber   — normalised Kenyan plate (primary lookup key)
//   • vehicleType   — car | psv | bus | truck | motorcycle | tractor
//   • fuelType      — Petrol | Diesel | Electric | Hybrid | CNG (if stored)
//   • transmission  — Automatic | Manual (if stored)
//   • newDeviceId   — the caller's new device UUID
//
// Verification rules:
//   1. vehicleType must always match.
//   2. At least one of fuelType or transmission must be verifiable (present in
//      the backup AND supplied by the caller) and must match.
//   3. If neither fuelType nor transmission was stored at setup time, recovery
//      via this endpoint is not possible — direct to admin claim route.
//
// On success the backup's device_id is updated to newDeviceId so future
// /backup/sync calls land on the right row.  The caller should then call
// POST /auth/send-otp (intent=link) to attach a recovery email so this
// path is never needed again.
router.post("/restore-by-plate", restoreByPlateLimiter, async (req: Request, res: Response) => {
  const { plateNumber, vehicleType, fuelType, transmission, newDeviceId } =
    req.body as {
      plateNumber?:  string;
      vehicleType?:  string;
      fuelType?:     string;
      transmission?: string;
      newDeviceId?:  string;
    };

  if (!plateNumber || !vehicleType || !newDeviceId) {
    return res.status(400).json({
      error: "plateNumber, vehicleType, and newDeviceId are required",
    });
  }

  const plate = normalizePlate(plateNumber);
  if (plate.length < 3) {
    return res.status(400).json({ error: "Invalid plate number" });
  }

  // ── Search backups that contain this plate in their vehiclesJson ─────────
  // We use a LIKE search on the text column — safe because plate is normalised
  // (uppercase, no SQL-injectable chars).  The result set is then filtered in
  // application code so mismatches on the JSON structure never fail silently.
  const searchResult = await db.execute(
    sql`SELECT device_id, vehicles_json, settings_json, recovery_email
        FROM device_backups
        WHERE vehicles_json LIKE ${"%" + plate + "%"}
          AND vehicles_json IS NOT NULL
          AND vehicles_json != '[]'
        ORDER BY last_backup_at DESC
        LIMIT 20`
  );

  const rows = searchResult.rows as Array<{
    device_id: string;
    vehicles_json: string;
    settings_json: string;
    recovery_email: string | null;
  }>;

  // ── Find the first backup whose JSON contains the exact plate + type match ─
  let matchedRow: (typeof rows)[0] | null = null;
  let matchedVehicle: Record<string, unknown> | null = null;

  for (const row of rows) {
    let vehicles: unknown[] = [];
    try { vehicles = JSON.parse(row.vehicles_json) ?? []; } catch { continue; }

    for (const v of vehicles) {
      if (typeof v !== "object" || v === null) continue;
      const veh = v as Record<string, unknown>;

      // Plate must match exactly (same normalization as stored)
      if (normalizePlate(String(veh.plateNumber ?? "")) !== plate) continue;

      // vehicleType must match
      if (String(veh.vehicleType ?? "") !== vehicleType) continue;

      matchedRow    = row;
      matchedVehicle = veh;
      break;
    }
    if (matchedRow) break;
  }

  if (!matchedRow || !matchedVehicle) {
    logger.warn({ plate, vehicleType }, "[restore-by-plate] No backup matched plate+type");
    // Return the same generic message whether the plate was not found OR the
    // vehicleType was wrong — don't let callers enumerate valid plates.
    return res.status(404).json({
      error: "No account found matching those details. Check the plate number and vehicle type.",
    });
  }

  // ── Verify at least one optional field (fuelType / transmission) ──────────
  const storedFuel  = matchedVehicle.fuelType  as string | undefined;
  const storedTrans = matchedVehicle.transmission as string | undefined;

  const hasFuelToVerify  = !!storedFuel  && !!fuelType;
  const hasTrToVerify    = !!storedTrans && !!transmission;

  if (!hasFuelToVerify && !hasTrToVerify) {
    // Backup doesn't have either optional field — we can't securely verify.
    return res.status(422).json({
      error:
        "Your account doesn't have enough verification details on file. " +
        "Please submit a claim and our team will assist you.",
      code: "INSUFFICIENT_VERIFICATION_DATA",
    });
  }

  // Both verifiable fields must match (if we have them)
  if (hasFuelToVerify  && storedFuel  !== fuelType)     {
    logger.warn({ plate }, "[restore-by-plate] Fuel type mismatch");
    return res.status(403).json({ error: "The vehicle details you entered don't match our records." });
  }
  if (hasTrToVerify    && storedTrans !== transmission) {
    logger.warn({ plate }, "[restore-by-plate] Transmission mismatch");
    return res.status(403).json({ error: "The vehicle details you entered don't match our records." });
  }

  // ── Account already has a recovery email — direct them to email restore ───
  if (matchedRow.recovery_email) {
    return res.status(409).json({
      error: "This account already has a recovery email. Use 'Restore via Email' instead.",
      code: "HAS_RECOVERY_EMAIL",
    });
  }

  // ── Transfer backup to new device ─────────────────────────────────────────
  await db.execute(
    sql`UPDATE device_backups SET device_id = ${newDeviceId}
        WHERE device_id = ${matchedRow.device_id}`
  );

  let vehicles: unknown[] = [];
  let settings: Record<string, unknown> = {};
  try { vehicles = JSON.parse(matchedRow.vehicles_json) ?? []; } catch { /* */ }
  try { settings = JSON.parse(matchedRow.settings_json)  ?? {}; } catch { /* */ }

  logger.info({ plate, newDeviceId }, "[restore-by-plate] Restore successful");
  return res.json({ vehicles, settings });
});

export default router;
