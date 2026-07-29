import React, { forwardRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

export type DriveMapViewHandle = { recenter: () => void };

const DriveMapView = forwardRef(function DriveMapView(
  _: { mapDrifted?: boolean; onDriftChange?: (drifted: boolean) => void },
  ref: React.ForwardedRef<DriveMapViewHandle>,
) {
  const c = useColors();
  return (
    <View style={[styles.container, { backgroundColor: c.muted }]}>
      <Ionicons name="map-outline" size={40} color={c.mutedForeground} />
      <Text style={[styles.text, { color: c.mutedForeground }]}>
        Live map available on the mobile app
      </Text>
    </View>
  );
});

export default DriveMapView;

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  text: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingHorizontal: 32,
  },
});
