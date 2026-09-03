import {
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const speedBumpsTable = pgTable(
  "speed_bumps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    osmType: text("osm_type").notNull(),
    osmId: text("osm_id").notNull(),
    featureType: text("feature_type").notNull(),
    name: text("name").notNull(),
    road: text("road"),
    description: text("description"),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    direction: text("direction"),
    source: text("source").notNull().default("openstreetmap"),
    sourceTags: jsonb("source_tags").$type<Record<string, string>>().notNull().default({}),
    alertEnabled: boolean("alert_enabled").notNull().default(true),
    verified: boolean("verified").notNull().default(false),
    status: text("status").notNull().default("active"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("speed_bumps_source_object_uq").on(table.source, table.osmType, table.osmId),
    index("speed_bumps_status_idx").on(table.status, table.alertEnabled),
    index("speed_bumps_location_idx").on(table.lat, table.lng),
  ],
);

export type SpeedBumpRow = typeof speedBumpsTable.$inferSelect;
export type InsertSpeedBump = typeof speedBumpsTable.$inferInsert;