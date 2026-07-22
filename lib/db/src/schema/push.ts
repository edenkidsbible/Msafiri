import { pgTable, uuid, text, timestamp, integer, real } from "drizzle-orm/pg-core";

export const pushTokensTable = pgTable("push_tokens", {
  id:              uuid("id").primaryKey().defaultRandom(),
  deviceId:        text("device_id").notNull().unique(),
  token:           text("token").notNull(),
  platform:        text("platform").notNull().default("unknown"), // ios | android | web
  lastLat:         real("last_lat"),
  lastLng:         real("last_lng"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  lastSeenAt:      timestamp("last_seen_at").notNull().defaultNow(),
  // Triggered notifications — nullable timestamps gate idempotency / rate-limits
  welcomeSentAt:   timestamp("welcome_sent_at"),         // set once when the welcome push is delivered
  lastReengagedAt: timestamp("last_reengaged_at"),       // updated each time a re-engagement push is sent
  lastTripNotifAt: timestamp("last_trip_notif_at"),      // updated each time a post-trip nudge is sent
});

export const pushCampaignsTable = pgTable("push_campaigns", {
  id:          uuid("id").primaryKey().defaultRandom(),
  title:       text("title").notNull(),
  body:        text("body").notNull(),
  dataJson:    text("data_json"),
  type:        text("type").notNull().default("broadcast"), // broadcast | scheduled | daily_morning | daily_evening | engagement | incident
  status:      text("status").notNull().default("draft"),   // draft | scheduled | sending | sent | failed
  scheduledAt: timestamp("scheduled_at"),
  sentAt:      timestamp("sent_at"),
  sentCount:   integer("sent_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  targetCount: integer("target_count"),
  createdBy:   text("created_by").notNull().default("system"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

export type PushTokenRow = typeof pushTokensTable.$inferSelect;
export type PushCampaignRow = typeof pushCampaignsTable.$inferSelect;
