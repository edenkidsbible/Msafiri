import { pgTable, text, integer, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Tracks the number of completed drive sessions per device for the session-based
 * free trial.  The stable device identifier comes from RevenueCat's
 * originalAppUserId, which survives reinstall on both iOS (tied to Apple ID) and
 * Android (tied to Play Store account).
 */
export const deviceTrialSessionsTable = pgTable("device_trial_sessions", {
  id:             uuid("id").primaryKey().defaultRandom(),
  stableDeviceId: text("stable_device_id").notNull().unique(),
  sessionCount:   integer("session_count").notNull().default(0),
  /** App-layer push device ID — set on first qualifying drive to allow post-trial push nudges. */
  deviceId:       text("device_id"),
  /** Set the first time sessionCount reaches FREE_TRIAL_SESSIONS; drives the nudge sequence. */
  trialExpiredAt: timestamp("trial_expired_at"),
  /** Nudge stage: 0 = none sent, 1 = 30-min sent, 2 = 24-h sent, 3 = done. */
  nudgeStage:     integer("nudge_stage").notNull().default(0),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
});

export type DeviceTrialSession = typeof deviceTrialSessionsTable.$inferSelect;
