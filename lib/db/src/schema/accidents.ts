import { pgTable, text, numeric, timestamp, boolean } from "drizzle-orm/pg-core";

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// Core accident record — created automatically on crash detection or manually by driver.
export const accidentRecordsTable = pgTable("accident_records", {
  id:               text("id").primaryKey().$defaultFn(genId),
  deviceId:         text("device_id").notNull(),
  status:           text("status").notNull().default("draft"),  // 'draft' | 'complete'
  isManual:         boolean("is_manual").notNull().default(false),
  detectedAt:       timestamp("detected_at").notNull().defaultNow(),

  // Location — captured from GPS at moment of crash
  lat:              numeric("lat"),
  lng:              numeric("lng"),
  roadName:         text("road_name"),
  county:           text("county"),
  nearbyLandmark:   text("nearby_landmark"),

  // Speed & motion data from speedWindowRef at crash moment
  speedBeforeKmh:   numeric("speed_before_kmh"),
  speedAtImpactKmh: numeric("speed_at_impact_kmh"),
  headingDeg:       numeric("heading_deg"),
  directionLabel:   text("direction_label"),

  // Trip context (from active trip at crash moment)
  tripStartAt:      timestamp("trip_start_at"),
  destinationName:  text("destination_name"),
  distanceM:        numeric("distance_m"),
  durationS:        numeric("duration_s"),

  // Weather snapshot — fetched server-side from Open-Meteo on record creation
  weatherJson:      text("weather_json"),  // JSON: { description, tempC, conditions }

  // Linked dashcam clip (ID from dashcam_clips table)
  dashcamClipId:    text("dashcam_clip_id"),

  // Other party details (optional — driver fills in guided checklist)
  otherDriverJson:  text("other_driver_json"),  // { name, phone, insuranceCompany, policyNumber, vehicleReg }
  policeJson:       text("police_json"),          // { station, officerName, obNumber, reference }

  // Driver's written statement
  driverStatement:  text("driver_statement"),

  // Generated PDF report
  pdfUrl:           text("pdf_url"),
  pdfFileKey:       text("pdf_file_key"),

  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
});

// Photos taken at the scene (from expo-image-picker), uploaded to object storage.
export const accidentPhotosTable = pgTable("accident_photos", {
  id:          text("id").primaryKey().$defaultFn(genId),
  accidentId:  text("accident_id").notNull(),
  // front_damage | rear_damage | side_damage | other_vehicle | number_plates | road_condition | other
  category:    text("category").notNull(),
  storageUrl:  text("storage_url"),
  fileKey:     text("file_key"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

// Witnesses recorded at the scene.
export const accidentWitnessesTable = pgTable("accident_witnesses", {
  id:          text("id").primaryKey().$defaultFn(genId),
  accidentId:  text("accident_id").notNull(),
  name:        text("name").notNull(),
  phone:       text("phone"),
  notes:       text("notes"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

// Chronological events — auto-inserted (crash_detected, video_saved, photo_added)
// and driver-triggered (report_generated, statement_added).
export const accidentTimelineEventsTable = pgTable("accident_timeline_events", {
  id:           text("id").primaryKey().$defaultFn(genId),
  accidentId:   text("accident_id").notNull(),
  eventType:    text("event_type").notNull(),
  description:  text("description"),
  occurredAt:   timestamp("occurred_at").notNull(),
  metadataJson: text("metadata_json"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});
