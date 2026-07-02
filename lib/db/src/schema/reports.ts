import { pgTable, uuid, text, doublePrecision, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const communityReportsTable = pgTable("community_reports", {
  id:           uuid("id").primaryKey().defaultRandom(),
  type:         text("type").notNull(),           // camera|police|accident|traffic|roadblock|hazard|pothole|debris|breakdown|weather|closure|clear
  lat:          doublePrecision("lat").notNull(),
  lng:          doublePrecision("lng").notNull(),
  deviceId:     text("device_id").notNull(),
  status:       text("status").notNull().default("active"), // active|confirmed|expired|denied
  confirmCount: integer("confirm_count").notNull().default(1),
  confirmedBy:  jsonb("confirmed_by").notNull().$type<string[]>().default([]),
  denyCount:    integer("deny_count").notNull().default(0),
  speedLimit:   integer("speed_limit"),           // cameras only
  roadName:     text("road_name"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  expiresAt:    timestamp("expires_at"),          // null = never expires (cameras)
});

export const insertReportSchema = createInsertSchema(communityReportsTable).omit({
  id: true, status: true, confirmCount: true, denyCount: true, createdAt: true,
});

export type InsertReport = z.infer<typeof insertReportSchema>;
export type CommunityReportRow = typeof communityReportsTable.$inferSelect;
