/**
 * OTP routes — email-based account recovery
 *
 * POST /auth/send-otp    — send a 6-digit OTP via email
 * POST /auth/verify-otp  — verify OTP; intent = "link" | "restore"
 *
 * Tables used (created/altered by migrateSchema):
 *   phone_verifications  — hashed OTPs with TTL + attempt counter (email column)
 *   device_backups       — recovery_email column (added by migrateSchema)
 *
 * SMS is NOT used here. SMS remains exclusively for emergency/SOS contacts.
 */
import { Router } from "express";
import { createHash, randomInt } from "crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendRecoveryOtpEmail } from "../lib/email.js";
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

function normaliseEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  // Basic RFC-5322 sanity check — not exhaustive, but catches obvious typos
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

// ── POST /auth/send-otp ───────────────────────────────────────────────────────
// Body: { email, intent, deviceId? }
// For link intent, deviceId is required — the OTP is bound to that device.
router.post("/auth/send-otp", async (req, res) => {
  const { email: rawEmail, intent, deviceId } =
    req.body as { email?: string; intent?: string; deviceId?: string };

  if (!rawEmail || !intent || !["link", "restore"].includes(intent)) {
    return res.status(400).json({ error: "email and intent (link|restore) are required" });
  }

  // For link intent a deviceId is required so we can bind the OTP to the requester.
  if (intent === "link" && !deviceId) {
    return res.status(400).json({ error: "deviceId is required for link intent" });
  }

  const email = normaliseEmail(rawEmail);
  if (!email) {
    return res.status(400).json({ error: "Invalid email address" });
  }

  // For restore intent: confirm a backup exists for this email before sending
  if (intent === "restore") {
    const rows = await db.execute(
      sql`SELECT id FROM device_backups WHERE recovery_email = ${email} LIMIT 1`
    );
    if ((rows.rows as any[]).length === 0) {
      return res.status(404).json({ error: "No account found for this email address" });
    }
  }

  // Rate-limit: reject if an active (non-expired) OTP already exists.
  // This also covers locked OTPs (≥3 wrong attempts) because on the 3rd failure
  // we extend expires_at to 24 hours, so the check below naturally enforces the
  // 24-hour cooldown without a separate column.
  const existing = await db.execute(
    sql`SELECT id FROM phone_verifications
        WHERE email = ${email} AND expires_at > NOW()
        LIMIT 1`
  );
  if ((existing.rows as any[]).length > 0) {
    return res.status(429).json({ error: "A code was already sent. Wait before requesting a new one." });
  }

  const otp    = generateOtp();
  const hashed = hashOtp(otp);

  // Store intent and requesting device so verify can enforce binding
  await db.execute(
    sql`INSERT INTO phone_verifications
          (email, otp_hash, expires_at, attempts, verified, intent, requesting_device_id)
        VALUES
          (${email}, ${hashed}, NOW() + INTERVAL '15 minutes', 0, FALSE,
           ${intent}, ${deviceId ?? null})`
  );

  if (isDev) {
    logger.info({ email, otp, intent }, "[OTP-DEV] Generated OTP — check this log to verify");
  }

  const sent = await sendRecoveryOtpEmail({ toEmail: email, otp, intent: intent as "link" | "restore" });
  if (!sent) {
    // Do NOT delete the row — the OTP is valid; only the delivery failed.
    // Keeping the row means the user can retry the send without needing a new code.
    logger.error({ email }, "[OTP] Email send failed — row kept so user can retry");
    const detail = isDev ? " (check RESEND_API_KEY and server logs)" : "";
    return res.status(502).json({ error: `Failed to send the email. Please try again.${detail}` });
  }

  return res.json({ ok: true, ...(isDev ? { devOtp: otp } : {}) });
});

// ── POST /auth/verify-otp ─────────────────────────────────────────────────────
// Body: { email, otp, intent, deviceId? (for link), newDeviceId? (for restore) }
router.post("/auth/verify-otp", async (req, res) => {
  const {
    email: rawEmail,
    otp,
    intent,
    deviceId,
    newDeviceId,
  } = req.body as {
    email?:       string;
    otp?:         string;
    intent?:      string;
    deviceId?:    string;
    newDeviceId?: string;
  };

  if (!rawEmail || !otp || !intent) {
    return res.status(400).json({ error: "email, otp, and intent are required" });
  }
  if (!["link", "restore"].includes(intent)) {
    return res.status(400).json({ error: "intent must be 'link' or 'restore'" });
  }

  const email = normaliseEmail(rawEmail);
  if (!email) {
    return res.status(400).json({ error: "Invalid email address" });
  }

  // Find the most-recent active record for this email
  const recordsResult = await db.execute(
    sql`SELECT id, otp_hash, attempts, intent AS stored_intent, requesting_device_id
        FROM phone_verifications
        WHERE email = ${email} AND expires_at > NOW()
        ORDER BY expires_at DESC
        LIMIT 1`
  );
  const records = recordsResult.rows as any[];

  if (records.length === 0) {
    logger.info({ email, intent }, "[OTP] Verify — no active record found for email");
    return res.status(401).json({ error: "Code expired. Go back and request a new one." });
  }

  const record = records[0];

  // Locked after 3 wrong attempts — the 24-hour cooldown is enforced by the
  // extended expires_at set on the 3rd failure (see below).
  if (record.attempts >= 3) {
    return res.status(429).json({ error: "Too many attempts. You can request a new code after 24 hours." });
  }

  // Reject if the intent doesn't match what was stored — prevents a link OTP
  // from being replayed as a restore (or vice versa).
  if (record.stored_intent && record.stored_intent !== intent) {
    return res.status(403).json({ error: "This code cannot be used for this action." });
  }

  const hashed = hashOtp(otp.trim());
  if (hashed !== record.otp_hash) {
    const attemptsAfter = record.attempts + 1;
    // On the 3rd failure extend expires_at to 24 hours so the send-otp check
    // blocks any new OTP request for the full cooldown window.
    if (attemptsAfter >= 3) {
      await db.execute(
        sql`UPDATE phone_verifications
            SET attempts = ${attemptsAfter}, expires_at = NOW() + INTERVAL '24 hours'
            WHERE id = ${record.id}`
      );
    } else {
      await db.execute(
        sql`UPDATE phone_verifications SET attempts = ${attemptsAfter} WHERE id = ${record.id}`
      );
    }
    logger.info({ email, intent, attemptsAfter }, "[OTP] Verify — wrong code");
    const remaining = Math.max(0, 3 - attemptsAfter);
    const msg = remaining > 0
      ? `Wrong code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
      : "Wrong code. You have no more attempts. Request a new code after 24 hours.";
    return res.status(401).json({ error: msg });
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
    // verifying device must match.
    if (record.requesting_device_id && record.requesting_device_id !== deviceId) {
      logger.warn({ email, requestingDevice: record.requesting_device_id, verifyingDevice: deviceId },
        "[OTP] Link rejected — verifying device does not match requesting device");
      return res.status(403).json({
        error: "This code was sent to a different device. Request a new code on this device.",
      });
    }

    // Upsert: persist recovery_email onto this device's backup record
    await db.execute(
      sql`INSERT INTO device_backups (device_id, recovery_email, vehicles_json, settings_json)
          VALUES (${deviceId}, ${email}, '[]', '{}')
          ON CONFLICT (device_id) DO UPDATE SET recovery_email = EXCLUDED.recovery_email`
    );
    return res.json({ ok: true, email });
  }

  // ── Intent: restore ───────────────────────────────────────────────────────
  if (!newDeviceId) {
    return res.status(400).json({ error: "newDeviceId is required for restore intent" });
  }

  const backupsResult = await db.execute(
    sql`SELECT vehicles_json, settings_json FROM device_backups
        WHERE recovery_email = ${email}
        ORDER BY last_backup_at DESC
        LIMIT 1`
  );
  const backups = backupsResult.rows as any[];

  if (backups.length === 0) {
    return res.status(404).json({ error: "No backup found for this email address" });
  }

  const backup = backups[0];

  // Migrate device ID to the new device; keep recovery_email
  await db.execute(
    sql`UPDATE device_backups SET device_id = ${newDeviceId} WHERE recovery_email = ${email}`
  );

  let vehicles: unknown[] = [];
  let settings: Record<string, unknown> = {};
  try { vehicles = JSON.parse(backup.vehicles_json) ?? []; } catch { /* */ }
  try { settings = JSON.parse(backup.settings_json)  ?? {}; } catch { /* */ }

  return res.json({ vehicles, settings });
});

export default router;
