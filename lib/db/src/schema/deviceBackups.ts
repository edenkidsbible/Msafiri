import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

/**
 * device_backups — stores a snapshot of a device's vehicles and settings so
 * a user can restore their data on a new device via phone OTP.
 *
 * Security model:
 *   Restore is gated by phone OTP — the user must verify ownership of the
 *   recovery phone number linked to this record.
 *
 * Note: recovery_code is a legacy column (previously used for 5-char code
 * restore). It is no longer used by any flow and is kept only to avoid a
 * destructive migration on existing rows.
 */
export const deviceBackupsTable = pgTable("device_backups", {
  id:            uuid("id").primaryKey().defaultRandom(),
  /** Legacy — no longer used. Kept to avoid dropping existing data. */
  recoveryCode:  text("recovery_code"),
  /** Current device ID — updated to the new device's ID on restore. */
  deviceId:      text("device_id").notNull().unique(),
  /** E.164 phone number linked for OTP-based restore. */
  phoneNumber:   text("phone_number"),
  /** JSON array of SavedVehicle objects (includes plateNumber). */
  vehiclesJson:  text("vehicles_json").notNull().default("[]"),
  /** JSON object — arbitrary app settings (theme, driver name, etc.). */
  settingsJson:  text("settings_json").notNull().default("{}"),
  lastBackupAt:  timestamp("last_backup_at").notNull().defaultNow(),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
});

export type DeviceBackupRow = typeof deviceBackupsTable.$inferSelect;
export type DeviceBackupInsert = typeof deviceBackupsTable.$inferInsert;
