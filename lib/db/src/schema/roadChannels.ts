import { pgTable, uuid, text, doublePrecision, integer, timestamp, primaryKey, boolean } from "drizzle-orm/pg-core";

/** Last known, opt-in presence of a device in a supported road channel. */
export const roadChannelPresenceTable = pgTable("road_channel_presence", {
  channel: text("channel").notNull(),
  deviceId: text("device_id").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  direction: text("direction").notNull().default("unknown"),
  muted: boolean("muted").notNull().default(false),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
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
  durationMs: integer("duration_ms"),
  termsVersion: text("terms_version"),
  termsAcceptedAt: timestamp("terms_accepted_at"),
  moderationStatus: text("moderation_status").notNull().default("pending"),
  moderationReason: text("moderation_reason"),
  expiresAt: timestamp("expires_at").notNull().defaultNow(),
  status: text("status").notNull().default("upload_pending"),
  interpretedAt: timestamp("interpreted_at"),
  confirmedAt: timestamp("confirmed_at"),
  reportId: uuid("report_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type RoadChannelVoiceReportRow = typeof roadChannelVoiceReportsTable.$inferSelect;

/** Driver reports about unsafe or abusive channel contributions. */
export const roadChannelUserReportsTable = pgTable("road_channel_user_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  updateId: uuid("update_id").notNull(),
  reporterDeviceId: text("reporter_device_id").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});