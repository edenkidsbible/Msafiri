import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";

export interface POIItem {
  id: string;
  type: "fuel" | "food" | "shopping" | "hospital";
  name: string;
  brand?: string;
  address?: string;
  hours?: string;
  lat: number;
  lng: number;
  source?: "live" | "static";
}

const BRAND_COLORS: Record<string, string> = {
  Shell: "#FFCC00",
  Total: "#E40613",
  TotalEnergies: "#E40613",
  Rubis: "#0059A8",
  Astrol: "#1A6B3C",
  OiLibya: "#E31E24",
  "Java House": "#7B3F20",
  "Chicken Inn": "#C8102E",
  KFC: "#E4002B",
  Artcaffe: "#7D5A50",
  "Nairobi Java House": "#7B3F20",
};

const TYPE_META: Record<
  POIItem["type"],
  { defaultColor: string; label: string }
> = {
  fuel:     { defaultColor: "#2E7D32", label: "Fuel Station" },
  food:     { defaultColor: "#BF360C", label: "Restaurant" },
  shopping: { defaultColor: "#1565C0", label: "Shop" },
  hospital: { defaultColor: "#C62828", label: "Hospital" },
};

function distStr(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function POIIcon({ type, color }: { type: POIItem["type"]; color: string }) {
  const sz = 22;
  if (type === "fuel")
    return <MaterialCommunityIcons name="gas-station" size={sz} color={color} />;
  if (type === "shopping")
    return <Ionicons name="storefront-outline" size={sz} color={color} />;
  if (type === "hospital")
    return <Ionicons name="medkit-outline" size={sz} color={color} />;
  return <Ionicons name="restaurant-outline" size={sz} color={color} />;
}

export default function POICard({
  poi,
  distance,
}: {
  poi: POIItem;
  distance?: number;
}) {
  const c = useColors();
  const router = useRouter();
  const { setNavDestination } = useApp();

  const meta = TYPE_META[poi.type];
  const brand = poi.brand ?? "";
  const accentColor = BRAND_COLORS[brand] ?? meta.defaultColor;

  const navigateInApp = () => {
    setNavDestination({ name: poi.name, lat: poi.lat, lng: poi.lng, poiType: poi.type });
    router.push("/");
  };

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={[styles.icon, { backgroundColor: accentColor + "1E" }]}>
        <POIIcon type={poi.type} color={accentColor} />
      </View>

      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: c.foreground }]} numberOfLines={1}>
            {poi.name}
          </Text>
          {poi.source === "live" && (
            <View style={[styles.liveDot, { backgroundColor: "#00C853" }]} />
          )}
        </View>
        {!!poi.address && (
          <Text style={[styles.addr, { color: c.mutedForeground }]} numberOfLines={1}>
            {poi.address}
          </Text>
        )}
        {!!poi.hours && (
          <View style={styles.hoursRow}>
            <Ionicons name="time-outline" size={11} color={c.mutedForeground} />
            <Text style={[styles.hours, { color: c.mutedForeground }]}>{poi.hours}</Text>
          </View>
        )}
      </View>

      <View style={styles.rightCol}>
        {distance != null && (
          <Text style={[styles.dist, { color: accentColor }]}>{distStr(distance)}</Text>
        )}
        <TouchableOpacity
          style={[styles.navBtn, { backgroundColor: accentColor }]}
          onPress={navigateInApp}
          activeOpacity={0.8}
        >
          <Ionicons name="navigate" size={13} color="#FFF" />
          <Text style={styles.navBtnText}>Go</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 9,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  info: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  liveDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  addr: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  hoursRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  hours: { fontSize: 11, fontFamily: "Inter_400Regular" },
  rightCol: { alignItems: "flex-end", gap: 6, flexShrink: 0 },
  dist: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  navBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  navBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#FFF" },
});
