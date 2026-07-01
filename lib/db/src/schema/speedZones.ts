import { pgTable, uuid, text, doublePrecision, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const speedZonesTable = pgTable("speed_zones", {
  id:           uuid("id").primaryKey().defaultRandom(),
  name:         text("name").notNull(),
  road:         text("road"),
  type:         text("type").notNull(),           // camera|police|zone
  mode:         text("mode").notNull().default("point"), // point|stretch
  speedLimit:   integer("speed_limit"),
  description:  text("description"),
  lat:          doublePrecision("lat"),            // point mode
  lng:          doublePrecision("lng"),            // point mode
  startLat:     doublePrecision("start_lat"),       // stretch mode
  startLng:     doublePrecision("start_lng"),       // stretch mode
  endLat:       doublePrecision("end_lat"),         // stretch mode
  endLng:       doublePrecision("end_lng"),         // stretch mode
  status:       text("status").notNull().default("active"), // active|inactive
  createdBy:    text("created_by"),                // admin_users.id of the creator
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
});

export const insertSpeedZoneSchema = createInsertSchema(speedZonesTable)
  .omit({ id: true, status: true, createdAt: true, updatedAt: true })
  .refine(
    (val) =>
      val.mode === "point"
        ? val.lat != null && val.lng != null
        : val.startLat != null && val.startLng != null && val.endLat != null && val.endLng != null,
    { message: "point mode requires lat/lng; stretch mode requires start/end lat/lng" },
  );

export type InsertSpeedZone = z.infer<typeof insertSpeedZoneSchema>;
export type SpeedZoneRow = typeof speedZonesTable.$inferSelect;
