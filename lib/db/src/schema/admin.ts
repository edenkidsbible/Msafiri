import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const adminUsersTable = pgTable("admin_users", {
  id:           uuid("id").primaryKey().defaultRandom(),
  email:        text("email").notNull().unique(),
  name:         text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role:         text("role").notNull().default("staff"), // admin | moderator | staff
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

export const auditLogsTable = pgTable("audit_logs", {
  id:         uuid("id").primaryKey().defaultRandom(),
  actorId:    text("actor_id").notNull(),
  actorName:  text("actor_name").notNull(),
  actorRole:  text("actor_role").notNull(),
  action:     text("action").notNull(),
  targetType: text("target_type"),
  targetId:   text("target_id"),
  details:    text("details"),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
});

export const adminNotificationsTable = pgTable("admin_notifications", {
  id:        uuid("id").primaryKey().defaultRandom(),
  title:     text("title").notNull(),
  message:   text("message").notNull(),
  type:      text("type").notNull().default("info"), // info | warning | error | success
  isRead:    boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AdminUserRow = typeof adminUsersTable.$inferSelect;
export type AuditLogRow = typeof auditLogsTable.$inferSelect;
export type AdminNotificationRow = typeof adminNotificationsTable.$inferSelect;
