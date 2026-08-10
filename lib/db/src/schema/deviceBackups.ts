import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

/**
 * device_backups — maps a device to its 5-char recovery code and stores a
 * snapshot of the vehicle list and app settings so a user can restore their
 * data on a new device.
 *
 * Security model:
 *   Restore requires BOTH the recoveryCode AND a matching plate number from
 *   the backed-up vehicle list.  Neither alone is sufficient.
 */
export const deviceBackupsTable = pgTable("device_backups", {
  id:            uuid("id").primaryKey().defaultRandom(),
  /** 5-char uppercase alphanumeric code shown to the user (e.g. "A7K2M"). */
  recoveryCode:  text("recovery_code").notNull().unique(),
  /** Current device ID — updated to the new device's ID on restore. */
  deviceId:      text("device_id").notNull().unique(),
  /** JSON array of SavedVehicle objects (includes plateNumber). */
  vehiclesJson:  text("vehicles_json").notNull().default("[]"),
  /** JSON object — arbitrary app settings (theme, driver name, etc.). */
  settingsJson:  text("settings_json").notNull().default("{}"),
  /**
   * E.164 Kenyan phone number linked via OTP verification, e.g. "+254712345678".
   * Used as the primary recovery factor — user receives an OTP to restore data.
   * NULL for accounts created before phone-based recovery was introduced.
   */
  phoneNumber:   text("phone_number"),
  lastBackupAt:  timestamp("last_backup_at").notNull().defaultNow(),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
});

export type DeviceBackupRow = typeof deviceBackupsTable.$inferSelect;
export type DeviceBackupInsert = typeof deviceBackupsTable.$inferInsert;
