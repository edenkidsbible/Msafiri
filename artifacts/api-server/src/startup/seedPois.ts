/**
 * seedPois.ts — populate the `pois` table from the bundled static list on
 * first boot.  Safe to re-run: skips entirely if any row already exists.
 * Existing rows (even if deactivated) are never overwritten, so admin edits
 * survive a server restart.
 */

import { db, poisTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const STATIC_POIS = [
  // Fuel — Shell
  { staticId: "p001", name: "Shell Westlands",    brand: "Shell", type: "fuel", lat: -1.2673, lng: 36.81,   address: "Westlands, Nairobi",        hours: "24hrs" },
  { staticId: "p002", name: "Shell Upper Hill",   brand: "Shell", type: "fuel", lat: -1.294,  lng: 36.817,  address: "Upper Hill, Nairobi",       hours: "24hrs" },
  { staticId: "p003", name: "Shell Mombasa Road", brand: "Shell", type: "fuel", lat: -1.334,  lng: 36.886,  address: "Mombasa Road, Nairobi",     hours: "24hrs" },
  { staticId: "p004", name: "Shell Karen",        brand: "Shell", type: "fuel", lat: -1.355,  lng: 36.713,  address: "Karen, Nairobi",            hours: "24hrs" },
  { staticId: "p005", name: "Shell Nakuru",        brand: "Shell", type: "fuel", lat: -0.3031, lng: 36.08,   address: "Nakuru Town",               hours: "24hrs" },
  { staticId: "p006", name: "Shell Kisumu",        brand: "Shell", type: "fuel", lat: -0.1,    lng: 34.76,   address: "Oginga Odinga St, Kisumu",  hours: "24hrs" },
  // Fuel — TotalEnergies
  { staticId: "p007", name: "Total – Thika Road", brand: "Total", type: "fuel", lat: -1.21,   lng: 36.89,   address: "Thika Road, Nairobi",       hours: "24hrs" },
  { staticId: "p008", name: "Total – Ngong Road", brand: "Total", type: "fuel", lat: -1.301,  lng: 36.77,   address: "Ngong Road, Nairobi",       hours: "24hrs" },
  { staticId: "p009", name: "Total Naivasha",      brand: "Total", type: "fuel", lat: -0.7167, lng: 36.4311, address: "Naivasha Town",             hours: "6am–10pm" },
  { staticId: "p010", name: "Total Mombasa",       brand: "Total", type: "fuel", lat: -4.0435, lng: 39.6682, address: "Moi Avenue, Mombasa",       hours: "24hrs" },
  { staticId: "p011", name: "Total Eldoret",       brand: "Total", type: "fuel", lat: 0.5145,  lng: 35.27,   address: "Eldoret Town",              hours: "24hrs" },
  // Fuel — Rubis / OiLibya
  { staticId: "p012", name: "Rubis – Mombasa Road", brand: "Rubis",   type: "fuel", lat: -1.315,  lng: 36.9,   address: "Mombasa Road, Nairobi", hours: "24hrs" },
  { staticId: "p013", name: "Rubis – Waiyaki Way",  brand: "Rubis",   type: "fuel", lat: -1.275,  lng: 36.78,  address: "Waiyaki Way, Nairobi",  hours: "24hrs" },
  { staticId: "p014", name: "OiLibya – Thika Road", brand: "OiLibya", type: "fuel", lat: -1.24,   lng: 36.899, address: "Thika Road, Nairobi",   hours: "24hrs" },
  // Food — Java House
  { staticId: "p015", name: "Java House – Sarit Centre",  brand: "Java House", type: "food", lat: -1.27,   lng: 36.8107, address: "Sarit Centre, Westlands",     hours: "7am–10pm" },
  { staticId: "p016", name: "Java House – Junction Mall", brand: "Java House", type: "food", lat: -1.2921, lng: 36.778,  address: "Junction Mall, Ngong Road",   hours: "7am–10pm" },
  { staticId: "p017", name: "Java House – Upper Hill",    brand: "Java House", type: "food", lat: -1.299,  lng: 36.821,  address: "Upper Hill, Nairobi",         hours: "7am–9pm" },
  { staticId: "p018", name: "Java House – Nakuru",        brand: "Java House", type: "food", lat: -0.304,  lng: 36.081,  address: "Nakuru Town",                 hours: "7am–9pm" },
  // Food — Chicken Inn
  { staticId: "p019", name: "Chicken Inn – Westlands",   brand: "Chicken Inn", type: "food", lat: -1.268,  lng: 36.812,  address: "Westlands, Nairobi",          hours: "9am–10pm" },
  { staticId: "p020", name: "Chicken Inn – Thika Road",  brand: "Chicken Inn", type: "food", lat: -1.22,   lng: 36.887,  address: "Roasters Mall, Thika Road",   hours: "9am–10pm" },
  { staticId: "p021", name: "Chicken Inn – Mombasa",     brand: "Chicken Inn", type: "food", lat: -4.05,   lng: 39.668,  address: "Mombasa Centre",              hours: "9am–10pm" },
  // Food — KFC
  { staticId: "p022", name: "KFC – Sarit Centre",  brand: "KFC", type: "food", lat: -1.2695, lng: 36.8107, address: "Sarit Centre, Westlands",      hours: "10am–10pm" },
  { staticId: "p023", name: "KFC – Junction Mall", brand: "KFC", type: "food", lat: -1.2921, lng: 36.778,  address: "Junction Mall, Nairobi",       hours: "10am–10pm" },
  { staticId: "p024", name: "KFC – Garden City",   brand: "KFC", type: "food", lat: -1.216,  lng: 36.89,   address: "Garden City Mall, Nairobi",    hours: "10am–10pm" },
  // Food — Artcaffe
  { staticId: "p025", name: "Artcaffe – Westgate",     brand: "Artcaffe", type: "food", lat: -1.259, lng: 36.804, address: "Westgate Mall, Westlands",         hours: "7am–9pm" },
  { staticId: "p026", name: "Artcaffe – Garden City",  brand: "Artcaffe", type: "food", lat: -1.216, lng: 36.89,  address: "Garden City Mall, Thika Road",     hours: "7am–9pm" },
];

export async function seedPois(): Promise<void> {
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(poisTable);

  if (count > 0) {
    logger.info({ count }, "seedPois: table already has rows — skipping");
    return;
  }

  await db.insert(poisTable).values(
    STATIC_POIS.map((p) => ({
      name:     p.name,
      brand:    p.brand,
      type:     p.type,
      lat:      p.lat,
      lng:      p.lng,
      address:  p.address,
      hours:    p.hours ?? null,
      status:   "active" as const,
      staticId: p.staticId,
    }))
  );

  logger.info({ count: STATIC_POIS.length }, "seedPois: seeded static POIs into DB");
}
