/**
 * TripRouteMap.tsx — Web fallback for TripRouteMap.native.tsx.
 *
 * react-native-maps is not available on web, so we render a styled
 * placeholder card that shows the start/end coordinates as text.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface Props {
  startLat: number;
  startLng: number;
  endLat?: number | null;
  endLng?: number | null;
}

function coord(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export default function TripRouteMap({ startLat, startLng, endLat, endLng }: Props) {
  const c = useColors();

  return (
    <View style={[styles.wrapper, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
      <Ionicons name="map-outline" size={28} color={c.mutedForeground} style={styles.icon} />

      <View style={styles.rows}>
        <View style={styles.row}>
          <View style={[styles.dot, { backgroundColor: "#00C853" }]} />
          <Text style={[styles.label, { color: c.mutedForeground }]}>Start</Text>
          <Text style={[styles.value, { color: c.foreground }]}>{coord(startLat, startLng)}</Text>
        </View>

        {endLat != null && endLng != null && (
          <View style={styles.row}>
            <View style={[styles.dot, { backgroundColor: "#E53935" }]} />
            <Text style={[styles.label, { color: c.mutedForeground }]}>End</Text>
            <Text style={[styles.value, { color: c.foreground }]}>{coord(endLat, endLng)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    height: 90,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 14,
  },
  icon: { flexShrink: 0 },
  rows: { flex: 1, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
  label: { fontSize: 12, fontFamily: "Inter_500Medium", width: 36 },
  value: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
});
