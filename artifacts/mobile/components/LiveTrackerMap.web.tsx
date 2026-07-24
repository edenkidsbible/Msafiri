import React from "react";
import { StyleSheet, Text, View } from "react-native";

// Web — react-native-maps is not available; show a simple coordinate card.
interface Props {
  lat: number;
  lng: number;
  speedKmh: number | null;
  destinationLat: number | null;
  destinationLng: number | null;
  destinationName: string | null;
}

export default function LiveTrackerMap({ lat, lng, speedKmh, destinationName }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.coords}>
        {lat.toFixed(5)}, {lng.toFixed(5)}
      </Text>
      {speedKmh != null && (
        <Text style={styles.speed}>{Math.round(speedKmh)} km/h</Text>
      )}
      {destinationName ? (
        <Text style={styles.dest}>→ {destinationName}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e8f0fe",
    gap: 8,
  },
  coords: {
    fontSize: 14,
    color: "#444",
    fontFamily: "monospace",
  },
  speed: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1A73E8",
  },
  dest: {
    fontSize: 13,
    color: "#555",
  },
});
