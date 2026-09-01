import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * Compatibility schema for the legacy live-trip history table.
 *
 * The API still reads and writes this table directly, and existing databases
 * contain historical drive sessions. Keep it represented here so a Drizzle
 * schema push cannot interpret the table as abandoned and drop its data.
 */
export const liveTripsTable = pgTable(
  "live_trips",
  {
    id:                  uuid("id").primaryKey().defaultRandom(),
    deviceId:            text("device_id").notNull(),
    startedAt:            timestamp("started_at").notNull(),
    endedAt:              timestamp("ended_at"),
    startLat:             doublePrecision("start_lat"),
    startLng:             doublePrecision("start_lng"),
    endLat:               doublePrecision("end_lat"),
    endLng:               doublePrecision("end_lng"),
    distanceM:            integer("distance_m").notNull().default(0),
    durationS:            integer("duration_s"),
    avgSpeedKmh:          doublePrecision("avg_speed_kmh"),
    maxSpeedKmh:          doublePrecision("max_speed_kmh"),
    score:                integer("score"),
    harshBrakes:          integer("harsh_brakes").notNull().default(0),
    harshAccels:          integer("harsh_accels").notNull().default(0),
    sharpTurns:           integer("sharp_turns").notNull().default(0),
    speedingMinutes:      integer("speeding_minutes").notNull().default(0),
    smoothMinutes:        integer("smooth_minutes").notNull().default(0),
    speedCameraAlerts:    integer("speed_camera_alerts").notNull().default(0),
    policeAlerts:         integer("police_alerts").notNull().default(0),
    hazardsEncountered:   integer("hazards_encountered").notNull().default(0),
    vehicleId:            text("vehicle_id"),
    sharedVehicleId:      text("shared_vehicle_id"),
    createdAt:            timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    deviceStartedIdx: index("live_trips_device_id_idx").on(
      table.deviceId,
      table.startedAt,
    ),
    vehicleStartedIdx: index("live_trips_vehicle_id_idx").on(
      table.deviceId,
      table.vehicleId,
      table.startedAt,
    ),
    sharedVehicleEndedIdx: index("live_trips_shared_vehicle_id_idx").on(
      table.sharedVehicleId,
      table.endedAt,
    ),
  }),
);

export type LiveTripRow = typeof liveTripsTable.$inferSelect;