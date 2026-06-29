import React, { useMemo, useState } from "react";
import {
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
import { POIS, POI } from "@/data/pois";
import POICard from "@/components/POICard";

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180;
  const f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type Tab = "fuel" | "food";

export default function BrowseScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { currentLat, currentLng } = useApp();
  const [tab, setTab] = useState<Tab>("fuel");
  const [query, setQuery] = useState("");

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const pois = useMemo(() => {
    const filtered = POIS.filter((p) => {
      if (p.type !== tab) return false;
      if (query.length > 1) {
        const q = query.toLowerCase();
        return p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q) || p.address.toLowerCase().includes(q);
      }
      return true;
    });

    if (currentLat && currentLng) {
      return filtered
        .map((p) => ({ ...p, distance: haversine(currentLat, currentLng, p.lat, p.lng) }))
        .sort((a, b) => a.distance - b.distance);
    }
    return filtered.map((p) => ({ ...p, distance: undefined }));
  }, [tab, query, currentLat, currentLng]);

  const renderItem = ({ item }: { item: POI & { distance?: number } }) => (
    <POICard poi={item} distance={item.distance} />
  );

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topInset + 8 }]}>
        <Text style={[styles.title, { color: c.foreground }]}>Nearby Places</Text>
        <Text style={[styles.sub, { color: c.mutedForeground }]}>
          {currentLat ? "Sorted by distance" : "Browse fuel & food stops"}
        </Text>

        {/* Search */}
        <View style={[styles.searchRow, { backgroundColor: c.muted, borderColor: c.border }]}>
          <Ionicons name="search-outline" size={18} color={c.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: c.foreground }]}
            placeholder={`Search ${tab === "fuel" ? "stations" : "restaurants"}…`}
            placeholderTextColor={c.mutedForeground}
            value={query}
            onChangeText={setQuery}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={18} color={c.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        {/* Tabs */}
        <View style={[styles.tabRow, { backgroundColor: c.muted }]}>
          {(["fuel", "food"] as Tab[]).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tabBtn, tab === t && { backgroundColor: c.card }]}
              onPress={() => setTab(t)}
              activeOpacity={0.8}
            >
              <Ionicons
                name={t === "fuel" ? "flame-outline" : "restaurant-outline"}
                size={15}
                color={tab === t ? c.primary : c.mutedForeground}
              />
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

      {/* List */}
      <FlatList
        data={pois as (POI & { distance?: number })[]}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: bottomInset + 100 }}
        showsVerticalScrollIndicator={false}
        scrollEnabled={pois.length > 0}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="search-outline" size={40} color={c.mutedForeground} />
            <Text style={[styles.emptyText, { color: c.mutedForeground }]}>No results found</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2, marginBottom: 14 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  tabRow: {
    flexDirection: "row",
    borderRadius: 12,
    padding: 4,
  },
  tabBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
  },
  tabLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular" },
});
