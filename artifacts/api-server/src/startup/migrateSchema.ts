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

    logger.info("migrateSchema: schema is up to date");
  } catch (err) {
    // Log but do not crash — a missing column causes a runtime error on first
    // use, which is more actionable than a boot failure in an unrelated service.
    logger.error({ err }, "migrateSchema: failed to apply schema migrations");
  }
}
