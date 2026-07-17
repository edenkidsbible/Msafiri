import { pgTable, uuid, text, doublePrecision, integer, timestamp } from "drizzle-orm/pg-core";

// Live trip-sharing sessions. Created when a driver taps "Share Trip" and
// receives GPS pings every ~8 s while navigation is active. The session token
// is the public share ID embedded in the live-tracker URL — it is a random
// UUID, not guessable from the deviceId or any other known value.
export const sharingSessionsTable = pgTable("sharing_sessions", {
  token:              uuid("token").primaryKey().defaultRandom(),
  deviceId:           text("device_id").notNull(),
  destinationName:    text("destination_name"),
  destinationLat:     doublePrecision("destination_lat"),
  destinationLng:     doublePrecision("destination_lng"),
  // Latest position reported by the driver
  lat:                doublePrecision("lat"),
  lng:                doublePrecision("lng"),
  speedKmh:           doublePrecision("speed_kmh"),
  durationRemainingS: integer("duration_remaining_s"),
  distanceRemainingM: doublePrecision("distance_remaining_m"),
  createdAt:          timestamp("created_at").notNull().defaultNow(),
  lastPingAt:         timestamp("last_ping_at"),
  // Null while the session is active; set when the driver stops sharing / navigation ends
  endedAt:            timestamp("ended_at"),
  // Hard expiry regardless of endedAt — prevents sessions living forever if the
  // app crashes without a clean DELETE. Set to createdAt + 8 hours on insert.
  expiresAt:          timestamp("expires_at").notNull(),
});

export type SharingSessionRow = typeof sharingSessionsTable.$inferSelect;
