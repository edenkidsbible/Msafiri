import React, { useEffect, useMemo, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { AdminLocationPickerModal } from "./AdminLocationPickerModal";

export type DriveMapViewHandle = {
  recenter: () => void;
  /** Pan the map to the given coordinates and briefly show a highlight ring. */
  focusCoords: (lat: number, lng: number) => void;
};
import DARK_MAP_STYLE from "@/constants/darkMapStyle";
import { SCROLL_PROPS } from "@/lib/scrollProps";
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Circle, Marker, Polyline, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useApp } from "@/context/AppContext";
import type { CommunityReport, SpeedInterval } from "@/context/AppContext";
import type { SpeedZone } from "@/data/speedZones";
import { useColors } from "@/hooks/useColors";
import type { POI } from "@/data/pois";
import { apiGet } from "@/utils/apiClient";
import { INCIDENT_TYPES, INCIDENT_TYPE_ORDER, resolveIncidentType } from "@/constants/incidentTypes";
import { getVehicleTypeDef, capSpeedLimit } from "@/data/vehicleTypes";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";
import { formatTimeAgo } from "@/lib/timeAgo";

const NAIROBI = { latitude: -1.2921, longitude: 36.8219, latitudeDelta: 0.08, longitudeDelta: 0.08 };
const POI_RADIUS_M = 8000;
const CLUSTER_DIST_M = 35;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the coordinate at a fractional position (0–1) along a polyline,
 *  walking cumulative chord lengths so the result is distance-accurate. */
function midpointCoord(
  coords: { latitude: number; longitude: number }[],
  fraction = 0.5,
): { latitude: number; longitude: number } | null {
  if (coords.length === 0) return null;
  if (coords.length === 1) return coords[0];

  // Compute total chord length
  let total = 0;
  const segs: number[] = [];
  for (let i = 1; i < coords.length; i++) {
    const d = Math.hypot(
      coords[i].latitude - coords[i - 1].latitude,
      coords[i].longitude - coords[i - 1].longitude,
    );
    segs.push(d);
    total += d;
  }

  const target = total * Math.max(0, Math.min(1, fraction));
  let walked = 0;
  for (let i = 0; i < segs.length; i++) {
    if (walked + segs[i] >= target) {
      const t = segs[i] > 0 ? (target - walked) / segs[i] : 0;
      return {
        latitude: coords[i].latitude + t * (coords[i + 1].latitude - coords[i].latitude),
        longitude: coords[i].longitude + t * (coords[i + 1].longitude - coords[i].longitude),
      };
    }
    walked += segs[i];
  }
  return coords[coords.length - 1];
}

/** Format seconds as "X min" or "Xh Ym". */
function fmtDuration(s: number): string {
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Format metres as "X.X km" or "X m". */
function fmtDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

/** Format a signed delta as e.g. "+2 min · +1.4 km" or "−1 min · −0.8 km". */
function fmtDelta(deltaS: number, deltaM: number): string {
  const sign = (n: number) => (n >= 0 ? "+" : "−");
  const time = `${sign(deltaS)}${fmtDuration(Math.abs(deltaS))}`;
  const dist = `${sign(deltaM)}${fmtDistance(Math.abs(deltaM))}`;
  return `${time} · ${dist}`;
}

// ─── Divergence badge — mid-route pill with time/distance delta ───────────────

function DivergenceBadge({
  label,
  isRecommended,
}: {
  label: string;
  isRecommended: boolean;
}) {
  return (
    <View collapsable={false} style={ms.divBadgeWrap}>
      {isRecommended && (
        <View style={ms.divBadgeRec}>
          <Text style={ms.divBadgeRecTxt}>✓ Recommended</Text>
        </View>
      )}
      <View style={[ms.divBadgePill, isRecommended && ms.divBadgePillRec]}>
        <Text style={ms.divBadgeTxt}>{label}</Text>
      </View>
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

  if (members.length === 1) {
    const r = members[0];
    // Admin-confirmed camera reports use the same red camera circle as static
    // speed-camera zone markers — they are permanent infrastructure, not transient incidents.
    if (r.type === "camera") {
      return (
        <View collapsable={false}>
          <MarkerIcon ioniconName="camera" bg="#E53935" size={32} />
        </View>
      );
    }
    const def = resolveIncidentType(r.type);
    const confirmed = r.status === "confirmed";

    // #31 — Confidence tier styling
    const confirms = r.confirmCount ?? 0;
    const tier = confirms >= 5 ? "reliable" : confirms >= 2 ? "confirmed" : "new";
    const markerBg =
      confirmed ? "#B71C1C" :
      tier === "reliable" ? "#1B5E20" :   // deep green — highly reliable
      tier === "confirmed" ? def.color :   // normal color — confirmed
      def.color;                           // new — normal color, smaller opacity below

    return (
      // Full opacity always — staleness/new-report dimming removed so fresh and
      // active reports render clearly (confidence tiers still change color/ring).
      <View collapsable={false}>
        {/* Outer glow ring for "reliable" reports */}
        {tier === "reliable" && (
          <View style={[ms.reliableRing, { borderColor: markerBg }]} />
        )}
        <View style={[ms.emojiMarker, { backgroundColor: markerBg }]}>
          <Text style={ms.emojiMarkerText}>{def.emoji}</Text>
        </View>
        {/* Confirm count badge — show shield for admin-verified, numeric for community confirms */}
        {(r.adminVerified || confirms >= 2) && (
          <View style={[ms.confirmBadge, { backgroundColor: r.adminVerified ? "#1565C0" : (tier === "reliable" ? "#1B5E20" : "#37474F") }]}>
            <Text style={ms.confirmBadgeTxt}>{r.adminVerified ? "✓" : (confirms > 99 ? "99+" : confirms)}</Text>
          </View>
        )}
      </View>
    );
  }

  const icons = members.slice(0, 4);
  return (
    <View collapsable={false}>
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

// ─── Traffic-coloured polyline helpers ───────────────────────────────────────

type SpeedBand = "NORMAL" | "SLOW" | "TRAFFIC_JAM" | "SPEED_UNSPECIFIED";

const TRAFFIC_COLOR: Record<SpeedBand, string> = {
  NORMAL:           "#1976D2",
  SPEED_UNSPECIFIED:"#1976D2",
  SLOW:             "#FFC107",
  TRAFFIC_JAM:      "#F44336",
};
const TRAFFIC_HALO: Record<SpeedBand, string> = {
  NORMAL:           "#0D47A1AA",
  SPEED_UNSPECIFIED:"#0D47A1AA",
  SLOW:             "#E65100AA",
  TRAFFIC_JAM:      "#B71C1CAA",
};

/** Slice `coords` into coloured segments according to speed-reading intervals.
 *  `startOffset` is the index into the full route coords array where `coords`
 *  begins (0 for the full route, bestIdx for the remaining-ahead slice).
 *  Falls back to a single blue segment when no interval data is available. */
function buildTrafficSegments(
  coords: { latitude: number; longitude: number }[],
  speedIntervals: SpeedInterval[] | undefined,
  startOffset = 0,
): Array<{ coords: { latitude: number; longitude: number }[]; color: string; halo: string }> {
  if (!speedIntervals?.length) {
    return [{ coords, color: "#1976D2", halo: "#0D47A1AA" }];
  }
  const segments: Array<{ coords: { latitude: number; longitude: number }[]; color: string; halo: string }> = [];
  const end = startOffset + coords.length - 1;
  for (const iv of speedIntervals) {
    // Clamp interval to the visible window
    const s = Math.max(iv.startIndex, startOffset) - startOffset;
    const e = Math.min(iv.endIndex,   end)           - startOffset;
    if (s >= coords.length || e < 0 || s > e) continue;
    const seg = coords.slice(s, e + 1);
    if (seg.length < 2) continue;
    const band = (iv.speed as SpeedBand) ?? "NORMAL";
    segments.push({
      coords: seg,
      color:  TRAFFIC_COLOR[band]  ?? "#1976D2",
      halo:   TRAFFIC_HALO[band]   ?? "#0D47A1AA",
    });
  }
  return segments.length ? segments : [{ coords, color: "#1976D2", halo: "#0D47A1AA" }];
}

// ─── Speed-adaptive zoom ──────────────────────────────────────────────────────
//
// Maps the driver's current speed (km/h) to a latitudeDelta value for the map
// camera. Higher speed → larger delta (more road visible ahead). Four bands
// cover the spectrum from stopped to highway:
//
//   <  15 km/h  →  0.004  (street-level  — tight view for parking/slow urban)
//   15–60 km/h  →  0.004…0.010  (urban arterial)
//   60–100 km/h →  0.010…0.018  (dual-carriageway / fast road)
//   > 100 km/h  →  0.030  (highway — shows ~3 km ahead)
//
// Zoom band changes are gated by a 5-second hysteresis in the camera effect —
// the target band must be sustained before the camera animates to it.
function speedToLatDelta(kmh: number): number {
  if (kmh < 15)  return 0.004;
  if (kmh < 60)  return 0.004 + (0.006 * (kmh - 15) / 45);
  if (kmh < 100) return 0.010 + (0.008 * (kmh - 60) / 40);
  return 0.030;
}

// Low-pass filter for compass heading, handling the 360°/0° wraparound so
// the camera never spins the long way round when crossing north.
// alpha = 0.25 → heading tracks changes in ~4–6 GPS fixes (~4–6 s).
function smoothHeading(current: number | null, target: number, alpha = 0.25): number {
  if (current == null) return target;
  let diff = target - current;
  if (diff >  180) diff -= 360;
  if (diff < -180) diff += 360;
  return (current + diff * alpha + 360) % 360;
}

// ─── Main map component ───────────────────────────────────────────────────────

const DriveMapView = forwardRef(function DriveMapView(
  {
    mapDrifted = false,
    onDriftChange,
  }: {
    /** True when the driver has panned/zoomed away from their GPS position.
     *  Auto-follow is suspended while drifted; recenter() clears it. */
    mapDrifted?: boolean;
    onDriftChange?: (drifted: boolean) => void;
  },
  ref: React.ForwardedRef<DriveMapViewHandle>,
) {
  const {
    currentLat, currentLng, currentSpeed,
    activeRoute, altRoutes, divergenceRoutes, selectRoute, startNavigation,
    navigationActive, communityReports, showTraffic,
    confirmReport, denyReport, flagReport,
    vehicleType, allZones,
    pendingFocusCoords, setPendingFocusCoords,
    isAdmin, adminVerifyReport, adminDenyReport, adminUpdateReportLocation,
    adminUpdateZoneLocation, adminRemoveZone,
    driverHeading,
    durationRemainingS, distanceRemainingM,
    fasterRoute,
  } = useApp();
  const vehicle = getVehicleTypeDef(vehicleType);
  const { isDark } = useColors();

  const mapRef = useRef<MapView>(null);
  const hasCenteredRef = useRef(false);
  const now = Date.now();

  // Tracks the last latitudeDelta applied to the map camera so recenter() can
  // reset the smoothing baseline after a manual pan.  Kept in sync with
  // appliedDeltaRef below; both refs serve slightly different callsites.
  const lastDeltaRef = useRef(0.015);

  // Mirror mapDrifted in a ref so the onRegionChangeComplete callback can read
  // the current value without recreating itself on every prop change.
  const mapDriftedRef = useRef(mapDrifted);
  useEffect(() => { mapDriftedRef.current = mapDrifted; }, [mapDrifted]);

  // ── Camera-smoothing refs ─────────────────────────────────────────────────
  // These are camera-only; raw GPS values consumed by alerts/navigation are
  // untouched.

  // Low-pass filtered heading — avoids snap-rotations when GPS bearing jumps.
  // null = not yet initialised (use raw target on first fix).
  const camHeadingRef = useRef<number | null>(null);

  // The latitudeDelta currently displayed on screen.  Only changes after the
  // target zoom band has been sustained for ZOOM_SUSTAIN_MS milliseconds so
  // noisy per-fix speed readings don't pulse the zoom level.
  const appliedDeltaRef = useRef(0.015);

  // Timestamp (Date.now()) when the target zoom band first diverged from the
  // applied band.  Cleared back to null once they converge again.
  const zoomBandTimestampRef = useRef<number | null>(null);

  // Camera position at the last issued camera update — used for the stationary
  // freeze: if speed is near-zero and position hasn't moved meaningfully since
  // the last update we skip re-animating so a parked map is rock-steady.
  const camLatRef = useRef<number | null>(null);
  const camLngRef = useRef<number | null>(null);

  // Always-current mirror of navigationActive — read inside deferred callbacks
  // to avoid stale-closure bugs where a setTimeout captures the wrong value.
  const navActiveRef = useRef(navigationActive);
  useEffect(() => { navActiveRef.current = navigationActive; });

  // Tracks the previous value of navigationActive so camera effects can detect
  // the false→true (nav start) and true→false (nav end) transitions.
  const prevNavActiveRef = useRef(navigationActive);
  const [selectedCluster, setSelectedCluster] = useState<ClusterGroup | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [flaggingId, setFlaggingId] = useState<string | null>(null);
  const [adminLocationTarget, setAdminLocationTarget] = useState<CommunityReport | null>(null);
  const [selectedZone, setSelectedZone] = useState<SpeedZone | null>(null);
  const [adminZoneLocationTarget, setAdminZoneLocationTarget] = useState<SpeedZone | null>(null);

  // Android + PROVIDER_GOOGLE: custom marker views must go through at least one
  // full render cycle with tracksViewChanges=true before the native layer
  // captures their bitmap. Setting false immediately causes the marker to appear
  // as a blank dot. We start true, then freeze after 1.5 s — long enough for
  // all static zone icons to paint but short enough to avoid sustained jank.
  const [markersFrozen, setMarkersFrozen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMarkersFrozen(true), 1500);
    return () => clearTimeout(t);
  }, []);

  // Temporary focus highlight — shown for 2.5 s after a Nearby Alert row tap
  const [focusHighlight, setFocusHighlight] = useState<{ lat: number; lng: number } | null>(null);
  const focusHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFlagReport = (id: string) => {
    Alert.alert(
      "Report to moderators",
      "Once 2 drivers report the same thing, it's hidden until a moderator reviews it. Tell us why this one should be reviewed:",
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

  // ─── Admin actions ─────────────────────────────────────────────────────────
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

  // Step 1 — hardened route-fit: re-check navActiveRef inside the timer so
  // that if navigation started during the 350 ms delay the fit is suppressed.
  useEffect(() => {
    if (navigationActive || !activeRoute?.coords.length) return;
    const coords = activeRoute.coords;
    const t = setTimeout(() => {
      if (navActiveRef.current) return; // nav started during the delay — abort
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 80, right: 30, bottom: 230, left: 30 },
        animated: true,
      });
    }, 350);
    return () => clearTimeout(t);
  }, [activeRoute?.id, navigationActive]);

  // How long a new zoom band must be sustained before the camera animates to it.
  // This prevents the zoom from pulsing on every noisy per-fix speed reading.
  const ZOOM_SUSTAIN_MS = 5_000;

  // Positional threshold below which we consider the driver stationary and
  // suppress camera panning entirely to avoid GPS-noise shake while parked.
  const STATIONARY_SPEED_KMH = 3.0;   // m/s × 3.6 — below this, apply freeze
  const STATIONARY_MOVE_M    = 5;     // metres — ignore smaller position jitter

  // Steps 2 & 4 — navigation camera + post-nav restore.
  //
  // Design principles:
  //   • Stationary freeze  — when speed < 3 km/h and position hasn't moved
  //     more than STATIONARY_MOVE_M since the last camera update, skip the
  //     pan entirely so a parked map is rock-steady.
  //   • Low-pass heading   — smooth heading through smoothHeading() so the map
  //     rotates gracefully instead of snap-jumping on noisy GPS bearing fixes.
  //   • Unified animation  — a single animateCamera({center, heading}) per fix
  //     supersedes the previous animation instead of stacking overlapping ones.
  //     We deliberately avoid passing zoom/altitude to animateCamera because on
  //     iOS Apple Maps that parameter drifts the altitude on every call; zoom
  //     changes go through animateToRegion (latitudeDelta) instead.
  //   • Zoom hysteresis    — the target zoom band must be sustained for
  //     ZOOM_SUSTAIN_MS before the camera zooms, so a single noisy speed spike
  //     never pulses the camera.
  useEffect(() => {
    const wasActive = prevNavActiveRef.current;
    prevNavActiveRef.current = navigationActive;

    if (!navigationActive) {
      if (wasActive) {
        // Navigation just ended — restore north-up orientation first, then
        // fit to the completed route (or pan to current position).
        camHeadingRef.current = 0;
        mapRef.current?.animateCamera({ heading: 0 }, { duration: 400 });
        if (activeRoute?.coords.length) {
          const coords = activeRoute.coords;
          setTimeout(() => {
            mapRef.current?.fitToCoordinates(coords, {
              edgePadding: { top: 80, right: 30, bottom: 230, left: 30 },
              animated: true,
            });
          }, 300);
        } else if (currentLat != null && currentLng != null) {
          mapRef.current?.animateToRegion(
            { latitude: currentLat, longitude: currentLng, latitudeDelta: 0.05, longitudeDelta: 0.05 },
            600
          );
        }
        return;
      }

      // ── Browsing follow (no active route, no navigation) ─────────────────
      // Keep the driver's dot in the centre of the screen while they're just
      // driving around without a set destination — pan + speed-adaptive zoom,
      // north-up so the map remains easy to read.
      // Pauses automatically as soon as they manually pan/zoom (drift flag),
      // resuming the moment they tap Recenter.
      if (
        !mapDriftedRef.current &&
        !activeRoute &&           // route preview overrides follow — don't fight fitToCoordinates
        currentLat != null &&
        currentLng != null &&
        hasCenteredRef.current    // initial center already done — safe to animate
      ) {
        // Stationary freeze: skip pan when parked and GPS hasn't moved meaningfully.
        const isStationary = (currentSpeed ?? 0) < STATIONARY_SPEED_KMH;
        if (isStationary && camLatRef.current != null && camLngRef.current != null) {
          const moved = haversine(camLatRef.current, camLngRef.current, currentLat, currentLng);
          if (moved < STATIONARY_MOVE_M) return;
        }
        camLatRef.current = currentLat;
        camLngRef.current = currentLng;

        // Zoom hysteresis: only apply new zoom band after it's been stable for
        // ZOOM_SUSTAIN_MS milliseconds so a single noisy speed spike never pulses
        // the view.
        const targetDelta = speedToLatDelta(currentSpeed ?? 0);
        const now = Date.now();
        if (Math.abs(targetDelta - appliedDeltaRef.current) > 0.0005) {
          if (zoomBandTimestampRef.current == null) {
            zoomBandTimestampRef.current = now;
          } else if (now - zoomBandTimestampRef.current >= ZOOM_SUSTAIN_MS) {
            // Sustained long enough — glide toward new zoom, then return.
            const smoothed = appliedDeltaRef.current + (targetDelta - appliedDeltaRef.current) * 0.3;
            appliedDeltaRef.current = smoothed;
            lastDeltaRef.current    = smoothed;
            zoomBandTimestampRef.current = null;
            mapRef.current?.animateToRegion(
              { latitude: currentLat, longitude: currentLng, latitudeDelta: smoothed, longitudeDelta: smoothed },
              500,
            );
            return;
          }
          // Not yet sustained — pan only, don't zoom.
        } else {
          zoomBandTimestampRef.current = null; // back in the stable band
        }

        // North-up browsing: pan only — no heading change.
        mapRef.current?.animateCamera(
          { center: { latitude: currentLat, longitude: currentLng } },
          { duration: 300 },
        );
      }
      return;
    }

    // ── Navigation active ─────────────────────────────────────────────────
    // While the driver has drifted (panned/zoomed away), don't fight them.
    // Auto-tracking resumes only when they tap Recenter.
    if (mapDriftedRef.current) return;

    if (currentLat == null || currentLng == null) return;

    const justStarted = !wasActive;

    if (justStarted) {
      // Nav start: zoom to street-level view and orient the map to the
      // driver's heading.  Use animateToRegion for zoom (iOS altitude-safe),
      // then animateCamera for heading separately.
      const snapDelta = speedToLatDelta(currentSpeed ?? 0);
      appliedDeltaRef.current = snapDelta;
      lastDeltaRef.current    = snapDelta;
      camLatRef.current       = currentLat;
      camLngRef.current       = currentLng;
      const initialHeading = (driverHeading != null && driverHeading >= 0) ? driverHeading : 0;
      camHeadingRef.current   = initialHeading;
      zoomBandTimestampRef.current = null;

      mapRef.current?.animateToRegion(
        { latitude: currentLat, longitude: currentLng, latitudeDelta: snapDelta, longitudeDelta: snapDelta },
        300
      );
      if (driverHeading != null && driverHeading >= 0) {
        setTimeout(() => {
          mapRef.current?.animateCamera({ heading: driverHeading }, { duration: 300 });
        }, 350);
      }
      return;
    }

    // ── Normal navigation follow ─────────────────────────────────────────
    // Stationary freeze: don't pan when the driver is parked and GPS position
    // hasn't moved meaningfully.  Still allow heading to drift slowly.
    const isStationary = (currentSpeed ?? 0) < STATIONARY_SPEED_KMH;
    if (isStationary && camLatRef.current != null && camLngRef.current != null) {
      const moved = haversine(camLatRef.current, camLngRef.current, currentLat, currentLng);
      if (moved < STATIONARY_MOVE_M) {
        // Parked: only softly update heading so we don't fight the user's view.
        if (driverHeading != null && driverHeading >= 0) {
          const smoothedHdg = smoothHeading(camHeadingRef.current, driverHeading, 0.10);
          if (Math.abs(smoothedHdg - (camHeadingRef.current ?? smoothedHdg)) > 1.5) {
            camHeadingRef.current = smoothedHdg;
            mapRef.current?.animateCamera({ heading: smoothedHdg }, { duration: 600 });
          }
        }
        return;
      }
    }
    camLatRef.current = currentLat;
    camLngRef.current = currentLng;

    // Low-pass filter the heading to avoid snap-rotations.
    let smoothedHdg: number | null = null;
    if (driverHeading != null && driverHeading >= 0) {
      smoothedHdg = smoothHeading(camHeadingRef.current, driverHeading, 0.25);
      camHeadingRef.current = smoothedHdg;
    }

    // Zoom hysteresis: only change zoom when the target band has been sustained
    // for ZOOM_SUSTAIN_MS.  When the band is stable, skip animateToRegion
    // entirely and use a single animateCamera({center, heading}) instead —
    // this prevents overlapping animations from stacking on every GPS fix.
    const targetDelta = speedToLatDelta(currentSpeed ?? 0);
    const now = Date.now();
    let zoomChanged = false;

    if (Math.abs(targetDelta - appliedDeltaRef.current) > 0.0005) {
      if (zoomBandTimestampRef.current == null) {
        zoomBandTimestampRef.current = now;
      } else if (now - zoomBandTimestampRef.current >= ZOOM_SUSTAIN_MS) {
        const smoothed = appliedDeltaRef.current + (targetDelta - appliedDeltaRef.current) * 0.3;
        appliedDeltaRef.current = smoothed;
        lastDeltaRef.current    = smoothed;
        zoomBandTimestampRef.current = null;
        zoomChanged = true;
      }
    } else {
      zoomBandTimestampRef.current = null;
    }

    if (zoomChanged) {
      // Zoom changed: use animateToRegion for the zoom (iOS altitude-safe),
      // then a trailing heading update to keep the two animations short and
      // non-overlapping.
      mapRef.current?.animateToRegion(
        { latitude: currentLat, longitude: currentLng, latitudeDelta: appliedDeltaRef.current, longitudeDelta: appliedDeltaRef.current },
        300
      );
      if (smoothedHdg != null) {
        setTimeout(() => {
          mapRef.current?.animateCamera({ heading: smoothedHdg! }, { duration: 200 });
        }, 150);
      }
    } else {
      // No zoom change: single animateCamera({center, heading}) — one animation
      // supersedes the previous one cleanly with no overlap.
      // We deliberately omit zoom/altitude here to avoid the iOS altitude-drift
      // bug that appears when animateCamera touches those fields on Apple Maps.
      const cameraUpdate: { center: { latitude: number; longitude: number }; heading?: number } = {
        center: { latitude: currentLat, longitude: currentLng },
      };
      if (smoothedHdg != null) cameraUpdate.heading = smoothedHdg;
      mapRef.current?.animateCamera(cameraUpdate, { duration: 300 });
    }
  }, [navigationActive, currentLat, currentLng, mapDrifted, driverHeading, currentSpeed]);

  // Detect when the driver manually pans/zooms the map while navigation is
  // active. That drift means their view has left the GPS position — surface
  // the Recenter button so they can snap back with a single tap.
  const handleRegionChangeComplete = useCallback(
    (_region: Region, details: { isGesture?: boolean }) => {
      if (!details?.isGesture) return;
      // Signal drift on any gesture — whether navigating or just browsing —
      // so the Recenter button surfaces and the GPS-follow effect pauses.
      if (!mapDriftedRef.current) {
        mapDriftedRef.current = true;
        onDriftChange?.(true);
      }
    },
    [onDriftChange],
  );

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

  // ── POI fetch — reload when the driver moves > 1 km from the last fetch ────
  const [fetchedPOIs, setFetchedPOIs] = useState<POI[]>([]);
  const lastPoiFetchRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (currentLat == null || currentLng == null) return;
    const last = lastPoiFetchRef.current;
    // Only re-fetch when the driver has moved > 1 km since the last call.
    if (last && haversine(last.lat, last.lng, currentLat, currentLng) < 1000) return;
    lastPoiFetchRef.current = { lat: currentLat, lng: currentLng };
    apiGet<{ pois: POI[] }>(
      `/pois?lat=${currentLat}&lng=${currentLng}&radius=${POI_RADIUS_M}`,
    )
      .then((data) => setFetchedPOIs(data.pois ?? []))
      .catch(() => {}); // silently ignore network errors — stale POIs remain
  }, [currentLat, currentLng]);

  const nearbyPOIs = fetchedPOIs.slice(0, 25);

  // Render all zones — no radius cap, no slice limit. The full dataset is
  // small enough (few hundred markers) that react-native-maps handles it fine,
  // and showing every camera/zone gives drivers the most complete picture.
  const visibleZones = allZones;

  // Only render reports that are actively visible to drivers.
  // Denied ("Gone now"), expired, flagged, and cleared reports must not appear
  // on the map — the server already excludes them from GET /reports, but
  // locally-cached reports keep their old status until the next poll cycle.
  // This filter mirrors the server's isActive() allow-list so the map stays
  // clean immediately after a "Gone now" vote, without waiting up to 60 s for
  // the next server refresh.
  const visibleReports = useMemo(
    () => communityReports.filter(
      (r) =>
        // Guard: skip any report with a null, undefined, or NaN coordinate —
        // a corrupt record would otherwise crash the Marker render.
        typeof r.lat === "number" && Number.isFinite(r.lat) &&
        typeof r.lng === "number" && Number.isFinite(r.lng) &&
        (
          !r.status ||
          r.status === "active" ||
          r.status === "confirmed" ||
          r.status === "admin_review" ||
          r.status === "pending_review"
        )
    ),
    [communityReports]
  );
  const clusters = useMemo(() => clusterReports(visibleReports), [visibleReports]);

  // Community report cluster markers always keep tracksViewChanges={true}.
  // The freeze optimisation (set to false after 1.5 s) caused tap hit-detection
  // to become unreliable: Google Maps calculates touch areas when the flag
  // flips, so resetting it on every communityReports change (syncs, votes)
  // created a cycle where markers lost their tap target after each poll.
  // The cost of keeping it true is negligible for ~30 emoji markers.

  // Fired on every user pan gesture — more reliable than relying on
  // details.isGesture in onRegionChangeComplete, which is unpopulated on some
  // react-native-maps versions and Android configurations.
  // Setting mapDriftedRef.current synchronously here prevents the GPS
  // camera-follow effect from firing animateCamera before the React state
  // update (onDriftChange → parent setState) has had a chance to propagate.
  //
  // Auto-resume timers have been intentionally removed: the map stays at
  // wherever the driver left it until they explicitly tap Recenter.  This
  // gives the driver full control and avoids the disorienting snap-back that
  // was happening mid-inspection.
  const handlePanDrag = useCallback(() => {
    if (!mapDriftedRef.current) {
      mapDriftedRef.current = true;    // synchronous guard — stops GPS follow instantly
      onDriftChange?.(true);
    }
  }, [onDriftChange]);

  const recenter = useCallback(() => {
    if (currentLat == null || currentLng == null) return;
    mapDriftedRef.current = false; // synchronous — next GPS tick resumes following
    // Reset the smoothing refs so the next GPS fix starts from the right
    // baseline rather than whatever stale values were active before the pan.
    const snapDelta = speedToLatDelta(currentSpeed ?? 0);
    appliedDeltaRef.current      = snapDelta;
    lastDeltaRef.current         = snapDelta;
    camLatRef.current            = currentLat;
    camLngRef.current            = currentLng;
    zoomBandTimestampRef.current = null;
    if (navActiveRef.current) {
      // During navigation: snap to speed-adaptive zoom and restore heading-up
      // (track-up mode) so the road ahead points up.
      mapRef.current?.animateToRegion(
        { latitude: currentLat, longitude: currentLng, latitudeDelta: snapDelta, longitudeDelta: snapDelta },
        500,
      );
      if (driverHeading != null && driverHeading >= 0) {
        const hdg = smoothHeading(null, driverHeading); // snap, not smooth
        camHeadingRef.current = hdg;
        setTimeout(() => {
          mapRef.current?.animateCamera({ heading: hdg }, { duration: 300 });
        }, 550);
      }
    } else {
      // Browsing: speed-adaptive zoom, stay north-up so the map is easy to read.
      mapRef.current?.animateToRegion(
        { latitude: currentLat, longitude: currentLng, latitudeDelta: snapDelta, longitudeDelta: snapDelta },
        500,
      );
    }
    onDriftChange?.(false);
  }, [currentLat, currentLng, currentSpeed, driverHeading, onDriftChange]);

  const focusCoords = useCallback((lat: number, lng: number) => {
    // Pan the map to the alert's location
    mapRef.current?.animateToRegion(
      { latitude: lat, longitude: lng, latitudeDelta: 0.008, longitudeDelta: 0.008 },
      700,
    );
    // Show a temporary highlight ring for 2.5 s
    if (focusHighlightTimerRef.current) clearTimeout(focusHighlightTimerRef.current);
    setFocusHighlight({ lat, lng });
    focusHighlightTimerRef.current = setTimeout(() => setFocusHighlight(null), 2500);
  }, []);

  useImperativeHandle(ref, () => ({ recenter, focusCoords }), [recenter, focusCoords]);

  return (
    <>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        // PROVIDER_GOOGLE explicitly on Android only — it gets Android onto
        // the same well-optimized Google Maps renderer/gesture pipeline that
        // iOS's Apple Maps equivalent enjoys, and unlocks
        // moveOnMarkerPress/toolbar tuning below. iOS has no Google Maps SDK
        // key configured, so it falls back to the platform default (Apple
        // Maps), same as the browse map screen.
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        // Night mode: apply the Google Maps dark style when the app is in dark
        // mode. PROVIDER_GOOGLE on Android supports customMapStyle; iOS (Apple
        // Maps) ignores the prop entirely so passing [] is safe on both.
        customMapStyle={isDark ? DARK_MAP_STYLE : []}
        initialRegion={
          currentLat != null && currentLng != null
            ? { latitude: currentLat, longitude: currentLng, latitudeDelta: 0.05, longitudeDelta: 0.05 }
            : NAIROBI
        }
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass
        showsTraffic={showTraffic}
        // Prevents the camera from re-centering/animating on marker tap —
        // that auto-pan fights the user's own drag gesture and is the main
        // source of "snap-back" jank when tapping a cluster mid-pan on Android.
        moveOnMarkerPress={false}
        toolbarEnabled={false}
        // Zoom and scroll are always enabled so the driver can pinch-zoom at any
        // time. The camera effects only update the center (pan) during
        // navigation — they deliberately leave the zoom level alone after the
        // initial zoom-in on nav start, so the driver's manual zoom is respected.
        onRegionChangeComplete={handleRegionChangeComplete}
        // onPanDrag fires reliably on every user drag gesture (unlike
        // onRegionChangeComplete's details.isGesture which is missing on older
        // react-native-maps builds). This is the primary drift-detection path.
        onPanDrag={handlePanDrag}
      >
        {/* Nearby-alert focus highlight — temporary ring shown after tapping
            a row in the Nearby Alerts sheet. Cleared after 2.5 s. */}
        {focusHighlight && (
          <>
            <Circle
              center={{ latitude: focusHighlight.lat, longitude: focusHighlight.lng }}
              radius={120}
              strokeColor="#FFD600CC"
              fillColor="#FFD60022"
              strokeWidth={3}
            />
            <Circle
              center={{ latitude: focusHighlight.lat, longitude: focusHighlight.lng }}
              radius={60}
              strokeColor="#FFD600AA"
              fillColor="#FFD60044"
              strokeWidth={2}
            />
          </>
        )}

        {/* Speed zone markers — road-stretch corridors show their limit as a
            badge at each end so you can see how the speed changes along the
            road, instead of a straight line cutting across the map. */}
        {visibleZones.map((z) => {
          if (z.lat == null || z.lng == null || isNaN(z.lat) || isNaN(z.lng)) return null;
          const bg = z.type === "camera" ? "#E53935" : z.type === "police" ? "#1565C0" : "#E65100";
          return (
            <React.Fragment key={z.id}>
              <Marker
                coordinate={{ latitude: z.lat, longitude: z.lng }}
                anchor={{ x: 0.5, y: 1 }}
                tracksViewChanges={!markersFrozen}
                onPress={() => setSelectedZone(z)}
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
          // Defensive: skip any cluster whose centroid ended up invalid
          // (visibleReports already filters member coords, but guard here too).
          if (
            !Number.isFinite(group.lat) ||
            !Number.isFinite(group.lng)
          ) return null;
          const clusterKey = group.members.map((m) => m.id).sort().join("-");
          return (
            <Marker
              key={clusterKey}
              coordinate={{ latitude: group.lat, longitude: group.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={true}
              onPress={() => openCluster(group)}
              zIndex={10}
            >
              <ClusterMarker group={group} now={now} />
            </Marker>
          );
        })}

        {/* Nearby POIs */}
        {nearbyPOIs.map((p) => {
          // Defensive: skip any POI whose coordinates are null, undefined, or NaN
          if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
          return (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lng }}
            anchor={{ x: 0.5, y: 1 }}
            title={p.name}
            description={p.address}
            tracksViewChanges={false}
          >
            <MarkerIcon
              matIcon={p.type === "fuel" ? "gas-station" : undefined}
              ioniconName={p.type === "fuel" ? undefined : "restaurant"}
              bg={p.type === "fuel" ? "#2E7D32" : "#BF360C"}
              size={28}
            />
          </Marker>
          );
        })}

        {/* Alternative routes — traffic-coloured (same bands as active route), selectable */}
        {altRoutes.map((r) => {
          // ── Crash guard ── filter out any coordinate where lat or lng is not a finite
          // number. Strict typeof check avoids isFinite(null)===true coercion trap.
          // The sanitized route object is used for BOTH display and selection so that
          // selectRoute() (and the subsequent activeRoute render paths) never receive
          // corrupt coordinates that would crash the native polyline layer.
          const safeCoords = (r.coords ?? []).filter(
            (c) =>
              c != null &&
              typeof c.latitude === "number" && Number.isFinite(c.latitude) &&
              typeof c.longitude === "number" && Number.isFinite(c.longitude),
          );
          if (safeCoords.length < 2) return null;
          const safeRoute = { ...r, coords: safeCoords };
          // Build traffic-coloured segments using the same helper as the active
          // route. startOffset=0 because speedIntervals index into the full
          // route coords array which starts at index 0 for every alt route.
          const segs = buildTrafficSegments(safeCoords, r.speedIntervals, 0);
          return (
            <React.Fragment key={r.id}>
              {segs.map((seg, i) => (
                <React.Fragment key={i}>
                  {/* Halo — slightly narrower than the active route (8 vs 10)
                      so alt routes stay visually subordinate */}
                  <Polyline
                    coordinates={seg.coords}
                    strokeColor={seg.halo}
                    strokeWidth={8}
                    lineCap="round"
                    lineJoin="round"
                    tappable
                    onPress={() => selectRoute(safeRoute)}
                  />
                  {/* Traffic-coloured inner stroke */}
                  <Polyline
                    coordinates={seg.coords}
                    strokeColor={seg.color}
                    strokeWidth={4}
                    lineCap="round"
                    lineJoin="round"
                    tappable
                    onPress={() => selectRoute(safeRoute)}
                  />
                </React.Fragment>
              ))}
            </React.Fragment>
          );
        })}

        {/* Divergence preview — pink "what's ahead" alternatives shown the moment
            the driver leaves the planned path, before the full reroute commits.
            Rendered above grey alts but below the primary blue route so the
            driver sees all options without losing the main corridor. */}
        {(() => {
          if (!divergenceRoutes.length) return null;

          // Drop routes with incomplete data before any math — a partial
          // response from the routing API (missing durationS, empty coords, or
          // any NaN coordinate) would cause Math.min to return NaN/Infinity and
          // Polyline to crash.
          const validRoutes = divergenceRoutes
            .map((r) => ({
              ...r,
              // ── Crash guard ── strip any coordinate where lat or lng is null/undefined/NaN ──
              // ── Crash guard ── strict typeof avoids isFinite(null)===true coercion trap ──
              coords: (r.coords ?? []).filter(
                (c) =>
                  c != null &&
                  typeof c.latitude === "number" && Number.isFinite(c.latitude) &&
                  typeof c.longitude === "number" && Number.isFinite(c.longitude),
              ),
            }))
            .filter(
              (r) =>
                r.coords.length >= 2 &&
                typeof r.durationS === "number" && isFinite(r.durationS) &&
                typeof r.distanceM === "number" && isFinite(r.distanceM),
            );
          if (!validRoutes.length) return null;

          // Identify the recommended divergence route — fastest time wins; ties
          // broken by shortest distance.  If both duration AND distance are
          // equal, neither route is labelled "Recommended" (they show identical
          // deltas, which is accurate and avoids a misleading label).
          const fastestDurationS = Math.min(...validRoutes.map((r) => r.durationS));
          const tiedRoutes = validRoutes.filter((r) => r.durationS === fastestDurationS);
          const shortestDistM = Math.min(...tiedRoutes.map((r) => r.distanceM));
          // Only a unique winner earns the label: if two routes still tie on
          // distance after the duration tiebreak, recommendedId stays null.
          const uniqueWinner = tiedRoutes.filter((r) => r.distanceM === shortestDistM);
          const recommendedId = uniqueWinner.length === 1 ? uniqueWinner[0].id : null;

          // Spread badge positions along the polyline so two badges don't
          // stack on top of each other when the routes share a long common
          // prefix before diverging.  With 2 routes we use 40 % and 60 %;
          // a single route uses the 50 % midpoint.
          const fractions =
            validRoutes.length === 1
              ? [0.5]
              : validRoutes.length === 2
              ? [0.38, 0.62]
              : validRoutes.map((_, i) => 0.3 + (i / (validRoutes.length - 1)) * 0.4);

          return validRoutes.map((r, idx) => {
            const isRecommended = recommendedId !== null && r.id === recommendedId;
            const innerColor = isRecommended ? "#FF2D78" : "#FF6FA0";
            const outerColor = isRecommended ? "#FF2D7855" : "#FF6FA033";

            // Delta vs. remaining travel time/distance on the original route.
            // During active navigation, durationRemainingS/distanceRemainingM
            // reflect how far is still to go from the driver's current position —
            // a much more accurate baseline than the full route total.
            // Falls back to the full-route totals when these are null (pre-navigation).
            const baseS = activeRoute
              ? (durationRemainingS ?? activeRoute.durationS)
              : null;
            const baseM = activeRoute
              ? (distanceRemainingM ?? activeRoute.distanceM)
              : null;
            const deltaS = baseS != null ? r.durationS - baseS : 0;
            const deltaM = baseM != null ? r.distanceM - baseM : 0;
            const label = activeRoute ? fmtDelta(deltaS, deltaM) : fmtDuration(r.durationS);

            const badgeCoord = midpointCoord(r.coords, fractions[idx]);

            return (
              <React.Fragment key={r.id}>
                {/* Wide glow layer — provides a generous tap target */}
                <Polyline
                  coordinates={r.coords}
                  strokeColor={outerColor}
                  strokeWidth={9}
                  lineCap="round"
                  lineJoin="round"
                  tappable
                  onPress={() => { selectRoute(r); void startNavigation(); }}
                />
                {/* Bright inner stroke — visually the pink line */}
                <Polyline
                  coordinates={r.coords}
                  strokeColor={innerColor}
                  strokeWidth={5}
                  lineCap="round"
                  lineJoin="round"
                  tappable
                  onPress={() => { selectRoute(r); void startNavigation(); }}
                />
                {/* Mid-route badge showing time & distance delta */}
                {r.coords.length >= 2 && badgeCoord != null && (
                  <Marker
                    coordinate={badgeCoord}
                    anchor={{ x: 0.5, y: 0.5 }}
                    tracksViewChanges={false}
                    zIndex={20}
                    onPress={() => { selectRoute(r); void startNavigation(); }}
                  >
                    <DivergenceBadge label={label} isRecommended={isRecommended} />
                  </Marker>
                )}
              </React.Fragment>
            );
          });
        })()}

        {/* Faster-route preview — teal/cyan polyline shown while the "Faster route"
            banner is visible so the driver can see exactly where the alternative
            diverges before deciding to switch.  Rendered above divergence routes
            but below the primary blue route so the active corridor remains clear. */}
        {navigationActive && fasterRoute && (() => {
          const coords = (fasterRoute.coords ?? []).filter(
            (c) =>
              c != null &&
              typeof c.latitude === "number" && Number.isFinite(c.latitude) &&
              typeof c.longitude === "number" && Number.isFinite(c.longitude),
          );
          if (coords.length < 2) return null;
          return (
            <React.Fragment key={`faster-${fasterRoute.id}`}>
              {/* Wide glow layer */}
              <Polyline
                coordinates={coords}
                strokeColor="#00BCD455"
                strokeWidth={9}
                lineCap="round"
                lineJoin="round"
              />
              {/* Bright teal inner stroke */}
              <Polyline
                coordinates={coords}
                strokeColor="#00BCD4"
                strokeWidth={5}
                lineCap="round"
                lineJoin="round"
              />
            </React.Fragment>
          );
        })()}

        {/* Active route — during navigation only show the section ahead of the driver.
            The passed section is hidden entirely so the driver sees a clean,
            uncluttered line from their current position to the destination. */}
        {activeRoute && (() => {
          if (navigationActive && currentLat != null && currentLng != null) {
            const coords = activeRoute.coords;
            // Guard: a route with fewer than 2 points cannot be rendered as a
            // polyline and would cause an out-of-bounds index below.
            if (!Array.isArray(coords) || coords.length < 2) return null;
            // Find the nearest polyline coordinate to the driver's GPS position.
            let bestIdx = 0;
            let bestDist = Infinity;
            for (let i = 0; i < coords.length; i++) {
              const d = haversine(currentLat, currentLng, coords[i].latitude, coords[i].longitude);
              if (d < bestDist) { bestDist = d; bestIdx = i; }
            }
            // Only render the remaining (ahead) portion — start from bestIdx so
            // the polyline begins right at the driver's current position.
            const remaining = coords.slice(bestIdx);
            if (remaining.length < 2) return null;
            // Build traffic-coloured segments. Pass bestIdx as the offset so
            // interval indices (which reference the full coords array) are
            // remapped correctly onto the `remaining` slice.
            const segs = buildTrafficSegments(remaining, activeRoute.speedIntervals, bestIdx);
            return (
              <>
                {segs.map((seg, i) => (
                  <React.Fragment key={i}>
                    <Polyline coordinates={seg.coords} strokeColor={seg.halo} strokeWidth={10} lineCap="round" lineJoin="round" />
                    <Polyline coordinates={seg.coords} strokeColor={seg.color} strokeWidth={6} lineCap="round" lineJoin="round" />
                  </React.Fragment>
                ))}
              </>
            );
          }
          // Pre-navigation (route selected but not yet started): show full route
          // with traffic colouring when available, falling back to solid blue.
          const segs = buildTrafficSegments(activeRoute.coords, activeRoute.speedIntervals);
          return (
            <>
              {segs.map((seg, i) => (
                <React.Fragment key={i}>
                  <Polyline coordinates={seg.coords} strokeColor={seg.halo} strokeWidth={10} lineCap="round" lineJoin="round" />
                  <Polyline coordinates={seg.coords} strokeColor={seg.color} strokeWidth={6} lineCap="round" lineJoin="round" />
                </React.Fragment>
              ))}
            </>
          );
        })()}

        {/* Destination pin */}
        {activeRoute && activeRoute.coords.length > 0 && (
          <Marker coordinate={activeRoute.coords[activeRoute.coords.length - 1]} anchor={{ x: 0.5, y: 1 }} title="Destination" tracksViewChanges={false}>
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
                  const ageStr = formatTimeAgo(r.timestamp, now);
                  // All reports get the interaction buttons — your own included.
                  // A driver may want to mark their own report "Gone now" if the
                  // situation resolved, or confirm it's "Still here" after circling back.
                  const canVote = true;
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
                        {r.roadName ? (
                          <Text style={ms.incidentRoad}>{r.roadName}</Text>
                        ) : null}
                        <Text style={ms.incidentMeta}>
                          {r.type === "camera" ? "Speed camera — permanent" : ageStr}
                          {r.type !== "camera" && !r.adminVerified && r.confirmCount != null && r.confirmCount > 1 ? `  ·  ${r.confirmCount > 99 ? "99+" : r.confirmCount} say still here` : ""}
                          {r.type !== "camera" && r.adminVerified ? "  ·  Admin verified" : ""}
                          {r.type !== "camera" && !r.adminVerified && r.denyCount != null && r.denyCount > 0 ? `  ·  ${r.denyCount > 99 ? "99+" : r.denyCount} say gone` : ""}
                          {r.type === "camera" && r.speedLimit ? `  ·  ${capSpeedLimit(r.speedLimit, vehicle)} km/h zone` : ""}
                        </Text>
                        {r.type === "camera" ? (
                          r.status === "admin_review" ? (
                            <View style={ms.pendingReviewBanner}>
                              <Text style={ms.pendingReviewTxt}>⏳ Removal pending admin review</Text>
                            </View>
                          ) : (
                            // Speed cameras are permanent infrastructure managed by admins.
                            // Drivers cannot vote them away — only flag for admin review.
                            <View style={ms.voteRow}>
                              <View style={[ms.cameraPermanentNote]}>
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
                          )
                        ) : canVote && (
                          // Non-camera incidents: drivers can vote Still here (extends 12 h
                          // TTL) or Gone now (records vote for admin; report stays on map
                          // until it expires naturally or admin removes it).
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
                            {r.status === "admin_review" ? (
                              <View style={ms.pendingReviewBanner}>
                                <Text style={ms.pendingReviewTxt}>⏳ Removal pending admin review</Text>
                              </View>
                            ) : (
                              <TouchableOpacity
                                style={[ms.voteBtn, { backgroundColor: "#D32F2F18", borderColor: "#D32F2F55" }, denyingId === r.id && ms.voteBtnDisabled]}
                                disabled={denyingId === r.id}
                                onPress={async () => {
                                  setDenyingId(r.id);
                                  const res = await denyReport(r.id);
                                  setDenyingId(null);
                                  if (res.ok) {
                                    // Close the sheet and show a thank-you.
                                    setSelectedCluster(null);
                                    Alert.alert("Thanks for the update", "Your report helps our team keep the map accurate.");
                                  } else if (res.message) {
                                    Alert.alert("Couldn't submit your vote", res.message);
                                  }
                                }}
                              >
                                <Ionicons name="thumbs-down-outline" size={13} color={denyingId === r.id ? "#9E9E9E" : "#D32F2F"} />
                                <Text style={[ms.voteTxt, { color: denyingId === r.id ? "#9E9E9E" : "#D32F2F" }]}>
                                  {denyingId === r.id ? "Sending…" : "Gone now"}
                                </Text>
                              </TouchableOpacity>
                            )}
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
                                // Close the cluster popup first — iOS cannot
                                // show two <Modal>s simultaneously, so the
                                // fix-pin modal would be invisible otherwise.
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

      {/* Admin location fixer — community reports */}
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

      {/* Admin location fixer — speed zones */}
      {adminZoneLocationTarget && (
        <AdminLocationPickerModal
          visible
          reportId={adminZoneLocationTarget.id}
          initialLat={adminZoneLocationTarget.lat}
          initialLng={adminZoneLocationTarget.lng}
          onClose={() => setAdminZoneLocationTarget(null)}
          onSave={async (lat, lng) => {
            await adminUpdateZoneLocation(adminZoneLocationTarget.id, lat, lng, adminZoneLocationTarget);
            setAdminZoneLocationTarget(null);
            setSelectedZone(null);
          }}
        />
      )}

      {/* Speed zone detail sheet */}
      {selectedZone && !adminZoneLocationTarget && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setSelectedZone(null)}>
          <TouchableOpacity style={ms.backdrop} activeOpacity={1} onPress={() => setSelectedZone(null)}>
            <TouchableOpacity activeOpacity={1} style={ms.sheet}>
              {/* Header */}
              <View style={ms.sheetHeader}>
                <View style={[ms.zoneIconWrap, {
                  backgroundColor: selectedZone.type === "camera" ? "#E5393518" : selectedZone.type === "police" ? "#1565C018" : "#E6510018",
                }]}>
                  <Ionicons
                    name={selectedZone.type === "camera" ? "camera" : selectedZone.type === "police" ? "person" : "speedometer"}
                    size={20}
                    color={selectedZone.type === "camera" ? "#E53935" : selectedZone.type === "police" ? "#1565C0" : "#E65100"}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={ms.zoneTitle}>{selectedZone.name}</Text>
                  <Text style={ms.zoneSub}>
                    {selectedZone.road}
                    {selectedZone.speedLimit ? `  ·  ${capSpeedLimit(selectedZone.speedLimit, vehicle)} km/h` : ""}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setSelectedZone(null)} style={ms.closeBtn}>
                  <Ionicons name="close" size={18} color="#757575" />
                </TouchableOpacity>
              </View>

              {/* User note */}
              <View style={ms.zoneManagedNote}>
                <Ionicons name="shield-checkmark-outline" size={13} color="#1565C0" />
                <Text style={ms.zoneManagedTxt}>
                  {selectedZone.type === "camera"
                    ? "Speed camera — permanent enforcement point"
                    : selectedZone.type === "police"
                    ? "Police checkpoint — reported by our team"
                    : "Speed zone — managed by our team"}
                </Text>
              </View>

              {/* Admin actions — available for all zones (both static and DB-managed) */}
              {isAdmin && (
                <View style={ms.adminActionRow}>
                  <TouchableOpacity
                    style={[ms.adminBtn, { backgroundColor: "#E3F2FD20", borderColor: "#1565C040" }]}
                    onPress={() => setAdminZoneLocationTarget(selectedZone)}
                  >
                    <Ionicons name="location" size={13} color="#1565C0" />
                    <Text style={[ms.adminBtnTxt, { color: "#1565C0" }]}>Fix Pin</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[ms.adminBtn, { backgroundColor: "#FFEBEE20", borderColor: "#B71C1C40" }]}
                    onPress={() =>
                      Alert.alert("Remove Zone", `Remove "${selectedZone.name}" from the map?`, [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Remove",
                          style: "destructive",
                          onPress: async () => {
                            await adminRemoveZone(selectedZone.id, selectedZone);
                            setSelectedZone(null);
                          },
                        },
                      ])
                    }
                  >
                    <Ionicons name="close-circle" size={13} color="#B71C1C" />
                    <Text style={[ms.adminBtnTxt, { color: "#B71C1C" }]}>Remove</Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}
    </>
  );
});

export default DriveMapView;

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

  // ── Confidence tier overlays (single-report markers) ───────────────────────
  reliableRing: {
    position: "absolute",
    top: -6, left: -6, right: -6, bottom: -6,
    borderRadius: 16,
    borderWidth: 2.5,
    opacity: 0.55,
  },
  confirmBadge: {
    position: "absolute",
    top: -6, right: -6,
    minWidth: 16, height: 16, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 3,
    borderWidth: 1.5, borderColor: "#FFF",
  },
  confirmBadgeTxt: { color: "#FFF", fontSize: 9, fontFamily: "Inter_700Bold" },

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
  voteRow: { flexDirection: "row", gap: 8, marginTop: 4, flexWrap: "wrap", alignItems: "center" },
  cameraPermanentNote: {
    flexDirection: "row", alignItems: "center", gap: 5,
    flex: 1,
  },
  cameraPermanentTxt: {
    fontSize: 11, fontWeight: "500", color: "#1565C0", flexShrink: 1,
  },
  voteBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1,
  },
  voteBtnDisabled: { opacity: 0.5 },
  voteTxt: { fontSize: 12, fontWeight: "600" },
  // ── Admin action row ────────────────────────────────────────────────────────
  adminActionRow: {
    flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center",
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#E0E0E0",
  },
  adminBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1,
  },
  adminBtnTxt: { fontSize: 11, fontWeight: "700" },
  pendingReviewBanner: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#FFF8E1", borderRadius: 10, borderWidth: 1, borderColor: "#FFD54F",
    paddingHorizontal: 10, paddingVertical: 7,
  },
  pendingReviewTxt: { fontSize: 12, fontWeight: "600", color: "#F57F17" },
  // Zone detail sheet
  sheetHeader: {
    flexDirection: "row", alignItems: "center", marginBottom: 4,
  },
  zoneIconWrap: {
    width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 10,
  },
  zoneTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#212121" },
  zoneSub: { fontSize: 12, color: "#757575", marginTop: 2 },
  zoneManagedNote: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 8, paddingHorizontal: 10,
    backgroundColor: "#E3F2FD18", borderRadius: 8,
    marginTop: 8,
  },
  zoneManagedTxt: { fontSize: 12, color: "#1565C0", flex: 1 },
  // ── Divergence route badges ─────────────────────────────────────────────────
  divBadgeWrap: {
    alignItems: "center",
  },
  divBadgeRec: {
    backgroundColor: "#FF2D78",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginBottom: 3,
  },
  divBadgeRecTxt: {
    fontSize: 10,
    fontWeight: "700",
    color: "#FFF",
    letterSpacing: 0.3,
  },
  divBadgePill: {
    backgroundColor: "rgba(30,30,30,0.82)",
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1.5,
    borderColor: "#FF6FA0",
  },
  divBadgePillRec: {
    borderColor: "#FF2D78",
  },
  divBadgeTxt: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFF",
    letterSpacing: 0.2,
  },
});
