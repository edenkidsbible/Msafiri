import { pgTable, uuid, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";

/**
 * phone_verifications — short-lived OTP records used for phone-based
 * account access and recovery.
 *
 * Each row represents one OTP request. On verify the row is marked
 * verified=true; expired/used rows can be pruned periodically.
 */
export const phoneVerificationsTable = pgTable("phone_verifications", {
  id:        uuid("id").primaryKey().defaultRandom(),
  /** E.164 normalised Kenyan number, e.g. "+254712345678". */
  phone:     text("phone").notNull(),
  /** SHA-256 hex hash of the 6-digit OTP. Never stored in plain text. */
  otpHash:   text("otp_hash").notNull(),
  /** When the OTP expires (10 minutes from creation). */
  expiresAt: timestamp("expires_at").notNull(),
  /** Number of failed verify attempts (max 5 before record is locked). */
  attempts:  integer("attempts").notNull().default(0),
  /** True once the correct OTP has been supplied. */
  verified:  boolean("verified").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PhoneVerificationRow    = typeof phoneVerificationsTable.$inferSelect;
export type PhoneVerificationInsert = typeof phoneVerificationsTable.$inferInsert;
