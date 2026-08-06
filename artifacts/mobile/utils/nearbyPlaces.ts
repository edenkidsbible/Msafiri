/**
 * Shared nearby-places query logic.
 * Used by RouteSearchSheet (full-modal search) and MapViewScreen (inline chip results).
 */

import { Platform } from "react-native";
import { fetchWithTimeout } from "@/utils/fetchTimeout";

// ── Types ────────────────────────────────────────────────────────────────────

export type QueryCategory =
  | "fuel" | "food" | "hospital" | "pharmacy" | "shopping"
  | "bank_atm" | "police" | "parking" | "hotel" | "toilets"
  | "nightlife" | "gym";

export interface CategoryDef {
  label: string;
  color: string;
  chip?: string;
  filters: string;  // Overpass node/way lines with {r} {lat} {lng} placeholders
  defaultName: string;
}

export interface POIResult {
  id: string | number;
  name: string;
  subtype: string;
  subtypeColor: string;
  address: string;
  lat: number;
  lng: number;
  distAheadM: number;
}

interface RawElement {
  id: number;
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

// ── Category definitions ─────────────────────────────────────────────────────

export const CATEGORIES: Record<QueryCategory, CategoryDef> = {
  fuel: {
    label: "Fuel Station", color: "#2E7D32", chip: "Fuel",
    filters: `node["amenity"="fuel"](around:{r},{lat},{lng});way["amenity"="fuel"](around:{r},{lat},{lng});`,
    defaultName: "Fuel Station",
  },
  food: {
    label: "Restaurant / Café", color: "#BF360C", chip: "Food",
    filters:
      `node["amenity"="restaurant"](around:{r},{lat},{lng});` +
      `node["amenity"="fast_food"](around:{r},{lat},{lng});` +
      `node["amenity"="cafe"](around:{r},{lat},{lng});` +
      `way["amenity"="restaurant"](around:{r},{lat},{lng});` +
      `way["amenity"="fast_food"](around:{r},{lat},{lng});`,
    defaultName: "Restaurant",
  },
  hospital: {
    label: "Hospital / Clinic", color: "#C62828", chip: "Hospital",
    filters:
      `node["amenity"="hospital"](around:{r},{lat},{lng});` +
      `node["amenity"="clinic"](around:{r},{lat},{lng});` +
      `node["amenity"="doctors"](around:{r},{lat},{lng});` +
      `node["amenity"="health_centre"](around:{r},{lat},{lng});` +
      `way["amenity"="hospital"](around:{r},{lat},{lng});` +
      `way["amenity"="clinic"](around:{r},{lat},{lng});`,
    defaultName: "Hospital / Clinic",
  },
  pharmacy: {
    label: "Pharmacy", color: "#00838F", chip: "Pharmacy",
    filters:
      `node["amenity"="pharmacy"](around:{r},{lat},{lng});` +
      `way["amenity"="pharmacy"](around:{r},{lat},{lng});`,
    defaultName: "Pharmacy",
  },
  shopping: {
    label: "Shop / Supermarket", color: "#1565C0", chip: "Shopping",
    filters:
      `node["shop"="supermarket"](around:{r},{lat},{lng});` +
      `node["shop"="convenience"](around:{r},{lat},{lng});` +
      `node["shop"="mall"](around:{r},{lat},{lng});` +
      `node["amenity"="marketplace"](around:{r},{lat},{lng});` +
      `way["shop"="supermarket"](around:{r},{lat},{lng});` +
      `way["shop"="mall"](around:{r},{lat},{lng});` +
      `way["amenity"="marketplace"](around:{r},{lat},{lng});`,
    defaultName: "Shop",
  },
  bank_atm: {
    label: "Bank / ATM", color: "#6A1B9A", chip: "ATM/Bank",
    filters:
      `node["amenity"="bank"](around:{r},{lat},{lng});` +
      `node["amenity"="atm"](around:{r},{lat},{lng});` +
      `way["amenity"="bank"](around:{r},{lat},{lng});`,
    defaultName: "Bank / ATM",
  },
  police: {
    label: "Police Station", color: "#1A237E", chip: "Police",
    filters:
      `node["amenity"="police"](around:{r},{lat},{lng});` +
      `way["amenity"="police"](around:{r},{lat},{lng});`,
    defaultName: "Police Station",
  },
  parking: {
    label: "Parking", color: "#37474F", chip: "Parking",
    filters:
      `node["amenity"="parking"](around:{r},{lat},{lng});` +
      `way["amenity"="parking"](around:{r},{lat},{lng});`,
    defaultName: "Parking",
  },
  hotel: {
    label: "Hotel / Lodge", color: "#4A148C", chip: "Hotel",
    filters:
      `node["tourism"="hotel"](around:{r},{lat},{lng});` +
      `node["tourism"="guest_house"](around:{r},{lat},{lng});` +
      `node["tourism"="motel"](around:{r},{lat},{lng});` +
      `way["tourism"="hotel"](around:{r},{lat},{lng});` +
      `way["tourism"="guest_house"](around:{r},{lat},{lng});`,
    defaultName: "Hotel",
  },
  toilets: {
    label: "Toilets", color: "#546E7A",
    filters: `node["amenity"="toilets"](around:{r},{lat},{lng});`,
    defaultName: "Toilets",
  },
  nightlife: {
    label: "Nightlife", color: "#6A0572", chip: "Nightlife",
    filters:
      `node["amenity"="bar"](around:{r},{lat},{lng});` +
      `node["amenity"="nightclub"](around:{r},{lat},{lng});` +
      `node["amenity"="pub"](around:{r},{lat},{lng});` +
      `way["amenity"="bar"](around:{r},{lat},{lng});` +
      `way["amenity"="nightclub"](around:{r},{lat},{lng});`,
    defaultName: "Bar / Nightclub",
  },
  gym: {
    label: "Gym / Fitness", color: "#1565C0", chip: "Gym",
    filters:
      `node["leisure"="fitness_centre"](around:{r},{lat},{lng});` +
      `node["leisure"="sports_centre"](around:{r},{lat},{lng});` +
      `node["amenity"="gym"](around:{r},{lat},{lng});` +
      `way["leisure"="fitness_centre"](around:{r},{lat},{lng});` +
      `way["leisure"="sports_centre"](around:{r},{lat},{lng});`,
    defaultName: "Gym",
  },
};

// ── Chip list (the 10 shown on map) ─────────────────────────────────────────

export const MAP_CHIPS: Array<{ cat: QueryCategory; label: string; icon: string }> = [
  { cat: "fuel",     label: "Fuel",     icon: "flame-outline" },
  { cat: "food",     label: "Food",     icon: "restaurant-outline" },
  { cat: "hospital", label: "Hospital", icon: "medkit-outline" },
  { cat: "pharmacy", label: "Pharmacy", icon: "medical-outline" },
  { cat: "bank_atm", label: "ATM/Bank", icon: "card-outline" },
  { cat: "shopping", label: "Shopping", icon: "bag-handle-outline" },
  { cat: "parking",  label: "Parking",  icon: "car-outline" },
  { cat: "hotel",    label: "Hotel",    icon: "bed-outline" },
  { cat: "nightlife",label: "Nightlife",icon: "wine-outline" },
  { cat: "gym",      label: "Gym",      icon: "fitness-outline" },
];

// ── Keyword → category mapper ────────────────────────────────────────────────

const KEYWORD_MAP: Array<{ words: string[]; cat: QueryCategory }> = [
  { words: ["fuel", "petrol", "gas", "station", "shell", "total", "rubis", "kenol", "oilLibya", "astrol"], cat: "fuel" },
  { words: ["food", "eat", "restaurant", "fast food", "cafe", "coffee", "lunch", "dinner", "breakfast", "nyama"], cat: "food" },
  { words: ["hospital", "emergency", "clinic", "doctor", "health", "medical", "dispensary"], cat: "hospital" },
  { words: ["pharmacy", "chemist", "medicine", "drug", "prescription"], cat: "pharmacy" },
  { words: ["shop", "shopping", "supermarket", "market", "mall", "store", "groceries", "naivas", "quickmart", "carrefour"], cat: "shopping" },
  { words: ["atm", "bank", "cash", "mpesa", "equity", "kcb", "co-op", "stanbic", "absa"], cat: "bank_atm" },
  { words: ["police", "cop", "station", "security"], cat: "police" },
  { words: ["parking", "park here"], cat: "parking" },
  { words: ["hotel", "lodge", "accommodation", "sleep", "stay", "motel", "inn", "airbnb", "guest house"], cat: "hotel" },
  { words: ["toilet", "toilets", "restroom", "bathroom", "wc", "loo"], cat: "toilets" },
  { words: ["nightlife", "bar", "pub", "club", "nightclub", "drinks", "lounge", "cocktail", "beer", "wine", "spirits"], cat: "nightlife" },
  { words: ["gym", "fitness", "workout", "exercise", "crossfit", "yoga", "pilates", "weights", "swimming", "pool"], cat: "gym" },
];

export function resolveCategory(query: string): QueryCategory | null {
  const q = query.toLowerCase().trim();
  for (const { words, cat } of KEYWORD_MAP) {
    if (words.some((w) => q.includes(w))) return cat;
  }
  return null;
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

export function hav(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function projectAhead(
  coords: Array<{ latitude: number; longitude: number }>,
  currentLat: number,
  currentLng: number,
  pointLat: number,
  pointLng: number,
): number {
  const cumDist: number[] = [0];
  for (let i = 0; i < coords.length - 1; i++) {
    cumDist.push(cumDist[i] + hav(coords[i].latitude, coords[i].longitude, coords[i + 1].latitude, coords[i + 1].longitude));
  }
  let driverIdx = 0, minDriverD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = hav(currentLat, currentLng, coords[i].latitude, coords[i].longitude);
    if (d < minDriverD) { minDriverD = d; driverIdx = i; }
  }
  const driverDist = cumDist[driverIdx] + hav(coords[driverIdx].latitude, coords[driverIdx].longitude, currentLat, currentLng);
  let poiIdx = 0, minPoiD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = hav(pointLat, pointLng, coords[i].latitude, coords[i].longitude);
    if (d < minPoiD) { minPoiD = d; poiIdx = i; }
  }
  const poiDist = cumDist[poiIdx] + hav(coords[poiIdx].latitude, coords[poiIdx].longitude, pointLat, pointLng);
  return poiDist - driverDist;
}

// ── Query helpers ────────────────────────────────────────────────────────────

const GOOGLE_FETCH_TIMEOUT_MS = 9_000;
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];
const OVERPASS_QUERY_TIMEOUT_S = 20;
const FETCH_TIMEOUT_MS = Platform.OS === "android" ? 22_000 : 15_000;
const REQ_INIT: RequestInit = {
  method: "GET",
  headers: {
    "User-Agent": "MsafiriKenya/1.0 (Expo; mobile)",
    "Accept": "application/json",
  },
};

function buildQuery(cat: QueryCategory, lat: number, lng: number, radiusM: number): string {
  const r = Math.round(radiusM);
  const filters = CATEGORIES[cat].filters
    .replace(/\{r\}/g, String(r))
    .replace(/\{lat\}/g, String(lat))
    .replace(/\{lng\}/g, String(lng));
  return `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];(${filters});out center 40;`;
}

export async function queryGoogleNearby(
  cat: QueryCategory, lat: number, lng: number, radiusM: number,
): Promise<Array<{ place_id: string; name: string; formatted_address: string; geometry: { location: { lat: number; lng: number } } }>> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN ?? "";
  const base   = domain ? `https://${domain}/api` : "/api";
  const url = `${base}/places/nearby?lat=${lat}&lng=${lng}&radius=${Math.round(radiusM)}&category=${cat}`;
  const res  = await fetchWithTimeout(url, {}, GOOGLE_FETCH_TIMEOUT_MS);
  if (!res.ok) throw new Error(`nearby HTTP ${res.status}`);
  const data = await res.json() as { results?: any[]; error?: string };
  if (data.error) throw new Error(data.error);
  return data.results ?? [];
}

export async function queryOverpass(cat: QueryCategory, lat: number, lng: number, radiusM: number): Promise<RawElement[]> {
  const query   = buildQuery(cat, lat, lng, radiusM);
  const encoded = encodeURIComponent(query);
  let lastErr: unknown;
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const res = await fetchWithTimeout(`${mirror}?data=${encoded}`, REQ_INIT, FETCH_TIMEOUT_MS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { elements: RawElement[] };
      return data.elements;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("All Overpass mirrors failed");
}

/** Full pipeline: Google first, Overpass fallback. Returns up to `limit` sorted results. */
export async function fetchNearbyPOIs(
  cat: QueryCategory,
  lat: number,
  lng: number,
  route: Array<{ latitude: number; longitude: number }> | null,
  limit = 25,
): Promise<POIResult[]> {
  const radiusM = route
    ? Math.min(Math.max(route.reduce((acc, _, i, a) => i === 0 ? 0 : acc + hav(a[i - 1].latitude, a[i - 1].longitude, a[i].latitude, a[i].longitude), 0) * 0.4, 8_000), 35_000)
    : 5_000;

  const catDef = CATEGORIES[cat];
  let found: POIResult[] = [];
  let usedGoogle = false;

  try {
    const googleResults = await queryGoogleNearby(cat, lat, lng, radiusM);
    if (googleResults.length > 0) {
      usedGoogle = true;
      let idCounter = 100_000;
      for (const r of googleResults) {
        const rlat = r.geometry?.location?.lat;
        const rlng = r.geometry?.location?.lng;
        if (rlat == null || rlng == null) continue;
        let distAheadM: number;
        if (route) {
          distAheadM = projectAhead(route, lat, lng, rlat, rlng);
          if (distAheadM < -500) continue;
        } else {
          distAheadM = hav(lat, lng, rlat, rlng);
        }
        found.push({
          id: r.place_id ? (`g_${r.place_id}` as unknown as number) : idCounter++,
          name: r.name || catDef.defaultName,
          subtype: catDef.label,
          subtypeColor: catDef.color,
          address: r.formatted_address ?? "",
          lat: rlat,
          lng: rlng,
          distAheadM,
        });
      }
    }
  } catch { /* fall through to Overpass */ }

  if (!usedGoogle) {
    const elements = await queryOverpass(cat, lat, lng, radiusM);
    for (const el of elements) {
      const rlat = el.lat ?? el.center?.lat;
      const rlng = el.lon ?? el.center?.lon;
      if (rlat == null || rlng == null) continue;
      const tags    = el.tags ?? {};
      const name    = tags.name || tags["name:en"] || tags.brand || tags.operator || catDef.defaultName;
      const address = [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"] || tags["addr:suburb"]].filter(Boolean).join(", ");
      let distAheadM: number;
      if (route) {
        distAheadM = projectAhead(route, lat, lng, rlat, rlng);
        if (distAheadM < -500) continue;
      } else {
        distAheadM = hav(lat, lng, rlat, rlng);
      }
      found.push({ id: el.id, name, subtype: catDef.label, subtypeColor: catDef.color, address, lat: rlat, lng: rlng, distAheadM });
    }
  }

  found.sort((a, b) => a.distAheadM - b.distAheadM);
  return found.slice(0, limit);
}

export function formatDist(m: number, hasRoute: boolean): string {
  const dist = Math.max(0, m);
  const label = dist < 1000 ? `${Math.round(dist / 50) * 50 || 50} m` : `${(dist / 1000).toFixed(1)} km`;
  return hasRoute ? `${label} ahead` : `${label} away`;
}
