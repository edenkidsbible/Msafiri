/**
 * MapPinPicker.tsx — web stub
 * The full map picker is native-only (react-native-maps). On web we show a notice.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export interface MapPinPickerProps {
  initialLat: number;
  initialLng: number;
  onLocationChange: (lat: number, lng: number) => void;
}

export function MapPinPicker(_props: MapPinPickerProps) {
  return (
    <View style={styles.wrap}>
      <Ionicons name="map-outline" size={18} color="#9E9E9E" />
      <Text style={styles.txt}>Map pin is available on the mobile app</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: 72,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#DDD",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#FAFAFA",
  },
  txt: { fontSize: 13, color: "#9E9E9E", fontFamily: "Inter_400Regular" },
});
