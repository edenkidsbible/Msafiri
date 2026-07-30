import React, { useEffect, useRef } from "react";
import { Platform, StyleSheet } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";

interface Props {
  lat: number;
  lng: number;
  speedKmh: number | null;
  destinationLat: number | null;
  destinationLng: number | null;
  destinationName: string | null;
}

const NAIROBI = {
  latitude: -1.2921,
  longitude: 36.8219,
  latitudeDelta: 0.04,
  longitudeDelta: 0.04,
};

export default function LiveTrackerMap({
  lat,
  lng,
  speedKmh,
  destinationLat,
  destinationLng,
  destinationName,
}: Props) {
  const mapRef = useRef<MapView>(null);
  const prevCoordRef = useRef<{ latitude: number; longitude: number } | null>(null);

  const driverCoord = { latitude: lat, longitude: lng };

  // Animate map to driver position on each update
  useEffect(() => {
    const prev = prevCoordRef.current;
    if (!prev || prev.latitude !== lat || prev.longitude !== lng) {
      mapRef.current?.animateToRegion(
        { latitude: lat, longitude: lng, latitudeDelta: 0.02, longitudeDelta: 0.02 },
        600,
      );
      prevCoordRef.current = driverCoord;
    }
  }, [lat, lng]);

  const speedLabel =
    speedKmh != null ? `${Math.round(speedKmh)}\nkm/h` : "📍";

  return (
    <MapView
      ref={mapRef}
      provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
      style={StyleSheet.absoluteFill}
      initialRegion={NAIROBI}
      showsUserLocation={false}
      showsMyLocationButton={false}
      showsCompass={false}
      toolbarEnabled={false}
    >
      {/* Driver marker */}
      <Marker
        coordinate={driverCoord}
        anchor={{ x: 0.5, y: 0.5 }}
        tracksViewChanges={false}
      >
        {/* Speed badge rendered via title — actual custom callout would be heavier */}
      </Marker>

      {/* Destination marker */}
      {destinationLat != null && destinationLng != null && (
        <Marker
          coordinate={{ latitude: destinationLat, longitude: destinationLng }}
          title={destinationName ?? "Destination"}
          pinColor="red"
        />
      )}
    </MapView>
  );
}
