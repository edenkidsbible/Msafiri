import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const adminUsersTable = pgTable("admin_users", {
  id:           uuid("id").primaryKey().defaultRandom(),
  email:        text("email").notNull().unique(),
  name:         text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role:         text("role").notNull().default("staff"), // admin | staff
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

export type AdminUserRow = typeof adminUsersTable.$inferSelect;
