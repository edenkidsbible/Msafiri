import { pgTable, text, numeric, timestamp, boolean, integer } from "drizzle-orm/pg-core";

// Each crash-trigger event is logged the moment the crash modal fires on the device.
// Compare against emergency_alerts_log to measure the false-positive rate:
//   false-positive rate = (triggers - real alerts) / triggers
export const crashTriggerEventsTable = pgTable("crash_trigger_events", {
  id:          text("id").primaryKey().$defaultFn(() => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)),
  deviceId:    text("device_id").notNull(),
  lat:         numeric("lat"),
  lng:         numeric("lng"),
  peakG:       numeric("peak_g").notNull(),
  sensitivity: text("sensitivity").notNull().default("medium"),
  triggeredAt: timestamp("triggered_at").notNull().defaultNow(),
});

// Logged every time /emergency/alert is called with at least one contact SMS sent.
// Each row = a real emergency dispatch (countdown expired without driver response
// or driver tapped "Call Emergency Services").
export const emergencyAlertsLogTable = pgTable("emergency_alerts_log", {
  id:           text("id").primaryKey().$defaultFn(() => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)),
  deviceId:     text("device_id").notNull(),
  lat:          numeric("lat"),
  lng:          numeric("lng"),
  contactsSent: integer("contacts_sent").notNull().default(0),
  isTest:       boolean("is_test").notNull().default(false),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});
