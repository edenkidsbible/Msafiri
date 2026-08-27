import { pgTable, uuid, text, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";
import { creatorApplicationsTable } from "./creators";

export const creatorBenefitsTable = pgTable("creator_benefits", {
  applicationId: uuid("application_id")
    .primaryKey()
    .references(() => creatorApplicationsTable.id, { onDelete: "cascade" }),
  deviceId: text("device_id").notNull(),
  revenuecatAppUserId: text("revenuecat_app_user_id"),
  bindingVerified: boolean("binding_verified").notNull().default(false),
  platform: text("platform"),
  status: text("status").notNull().default("pending"),
  productId: text("product_id"),
  transactionId: text("transaction_id"),
  periodType: text("period_type"),
  offerStartedAt: timestamp("offer_started_at"),
  offerExpiresAt: timestamp("offer_expires_at"),
  lastEventAt: timestamp("last_event_at"),
  lastReminderAt: timestamp("last_reminder_at"),
  reminderCount: integer("reminder_count").notNull().default(0),
  revokedAt: timestamp("revoked_at"),
  revocationReason: text("revocation_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const creatorSubscriptionEventsTable = pgTable("creator_subscription_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: text("event_id").notNull().unique(),
  applicationId: uuid("application_id").references(() => creatorApplicationsTable.id, {
    onDelete: "set null",
  }),
  appUserId: text("app_user_id").notNull(),
  eventType: text("event_type").notNull(),
  productId: text("product_id"),
  platform: text("platform"),
  transactionId: text("transaction_id"),
  purchasedAt: timestamp("purchased_at"),
  expiresAt: timestamp("expires_at"),
  periodType: text("period_type"),
  matchStatus: text("match_status").notNull().default("unmatched"),
  rawEvent: jsonb("raw_event").notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CreatorBenefitRow = typeof creatorBenefitsTable.$inferSelect;
export type CreatorSubscriptionEventRow = typeof creatorSubscriptionEventsTable.$inferSelect;