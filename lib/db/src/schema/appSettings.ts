import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * Singleton settings row. Always upsert with id = 'singleton'.
 * Access via the admin /admin/settings endpoints; read publicly via /app-settings.
 */
export const appSettingsTable = pgTable("app_settings", {
  id:                 text("id").primaryKey().default("singleton"),
  navigationEnabled:  boolean("navigation_enabled").notNull().default(true),
  updatedAt:          timestamp("updated_at").notNull().defaultNow(),
});

export type AppSettingsRow = typeof appSettingsTable.$inferSelect;
