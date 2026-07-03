import { pgTable, uuid, text, doublePrecision, integer, timestamp } from "drizzle-orm/pg-core";

export const savedPlacesTable = pgTable("saved_places", {
  id:        uuid("id").primaryKey().defaultRandom(),
  deviceId:  text("device_id").notNull(),
  label:     text("label").notNull(),            // e.g. "Home", "Work", "Gym"
  kind:      text("kind").notNull().default("custom"), // home | work | custom — drives the icon shown
  address:   text("address"),                    // short display address from search
  lat:       doublePrecision("lat").notNull(),
  lng:       doublePrecision("lng").notNull(),
  usualTimeMinutes: integer("usual_time_minutes"), // minutes since local midnight (EAT) the driver usually leaves for this place, null = not set
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const plannedTripsTable = pgTable("planned_trips", {
  id:           uuid("id").primaryKey().defaultRandom(),
  deviceId:     text("device_id").notNull(),
  savedPlaceId: uuid("saved_place_id"),           // nullable — trip may target an ad-hoc searched destination
  label:        text("label").notNull(),          // destination display name
  destLat:      doublePrecision("dest_lat").notNull(),
  destLng:      doublePrecision("dest_lng").notNull(),
  plannedAt:    timestamp("planned_at").notNull(),  // when the driver intends to leave
  status:       text("status").notNull().default("upcoming"), // upcoming | notified | completed | cancelled
  notifiedAt:   timestamp("notified_at"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

export type SavedPlaceRow = typeof savedPlacesTable.$inferSelect;
export type PlannedTripRow = typeof plannedTripsTable.$inferSelect;
