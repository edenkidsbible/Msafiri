import React, { useRef, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import MapView, { Circle, Marker, Polyline } from "react-native-maps";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { SPEED_ZONES } from "@/data/speedZones";
import ReportModal from "@/components/ReportModal";

const NAIROBI = { latitude: -1.2921, longitude: 36.8219, latitudeDelta: 0.15, longitudeDelta: 0.15 };

// Colored circle icon marker — Ionicons-based, works on all Android versions
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
    <View style={[styles.markerCircle, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}>
      {matIcon ? (
        <MaterialCommunityIcons name={matIcon} size={size * 0.5} color="#FFF" />
      ) : name ? (
        <Ionicons name={name} size={size * 0.5} color="#FFF" />
      ) : null}
    </View>
  );
}

const ZONE_MARKER: Record<string, { name: React.ComponentProps<typeof Ionicons>["name"]; bg: string }> = {
  camera: { name: "camera",          bg: "#E53935" },
  police: { name: "shield-checkmark",bg: "#1565C0" },
  zone:   { name: "speedometer",     bg: "#E65100" },
};
const REPORT_MARKER: Record<string, { name: React.ComponentProps<typeof Ionicons>["name"]; bg: string }> = {
  camera:    { name: "camera",          bg: "#E53935" },
  police:    { name: "shield-checkmark",bg: "#1565C0" },
  accident:  { name: "warning",         bg: "#E53935" },
  pothole:   { name: "alert-circle",    bg: "#F57C00" },
  roadblock: { name: "close-circle",    bg: "#7B1FA2" },
  clear:     { name: "checkmark-circle",bg: "#00C853" },
};

const LEGEND_ITEMS = [
  { icon: "camera" as const,          bg: "#E53935", label: "Camera" },
  { icon: "shield-checkmark" as const,bg: "#1565C0", label: "Police" },
  { icon: "speedometer" as const,     bg: "#E65100", label: "Zone" },
  { icon: "warning" as const,         bg: "#E53935", label: "Accident" },
  { icon: "close-circle" as const,    bg: "#7B1FA2", label: "Roadblock" },
];

export default function MapViewScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    currentLat, currentLng,
    communityReports, addReport,
    activeRoute, altRoutes, selectRoute,
    navigationActive,
    showTraffic, setShowTraffic,
  } = useApp();

  const [showReport, setShowReport] = useState(false);
  const mapRef = useRef<MapView>(null);
  const now = Date.now();

  const handleReport = (type: "camera" | "police" | "accident" | "pothole" | "roadblock" | "clear") => {
    if (currentLat && currentLng) addReport(type, currentLat, currentLng);
    setShowReport(false);
  };

  const centerOnUser = () => {
    if (mapRef.current && currentLat && currentLng) {
      mapRef.current.animateToRegion(
        { latitude: currentLat, longitude: currentLng, latitudeDelta: 0.04, longitudeDelta: 0.04 },
        600
      );
    }
  };

  const fitToRoute = () => {
    if (mapRef.current && activeRoute?.coords.length) {
      mapRef.current.fitToCoordinates(activeRoute.coords, {
        edgePadding: { top: 80, right: 40, bottom: 120, left: 40 },
        animated: true,
      });
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={
          currentLat && currentLng
            ? { latitude: currentLat, longitude: currentLng, latitudeDelta: 0.08, longitudeDelta: 0.08 }
            : NAIROBI
        }
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass
        showsTraffic={showTraffic}
      >
        {/* Speed zone markers */}
        {SPEED_ZONES.map((z) => {
          const m = ZONE_MARKER[z.type] ?? ZONE_MARKER.zone;
          return (
            <React.Fragment key={z.id}>
              <Marker
                coordinate={{ latitude: z.lat, longitude: z.lng }}
                anchor={{ x: 0.5, y: 1 }}
                title={z.name}
                description={`${z.speedLimit} km/h — ${z.road}`}
              >
                <MarkerIcon name={m.name} bg={m.bg} />
              </Marker>
              <Circle
                center={{ latitude: z.lat, longitude: z.lng }}
                radius={200}
                strokeColor={z.type === "camera" ? "#E5393540" : "#1565C040"}
                fillColor={z.type === "camera" ? "#E5393910" : "#1565C010"}
                strokeWidth={1}
              />
            </React.Fragment>
          );
        })}

        {/* Community reports */}
        {communityReports.map((r) => {
          const faded = now - r.timestamp > 7200000;
          const m = REPORT_MARKER[r.type] ?? { name: "alert-circle" as const, bg: "#888" };
          return (
            <Marker
              key={r.id}
              coordinate={{ latitude: r.lat, longitude: r.lng }}
              anchor={{ x: 0.5, y: 1 }}
              opacity={faded ? 0.4 : 1}
              title={r.type.charAt(0).toUpperCase() + r.type.slice(1)}
              description={`${Math.round((now - r.timestamp) / 60000)} min ago`}
            >
              <MarkerIcon name={m.name} bg={m.bg} size={28} />
            </Marker>
          );
        })}

        {/* Alternative routes */}
        {altRoutes.map((r) => (
          <Polyline key={r.id} coordinates={r.coords} strokeColor="#88888888" strokeWidth={4} tappable onPress={() => selectRoute(r)} />
        ))}

        {/* Active route */}
        {activeRoute && (
          <Polyline
            coordinates={activeRoute.coords}
            strokeColor={navigationActive ? "#1565C0" : "#2196F3"}
            strokeWidth={6} lineCap="round" lineJoin="round"
          />
        )}

        {/* Destination */}
        {activeRoute && activeRoute.coords.length > 0 && (
          <Marker coordinate={activeRoute.coords[activeRoute.coords.length - 1]} anchor={{ x: 0.5, y: 1 }} title="Destination">
            <MarkerIcon name="navigate" bg="#1565C0" size={34} />
          </Marker>
        )}
      </MapView>

      {/* Legend */}
      <View style={[styles.legend, { backgroundColor: c.card + "EE", top: insets.top + 12 }]}>
        {LEGEND_ITEMS.map((l) => (
          <View key={l.label} style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: l.bg }]}>
              <Ionicons name={l.icon} size={8} color="#FFF" />
            </View>
            <Text style={[styles.legendText, { color: c.foreground }]}>{l.label}</Text>
          </View>
        ))}
      </View>

      {/* Right controls */}
      <View style={[styles.controls, { bottom: insets.bottom + 96 }]}>
        <TouchableOpacity style={[styles.controlBtn, { backgroundColor: showTraffic ? c.primary : c.card }]} onPress={() => setShowTraffic(!showTraffic)}>
          <Ionicons name="car" size={20} color={showTraffic ? "#FFF" : c.primary} />
        </TouchableOpacity>
        {activeRoute && (
          <TouchableOpacity style={[styles.controlBtn, { backgroundColor: c.card }]} onPress={fitToRoute}>
            <Ionicons name="expand-outline" size={20} color={c.primary} />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.controlBtn, { backgroundColor: c.card }]} onPress={centerOnUser}>
          <Ionicons name="locate-outline" size={22} color={c.primary} />
        </TouchableOpacity>
      </View>

      {/* Report button */}
      <TouchableOpacity
        style={[styles.reportBtn, { backgroundColor: c.primary, bottom: insets.bottom + 96 }]}
        onPress={() => setShowReport(true)}
        activeOpacity={0.88}
      >
        <Ionicons name="warning" size={16} color="#FFF" />
        <Text style={[styles.reportBtnText, { color: "#FFF" }]}>Report</Text>
      </TouchableOpacity>

      {showTraffic && (
        <View style={[styles.trafficBadge, { backgroundColor: c.primary, bottom: insets.bottom + 150 }]}>
          <Ionicons name="car" size={12} color="#FFF" />
          <Text style={[styles.trafficLabel, { color: "#FFF" }]}>Traffic On</Text>
        </View>
      )}

      <ReportModal visible={showReport} onClose={() => setShowReport(false)} onSubmit={handleReport} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  markerCircle: {
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#FFF",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 3, elevation: 5,
  },
  legend: {
    position: "absolute", left: 12,
    borderRadius: 12, padding: 10, gap: 6,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 6, elevation: 6,
  },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  legendDot: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  legendText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  controls: { position: "absolute", right: 12, flexDirection: "column", gap: 10 },
  controlBtn: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 5, elevation: 5,
  },
  reportBtn: {
    position: "absolute", right: 70,
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 28,
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 8,
  },
  reportBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  trafficBadge: {
    position: "absolute", right: 12,
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14,
  },
  trafficLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
