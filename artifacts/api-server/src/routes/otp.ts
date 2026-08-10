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

// ── POST /auth/send-otp ───────────────────────────────────────────────────────
// Body: { phone: string, intent: "link" | "restore" }
router.post("/auth/send-otp", async (req, res) => {
  const { phone: rawPhone, intent } = req.body as { phone?: string; intent?: string };

  if (!rawPhone || !intent || !["link", "restore"].includes(intent)) {
    return res.status(400).json({ error: "phone and intent (link|restore) are required" });
  }

  const phone = normalisePhone(rawPhone);
  if (!phone) {
    return res.status(400).json({ error: "Invalid phone number — use E.164 or Kenyan local format" });
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

  // Rate-limit: reject if an active (non-expired, <10 attempts) OTP already exists
  const existing = await db.execute(
    sql`SELECT id FROM phone_verifications
        WHERE phone = ${phone} AND expires_at > NOW() AND attempts < 10
        LIMIT 1`
  );
  if ((existing.rows as any[]).length > 0) {
    return res.status(429).json({ error: "An OTP was already sent recently. Wait a few minutes." });
  }

  const otp    = generateOtp();
  const hashed = hashOtp(otp);

  await db.execute(
    sql`INSERT INTO phone_verifications (phone, otp_hash, expires_at, attempts, verified)
        VALUES (${phone}, ${hashed}, NOW() + INTERVAL '10 minutes', 0, FALSE)`
  );

  // In dev: log the OTP plainly so it can be read from the API server console
  // (sandbox doesn't send real SMS)
  if (isDev) {
    logger.info({ phone, otp }, "[OTP-DEV] Generated OTP — check this log to verify");
  }

  const message = `Your Msafiri Kenya verification code is: ${otp}. It expires in 10 minutes. Do not share it.`;
  try {
    await sendOtpSms(phone, message);
  } catch (smsErr: any) {
    logger.error({ err: smsErr?.message }, "[OTP] SMS send failed");
    // Roll back the record so the user can retry immediately
    await db.execute(
      sql`DELETE FROM phone_verifications WHERE phone = ${phone} AND otp_hash = ${hashed}`
    ).catch(() => {});
    const detail = isDev ? ` (${smsErr?.message ?? "unknown"})` : "";
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
    sql`SELECT id, otp_hash, attempts FROM phone_verifications
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
    await db.execute(
      sql`UPDATE device_backups SET phone_number = ${phone} WHERE device_id = ${deviceId}`
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
