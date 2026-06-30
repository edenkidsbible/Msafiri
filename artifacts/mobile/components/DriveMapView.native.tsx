import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Circle, Marker, Polyline } from "react-native-maps";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useApp } from "@/context/AppContext";
import type { CommunityReport } from "@/context/AppContext";
import { SPEED_ZONES } from "@/data/speedZones";
import { POIS } from "@/data/pois";

const NAIROBI = { latitude: -1.2921, longitude: 36.8219, latitudeDelta: 0.08, longitudeDelta: 0.08 };
const POI_RADIUS_M = 8000;
const CLUSTER_DIST_M = 35;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180, Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type ClusterGroup = { members: CommunityReport[]; lat: number; lng: number };

function clusterReports(reports: CommunityReport[]): ClusterGroup[] {
  const visited = new Set<string>();
  const clusters: ClusterGroup[] = [];
  for (const r of reports) {
    if (visited.has(r.id)) continue;
    const group: ClusterGroup = { members: [r], lat: r.lat, lng: r.lng };
    visited.add(r.id);
    for (const other of reports) {
      if (visited.has(other.id)) continue;
      if (haversine(r.lat, r.lng, other.lat, other.lng) <= CLUSTER_DIST_M) {
        group.members.push(other);
        visited.add(other.id);
      }
    }
    clusters.push(group);
  }
  return clusters;
}

const ICON_MAP: Record<string, { name: React.ComponentProps<typeof Ionicons>["name"]; bg: string }> = {
  camera:    { name: "camera",           bg: "#E53935" },
  police:    { name: "shield-checkmark", bg: "#1565C0" },
  accident:  { name: "warning",          bg: "#B71C1C" },
  pothole:   { name: "alert-circle",     bg: "#F57C00" },
  roadblock: { name: "construct",        bg: "#7B1FA2" },
  clear:     { name: "checkmark-circle", bg: "#00C853" },
  traffic:   { name: "git-network",      bg: "#C62828" },
  hazard:    { name: "flash",            bg: "#FF6F00" },
  debris:    { name: "cube",             bg: "#795548" },
  breakdown: { name: "car",             bg: "#FF8F00" },
  weather:   { name: "rainy",            bg: "#37474F" },
  closure:   { name: "hand-left",        bg: "#880E4F" },
};

function reportLabel(type: string): string {
  return type === "camera"    ? "Speed Camera"
       : type === "police"    ? "Police Checkpoint"
       : type === "accident"  ? "Accident"
       : type === "pothole"   ? "Pothole"
       : type === "roadblock" ? "Roadblock"
       : type === "traffic"   ? "Traffic Jam"
       : type === "hazard"    ? "Hazard"
       : type === "debris"    ? "Debris"
       : type === "breakdown" ? "Broken Down"
       : type === "weather"   ? "Bad Weather"
       : type === "closure"   ? "Road Closed"
                              : "Road Clear";
}

// ─── Single-colour circle marker (no emoji, works on all Android) ─────────────

function MarkerIcon({
  name, bg, size = 30, matIcon,
}: {
  name?: React.ComponentProps<typeof Ionicons>["name"];
  bg: string; size?: number;
  matIcon?: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
}) {
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: bg, alignItems: "center", justifyContent: "center",
      borderWidth: 2, borderColor: "#FFF",
      shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3, shadowRadius: 3, elevation: 5,
    }}>
      {matIcon
        ? <MaterialCommunityIcons name={matIcon} size={size * 0.5} color="#FFF" />
        : name
          ? <Ionicons name={name} size={size * 0.5} color="#FFF" />
          : null}
    </View>
  );
}

// ─── Cluster marker (2+ incidents at same location) ───────────────────────────

function ClusterMarker({ group, now }: { group: ClusterGroup; now: number }) {
  const { members } = group;
  const faded = members.every((r) => now - r.timestamp > 7200000);

  if (members.length === 1) {
    const r = members[0];
    const m = ICON_MAP[r.type] ?? { name: "alert-circle" as const, bg: "#888" };
    const confirmed = r.status === "confirmed";
    return (
      <View style={{ opacity: faded ? 0.45 : 1 }}>
        <MarkerIcon name={m.name} bg={confirmed ? "#B71C1C" : m.bg} size={confirmed ? 34 : 28} />
      </View>
    );
  }

  const icons = members.slice(0, 4);
  return (
    <View style={{ opacity: faded ? 0.45 : 1 }}>
      <View style={ms.clusterWrap}>
        <View style={ms.clusterGrid}>
          {icons.map((r) => {
            const m = ICON_MAP[r.type] ?? { name: "alert-circle" as const, bg: "#888" };
            return (
              <View key={r.id} style={[ms.clusterCell, { backgroundColor: m.bg }]}>
                <Ionicons name={m.name} size={9} color="#FFF" />
              </View>
            );
          })}
        </View>
        <View style={ms.clusterBadge}>
          <Text style={ms.clusterBadgeTxt}>{members.length}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Main map component ───────────────────────────────────────────────────────

export default function DriveMapView() {
  const {
    currentLat, currentLng,
    activeRoute, altRoutes, selectRoute,
    navigationActive, communityReports, showTraffic,
    confirmReport, denyReport,
  } = useApp();

  const mapRef = useRef<MapView>(null);
  const hasCenteredRef = useRef(false);
  const now = Date.now();
  const [selectedCluster, setSelectedCluster] = useState<ClusterGroup | null>(null);

  useEffect(() => {
    if (hasCenteredRef.current || navigationActive || currentLat == null || currentLng == null) return;
    hasCenteredRef.current = true;
    const t = setTimeout(() => {
      mapRef.current?.animateToRegion(
        { latitude: currentLat, longitude: currentLng, latitudeDelta: 0.05, longitudeDelta: 0.05 },
        900
      );
    }, 300);
    return () => clearTimeout(t);
  }, [currentLat, currentLng, navigationActive]);

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

  const nearbyPOIs = useMemo(() => {
    if (currentLat == null || currentLng == null) return [];
    return POIS.filter((p) => haversine(currentLat, currentLng, p.lat, p.lng) <= POI_RADIUS_M).slice(0, 25);
  }, [currentLat, currentLng]);

  const clusters = useMemo(() => clusterReports(communityReports), [communityReports]);

  return (
    <>
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
        onPress={() => setSelectedCluster(null)}
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

        {/* Community report clusters */}
        {clusters.map((group, idx) => (
          <Marker
            key={`cluster-${idx}`}
            coordinate={{ latitude: group.lat, longitude: group.lng }}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={false}
            onPress={() => setSelectedCluster(group)}
          >
            <ClusterMarker group={group} now={now} />
          </Marker>
        ))}

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

        {/* Active route */}
        {activeRoute && (
          <>
            <Polyline coordinates={activeRoute.coords} strokeColor={navigationActive ? "#0D47A1AA" : "#1565C0AA"} strokeWidth={10} lineCap="round" lineJoin="round" />
            <Polyline coordinates={activeRoute.coords} strokeColor={navigationActive ? "#1976D2" : "#2196F3"} strokeWidth={6} lineCap="round" lineJoin="round" />
          </>
        )}

        {/* Destination pin */}
        {activeRoute && activeRoute.coords.length > 0 && (
          <Marker coordinate={activeRoute.coords[activeRoute.coords.length - 1]} anchor={{ x: 0.5, y: 1 }} title="Destination">
            <MarkerIcon name="navigate" bg="#1565C0" size={34} />
          </Marker>
        )}
      </MapView>

      {/* ── Incident detail sheet (Modal so it always renders above all overlays) */}
      {selectedCluster && (
        <Modal
          visible
          transparent
          animationType="slide"
          onRequestClose={() => setSelectedCluster(null)}
        >
          <TouchableOpacity
            style={ms.backdrop}
            onPress={() => setSelectedCluster(null)}
            activeOpacity={1}
          >
            <TouchableOpacity activeOpacity={1} style={ms.sheet}>
              {/* Handle bar */}
              <View style={ms.handle} />

              {/* Header */}
              <View style={ms.headerRow}>
                <View style={{ flex: 1 }}>
                  <Text style={ms.sheetTitle}>
                    {selectedCluster.members.length === 1
                      ? reportLabel(selectedCluster.members[0].type)
                      : `${selectedCluster.members.length} Incidents at this location`}
                  </Text>
                  {selectedCluster.members.length > 1 && (
                    <Text style={ms.sheetSub}>Tap "Still here" or "Gone now" to help others</Text>
                  )}
                </View>
                <TouchableOpacity onPress={() => setSelectedCluster(null)} style={ms.closeBtn}>
                  <Ionicons name="close" size={18} color="#555" />
                </TouchableOpacity>
              </View>

              {/* Incident list */}
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 340 }}>
                {selectedCluster.members.map((r, i) => {
                  const m = ICON_MAP[r.type] ?? { name: "alert-circle" as const, bg: "#888" };
                  const ageMin = Math.round((now - r.timestamp) / 60000);
                  const ageStr =
                    ageMin < 1  ? "Just now" :
                    ageMin < 60 ? `${ageMin} min ago` :
                                  `${Math.floor(ageMin / 60)}h ago`;
                  const canVote = !r.isOwn;
                  const confirmed = r.status === "confirmed";
                  return (
                    <View
                      key={r.id}
                      style={[ms.incidentRow, i > 0 && ms.incidentDivider]}
                    >
                      <View style={[ms.incidentIcon, { backgroundColor: m.bg + "22" }]}>
                        <Ionicons name={m.name} size={18} color={m.bg} />
                      </View>
                      <View style={{ flex: 1, gap: 3 }}>
                        <View style={ms.incidentLabelRow}>
                          <Text style={ms.incidentType}>{reportLabel(r.type)}</Text>
                          {confirmed && (
                            <View style={ms.verifiedBadge}>
                              <Ionicons name="checkmark-circle" size={11} color="#2E7D32" />
                              <Text style={ms.verifiedTxt}>Verified</Text>
                            </View>
                          )}
                          {r.isOwn && (
                            <View style={ms.ownBadge}>
                              <Text style={ms.ownTxt}>Yours</Text>
                            </View>
                          )}
                        </View>
                        <Text style={ms.incidentMeta}>
                          {ageStr}
                          {r.confirmCount != null && r.confirmCount > 1 ? `  ·  ${r.confirmCount} confirmed` : ""}
                          {r.type === "camera" && r.speedLimit ? `  ·  ${r.speedLimit} km/h zone` : ""}
                        </Text>
                        {canVote && (
                          <View style={ms.voteRow}>
                            <TouchableOpacity
                              style={[ms.voteBtn, { backgroundColor: "#388E3C18", borderColor: "#388E3C55" }]}
                              onPress={() => { confirmReport(r.id); setSelectedCluster(null); }}
                            >
                              <Ionicons name="thumbs-up-outline" size={13} color="#388E3C" />
                              <Text style={[ms.voteTxt, { color: "#388E3C" }]}>Still here</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[ms.voteBtn, { backgroundColor: "#D32F2F18", borderColor: "#D32F2F55" }]}
                              onPress={() => { denyReport(r.id); setSelectedCluster(null); }}
                            >
                              <Ionicons name="thumbs-down-outline" size={13} color="#D32F2F" />
                              <Text style={[ms.voteTxt, { color: "#D32F2F" }]}>Gone now</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}
    </>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const ms = StyleSheet.create({
  // ── Cluster marker ──────────────────────────────────────────────────────────
  clusterWrap: {
    width: 48, height: 48,
    backgroundColor: "#FFF",
    borderRadius: 14, borderWidth: 2, borderColor: "#E0E0E0",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25, shadowRadius: 5, elevation: 6,
  },
  clusterGrid: {
    flexDirection: "row", flexWrap: "wrap",
    gap: 2, width: 30, height: 30,
    alignItems: "center", justifyContent: "center",
  },
  clusterCell: {
    width: 13, height: 13, borderRadius: 4,
    alignItems: "center", justifyContent: "center",
  },
  clusterBadge: {
    position: "absolute", top: -6, right: -6,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: "#E53935", borderWidth: 1.5, borderColor: "#FFF",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
  },
  clusterBadgeTxt: { color: "#FFF", fontSize: 9, fontWeight: "800" },

  // ── Modal backdrop & sheet ──────────────────────────────────────────────────
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 48,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: "#DDD", alignSelf: "center", marginBottom: 16,
  },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: "#212121" },
  sheetSub: { fontSize: 12, color: "#888", marginTop: 2 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: "#F2F2F2",
    alignItems: "center", justifyContent: "center",
  },

  // ── Incident rows ───────────────────────────────────────────────────────────
  incidentRow: { flexDirection: "row", gap: 12, paddingVertical: 12, alignItems: "flex-start" },
  incidentDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#EBEBEB" },
  incidentIcon: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: "center", justifyContent: "center", marginTop: 2,
  },
  incidentLabelRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  incidentType: { fontSize: 15, fontWeight: "700", color: "#212121" },
  verifiedBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "#E8F5E9", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
  },
  verifiedTxt: { fontSize: 10, fontWeight: "700", color: "#2E7D32" },
  ownBadge: {
    backgroundColor: "#E3F2FD", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
  },
  ownTxt: { fontSize: 10, fontWeight: "700", color: "#1565C0" },
  incidentMeta: { fontSize: 12, color: "#888" },
  voteRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  voteBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1,
  },
  voteTxt: { fontSize: 12, fontWeight: "600" },
});
