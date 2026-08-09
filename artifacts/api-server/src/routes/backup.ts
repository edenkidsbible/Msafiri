/**
 * Data Backup & Recovery routes
 *
 * POST /backup/init     — create (or fetch) a recovery code for this device
 * POST /backup/sync     — upload vehicle + settings snapshot
 * POST /backup/verify   — verify code + plate → return data, migrate device ID
 * GET  /backup/code     — fetch recovery code for a device (by deviceId query param)
 */
import { Router, type Request, type Response } from "express";
import { db, deviceBackupsTable, pushTokensTable, savedPlacesTable, plannedTripsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Generate a random 5-char uppercase alphanumeric code (A-Z, 2-9, no 0/O/1/I). */
function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/** Normalise a plate for comparison: uppercase, strip spaces and hyphens. */
function normalisePlate(plate: string): string {
  return plate.toUpperCase().replace(/[\s\-]/g, "");
}

/** Check whether `inputPlate` matches any plate in the backed-up vehicle list. */
function plateMatches(vehiclesJson: string, inputPlate: string): boolean {
  try {
    const vehicles = JSON.parse(vehiclesJson) as Array<{ plateNumber?: string }>;
    const norm = normalisePlate(inputPlate);
    return vehicles.some((v) => v.plateNumber && normalisePlate(v.plateNumber) === norm);
  } catch {
    return false;
  }
}

// ── POST /backup/init ──────────────────────────────────────────────────────────
// Creates a recovery record for this device if one does not exist yet.
// Idempotent — safe to call on every app start.
router.post("/backup/init", async (req: Request, res: Response) => {
  const { deviceId } = req.body as { deviceId?: string };
  if (!deviceId) return res.status(400).json({ error: "deviceId is required" });

  // Check for existing record first
  const existing = await db
    .select({ recoveryCode: deviceBackupsTable.recoveryCode })
    .from(deviceBackupsTable)
    .where(eq(deviceBackupsTable.deviceId, deviceId))
    .limit(1);

  if (existing.length > 0) {
    return res.json({ recoveryCode: existing[0].recoveryCode });
  }

  // Generate a unique code (retry up to 10 times on collision)
  let code = "";
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = generateCode();
    const clash = await db
      .select({ id: deviceBackupsTable.id })
      .from(deviceBackupsTable)
      .where(eq(deviceBackupsTable.recoveryCode, candidate))
      .limit(1);
    if (clash.length === 0) { code = candidate; break; }
  }
  if (!code) return res.status(500).json({ error: "Could not generate unique code" });

  await db.insert(deviceBackupsTable).values({
    recoveryCode: code,
    deviceId,
    vehiclesJson: "[]",
    settingsJson: "{}",
  });

  return res.status(201).json({ recoveryCode: code });
});

// ── GET /backup/code ───────────────────────────────────────────────────────────
router.get("/backup/code", async (req: Request, res: Response) => {
  const deviceId = req.query.deviceId as string;
  if (!deviceId) return res.status(400).json({ error: "deviceId is required" });

  const rows = await db
    .select({ recoveryCode: deviceBackupsTable.recoveryCode })
    .from(deviceBackupsTable)
    .where(eq(deviceBackupsTable.deviceId, deviceId))
    .limit(1);

  if (rows.length === 0) return res.status(404).json({ error: "No backup found for this device" });
  return res.json({ recoveryCode: rows[0].recoveryCode });
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
    // Auto-init if no record exists
    return res.status(404).json({ error: "No backup record found. Call /backup/init first." });
  }

  return res.json({ ok: true });
});

// ── POST /backup/verify ────────────────────────────────────────────────────────
// Verifies the recovery code and plate, then migrates all data to newDeviceId.
router.post("/backup/verify", async (req: Request, res: Response) => {
  const { recoveryCode, plateNumber, newDeviceId } = req.body as {
    recoveryCode?: string;
    plateNumber?: string;
    newDeviceId?: string;
  };

  if (!recoveryCode || !plateNumber || !newDeviceId) {
    return res.status(400).json({ error: "recoveryCode, plateNumber, and newDeviceId are required" });
  }

  // Look up the backup by recovery code
  const rows = await db
    .select()
    .from(deviceBackupsTable)
    .where(eq(deviceBackupsTable.recoveryCode, recoveryCode.toUpperCase()))
    .limit(1);

  if (rows.length === 0) {
    return res.status(404).json({ error: "Recovery code not found" });
  }

  const backup = rows[0];

  // Verify the plate
  if (!plateMatches(backup.vehiclesJson, plateNumber)) {
    return res.status(403).json({ error: "Plate number does not match" });
  }

  const oldDeviceId = backup.deviceId;

  // Migrate server-side data from old device to new device
  if (oldDeviceId !== newDeviceId) {
    // Check whether newDeviceId already has its own backup; if so, skip migration
    // to avoid clobbering an existing account.
    const newDeviceBackup = await db
      .select({ id: deviceBackupsTable.id })
      .from(deviceBackupsTable)
      .where(eq(deviceBackupsTable.deviceId, newDeviceId))
      .limit(1);

    if (newDeviceBackup.length === 0) {
      // Migrate server-side tables that are scoped by deviceId.
      // Runs best-effort in sequence; failures are non-fatal so the
      // vehicle/settings restore can still proceed.
      await Promise.allSettled([
        db.update(pushTokensTable)
          .set({ deviceId: newDeviceId })
          .where(eq(pushTokensTable.deviceId, oldDeviceId)),
        db.update(savedPlacesTable)
          .set({ deviceId: newDeviceId })
          .where(eq(savedPlacesTable.deviceId, oldDeviceId)),
        db.update(plannedTripsTable)
          .set({ deviceId: newDeviceId })
          .where(eq(plannedTripsTable.deviceId, oldDeviceId)),
        // Raw SQL for tables that may or may not exist / have deviceId column —
        // best-effort, failures don't abort the restore.
        db.execute(sql`UPDATE emergency_contacts SET device_id=${newDeviceId} WHERE device_id=${oldDeviceId}`),
        db.execute(sql`UPDATE trips SET device_id=${newDeviceId} WHERE device_id=${oldDeviceId}`),
        db.execute(sql`UPDATE live_trips SET device_id=${newDeviceId} WHERE device_id=${oldDeviceId}`),
        db.execute(sql`UPDATE dashcam_clips SET device_id=${newDeviceId} WHERE device_id=${oldDeviceId}`),
        db.execute(sql`UPDATE braking_events SET device_id=${newDeviceId} WHERE device_id=${oldDeviceId}`),
        db.execute(sql`UPDATE crash_events SET device_id=${newDeviceId} WHERE device_id=${oldDeviceId}`),
        db.execute(sql`UPDATE accidents SET device_id=${newDeviceId} WHERE device_id=${oldDeviceId}`),
      ]);

      // Update the backup record to point to the new device
      await db.update(deviceBackupsTable)
        .set({ deviceId: newDeviceId })
        .where(eq(deviceBackupsTable.id, backup.id));
    }
  }

  // Parse and return the backup payload
  let vehicles: unknown[] = [];
  let settings: Record<string, unknown> = {};
  try { vehicles = JSON.parse(backup.vehiclesJson); } catch { /* */ }
  try { settings = JSON.parse(backup.settingsJson); } catch { /* */ }

  return res.json({ vehicles, settings });
});

export default router;
