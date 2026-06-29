import React, { useRef, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import MapView, { Circle, Marker } from "react-native-maps";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { SPEED_ZONES } from "@/data/speedZones";
import ReportModal from "@/components/ReportModal";

const NAIROBI = { latitude: -1.2921, longitude: 36.8219, latitudeDelta: 0.15, longitudeDelta: 0.15 };

const REPORT_COLORS: Record<string, string> = {
  camera: "#E53935", police: "#1565C0", accident: "#F44336",
  pothole: "#F57C00", roadblock: "#7B1FA2", clear: "#00C853",
};

export default function MapViewScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { currentLat, currentLng, communityReports, addReport } = useApp();
  const [showReport, setShowReport] = useState(false);
  const mapRef = useRef<MapView>(null);
  const now = Date.now();

  const handleReport = (type: "camera" | "police" | "accident" | "pothole" | "roadblock" | "clear") => {
    if (currentLat && currentLng) addReport(type, currentLat, currentLng);
    setShowReport(false);
  };

  const centerOnUser = () => {
    if (mapRef.current && currentLat && currentLng) {
      mapRef.current.animateToRegion({ latitude: currentLat, longitude: currentLng, latitudeDelta: 0.04, longitudeDelta: 0.04 }, 600);
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={currentLat && currentLng ? { latitude: currentLat, longitude: currentLng, latitudeDelta: 0.08, longitudeDelta: 0.08 } : NAIROBI}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
      >
        {SPEED_ZONES.map((z) => (
          <React.Fragment key={z.id}>
            <Marker
              coordinate={{ latitude: z.lat, longitude: z.lng }}
              pinColor={z.type === "camera" ? "#E53935" : z.type === "police" ? "#1565C0" : "#F57C00"}
              title={z.name}
              description={`${z.speedLimit} km/h – ${z.road}`}
            />
            <Circle
              center={{ latitude: z.lat, longitude: z.lng }}
              radius={150}
              strokeColor={z.type === "camera" ? "#E5393555" : "#1565C055"}
              fillColor={z.type === "camera" ? "#E5393511" : "#1565C011"}
              strokeWidth={1}
            />
          </React.Fragment>
        ))}
        {communityReports.map((r) => (
          <Marker
            key={r.id}
            coordinate={{ latitude: r.lat, longitude: r.lng }}
            pinColor={REPORT_COLORS[r.type] ?? "#888"}
            opacity={now - r.timestamp > 5400000 ? 0.45 : 1}
            title={r.type.charAt(0).toUpperCase() + r.type.slice(1)}
            description={`Reported ${Math.round((now - r.timestamp) / 60000)} min ago`}
          />
        ))}
      </MapView>

      <View style={[styles.legend, { backgroundColor: c.card + "EE", top: insets.top + 12 }]}>
        {[{ color: "#E53935", label: "Camera" }, { color: "#1565C0", label: "Police" }, { color: "#F57C00", label: "Zone" }, { color: "#00C853", label: "Report" }].map((l) => (
          <View key={l.label} style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: l.color }]} />
            <Text style={[styles.legendText, { color: c.foreground }]}>{l.label}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity style={[styles.locateBtn, { backgroundColor: c.card, bottom: insets.bottom + 96 }]} onPress={centerOnUser}>
        <Ionicons name="locate-outline" size={22} color={c.primary} />
      </TouchableOpacity>

      <TouchableOpacity style={[styles.reportBtn, { backgroundColor: c.primary, bottom: insets.bottom + 96 }]} onPress={() => setShowReport(true)} activeOpacity={0.88}>
        <Ionicons name="add" size={20} color={c.primaryForeground} />
        <Text style={[styles.reportBtnText, { color: c.primaryForeground }]}>Report</Text>
      </TouchableOpacity>

      <ReportModal visible={showReport} onClose={() => setShowReport(false)} onSubmit={handleReport} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  legend: { position: "absolute", left: 14, borderRadius: 12, padding: 10, gap: 7, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 6, elevation: 6 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  locateBtn: { position: "absolute", right: 14, width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 5, elevation: 5 },
  reportBtn: { position: "absolute", right: 72, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 13, borderRadius: 28, shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 8 },
  reportBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
