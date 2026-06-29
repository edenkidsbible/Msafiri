import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { POIS } from "@/data/pois";
import POICard, { POIItem } from "@/components/POICard";
import { fetchWithTimeout } from "@/utils/fetchTimeout";

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180, f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180, dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const MAX_DIST = 10000;

async function fetchOverpassGET(type: "fuel" | "food", lat: number, lng: number): Promise<POIItem[]> {
  // Use GET (simpler and more reliable in React Native than POST)
  const amenity = type === "fuel"
    ? `"amenity"="fuel"`
    : `"amenity"~"^(restaurant|fast_food|cafe|food_court)$"`;

  // Fetch nodes (individual places) AND ways (large stations mapped as areas)
  const query =
    `[out:json][timeout:15];` +
    `(` +
    `node[${amenity}](around:${MAX_DIST},${lat},${lng});` +
    `way[${amenity}](around:${MAX_DIST},${lat},${lng});` +
    `);` +
    `out center 50;`;

  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

  const res = await fetchWithTimeout(url, {}, 16000);
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const data = await res.json();

  return (data.elements as any[])
    .map((el): POIItem | null => {
      // Nodes have lat/lon directly; ways have a center
      const plat: number = el.lat ?? el.center?.lat;
      const plng: number = el.lon ?? el.center?.lon;
      if (!plat || !plng) return null;

      const tags: Record<string, string> = el.tags ?? {};
      const name: string =
        tags.name ||
        tags["name:en"] ||
        tags.brand ||
        (type === "fuel" ? "Fuel Station" : "Restaurant / Cafe");

      const address = [
        tags["addr:housenumber"],
        tags["addr:street"],
        tags["addr:city"] || tags["addr:suburb"],
      ]
        .filter(Boolean)
        .join(", ");

      return {
        id: `osm-${el.type}-${el.id}`,
        type,
        name,
        brand: tags.brand ?? tags["brand:en"] ?? "",
        address,
        hours: tags.opening_hours ?? tags["service_times"] ?? "",
        lat: plat,
        lng: plng,
        source: "live",
      };
    })
    .filter((p): p is POIItem => p !== null);
}

type Tab = "fuel" | "food";

const STATIC_POIS: POIItem[] = POIS.map((p: any) => ({
  id: p.id,
  type: p.type as "fuel" | "food",
  name: p.name,
  brand: p.brand ?? "",
  address: p.address ?? "",
  hours: p.hours ?? "",
  lat: p.lat,
  lng: p.lng,
  source: "static" as const,
}));

export default function BrowseScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { currentLat, currentLng } = useApp();
  const [tab, setTab] = useState<Tab>("fuel");
  const [query, setQuery] = useState("");
  const [pois, setPois] = useState<(POIItem & { distance?: number })[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;
  const isMounted = useRef(true);
  useEffect(() => { isMounted.current = true; return () => { isMounted.current = false; }; }, []);

  const loadPOIs = useCallback(async (t: Tab, lat: number | null, lng: number | null) => {
    setLoading(true);
    setError(null);
    setIsLive(false);

    let items: POIItem[] = [];
    let live = false;

    if (lat !== null && lng !== null) {
      try {
        items = await fetchOverpassGET(t, lat, lng);
        live = true;
      } catch (e: any) {
        const msg = e?.message ?? "Network error";
        if (!isMounted.current) return;
        setError(`Could not load live data (${msg}). Showing cached results.`);
        items = STATIC_POIS.filter((p) => p.type === t);
      }
    } else {
      items = STATIC_POIS.filter((p) => p.type === t);
    }

    if (!isMounted.current) return;

    const withDist = items
      .map((p) => ({
        ...p,
        distance: lat !== null && lng !== null ? haversine(lat, lng, p.lat, p.lng) : undefined,
      }))
      .filter((p) => p.distance === undefined || p.distance <= MAX_DIST)
      .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

    setPois(withDist);
    setIsLive(live);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPOIs(tab, currentLat, currentLng);
  }, [tab, currentLat, currentLng, loadPOIs]);

  const filtered =
    query.length > 1
      ? pois.filter((p) => {
          const q = query.toLowerCase();
          return (
            p.name.toLowerCase().includes(q) ||
            (p.brand ?? "").toLowerCase().includes(q) ||
            (p.address ?? "").toLowerCase().includes(q)
          );
        })
      : pois;

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 8 }]}>
        {/* Title row */}
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: c.foreground }]}>Nearby Places</Text>
          <View style={styles.statusRow}>
            {isLive && (
              <View style={[styles.livePill, { backgroundColor: "#00C85322" }]}>
                <View style={[styles.liveDot, { backgroundColor: "#00C853" }]} />
                <Text style={[styles.liveText, { color: "#00C853" }]}>Live</Text>
              </View>
            )}
            {error && (
              <View style={[styles.livePill, { backgroundColor: c.muted }]}>
                <Text style={[styles.liveText, { color: c.mutedForeground }]}>Offline</Text>
              </View>
            )}
            <TouchableOpacity
              onPress={() => loadPOIs(tab, currentLat, currentLng)}
              style={[styles.refreshBtn, { backgroundColor: c.muted }]}
              disabled={loading}
            >
              <Ionicons name="refresh-outline" size={18} color={loading ? c.mutedForeground : c.foreground} />
            </TouchableOpacity>
          </View>
        </View>

        <Text style={[styles.sub, { color: c.mutedForeground }]}>
          {currentLat
            ? `Real OSM data within 10 km · ${filtered.length} found`
            : "Enable location for real nearby places"}
        </Text>

        {error && (
          <View style={[styles.errorBanner, { backgroundColor: c.muted }]}>
            <Ionicons name="cloud-offline-outline" size={14} color={c.mutedForeground} />
            <Text style={[styles.errorText, { color: c.mutedForeground }]} numberOfLines={2}>{error}</Text>
          </View>
        )}

        {/* Search */}
        <View style={[styles.searchRow, { backgroundColor: c.muted, borderColor: c.border }]}>
          <Ionicons name="search-outline" size={17} color={c.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: c.foreground }]}
            placeholder={`Search ${tab === "fuel" ? "fuel stations" : "restaurants"}…`}
            placeholderTextColor={c.mutedForeground}
            value={query}
            onChangeText={setQuery}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={16} color={c.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        {/* Tabs */}
        <View style={[styles.tabRow, { backgroundColor: c.muted }]}>
          {(["fuel", "food"] as Tab[]).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tabBtn, tab === t && { backgroundColor: c.card }]}
              onPress={() => { setTab(t); setQuery(""); }}
              activeOpacity={0.8}
            >
              <Text style={{ fontSize: 15 }}>{t === "fuel" ? "⛽" : "🍽️"}</Text>
              <Text
                style={[
                  styles.tabLabel,
                  { color: tab === t ? c.primary : c.mutedForeground },
                  tab === t && { fontFamily: "Inter_600SemiBold" },
                ]}
              >
                {t === "fuel" ? "Fuel Stations" : "Restaurants"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={c.primary} />
          <Text style={[styles.loadingText, { color: c.mutedForeground }]}>
            Finding nearby {tab === "fuel" ? "fuel stations" : "restaurants"}…
          </Text>
          <Text style={[styles.loadingSubText, { color: c.mutedForeground }]}>
            Fetching live data from OpenStreetMap
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          renderItem={({ item }) => <POICard poi={item} distance={item.distance} />}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 10, paddingBottom: bottomInset + 100 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={{ fontSize: 40 }}>{tab === "fuel" ? "⛽" : "🍽️"}</Text>
              <Text style={[styles.emptyText, { color: c.mutedForeground }]}>
                {currentLat
                  ? query.length > 1
                    ? `No "${query}" found nearby`
                    : "No places found within 10 km"
                  : "Enable location to find real nearby places"}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 10 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  refreshBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 6 },
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    borderRadius: 10,
    padding: 9,
    marginBottom: 8,
  },
  errorText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 17 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  tabRow: { flexDirection: "row", borderRadius: 12, padding: 4 },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, borderRadius: 10 },
  tabLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  loadingSubText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 40 },
});
