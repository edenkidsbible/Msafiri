import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { POIItem } from "@/components/POICard";

interface Props {
  pois: (POIItem & { distance?: number })[];
  tab: "fuel" | "food";
  userLat: number | null;
  userLng: number | null;
  onGo: (poi: POIItem) => void;
}

export default function BrowseMapView({ pois, tab }: Props) {
  const c = useColors();
  const count = pois.filter((p) => p.type === tab).length;
  return (
    <View style={[styles.container, { backgroundColor: c.muted }]}>
      <Ionicons name="map-outline" size={44} color={c.mutedForeground} />
      <Text style={[styles.text, { color: c.foreground }]}>
        {count} {tab === "fuel" ? "fuel stations" : "restaurants"} nearby
      </Text>
      <Text style={[styles.sub, { color: c.mutedForeground }]}>
        Interactive map is available on the mobile app
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  text: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 32 },
});
