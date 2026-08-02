/**
 * SavedPlaceMapPicker.native.tsx
 * Center-crosshair location picker for the Add/Edit Saved Place flow.
 * Replaces the old draggable-Marker pattern: a static pin sits at the map
 * center while the user pans the map underneath it. This eliminates the
 * two-concurrent-MapView native crash that occurred because DriveMapView's
 * MapView was still alive on the background tab while this one was rendered
 * inside a modal.
 *
 * mapPickerActive is set on mount so DriveMapView unmounts its MapView for
 * the duration, ensuring a single native map surface is alive at any time.
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { CrosshairMap } from "./CrosshairPicker";
import { useApp } from "@/context/AppContext";

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
  const { setMapPickerActive } = useApp();
  const [coords, setCoords] = useState({ lat: initialLat, lng: initialLng });
  const [reverseLoading, setReverseLoading] = useState(false);

  // Pause DriveMapView's MapView for the lifetime of this component.
  useEffect(() => {
    setMapPickerActive(true);
    return () => setMapPickerActive(false);
  }, [setMapPickerActive]);

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
      onLocationChange(lat, lng);
    } finally {
      setReverseLoading(false);
    }
  };

  const geocodeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (lat: number, lng: number) => {
    setCoords({ lat, lng });
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    geocodeTimer.current = setTimeout(() => reverseGeocode(lat, lng), 600);
  };

  return (
    <View style={[styles.wrap, { height: mapHeight + 44 }]}>
      <View style={{ flex: 1 }}>
        <CrosshairMap
          initialLat={initialLat}
          initialLng={initialLng}
          initialDelta={0.005}
          onCoordinateChange={handleChange}
        />
      </View>
      <View style={styles.footer}>
        <View style={styles.hint}>
          <Text style={styles.hintTxt}>Pan the map to place the pin</Text>
        </View>
        <View style={styles.footerRow}>
          <Text style={styles.coords}>
            {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
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
