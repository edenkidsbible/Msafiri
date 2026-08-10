/**
 * OTP routes — phone-based account access and recovery.
 *
 * POST /auth/send-otp    — generate & send a 6-digit OTP via Africa's Talking
 * POST /auth/verify-otp  — verify OTP; link phone to device or restore data
 */
import { Router, type Request, type Response } from "express";
import { createHash } from "crypto";
import { eq, and, gt, desc } from "drizzle-orm";
import {
  db,
  phoneVerificationsTable,
  deviceBackupsTable,
  pushTokensTable,
  savedPlacesTable,
  plannedTripsTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { normalizeKenyaPhone } from "../lib/phoneUtils.js";
import { sendAtSms } from "../lib/atSms.js";

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}

function generateOtp(): string {
  // 6-digit numeric OTP, zero-padded
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ── POST /auth/send-otp ────────────────────────────────────────────────────────
// Body: { phone: string }
// Rate-limited: one active (unexpired, unverified) OTP per number at a time.
router.post("/auth/send-otp", async (req: Request, res: Response) => {
  const { phone: rawPhone } = req.body as { phone?: string };
  if (!rawPhone) return res.status(400).json({ error: "phone is required" });

  const phone = normalizeKenyaPhone(rawPhone);
  if (!phone) {
    return res.status(400).json({ error: "Invalid Kenyan phone number. Use format: 0712 345 678" });
  }

  // Rate limit — refuse if an unexpired, unverified OTP already exists.
  // This also prevents OTP flooding.
  const active = await db
    .select({ id: phoneVerificationsTable.id, createdAt: phoneVerificationsTable.createdAt })
    .from(phoneVerificationsTable)
    .where(
      and(
        eq(phoneVerificationsTable.phone, phone),
        gt(phoneVerificationsTable.expiresAt, new Date()),
        eq(phoneVerificationsTable.verified, false),
      ),
    )
    .orderBy(desc(phoneVerificationsTable.createdAt))
    .limit(1);

  if (active.length > 0) {
    return res.status(429).json({
      error: "A code was recently sent to this number. Please wait a moment before requesting another.",
    });
  }

  const otp       = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await db.insert(phoneVerificationsTable).values({
    phone,
    otpHash:   hashOtp(otp),
    expiresAt,
    attempts:  0,
    verified:  false,
  });

  const sent = await sendAtSms(
    phone,
    `Your Msafiri Kenya code is ${otp}. Valid for 10 minutes. Do not share this code.`,
  );

  if (!sent) {
    return res.status(503).json({ error: "SMS could not be sent. Please try again." });
  }

  return res.json({ ok: true, expiresInSeconds: 600 });
});

// ── POST /auth/verify-otp ──────────────────────────────────────────────────────
// Body: { phone, otp, deviceId, intent: "link" | "restore" }
//
// intent = "link":    Attach the verified phone to this device's backup record.
//                     Returns { ok: true, phone }.
//
// intent = "restore": Find backup by phone, migrate all data to newDeviceId,
//                     return { ok: true, vehicles, settings, phone }.
router.post("/auth/verify-otp", async (req: Request, res: Response) => {
  const {
    phone: rawPhone,
    otp,
    deviceId,
    intent = "link",
  } = req.body as {
    phone?:  string;
    otp?:    string;
    deviceId?: string;
    intent?: "link" | "restore";
  };

  if (!rawPhone || !otp || !deviceId) {
    return res.status(400).json({ error: "phone, otp, and deviceId are required" });
  }

  const phone = normalizeKenyaPhone(rawPhone);
  if (!phone) return res.status(400).json({ error: "Invalid Kenyan phone number" });

  // Find the most recent active OTP for this phone
  const rows = await db
    .select()
    .from(phoneVerificationsTable)
    .where(
      and(
        eq(phoneVerificationsTable.phone, phone),
        gt(phoneVerificationsTable.expiresAt, new Date()),
        eq(phoneVerificationsTable.verified, false),
      ),
    )
    .orderBy(desc(phoneVerificationsTable.createdAt))
    .limit(1);

  if (rows.length === 0) {
    return res.status(404).json({
      error: "No valid code found for this number. Please request a new one.",
    });
  }

  const record = rows[0];

  if (record.attempts >= 5) {
    return res.status(429).json({
      error: "Too many incorrect attempts. Please request a new code.",
    });
  }

  if (record.otpHash !== hashOtp(otp)) {
    const newAttempts = record.attempts + 1;
    await db.update(phoneVerificationsTable)
      .set({ attempts: newAttempts })
      .where(eq(phoneVerificationsTable.id, record.id));
    const remaining = Math.max(0, 5 - newAttempts);
    return res.status(401).json({
      error: `Incorrect code. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`,
    });
  }

  // ── OTP correct — mark verified ────────────────────────────────────────────
  await db.update(phoneVerificationsTable)
    .set({ verified: true })
    .where(eq(phoneVerificationsTable.id, record.id));

  // ── intent = "link" ────────────────────────────────────────────────────────
  if (intent === "link") {
    const existing = await db
      .select({ id: deviceBackupsTable.id })
      .from(deviceBackupsTable)
      .where(eq(deviceBackupsTable.deviceId, deviceId))
      .limit(1);

    if (existing.length > 0) {
      await db.update(deviceBackupsTable)
        .set({ phoneNumber: phone })
        .where(eq(deviceBackupsTable.deviceId, deviceId));
    } else {
      // Auto-create the backup record so there's something to link to
      const code = Array.from({ length: 5 }, () =>
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)],
      ).join("");
      await db.insert(deviceBackupsTable).values({
        recoveryCode: code,
        deviceId,
        vehiclesJson: "[]",
        settingsJson: "{}",
        phoneNumber:  phone,
      });
    }

    return res.json({ ok: true, phone });
  }

  // ── intent = "restore" ─────────────────────────────────────────────────────
  const backupRows = await db
    .select()
    .from(deviceBackupsTable)
    .where(eq(deviceBackupsTable.phoneNumber, phone))
    .limit(1);

  if (backupRows.length === 0) {
    return res.status(404).json({
      error: "No account found linked to this phone number. If this is a new phone, set it up fresh and link your number in Settings.",
    });
  }

  const backup      = backupRows[0];
  const oldDeviceId = backup.deviceId;

  // Migrate all device-scoped server data to the new device
  if (oldDeviceId !== deviceId) {
    const newDeviceHasBackup = await db
      .select({ id: deviceBackupsTable.id })
      .from(deviceBackupsTable)
      .where(eq(deviceBackupsTable.deviceId, deviceId))
      .limit(1);

    if (newDeviceHasBackup.length === 0) {
      await Promise.allSettled([
        db.update(pushTokensTable)
          .set({ deviceId }).where(eq(pushTokensTable.deviceId, oldDeviceId)),
        db.update(savedPlacesTable)
          .set({ deviceId }).where(eq(savedPlacesTable.deviceId, oldDeviceId)),
        db.update(plannedTripsTable)
          .set({ deviceId }).where(eq(plannedTripsTable.deviceId, oldDeviceId)),
        db.execute(sql`UPDATE emergency_contacts SET device_id=${deviceId} WHERE device_id=${oldDeviceId}`),
        db.execute(sql`UPDATE trips            SET device_id=${deviceId} WHERE device_id=${oldDeviceId}`),
        db.execute(sql`UPDATE live_trips       SET device_id=${deviceId} WHERE device_id=${oldDeviceId}`),
        db.execute(sql`UPDATE dashcam_clips    SET device_id=${deviceId} WHERE device_id=${oldDeviceId}`),
        db.execute(sql`UPDATE braking_events   SET device_id=${deviceId} WHERE device_id=${oldDeviceId}`),
        db.execute(sql`UPDATE accidents        SET device_id=${deviceId} WHERE device_id=${oldDeviceId}`),
      ]);

      await db.update(deviceBackupsTable)
        .set({ deviceId })
        .where(eq(deviceBackupsTable.id, backup.id));
    }
  }

  let vehicles: unknown[] = [];
  let settings: Record<string, unknown> = {};
  try { vehicles = JSON.parse(backup.vehiclesJson); } catch { /* */ }
  try { settings = JSON.parse(backup.settingsJson); } catch { /* */ }

  return res.json({ ok: true, vehicles, settings, phone });
});

export default router;
