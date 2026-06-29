import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { POI } from "@/data/pois";

const BRAND_COLORS: Record<string, string> = {
  Shell: "#FFCC00",
  Total: "#E40613",
  Rubis: "#0059A8",
  OiLibya: "#E31E24",
  "Java House": "#7B3F20",
  "Chicken Inn": "#C8102E",
  KFC: "#E4002B",
  Artcaffe: "#7D5A50",
};

function distStr(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export default function POICard({ poi, distance }: { poi: POI; distance?: number }) {
  const c = useColors();
  const brandColor = BRAND_COLORS[poi.brand] ?? c.primary;
  const isFuel = poi.type === "fuel";

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      activeOpacity={0.7}
    >
      <View style={[styles.icon, { backgroundColor: brandColor + "25" }]}>
        {isFuel ? (
          <MaterialCommunityIcons name="gas-station" size={22} color={brandColor} />
        ) : (
          <Ionicons name="restaurant-outline" size={22} color={brandColor} />
        )}
      </View>
      <View style={styles.info}>
        <Text style={[styles.name, { color: c.foreground }]} numberOfLines={1}>
          {poi.name}
        </Text>
        <Text style={[styles.addr, { color: c.mutedForeground }]} numberOfLines={1}>
          {poi.address}
        </Text>
        {poi.hours && (
          <View style={styles.hoursRow}>
            <Ionicons name="time-outline" size={11} color={c.mutedForeground} />
            <Text style={[styles.hours, { color: c.mutedForeground }]}>{poi.hours}</Text>
          </View>
        )}
      </View>
      {distance != null && (
        <Text style={[styles.dist, { color: c.primary }]}>{distStr(distance)}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 13,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  info: { flex: 1 },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  addr: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  hoursRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  hours: { fontSize: 11, fontFamily: "Inter_400Regular" },
  dist: { fontSize: 13, fontFamily: "Inter_600SemiBold", minWidth: 48, textAlign: "right" },
});
