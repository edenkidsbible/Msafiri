import React, { useRef, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import MapView, { Circle, Marker, Polyline } from "react-native-maps";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { SPEED_ZONES } from "@/data/speedZones";
import ReportModal from "@/components/ReportModal";

const NAIROBI = { latitude: -1.2921, longitude: 36.8219, latitudeDelta: 0.15, longitudeDelta: 0.15 };

// Emoji for each marker type
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

function EmojiMarker({ emoji, size = 26 }: { emoji: string; size?: number }) {
  return (
    <View style={styles.emojiWrap}>
      <Text style={{ fontSize: size }}>{emoji}</Text>
    </View>
  );
}

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

  const handleReport = (
    type: "camera" | "police" | "accident" | "pothole" | "roadblock" | "clear"
  ) => {
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
        {/* Speed zone markers — emoji */}
        {SPEED_ZONES.map((z) => (
          <React.Fragment key={z.id}>
            <Marker
              coordinate={{ latitude: z.lat, longitude: z.lng }}
              anchor={{ x: 0.5, y: 1 }}
              title={z.name}
              description={`${z.speedLimit} km/h — ${z.road}`}
            >
              <EmojiMarker emoji={ZONE_EMOJI[z.type] ?? "🚦"} />
            </Marker>
            <Circle
              center={{ latitude: z.lat, longitude: z.lng }}
              radius={200}
              strokeColor={z.type === "camera" ? "#E5393540" : "#1565C040"}
              fillColor={z.type === "camera" ? "#E5393510" : "#1565C010"}
              strokeWidth={1}
            />
          </React.Fragment>
        ))}

        {/* Community reports — emoji */}
        {communityReports.map((r) => {
          const faded = now - r.timestamp > 7200000;
          return (
            <Marker
              key={r.id}
              coordinate={{ latitude: r.lat, longitude: r.lng }}
              anchor={{ x: 0.5, y: 1 }}
              opacity={faded ? 0.4 : 1}
              title={r.type.charAt(0).toUpperCase() + r.type.slice(1)}
              description={`Reported ${Math.round((now - r.timestamp) / 60000)} min ago`}
            >
              <EmojiMarker emoji={REPORT_EMOJI[r.type] ?? "📍"} />
            </Marker>
          );
        })}

        {/* Alternative routes (drawn behind primary) */}
        {altRoutes.map((r) => (
          <Polyline
            key={r.id}
            coordinates={r.coords}
            strokeColor="#88888888"
            strokeWidth={4}
            tappable
            onPress={() => selectRoute(r)}
          />
        ))}

        {/* Active route */}
        {activeRoute && (
          <Polyline
            coordinates={activeRoute.coords}
            strokeColor={navigationActive ? "#1565C0" : c.primary}
            strokeWidth={6}
            lineCap="round"
            lineJoin="round"
          />
        )}

        {/* Destination pin */}
        {activeRoute && activeRoute.coords.length > 0 && (
          <Marker
            coordinate={activeRoute.coords[activeRoute.coords.length - 1]}
            anchor={{ x: 0.5, y: 1 }}
            title="Destination"
          >
            <EmojiMarker emoji="📍" size={30} />
          </Marker>
        )}
      </MapView>

      {/* Legend */}
      <View style={[styles.legend, { backgroundColor: c.card + "EE", top: insets.top + 12 }]}>
        {[
          { emoji: "📷", label: "Camera" },
          { emoji: "🚔", label: "Police" },
          { emoji: "🚦", label: "Zone" },
          { emoji: "🚨", label: "Accident" },
          { emoji: "🚧", label: "Roadblock" },
        ].map((l) => (
          <View key={l.label} style={styles.legendRow}>
            <Text style={{ fontSize: 13 }}>{l.emoji}</Text>
            <Text style={[styles.legendText, { color: c.foreground }]}>{l.label}</Text>
          </View>
        ))}
      </View>

      {/* Right-side controls */}
      <View style={[styles.controls, { bottom: insets.bottom + 96 }]}>
        {/* Traffic toggle */}
        <TouchableOpacity
          style={[styles.controlBtn, { backgroundColor: showTraffic ? c.primary : c.card }]}
          onPress={() => setShowTraffic(!showTraffic)}
        >
          <Text style={{ fontSize: 18 }}>🚗</Text>
        </TouchableOpacity>

        {/* Fit to route */}
        {activeRoute && (
          <TouchableOpacity style={[styles.controlBtn, { backgroundColor: c.card }]} onPress={fitToRoute}>
            <Ionicons name="expand-outline" size={20} color={c.primary} />
          </TouchableOpacity>
        )}

        {/* Locate me */}
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
        <Text style={{ fontSize: 16 }}>🚨</Text>
        <Text style={[styles.reportBtnText, { color: c.primaryForeground }]}>Report</Text>
      </TouchableOpacity>

      {/* Traffic indicator */}
      {showTraffic && (
        <View style={[styles.trafficBadge, { backgroundColor: c.primary, bottom: insets.bottom + 154 }]}>
          <Text style={{ fontSize: 12 }}>🚗</Text>
          <Text style={[styles.trafficLabel, { color: c.primaryForeground }]}>Traffic On</Text>
        </View>
      )}

      <ReportModal visible={showReport} onClose={() => setShowReport(false)} onSubmit={handleReport} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emojiWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  legend: {
    position: "absolute",
    left: 12,
    borderRadius: 12,
    padding: 10,
    gap: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 6,
  },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  controls: {
    position: "absolute",
    right: 12,
    flexDirection: "column",
    gap: 10,
  },
  controlBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 5,
    elevation: 5,
  },
  reportBtn: {
    position: "absolute",
    right: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  reportBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  trafficBadge: {
    position: "absolute",
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  trafficLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
