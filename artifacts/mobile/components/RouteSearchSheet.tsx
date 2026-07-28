/**
 * RouteSearchSheet — #34 Search Along Route
 *
 * Shows a bottom-sheet with a text input that queries the Overpass API for
 * amenities / named places within the active route bounding box, then sorts
 * results by projected distance ahead of the driver.
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
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp, RouteCoord } from "@/context/AppContext";

// ── Simple geometry helpers (self-contained, no AppContext export needed) ─────

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

/** Project a point onto the closest segment of a polyline.
 *  Returns { distAheadM } where distAheadM is positive = ahead, negative = behind. */
function projectAhead(
  coords: RouteCoord[],
  currentLat: number,
  currentLng: number,
  pointLat: number,
  pointLng: number,
): number {
  // Find segment of polyline closest to driver
  let driverSegIdx = 0;
  let minDriverDist = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = hav(currentLat, currentLng, coords[i].latitude, coords[i].longitude);
    if (d < minDriverDist) { minDriverDist = d; driverSegIdx = i; }
  }
  // Cumulative distance from polyline start to driver position
  let driverDistFromStart = 0;
  for (let i = 0; i < driverSegIdx; i++) {
    driverDistFromStart += hav(coords[i].latitude, coords[i].longitude, coords[i + 1].latitude, coords[i + 1].longitude);
  }
  driverDistFromStart += hav(coords[driverSegIdx].latitude, coords[driverSegIdx].longitude, currentLat, currentLng);

  // Find segment of polyline closest to the POI
  let poiSegIdx = 0;
  let minPoiDist = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = hav(pointLat, pointLng, coords[i].latitude, coords[i].longitude);
    if (d < minPoiDist) { minPoiDist = d; poiSegIdx = i; }
  }
  let poiDistFromStart = 0;
  for (let i = 0; i < poiSegIdx; i++) {
    poiDistFromStart += hav(coords[i].latitude, coords[i].longitude, coords[i + 1].latitude, coords[i + 1].longitude);
  }
  poiDistFromStart += hav(coords[poiSegIdx].latitude, coords[poiSegIdx].longitude, pointLat, pointLng);

  return poiDistFromStart - driverDistFromStart;
}

// ── Overpass query helpers ────────────────────────────────────────────────────

interface OverpassElement {
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
  lat: number;
  lng: number;
  distAheadM: number;
}

/** Map common search words to OSM amenity / shop / tourism tags */
function keywordToOverpassFilter(query: string): string {
  const q = query.toLowerCase().trim();
  const exact: Record<string, string> = {
    petrol: '["amenity"="fuel"]',
    fuel:   '["amenity"="fuel"]',
    gas:    '["amenity"="fuel"]',
    atm:    '["amenity"="atm"]',
    bank:   '["amenity"="bank"]',
    hospital: '["amenity"="hospital"]',
    clinic:   '["amenity"="clinic"]',
    pharmacy: '["amenity"="pharmacy"]',
    chemist:  '["amenity"="pharmacy"]',
    police:   '["amenity"="police"]',
    parking:  '["amenity"="parking"]',
    toilet:   '["amenity"="toilets"]',
    toilets:  '["amenity"="toilets"]',
    restaurant: '["amenity"~"restaurant|fast_food"]',
    food:       '["amenity"~"restaurant|fast_food|cafe"]',
    eat:        '["amenity"~"restaurant|fast_food|cafe"]',
    cafe:       '["amenity"="cafe"]',
    coffee:     '["amenity"="cafe"]',
    supermarket: '["shop"="supermarket"]',
    market:      '["shop"~"supermarket|convenience|general"]',
    hotel:  '["tourism"="hotel"]',
    lodge:  '["tourism"~"hotel|motel|guest_house"]',
  };
  if (exact[q]) return exact[q];
  // Generic name/brand search
  return `["name"~"${q}",i]`;
}

function subTypeLabel(tags: Record<string, string> = {}): string {
  const a = tags.amenity ?? tags.shop ?? tags.tourism ?? tags.leisure ?? "";
  const MAP: Record<string, string> = {
    fuel: "Fuel Station", atm: "ATM", bank: "Bank", hospital: "Hospital",
    clinic: "Clinic", pharmacy: "Pharmacy", police: "Police",
    parking: "Parking", toilets: "Toilets", restaurant: "Restaurant",
    fast_food: "Fast Food", cafe: "Café", supermarket: "Supermarket",
    convenience: "Shop", hotel: "Hotel", motel: "Motel", guest_house: "Guest House",
  };
  return MAP[a] ?? (a ? a.charAt(0).toUpperCase() + a.slice(1) : "Place");
}

function formatDistAhead(m: number): string {
  if (m < 1000) return `${Math.round(m / 50) * 50} m ahead`;
  return `${(m / 1000).toFixed(1)} km ahead`;
}

function etaMinutes(distM: number, speedKmh: number): number {
  const effectiveSpeed = Math.max(speedKmh, 30); // assume 30 km/h min
  return Math.round((distM / 1000) / effectiveSpeed * 60);
}

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

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<POIResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  const runSearch = useCallback(async (q: string) => {
    if (!activeRoute || currentLat == null || currentLng == null) return;
    if (!q.trim()) return;

    setLoading(true);
    setError(null);
    setSearched(false);

    try {
      // Build a bounding box from the route coords, capped to ~30 km radius
      const lats = activeRoute.coords.map((c) => c.latitude);
      const lngs = activeRoute.coords.map((c) => c.longitude);
      const south = Math.min(...lats);
      const north = Math.max(...lats);
      const west  = Math.min(...lngs);
      const east  = Math.max(...lngs);
      const bbox = `${south},${west},${north},${east}`;

      const filter = keywordToOverpassFilter(q);
      const overpassQuery = `[out:json][timeout:15];(node${filter}(${bbox});way${filter}(${bbox}););out center 40;`;
      const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;

      const res = await fetch(url, { signal: AbortSignal.timeout(16000) });
      if (!res.ok) throw new Error(`Overpass error ${res.status}`);
      const data = await res.json() as { elements: OverpassElement[] };

      const found: POIResult[] = [];
      for (const el of data.elements) {
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        if (lat == null || lng == null) continue;
        const name = el.tags?.name ?? el.tags?.brand ?? subTypeLabel(el.tags);
        const distAheadM = projectAhead(activeRoute.coords, currentLat, currentLng, lat, lng);
        if (distAheadM < -200) continue; // already passed (>200 m behind)
        found.push({ id: el.id, name, subtype: subTypeLabel(el.tags), lat, lng, distAheadM });
      }

      found.sort((a, b) => a.distAheadM - b.distAheadM);
      setResults(found.slice(0, 20));
      setSearched(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Search failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [activeRoute, currentLat, currentLng]);

  const handleSearch = () => {
    Keyboard.dismiss();
    runSearch(query);
  };

  const handleClose = () => {
    Keyboard.dismiss();
    setQuery("");
    setResults([]);
    setSearched(false);
    setError(null);
    onClose();
  };

  const speedKmh = currentSpeed ?? 0;
  const isDark = c.isDark;

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
            <Text style={[styles.headerTitle, { color: c.foreground }]}>Search Along Route</Text>
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
              placeholder="fuel, ATM, restaurant, hospital…"
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

          {/* Quick chips */}
          {!searched && !loading && (
            <View style={styles.chips}>
              {["Fuel", "ATM", "Restaurant", "Hospital", "Pharmacy", "Parking"].map((chip) => (
                <TouchableOpacity
                  key={chip}
                  style={[styles.chip, { backgroundColor: isDark ? "#FFFFFF12" : "#0000000C", borderColor: c.border }]}
                  onPress={() => { setQuery(chip); runSearch(chip); }}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.chipTxt, { color: c.foreground }]}>{chip}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Error */}
          {error && (
            <View style={styles.emptyState}>
              <Ionicons name="cloud-offline-outline" size={28} color={c.mutedForeground} />
              <Text style={[styles.emptyTxt, { color: c.mutedForeground }]}>
                {error.includes("timeout") || error.includes("network")
                  ? "No connection — check your data."
                  : "Search failed. Try again."}
              </Text>
            </View>
          )}

          {/* Empty results */}
          {searched && !loading && !error && results.length === 0 && (
            <View style={styles.emptyState}>
              <Ionicons name="locate-outline" size={28} color={c.mutedForeground} />
              <Text style={[styles.emptyTxt, { color: c.mutedForeground }]}>
                Nothing found along this route.
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
                const eta  = etaMinutes(dist, speedKmh);
                return (
                  <TouchableOpacity
                    style={[styles.row, { borderColor: c.border }]}
                    activeOpacity={0.7}
                    onPress={() => {
                      onSelect({ name: item.name, lat: item.lat, lng: item.lng });
                    }}
                  >
                    <View style={[styles.rowIconWrap, { backgroundColor: c.primary + "18" }]}>
                      <Ionicons name="location" size={16} color={c.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowName, { color: c.foreground }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={[styles.rowSub, { color: c.mutedForeground }]}>
                        {item.subtype}
                      </Text>
                    </View>
                    <View style={styles.rowRight}>
                      <Text style={[styles.rowDist, { color: c.primary }]}>
                        {formatDistAhead(dist)}
                      </Text>
                      {speedKmh > 5 && (
                        <Text style={[styles.rowEta, { color: c.mutedForeground }]}>
                          ~{eta} min
                        </Text>
                      )}
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

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "#00000060",
  },
  kav: {
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    maxHeight: "80%",
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
    flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14,
  },
  headerTitle: {
    flex: 1, fontSize: 16, fontFamily: "Inter_700Bold",
  },
  inputRow: {
    flexDirection: "row", alignItems: "center",
    borderRadius: 14, borderWidth: 1,
    paddingLeft: 14, paddingRight: 6, paddingVertical: 6,
    gap: 8, marginBottom: 12,
  },
  input: {
    flex: 1, fontSize: 15, fontFamily: "Inter_400Regular",
    paddingVertical: 6,
  },
  searchBtn: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  chips: {
    flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12,
  },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 14, borderWidth: 1,
  },
  chipTxt: { fontSize: 13, fontFamily: "Inter_500Medium" },
  emptyState: {
    alignItems: "center", gap: 8,
    paddingVertical: 32,
  },
  emptyTxt: {
    fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center",
  },
  list: { marginTop: 4 },
  row: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 12, borderBottomWidth: 1, gap: 10,
  },
  rowIconWrap: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: "center", justifyContent: "center",
  },
  rowName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  rowRight: { alignItems: "flex-end", gap: 2 },
  rowDist: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  rowEta: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
