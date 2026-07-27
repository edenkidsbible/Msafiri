/**
 * MapPinPicker.native.tsx
 * Embedded map with a tap-to-place / draggable pin for picking a precise location.
 * Used inside ReportModal for the "Pin on Map" location mode.
 */
import React, { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";

export interface MapPinPickerProps {
  initialLat: number;
  initialLng: number;
  onLocationChange: (lat: number, lng: number) => void;
}

export function MapPinPicker({ initialLat, initialLng, onLocationChange }: MapPinPickerProps) {
  const mapRef = useRef<MapView>(null);
  const [pos, setPos] = useState({ latitude: initialLat, longitude: initialLng });

  const update = (latitude: number, longitude: number) => {
    setPos({ latitude, longitude });
    onLocationChange(latitude, longitude);
  };

  return (
    <View style={styles.wrap}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={{
          latitude: initialLat,
          longitude: initialLng,
          latitudeDelta: 0.004,
          longitudeDelta: 0.004,
        }}
        onPress={(e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
          const { latitude, longitude } = e.nativeEvent.coordinate;
          update(latitude, longitude);
          mapRef.current?.animateToRegion(
            { latitude, longitude, latitudeDelta: 0.004, longitudeDelta: 0.004 },
            200
          );
        }}
        scrollEnabled
        zoomEnabled
        rotateEnabled={false}
        pitchEnabled={false}
      >
        <Marker
          coordinate={pos}
          draggable
          onDragEnd={(e) => {
            const { latitude, longitude } = e.nativeEvent.coordinate;
            update(latitude, longitude);
          }}
        />
      </MapView>
      <View style={styles.footer}>
        <View style={styles.hint}>
          <Ionicons name="information-circle-outline" size={12} color="#757575" />
          <Text style={styles.hintTxt}>Tap the map or drag the pin to set location</Text>
        </View>
        <Text style={styles.coords}>
          {pos.latitude.toFixed(5)}, {pos.longitude.toFixed(5)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#DDD",
  },
  map: { height: 220 },
  footer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
    backgroundColor: "#F9F9F9",
  },
  hint: { flexDirection: "row", alignItems: "center", gap: 4 },
  hintTxt: { fontSize: 11, color: "#757575", fontFamily: "Inter_400Regular", flexShrink: 1 },
  coords: { fontSize: 11, color: "#9E9E9E", fontFamily: "Inter_400Regular" },
});
