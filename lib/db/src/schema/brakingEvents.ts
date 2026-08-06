import { pgTable, uuid, text, doublePrecision, real, timestamp, integer } from "drizzle-orm/pg-core";

// Raw accelerometer + GPS events captured silently during active drives.
// Many events from many devices → clustering job → auto community reports.
export const brakingEventsTable = pgTable("braking_events", {
  id:         uuid("id").primaryKey().defaultRandom(),
  deviceId:   text("device_id").notNull(),
  eventType:  text("event_type").notNull(), // hard_braking | pothole | swerve
  lat:        doublePrecision("lat").notNull(),
  lng:        doublePrecision("lng").notNull(),
  speedKmh:   real("speed_kmh").notNull().default(0),
  gForce:     real("g_force").notNull(),
  heading:    real("heading"),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
});

export type BrakingEventRow = typeof brakingEventsTable.$inferSelect;

// One row per cluster; links the cluster centroid back to the auto-created report.
export const hazardClustersTable = pgTable("hazard_clusters", {
  id:              uuid("id").primaryKey().defaultRandom(),
  reportId:        uuid("report_id").notNull(),       // FK → community_reports.id
  clusterLat:      doublePrecision("cluster_lat").notNull(),
  clusterLng:      doublePrecision("cluster_lng").notNull(),
  dominantType:    text("dominant_type").notNull(),   // hard_braking | pothole | swerve
  deviceCount:     integer("device_count").notNull(),
  eventCount:      integer("event_count").notNull(),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
});

export type HazardClusterRow = typeof hazardClustersTable.$inferSelect;
