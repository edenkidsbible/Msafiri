import { pgTable, uuid, text, doublePrecision, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const communityReportsTable = pgTable("community_reports", {
  id:           uuid("id").primaryKey().defaultRandom(),
  type:         text("type").notNull(),           // camera|police|accident|traffic|roadblock|hazard|pothole|debris|breakdown|weather|closure|clear
  lat:          doublePrecision("lat").notNull(),
  lng:          doublePrecision("lng").notNull(),
  deviceId:     text("device_id").notNull(),
  status:       text("status").notNull().default("active"), // active|confirmed|expired|denied|pending_review
  confirmCount: integer("confirm_count").notNull().default(1),
  confirmedBy:  jsonb("confirmed_by").notNull().$type<string[]>().default([]),
  denyCount:    integer("deny_count").notNull().default(0),
  speedLimit:   integer("speed_limit"),           // cameras only
  roadName:     text("road_name"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  expiresAt:       timestamp("expires_at"),          // null = never expires (cameras)
  lastNotifiedAt:  timestamp("last_notified_at"),    // last time a confirmation push was sent for this report
  lastVotedAt:     timestamp("last_voted_at"),       // last time any device confirmed or denied this report
  // Set true when a moderator dismisses an expired report from the moderation
  // queue so it stops showing up there; the report itself stays "expired".
  moderationDismissed: boolean("moderation_dismissed").notNull().default(false),
  // Driver-submitted flags ("report inappropriate/inaccurate report to staff").
  // Distinct from confirm/deny voting — regular users cannot remove reports
  // themselves (own or others'); flagging routes the report to the admin
  // moderation queue for a human decision instead.
  flagCount:      integer("flag_count").notNull().default(0),
  flaggedBy:      jsonb("flagged_by").notNull().$type<string[]>().default([]), // deviceIds, one flag per device
  flagReasons:    jsonb("flag_reasons").notNull().$type<string[]>().default([]),
  // Set true when a moderator reviews the flag(s) and decides to keep the
  // report live; a fresh flag from a new device clears this so it resurfaces.
  flagDismissed:  boolean("flag_dismissed").notNull().default(false),
});

export const insertReportSchema = createInsertSchema(communityReportsTable).omit({
  id: true, status: true, confirmCount: true, denyCount: true, createdAt: true,
});

export type InsertReport = z.infer<typeof insertReportSchema>;
export type CommunityReportRow = typeof communityReportsTable.$inferSelect;

// Device-level blocklist enforcing the "block a device for report
// spamming/abuse" claim in the Terms of Service. Reporters are identified
// only by a locally-generated device id (no accounts), so blocking happens
// at that granularity. deviceId is the primary key — a device is either
// blocked or not, no history of past blocks is kept.
export const blockedDevicesTable = pgTable("blocked_devices", {
  deviceId:  text("device_id").primaryKey(),
  reason:    text("reason"),
  blockedBy: text("blocked_by").notNull(), // admin display name at time of block
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertBlockedDeviceSchema = createInsertSchema(blockedDevicesTable).omit({
  createdAt: true,
});

export type InsertBlockedDevice = z.infer<typeof insertBlockedDeviceSchema>;
export type BlockedDeviceRow = typeof blockedDevicesTable.$inferSelect;
