/**
 * SavedPlaceMapPicker.native.tsx
 * Embedded map with a tap-to-place / draggable pin for picking a saved place location.
 * Used in the Add/Edit Saved Place modal in the Trips tab.
 *
 * When the pin settles (drag end or tap), a reverse-geocode call suggests an
 * address label via `onLocationChange(lat, lng, address?)`.
 */
import React, { useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";

export interface SavedPlaceMapPickerProps {
  initialLat: number;
  initialLng: number;
  onLocationChange: (lat: number, lng: number, address?: string) => void;
  mapHeight?: number;
}

export function SavedPlaceMapPicker({
  initialLat,
  initialLng,
  onLocationChange,
  mapHeight = 240,
}: SavedPlaceMapPickerProps) {
  const mapRef = useRef<MapView>(null);
  const [pos, setPos] = useState({ latitude: initialLat, longitude: initialLng });
  const [reverseLoading, setReverseLoading] = useState(false);
  const reverseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reverseGeocode = async (lat: number, lng: number) => {
    setReverseLoading(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
        { headers: { "User-Agent": "MsafiriKenyaApp/1.0" } }
      );
      const data = await res.json();
      const road =
        data?.address?.road ??
        data?.address?.street ??
        data?.address?.pedestrian ??
        data?.address?.path ??
        "";
      const suburb =
        data?.address?.suburb ??
        data?.address?.neighbourhood ??
        data?.address?.quarter ??
        "";
      const city =
        data?.address?.city ??
        data?.address?.town ??
        data?.address?.county ??
        "";
      const parts = [road, suburb, city].filter(Boolean);
      const address = parts.slice(0, 2).join(", ");
      onLocationChange(lat, lng, address || undefined);
    } catch {
      // Silently ignore — caller already has lat/lng
      onLocationChange(lat, lng);
    } finally {
      setReverseLoading(false);
    }
  };

  const update = (latitude: number, longitude: number) => {
    setPos({ latitude, longitude });
    if (reverseTimer.current) clearTimeout(reverseTimer.current);
    reverseTimer.current = setTimeout(() => reverseGeocode(latitude, longitude), 600);
  };

  return (
    <View style={styles.wrap}>
      <MapView
        ref={mapRef}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        style={[styles.map, { height: mapHeight }]}
        initialRegion={{
          latitude: initialLat,
          longitude: initialLng,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        }}
        onPress={(e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
          const { latitude, longitude } = e.nativeEvent.coordinate;
          update(latitude, longitude);
          mapRef.current?.animateToRegion(
            { latitude, longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 },
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
          onDragEnd={(e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
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
        <View style={styles.footerRow}>
          <Text style={styles.coords}>
            {pos.latitude.toFixed(5)}, {pos.longitude.toFixed(5)}
          </Text>
          {reverseLoading && (
            <ActivityIndicator size="small" color="#9E9E9E" style={{ marginLeft: 6 }} />
          )}
        </View>
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
  map: { height: 240 },
  footer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 3,
    backgroundColor: "#F9F9F9",
  },
  hint: { flexDirection: "row", alignItems: "center", gap: 4 },
  hintTxt: { fontSize: 11, color: "#757575", fontFamily: "Inter_400Regular", flexShrink: 1 },
  footerRow: { flexDirection: "row", alignItems: "center" },
  coords: { fontSize: 11, color: "#9E9E9E", fontFamily: "Inter_400Regular" },
});
