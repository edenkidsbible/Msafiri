import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Circle, Marker, Polyline } from "react-native-maps";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useApp } from "@/context/AppContext";
import { SPEED_ZONES } from "@/data/speedZones";
import { POIS } from "@/data/pois";

const NAIROBI = { latitude: -1.2921, longitude: 36.8219, latitudeDelta: 0.08, longitudeDelta: 0.08 };
const POI_RADIUS_M = 8000;

// ─── Colored circle marker — works on all Android versions (no emoji) ─────────
function MarkerIcon({
  name,
  bg,
  size = 30,
  matIcon,
}: {
  name?: React.ComponentProps<typeof Ionicons>["name"];
  bg: string;
  size?: number;
  matIcon?: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 2,
        borderColor: "#FFF",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 3,
        elevation: 5,
      }}
    >
      {matIcon ? (
        <MaterialCommunityIcons name={matIcon} size={size * 0.5} color="#FFF" />
      ) : name ? (
        <Ionicons name={name} size={size * 0.5} color="#FFF" />
      ) : null}
    </View>
  );
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180, Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function DriveMapView() {
  const {
    currentLat, currentLng,
    activeRoute, altRoutes, selectRoute,
    navigationActive, communityReports, showTraffic,
  } = useApp();

  const mapRef = useRef<MapView>(null);
  const now = Date.now();

  const nearbyPOIs = useMemo(() => {
    if (currentLat == null || currentLng == null) return [];
    return POIS.filter((p) => haversine(currentLat, currentLng, p.lat, p.lng) <= POI_RADIUS_M).slice(0, 25);
  }, [currentLat, currentLng]);

  useEffect(() => {
    if (navigationActive || !activeRoute?.coords.length) return;
    const t = setTimeout(() => {
      mapRef.current?.fitToCoordinates(activeRoute.coords, {
        edgePadding: { top: 80, right: 30, bottom: 230, left: 30 },
        animated: true,
      });
    }, 350);
    return () => clearTimeout(t);
  }, [activeRoute?.id, navigationActive]);

  useEffect(() => {
    if (!navigationActive || currentLat == null || currentLng == null) return;
    mapRef.current?.animateCamera(
      { center: { latitude: currentLat, longitude: currentLng }, zoom: 17, pitch: 40 },
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
    >
      {/* Speed zone markers */}
      {SPEED_ZONES.map((z) => (
        <React.Fragment key={z.id}>
          <Marker
            coordinate={{ latitude: z.lat, longitude: z.lng }}
            anchor={{ x: 0.5, y: 1 }}
            title={z.name}
            description={`${z.speedLimit} km/h — ${z.road}`}
          >
            <MarkerIcon
              name={z.type === "camera" ? "camera" : z.type === "police" ? "shield-checkmark" : "speedometer"}
              bg={z.type === "camera" ? "#E53935" : z.type === "police" ? "#1565C0" : "#E65100"}
            />
          </Marker>
          <Circle
            center={{ latitude: z.lat, longitude: z.lng }}
            radius={180}
            strokeColor={z.type === "camera" ? "#E5393555" : "#1565C055"}
            fillColor={z.type === "camera" ? "#E5393912" : "#1565C012"}
            strokeWidth={1.5}
          />
        </React.Fragment>
      ))}

      {/* Community reports */}
      {communityReports.map((r) => {
        const faded = now - r.timestamp > 7200000;
        const iconMap: Record<string, { name: React.ComponentProps<typeof Ionicons>["name"]; bg: string }> = {
          camera:    { name: "camera",          bg: "#E53935" },
          police:    { name: "shield-checkmark",bg: "#1565C0" },
          accident:  { name: "warning",         bg: "#E53935" },
          pothole:   { name: "alert-circle",    bg: "#F57C00" },
          roadblock: { name: "close-circle",    bg: "#7B1FA2" },
          clear:     { name: "checkmark-circle",bg: "#00C853" },
        };
        const m = iconMap[r.type] ?? { name: "alert-circle" as const, bg: "#888" };
        return (
          <Marker
            key={r.id}
            coordinate={{ latitude: r.lat, longitude: r.lng }}
            anchor={{ x: 0.5, y: 1 }}
            opacity={faded ? 0.35 : 1}
            title={r.type.charAt(0).toUpperCase() + r.type.slice(1)}
            description={`${Math.round((now - r.timestamp) / 60000)} min ago`}
          >
            <MarkerIcon name={m.name} bg={m.bg} size={28} />
          </Marker>
        );
      })}

      {/* Nearby POIs */}
      {nearbyPOIs.map((p) => (
        <Marker
          key={p.id}
          coordinate={{ latitude: p.lat, longitude: p.lng }}
          anchor={{ x: 0.5, y: 1 }}
          title={p.name}
          description={p.address}
        >
          <MarkerIcon
            matIcon={p.type === "fuel" ? "gas-station" : undefined}
            name={p.type === "fuel" ? undefined : "restaurant"}
            bg={p.type === "fuel" ? "#2E7D32" : "#BF360C"}
            size={26}
          />
        </Marker>
      ))}

      {/* Alternative routes */}
      {altRoutes.map((r) => (
        <Polyline key={r.id} coordinates={r.coords} strokeColor="#88888877" strokeWidth={5} tappable onPress={() => selectRoute(r)} />
      ))}

      {/* Active route (shadow + fill) */}
      {activeRoute && (
        <>
          <Polyline coordinates={activeRoute.coords} strokeColor={navigationActive ? "#0D47A1AA" : "#1565C0AA"} strokeWidth={10} lineCap="round" lineJoin="round" />
          <Polyline coordinates={activeRoute.coords} strokeColor={navigationActive ? "#1976D2" : "#2196F3"} strokeWidth={6} lineCap="round" lineJoin="round" />
        </>
      )}

      {/* Destination */}
      {activeRoute && activeRoute.coords.length > 0 && (
        <Marker coordinate={activeRoute.coords[activeRoute.coords.length - 1]} anchor={{ x: 0.5, y: 1 }} title="Destination">
          <MarkerIcon name="navigate" bg="#1565C0" size={34} />
        </Marker>
      )}
    </MapView>
  );
}
