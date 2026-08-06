import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const emergencyContactsTable = pgTable("emergency_contacts", {
  id:          uuid("id").defaultRandom().primaryKey(),
  deviceId:    text("device_id").notNull(),
  name:        text("name").notNull(),
  phoneE164:   text("phone_e164").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
