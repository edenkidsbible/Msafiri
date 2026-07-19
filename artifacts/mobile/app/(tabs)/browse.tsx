import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FLAT_LIST_PROPS, SCROLL_PROPS } from "@/lib/scrollProps";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { POIS } from "@/data/pois";
import POICard, { POIItem } from "@/components/POICard";
import { fetchWithTimeout } from "@/utils/fetchTimeout";
import FinesContent from "@/components/FinesContent";
import { useCourseData } from "@/hooks/useCourseData";
import { useCourseProgress } from "@/hooks/useCourseProgress";
import { useCourseSearch } from "@/hooks/useCourseSearch";

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180, f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180, dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 5 km gives faster Overpass queries (smaller bounding box) and returns only
// the results that are actually relevant to a driver. 10 km returned distant
// results and, combined with the larger search area, was the single biggest
// reason for query timeouts on the public Overpass servers.
const MAX_DIST = 5000;

type Tab = "fuel" | "food" | "shopping" | "hospital" | "nightlife";
type ViewMode = "places" | "learn" | "fines";

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

const LIVE_ONLY_TABS: Tab[] = ["shopping", "hospital", "nightlife"];

function buildOverpassQuery(type: Tab, lat: number, lng: number): string {
  // IMPORTANT: Do NOT use regex filters (~"^(a|b|c)$") in Overpass queries.
  // Regex forces a full table scan on every node/way in the bounding area and
  // reliably triggers the server timeout even for small radii. Use explicit
  // equality conditions instead — Overpass can use its value index for those
  // and returns in < 3 s where the regex version was timing out at 25 s.
  const r = MAX_DIST;
  let filters = "";
  if (type === "fuel") {
    filters =
      `node["amenity"="fuel"](around:${r},${lat},${lng});` +
      `way["amenity"="fuel"](around:${r},${lat},${lng});`;
  } else if (type === "food") {
    filters =
      `node["amenity"="restaurant"](around:${r},${lat},${lng});` +
      `node["amenity"="fast_food"](around:${r},${lat},${lng});` +
      `node["amenity"="cafe"](around:${r},${lat},${lng});` +
      `node["amenity"="food_court"](around:${r},${lat},${lng});` +
      `way["amenity"="restaurant"](around:${r},${lat},${lng});` +
      `way["amenity"="fast_food"](around:${r},${lat},${lng});`;
  } else if (type === "shopping") {
    // Use the most common OSM shop tags in Kenya + amenity=marketplace
    // (open-air markets are very prevalent). Avoid building=mall — it tags
    // the structure, not the retail function, and returns huge way geometries
    // that have no useful name/address for the user.
    filters =
      `node["shop"="supermarket"](around:${r},${lat},${lng});` +
      `node["shop"="convenience"](around:${r},${lat},${lng});` +
      `node["shop"="mall"](around:${r},${lat},${lng});` +
      `node["shop"="department_store"](around:${r},${lat},${lng});` +
      `node["amenity"="marketplace"](around:${r},${lat},${lng});` +
      `way["shop"="supermarket"](around:${r},${lat},${lng});` +
      `way["shop"="mall"](around:${r},${lat},${lng});` +
      `way["amenity"="marketplace"](around:${r},${lat},${lng});`;
  } else if (type === "nightlife") {
    filters =
      `node["amenity"="bar"](around:${r},${lat},${lng});` +
      `node["amenity"="nightclub"](around:${r},${lat},${lng});` +
      `node["amenity"="pub"](around:${r},${lat},${lng});` +
      `node["amenity"="lounge"](around:${r},${lat},${lng});` +
      `node["leisure"="adult_gaming_centre"](around:${r},${lat},${lng});` +
      `way["amenity"="bar"](around:${r},${lat},${lng});` +
      `way["amenity"="nightclub"](around:${r},${lat},${lng});`;
  } else {
    // hospital
    filters =
      `node["amenity"="hospital"](around:${r},${lat},${lng});` +
      `node["amenity"="clinic"](around:${r},${lat},${lng});` +
      `node["amenity"="doctors"](around:${r},${lat},${lng});` +
      `node["amenity"="pharmacy"](around:${r},${lat},${lng});` +
      `node["amenity"="health_centre"](around:${r},${lat},${lng});` +
      `way["amenity"="hospital"](around:${r},${lat},${lng});` +
      `way["amenity"="clinic"](around:${r},${lat},${lng});`;
  }
  // Limit to 30 results: faster response, less data to parse, still enough for
  // a driver choosing a nearby stop. (Previous 60 doubled transfer size with no
  // practical benefit since most results beyond ~30 were already too far to be useful.)
  return `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];(${filters});out center 30;`;
}

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];
// Overpass processing budget (inside the query) — the fetch timeout must be
// longer than this so we don't abort a response that's just about to arrive.
// Android OkHttp cold-start TLS handshakes to EU servers from Kenya routinely
// take 4–6 s before any bytes are transferred, so we give Android more runway.
const OVERPASS_QUERY_TIMEOUT_S = 20;
const OVERPASS_FETCH_TIMEOUT_MS         = 15_000; // iOS  — 15 s × 3 mirrors = 45 s max
const OVERPASS_FETCH_TIMEOUT_MS_ANDROID = 22_000; // Android — extra headroom for OkHttp cold TLS

interface CacheEntry { items: POIItem[]; fetchedAt: number }
const _cache = new Map<string, CacheEntry>();
// Cache results for 3 minutes. Within that window we return immediately from
// cache (no network call, instant load). After 3 minutes we always do a fresh
// fetch — we never serve stale data silently, as that's the "showing cached
// data" confusion the user reported.
const CACHE_FRESH_MS = 3 * 60 * 1000;

function poiCacheKey(type: Tab, lat: number, lng: number): string {
  const bLat = Math.round(lat * 100) / 100;
  const bLng = Math.round(lng * 100) / 100;
  return `${type}:${bLat}:${bLng}`;
}

async function fetchOverpass(type: Tab, lat: number, lng: number): Promise<POIItem[]> {
  const query = buildOverpassQuery(type, lat, lng);
  // GET instead of POST for two Android-specific reasons:
  //   1. OkHttp (Android) never retries a failed POST (avoids double-submission
  //      by design), so a single transient TCP hiccup kills the whole request.
  //      GET requests are retried automatically by OkHttp.
  //   2. React Native New Architecture on Android has a known issue where
  //      POST bodies with Content-Type: application/x-www-form-urlencoded are
  //      not always flushed correctly through the JSI networking layer.
  // All three Overpass mirrors support the identical GET ?data=<query> API.
  // Query strings stay ~1 KB even for the longest tab — well within limits.
  const encodedQuery = encodeURIComponent(query);
  const reqInit: RequestInit = {
    method: "GET",
    headers: {
      // An explicit UA avoids Overpass bot-detection. Android's OkHttp default
      // ("okhttp/4.x.x") is fingerprinted and rate-limited by these servers;
      // iOS NSURLSession passes because it looks browser-like.
      "User-Agent": "MsafiriKenya/1.0 (Expo; mobile)",
      "Accept": "application/json",
    },
  };
  const perMirrorTimeout = Platform.OS === "android"
    ? OVERPASS_FETCH_TIMEOUT_MS_ANDROID
    : OVERPASS_FETCH_TIMEOUT_MS;

  // Try mirrors sequentially — racing all three simultaneously triggers
  // rate-limits on the public servers. We stop at the first success.
  let lastErr: unknown;
  let data: any;
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const res = await fetchWithTimeout(
        `${mirror}?data=${encodedQuery}`,
        reqInit,
        perMirrorTimeout,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      break; // success — stop trying mirrors
    } catch (err) {
      lastErr = err;
      // try next mirror
    }
  }
  if (data === undefined) throw lastErr ?? new Error("All Overpass mirrors failed");
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
      return { id: `osm-${el.type}-${el.id}`, type, name, brand: tags.brand ?? tags.operator ?? "", address, hours: tags.opening_hours ?? "", lat: plat, lng: plng, source: "live" };
    })
    .filter((p): p is POIItem => p !== null);
}

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

// ── Learn view embedded in Browse (iOS: Learn tab is hidden from the tab bar) ──
function LearnBrowseView({ bottomInset, tabBarHeight }: { bottomInset: number; tabBarHeight: number }) {
  const c = useColors();
  const router = useRouter();
  const { deviceId } = useApp();
  const { chapters, loading: chaptersLoading } = useCourseData();
  const { progress } = useCourseProgress(deviceId);

  const completedSlugs = useMemo(
    () => new Set(progress.map((p) => p.lessonSlug)),
    [progress]
  );

  const titleIndex = useMemo(
    () => chapters.flatMap((ch) => ch.lessons.map((l) => ({ slug: l.slug, title: l.title }))),
    [chapters]
  );
  const { query, setQuery, results: searchResults, searching } = useCourseSearch(titleIndex);
  const isSearchActive = query.trim().length > 0;

  const totalLessons = chapters.reduce((s, ch) => s + ch.lessons.length, 0);
  const completedLessons = chapters.reduce(
    (s, ch) => s + ch.lessons.filter((l) => completedSlugs.has(l.slug)).length,
    0
  );
  const overallPct = totalLessons > 0 ? completedLessons / totalLessons : 0;

  if (chaptersLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={c.primary} />
      </View>
    );
  }

  const paddingBottom = bottomInset + tabBarHeight + 20;

  return (
    <View style={{ flex: 1 }}>
      {/* ── Search bar ── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 }}>
        <View style={[styles.learnSearchBar, { backgroundColor: c.muted, borderColor: c.border }]}>
          <Feather name="search" size={15} color={c.mutedForeground} />
          <TextInput
            style={[styles.learnSearchInput, { color: c.foreground }]}
            placeholder="Search lessons…"
            placeholderTextColor={c.mutedForeground}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            clearButtonMode="while-editing"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {searching && <ActivityIndicator size="small" color={c.mutedForeground} />}
          {!searching && query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={14} color={c.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Search results ── */}
      {isSearchActive ? (
        <ScrollView
          {...SCROLL_PROPS}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom, gap: 8 }}
          showsVerticalScrollIndicator={false}
        >
          {searching ? (
            <View style={{ alignItems: "center", paddingVertical: 32, gap: 10 }}>
              <ActivityIndicator color={c.primary} />
              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: c.mutedForeground }}>Searching…</Text>
            </View>
          ) : searchResults.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 32, gap: 10 }}>
              <Feather name="search" size={26} color={c.mutedForeground} />
              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: c.mutedForeground }}>No results for "{query}"</Text>
            </View>
          ) : (
            <>
              <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: c.mutedForeground, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
                {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
              </Text>
              {searchResults.map((r) => (
                <TouchableOpacity
                  key={r.slug}
                  style={[styles.learnSearchResult, { backgroundColor: c.card, borderColor: c.border }]}
                  onPress={() => router.push(`/course/${r.slug}` as any)}
                  activeOpacity={0.8}
                >
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={[styles.learnSearchResultTitle, { color: c.foreground }]} numberOfLines={2}>{r.title}</Text>
                    {r.excerpt ? (
                      <Text style={[styles.learnSearchResultExcerpt, { color: c.mutedForeground }]} numberOfLines={2}>{r.excerpt}</Text>
                    ) : null}
                    {r.estimatedMinutes > 0 ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                        <Feather name="clock" size={10} color={c.mutedForeground} />
                        <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: c.mutedForeground }}>~{r.estimatedMinutes} min</Text>
                      </View>
                    ) : null}
                  </View>
                  <Feather name="chevron-right" size={15} color={c.mutedForeground} />
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
      ) : (
        /* ── Chapter list ── */
        <FlatList
          {...FLAT_LIST_PROPS}
          data={chapters}
          keyExtractor={(ch) => ch.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListHeaderComponent={
            <View style={[styles.learnHeader, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.learnHeaderTitle, { color: c.foreground }]}>Driving Course</Text>
                <Text style={[styles.learnHeaderSub, { color: c.mutedForeground }]}>
                  {completedLessons} of {totalLessons} lessons complete
                </Text>
                <View style={[styles.learnProgBg, { backgroundColor: c.muted, marginTop: 10 }]}>
                  <View style={[styles.learnProgFill, { backgroundColor: c.primary, width: `${Math.round(overallPct * 100)}%` as any }]} />
                </View>
              </View>
              <Text style={[styles.learnOverallPct, { color: c.primary }]}>
                {Math.round(overallPct * 100)}%
              </Text>
            </View>
          }
          renderItem={({ item: ch }) => {
            const chDone = ch.lessons.filter((l) => completedSlugs.has(l.slug)).length;
            const chPct = ch.lessons.length > 0 ? chDone / ch.lessons.length : 0;
            const estMins = ch.lessons.reduce((s, l) => s + (l.estimatedMinutes ?? 0), 0);
            return (
              <TouchableOpacity
                style={[styles.learnChapter, { backgroundColor: c.card, borderColor: c.border }]}
                onPress={() => {
                  const target =
                    ch.lessons.find((l) => !completedSlugs.has(l.slug)) ??
                    ch.lessons[0];
                  if (target) router.push(`/course/${target.slug}` as any);
                }}
                activeOpacity={0.75}
              >
                <View style={[styles.learnChUnit, { backgroundColor: c.primary + "18" }]}>
                  <Text style={[styles.learnChUnitTxt, { color: c.primary }]}>{ch.unitNumber}</Text>
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={[styles.learnChTitle, { color: c.foreground }]} numberOfLines={2}>
                    {ch.title}
                  </Text>
                  <View style={[styles.learnProgBg, { backgroundColor: c.muted }]}>
                    <View style={[styles.learnProgFill, { backgroundColor: chPct === 1 ? "#00C853" : c.primary, width: `${Math.round(chPct * 100)}%` as any }]} />
                  </View>
                  <Text style={[styles.learnChSub, { color: c.mutedForeground }]}>
                    {chDone}/{ch.lessons.length} lessons
                    {estMins > 0 ? ` · ${estMins} min` : ""}
                    {chPct === 1 ? " · ✓ Complete" : ""}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.mutedForeground} />
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

export default function BrowseScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { currentLat, currentLng } = useApp();

  const [viewMode, setViewMode]     = useState<ViewMode>("places");
  const [activeTab, setActiveTab]   = useState<Tab>("fuel");
  const [pois, setPois]             = useState<(POIItem & { distance?: number })[]>([]);
  const [loading, setLoading]       = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [isLive, setIsLive]         = useState(false);

  const topInset     = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset  = Platform.OS === "web" ? 34 : insets.bottom;
  const tabBarHeight = Platform.OS === "web" ? 84 : 96;

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const fetchOriginRef = useRef<{ lat: number; lng: number } | null>(null);
  const activeTabRef   = useRef<Tab>(activeTab);

  const applyItems = useCallback((items: POIItem[], lat: number | null, lng: number | null, merge: boolean) => {
    const withDist = items
      .map((p) => ({ ...p, distance: lat !== null && lng !== null ? haversine(lat, lng, p.lat, p.lng) : undefined }))
      .filter((p) => p.distance === undefined || p.distance <= MAX_DIST)
      .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

    if (merge && lat !== null && lng !== null) {
      setPois((prev) => {
        const existingInRange = prev
          .map((p) => ({ ...p, distance: haversine(lat, lng, p.lat, p.lng) }))
          .filter((p) => p.distance <= MAX_DIST);
        const existingIds = new Set(existingInRange.map((p) => p.id));
        const newItems = withDist.filter((p) => !existingIds.has(p.id));
        return [...existingInRange, ...newItems].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
      });
    } else {
      setPois(withDist);
    }
  }, []);

  const loadPOIs = useCallback(async (t: Tab, lat: number | null, lng: number | null, incremental = false) => {
    // Return fresh cache immediately — no network call needed.
    if (lat !== null && lng !== null) {
      const key    = poiCacheKey(t, lat, lng);
      const cached = _cache.get(key);
      const age    = cached ? Date.now() - cached.fetchedAt : Infinity;
      if (cached && age < CACHE_FRESH_MS) {
        applyItems(cached.items, lat, lng, incremental);
        setIsLive(true); setLoading(false); setIsRefreshing(false);
        return;
      }
    }

    if (!incremental) { setLoading(true); setError(null); setIsLive(false); }

    let items: POIItem[] = [];
    let live = false;

    if (lat !== null && lng !== null) {
      try {
        items = await fetchOverpass(t, lat, lng);
        live = true;
        _cache.set(poiCacheKey(t, lat, lng), { items, fetchedAt: Date.now() });
      } catch {
        if (!isMounted.current) return;
        // Never fall back to static/cached data on a network error. The driver
        // needs to know they're offline so they can act on it — silently showing
        // old data (especially for shopping/nightlife/hospital) is confusing and
        // can lead to a driver navigating to a place that is not actually open.
        if (!incremental) setError("no-connection");
      }
    } else {
      // No GPS — fuel & food have offline static fallback; live-only tabs show
      // the "Location needed" empty state via the needsLocation flag.
      items = STATIC_POIS.filter((p) => p.type === t);
    }

    if (!isMounted.current) return;
    applyItems(items, lat, lng, incremental);
    if (live) setIsLive(true);
    if (!incremental) setLoading(false);
  }, [applyItems]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    activeTabRef.current = activeTab;
    fetchOriginRef.current = currentLat !== null && currentLng !== null ? { lat: currentLat, lng: currentLng } : null;
    setLoading(true); setError(null); setIsLive(false); setPois([]);
    loadPOIs(activeTab, currentLat, currentLng, false);
  }, [activeTab]);

  useEffect(() => {
    if (currentLat === null || currentLng === null) return;
    const origin = fetchOriginRef.current;
    if (!origin) {
      fetchOriginRef.current = { lat: currentLat, lng: currentLng };
      loadPOIs(activeTabRef.current, currentLat, currentLng, false);
      return;
    }
    const dist = haversine(currentLat, currentLng, origin.lat, origin.lng);
    if (dist > 2500) {
      fetchOriginRef.current = { lat: currentLat, lng: currentLng };
      loadPOIs(activeTabRef.current, currentLat, currentLng, true);
    } else {
      setPois((prev) =>
        prev
          .map((p) => ({ ...p, distance: haversine(currentLat, currentLng, p.lat, p.lng) }))
          .filter((p) => p.distance <= MAX_DIST)
          .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLat, currentLng]);

  const tabMeta    = TABS.find((t) => t.type === activeTab)!;
  const isLiveOnly = LIVE_ONLY_TABS.includes(activeTab);
  const needsLocation  = isLiveOnly && currentLat === null && !loading;
  const networkFailure = isLiveOnly && currentLat !== null && !isLive && pois.length === 0 && !loading;

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>

      {/* ─── Header ─── */}
      <View style={[styles.header, { paddingTop: topInset + 8, backgroundColor: c.background }]}>

        {/* Top row: view toggle + (places only) live badge + refresh */}
        <View style={styles.titleRow}>
          <View style={[styles.viewToggle, { backgroundColor: c.muted }]}>
            <TouchableOpacity
              style={[styles.viewBtn, viewMode === "places" && { backgroundColor: c.card }]}
              onPress={() => setViewMode("places")}
              activeOpacity={0.8}
            >
              <Ionicons name="location-outline" size={13} color={viewMode === "places" ? c.primary : c.mutedForeground} />
              <Text style={[
                styles.viewBtnLabel,
                { color: viewMode === "places" ? c.primary : c.mutedForeground },
                viewMode === "places" && { fontFamily: "Inter_600SemiBold" },
              ]}>
                Nearby
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.viewBtn, viewMode === "learn" && { backgroundColor: c.card }]}
              onPress={() => setViewMode("learn")}
              activeOpacity={0.8}
            >
              <Ionicons name="book-outline" size={13} color={viewMode === "learn" ? c.primary : c.mutedForeground} />
              <Text style={[
                styles.viewBtnLabel,
                { color: viewMode === "learn" ? c.primary : c.mutedForeground },
                viewMode === "learn" && { fontFamily: "Inter_600SemiBold" },
              ]}>
                Learn
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.viewBtn, viewMode === "fines" && { backgroundColor: c.card }]}
              onPress={() => setViewMode("fines")}
              activeOpacity={0.8}
            >
              <Ionicons name="document-text-outline" size={13} color={viewMode === "fines" ? c.primary : c.mutedForeground} />
              <Text style={[
                styles.viewBtnLabel,
                { color: viewMode === "fines" ? c.primary : c.mutedForeground },
                viewMode === "fines" && { fontFamily: "Inter_600SemiBold" },
              ]}>
                Fines
              </Text>
            </TouchableOpacity>
          </View>

          {viewMode === "places" && (
            <View style={styles.headerRight}>
              {isRefreshing ? (
                <View style={[styles.livePill, { backgroundColor: c.muted }]}>
                  <ActivityIndicator size={10} color={c.mutedForeground} style={{ marginRight: 2 }} />
                  <Text style={[styles.liveText, { color: c.mutedForeground }]}>Updating…</Text>
                </View>
              ) : isLive ? (
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
                <Ionicons name="refresh-outline" size={17} color={loading ? c.mutedForeground : c.foreground} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Subtitle + category strip — only for Nearby Places */}
        {viewMode === "places" && (
          <>
            <Text style={[styles.sub, { color: c.mutedForeground }]}>
              {currentLat
                ? `${pois.length} place${pois.length !== 1 ? "s" : ""} within 5 km · tap Go to navigate`
                : "Enable location for live nearby results"}
            </Text>
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
                    <Text style={[styles.tabLabel, { color: active ? t.color : c.mutedForeground }, active && { fontFamily: "Inter_600SemiBold" }]}>
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}
      </View>

      {/* ─── Content ─── */}
      {viewMode === "fines" ? (
        <FinesContent />
      ) : viewMode === "learn" ? (
        <LearnBrowseView bottomInset={bottomInset} tabBarHeight={tabBarHeight} />
      ) : loading ? (
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

      ) : (networkFailure || error === "no-connection") ? (
        <View style={styles.emptyWrap}>
          <View style={[styles.emptyIcon, { backgroundColor: "#F57C0018" }]}>
            <Ionicons name="cloud-offline-outline" size={32} color="#F57C00" />
          </View>
          <Text style={[styles.emptyTitle, { color: c.foreground }]}>No connection</Text>
          <Text style={[styles.emptyBody, { color: c.mutedForeground }]}>
            Could not reach the map server. Check your internet connection and try again.
          </Text>
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: tabMeta.color }]} onPress={() => loadPOIs(activeTab, currentLat, currentLng)}>
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
            No {tabMeta.label.toLowerCase()} spots found within 5 km of your location.
          </Text>
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: tabMeta.color }]} onPress={() => loadPOIs(activeTab, currentLat, currentLng)}>
            <Ionicons name="refresh-outline" size={16} color="#FFF" />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>

      ) : (
        <FlatList
          {...FLAT_LIST_PROPS}
          data={pois}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <POICard poi={item} distance={item.distance} />}
          contentContainerStyle={{ paddingTop: 10, paddingBottom: bottomInset + tabBarHeight + 16 }}
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

  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },

  viewToggle: { flexDirection: "row", borderRadius: 12, padding: 3, flex: 1, marginRight: 8 },
  viewBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 5, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 9,
  },
  viewBtnLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },

  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  refreshBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },

  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 10 },

  tabStrip: { flexDirection: "row", borderRadius: 14, padding: 4, gap: 2 },
  tabBtn: {
    flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: 3, paddingVertical: 8, borderRadius: 10,
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

  errorBanner: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 10 },
  errorText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },

  // ── Learn section ─────────────────────────────────────────────────────────
  learnSearchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: Platform.OS === "ios" ? 9 : 7,
    gap: 7,
  },
  learnSearchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    padding: 0,
  },
  learnSearchResult: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 13,
  },
  learnSearchResultTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 19,
  },
  learnSearchResultExcerpt: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  learnHeader: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 10,
  },
  learnHeaderTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  learnHeaderSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  learnOverallPct: { fontSize: 22, fontFamily: "Inter_700Bold" },

  learnChapter: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderWidth: 1, borderRadius: 16, padding: 16,
  },
  learnChUnit: {
    width: 42, height: 42, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  learnChUnitTxt: { fontSize: 15, fontFamily: "Inter_700Bold" },
  learnChTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 20 },
  learnChSub: { fontSize: 11, fontFamily: "Inter_400Regular" },

  learnProgBg: { height: 5, borderRadius: 3, overflow: "hidden" },
  learnProgFill: { height: 5, borderRadius: 3 },
});
