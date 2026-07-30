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

    logger.info("migrateSchema: schema is up to date");
  } catch (err) {
    // Log but do not crash — a missing column causes a runtime error on first
    // use, which is more actionable than a boot failure in an unrelated service.
    logger.error({ err }, "migrateSchema: failed to apply schema migrations");
  }
}
