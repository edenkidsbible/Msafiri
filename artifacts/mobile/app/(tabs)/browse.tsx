import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
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

type Tab = "fuel" | "food" | "shopping" | "hospital" | "nightlife";

const TABS: Array<{
  type: Tab;
  label: string;
  matIcon?: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  ionIcon?: React.ComponentProps<typeof Ionicons>["name"];
  color: string;
}> = [
  { type: "fuel",      label: "Fuel",     matIcon: "gas-station",        color: "#2E7D32" },
  { type: "food",      label: "Food",     ionIcon: "restaurant",          color: "#BF360C" },
  { type: "shopping",  label: "Shopping", ionIcon: "storefront-outline",  color: "#1565C0" },
  { type: "hospital",  label: "Hospital", ionIcon: "medkit-outline",      color: "#C62828" },
  { type: "nightlife", label: "Night",    matIcon: "glass-cocktail",      color: "#6A1B9A" },
];

// Live-only categories — no static fallback data
const LIVE_ONLY_TABS: Tab[] = ["shopping", "hospital", "nightlife"];

function buildOverpassQuery(type: Tab, lat: number, lng: number): string {
  const r = MAX_DIST;
  let filters = "";
  if (type === "fuel") {
    filters =
      `node["amenity"="fuel"](around:${r},${lat},${lng});` +
      `way["amenity"="fuel"](around:${r},${lat},${lng});`;
  } else if (type === "food") {
    filters =
      `node["amenity"~"^(restaurant|fast_food|cafe|food_court)$"](around:${r},${lat},${lng});` +
      `way["amenity"~"^(restaurant|fast_food|cafe|food_court)$"](around:${r},${lat},${lng});`;
  } else if (type === "shopping") {
    filters =
      `node["shop"~"^(supermarket|mall|department_store|convenience|wholesale)$"](around:${r},${lat},${lng});` +
      `way["shop"~"^(supermarket|mall|department_store|convenience|wholesale)$"](around:${r},${lat},${lng});` +
      `way["building"~"^(mall|retail)$"](around:${r},${lat},${lng});`;
  } else if (type === "nightlife") {
    filters =
      `node["amenity"~"^(bar|nightclub|pub|lounge)$"](around:${r},${lat},${lng});` +
      `way["amenity"~"^(bar|nightclub|pub|lounge)$"](around:${r},${lat},${lng});` +
      `node["leisure"="adult_gaming_centre"](around:${r},${lat},${lng});`;
  } else {
    filters =
      `node["amenity"~"^(hospital|clinic|doctors|pharmacy|health_centre)$"](around:${r},${lat},${lng});` +
      `way["amenity"~"^(hospital|clinic|doctors|pharmacy|health_centre)$"](around:${r},${lat},${lng});`;
  }
  return `[out:json][timeout:20];(${filters});out center 60;`;
}

// Multiple mirrors — fired in parallel; first success wins
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];

async function fetchOverpass(type: Tab, lat: number, lng: number): Promise<POIItem[]> {
  const query = buildOverpassQuery(type, lat, lng);

  const tryMirror = async (mirror: string): Promise<any> => {
    const res = await fetchWithTimeout(
      mirror,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      },
      18000
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  const data = await Promise.any(OVERPASS_MIRRORS.map(tryMirror));
  const defaultName =
    type === "fuel"      ? "Fuel Station" :
    type === "food"      ? "Restaurant"   :
    type === "shopping"  ? "Shop"         :
    type === "nightlife" ? "Bar / Club"   : "Hospital / Clinic";
  return (data.elements as any[])
    .map((el): POIItem | null => {
      const plat: number = el.lat ?? el.center?.lat;
      const plng: number = el.lon ?? el.center?.lon;
      if (!plat || !plng) return null;
      const tags: Record<string, string> = el.tags ?? {};
      const name = tags.name || tags["name:en"] || tags.brand || tags.operator || defaultName;
      const address = [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"] || tags["addr:suburb"]].filter(Boolean).join(", ");
      return {
        id: `osm-${el.type}-${el.id}`,
        type,
        name,
        brand: tags.brand ?? tags.operator ?? "",
        address,
        hours: tags.opening_hours ?? "",
        lat: plat,
        lng: plng,
        source: "live",
      };
    })
    .filter((p): p is POIItem => p !== null);
}

// Static fallback — fuel + food only
const STATIC_POIS: POIItem[] = POIS
  .filter((p) => p.type === "fuel" || p.type === "food")
  .map((p: any) => ({
    id: p.id, type: p.type as Tab, name: p.name, brand: p.brand ?? "",
    address: p.address ?? "", hours: p.hours ?? "", lat: p.lat, lng: p.lng, source: "static" as const,
  }));

function TabIcon({ tab, active }: { tab: typeof TABS[number]; active: boolean }) {
  const color = active ? tab.color : "#888";
  const sz = 15;
  if (tab.matIcon) return <MaterialCommunityIcons name={tab.matIcon} size={sz} color={color} />;
  if (tab.ionIcon) return <Ionicons name={tab.ionIcon} size={sz} color={color} />;
  return null;
}

export default function BrowseScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { currentLat, currentLng } = useApp();

  const [activeTab, setActiveTab] = useState<Tab>("fuel");
  const [pois, setPois] = useState<(POIItem & { distance?: number })[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;
  const tabBarHeight = Platform.OS === "web" ? 84 : 96;

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // Track where we last fetched from, so we only re-query when the user has
  // moved far enough (2.5 km). Within that radius we just re-sort in place.
  const fetchOriginRef = useRef<{ lat: number; lng: number } | null>(null);
  const activeTabRef = useRef<Tab>(activeTab);

  const loadPOIs = useCallback(async (
    t: Tab,
    lat: number | null,
    lng: number | null,
    incremental = false,
  ) => {
    if (!incremental) {
      setLoading(true);
      setError(null);
      setIsLive(false);
    }

    let items: POIItem[] = [];
    let live = false;

    if (lat !== null && lng !== null) {
      try {
        items = await fetchOverpass(t, lat, lng);
        live = true;
      } catch {
        if (!isMounted.current) return;
        if (!incremental) {
          setError("Live data unavailable. Showing cached results.");
          items = STATIC_POIS.filter((p) => p.type === t);
        }
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

    if (incremental && lat !== null && lng !== null) {
      // Merge: keep existing POIs still in range + add genuinely new ones
      setPois((prev) => {
        const existingInRange = prev
          .map((p) => ({ ...p, distance: haversine(lat, lng, p.lat, p.lng) }))
          .filter((p) => p.distance <= MAX_DIST);
        const existingIds = new Set(existingInRange.map((p) => p.id));
        const newItems = withDist.filter((p) => !existingIds.has(p.id));
        return [...existingInRange, ...newItems]
          .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
      });
    } else {
      setPois(withDist);
    }

    if (live) setIsLive(true);
    if (!incremental) setLoading(false);
  }, []);

  // Tab change → always do a full reload and reset the fetch origin
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    activeTabRef.current = activeTab;
    fetchOriginRef.current =
      currentLat !== null && currentLng !== null
        ? { lat: currentLat, lng: currentLng }
        : null;
    setLoading(true);
    setError(null);
    setIsLive(false);
    setPois([]);
    loadPOIs(activeTab, currentLat, currentLng, false);
  }, [activeTab]);

  // Location update → incremental: re-sort if <2.5 km, re-fetch if farther
  useEffect(() => {
    if (currentLat === null || currentLng === null) return;
    const origin = fetchOriginRef.current;

    if (!origin) {
      // First GPS fix after this tab was mounted — do the initial fetch now
      fetchOriginRef.current = { lat: currentLat, lng: currentLng };
      loadPOIs(activeTabRef.current, currentLat, currentLng, false);
      return;
    }

    const dist = haversine(currentLat, currentLng, origin.lat, origin.lng);

    if (dist > 2500) {
      // Moved significantly — fetch fresh results, merge with existing
      fetchOriginRef.current = { lat: currentLat, lng: currentLng };
      loadPOIs(activeTabRef.current, currentLat, currentLng, true);
    } else {
      // Still close — just recompute distances and drop anything now >10 km
      setPois((prev) =>
        prev
          .map((p) => ({ ...p, distance: haversine(currentLat, currentLng, p.lat, p.lng) }))
          .filter((p) => p.distance <= MAX_DIST)
          .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLat, currentLng]);

  const tabMeta = TABS.find((t) => t.type === activeTab)!;
  const isLiveOnly = LIVE_ONLY_TABS.includes(activeTab);

  // Distinct empty states for live-only tabs
  const needsLocation  = isLiveOnly && currentLat === null && !loading;
  const networkFailure = isLiveOnly && currentLat !== null && !isLive && pois.length === 0 && !loading;

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      {/* ─── Header ─── */}
      <View style={[styles.header, { paddingTop: topInset + 8, backgroundColor: c.background }]}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: c.foreground }]}>Nearby Places</Text>
          <View style={styles.headerRight}>
            {isLive ? (
              <View style={[styles.livePill, { backgroundColor: "#00C85322" }]}>
                <View style={[styles.liveDot, { backgroundColor: "#00C853" }]} />
                <Text style={[styles.liveText, { color: "#00C853" }]}>Live</Text>
              </View>
            ) : error ? (
              <View style={[styles.livePill, { backgroundColor: c.muted }]}>
                <Ionicons name="cloud-offline-outline" size={11} color={c.mutedForeground} />
                <Text style={[styles.liveText, { color: c.mutedForeground }]}>Offline</Text>
              </View>
            ) : null}
            <TouchableOpacity
              onPress={() => loadPOIs(activeTab, currentLat, currentLng)}
              style={[styles.refreshBtn, { backgroundColor: c.muted }]}
              disabled={loading}
            >
              <Ionicons
                name="refresh-outline"
                size={17}
                color={loading ? c.mutedForeground : c.foreground}
              />
            </TouchableOpacity>
          </View>
        </View>

        <Text style={[styles.sub, { color: c.mutedForeground }]}>
          {currentLat
            ? `${pois.length} place${pois.length !== 1 ? "s" : ""} within 10 km · tap Go to navigate`
            : "Enable location for live nearby results"}
        </Text>

        {/* ─── Category tabs ─── */}
        <View style={[styles.tabStrip, { backgroundColor: c.muted }]}>
          {TABS.map((t) => {
            const active = activeTab === t.type;
            return (
              <TouchableOpacity
                key={t.type}
                style={[
                  styles.tabBtn,
                  active && { backgroundColor: c.card, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
                ]}
                onPress={() => setActiveTab(t.type)}
                activeOpacity={0.75}
              >
                <TabIcon tab={t} active={active} />
                <Text
                  style={[
                    styles.tabLabel,
                    { color: active ? t.color : c.mutedForeground },
                    active && { fontFamily: "Inter_600SemiBold" },
                  ]}
                >
                  {t.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ─── Content ─── */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={tabMeta.color} />
          <Text style={[styles.loadingText, { color: c.mutedForeground }]}>
            Finding nearby {tabMeta.label.toLowerCase()} spots…
          </Text>
        </View>

      ) : needsLocation ? (
        <View style={styles.emptyWrap}>
          <View style={[styles.emptyIcon, { backgroundColor: tabMeta.color + "18" }]}>
            <Ionicons name="location-outline" size={32} color={tabMeta.color} />
          </View>
          <Text style={[styles.emptyTitle, { color: c.foreground }]}>Location needed</Text>
          <Text style={[styles.emptyBody, { color: c.mutedForeground }]}>
            Turn on location access so we can find {tabMeta.label.toLowerCase()} spots near you in real time.
          </Text>
        </View>

      ) : networkFailure ? (
        <View style={styles.emptyWrap}>
          <View style={[styles.emptyIcon, { backgroundColor: "#F57C0018" }]}>
            <Ionicons name="cloud-offline-outline" size={32} color="#F57C00" />
          </View>
          <Text style={[styles.emptyTitle, { color: c.foreground }]}>No connection</Text>
          <Text style={[styles.emptyBody, { color: c.mutedForeground }]}>
            Could not reach the map server. Check your internet and try again.
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: tabMeta.color }]}
            onPress={() => loadPOIs(activeTab, currentLat, currentLng)}
          >
            <Ionicons name="refresh-outline" size={16} color="#FFF" />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>

      ) : pois.length === 0 ? (
        <View style={styles.emptyWrap}>
          {tabMeta.ionIcon ? (
            <View style={[styles.emptyIcon, { backgroundColor: tabMeta.color + "18" }]}>
              <Ionicons name={tabMeta.ionIcon} size={32} color={tabMeta.color} />
            </View>
          ) : tabMeta.matIcon ? (
            <View style={[styles.emptyIcon, { backgroundColor: tabMeta.color + "18" }]}>
              <MaterialCommunityIcons name={tabMeta.matIcon} size={32} color={tabMeta.color} />
            </View>
          ) : null}
          <Text style={[styles.emptyTitle, { color: c.foreground }]}>None found nearby</Text>
          <Text style={[styles.emptyBody, { color: c.mutedForeground }]}>
            No {tabMeta.label.toLowerCase()} spots found within 10 km of your location.
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: tabMeta.color }]}
            onPress={() => loadPOIs(activeTab, currentLat, currentLng)}
          >
            <Ionicons name="refresh-outline" size={16} color="#FFF" />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>

      ) : (
        <FlatList
          data={pois}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <POICard poi={item} distance={item.distance} />}
          contentContainerStyle={{
            paddingTop: 10,
            paddingBottom: bottomInset + tabBarHeight + 16,
          }}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={null}
          ListHeaderComponent={
            error ? (
              <View style={[styles.errorBanner, { backgroundColor: "#F57C0018" }]}>
                <Ionicons name="cloud-offline-outline" size={14} color="#F57C00" />
                <Text style={[styles.errorText, { color: "#F57C00" }]}>
                  Showing cached results — connect to get live data
                </Text>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 3 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  refreshBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 10 },

  tabStrip: {
    flexDirection: "row",
    borderRadius: 14,
    padding: 4,
    gap: 2,
  },
  tabBtn: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: 8,
    borderRadius: 10,
  },
  tabLabel: { fontSize: 10, fontFamily: "Inter_500Medium" },

  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  loadingText: { fontSize: 14, fontFamily: "Inter_500Medium" },

  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 40 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  emptyBody: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  retryBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  retryText: { color: "#FFF", fontSize: 14, fontFamily: "Inter_600SemiBold" },

  errorBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 10,
  },
  errorText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
});
