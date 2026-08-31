import { pgTable, uuid, text, doublePrecision, integer, timestamp, primaryKey } from "drizzle-orm/pg-core";

/** Last known, opt-in presence of a device in a supported road channel. */
export const roadChannelPresenceTable = pgTable("road_channel_presence", {
  channel: text("channel").notNull(),
  deviceId: text("device_id").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.channel, table.deviceId] })]);

/** A lightweight channel timeline; reportId links confirmed voice reports. */
export const roadChannelUpdatesTable = pgTable("road_channel_updates", {
  id: uuid("id").primaryKey().defaultRandom(),
  channel: text("channel").notNull(),
  deviceId: text("device_id").notNull(),
  kind: text("kind").notNull(),
  reportId: uuid("report_id"),
  voiceReportId: uuid("voice_report_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Private audio object and AI-proposed report metadata. A proposal is never
 * public: only an explicit client confirmation may create community_reports.
 */
export const roadChannelVoiceReportsTable = pgTable("road_channel_voice_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  channel: text("channel").notNull(),
  deviceId: text("device_id").notNull(),
  objectKey: text("object_key").notNull().unique(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  transcript: text("transcript"),
  summary: text("summary"),
  proposedType: text("proposed_type"),
  proposedSpeedLimit: integer("proposed_speed_limit"),
  proposedCameraType: text("proposed_camera_type"),
  status: text("status").notNull().default("upload_pending"),
  interpretedAt: timestamp("interpreted_at"),
  confirmedAt: timestamp("confirmed_at"),
  reportId: uuid("report_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type RoadChannelVoiceReportRow = typeof roadChannelVoiceReportsTable.$inferSelect;