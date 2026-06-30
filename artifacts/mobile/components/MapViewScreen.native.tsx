import React, { useRef, useState, useMemo } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import MapView, { Callout, Circle, Marker, Polyline } from "react-native-maps";
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

// ─── Cluster grouping ─────────────────────────────────────────────────────────

type ClusterGroup = { members: CommunityReport[]; lat: number; lng: number };
const CLUSTER_RADIUS = 0.003;

function clusterReports(reports: CommunityReport[]): ClusterGroup[] {
  const used = new Set<string>();
  const clusters: ClusterGroup[] = [];
  for (const r of reports) {
    if (used.has(r.id)) continue;
    const group: ClusterGroup = { members: [r], lat: r.lat, lng: r.lng };
    used.add(r.id);
    for (const s of reports) {
      if (used.has(s.id)) continue;
      if (Math.abs(s.lat - r.lat) < CLUSTER_RADIUS && Math.abs(s.lng - r.lng) < CLUSTER_RADIUS) {
        group.members.push(s);
        used.add(s.id);
      }
    }
    clusters.push(group);
  }
  return clusters;
}

function MapClusterMarker({ group, now }: { group: ClusterGroup; now: number }) {
  const { members } = group;
  const faded = members.every((r) => now - r.timestamp > 7200000);

  if (members.length === 1) {
    const r = members[0];
    const def = resolveIncidentType(r.type);
    return (
      <View style={{ opacity: faded ? 0.45 : 1 }}>
        <MarkerIcon type={r.type} bg={def.color} size={30} />
      </View>
    );
  }

  const icons = members.slice(0, 4);
  return (
    <View style={{ opacity: faded ? 0.45 : 1 }}>
      <View style={styles.clusterWrap}>
        <View style={styles.clusterGrid}>
          {icons.map((r) => {
            const def = resolveIncidentType(r.type);
            return (
              <View key={r.id} style={[styles.clusterCell, { backgroundColor: def.color }]}>
                <Text style={styles.clusterEmoji}>{def.emoji}</Text>
              </View>
            );
          })}
        </View>
        <View style={styles.clusterBadge}>
          <Text style={styles.clusterBadgeTxt}>{members.length}</Text>
        </View>
      </View>
    </View>
  );
}

function CalloutContent({ group }: { group: ClusterGroup }) {
  const now = Date.now();
  const { members } = group;

  const ageStr = (timestamp: number) => {
    const ageMin = Math.round((now - timestamp) / 60000);
    if (ageMin < 1) return "Just now";
    if (ageMin < 60) return `${ageMin} min ago`;
    return `${Math.floor(ageMin / 60)}h ago`;
  };

  if (members.length === 1) {
    const r = members[0];
    const def = resolveIncidentType(r.type);
    return (
      <View style={calloutS.wrap}>
        <Text style={calloutS.title}>{def.emoji}  {def.label}</Text>
        <Text style={calloutS.sub}>{ageStr(r.timestamp)}</Text>
      </View>
    );
  }

  return (
    <View style={calloutS.wrap}>
      <Text style={calloutS.heading}>{members.length} incidents nearby</Text>
      {members.map((r) => {
        const def = resolveIncidentType(r.type);
        return (
          <View key={r.id} style={calloutS.row}>
            <Text style={calloutS.rowEmoji}>{def.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={calloutS.rowLabel}>{def.label}</Text>
              <Text style={calloutS.rowAge}>{ageStr(r.timestamp)}</Text>
            </View>
          </View>
        );
      })}
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
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const clusters = useMemo(() => clusterReports(communityReports), [communityReports]);
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

        {/* Community report clusters — tap to show callout */}
        {clusters.map((group, idx) => (
          <Marker
            key={`cluster-${idx}`}
            coordinate={{ latitude: group.lat, longitude: group.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
          >
            <MapClusterMarker group={group} now={now} />
            <Callout tooltip={true} style={calloutS.callout}>
              <CalloutContent group={group} />
            </Callout>
          </Marker>
        ))}

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

      {/* Legend — minimize/maximize */}
      <View style={[styles.legendWrap, { backgroundColor: c.card + "EE", top: insets.top + 12 }]}>
        <TouchableOpacity
          style={styles.legendToggleRow}
          onPress={() => setLegendCollapsed((v) => !v)}
          activeOpacity={0.7}
        >
          <Text style={[styles.legendTitle, { color: c.foreground }]}>Map Guide</Text>
          <Ionicons
            name={legendCollapsed ? "chevron-down-outline" : "chevron-up-outline"}
            size={13}
            color={c.mutedForeground}
          />
        </TouchableOpacity>
        {!legendCollapsed && (
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
        )}
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
  clusterWrap: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  clusterGrid: { width: 36, height: 36, flexWrap: "wrap", flexDirection: "row", gap: 2, borderRadius: 10, overflow: "hidden" },
  clusterCell: { width: 16, height: 16, alignItems: "center", justifyContent: "center", borderRadius: 4 },
  clusterEmoji: { fontSize: 9 },
  clusterBadge: {
    position: "absolute", bottom: 0, right: 0,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: "#FFF", alignItems: "center", justifyContent: "center",
    paddingHorizontal: 4, borderWidth: 1.5, borderColor: "#00000020",
  },
  clusterBadgeTxt: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#222" },
  legendToggleRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 10, paddingTop: 8, paddingBottom: 4, gap: 12, minWidth: 110,
  },
  legendTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  trafficBadge: {
    position: "absolute", right: 12,
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14,
  },
  trafficLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});

const calloutS = StyleSheet.create({
  callout: { backgroundColor: "transparent" },
  wrap: {
    minWidth: 170, maxWidth: 260,
    backgroundColor: "#FFF",
    borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18, shadowRadius: 8, elevation: 8,
  },
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111", marginBottom: 2 },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#666" },
  heading: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#111", marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 6 },
  rowEmoji: { fontSize: 16, lineHeight: 20 },
  rowLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111" },
  rowAge: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#666", marginTop: 1 },
});
