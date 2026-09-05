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
import {
  parseSettingsSnapshot,
  parseVehiclesSnapshot,
  mergeRestorableBackups,
  selectRestorableBackup,
} from "../lib/recoveryPayload.js";
import pino from "pino";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const isDev  = process.env.NODE_ENV !== "production";
const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

class RecoveryError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

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

async function migrateRecoveredDeviceData(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  oldDeviceId: string,
  newDeviceId: string,
): Promise<void> {
  if (oldDeviceId === newDeviceId) return;

  // Durable account data. Device credentials, push tokens, rate-limit state,
  // presence, and transient upload/enrollment rows intentionally remain tied
  // to the physical device that created them.
  await tx.execute(sql`UPDATE saved_places SET device_id = ${newDeviceId} WHERE device_id = ${oldDeviceId}`);
  await tx.execute(sql`UPDATE planned_trips SET device_id = ${newDeviceId} WHERE device_id = ${oldDeviceId}`);
  await tx.execute(sql`UPDATE live_trips SET device_id = ${newDeviceId} WHERE device_id = ${oldDeviceId}`);
  await tx.execute(sql`UPDATE emergency_contacts SET device_id = ${newDeviceId} WHERE device_id = ${oldDeviceId}`);
  await tx.execute(sql`UPDATE accident_records SET device_id = ${newDeviceId} WHERE device_id = ${oldDeviceId}`);
  await tx.execute(sql`UPDATE accident_shares SET device_id = ${newDeviceId} WHERE device_id = ${oldDeviceId}`);
  await tx.execute(sql`UPDATE braking_events SET device_id = ${newDeviceId} WHERE device_id = ${oldDeviceId}`);
  await tx.execute(sql`UPDATE crash_trigger_events SET device_id = ${newDeviceId} WHERE device_id = ${oldDeviceId}`);
  await tx.execute(sql`UPDATE community_reports SET device_id = ${newDeviceId} WHERE device_id = ${oldDeviceId}`);
  await tx.execute(sql`UPDATE shared_vehicles SET owner_device_id = ${newDeviceId} WHERE owner_device_id = ${oldDeviceId}`);
  await tx.execute(sql`UPDATE vehicle_join_requests SET requester_device_id = ${newDeviceId} WHERE requester_device_id = ${oldDeviceId}`);
  await tx.execute(sql`UPDATE road_channel_user_reports SET reporter_device_id = ${newDeviceId} WHERE reporter_device_id = ${oldDeviceId}`);
  await tx.execute(sql`UPDATE road_channel_voice_reports SET device_id = ${newDeviceId} WHERE device_id = ${oldDeviceId}`);

  // These tables have per-device uniqueness. Move non-conflicting rows, then
  // discard old duplicates only when the destination already has the same item.
  await tx.execute(sql`
    UPDATE user_course_progress old_row
    SET device_id = ${newDeviceId}
    WHERE old_row.device_id = ${oldDeviceId}
      AND NOT EXISTS (
        SELECT 1 FROM user_course_progress new_row
        WHERE new_row.device_id = ${newDeviceId}
          AND new_row.lesson_id = old_row.lesson_id
      )
  `);
  await tx.execute(sql`DELETE FROM user_course_progress WHERE device_id = ${oldDeviceId}`);
  await tx.execute(sql`
    UPDATE user_course_bookmarks old_row
    SET device_id = ${newDeviceId}
    WHERE old_row.device_id = ${oldDeviceId}
      AND NOT EXISTS (
        SELECT 1 FROM user_course_bookmarks new_row
        WHERE new_row.device_id = ${newDeviceId}
          AND new_row.lesson_id = old_row.lesson_id
      )
  `);
  await tx.execute(sql`DELETE FROM user_course_bookmarks WHERE device_id = ${oldDeviceId}`);
  await tx.execute(sql`
    UPDATE vehicle_members old_row
    SET member_device_id = ${newDeviceId}
    WHERE old_row.member_device_id = ${oldDeviceId}
      AND NOT EXISTS (
        SELECT 1 FROM vehicle_members new_row
        WHERE new_row.member_device_id = ${newDeviceId}
          AND new_row.vehicle_id = old_row.vehicle_id
      )
  `);
  await tx.execute(sql`DELETE FROM vehicle_members WHERE member_device_id = ${oldDeviceId}`);
}

async function consumeOtp(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  recordId: string,
): Promise<void> {
  const consumed = await tx.execute(
    sql`UPDATE phone_verifications
        SET verified = TRUE
        WHERE id = ${recordId} AND verified = FALSE AND attempts < 3
        RETURNING id`
  );
  if ((consumed.rows as any[]).length === 0) {
    const state = await tx.execute(
      sql`SELECT verified, attempts FROM phone_verifications WHERE id = ${recordId}`
    );
    const row = (state.rows as any[])[0];
    if (row?.attempts >= 3) {
      throw new RecoveryError(429, "Too many attempts. Request a new code after 24 hours.");
    }
    throw new RecoveryError(409, "This recovery code has already been used. Request a new code.");
  }
}

async function destinationHasDurableData(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  deviceId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM saved_places WHERE device_id = ${deviceId}
      UNION ALL SELECT 1 FROM planned_trips WHERE device_id = ${deviceId}
      UNION ALL SELECT 1 FROM live_trips WHERE device_id = ${deviceId}
      UNION ALL SELECT 1 FROM emergency_contacts WHERE device_id = ${deviceId}
      UNION ALL SELECT 1 FROM accident_records WHERE device_id = ${deviceId}
      UNION ALL SELECT 1 FROM accident_shares WHERE device_id = ${deviceId}
      UNION ALL SELECT 1 FROM braking_events WHERE device_id = ${deviceId}
      UNION ALL SELECT 1 FROM crash_trigger_events WHERE device_id = ${deviceId}
      UNION ALL SELECT 1 FROM community_reports WHERE device_id = ${deviceId}
      UNION ALL SELECT 1 FROM user_course_progress WHERE device_id = ${deviceId}
      UNION ALL SELECT 1 FROM user_course_bookmarks WHERE device_id = ${deviceId}
      UNION ALL SELECT 1 FROM shared_vehicles WHERE owner_device_id = ${deviceId}
      UNION ALL SELECT 1 FROM vehicle_members WHERE member_device_id = ${deviceId}
      UNION ALL SELECT 1 FROM vehicle_join_requests WHERE requester_device_id = ${deviceId}
      UNION ALL SELECT 1 FROM road_channel_user_reports WHERE reporter_device_id = ${deviceId}
      UNION ALL SELECT 1 FROM road_channel_voice_reports WHERE device_id = ${deviceId}
    ) AS has_data
  `);
  return (result.rows as any[])[0]?.has_data === true;
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
        WHERE email = ${email} AND expires_at > NOW() AND verified = FALSE
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
    vehicles: requestVehicles,
    settings: requestSettings,
  } = req.body as {
    email?:       string;
    otp?:         string;
    intent?:      string;
    deviceId?:    string;
    newDeviceId?: string;
    vehicles?: unknown[];
    settings?: Record<string, unknown>;
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
        WHERE email = ${email} AND expires_at > NOW() AND verified = FALSE
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
    // Increment atomically so concurrent wrong guesses cannot all overwrite
    // attempts=0 with attempts=1 and bypass the three-attempt lockout.
    const incremented = await db.execute(
      sql`UPDATE phone_verifications
          SET attempts = attempts + 1,
              expires_at = CASE
                WHEN attempts + 1 >= 3 THEN NOW() + INTERVAL '24 hours'
                ELSE expires_at
              END
          WHERE id = ${record.id} AND verified = FALSE AND attempts < 3
          RETURNING attempts`
    );
    const attemptsAfter = Number((incremented.rows as any[])[0]?.attempts ?? 3);
    if ((incremented.rows as any[]).length === 0) {
      return res.status(429).json({
        error: "Too many attempts. You can request a new code after 24 hours.",
      });
    }
    logger.info({ email, intent, attemptsAfter }, "[OTP] Verify — wrong code");
    const remaining = Math.max(0, 3 - attemptsAfter);
    const msg = remaining > 0
      ? `Wrong code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
      : "Wrong code. You have no more attempts. Request a new code after 24 hours.";
    return res.status(401).json({ error: msg });
  }

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

    const vehicles = parseVehiclesSnapshot(requestVehicles);
    if (!vehicles || vehicles.length === 0) {
      return res.status(422).json({
        error: "Add a vehicle before linking a recovery email so there is data to back up.",
      });
    }
    const settings = parseSettingsSnapshot(requestSettings);
    const vehiclesJson = JSON.stringify(vehicles);
    const settingsJson = JSON.stringify(settings);

    try {
      await db.transaction(async (tx) => {
        // A row lock cannot protect the "no existing owner" case. Serialize all
        // link/restore mutations for the same normalized email instead.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${email}, 0))`);
        await consumeOtp(tx, record.id);
        const emailOwners = await tx.execute(
          sql`SELECT id FROM device_backups
              WHERE recovery_email = ${email} AND device_id <> ${deviceId}
              FOR UPDATE`
        );
        if ((emailOwners.rows as any[]).length > 0) {
          throw new RecoveryError(
            409,
            "This recovery email is already linked to another account. Use Restore via Email instead.",
          );
        }
        await tx.execute(
          sql`INSERT INTO device_backups
                (device_id, recovery_email, vehicles_json, settings_json, last_backup_at)
              VALUES (${deviceId}, ${email}, ${vehiclesJson}, ${settingsJson}, NOW())
              ON CONFLICT (device_id) DO UPDATE
                SET recovery_email = EXCLUDED.recovery_email,
                    vehicles_json = EXCLUDED.vehicles_json,
                    settings_json = EXCLUDED.settings_json,
                    last_backup_at = NOW()`
        );
      });
    } catch (err) {
      if (err instanceof RecoveryError) {
        return res.status(err.status).json({ error: err.message });
      }
      throw err;
    }
    return res.json({ ok: true, email });
  }

  // ── Intent: restore ───────────────────────────────────────────────────────
  if (!newDeviceId) {
    return res.status(400).json({ error: "newDeviceId is required for restore intent" });
  }

  try {
    const restored = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${email}, 0))`);
      await consumeOtp(tx, record.id);

      const backupsResult = await tx.execute(
        sql`SELECT id, device_id, recovery_email, vehicles_json, settings_json
            FROM device_backups
            WHERE recovery_email = ${email}
            ORDER BY last_backup_at DESC, created_at DESC
            FOR UPDATE`
      );
      const backups = backupsResult.rows as any[];
      if (backups.length === 0) {
        throw new RecoveryError(404, "No backup found for this email address");
      }

      // Prefer the newest complete snapshot, but retain a parseable empty one
      // as a partial fallback so server-side history can still be recovered.
      const selection = selectRestorableBackup(backups);
      const merged = mergeRestorableBackups(backups);
      if (!selection || !merged) {
        throw new RecoveryError(
          422,
          "The backup exists but its vehicle data is damaged. Contact support before retrying recovery.",
        );
      }
      const selected = selection.backup as any;
      const vehicles = merged.vehicles;
      const settings = parseSettingsSnapshot(selected.settings_json);
      const sourceIds = [...new Set(backups.map((backup) => String(backup.device_id)))];

      const destinationResult = await tx.execute(
        sql`SELECT id, recovery_email, vehicles_json
            FROM device_backups WHERE device_id = ${newDeviceId} FOR UPDATE`
      );
      const destination = (destinationResult.rows as any[])[0];
      const destinationBelongsToAccount = backups.some(
        (backup) => backup.id === destination?.id,
      );
      const destinationIsMalformed = merged.malformedBackups.some(
        (backup: any) => backup.id === destination?.id,
      );

      if (destinationIsMalformed) {
        throw new RecoveryError(
          422,
          "One of this account's backup records is damaged and requires manual recovery. No data was changed.",
        );
      }

      if (destination && !destinationBelongsToAccount) {
        const destinationVehicles = parseVehiclesSnapshot(destination.vehicles_json);
        const destinationIsFresh =
          !destination.recovery_email &&
          Array.isArray(destinationVehicles) &&
          destinationVehicles.length === 0 &&
          !(await destinationHasDurableData(tx, newDeviceId));
        if (!destinationIsFresh) {
          throw new RecoveryError(
            409,
            "This device already contains another account. Clear its local data before restoring a different account.",
          );
        }
      }

      for (const sourceId of sourceIds) {
        await migrateRecoveredDeviceData(tx, sourceId, newDeviceId);
      }

      const keeperId = destination?.id ?? selected.id;
      if (destination) {
        await tx.execute(
          sql`UPDATE device_backups
              SET recovery_email = ${email},
                  vehicles_json = ${JSON.stringify(vehicles)},
                  settings_json = ${JSON.stringify(settings)},
                  last_backup_at = NOW()
              WHERE id = ${keeperId}`
        );
      } else {
        await tx.execute(
          sql`UPDATE device_backups
              SET device_id = ${newDeviceId},
                  vehicles_json = ${JSON.stringify(vehicles)},
                  settings_json = ${JSON.stringify(settings)},
                  last_backup_at = NOW()
              WHERE id = ${keeperId}`
        );
      }

      // Consolidate only snapshots that were parsed and merged successfully.
      // Malformed rows remain untouched for possible manual recovery.
      for (const backup of merged.validBackups as any[]) {
        if (backup.id !== keeperId) {
          await tx.execute(sql`DELETE FROM device_backups WHERE id = ${backup.id}`);
        }
      }

      return {
        vehicles,
        settings,
        partial: vehicles.length === 0,
      };
    });

    return res.json(restored);
  } catch (err) {
    if (err instanceof RecoveryError) {
      return res.status(err.status).json({ error: err.message });
    }
    throw err;
  }
});

export default router;
