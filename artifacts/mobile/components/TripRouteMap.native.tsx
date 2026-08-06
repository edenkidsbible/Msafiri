/**
 * TripRouteMap.native.tsx — Compact static map showing a trip's start/end pins.
 *
 * Renders a non-interactive MapView (scrollEnabled=false) sized to fit inside
 * the trip-detail ScrollView. Automatically fits the camera to include both
 * markers (or just the start point if no end was recorded).
 */

import React, { useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";

interface Props {
  startLat: number;
  startLng: number;
  endLat?: number | null;
  endLng?: number | null;
}

const PAD = 0.008; // ~900 m padding around a single point

/** Compute the region that fits both markers with generous padding. */
function computeRegion(
  startLat: number,
  startLng: number,
  endLat: number | null | undefined,
  endLng: number | null | undefined,
) {
  const hasEnd = endLat != null && endLng != null;

  if (!hasEnd) {
    return {
      latitude: startLat,
      longitude: startLng,
      latitudeDelta: PAD * 3,
      longitudeDelta: PAD * 3,
    };
  }

  const minLat = Math.min(startLat, endLat!);
  const maxLat = Math.max(startLat, endLat!);
  const minLng = Math.min(startLng, endLng!);
  const maxLng = Math.max(startLng, endLng!);

  const latDelta = Math.max((maxLat - minLat) * 1.6, PAD * 3);
  const lngDelta = Math.max((maxLng - minLng) * 1.6, PAD * 3);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: latDelta,
    longitudeDelta: lngDelta,
  };
}

export default function TripRouteMap({ startLat, startLng, endLat, endLng }: Props) {
  const mapRef = useRef<MapView>(null);
  const region = computeRegion(startLat, startLng, endLat, endLng);

  return (
    <View style={styles.wrapper}>
      <MapView
        ref={mapRef}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        liteMode={Platform.OS === "android"} // lightweight static tile on Android
      >
        {/* Start pin — green */}
        <Marker
          coordinate={{ latitude: startLat, longitude: startLng }}
          pinColor="#00C853"
          title="Start"
          tracksViewChanges={false}
        />

        {/* End pin — red (only when end coords are available) */}
        {endLat != null && endLng != null && (
          <Marker
            coordinate={{ latitude: endLat, longitude: endLng }}
            pinColor="#E53935"
            title="End"
            tracksViewChanges={false}
          />
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    height: 200,
    borderRadius: 16,
    overflow: "hidden",
    marginTop: 12,
  },
});
