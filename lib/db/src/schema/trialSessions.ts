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
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
});

export type DeviceTrialSession = typeof deviceTrialSessionsTable.$inferSelect;
