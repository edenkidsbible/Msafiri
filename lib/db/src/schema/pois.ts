import { pgTable, uuid, text, doublePrecision, timestamp } from "drizzle-orm/pg-core";

export const poisTable = pgTable("pois", {
  id:        uuid("id").primaryKey().defaultRandom(),
  name:      text("name").notNull(),
  brand:     text("brand").notNull(),
  type:      text("type").notNull(),           // fuel|food|shopping|hospital
  lat:       doublePrecision("lat").notNull(),
  lng:       doublePrecision("lng").notNull(),
  address:   text("address").notNull(),
  hours:     text("hours"),
  status:    text("status").notNull().default("active"), // active|inactive
  staticId:  text("static_id"),                // original id from static pois.ts — used for dedup on re-seed
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type PoiRow = typeof poisTable.$inferSelect;
