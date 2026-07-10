import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const creatorApplicationsTable = pgTable("creator_applications", {
  id:        uuid("id").primaryKey().defaultRandom(),
  deviceId:  text("device_id").notNull(),
  name:      text("name").notNull(),
  email:     text("email").notNull(),
  platform:  text("platform"),           // ios | android — preferred store
  reason:    text("reason"),
  status:    text("status").notNull().default("pending"), // pending | approved | rejected
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type CreatorApplicationRow = typeof creatorApplicationsTable.$inferSelect;
