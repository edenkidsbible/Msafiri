import { pgTable, uuid, text, integer, boolean, timestamp, doublePrecision } from "drizzle-orm/pg-core";

/**
 * One-time enrollment OTP requests. Server sends the OTP as a push-notification
 * data payload only — it is never returned in the HTTP response. A device
 * therefore proves it can receive Expo push notifications before it is enrolled.
 */
export const dashcamEnrollmentRequestsTable = pgTable("dashcam_enrollment_requests", {
  id:          uuid("id").primaryKey().defaultRandom(),
  deviceId:    text("device_id").notNull(),
  otpHash:     text("otp_hash").notNull(),
  expiresAt:   timestamp("expires_at").notNull(),
  fulfilledAt: timestamp("fulfilled_at"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

export type DashcamEnrollmentRequestRow = typeof dashcamEnrollmentRequestsTable.$inferSelect;

/**
 * Upload intent reservation. Created atomically when issuing a presigned URL
 * and counted against the device quota. The clip endpoint validates the intent
 * and marks it fulfilled. Intents expire after 30 minutes so unused reservations
 * are reclaimed automatically.
 */
export const dashcamUploadIntentsTable = pgTable("dashcam_upload_intents", {
  id:          uuid("id").primaryKey().defaultRandom(),
  deviceId:    text("device_id").notNull(),
  clipId:      text("clip_id").notNull().unique(),
  fileKey:     text("file_key").notNull(),
  expiresAt:   timestamp("expires_at").notNull(),
  fulfilledAt: timestamp("fulfilled_at"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

export type DashcamUploadIntentRow = typeof dashcamUploadIntentsTable.$inferSelect;

/**
 * DB-backed rate limit table for dashcam device registration attempts.
 * Persists across server restarts. Keyed by SHA-256(ip).slice(0,32).
 */
export const dashcamRegRatelimitTable = pgTable("dashcam_reg_ratelimit", {
  ipHash:      text("ip_hash").primaryKey(),
  count:       integer("count").notNull().default(1),
  windowStart: timestamp("window_start").notNull().defaultNow(),
});

/**
 * Device-level secret registry.  A device must call POST /dashcam/register
 * (which stores SHA-256(deviceId+":"+secret) here) before the server will
 * issue any presigned upload URLs.  This prevents unauthenticated callers
 * from consuming R2 storage by guessing a deviceId.
 */
export const dashcamDevicesTable = pgTable("dashcam_devices", {
  deviceId:   text("device_id").primaryKey(),
  secretHash: text("secret_hash").notNull(),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
});

export type DashcamDeviceRow = typeof dashcamDevicesTable.$inferSelect;

export const dashcamClipsTable = pgTable("dashcam_clips", {
  id:               uuid("id").primaryKey().defaultRandom(),
  deviceId:         text("device_id").notNull(),
  fileKey:          text("file_key").notNull(),          // R2 object key (dashcam/<deviceId>/<id>.mp4)
  durationS:        integer("duration_s"),
  sizeBytes:        integer("size_bytes"),
  locked:           boolean("locked").notNull().default(true),
  lockReason:       text("lock_reason"),                 // 'manual' | 'crash' | 'test'
  startedAt:        timestamp("started_at").notNull(),
  uploadedAt:       timestamp("uploaded_at"),
  lat:              doublePrecision("lat"),
  lng:              doublePrecision("lng"),
  speedKmh:         integer("speed_kmh"),
  /** SHA-256(deviceId + ":" + dashcamSecret) — used to authenticate ownership of clips. */
  deviceSecretHash: text("device_secret_hash"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
});

export type DashcamClipRow = typeof dashcamClipsTable.$inferSelect;
