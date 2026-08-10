/**
 * OTP routes — phone-based account recovery
 *
 * POST /auth/send-otp    — send a 6-digit OTP via SMS
 * POST /auth/verify-otp  — verify OTP; intent = "link" | "restore"
 *
 * Tables used (created by migrateSchema):
 *   phone_verifications  — hashed OTPs with TTL + attempt counter
 *   device_backups       — phone_number column (added by migrateSchema)
 */
import { Router } from "express";
import { createHash, randomInt } from "crypto";
import { db, deviceBackupsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { sendOtpSms } from "../lib/smsSender.js";
import pino from "pino";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const isDev  = process.env.NODE_ENV !== "production";
const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}

function generateOtp(): string {
  return String(randomInt(100000, 999999));
}

/**
 * Normalise any Kenyan phone format → E.164 (+254XXXXXXXXX).
 *
 * Accepted inputs (spaces/dashes/dots stripped first):
 *   +254712345678   already E.164
 *   254712345678    no leading +
 *   0712345678      leading 0 (Safaricom / Airtel 07xx or 01xx)
 *   712345678       9-digit local (assume 7xx)
 *   0112345678      Airtel 01xx local
 *   112345678       9-digit Airtel (assume 1xx → 01xx)
 */
function normalisePhone(raw: string): string | null {
  // Strip whitespace, dashes, dots, parentheses
  const s = raw.trim().replace(/[\s\-.()+]/g, "").replace(/^00/, "");

  // Already valid E.164 (after stripping the +)
  if (/^254\d{9}$/.test(s)) return "+" + s;

  // 07XXXXXXXX or 01XXXXXXXX (10 digits, leading 0)
  if (/^0[71]\d{8}$/.test(s)) return "+254" + s.slice(1);

  // 7XXXXXXXX or 1XXXXXXXX (9 digits, no leading 0)
  if (/^[71]\d{8}$/.test(s)) return "+254" + s;

  return null;
}

// ── EAT send window (8 AM – 6 PM) ────────────────────────────────────────────
// SMSLeopard only allows sending during daytime hours. We enforce this server-
// side so the error is clear rather than a cryptic "restricted_send_time".
function isWithinSendWindow(): boolean {
  const utcHour = new Date().getUTCHours();
  const eatHour = (utcHour + 3) % 24;
  return eatHour >= 8 && eatHour < 18;
}

// ── POST /auth/send-otp ───────────────────────────────────────────────────────
// Body: { phone, intent, deviceId? }
// For link intent, deviceId is required — the OTP is bound to that device so
// only the same device can verify it. This prevents a code intercepted via
// iOS proximity sharing / iCloud from being usable on a different device.
router.post("/auth/send-otp", async (req, res) => {
  const { phone: rawPhone, intent, deviceId } =
    req.body as { phone?: string; intent?: string; deviceId?: string };

  if (!rawPhone || !intent || !["link", "restore"].includes(intent)) {
    return res.status(400).json({ error: "phone and intent (link|restore) are required" });
  }

  // For link intent a deviceId is required so we can bind the OTP to the requester.
  if (intent === "link" && !deviceId) {
    return res.status(400).json({ error: "deviceId is required for link intent" });
  }

  const phone = normalisePhone(rawPhone);
  if (!phone) {
    return res.status(400).json({ error: "Invalid phone number — use E.164 or Kenyan local format" });
  }

  // Enforce EAT send window (8 AM – 6 PM) — SMSLeopard rejects outside this window.
  if (!isWithinSendWindow()) {
    return res.status(403).json({
      error: "SMS codes can only be sent between 8:00 AM and 6:00 PM EAT (East Africa Time). Please try again during those hours.",
      code: "OUTSIDE_SEND_WINDOW",
    });
  }

  // For restore intent: confirm a backup exists for this phone before sending
  if (intent === "restore") {
    const rows = await db.execute(
      sql`SELECT id FROM device_backups WHERE phone_number = ${phone} LIMIT 1`
    );
    if ((rows.rows as any[]).length === 0) {
      return res.status(404).json({ error: "No account found for this phone number" });
    }
  }

  // Rate-limit: reject if an active (non-expired, <5 attempts) OTP already exists
  const existing = await db.execute(
    sql`SELECT id FROM phone_verifications
        WHERE phone = ${phone} AND expires_at > NOW() AND attempts < 5
        LIMIT 1`
  );
  if ((existing.rows as any[]).length > 0) {
    return res.status(429).json({ error: "A code was already sent recently. Wait a few minutes before trying again." });
  }

  const otp    = generateOtp();
  const hashed = hashOtp(otp);

  // Store intent and requesting device so verify can enforce binding
  await db.execute(
    sql`INSERT INTO phone_verifications
          (phone, otp_hash, expires_at, attempts, verified, intent, requesting_device_id)
        VALUES
          (${phone}, ${hashed}, NOW() + INTERVAL '10 minutes', 0, FALSE,
           ${intent}, ${deviceId ?? null})`
  );

  if (isDev) {
    logger.info({ phone, otp, intent }, "[OTP-DEV] Generated OTP — check this log to verify");
  }

  // Intent-specific SMS text
  const smsMessage = intent === "restore"
    ? `Msafiri Kenya data recovery code: ${otp}. Expires in 10 min. ` +
      `Enter this in the app to restore your account. ` +
      `Do NOT share this code — Msafiri staff will never ask for it.`
    : `Msafiri Kenya security code: ${otp}. Expires in 10 min. ` +
      `Use this in the app to link your phone for account recovery. ` +
      `If you did not request this, ignore this message.`;

  try {
    await sendOtpSms(phone, smsMessage);
  } catch (sendErr: any) {
    logger.error({ err: sendErr?.message }, "[OTP] SMS send failed");
    // Roll back the record so the user can retry immediately
    await db.execute(
      sql`DELETE FROM phone_verifications WHERE phone = ${phone} AND otp_hash = ${hashed}`
    ).catch(() => {});
    const detail = isDev ? ` (${sendErr?.message ?? "unknown"})` : "";
    return res.status(502).json({ error: `Failed to send SMS. Try again.${detail}` });
  }

  return res.json({ ok: true, ...(isDev ? { devOtp: otp } : {}) });
});

// ── POST /auth/verify-otp ─────────────────────────────────────────────────────
// Body: { phone, otp, intent, deviceId? (for link), newDeviceId? (for restore) }
router.post("/auth/verify-otp", async (req, res) => {
  const {
    phone: rawPhone,
    otp,
    intent,
    deviceId,
    newDeviceId,
  } = req.body as {
    phone?:       string;
    otp?:         string;
    intent?:      string;
    deviceId?:    string;
    newDeviceId?: string;
  };

  if (!rawPhone || !otp || !intent) {
    return res.status(400).json({ error: "phone, otp, and intent are required" });
  }
  if (!["link", "restore"].includes(intent)) {
    return res.status(400).json({ error: "intent must be 'link' or 'restore'" });
  }

  const phone = normalisePhone(rawPhone);
  if (!phone) {
    return res.status(400).json({ error: "Invalid phone number" });
  }

  // Find the most-recent active record for this phone
  const recordsResult = await db.execute(
    sql`SELECT id, otp_hash, attempts, intent AS stored_intent, requesting_device_id
        FROM phone_verifications
        WHERE phone = ${phone} AND expires_at > NOW()
        ORDER BY expires_at DESC
        LIMIT 1`
  );
  const records = recordsResult.rows as any[];

  if (records.length === 0) {
    return res.status(401).json({ error: "OTP expired or not found. Request a new one." });
  }

  const record = records[0];

  // Locked after 5 wrong attempts
  if (record.attempts >= 5) {
    return res.status(429).json({ error: "Too many attempts. Request a new OTP." });
  }

  // Reject if the intent doesn't match what was stored — prevents a link OTP
  // from being replayed as a restore (or vice versa).
  if (record.stored_intent && record.stored_intent !== intent) {
    return res.status(403).json({ error: "This code cannot be used for this action." });
  }

  const hashed = hashOtp(otp.trim());
  if (hashed !== record.otp_hash) {
    await db.execute(
      sql`UPDATE phone_verifications SET attempts = attempts + 1 WHERE id = ${record.id}`
    );
    return res.status(401).json({ error: "Invalid OTP" });
  }

  // ── Mark as verified ──────────────────────────────────────────────────────
  await db.execute(
    sql`UPDATE phone_verifications SET verified = TRUE WHERE id = ${record.id}`
  );

  // ── Intent: link ──────────────────────────────────────────────────────────
  if (intent === "link") {
    if (!deviceId) {
      return res.status(400).json({ error: "deviceId is required for link intent" });
    }

    // Device binding: if the OTP was created with a requesting_device_id, the
    // verifying device must match. This blocks a code intercepted on another
    // Apple device (via iCloud proximity / Handoff) from being used to claim
    // a phone number on a different device.
    if (record.requesting_device_id && record.requesting_device_id !== deviceId) {
      logger.warn({ phone, requestingDevice: record.requesting_device_id, verifyingDevice: deviceId },
        "[OTP] Link rejected — verifying device does not match requesting device");
      return res.status(403).json({
        error: "This code was sent to a different device. Request a new code on this device.",
      });
    }

    // Upsert: if the device has never synced a backup yet there is no row to
    // UPDATE — use INSERT … ON CONFLICT so the phone number is always persisted.
    await db.execute(
      sql`INSERT INTO device_backups (device_id, phone_number, recovery_code, vehicles_json, settings_json)
          VALUES (${deviceId}, ${phone}, '', '[]', '{}')
          ON CONFLICT (device_id) DO UPDATE SET phone_number = EXCLUDED.phone_number`
    );
    return res.json({ ok: true, phone });
  }

  // ── Intent: restore ───────────────────────────────────────────────────────
  if (!newDeviceId) {
    return res.status(400).json({ error: "newDeviceId is required for restore intent" });
  }

  const backupsResult = await db.execute(
    sql`SELECT vehicles_json, settings_json FROM device_backups
        WHERE phone_number = ${phone}
        ORDER BY last_backup_at DESC
        LIMIT 1`
  );
  const backups = backupsResult.rows as any[];

  if (backups.length === 0) {
    return res.status(404).json({ error: "No backup found for this phone number" });
  }

  const backup = backups[0];

  // Migrate device ID to the new device
  await db.execute(
    sql`UPDATE device_backups SET device_id = ${newDeviceId} WHERE phone_number = ${phone}`
  );

  let vehicles: unknown[] = [];
  let settings: Record<string, unknown> = {};
  try { vehicles = JSON.parse(backup.vehicles_json) ?? []; } catch { /* */ }
  try { settings = JSON.parse(backup.settings_json)  ?? {}; } catch { /* */ }

  return res.json({ vehicles, settings });
});

export default router;
