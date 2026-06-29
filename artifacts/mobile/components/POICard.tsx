import React from "react";
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

export interface POIItem {
  id: string;
  type: "fuel" | "food";
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
  OiLibya: "#E31E24",
  "Java House": "#7B3F20",
  "Chicken Inn": "#C8102E",
  KFC: "#E4002B",
  Artcaffe: "#7D5A50",
  "Nairobi Java House": "#7B3F20",
};

function distStr(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function openGoogleMapsNav(lat: number, lng: number) {
  const gm = Platform.select({
    ios: `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`,
    android: `google.navigation:q=${lat},${lng}&mode=d`,
    default: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
  }) as string;

  Linking.canOpenURL(gm)
    .then((can) => {
      if (can) return Linking.openURL(gm);
      // Fallback to web Google Maps
      return Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
      );
    })
    .catch(console.warn);
}

export default function POICard({
  poi,
  distance,
}: {
  poi: POIItem;
  distance?: number;
}) {
  const c = useColors();
  const brand = poi.brand ?? "";
  const brandColor = BRAND_COLORS[brand] ?? c.primary;
  const isFuel = poi.type === "fuel";

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={[styles.icon, { backgroundColor: brandColor + "25" }]}>
        {isFuel ? (
          <MaterialCommunityIcons name="gas-station" size={22} color={brandColor} />
        ) : (
          <Ionicons name="restaurant-outline" size={22} color={brandColor} />
        )}
      </View>

      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: c.foreground }]} numberOfLines={1}>
            {poi.name}
          </Text>
          {poi.source === "live" && (
            <View style={[styles.liveDot, { backgroundColor: c.speedSafe }]} />
          )}
        </View>
        {poi.address ? (
          <Text style={[styles.addr, { color: c.mutedForeground }]} numberOfLines={1}>
            {poi.address}
          </Text>
        ) : null}
        {poi.hours ? (
          <View style={styles.hoursRow}>
            <Ionicons name="time-outline" size={11} color={c.mutedForeground} />
            <Text style={[styles.hours, { color: c.mutedForeground }]}>{poi.hours}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.rightCol}>
        {distance != null && (
          <Text style={[styles.dist, { color: c.primary }]}>{distStr(distance)}</Text>
        )}
        <TouchableOpacity
          style={[styles.navBtn, { backgroundColor: c.primary }]}
          onPress={() => openGoogleMapsNav(poi.lat, poi.lng)}
          activeOpacity={0.8}
        >
          <Ionicons name="navigate" size={13} color={c.primaryForeground} />
          <Text style={[styles.navBtnText, { color: c.primaryForeground }]}>Go</Text>
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
    width: 42,
    height: 42,
    borderRadius: 10,
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
  navBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
