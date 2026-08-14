/**
 * migrateSchema.ts — lightweight startup schema guard.
 *
 * Applies additive DDL migrations that have not yet been captured in a
 * drizzle-kit migration file.  Every statement is written as a no-op when
 * the column / constraint already exists, so re-running on an up-to-date
 * database is safe.
 *
 * Add new columns here when drizzle-kit push cannot be run interactively
 * (e.g., the existing table has data that triggers a safety prompt).
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export async function migrateSchema(): Promise<void> {
  try {
    // sharing_sessions.live_activity_push_token — added for Task #47.
    // Stores the APNs push token of the driver's iOS Live Activity so the
    // server can push ContentState updates directly when the app is suspended.
    await db.execute(sql`
      ALTER TABLE sharing_sessions
      ADD COLUMN IF NOT EXISTS live_activity_push_token TEXT
    `);

    // community_reports.denied_by — tracks which device IDs have already cast
    // a deny vote so a single device cannot trigger the deny threshold twice.
    await db.execute(sql`
      ALTER TABLE community_reports
      ADD COLUMN IF NOT EXISTS denied_by jsonb NOT NULL DEFAULT '[]'::jsonb
    `);

    // pois — points of interest managed from the admin panel.
    // CREATE TABLE IF NOT EXISTS is fully idempotent across re-runs.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pois (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name       TEXT NOT NULL,
        brand      TEXT NOT NULL,
        type       TEXT NOT NULL,
        lat        DOUBLE PRECISION NOT NULL,
        lng        DOUBLE PRECISION NOT NULL,
        address    TEXT NOT NULL,
        hours      TEXT,
        status     TEXT NOT NULL DEFAULT 'active',
        static_id  TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // app_releases.scheduled_at — added for Task #55 (scheduled publish).
    // Stores the future datetime at which a "scheduled" release should
    // automatically go live.  NULL means publish immediately on confirm.
    await db.execute(sql`
      ALTER TABLE app_releases
      ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP
    `);

    // speed_zones.bearing — optional camera bearing (0–359°).
    // Stored as metadata for potential future directional filtering; the current
    // alert logic treats all cameras as omnidirectional and does not filter on it.
    await db.execute(sql`
      ALTER TABLE speed_zones
      ADD COLUMN IF NOT EXISTS bearing INTEGER
    `);

    // dashcam_enrollment_requests — push-OTP proofs of push-token possession.
    // The OTP is sent only in a push-notification data payload, never in the
    // HTTP response, so only the physical device that receives pushes can enroll.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS dashcam_enrollment_requests (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id    TEXT NOT NULL,
        otp_hash     TEXT NOT NULL,
        expires_at   TIMESTAMP NOT NULL,
        fulfilled_at TIMESTAMP,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS dashcam_enrollment_requests_device_id_idx
        ON dashcam_enrollment_requests (device_id)
    `);

    // dashcam_upload_intents — atomic upload-URL reservation rows that count
    // against the per-device quota and bind clip metadata to an issued URL.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS dashcam_upload_intents (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id    TEXT NOT NULL,
        clip_id      TEXT NOT NULL UNIQUE,
        file_key     TEXT NOT NULL,
        expires_at   TIMESTAMP NOT NULL,
        fulfilled_at TIMESTAMP,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS dashcam_upload_intents_device_id_idx
        ON dashcam_upload_intents (device_id)
    `);

    // dashcam_reg_ratelimit — DB-backed rate limiter for device registration,
    // persists across server restarts. Keyed by SHA-256(ip).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS dashcam_reg_ratelimit (
        ip_hash      TEXT PRIMARY KEY,
        count        INTEGER NOT NULL DEFAULT 1,
        window_start TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // dashcam_devices — maps device_id to a pre-registered secret hash so that
    // the upload-url endpoint can verify the caller is a known device before
    // issuing a presigned R2 URL (prevents unauthenticated R2 storage abuse).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS dashcam_devices (
        device_id   TEXT PRIMARY KEY,
        secret_hash TEXT NOT NULL,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // dashcam_clips — stores metadata for locked dashcam clips uploaded to R2.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS dashcam_clips (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id     TEXT NOT NULL,
        file_key      TEXT NOT NULL,
        duration_s    INTEGER,
        size_bytes    INTEGER,
        locked        BOOLEAN NOT NULL DEFAULT TRUE,
        lock_reason   TEXT,
        started_at    TIMESTAMP NOT NULL,
        uploaded_at   TIMESTAMP,
        lat           DOUBLE PRECISION,
        lng           DOUBLE PRECISION,
        speed_kmh     INTEGER,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS dashcam_clips_device_id_idx ON dashcam_clips (device_id)
    `);

    // dashcam_clips.device_secret_hash — authenticates clip ownership.
    // Stores SHA-256(deviceId + ":" + dashcamSecret) so read/delete endpoints
    // can verify the requesting device is the one that uploaded the clip.
    await db.execute(sql`
      ALTER TABLE dashcam_clips
      ADD COLUMN IF NOT EXISTS device_secret_hash TEXT
    `);

    // dashcam_clips.pinned — driver-pinned clips are exempt from the standard
    // 30-day / 24-hour auto-deletion and expire after 60 days instead.
    await db.execute(sql`
      ALTER TABLE dashcam_clips
      ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE
    `);

    // dashcam_clips.expires_at — the timestamp when this cloud clip should be
    // auto-deleted. Set on upload based on lockReason; extended on pin.
    // NULL = never expires (legacy rows uploaded before this column existed).
    await db.execute(sql`
      ALTER TABLE dashcam_clips
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS dashcam_clips_expires_at_idx
        ON dashcam_clips (expires_at)
        WHERE expires_at IS NOT NULL AND pinned = FALSE
    `);

    // live_trips — drive-session records created by Live Trip mode.
    // Stores sensor-derived event counts and the final driving score so the
    // driver can review their history in the Trips → Drive History tab.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS live_trips (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id           TEXT NOT NULL,
        started_at          TIMESTAMP NOT NULL,
        ended_at            TIMESTAMP,
        start_lat           DOUBLE PRECISION,
        start_lng           DOUBLE PRECISION,
        end_lat             DOUBLE PRECISION,
        end_lng             DOUBLE PRECISION,
        distance_m          INTEGER NOT NULL DEFAULT 0,
        duration_s          INTEGER,
        avg_speed_kmh       DOUBLE PRECISION,
        max_speed_kmh       DOUBLE PRECISION,
        score               INTEGER,
        harsh_brakes        INTEGER NOT NULL DEFAULT 0,
        harsh_accels        INTEGER NOT NULL DEFAULT 0,
        sharp_turns         INTEGER NOT NULL DEFAULT 0,
        speeding_minutes    INTEGER NOT NULL DEFAULT 0,
        smooth_minutes      INTEGER NOT NULL DEFAULT 0,
        speed_camera_alerts INTEGER NOT NULL DEFAULT 0,
        police_alerts       INTEGER NOT NULL DEFAULT 0,
        hazards_encountered INTEGER NOT NULL DEFAULT 0,
        created_at          TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS live_trips_device_id_idx
        ON live_trips (device_id, started_at DESC)
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS custom_vehicles (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        make_name        TEXT NOT NULL,
        model_name       TEXT NOT NULL,
        make_slug        TEXT NOT NULL,
        model_slug       TEXT NOT NULL,
        known_make_id    TEXT,
        image_status     TEXT NOT NULL DEFAULT 'pending',
        submitted_count  INTEGER NOT NULL DEFAULT 1,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS custom_vehicles_slug_idx
        ON custom_vehicles (make_slug, model_slug)
    `);

    // ── Incremental column additions (idempotent) ─────────────────────────────
    // vehicle_id on live_trips — added for per-vehicle session scoping.
    // Nullable so all existing sessions (which have no vehicleId) are preserved.
    await db.execute(sql`
      ALTER TABLE live_trips ADD COLUMN IF NOT EXISTS vehicle_id TEXT
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS live_trips_vehicle_id_idx
        ON live_trips (device_id, vehicle_id, started_at DESC)
    `);

    // vehicle_id on accident_records — added for per-vehicle accident scoping.
    await db.execute(sql`
      ALTER TABLE accident_records ADD COLUMN IF NOT EXISTS vehicle_id TEXT
    `);

    // vehicle_id on dashcam_clips — added for per-vehicle dashcam clip scoping.
    await db.execute(sql`
      ALTER TABLE dashcam_clips ADD COLUMN IF NOT EXISTS vehicle_id TEXT
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS dashcam_clips_vehicle_id_idx
        ON dashcam_clips (device_id, vehicle_id, started_at DESC)
    `);

    // share_token on dashcam_clips — compact URL-safe code for branded share links.
    // Generated lazily on first share request; unique across all clips.
    await db.execute(sql`
      ALTER TABLE dashcam_clips ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS dashcam_clips_share_token_idx
        ON dashcam_clips (share_token)
        WHERE share_token IS NOT NULL
    `);

    // logo_status on custom_vehicles — tracks Wikipedia make-logo fetch lifecycle.
    // "pending" → queued; "done" → R2 has car-logos/{makeSlug}.png; "not_found" → no logo.
    await db.execute(sql`
      ALTER TABLE custom_vehicles ADD COLUMN IF NOT EXISTS logo_status TEXT NOT NULL DEFAULT 'pending'
    `);

    // ── Phone OTP verification table ──────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS phone_verifications (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        phone       TEXT NOT NULL,
        otp_hash    TEXT NOT NULL,
        expires_at  TIMESTAMP NOT NULL,
        attempts    INTEGER NOT NULL DEFAULT 0,
        verified    BOOLEAN NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS phone_verif_phone_expires_idx
        ON phone_verifications (phone, expires_at)
    `);

    // ── phone_number on device_backups — for OTP-based recovery ──────────────
    await db.execute(sql`
      ALTER TABLE device_backups ADD COLUMN IF NOT EXISTS phone_number TEXT
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS device_backups_phone_idx
        ON device_backups (phone_number)
        WHERE phone_number IS NOT NULL
    `);

    // ── Shared vehicle tables ─────────────────────────────────────────────────
    // shared_vehicles — owner-registered vehicles available for co-driver joining.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS shared_vehicles (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_device_id  TEXT NOT NULL,
        plate_number     TEXT,
        display_name     TEXT NOT NULL,
        vehicle_type     TEXT NOT NULL DEFAULT 'car',
        share_code       TEXT NOT NULL UNIQUE,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS shared_vehicles_owner_idx
        ON shared_vehicles (owner_device_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS shared_vehicles_plate_idx
        ON shared_vehicles (plate_number)
        WHERE plate_number IS NOT NULL
    `);

    // vehicle_members — tracks co-driver membership for each shared vehicle.
    // Unique on (vehicle_id, member_device_id) so onConflictDoNothing() is idempotent.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS vehicle_members (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id       UUID NOT NULL REFERENCES shared_vehicles(id) ON DELETE CASCADE,
        member_device_id TEXT NOT NULL,
        role             TEXT NOT NULL DEFAULT 'driver',
        status           TEXT NOT NULL DEFAULT 'active',
        created_at       TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS vehicle_members_vehicle_device_uniq
        ON vehicle_members (vehicle_id, member_device_id)
    `);
    // member_name added after initial rollout — backfill column idempotently.
    await db.execute(sql`
      ALTER TABLE vehicle_members ADD COLUMN IF NOT EXISTS member_name TEXT
    `);
    // removal_reason distinguishes voluntary leave from owner expulsion.
    // "left" = may rejoin; "owner_removed" = blocked until owner re-invites.
    await db.execute(sql`
      ALTER TABLE vehicle_members ADD COLUMN IF NOT EXISTS removal_reason TEXT
    `);
    // Backfill owner member rows for any shared_vehicles that pre-date the
    // vehicle_members table or whose owner row was missed (e.g. early-return
    // path in register that skipped the INSERT).  Idempotent via ON CONFLICT.
    await db.execute(sql`
      INSERT INTO vehicle_members (vehicle_id, member_device_id, role, status)
      SELECT sv.id, sv.owner_device_id, 'owner', 'active'
      FROM   shared_vehicles sv
      WHERE  NOT EXISTS (
        SELECT 1 FROM vehicle_members vm
        WHERE  vm.vehicle_id       = sv.id
          AND  vm.member_device_id = sv.owner_device_id
          AND  vm.role             = 'owner'
      )
      ON CONFLICT DO NOTHING
    `);

    // vehicle_join_requests — pending requests submitted via plate search.
    // The owner approves or declines; joining via share code bypasses this table.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS vehicle_join_requests (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id           UUID NOT NULL REFERENCES shared_vehicles(id) ON DELETE CASCADE,
        requester_device_id  TEXT NOT NULL,
        requester_name       TEXT,
        status               TEXT NOT NULL DEFAULT 'pending',
        created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
        resolved_at          TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS vehicle_join_requests_vehicle_idx
        ON vehicle_join_requests (vehicle_id, status)
    `);

    // ── vehicle_claims — user-submitted ownership disputes ────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS vehicle_claims (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id          UUID NOT NULL REFERENCES shared_vehicles(id) ON DELETE CASCADE,
        claimant_device_id  TEXT NOT NULL,
        claim_note          TEXT,
        status              TEXT NOT NULL DEFAULT 'pending',
        created_at          TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS vehicle_claims_vehicle_idx
        ON vehicle_claims (vehicle_id, status)
    `);

    // ── shared_vehicle_id on live_trips ──────────────────────────────────────
    // Nullable FK-style column (stored as TEXT to avoid cross-schema FK issues)
    // pointing to shared_vehicles.id.  Set at session-start when the driver's
    // active vehicle is registered as a shared vehicle so Garage Overview can
    // aggregate distance/time/trips across all co-drivers of the same vehicle.
    await db.execute(sql`
      ALTER TABLE live_trips ADD COLUMN IF NOT EXISTS shared_vehicle_id TEXT
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS live_trips_shared_vehicle_id_idx
        ON live_trips (shared_vehicle_id, ended_at)
        WHERE shared_vehicle_id IS NOT NULL
    `);

    // ── accident_records.my_vehicle_json ─────────────────────────────────────
    // Nullable JSON column storing the owner's vehicle details at crash time
    // (make, model, plate). Populated on the PATCH /accidents/:id/complete step.
    await db.execute(sql`
      ALTER TABLE accident_records
      ADD COLUMN IF NOT EXISTS my_vehicle_json TEXT
    `);

    // ── intent + requesting_device_id on phone_verifications ─────────────────
    // intent: locks each OTP to the intent it was created for (link | restore),
    // so a link OTP cannot be replayed as a restore OTP and vice-versa.
    // requesting_device_id: for link intent, the OTP is bound to the device that
    // requested it — a different device cannot use the same code to claim a phone
    // number it did not request the OTP for.
    await db.execute(sql`
      ALTER TABLE phone_verifications
      ADD COLUMN IF NOT EXISTS intent TEXT NOT NULL DEFAULT 'link'
    `);
    await db.execute(sql`
      ALTER TABLE phone_verifications
      ADD COLUMN IF NOT EXISTS requesting_device_id TEXT
    `);

    logger.info("migrateSchema: schema is up to date");
  } catch (err) {
    // Log but do not crash — a missing column causes a runtime error on first
    // use, which is more actionable than a boot failure in an unrelated service.
    logger.error({ err }, "migrateSchema: failed to apply schema migrations");
  }
}
