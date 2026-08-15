/**
 * AccidentLocationMap.native.tsx — Compact static map for a single incident pin.
 *
 * Drops a red marker at the accident lat/lng inside a non-interactive MapView,
 * mirroring TripRouteMap but for a single point rather than a route.
 */

import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";

interface Props {
  lat: number;
  lng: number;
}

const PAD = 0.006; // ~650 m zoom — tight enough to show street context

export default function AccidentLocationMap({ lat, lng }: Props) {
  return (
    <View style={styles.wrapper}>
      <MapView
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude:      lat,
          longitude:     lng,
          latitudeDelta: PAD * 3,
          longitudeDelta: PAD * 3,
        }}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        liteMode={Platform.OS === "android"}
      >
        <Marker
          coordinate={{ latitude: lat, longitude: lng }}
          pinColor="#E53935"
          title="Incident location"
          tracksViewChanges={false}
        />
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    height: 180,
    borderRadius: 14,
    overflow: "hidden",
    marginTop: 10,
  },
});
