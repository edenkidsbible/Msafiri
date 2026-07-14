import React, { useEffect, useMemo, useRef, useState } from "react";
import { SCROLL_PROPS } from "@/lib/scrollProps";
import {
  Alert,
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
import { POIS } from "@/data/pois";
import { INCIDENT_TYPES, INCIDENT_TYPE_ORDER, resolveIncidentType } from "@/constants/incidentTypes";
import { getVehicleTypeDef, capSpeedLimit } from "@/data/vehicleTypes";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";

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

function reportLabel(type: string): string {
  return resolveIncidentType(type).label;
}

// ─── Single-colour circle marker (used for speed zones, POIs, destination) ────

function MarkerIcon({
  bg, size = 32,
  ioniconName, matIcon,
}: {
  bg: string;
  size?: number;
  ioniconName?: React.ComponentProps<typeof Ionicons>["name"];
  matIcon?: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
}) {
  const iconSize = size * 0.52;
  return (
    <View
      collapsable={false}
      style={{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: bg, alignItems: "center", justifyContent: "center",
        borderWidth: 2.5, borderColor: "#FFF",
        shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.35, shadowRadius: 4, elevation: 7,
      }}
    >
      {matIcon
        ? <MaterialCommunityIcons name={matIcon} size={iconSize} color="#FFF" />
        : ioniconName
          ? <Ionicons name={ioniconName} size={iconSize} color="#FFF" />
          : null}
    </View>
  );
}

// Speed-limit badge — shown at road-stretch endpoints so the driver can see
// how the limit changes along the road (e.g. 50 → 80 → 110) at a glance.
function SpeedLimitBadge({ speed, bg }: { speed: number; bg: string }) {
  return (
    <View collapsable={false} style={[ms.speedBadge, { borderColor: bg }]}>
      <Text style={[ms.speedBadgeNum, { color: bg }]}>{speed}</Text>
      <Text style={[ms.speedBadgeUnit, { color: bg }]}>km/h</Text>
    </View>
  );
}

// ─── Cluster marker (2+ incidents at same location) ───────────────────────────

function ClusterMarker({ group, now }: { group: ClusterGroup; now: number }) {
  const { members } = group;
  const faded = members.every((r) => now - r.timestamp > 7200000);

  if (members.length === 1) {
    const r = members[0];
    const def = resolveIncidentType(r.type);
    const confirmed = r.status === "confirmed";
    return (
      <View collapsable={false} style={{ opacity: faded ? 0.45 : 1 }}>
        <View style={[ms.emojiMarker, { backgroundColor: confirmed ? "#B71C1C" : def.color }]}>
          <Text style={ms.emojiMarkerText}>{def.emoji}</Text>
        </View>
      </View>
    );
  }

  const icons = members.slice(0, 4);
  return (
    <View collapsable={false} style={{ opacity: faded ? 0.45 : 1 }}>
      <View style={ms.clusterWrap}>
        <View style={ms.clusterGrid}>
          {icons.map((r) => {
            const def = resolveIncidentType(r.type);
            return (
              <View key={r.id} style={[ms.clusterCell, { backgroundColor: def.color }]}>
                <Text style={ms.clusterEmoji}>{def.emoji}</Text>
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
    confirmReport, denyReport, flagReport,
    vehicleType, allZones,
    pendingFocusCoords, setPendingFocusCoords,
  } = useApp();
  const vehicle = getVehicleTypeDef(vehicleType);

  const mapRef = useRef<MapView>(null);
  const hasCenteredRef = useRef(false);
  const now = Date.now();
  const [selectedCluster, setSelectedCluster] = useState<ClusterGroup | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [flaggingId, setFlaggingId] = useState<string | null>(null);

  const handleFlagReport = (id: string) => {
    Alert.alert(
      "Report to moderators",
      "Only Msafiri Kenya moderators can remove a report. Tell us why this one should be reviewed:",
      [
        { text: "Inaccurate location", onPress: () => submitFlag(id, "inaccurate_location") },
        { text: "Already gone", onPress: () => submitFlag(id, "already_gone") },
        { text: "Inappropriate / spam", onPress: () => submitFlag(id, "inappropriate") },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const submitFlag = async (id: string, reason: string) => {
    setFlaggingId(id);
    const ok = await flagReport(id, reason);
    setFlaggingId(null);
    if (ok) {
      Alert.alert("Reported", "Thanks — our moderation team will review this report.");
    } else {
      Alert.alert("Couldn't send report", "Check your connection and try again.");
    }
  };
  const openedAtRef = useRef(0);

  const openCluster = (group: ClusterGroup) => {
    openedAtRef.current = Date.now();
    setSelectedCluster(group);
  };
  const closeCluster = () => {
    // Guard against the react-native-maps ghost-touch quirk where a Marker
    // tap also delivers a press to whatever full-screen overlay mounts
    // underneath it in the same gesture, closing the sheet instantly.
    if (Date.now() - openedAtRef.current < 400) return;
    setSelectedCluster(null);
  };

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
    // GPS fixes arrive up to once/sec while navigating, and each one used to
    // kick off a fresh 900ms animateCamera call. On Android that's a heavy
    // native operation (tilted 3D camera + GPU compositing), and back-to-back
    // calls landing faster than the previous animation finished meant the
    // camera never settled — this saturated the native bridge and caused the
    // jank/lag the whole app (including voice instruction timing) suffered
    // from during navigation. Using a duration shorter than the fix interval
    // lets each animation actually complete before the next one starts.
    mapRef.current?.animateCamera(
      { center: { latitude: currentLat, longitude: currentLng }, zoom: 17, pitch: 40 },
      { duration: 500 }
    );
  }, [navigationActive, currentLat, currentLng]);

  // Deep-link focus: center map on a push-notification incident then clear
  useEffect(() => {
    if (!pendingFocusCoords) return;
    mapRef.current?.animateToRegion(
      {
        latitude: pendingFocusCoords.lat,
        longitude: pendingFocusCoords.lng,
        latitudeDelta: 0.008,
        longitudeDelta: 0.008,
      },
      700
    );
    setPendingFocusCoords(null);
  }, [pendingFocusCoords]);

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
      >
        {/* Speed zone markers — road-stretch corridors show their limit as a
            badge at each end so you can see how the speed changes along the
            road, instead of a straight line cutting across the map. */}
        {allZones.map((z) => {
          const bg = z.type === "camera" ? "#E53935" : z.type === "police" ? "#1565C0" : "#E65100";
          return (
            <React.Fragment key={z.id}>
              <Marker
                coordinate={{ latitude: z.lat, longitude: z.lng }}
                anchor={{ x: 0.5, y: 1 }}
                title={z.name}
                description={`${capSpeedLimit(z.speedLimit, vehicle)} km/h — ${z.road}`}
              >
                {z.isStretchEndpoint ? (
                  <SpeedLimitBadge speed={capSpeedLimit(z.speedLimit, vehicle)} bg={bg} />
                ) : (
                  <MarkerIcon
                    ioniconName={z.type === "camera" ? "camera" : z.type === "police" ? "person" : "speedometer"}
                    bg={bg}
                    size={32}
                  />
                )}
              </Marker>
              <Circle
                center={{ latitude: z.lat, longitude: z.lng }}
                radius={180}
                strokeColor={z.type === "camera" ? "#E5393555" : "#1565C055"}
                fillColor={z.type === "camera" ? "#E5393912" : "#1565C012"}
                strokeWidth={1.5}
              />
            </React.Fragment>
          );
        })}

        {/* Community report clusters */}
        {clusters.map((group) => {
          const clusterKey = group.members.map((m) => m.id).sort().join("-");
          return (
            <Marker
              key={clusterKey}
              coordinate={{ latitude: group.lat, longitude: group.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              onPress={() => openCluster(group)}
              zIndex={10}
            >
              <ClusterMarker group={group} now={now} />
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
              ioniconName={p.type === "fuel" ? undefined : "restaurant"}
              bg={p.type === "fuel" ? "#2E7D32" : "#BF360C"}
              size={28}
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
            <MarkerIcon ioniconName="navigate" bg="#1565C0" size={36} />
          </Marker>
        )}
      </MapView>

      {/* ── Incident detail sheet (Modal so it always renders above all overlays) */}
      {selectedCluster && (
        <Modal
          visible
          transparent
          animationType="slide"
          onRequestClose={closeCluster}
        >
          <TouchableOpacity
            style={ms.backdrop}
            onPress={closeCluster}
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
              <ScrollView {...SCROLL_PROPS} showsVerticalScrollIndicator={false} style={{ maxHeight: 340 }}>
                {selectedCluster.members.map((r, i) => {
                  const def = resolveIncidentType(r.type);
                  const bg = def.color;
                  const emoji = def.emoji;
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
                      <View style={[ms.incidentIcon, { backgroundColor: bg + "22" }]}>
                        <Text style={ms.incidentEmoji}>{emoji}</Text>
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
                        {r.roadName ? (
                          <Text style={ms.incidentRoad}>{r.roadName}</Text>
                        ) : null}
                        <Text style={ms.incidentMeta}>
                          {ageStr}
                          {r.confirmCount != null && r.confirmCount > 1 ? `  ·  Reported by ${r.confirmCount} users` : ""}
                          {r.type === "camera" && r.speedLimit ? `  ·  ${capSpeedLimit(r.speedLimit, vehicle)} km/h zone` : ""}
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
                              style={[ms.voteBtn, { backgroundColor: "#D32F2F18", borderColor: "#D32F2F55" }, denyingId === r.id && ms.voteBtnDisabled]}
                              disabled={denyingId === r.id}
                              onPress={async () => {
                                setDenyingId(r.id);
                                const ok = await denyReport(r.id);
                                setDenyingId(null);
                                if (ok) {
                                  setSelectedCluster(null);
                                } else {
                                  Alert.alert("Couldn't submit your vote", "Check your connection and try again.");
                                }
                              }}
                            >
                              <Ionicons name="thumbs-down-outline" size={13} color={denyingId === r.id ? "#9E9E9E" : "#D32F2F"} />
                              <Text style={[ms.voteTxt, { color: denyingId === r.id ? "#9E9E9E" : "#D32F2F" }]}>
                                {denyingId === r.id ? "Sending…" : "Gone now"}
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[ms.voteBtn, { backgroundColor: "#75757518", borderColor: "#75757555" }, flaggingId === r.id && ms.voteBtnDisabled]}
                              disabled={flaggingId === r.id}
                              onPress={() => handleFlagReport(r.id)}
                            >
                              <Ionicons name="flag-outline" size={13} color={flaggingId === r.id ? "#9E9E9E" : "#757575"} />
                              <Text style={[ms.voteTxt, { color: flaggingId === r.id ? "#9E9E9E" : "#757575" }]}>
                                {flaggingId === r.id ? "Sending…" : "Report"}
                              </Text>
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
  // ── Single emoji marker ─────────────────────────────────────────────────────
  emojiMarker: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#FFF",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.28, shadowRadius: 4, elevation: 5,
  },
  emojiMarkerText: { fontSize: 18, lineHeight: 22, fontFamily: EMOJI_FONT_FAMILY },

  // ── Speed-limit badge (road-stretch endpoints) ──────────────────────────────
  speedBadge: {
    minWidth: 44, paddingHorizontal: 6, paddingVertical: 3,
    borderRadius: 10, backgroundColor: "#FFF",
    borderWidth: 2, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35, shadowRadius: 4, elevation: 7,
  },
  speedBadgeNum: { fontSize: 15, fontFamily: "Inter_700Bold", lineHeight: 17 },
  speedBadgeUnit: { fontSize: 8, fontFamily: "Inter_600SemiBold", opacity: 0.85, lineHeight: 9 },

  // ── Cluster marker ──────────────────────────────────────────────────────────
  clusterWrap: {
    width: 52, height: 52,
    backgroundColor: "#FFF",
    borderRadius: 15, borderWidth: 2, borderColor: "#E0E0E0",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28, shadowRadius: 6, elevation: 7,
  },
  clusterGrid: {
    flexDirection: "row", flexWrap: "wrap",
    gap: 2, width: 32, height: 32,
    alignItems: "center", justifyContent: "center",
  },
  clusterCell: {
    width: 14, height: 14, borderRadius: 4,
    alignItems: "center", justifyContent: "center",
  },
  clusterEmoji: { fontSize: 9, fontFamily: EMOJI_FONT_FAMILY },
  clusterBadge: {
    position: "absolute", top: -7, right: -7,
    minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: "#E53935", borderWidth: 1.5, borderColor: "#FFF",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
  },
  clusterBadgeTxt: { color: "#FFF", fontSize: 10, fontWeight: "800" },

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
  incidentEmoji: { fontSize: 20, lineHeight: 26 },
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
  incidentRoad: { fontSize: 12, fontWeight: "600", color: "#1565C0", marginTop: 1 },
  incidentMeta: { fontSize: 12, color: "#888" },
  voteRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  voteBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1,
  },
  voteBtnDisabled: { opacity: 0.5 },
  voteTxt: { fontSize: 12, fontWeight: "600" },
});
