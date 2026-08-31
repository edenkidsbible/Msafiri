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

    // ── vehicle_claims.admin_note ─────────────────────────────────────────────
    // Allows admins to record investigation notes (logbook details, contact
    // history, decision rationale) directly on a claim row.
    await db.execute(sql`
      ALTER TABLE vehicle_claims
      ADD COLUMN IF NOT EXISTS admin_note TEXT
    `);

    // ── accident_records.dashcam_clip_key ─────────────────────────────────────
    // Stores the R2 file key of a locked/pinned dashcam clip that the driver
    // has explicitly attached to this accident record for playback on the
    // public share page.
    await db.execute(sql`
      ALTER TABLE accident_records
      ADD COLUMN IF NOT EXISTS dashcam_clip_key TEXT
    `);

    // ── accident_shares ───────────────────────────────────────────────────────
    // Each row is a named, revocable share link; the UUID id IS the share token.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS accident_shares (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        accident_id  TEXT NOT NULL,
        device_id    TEXT NOT NULL,
        label        TEXT,
        revoked_at   TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS accident_shares_accident_id_idx
        ON accident_shares (accident_id, device_id)
    `);

    // ── push_tokens.last_bg_wakeup_at ─────────────────────────────────────────
    // Stamped each time /push/location is called with source="background_task".
    // Lets admins confirm that iOS content-available silent pushes are landing
    // and executing the background notification task on each device.
    await db.execute(sql`
      ALTER TABLE push_tokens
      ADD COLUMN IF NOT EXISTS last_bg_wakeup_at TIMESTAMP
    `);

    // ── push_tokens.vendor_id ──────────────────────────────────────────────────
    // Stable cross-reinstall device fingerprint used to evict stale rows when
    // an iOS/Android device reinstalls the app and generates a new deviceId +
    // new push token. iOS sends identifierForVendor (IDFV); Android sends
    // androidId. Nullable — older clients that predate this field send nothing.
    await db.execute(sql`
      ALTER TABLE push_tokens
      ADD COLUMN IF NOT EXISTS vendor_id TEXT
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS push_tokens_vendor_id_idx
        ON push_tokens (vendor_id)
        WHERE vendor_id IS NOT NULL
    `);

    // ── Email-based OTP recovery (replaces phone/SMS) ─────────────────────────
    // phone_verifications: add email column; make phone nullable so new email-
    // based OTPs don't require a phone number.
    await db.execute(sql`
      ALTER TABLE phone_verifications
      ADD COLUMN IF NOT EXISTS email TEXT
    `);
    await db.execute(sql`
      ALTER TABLE phone_verifications
      ADD COLUMN IF NOT EXISTS intent TEXT
    `);
    await db.execute(sql`
      ALTER TABLE phone_verifications
      ADD COLUMN IF NOT EXISTS requesting_device_id TEXT
    `);
    await db.execute(sql`
      ALTER TABLE phone_verifications
      ALTER COLUMN phone DROP NOT NULL
    `).catch(() => {/* already nullable */});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS phone_verif_email_expires_idx
        ON phone_verifications (email, expires_at)
        WHERE email IS NOT NULL
    `);
    // device_backups: add recovery_email column for email-based restore
    await db.execute(sql`
      ALTER TABLE device_backups
      ADD COLUMN IF NOT EXISTS recovery_email TEXT
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS device_backups_recovery_email_idx
        ON device_backups (recovery_email)
        WHERE recovery_email IS NOT NULL
    `);

    // ── speed_zones.camera_type ──────────────────────────────────────────────
    // "fixed" | "mobile" — only meaningful when type === "camera".
    // Added to Drizzle schema but omitted from this file; causes a hard 500 on
    // every /api/speed-zones request in production until this column exists.
    await db.execute(sql`
      ALTER TABLE speed_zones
      ADD COLUMN IF NOT EXISTS camera_type TEXT
    `);

    // ── community_reports — columns added in Drizzle schema but missing here ─
    // Each was applied to dev via drizzle-kit push but never propagated to prod
    // via this startup guard.  All use safe defaults so existing rows are valid.

    // camera_type — same semantics as speed_zones.camera_type above.
    await db.execute(sql`
      ALTER TABLE community_reports
      ADD COLUMN IF NOT EXISTS camera_type TEXT
    `);

    // Flagging system (user-reported inappropriate/inaccurate reports).
    await db.execute(sql`
      ALTER TABLE community_reports
      ADD COLUMN IF NOT EXISTS flag_count INTEGER NOT NULL DEFAULT 0
    `);
    await db.execute(sql`
      ALTER TABLE community_reports
      ADD COLUMN IF NOT EXISTS flagged_by JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
    await db.execute(sql`
      ALTER TABLE community_reports
      ADD COLUMN IF NOT EXISTS flag_reasons JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
    await db.execute(sql`
      ALTER TABLE community_reports
      ADD COLUMN IF NOT EXISTS flag_dismissed BOOLEAN NOT NULL DEFAULT FALSE
    `);

    // admin_verified — admin-confirmed report badge (confirmCount pinned to 999).
    await db.execute(sql`
      ALTER TABLE community_reports
      ADD COLUMN IF NOT EXISTS admin_verified BOOLEAN NOT NULL DEFAULT FALSE
    `);

    // source — "manual" (driver) | "auto" (hazard clustering job).
    await db.execute(sql`
      ALTER TABLE community_reports
      ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
    `);

    // Report confidence fields.
    await db.execute(sql`
      ALTER TABLE community_reports
      ADD COLUMN IF NOT EXISTS observation_context TEXT NOT NULL DEFAULT 'on_location'
    `);
    await db.execute(sql`
      ALTER TABLE community_reports
      ADD COLUMN IF NOT EXISTS observed_at TIMESTAMP
    `);
    await db.execute(sql`
      ALTER TABLE community_reports
      ADD COLUMN IF NOT EXISTS reporter_proximity_m INTEGER
    `);

    // ── admin_users TOTP columns ──────────────────────────────────────────────
    // totp_secret — base32 TOTP secret; NULL means 2FA not set up yet.
    // totp_enabled — true once the user has scanned + verified the QR code.
    await db.execute(sql`
      ALTER TABLE admin_users
      ADD COLUMN IF NOT EXISTS totp_secret TEXT
    `);
    await db.execute(sql`
      ALTER TABLE admin_users
      ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE
    `);

    // ── Ops Platform tables (ops_ prefix to avoid collision) ─────────────────

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ops_departments (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ops_team_members (
        id              SERIAL PRIMARY KEY,
        admin_user_id   TEXT NOT NULL,
        department_id   INTEGER REFERENCES ops_departments(id) ON DELETE SET NULL,
        role            TEXT NOT NULL DEFAULT 'member',
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        notes           TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ops_invitations (
        id             SERIAL PRIMARY KEY,
        email          TEXT NOT NULL,
        role           TEXT NOT NULL DEFAULT 'member',
        department_id  INTEGER REFERENCES ops_departments(id) ON DELETE SET NULL,
        token          TEXT NOT NULL UNIQUE,
        status         TEXT NOT NULL DEFAULT 'pending',
        invited_by     TEXT,
        expires_at     TIMESTAMPTZ NOT NULL,
        accepted_at    TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ops_operating_weeks (
        id                      SERIAL PRIMARY KEY,
        week_number             INTEGER NOT NULL UNIQUE,
        start_date              DATE NOT NULL,
        end_date                DATE NOT NULL,
        planned_cash_in_kes     NUMERIC(15,2),
        planned_cash_out_kes    NUMERIC(15,2),
        planned_ending_cash_kes NUMERIC(15,2),
        actual_cash_in_kes      NUMERIC(15,2),
        actual_cash_out_kes     NUMERIC(15,2),
        actual_ending_cash_kes  NUMERIC(15,2),
        variance_kes            NUMERIC(15,2),
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ops_weekly_plans (
        id                  SERIAL PRIMARY KEY,
        week_id             INTEGER NOT NULL REFERENCES ops_operating_weeks(id),
        main_objective      TEXT,
        required_outcomes   TEXT[],
        completed_outcomes  TEXT[],
        cash_decision       TEXT,
        product_priority    TEXT,
        user_priority       TEXT,
        field_sprint        TEXT,
        content_plan        TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by          TEXT
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ops_weekly_reviews (
        id                  SERIAL PRIMARY KEY,
        week_id             INTEGER NOT NULL REFERENCES ops_operating_weeks(id),
        what_worked         TEXT,
        what_didnt_work     TEXT,
        key_learning        TEXT,
        next_week_focus     TEXT,
        reviewed_at         TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by          TEXT
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ops_transaction_categories (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        type        TEXT NOT NULL,
        description TEXT,
        is_system   BOOLEAN NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ops_transactions (
        id                          SERIAL PRIMARY KEY,
        date                        DATE NOT NULL,
        type                        TEXT NOT NULL,
        amount_kes                  NUMERIC(15,2) NOT NULL,
        description                 TEXT NOT NULL,
        cleared                     BOOLEAN NOT NULL DEFAULT FALSE,
        category_id                 INTEGER REFERENCES ops_transaction_categories(id),
        week_id                     INTEGER REFERENCES ops_operating_weeks(id),
        payment_method              TEXT,
        reference                   TEXT,
        notes                       TEXT,
        linked_field_trip_id        INTEGER,
        linked_content_id           INTEGER,
        is_deleted                  BOOLEAN NOT NULL DEFAULT FALSE,
        created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by                  TEXT,
        updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by                  TEXT
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ops_recurring_expenses (
        id                    SERIAL PRIMARY KEY,
        name                  TEXT NOT NULL,
        amount_kes            NUMERIC(15,2),
        currency_type         TEXT NOT NULL DEFAULT 'KES',
        amount_usd            NUMERIC(10,2),
        frequency             TEXT NOT NULL,
        category_id           INTEGER REFERENCES ops_transaction_categories(id),
        next_billing_date     DATE,
        is_active             BOOLEAN NOT NULL DEFAULT TRUE,
        notes                 TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ops_tasks (
        id                  SERIAL PRIMARY KEY,
        title               TEXT NOT NULL,
        description         TEXT,
        status              TEXT NOT NULL DEFAULT 'todo',
        priority            TEXT NOT NULL DEFAULT 'medium',
        module              TEXT NOT NULL DEFAULT 'other',
        type                TEXT,
        due_date            DATE,
        week_id             INTEGER REFERENCES ops_operating_weeks(id),
        estimated_hours     NUMERIC(6,2),
        actual_hours        NUMERIC(6,2),
        assigned_to         TEXT,
        acceptance_criteria TEXT,
        position            INTEGER NOT NULL DEFAULT 0,
        is_recurring        BOOLEAN NOT NULL DEFAULT FALSE,
        is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by          TEXT,
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by          TEXT
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ops_content_items (
        id                          SERIAL PRIMARY KEY,
        title                       TEXT NOT NULL,
        status                      TEXT NOT NULL DEFAULT 'idea',
        week_id                     INTEGER REFERENCES ops_operating_weeks(id),
        is_core                     BOOLEAN NOT NULL DEFAULT FALSE,
        platforms                   TEXT[],
        pillar                      TEXT,
        format                      TEXT,
        angle                       TEXT,
        hook                        TEXT,
        caption_seed                TEXT,
        cta                         TEXT,
        scheduled_date              DATE,
        posted_date                 DATE,
        linked_field_trip_id        INTEGER,
        views                       INTEGER,
        clicks                      INTEGER,
        installs                    INTEGER,
        paid_subscribers_attributed INTEGER,
        founder_minutes             INTEGER,
        notes                       TEXT,
        compliance_notes            TEXT,
        has_compliance_warning      BOOLEAN NOT NULL DEFAULT FALSE,
        is_deleted                  BOOLEAN NOT NULL DEFAULT FALSE,
        created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by                  TEXT,
        updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by                  TEXT
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ops_field_trips (
        id                    SERIAL PRIMARY KEY,
        date                  DATE NOT NULL,
        purpose               TEXT NOT NULL,
        corridor              TEXT,
        status                TEXT NOT NULL DEFAULT 'planned',
        week_id               INTEGER REFERENCES ops_operating_weeks(id),
        planned_km            NUMERIC(8,2),
        start_odometer        NUMERIC(10,1),
        end_odometer          NUMERIC(10,1),
        actual_km             NUMERIC(8,2),
        parking_kes           NUMERIC(10,2),
        tolls_kes             NUMERIC(10,2),
        contingency_kes       NUMERIC(10,2),
        actual_fuel_spend_kes NUMERIC(10,2),
        required_outputs      TEXT,
        assigned_to           TEXT,
        notes                 TEXT,
        is_deleted            BOOLEAN NOT NULL DEFAULT FALSE,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by            TEXT,
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ops_road_records (
        id                    SERIAL PRIMARY KEY,
        record_date           DATE,
        county                TEXT NOT NULL,
        corridor              TEXT NOT NULL,
        landmark              TEXT,
        direction             TEXT,
        data_type             TEXT NOT NULL,
        coordinates           TEXT,
        speed_limit_kph       INTEGER,
        confidence            TEXT NOT NULL DEFAULT 'D',
        source_type           TEXT,
        evidence              TEXT,
        verifier              TEXT,
        last_verified_date    DATE,
        next_action           TEXT,
        status                TEXT NOT NULL DEFAULT 'needs_verification',
        linked_field_trip_id  INTEGER REFERENCES ops_field_trips(id),
        notes                 TEXT,
        is_deleted            BOOLEAN NOT NULL DEFAULT FALSE,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by            TEXT,
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ops_subscription_week_metrics (
        id                          SERIAL PRIMARY KEY,
        week_id                     INTEGER NOT NULL REFERENCES ops_operating_weeks(id),
        period_start_date           DATE,
        new_downloads               INTEGER,
        trials_started              INTEGER,
        new_paid                    INTEGER,
        renewals                    INTEGER,
        cancellations               INTEGER,
        active_paid_end             INTEGER NOT NULL,
        gross_sales_kes             NUMERIC(15,2),
        processor_fees_kes          NUMERIC(15,2),
        refunds_kes                 NUMERIC(15,2),
        cash_received_kes           NUMERIC(15,2),
        notes                       TEXT,
        created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by                  TEXT,
        updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ops_import_batches (
        id              SERIAL PRIMARY KEY,
        status          TEXT NOT NULL DEFAULT 'pending',
        filename        TEXT NOT NULL,
        file_path       TEXT,
        file_checksum   TEXT,
        sheet_count     INTEGER,
        rows_created    INTEGER,
        rows_updated    INTEGER,
        rows_skipped    INTEGER,
        rows_errored    INTEGER,
        warnings_json   TEXT,
        errors_json     TEXT,
        sheets_json     TEXT,
        committed_at    TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by      TEXT,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ops_settings (
        id                            SERIAL PRIMARY KEY,
        first_funding_date            DATE NOT NULL DEFAULT '2026-08-14',
        weekly_funding_amount_kes     NUMERIC(15,2) NOT NULL DEFAULT 10000.00,
        exchange_rate_kes_per_usd     NUMERIC(10,4) NOT NULL DEFAULT 129.3600,
        fuel_price_per_litre_kes      NUMERIC(10,2) NOT NULL DEFAULT 214.00,
        vehicle_efficiency_km_per_litre NUMERIC(8,2) NOT NULL DEFAULT 12.00,
        cash_floor_kes                NUMERIC(15,2) NOT NULL DEFAULT 2500.00,
        reserve_transfer_target_kes   NUMERIC(15,2) NOT NULL DEFAULT 1500.00,
        monthly_subscription_price_kes NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        replit_monthly_usd            NUMERIC(10,2) NOT NULL DEFAULT 20.00,
        replit_next_billing_date      DATE,
        baseline_active_paid          INTEGER NOT NULL DEFAULT 0,
        baseline_downloads            INTEGER NOT NULL DEFAULT 0,
        current_mrr_override_kes      NUMERIC(15,2),
        updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by                    TEXT
      )
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ops_conversation_type') THEN
          CREATE TYPE ops_conversation_type AS ENUM ('all_team', 'department', 'direct');
        END IF;
      END$$
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ops_conversations (
        id             SERIAL PRIMARY KEY,
        type           ops_conversation_type NOT NULL,
        department_id  INTEGER REFERENCES ops_departments(id) ON DELETE CASCADE,
        name           TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ops_messages (
        id              SERIAL PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES ops_conversations(id) ON DELETE CASCADE,
        sender_id       TEXT NOT NULL,
        body            TEXT NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at      TIMESTAMPTZ
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ops_conversation_members (
        id                  SERIAL PRIMARY KEY,
        conversation_id     INTEGER NOT NULL REFERENCES ops_conversations(id) ON DELETE CASCADE,
        user_id             TEXT NOT NULL,
        joined_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_read_message_id INTEGER REFERENCES ops_messages(id) ON DELETE SET NULL
      )
    `);

    // ── ops_team_members.invited_by — column added after initial rollout ────────
    // Tracks which admin user manually added a team member (NULL for auto-seeded rows).
    await db.execute(sql`
      ALTER TABLE ops_team_members
      ADD COLUMN IF NOT EXISTS invited_by TEXT
    `);

    // ── Unique constraint on ops_team_members.admin_user_id ──────────────────
    // Prevents duplicate rows for the same admin and makes ON CONFLICT work.
    // Before creating the index, delete any duplicates that may exist from
    // earlier deployments — keep the row with the lowest id for each user.
    await db.execute(sql`
      DELETE FROM ops_team_members
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM   ops_team_members
        GROUP  BY admin_user_id
      )
    `);
    // CREATE UNIQUE INDEX IF NOT EXISTS is idempotent across restarts.
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ops_team_members_admin_user_id_uniq
        ON ops_team_members (admin_user_id)
    `);

    // ── Unique Expo push tokens ───────────────────────────────────────────────
    // APNs/FCM can preserve an Expo token across a reinstall even though the
    // app creates a new local device ID. Remove old copies before adding the
    // unique index, keeping the installation that was seen most recently.
    await db.execute(sql`
      DELETE FROM push_tokens
      WHERE id NOT IN (
        SELECT DISTINCT ON (token) id
        FROM push_tokens
        ORDER BY token, last_seen_at DESC, created_at DESC, id DESC
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_token_unique
        ON push_tokens (token)
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS creator_benefits (
        application_id UUID PRIMARY KEY REFERENCES creator_applications(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL,
        revenuecat_app_user_id TEXT,
        binding_verified BOOLEAN NOT NULL DEFAULT FALSE,
        platform TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        product_id TEXT, transaction_id TEXT, period_type TEXT,
        offer_started_at TIMESTAMP, offer_expires_at TIMESTAMP, last_event_at TIMESTAMP,
        last_reminder_at TIMESTAMP, reminder_count INTEGER NOT NULL DEFAULT 0,
        revoked_at TIMESTAMP, revocation_reason TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`ALTER TABLE creator_benefits ADD COLUMN IF NOT EXISTS binding_verified BOOLEAN NOT NULL DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE creator_benefits DROP CONSTRAINT IF EXISTS creator_benefits_revenuecat_app_user_id_unique`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS creator_benefits_device_idx ON creator_benefits (device_id)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS creator_benefits_verified_device_unique ON creator_benefits (device_id) WHERE binding_verified = TRUE`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS creator_benefits_verified_rc_unique ON creator_benefits (revenuecat_app_user_id) WHERE binding_verified = TRUE AND revenuecat_app_user_id IS NOT NULL`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS creator_subscription_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id TEXT NOT NULL UNIQUE,
        application_id UUID REFERENCES creator_applications(id) ON DELETE SET NULL,
        app_user_id TEXT NOT NULL, event_type TEXT NOT NULL,
        product_id TEXT, platform TEXT, transaction_id TEXT,
        purchased_at TIMESTAMP, expires_at TIMESTAMP, period_type TEXT,
        match_status TEXT NOT NULL DEFAULT 'unmatched', raw_event JSONB NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS creator_subscription_events_app_user_idx ON creator_subscription_events (app_user_id, created_at DESC)`);
    await db.execute(sql`
      INSERT INTO creator_benefits (application_id, device_id, platform, status)
      SELECT id, device_id, platform, CASE WHEN status = 'approved' THEN 'assigned' ELSE 'pending' END
      FROM creator_applications
      ON CONFLICT (application_id) DO NOTHING
    `);

    logger.info("migrateSchema: schema is up to date");
  } catch (err) {
    // Log but do not crash — a missing column causes a runtime error on first
    // use, which is more actionable than a boot failure in an unrelated service.
    logger.error({ err }, "migrateSchema: failed to apply schema migrations");
  }
}
