/**
 * RouteSearchSheet — Search Along Route
 *
 * Queries the Overpass API for amenities near the driver's current position
 * (with a radius scaled to the remaining route length), then sorts results
 * by projected distance ahead on the route.
 *
 * Query strategy mirrors browse.tsx:
 *  • `around:` radius instead of bounding box — avoids bbox-induced timeouts
 *    on long routes (Nairobi→Mombasa bbox is 400 km × 200 km).
 *  • Explicit equality filters instead of regex — Overpass can use value
 *    indices for these; regex forces a full table scan and reliably times out.
 *  • 3 mirrors tried sequentially so one outage doesn't kill the feature.
 *  • User-Agent header to avoid bot-detection rate-limiting.
 */

import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp, RouteCoord } from "@/context/AppContext";
import { fetchWithTimeout } from "@/utils/fetchTimeout";

// ── Geometry helpers ──────────────────────────────────────────────────────────

function hav(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

function routeTotalLengthM(coords: RouteCoord[]): number {
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    total += hav(coords[i].latitude, coords[i].longitude, coords[i + 1].latitude, coords[i + 1].longitude);
  }
  return total;
}

/** Project a point onto the route polyline.
 *  Returns distAheadM > 0 = ahead, < 0 = behind driver. */
function projectAhead(
  coords: RouteCoord[],
  currentLat: number,
  currentLng: number,
  pointLat: number,
  pointLng: number,
): number {
  // Cumulative distances from polyline start
  const cumDist: number[] = [0];
  for (let i = 0; i < coords.length - 1; i++) {
    cumDist.push(cumDist[i] + hav(coords[i].latitude, coords[i].longitude, coords[i + 1].latitude, coords[i + 1].longitude));
  }

  // Segment closest to driver
  let driverIdx = 0, minDriverD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = hav(currentLat, currentLng, coords[i].latitude, coords[i].longitude);
    if (d < minDriverD) { minDriverD = d; driverIdx = i; }
  }
  const driverDist = cumDist[driverIdx] + hav(coords[driverIdx].latitude, coords[driverIdx].longitude, currentLat, currentLng);

  // Segment closest to POI
  let poiIdx = 0, minPoiD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = hav(pointLat, pointLng, coords[i].latitude, coords[i].longitude);
    if (d < minPoiD) { minPoiD = d; poiIdx = i; }
  }
  const poiDist = cumDist[poiIdx] + hav(coords[poiIdx].latitude, coords[poiIdx].longitude, pointLat, pointLng);

  return poiDist - driverDist;
}

// ── Overpass ──────────────────────────────────────────────────────────────────

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];

const OVERPASS_QUERY_TIMEOUT_S = 20;
const FETCH_TIMEOUT_MS         = Platform.OS === "android" ? 22_000 : 15_000;

const REQ_INIT: RequestInit = {
  method: "GET",
  headers: {
    "User-Agent": "MsafiriKenya/1.0 (Expo; mobile)",
    "Accept": "application/json",
  },
};

type QueryCategory =
  | "fuel" | "food" | "hospital" | "pharmacy" | "shopping"
  | "bank_atm" | "police" | "parking" | "hotel" | "toilets";

interface CategoryDef {
  label: string;
  color: string;
  chip?: string; // short chip label
  filters: string; // raw Overpass node/way lines (placeholder {r} {lat} {lng})
  defaultName: string;
}

const CATEGORIES: Record<QueryCategory, CategoryDef> = {
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
    label: "Shop / Supermarket", color: "#1565C0", chip: "Shops",
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
    label: "Bank / ATM", color: "#6A1B9A", chip: "ATM",
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
};

// Keyword → category mapping. Checked in order; first match wins.
const KEYWORD_MAP: Array<{ words: string[]; cat: QueryCategory }> = [
  { words: ["fuel", "petrol", "gas", "station", "shell", "total", "rubis", "kenol", "oilLibya", "astrol"], cat: "fuel" },
  { words: ["food", "eat", "restaurant", "fast food", "cafe", "coffee", "lunch", "dinner", "breakfast", "nyama"], cat: "food" },
  { words: ["hospital", "emergency", "clinic", "doctor", "health", "medical", "dispensary"], cat: "hospital" },
  { words: ["pharmacy", "chemist", "medicine", "drug", "prescription"], cat: "pharmacy" },
  { words: ["shop", "shopping", "supermarket", "market", "mall", "store", "groceries", "naivas", "quickmart", "carrefour"], cat: "shopping" },
  { words: ["atm", "bank", "cash", "mpesa", "equity", "kcb", "co-op", "stanbic", "absa"], cat: "bank_atm" },
  { words: ["police", "cop", "station", "security"], cat: "police" },
  { words: ["parking", "park", "park here"], cat: "parking" },
  { words: ["hotel", "lodge", "accommodation", "sleep", "stay", "motel", "inn", "airbnb", "guest house"], cat: "hotel" },
  { words: ["toilet", "toilets", "restroom", "bathroom", "wc", "loo"], cat: "toilets" },
];

function resolveCategory(query: string): QueryCategory | null {
  const q = query.toLowerCase().trim();
  for (const { words, cat } of KEYWORD_MAP) {
    if (words.some((w) => q.includes(w))) return cat;
  }
  return null;
}

function buildQuery(cat: QueryCategory, lat: number, lng: number, radiusM: number): string {
  const r = Math.round(radiusM);
  const filters = CATEGORIES[cat].filters
    .replace(/\{r\}/g, String(r))
    .replace(/\{lat\}/g, String(lat))
    .replace(/\{lng\}/g, String(lng));
  return `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];(${filters});out center 40;`;
}

interface RawElement {
  id: number;
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface POIResult {
  id: number;
  name: string;
  subtype: string;
  subtypeColor: string;
  address: string;
  lat: number;
  lng: number;
  distAheadM: number;
}

async function queryOverpass(cat: QueryCategory, lat: number, lng: number, radiusM: number): Promise<RawElement[]> {
  const query = buildQuery(cat, lat, lng, radiusM);
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

function formatDistAhead(m: number): string {
  if (m < 1000) return `${Math.round(m / 50) * 50 || 50} m ahead`;
  return `${(m / 1000).toFixed(1)} km ahead`;
}

function formatDistNearby(m: number): string {
  if (m < 1000) return `${Math.round(m / 50) * 50 || 50} m away`;
  return `${(m / 1000).toFixed(1)} km away`;
}

function etaMin(distM: number, speedKmh: number): number {
  return Math.round((distM / 1000) / Math.max(speedKmh, 30) * 60);
}

// ── Quick-access chips ────────────────────────────────────────────────────────

const CHIPS: Array<{ label: string; cat: QueryCategory }> = [
  { label: "⛽ Fuel",       cat: "fuel"      },
  { label: "🍽️ Food",       cat: "food"      },
  { label: "🏥 Hospital",   cat: "hospital"  },
  { label: "💊 Pharmacy",   cat: "pharmacy"  },
  { label: "🏦 ATM / Bank", cat: "bank_atm"  },
  { label: "🛒 Shopping",   cat: "shopping"  },
  { label: "🏨 Hotel",      cat: "hotel"     },
  { label: "🅿️ Parking",   cat: "parking"   },
];

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (item: { name: string; lat: number; lng: number }) => void;
}

export default function RouteSearchSheet({ visible, onClose, onSelect }: Props) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { activeRoute, currentLat, currentLng, currentSpeed } = useApp();

  const [query, setQuery]     = useState("");
  const [results, setResults] = useState<POIResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [activeChip, setActiveChip] = useState<QueryCategory | null>(null);
  const inputRef = useRef<TextInput>(null);

  const isDark = c.isDark;

  const runSearch = useCallback(async (q: string, forceCat?: QueryCategory) => {
    // Require location; a route is optional — without one we search by proximity.
    if (currentLat == null || currentLng == null) return;

    const cat = forceCat ?? resolveCategory(q);
    if (!cat) {
      setError("Try one of the category buttons below, or search for: fuel, food, hospital, ATM, hotel…");
      setSearched(true);
      return;
    }

    setLoading(true);
    setError(null);
    setSearched(false);

    try {
      let radiusM: number;
      if (activeRoute) {
        // Route active: 40% of remaining route length, min 8 km, max 35 km.
        const routeLen = routeTotalLengthM(activeRoute.coords);
        radiusM = Math.min(Math.max(routeLen * 0.4, 8_000), 35_000);
      } else {
        // No active route: 5 km proximity search around current location.
        radiusM = 5_000;
      }

      const elements = await queryOverpass(cat, currentLat, currentLng, radiusM);
      const catDef = CATEGORIES[cat];

      const found: POIResult[] = [];
      for (const el of elements) {
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        if (lat == null || lng == null) continue;
        const tags    = el.tags ?? {};
        const name    = tags.name || tags["name:en"] || tags.brand || tags.operator || catDef.defaultName;
        const address = [
          tags["addr:housenumber"],
          tags["addr:street"],
          tags["addr:city"] || tags["addr:suburb"],
        ].filter(Boolean).join(", ");

        let distAheadM: number;
        if (activeRoute) {
          // Project onto route polyline — negative means behind the driver.
          distAheadM = projectAhead(activeRoute.coords, currentLat, currentLng, lat, lng);
          if (distAheadM < -500) continue; // skip if >500 m behind
        } else {
          // No route — straight-line distance from current location.
          distAheadM = hav(currentLat, currentLng, lat, lng);
        }

        found.push({
          id: el.id,
          name,
          subtype: catDef.label,
          subtypeColor: catDef.color,
          address,
          lat,
          lng,
          distAheadM,
        });
      }

      found.sort((a, b) => a.distAheadM - b.distAheadM);
      setResults(found.slice(0, 25));
      setSearched(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Search failed";
      const isConnErr = msg.toLowerCase().includes("network") ||
                        msg.toLowerCase().includes("timeout") ||
                        msg.toLowerCase().includes("abort") ||
                        msg.toLowerCase().includes("failed to fetch");
      setError(isConnErr
        ? "Could not reach the search service. Check your data connection."
        : "Search failed. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, [activeRoute, currentLat, currentLng]);

  const handleSearch = () => {
    Keyboard.dismiss();
    setActiveChip(null);
    runSearch(query);
  };

  const handleChip = (cat: QueryCategory, label: string) => {
    Keyboard.dismiss();
    setQuery(label.replace(/^[^\w]+/, "").trim()); // strip leading emoji
    setActiveChip(cat);
    runSearch("", cat);
  };

  const handleClose = () => {
    Keyboard.dismiss();
    setQuery("");
    setResults([]);
    setSearched(false);
    setError(null);
    setActiveChip(null);
    onClose();
  };

  const speedKmh = currentSpeed ?? 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={handleClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.kav}
      >
        <View style={[styles.sheet, {
          backgroundColor: c.card,
          paddingBottom: insets.bottom + 12,
        }]}>
          <View style={[styles.grabber, { backgroundColor: c.border }]} />

          {/* Header */}
          <View style={styles.header}>
            <Ionicons name="search" size={18} color={c.mutedForeground} />
            <Text style={[styles.headerTitle, { color: c.foreground }]}>
              {activeRoute ? "Search Along Route" : "Find Nearby"}
            </Text>
            <TouchableOpacity onPress={handleClose} hitSlop={10}>
              <Ionicons name="close" size={20} color={c.mutedForeground} />
            </TouchableOpacity>
          </View>

          {/* Search input */}
          <View style={[styles.inputRow, {
            backgroundColor: isDark ? "#FFFFFF0F" : "#00000009",
            borderColor: c.border,
          }]}>
            <TextInput
              ref={inputRef}
              style={[styles.input, { color: c.foreground }]}
              placeholder="fuel, ATM, restaurant, hotel…"
              placeholderTextColor={c.mutedForeground}
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={[styles.searchBtn, { backgroundColor: c.primary }]}
              onPress={handleSearch}
              activeOpacity={0.85}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator size="small" color="#FFF" />
                : <Ionicons name="search" size={16} color="#FFF" />
              }
            </TouchableOpacity>
          </View>

          {/* Category chips */}
          <View style={styles.chips}>
            {CHIPS.map(({ label, cat }) => {
              const isActive = activeChip === cat;
              const catColor = CATEGORIES[cat].color;
              return (
                <TouchableOpacity
                  key={cat}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: isActive ? catColor + "22" : (isDark ? "#FFFFFF10" : "#00000009"),
                      borderColor: isActive ? catColor : c.border,
                    },
                  ]}
                  onPress={() => handleChip(cat, label)}
                  activeOpacity={0.72}
                  disabled={loading}
                >
                  <Text style={[styles.chipTxt, { color: isActive ? catColor : c.foreground }]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Error */}
          {error && !loading && (
            <View style={styles.emptyState}>
              <Ionicons name="cloud-offline-outline" size={28} color={c.mutedForeground} />
              <Text style={[styles.emptyTxt, { color: c.mutedForeground }]}>{error}</Text>
            </View>
          )}

          {/* Empty results */}
          {searched && !loading && !error && results.length === 0 && (
            <View style={styles.emptyState}>
              <Ionicons name="locate-outline" size={28} color={c.mutedForeground} />
              <Text style={[styles.emptyTxt, { color: c.mutedForeground }]}>
                {activeRoute ? "Nothing found along this route." : "Nothing found nearby."}
              </Text>
            </View>
          )}

          {/* Results list */}
          {results.length > 0 && (
            <FlatList
              data={results}
              keyExtractor={(item) => String(item.id)}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const dist = Math.max(0, item.distAheadM);
                const eta  = etaMin(dist, speedKmh);
                return (
                  <TouchableOpacity
                    style={[styles.card, {
                      backgroundColor: c.background,
                      borderColor: c.border,
                    }]}
                    activeOpacity={0.72}
                    onPress={() => onSelect({ name: item.name, lat: item.lat, lng: item.lng })}
                  >
                    {/* Icon */}
                    <View style={[styles.cardIcon, { backgroundColor: item.subtypeColor + "20" }]}>
                      <CategoryIcon cat={activeChip ?? resolveCategory(item.subtype.toLowerCase()) ?? "food"} color={item.subtypeColor} />
                    </View>

                    {/* Name + address */}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.cardName, { color: c.foreground }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={[styles.cardSub, { color: item.subtypeColor }]} numberOfLines={1}>
                        {item.subtype}
                      </Text>
                      {!!item.address && (
                        <Text style={[styles.cardAddr, { color: c.mutedForeground }]} numberOfLines={1}>
                          {item.address}
                        </Text>
                      )}
                    </View>

                    {/* Distance + Go */}
                    <View style={styles.cardRight}>
                      <Text style={[styles.cardDist, { color: item.subtypeColor }]}>
                        {activeRoute ? formatDistAhead(dist) : formatDistNearby(dist)}
                      </Text>
                      {speedKmh > 5 && (
                        <Text style={[styles.cardEta, { color: c.mutedForeground }]}>
                          ~{eta} min
                        </Text>
                      )}
                      <View style={[styles.goBtn, { backgroundColor: item.subtypeColor }]}>
                        <Ionicons name="navigate" size={11} color="#FFF" />
                        <Text style={styles.goBtnTxt}>Go</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Small icon helper so cards show the right icon per category
function CategoryIcon({ cat, color }: { cat: QueryCategory; color: string }) {
  const sz = 20;
  switch (cat) {
    case "fuel":     return <MaterialCommunityIcons name="gas-station" size={sz} color={color} />;
    case "food":     return <Ionicons name="restaurant-outline" size={sz} color={color} />;
    case "hospital": return <Ionicons name="medkit-outline" size={sz} color={color} />;
    case "pharmacy": return <Ionicons name="medical-outline" size={sz} color={color} />;
    case "shopping": return <Ionicons name="storefront-outline" size={sz} color={color} />;
    case "bank_atm": return <Ionicons name="card-outline" size={sz} color={color} />;
    case "police":   return <Ionicons name="shield-outline" size={sz} color={color} />;
    case "parking":  return <Ionicons name="car-outline" size={sz} color={color} />;
    case "hotel":    return <Ionicons name="bed-outline" size={sz} color={color} />;
    case "toilets":  return <Ionicons name="water-outline" size={sz} color={color} />;
    default:         return <Ionicons name="location-outline" size={sz} color={color} />;
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#00000060" },
  kav:      { justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    maxHeight: "85%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 22,
  },
  grabber: {
    width: 40, height: 4, borderRadius: 2,
    alignSelf: "center", marginBottom: 14,
  },
  header: {
    flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12,
  },
  headerTitle: { flex: 1, fontSize: 16, fontFamily: "Inter_700Bold" },
  inputRow: {
    flexDirection: "row", alignItems: "center",
    borderRadius: 14, borderWidth: 1,
    paddingLeft: 14, paddingRight: 6, paddingVertical: 6,
    gap: 8, marginBottom: 12,
  },
  input: {
    flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", paddingVertical: 6,
  },
  searchBtn: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  chips: {
    flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 12,
  },
  chip: {
    paddingHorizontal: 11, paddingVertical: 6,
    borderRadius: 14, borderWidth: 1,
  },
  chipTxt: { fontSize: 12, fontFamily: "Inter_500Medium" },
  emptyState: {
    alignItems: "center", gap: 8, paddingVertical: 32,
  },
  emptyTxt: {
    fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center",
    paddingHorizontal: 16,
  },
  list: { marginTop: 2 },

  // ── Result card (matches browse page POICard style) ─────────────────────────
  card: {
    flexDirection: "row", alignItems: "center",
    marginBottom: 8, padding: 12,
    borderRadius: 14, borderWidth: 1, gap: 10,
  },
  cardIcon: {
    width: 42, height: 42, borderRadius: 12,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  cardName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  cardSub:  { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 1 },
  cardAddr: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  cardRight: { alignItems: "flex-end", gap: 4, flexShrink: 0 },
  cardDist: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  cardEta:  { fontSize: 10, fontFamily: "Inter_400Regular" },
  goBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20,
  },
  goBtnTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#FFF" },
});
