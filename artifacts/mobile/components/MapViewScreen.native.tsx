import React, { useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import MapView, { Circle, Marker, Polyline } from "react-native-maps";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { SPEED_ZONES } from "@/data/speedZones";
import ReportModal from "@/components/ReportModal";
import { INCIDENT_TYPES, INCIDENT_TYPE_ORDER, resolveIncidentType } from "@/constants/incidentTypes";
import type { CommunityReport } from "@/context/AppContext";

const NAIROBI = { latitude: -1.2921, longitude: 36.8219, latitudeDelta: 0.15, longitudeDelta: 0.15 };

// Colored circle icon marker — supports Ionicons and MaterialCommunityIcons
function MarkerIcon({
  type,
  bg,
  size = 32,
  ioniconName,
  matIcon,
}: {
  type?: string;
  bg: string;
  size?: number;
  ioniconName?: React.ComponentProps<typeof Ionicons>["name"];
  matIcon?: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
}) {
  const iconSize = size * 0.52;
  const def = type ? resolveIncidentType(type) : undefined;
  return (
    <View style={[styles.markerCircle, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}>
      {def ? (
        def.iconSet === "MaterialCommunityIcons" ? (
          <MaterialCommunityIcons
            name={def.icon as React.ComponentProps<typeof MaterialCommunityIcons>["name"]}
            size={iconSize}
            color="#FFF"
          />
        ) : (
          <Ionicons
            name={def.icon as React.ComponentProps<typeof Ionicons>["name"]}
            size={iconSize}
            color="#FFF"
          />
        )
      ) : matIcon ? (
        <MaterialCommunityIcons name={matIcon} size={iconSize} color="#FFF" />
      ) : ioniconName ? (
        <Ionicons name={ioniconName} size={iconSize} color="#FFF" />
      ) : null}
    </View>
  );
}

const ZONE_MARKER: Record<string, { ioniconName: React.ComponentProps<typeof Ionicons>["name"]; bg: string }> = {
  camera: { ioniconName: "camera",          bg: "#E53935" },
  police: { ioniconName: "shield-checkmark", bg: "#1565C0" },
  zone:   { ioniconName: "speedometer",      bg: "#E65100" },
};

// Legend: all 12 community-report types + static Zone entry
const LEGEND_ITEMS: Array<{
  key: string;
  label: string;
  bg: string;
  iconSet: "Ionicons" | "MaterialCommunityIcons" | "static";
  icon: string;
}> = [
  ...INCIDENT_TYPE_ORDER.map((t) => ({
    key: t,
    label: INCIDENT_TYPES[t].label,
    bg: INCIDENT_TYPES[t].color,
    iconSet: INCIDENT_TYPES[t].iconSet as "Ionicons" | "MaterialCommunityIcons",
    icon: INCIDENT_TYPES[t].icon,
  })),
  { key: "zone", label: "Speed Zone", bg: "#E65100", iconSet: "static" as const, icon: "speedometer" },
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

  const handleReport = (type: CommunityReport["type"]) => {
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
                <MarkerIcon ioniconName={m.ioniconName} bg={m.bg} />
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
          const def = resolveIncidentType(r.type);
          return (
            <Marker
              key={r.id}
              coordinate={{ latitude: r.lat, longitude: r.lng }}
              anchor={{ x: 0.5, y: 1 }}
              opacity={faded ? 0.4 : 1}
              title={def.label}
              description={`${Math.round((now - r.timestamp) / 60000)} min ago`}
            >
              <MarkerIcon type={r.type} bg={def.color} size={30} />
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
            <MarkerIcon ioniconName="navigate" bg="#1565C0" size={36} />
          </Marker>
        )}
      </MapView>

      {/* Legend — scrollable so it never overflows on small screens */}
      <View style={[styles.legendWrap, { backgroundColor: c.card + "EE", top: insets.top + 12 }]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          bounces={false}
          style={styles.legendScroll}
          contentContainerStyle={styles.legendContent}
        >
          {LEGEND_ITEMS.map((l) => (
            <View key={l.key} style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: l.bg }]}>
                {l.iconSet === "MaterialCommunityIcons" ? (
                  <MaterialCommunityIcons
                    name={l.icon as React.ComponentProps<typeof MaterialCommunityIcons>["name"]}
                    size={9}
                    color="#FFF"
                  />
                ) : (
                  <Ionicons
                    name={l.icon as React.ComponentProps<typeof Ionicons>["name"]}
                    size={9}
                    color="#FFF"
                  />
                )}
              </View>
              <Text style={[styles.legendText, { color: c.foreground }]}>{l.label}</Text>
            </View>
          ))}
        </ScrollView>
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
    borderWidth: 2.5, borderColor: "#FFF",
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35, shadowRadius: 4, elevation: 7,
  },
  legendWrap: {
    position: "absolute", left: 12,
    borderRadius: 12,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 6, elevation: 6,
    maxHeight: 320,
  },
  legendScroll: { borderRadius: 12 },
  legendContent: { padding: 10, gap: 6 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  legendDot: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  legendText: { fontSize: 11, fontFamily: "Inter_500Medium" },
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
