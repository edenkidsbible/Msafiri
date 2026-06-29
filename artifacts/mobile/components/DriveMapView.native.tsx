import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Circle, Marker, Polyline } from "react-native-maps";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { SPEED_ZONES } from "@/data/speedZones";
import { POIS } from "@/data/pois";

const NAIROBI = { latitude: -1.2921, longitude: 36.8219, latitudeDelta: 0.08, longitudeDelta: 0.08 };
const POI_RADIUS_M = 8000;

const ZONE_EMOJI: Record<string, string> = {
  camera: "📷",
  police: "🚔",
  zone: "🚦",
};
const REPORT_EMOJI: Record<string, string> = {
  camera: "📷",
  police: "🚔",
  accident: "🚨",
  pothole: "🕳️",
  roadblock: "🚧",
  clear: "✅",
};
const POI_EMOJI: Record<string, string> = {
  fuel: "⛽",
  food: "🍽️",
};

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function DriveMapView() {
  const c = useColors();
  const {
    currentLat,
    currentLng,
    activeRoute,
    altRoutes,
    selectRoute,
    navigationActive,
    communityReports,
    showTraffic,
  } = useApp();

  const mapRef = useRef<MapView>(null);
  const now = Date.now();

  // Nearby static POIs within POI_RADIUS_M
  const nearbyPOIs = useMemo(() => {
    if (currentLat == null || currentLng == null) return [];
    return POIS.filter(
      (p) => haversine(currentLat, currentLng, p.lat, p.lng) <= POI_RADIUS_M
    ).slice(0, 30);
  }, [currentLat, currentLng]);

  // Auto-fit to full route when route is set (not navigating)
  useEffect(() => {
    if (navigationActive || !activeRoute?.coords.length) return;
    const timer = setTimeout(() => {
      mapRef.current?.fitToCoordinates(activeRoute.coords, {
        edgePadding: { top: 80, right: 30, bottom: 230, left: 30 },
        animated: true,
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [activeRoute?.id, navigationActive]);

  // Follow driver at street-level zoom during navigation
  useEffect(() => {
    if (!navigationActive || currentLat == null || currentLng == null) return;
    mapRef.current?.animateCamera(
      {
        center: { latitude: currentLat, longitude: currentLng },
        zoom: 17,
        pitch: 40,
      },
      { duration: 900 }
    );
  }, [navigationActive, currentLat, currentLng]);

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={
        currentLat != null && currentLng != null
          ? { latitude: currentLat, longitude: currentLng, latitudeDelta: 0.05, longitudeDelta: 0.05 }
          : NAIROBI
      }
      showsUserLocation
      showsMyLocationButton={false}
      showsCompass
      showsTraffic={showTraffic}
      mapType="standard"
    >
      {/* ── Speed zone markers ── */}
      {SPEED_ZONES.map((z) => (
        <React.Fragment key={z.id}>
          <Marker
            coordinate={{ latitude: z.lat, longitude: z.lng }}
            anchor={{ x: 0.5, y: 1 }}
            title={z.name}
            description={`${z.speedLimit} km/h — ${z.road}`}
          >
            <Text style={styles.markerEmoji}>{ZONE_EMOJI[z.type] ?? "🚦"}</Text>
          </Marker>
          <Circle
            center={{ latitude: z.lat, longitude: z.lng }}
            radius={180}
            strokeColor={z.type === "camera" ? "#E5393555" : "#1565C055"}
            fillColor={z.type === "camera" ? "#E5393512" : "#1565C012"}
            strokeWidth={1.5}
          />
        </React.Fragment>
      ))}

      {/* ── Community reports ── */}
      {communityReports.map((r) => {
        const faded = now - r.timestamp > 7200000;
        return (
          <Marker
            key={r.id}
            coordinate={{ latitude: r.lat, longitude: r.lng }}
            anchor={{ x: 0.5, y: 1 }}
            opacity={faded ? 0.35 : 1}
            title={r.type.charAt(0).toUpperCase() + r.type.slice(1)}
            description={`Reported ${Math.round((now - r.timestamp) / 60000)} min ago`}
          >
            <Text style={styles.markerEmoji}>{REPORT_EMOJI[r.type] ?? "📍"}</Text>
          </Marker>
        );
      })}

      {/* ── Nearby POIs (fuel + food) ── */}
      {nearbyPOIs.map((p) => (
        <Marker
          key={p.id}
          coordinate={{ latitude: p.lat, longitude: p.lng }}
          anchor={{ x: 0.5, y: 1 }}
          title={p.name}
          description={p.address}
        >
          <View style={styles.poiMarker}>
            <Text style={styles.poiEmoji}>{POI_EMOJI[p.type] ?? "📍"}</Text>
            <View style={[styles.poiLabel, { backgroundColor: c.card + "EE" }]}>
              <Text style={[styles.poiLabelText, { color: c.foreground }]} numberOfLines={1}>
                {p.brand || p.name.split(" ")[0]}
              </Text>
            </View>
          </View>
        </Marker>
      ))}

      {/* ── Alternative routes (grey, tappable) ── */}
      {altRoutes.map((r) => (
        <Polyline
          key={r.id}
          coordinates={r.coords}
          strokeColor="#88888877"
          strokeWidth={5}
          tappable
          onPress={() => selectRoute(r)}
        />
      ))}

      {/* ── Active route ── */}
      {activeRoute && (
        <>
          {/* Route outline (shadow) */}
          <Polyline
            coordinates={activeRoute.coords}
            strokeColor={navigationActive ? "#0D47A1AA" : "#1565C0AA"}
            strokeWidth={10}
            lineCap="round"
            lineJoin="round"
          />
          {/* Route fill */}
          <Polyline
            coordinates={activeRoute.coords}
            strokeColor={navigationActive ? "#1976D2" : "#2196F3"}
            strokeWidth={6}
            lineCap="round"
            lineJoin="round"
          />
        </>
      )}

      {/* ── Destination pin ── */}
      {activeRoute && activeRoute.coords.length > 0 && (
        <Marker
          coordinate={activeRoute.coords[activeRoute.coords.length - 1]}
          anchor={{ x: 0.5, y: 1 }}
          title="Destination"
        >
          <Text style={{ fontSize: 32 }}>📍</Text>
        </Marker>
      )}
    </MapView>
  );
}

const styles = StyleSheet.create({
  markerEmoji: { fontSize: 24 },
  poiMarker: { alignItems: "center" },
  poiEmoji: { fontSize: 20 },
  poiLabel: {
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginTop: 2,
    maxWidth: 72,
  },
  poiLabelText: { fontSize: 9, fontFamily: "Inter_500Medium" },
});
