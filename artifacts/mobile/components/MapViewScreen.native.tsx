import React, { useEffect, useRef, useState, useMemo } from "react";
import DARK_MAP_STYLE from "@/constants/darkMapStyle";
import { Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import MapView, { Circle, Marker, Polyline } from "react-native-maps";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { getVehicleTypeDef, capSpeedLimit } from "@/data/vehicleTypes";
import ReportModal from "@/components/ReportModal";
import ReportUndoToast, { UndoableReport } from "@/components/ReportUndoToast";
import { AdminLocationPickerModal } from "@/components/AdminLocationPickerModal";
import { snapToRoad } from "@/utils/snapToRoad";
import { INCIDENT_TYPES, INCIDENT_TYPE_ORDER, resolveIncidentType } from "@/constants/incidentTypes";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";
import type { CommunityReport } from "@/context/AppContext";
import { formatTimeAgo } from "@/lib/timeAgo";

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
    <View collapsable={false} style={[styles.markerCircle, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}>
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

// Speed-limit badge — shown at road-stretch endpoints so the driver can see
// how the limit changes along the road (e.g. 50 → 80 → 110) at a glance.
function SpeedLimitBadge({ speed, bg }: { speed: number; bg: string }) {
  return (
    <View collapsable={false} style={[styles.speedBadge, { borderColor: bg }]}>
      <Text style={[styles.speedBadgeNum, { color: bg }]}>{speed}</Text>
      <Text style={[styles.speedBadgeUnit, { color: bg }]}>km/h</Text>
    </View>
  );
}

const ZONE_MARKER: Record<string, { ioniconName: React.ComponentProps<typeof Ionicons>["name"]; bg: string }> = {
  camera: { ioniconName: "camera",      bg: "#E53935" },
  police: { ioniconName: "person",      bg: "#1565C0" },
  zone:   { ioniconName: "speedometer", bg: "#E65100" },
};

// Legend: all 12 community-report types + static Zone entry
const LEGEND_ITEMS: Array<{ key: string; label: string; emoji: string }> = [
  ...INCIDENT_TYPE_ORDER.map((t) => ({
    key: t,
    label: INCIDENT_TYPES[t].label,
    emoji: INCIDENT_TYPES[t].emoji,
  })),
  { key: "zone", label: "Speed Zone", emoji: "⚡" },
];

function reportLabel(type: string): string {
  return resolveIncidentType(type).label;
}

// ─── Cluster grouping ─────────────────────────────────────────────────────────

type ClusterGroup = { members: CommunityReport[]; lat: number; lng: number };
const CLUSTER_RADIUS = 0.003;

function clusterReports(reports: CommunityReport[]): ClusterGroup[] {
  const used = new Set<string>();
  const clusters: ClusterGroup[] = [];
  for (const r of reports) {
    if (used.has(r.id)) continue;
    // ── Crash guard ── skip any report whose coordinates are missing or NaN ──
    if (r.lat == null || r.lng == null || isNaN(r.lat) || isNaN(r.lng)) continue;
    const group: ClusterGroup = { members: [r], lat: r.lat, lng: r.lng };
    used.add(r.id);
    for (const s of reports) {
      if (used.has(s.id)) continue;
      if (s.lat == null || s.lng == null || isNaN(s.lat) || isNaN(s.lng)) continue;
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
    // Admin-confirmed camera reports look identical to static speed-camera zone
    // markers — red circle with a camera icon, not the emoji blob used for
    // transient community incidents.
    if (r.type === "camera") {
      return (
        <View
          collapsable={false}
          style={{
            opacity: faded ? 0.45 : 1,
            width: 32, height: 32, borderRadius: 16,
            backgroundColor: "#E53935",
            alignItems: "center", justifyContent: "center",
            borderWidth: 2.5, borderColor: "#FFF",
            shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.35, shadowRadius: 4, elevation: 7,
          }}
        >
          <Ionicons name="camera" size={16} color="#FFF" />
        </View>
      );
    }
    const def = resolveIncidentType(r.type);
    return (
      <View collapsable={false} style={{ opacity: faded ? 0.45 : 1 }}>
        <View style={[styles.emojiMarker, { backgroundColor: def.color }]}>
          <Text style={styles.emojiMarkerText}>{def.emoji}</Text>
        </View>
      </View>
    );
  }

  const icons = members.slice(0, 4);
  return (
    <View collapsable={false} style={{ opacity: faded ? 0.45 : 1 }}>
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


export default function MapViewScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    currentLat, currentLng,
    communityReports, addReport, deleteReport,
    activeRoute, altRoutes, selectRoute,
    navigationActive,
    showTraffic, setShowTraffic,
    vehicleType, allZones,
    confirmReport, denyReport, flagReport,
    driverHeading,
    isAdmin, adminVerifyReport, adminDenyReport, adminUpdateReportLocation,
    adminUpdateZoneLocation, adminRemoveZone, adminVerifyZone,
  } = useApp();

  /** Returns true when the marker at (lat, lng) is behind the driver
   *  (angle from heading > 90°). When heading is unknown, all markers are
   *  treated as "ahead" so the map is never unexpectedly faded on first load. */
  const isPinBehind = (lat: number, lng: number): boolean => {
    if (driverHeading == null || currentLat == null || currentLng == null) return false;
    const bearing = Math.atan2(
      Math.sin(((lng - currentLng) * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180),
      Math.cos((currentLat * Math.PI) / 180) * Math.sin((lat * Math.PI) / 180) -
        Math.sin((currentLat * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180) *
        Math.cos(((lng - currentLng) * Math.PI) / 180)
    ) * 180 / Math.PI;
    const bearing360 = (bearing + 360) % 360;
    const diff = Math.abs(driverHeading - bearing360) % 360;
    const angleDiff = diff > 180 ? 360 - diff : diff;
    return angleDiff > 90;
  };
  const vehicle = getVehicleTypeDef(vehicleType);

  const [showReport, setShowReport] = useState(false);
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const [undoReport, setUndoReport] = useState<UndoableReport | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<ClusterGroup | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [flaggingId, setFlaggingId] = useState<string | null>(null);
  const [adminLocationTarget, setAdminLocationTarget] = useState<CommunityReport | null>(null);

  // Zone tap sheet state
  const [selectedZone, setSelectedZone] = useState<typeof allZones[0] | null>(null);
  const zoneOpenedAtRef = useRef(0);
  const [adminZoneLocationTarget, setAdminZoneLocationTarget] = useState<typeof allZones[0] | null>(null);
  const clusters = useMemo(() => clusterReports(communityReports), [communityReports]);
  const mapRef = useRef<MapView>(null);
  const openedAtRef = useRef(0);
  const now = Date.now();

  // Cluster markers always keep tracksViewChanges={true} — see DriveMapView
  // for the full explanation. The freeze optimisation caused tap hit-detection
  // to break whenever communityReports changed (polls, votes, new reports).

  const handleReport = async (type: CommunityReport["type"], speedLimit?: number, location?: { lat: number; lng: number }) => {
    setShowReport(false);
    let id: string | undefined;
    if (location) {
      id = addReport(type, location.lat, location.lng, speedLimit);
    } else if (currentLat && currentLng) {
      const snapped = await snapToRoad(currentLat, currentLng);
      id = addReport(type, snapped.lat, snapped.lng, speedLimit);
    }
    if (id) setUndoReport({ id, type });
  };

  const undoLastReport = () => {
    if (undoReport) deleteReport(undoReport.id);
    setUndoReport(null);
  };

  const openCluster = (group: ClusterGroup) => {
    openedAtRef.current = Date.now();
    setSelectedCluster(group);
  };
  const closeCluster = () => {
    // Guard against the react-native-maps ghost-touch quirk where a Marker
    // tap also fires a press on whatever full-screen overlay mounts underneath,
    // closing the sheet instantly.
    if (Date.now() - openedAtRef.current < 400) return;
    setSelectedCluster(null);
  };
  const handleAdminVerify = async (r: CommunityReport) => {
    const id = r.serverId ?? r.id;
    try {
      await adminVerifyReport(id);
      setSelectedCluster((prev) =>
        prev
          ? {
              ...prev,
              members: prev.members.map((m) =>
                m.id === r.id || m.serverId === id
                  ? { ...m, adminVerified: true, status: "confirmed" as const }
                  : m
              ),
            }
          : prev
      );
    } catch (err: any) {
      Alert.alert("Verification Failed", err?.message ?? "Check your connection and try again.");
    }
  };

  const handleAdminDeny = (r: CommunityReport) => {
    Alert.alert("Remove Report", "Permanently remove this report from the map?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          const id = r.serverId ?? r.id;
          try {
            await adminDenyReport(id);
            setSelectedCluster((prev) => {
              if (!prev) return prev;
              const remaining = prev.members.filter((m) => m.id !== r.id && m.serverId !== id);
              return remaining.length ? { ...prev, members: remaining } : null;
            });
          } catch (err: any) {
            Alert.alert("Remove Failed", err?.message ?? "Check your connection and try again.");
          }
        },
      },
    ]);
  };

  const handleFlagReport = (id: string) => {
    Alert.alert(
      "Report to moderators",
      "Once 2 drivers report the same thing, it's hidden until a moderator reviews it. Tell us why this one should be reviewed:",
      [
        { text: "Inaccurate location", onPress: () => submitFlag(id, "inaccurate_location") },
        { text: "Already gone",        onPress: () => submitFlag(id, "already_gone") },
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
        customMapStyle={c.isDark ? DARK_MAP_STYLE : []}
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
        {/* Speed zone markers — null-guard coordinates to prevent the iOS
            NSInvalidArgumentException crash when lat/lng is null/undefined.
            Road-stretch endpoints show a speed-limit badge at each end. */}
        {allZones.map((z) => {
          // ── Crash guard ── skip any zone with a missing coordinate ──────────
          if (z.lat == null || z.lng == null || isNaN(z.lat) || isNaN(z.lng)) return null;
          const m = ZONE_MARKER[z.type] ?? ZONE_MARKER.zone;
          const behind = isPinBehind(z.lat, z.lng);
          return (
            <React.Fragment key={z.id}>
              <Marker
                coordinate={{ latitude: z.lat, longitude: z.lng }}
                anchor={{ x: 0.5, y: 1 }}
                title={z.name}
                description={`${capSpeedLimit(z.speedLimit, vehicle)} km/h — ${z.road}`}
                opacity={behind ? 0.3 : 1}
                tracksViewChanges={true}
                onPress={() => {
                  zoneOpenedAtRef.current = Date.now();
                  setSelectedZone(z);
                }}
              >
                {z.isStretchEndpoint ? (
                  <SpeedLimitBadge speed={capSpeedLimit(z.speedLimit, vehicle)} bg={m.bg} />
                ) : (
                  <MarkerIcon ioniconName={m.ioniconName} bg={m.bg} />
                )}
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

        {/* Community report clusters — tap opens the bottom-sheet modal.
            Cluster lat/lng is already validated by clusterReports(), but we
            double-check here as a last safety net before hitting the native layer. */}
        {clusters.map((group) => {
          if (group.lat == null || group.lng == null || isNaN(group.lat) || isNaN(group.lng)) return null;
          const clusterKey = group.members.map((m) => m.id).sort().join("-");
          const behind = isPinBehind(group.lat, group.lng);
          return (
            <Marker
              key={clusterKey}
              coordinate={{ latitude: group.lat, longitude: group.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={true}
              zIndex={10}
              opacity={behind ? 0.3 : 1}
              onPress={() => openCluster(group)}
            >
              <MapClusterMarker group={group} now={now} />
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

      {/* Legend — minimize/maximize */}
      <View style={[styles.legendWrap, { backgroundColor: c.card + "EE", top: insets.top + 12 }]}>
        <TouchableOpacity
          style={styles.legendToggleRow}
          onPress={() => setLegendCollapsed((v) => !v)}
          activeOpacity={0.7}
        >
          <Text style={[styles.legendTitle, { color: c.foreground }]}>Map Guide</Text>
          <Ionicons
            name={legendCollapsed ? "chevron-down" : "chevron-up"}
            size={18}
            color={c.primary}
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
                <Text style={styles.legendEmoji}>{l.emoji}</Text>
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

      {/* Report button — left side so it never conflicts with the right controls */}
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

      <ReportUndoToast
        report={undoReport}
        bottom={insets.bottom + 172}
        onUndo={undoLastReport}
        onDismiss={() => setUndoReport(null)}
      />

      <ReportModal
        visible={showReport}
        onClose={() => setShowReport(false)}
        onSubmit={handleReport}
        currentLat={currentLat}
        currentLng={currentLng}
      />

      {/* Admin Fix Pin modal — community reports */}
      {adminLocationTarget && (
        <AdminLocationPickerModal
          visible
          reportId={adminLocationTarget.serverId ?? adminLocationTarget.id}
          initialLat={adminLocationTarget.lat}
          initialLng={adminLocationTarget.lng}
          initialRoadName={adminLocationTarget.roadName}
          onClose={() => setAdminLocationTarget(null)}
          onSave={async (lat, lng, roadName) => {
            const id = adminLocationTarget.serverId ?? adminLocationTarget.id;
            await adminUpdateReportLocation(id, lat, lng, roadName ?? null);
            setAdminLocationTarget(null);
          }}
        />
      )}

      {/* Admin Fix Pin modal — speed zones (rendered outside zone sheet so
          iOS can show it without two <Modal>s stacked simultaneously). */}
      {adminZoneLocationTarget && (
        <AdminLocationPickerModal
          visible
          reportId={adminZoneLocationTarget.id}
          initialLat={adminZoneLocationTarget.lat}
          initialLng={adminZoneLocationTarget.lng}
          initialRoadName={adminZoneLocationTarget.road ?? undefined}
          onClose={() => setAdminZoneLocationTarget(null)}
          onSave={async (lat, lng) => {
            const z = adminZoneLocationTarget;
            await adminUpdateZoneLocation(z.id, lat, lng, z);
            setAdminZoneLocationTarget(null);
          }}
        />
      )}

      {/* ── Zone detail sheet ─────────────────────────────────────────────── */}
      {selectedZone && (
        <Modal
          visible
          transparent
          animationType="slide"
          onRequestClose={() => setSelectedZone(null)}
        >
          <TouchableOpacity
            style={ms.backdrop}
            onPress={() => {
              if (Date.now() - zoneOpenedAtRef.current < 400) return;
              setSelectedZone(null);
            }}
            activeOpacity={1}
          >
            <TouchableOpacity activeOpacity={1} style={ms.sheet}>
              <View style={ms.handle} />

              {/* Header */}
              <View style={ms.headerRow}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Text style={ms.sheetTitle}>{selectedZone.name}</Text>
                    {selectedZone.verified && (
                      <View style={[ms.verifiedBadge, { backgroundColor: "#E3F2FD" }]}>
                        <Ionicons name="shield-checkmark" size={11} color="#1565C0" />
                        <Text style={[ms.verifiedTxt, { color: "#1565C0" }]}>Admin Verified</Text>
                      </View>
                    )}
                  </View>
                  {selectedZone.road ? (
                    <Text style={ms.incidentRoad}>{selectedZone.road}</Text>
                  ) : null}
                </View>
                <TouchableOpacity onPress={() => setSelectedZone(null)} style={ms.closeBtn}>
                  <Ionicons name="close" size={20} color="#888" />
                </TouchableOpacity>
              </View>

              {/* Details */}
              <View style={{ flexDirection: "row", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <View style={[ms.zonePill, { backgroundColor: selectedZone.type === "camera" ? "#FFEBEE" : selectedZone.type === "police" ? "#EDE7F6" : "#FFF8E1" }]}>
                  <Ionicons
                    name={selectedZone.type === "camera" ? "camera" : selectedZone.type === "police" ? "shield" : "speedometer"}
                    size={13}
                    color={selectedZone.type === "camera" ? "#C62828" : selectedZone.type === "police" ? "#4527A0" : "#E65100"}
                  />
                  <Text style={[ms.zonePillTxt, { color: selectedZone.type === "camera" ? "#C62828" : selectedZone.type === "police" ? "#4527A0" : "#E65100" }]}>
                    {selectedZone.type === "camera" ? "Speed Camera" : selectedZone.type === "police" ? "Police" : "Speed Zone"}
                  </Text>
                </View>
                <View style={[ms.zonePill, { backgroundColor: "#E8F5E9" }]}>
                  <Ionicons name="speedometer-outline" size={13} color="#2E7D32" />
                  <Text style={[ms.zonePillTxt, { color: "#2E7D32" }]}>{capSpeedLimit(selectedZone.speedLimit, vehicle)} km/h</Text>
                </View>
              </View>

              {selectedZone.description ? (
                <Text style={[ms.incidentMeta, { marginTop: 10, lineHeight: 18 }]}>{selectedZone.description}</Text>
              ) : null}

              {/* Admin actions */}
              {isAdmin && (
                <View style={ms.adminActionRow}>
                  <TouchableOpacity
                    style={[ms.adminBtn, { backgroundColor: "#E8F5E920", borderColor: "#1B5E2040" }]}
                    onPress={async () => {
                      try {
                        await adminVerifyZone(selectedZone.id, selectedZone);
                        setSelectedZone((prev) => prev ? { ...prev, verified: true } : prev);
                      } catch {
                        Alert.alert("Error", "Could not verify zone.");
                      }
                    }}
                  >
                    <Ionicons name={selectedZone.verified ? "checkmark-circle" : "checkmark-circle-outline"} size={14} color="#1B5E20" />
                    <Text style={[ms.adminBtnTxt, { color: "#1B5E20" }]}>{selectedZone.verified ? "✓ Verified" : "Verify"}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[ms.adminBtn, { backgroundColor: "#FFEBEE20", borderColor: "#B71C1C40" }]}
                    onPress={() => {
                      Alert.alert("Remove Zone", `Remove "${selectedZone.name}" from the map?`, [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Remove", style: "destructive",
                          onPress: async () => {
                            try {
                              await adminRemoveZone(selectedZone.id, selectedZone);
                              setSelectedZone(null);
                            } catch {
                              Alert.alert("Remove Failed", "Check your connection and try again.");
                            }
                          },
                        },
                      ]);
                    }}
                  >
                    <Ionicons name="close-circle-outline" size={14} color="#B71C1C" />
                    <Text style={[ms.adminBtnTxt, { color: "#B71C1C" }]}>Remove</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[ms.adminBtn, { backgroundColor: "#E3F2FD20", borderColor: "#1565C040" }]}
                    onPress={() => {
                      setSelectedZone(null);
                      // Delay to let zone modal close before Fix Pin modal opens
                      setTimeout(() => setAdminZoneLocationTarget(selectedZone), 50);
                    }}
                  >
                    <Ionicons name="location-outline" size={14} color="#1565C0" />
                    <Text style={[ms.adminBtnTxt, { color: "#1565C0" }]}>Fix Pin</Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {/* ── Incident detail sheet ─────────────────────────────────────────── */}
      {selectedCluster && (
        <Modal
          visible
          transparent
          animationType="slide"
          onRequestClose={closeCluster}
        >
          <TouchableOpacity style={ms.backdrop} onPress={closeCluster} activeOpacity={1}>
            <TouchableOpacity activeOpacity={1} style={ms.sheet}>
              <View style={ms.handle} />

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

              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 340 }}>
                {selectedCluster.members.map((r, i) => {
                  const def = resolveIncidentType(r.type);
                  const ageStr = formatTimeAgo(r.timestamp, now);
                  const confirmed = r.status === "confirmed";
                  return (
                    <View key={r.id} style={[ms.incidentRow, i > 0 && ms.incidentDivider]}>
                      <View style={[ms.incidentIcon, { backgroundColor: def.color + "22" }]}>
                        <Text style={ms.incidentEmoji}>{def.emoji}</Text>
                      </View>
                      <View style={{ flex: 1, gap: 3 }}>
                        <View style={ms.incidentLabelRow}>
                          <Text style={ms.incidentType}>{reportLabel(r.type)}</Text>
                          {r.adminVerified && (
                            <View style={[ms.verifiedBadge, { backgroundColor: "#E3F2FD", borderColor: "#1565C030" }]}>
                              <Ionicons name="shield-checkmark" size={11} color="#1565C0" />
                              <Text style={[ms.verifiedTxt, { color: "#1565C0" }]}>Admin Verified</Text>
                            </View>
                          )}
                          {!r.adminVerified && confirmed && (
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
                        {r.roadName ? <Text style={ms.incidentRoad}>{r.roadName}</Text> : null}
                        <Text style={ms.incidentMeta}>
                          {r.type === "camera" ? "Speed camera — permanent" : ageStr}
                          {r.type !== "camera" && r.confirmCount != null && r.confirmCount > 1 ? `  ·  ${r.confirmCount > 99 ? "99+" : r.confirmCount} say still here` : ""}
                          {r.type !== "camera" && r.denyCount != null && r.denyCount > 0 ? `  ·  ${r.denyCount > 99 ? "99+" : r.denyCount} say gone` : ""}
                          {r.type === "camera" && r.speedLimit ? `  ·  ${capSpeedLimit(r.speedLimit, vehicle)} km/h zone` : ""}
                        </Text>
                        {r.type === "camera" ? (
                          <View style={ms.voteRow}>
                            <View style={ms.cameraPermanentNote}>
                              <Ionicons name="shield-checkmark-outline" size={12} color="#1565C0" />
                              <Text style={ms.cameraPermanentTxt}>Managed by our team — flag if misplaced</Text>
                            </View>
                            <TouchableOpacity
                              style={[ms.voteBtn, { backgroundColor: "#75757518", borderColor: "#75757555" }, flaggingId === r.id && ms.voteBtnDisabled]}
                              disabled={flaggingId === r.id}
                              onPress={() => handleFlagReport(r.id)}
                            >
                              <Ionicons name="flag-outline" size={13} color={flaggingId === r.id ? "#9E9E9E" : "#757575"} />
                              <Text style={[ms.voteTxt, { color: flaggingId === r.id ? "#9E9E9E" : "#757575" }]}>
                                {flaggingId === r.id ? "Sending…" : "Flag"}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View style={ms.voteRow}>
                            <TouchableOpacity
                              style={[ms.voteBtn, { backgroundColor: "#388E3C18", borderColor: "#388E3C55" }]}
                              onPress={() => {
                                confirmReport(r.id);
                                Alert.alert("Thanks!", "We've noted this and extended the warning for other drivers.");
                                setSelectedCluster(null);
                              }}
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
                                  Alert.alert("Thanks for the update", "Your report helps our team keep the map accurate.");
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
                        {isAdmin && (
                          <View style={ms.adminActionRow}>
                            <TouchableOpacity
                              style={[ms.adminBtn, { backgroundColor: "#E8F5E920", borderColor: "#1B5E2040" }]}
                              onPress={() => handleAdminVerify(r)}
                            >
                              <Ionicons name="checkmark-circle" size={13} color="#1B5E20" />
                              <Text style={[ms.adminBtnTxt, { color: "#1B5E20" }]}>
                                {r.adminVerified ? "✓ Verified" : "Verify"}
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[ms.adminBtn, { backgroundColor: "#FFEBEE20", borderColor: "#B71C1C40" }]}
                              onPress={() => handleAdminDeny(r)}
                            >
                              <Ionicons name="close-circle" size={13} color="#B71C1C" />
                              <Text style={[ms.adminBtnTxt, { color: "#B71C1C" }]}>Remove</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[ms.adminBtn, { backgroundColor: "#E3F2FD20", borderColor: "#1565C040" }]}
                              onPress={() => {
                                // Close cluster modal first — iOS cannot show two
                                // <Modal>s simultaneously.
                                setSelectedCluster(null);
                                setAdminLocationTarget(r);
                              }}
                            >
                              <Ionicons name="location" size={13} color="#1565C0" />
                              <Text style={[ms.adminBtnTxt, { color: "#1565C0" }]}>Fix Pin</Text>
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
  speedBadge: {
    minWidth: 44, paddingHorizontal: 6, paddingVertical: 3,
    borderRadius: 10, backgroundColor: "#FFF",
    borderWidth: 2, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35, shadowRadius: 4, elevation: 7,
  },
  speedBadgeNum: { fontSize: 15, fontFamily: "Inter_700Bold", lineHeight: 17 },
  speedBadgeUnit: { fontSize: 8, fontFamily: "Inter_600SemiBold", opacity: 0.85, lineHeight: 9 },
  legendWrap: {
    position: "absolute", left: 12,
    borderRadius: 12,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 6, elevation: 6,
    maxHeight: 320,
  },
  legendScroll: { borderRadius: 12 },
  legendContent: { padding: 10, gap: 6 },
  emojiMarker: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.28, shadowRadius: 4, elevation: 5,
  },
  emojiMarkerText: { fontSize: 18, lineHeight: 22, fontFamily: EMOJI_FONT_FAMILY },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendEmoji: { fontSize: 16, width: 22, textAlign: "center", fontFamily: EMOJI_FONT_FAMILY },
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
    position: "absolute", left: 16,
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 28,
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 8,
  },
  reportBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  clusterWrap: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  clusterGrid: { width: 36, height: 36, flexWrap: "wrap", flexDirection: "row", gap: 2, borderRadius: 10, overflow: "hidden" },
  clusterCell: { width: 16, height: 16, alignItems: "center", justifyContent: "center", borderRadius: 4 },
  clusterEmoji: { fontSize: 9, fontFamily: EMOJI_FONT_FAMILY },
  clusterBadge: {
    position: "absolute", bottom: 0, right: 0,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: "#FFF", alignItems: "center", justifyContent: "center",
    paddingHorizontal: 4, borderWidth: 1.5, borderColor: "#00000020",
  },
  clusterBadgeTxt: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#222" },
  legendToggleRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8, gap: 14, minWidth: 130,
  },
  legendTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  trafficBadge: {
    position: "absolute", right: 12,
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14,
  },
  trafficLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});

const ms = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
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
  incidentRow: { flexDirection: "row", gap: 12, paddingVertical: 12, alignItems: "flex-start" },
  incidentDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#EBEBEB" },
  incidentIcon: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: "center", justifyContent: "center", marginTop: 2,
  },
  incidentEmoji: { fontSize: 20, lineHeight: 26, fontFamily: EMOJI_FONT_FAMILY },
  incidentLabelRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  incidentType: { fontSize: 15, fontWeight: "700", color: "#212121" },
  verifiedBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "#E8F5E9", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
  },
  verifiedTxt: { fontSize: 10, fontWeight: "700", color: "#2E7D32" },
  ownBadge: { backgroundColor: "#E3F2FD", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  ownTxt: { fontSize: 10, fontWeight: "700", color: "#1565C0" },
  incidentRoad: { fontSize: 12, fontWeight: "600", color: "#1565C0", marginTop: 1 },
  incidentMeta: { fontSize: 12, color: "#888" },
  voteRow: { flexDirection: "row", gap: 8, marginTop: 4, flexWrap: "wrap" },
  voteBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1,
  },
  voteBtnDisabled: { opacity: 0.5 },
  voteTxt: { fontSize: 12, fontWeight: "600" },
  cameraPermanentNote: {
    flexDirection: "row", alignItems: "center", gap: 4,
    flex: 1,
  },
  cameraPermanentTxt: { fontSize: 11, color: "#1565C0", fontWeight: "500", flex: 1 },
  adminActionRow: {
    flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap",
  },
  adminBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, borderWidth: 1,
  },
  adminBtnTxt: { fontSize: 11, fontWeight: "600" },
  zonePill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  zonePillTxt: { fontSize: 12, fontWeight: "600" },
});
