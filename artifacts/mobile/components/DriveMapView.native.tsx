import React, { useEffect, useMemo, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { AdminLocationPickerModal } from "./AdminLocationPickerModal";
import AdminZoneEditSheet, { type ZoneEditFields } from "./AdminZoneEditSheet";
import AdminReportEditSheet from "./AdminReportEditSheet";
import AdminModerationQueue from "./AdminModerationQueue";

export type DriveMapViewHandle = {
  recenter: () => void;
  /** Pan the map to the given coordinates and briefly show a highlight ring. */
  focusCoords: (lat: number, lng: number) => void;
};
import { SCROLL_PROPS } from "@/lib/scrollProps";
import {
  Alert,
  Animated,
  Image,
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
import { useLiveLocation } from "@/context/LocationContext";
import type { CommunityReport, HereIncident, SpeedInterval } from "@/context/AppContext";
import type { SpeedZone } from "@/data/speedZones";
import { useColors } from "@/hooks/useColors";
import type { POI } from "@/data/pois";
import { apiGet } from "@/utils/apiClient";
import { INCIDENT_TYPES, INCIDENT_TYPE_ORDER, resolveIncidentType, resolveIncidentEmoji } from "@/constants/incidentTypes";
import { getVehicleTypeDef, capSpeedLimit } from "@/data/vehicleTypes";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";
import { formatTimeAgo } from "@/lib/timeAgo";
import { freshnessLabel, reportTier, freshnessChipColors } from "@/lib/freshnessLabel";
import { navBreadcrumb } from "@/utils/telemetry";

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


function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180, Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isSafeMapCoord(coord: unknown): coord is { latitude: number; longitude: number } {
  if (!coord || typeof coord !== "object") return false;
  const candidate = coord as { latitude?: unknown; longitude?: unknown };
  return (
    typeof candidate.latitude === "number" &&
    Number.isFinite(candidate.latitude) &&
    candidate.latitude >= -90 &&
    candidate.latitude <= 90 &&
    typeof candidate.longitude === "number" &&
    Number.isFinite(candidate.longitude) &&
    candidate.longitude >= -180 &&
    candidate.longitude <= 180
  );
}

function boundDisplayRouteCoords<T extends { latitude: number; longitude: number }>(
  coords: T[],
  maxCoords = 1200,
): T[] {
  if (coords.length <= maxCoords) return coords;
  const last = coords.length - 1;
  const stride = Math.ceil(last / (maxCoords - 1));
  const sampled: T[] = [];
  for (let i = 0; i < last; i += stride) sampled.push(coords[i]);
  sampled.push(coords[last]);
  return sampled;
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

function ClusterMarker({ group }: { group: ClusterGroup }) {
  const { members } = group;

  if (members.length === 1) {
    const r = members[0];
    // Admin-confirmed camera reports use the same red camera circle as static
    // speed-camera zone markers — they are permanent infrastructure, not transient incidents.
    if (r.type === "camera") {
      // Mobile cameras render green so drivers can distinguish them from
      // fixed (permanent) speed cameras at a glance.
      const camBg = r.cameraType === "mobile" ? "#00A845" : "#E53935";
      return (
        <View collapsable={false}>
          <MarkerIcon ioniconName="camera" bg={camBg} size={32} />
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
            // Mobile cameras use green bg + 📸 so the cluster grid matches the
            // single-marker treatment (green circle) at a glance.
            const cellBg = r.type === "camera" && r.cameraType === "mobile" ? "#00A845" : def.color;
            const emoji  = resolveIncidentEmoji(r.type, r.cameraType);
            return (
              <View key={r.id} style={[ms.clusterCell, { backgroundColor: cellBg }]}>
                <Text style={ms.clusterEmoji}>{emoji}</Text>
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
  if (!speedIntervals?.length || coords.length < 2) {
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
// Default alpha is 0.06 (slow) — see the three-band logic in the GPS effect.
function smoothHeading(current: number | null, target: number, alpha = 0.06): number {
  if (current == null) return target;
  let diff = target - current;
  if (diff >  180) diff -= 360;
  if (diff < -180) diff += 360;
  return (current + diff * alpha + 360) % 360;
}

// ─── Look-ahead camera offset ─────────────────────────────────────────────────
//
// Shift the map's center coordinate forward along the driver's heading so
// the driver icon appears in the lower portion of the screen and the majority
// of the visible map shows what is ahead.
//
// LOOK_AHEAD_K = 0.25 → driver sits ≈ 25 % from the bottom edge.
//   • Screen spans latitudeDelta D in total height.
//   • Centre is at 50 % from bottom.
//   • Moving centre forward by D×0.25 places the driver at 50 – 25 = 25 %.
//
// The offset is proportional to latitudeDelta so it stays visually consistent
// across all speed-adaptive zoom levels.  Falls back to the raw driver
// coordinate when heading is unknown (stationary / no GPS bearing yet).
const LOOK_AHEAD_K = 0.25;

function lookAheadCenter(
  lat: number,
  lng: number,
  heading: number | null,
  delta: number,
): { latitude: number; longitude: number } {
  if (heading == null) return { latitude: lat, longitude: lng };
  const hdgRad = (heading * Math.PI) / 180;
  return {
    latitude:  lat + delta * LOOK_AHEAD_K * Math.cos(hdgRad),
    longitude: lng + delta * LOOK_AHEAD_K * Math.sin(hdgRad),
  };
}

// ─── Post-turn look-ahead blend ───────────────────────────────────────────────
//
// Within LOOK_AHEAD_BLEND_START_M of the next maneuver, smoothly rotate the
// look-ahead *offset heading* from the low-pass GPS bearing toward the cached
// post-turn road bearing.  Only the center fed to lookAheadCenter changes;
// camHeadingRef and map rotation are untouched.

/** Distance threshold (metres) at which we start blending toward the post-turn bearing. */
const LOOK_AHEAD_BLEND_START_M = 100;

/** Initial compass bearing from (lat1,lng1) → (lat2,lng2), degrees 0–360. */
function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng  = ((lng2 - lng1) * Math.PI) / 180;
  const lat1R = (lat1 * Math.PI) / 180;
  const lat2R = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2R);
  const x =
    Math.cos(lat1R) * Math.sin(lat2R) -
    Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Wrap-safe linear interpolation between two compass angles. */
function lerpAngle(from: number, to: number, t: number): number {
  let diff = to - from;
  if (diff >  180) diff -= 360;
  if (diff < -180) diff += 360;
  return (from + diff * t + 360) % 360;
}

// ─── Main map component ───────────────────────────────────────────────────────

const DriveMapView = forwardRef(function DriveMapView(
  {
    mapDrifted = false,
    onDriftChange,
    tripMode = false,
  }: {
    /** True when the driver has panned/zoomed away from their GPS position.
     *  Auto-follow is suspended while drifted; recenter() clears it. */
    mapDrifted?: boolean;
    onDriftChange?: (drifted: boolean) => void;
    /** When true, the driver is in Live Trip mode. The polyline shows a
     *  green (covered) / blue (remaining) split; rerouting is suppressed. */
    tripMode?: boolean;
  },
  ref: React.ForwardedRef<DriveMapViewHandle>,
) {
  const { currentLat, currentLng, currentSpeed, driverHeading } = useLiveLocation();
  const {
    activeRoute, altRoutes, selectRoute,
    communityReports, showTraffic,
    confirmReport, denyReport, flagReport,
    vehicleType, allZones,
    pendingFocusCoords, setPendingFocusCoords,
    isAdmin, adminVerifyReport, adminDenyReport, adminUpdateReportLocation,
    adminUpdateZoneLocation, adminRemoveZone, adminVerifyZone,
    adminEditZone, adminEditReport, adminCreateZone,
    hereIncidents, dismissHereIncident,
    mapPickerActive,
  } = useApp();
  const vehicle = getVehicleTypeDef(vehicleType);
  const { isDark } = useColors();

  const mapRef = useRef<MapView>(null);
  const hasCenteredRef = useRef(false);
  const tripProjIdxRef = useRef(0); // windowed cursor for trip-mode polyline split
  const now = Date.now();

  // Tracks the last latitudeDelta applied to the map camera so recenter() can
  // reset the smoothing baseline after a manual pan.  Kept in sync with
  // appliedDeltaRef below; both refs serve slightly different callsites.
  const lastDeltaRef = useRef(0.015);

  // Mirror mapDrifted in a ref so the onRegionChangeComplete callback can read
  // the current value without recreating itself on every prop change.
  const mapDriftedRef = useRef(mapDrifted);
  useEffect(() => { mapDriftedRef.current = mapDrifted; }, [mapDrifted]);
  // Active drive uses non-animated heading updates. Keep this in a ref so
  // delayed preview animations cannot rotate the map after tripMode changes.
  const tripModeRef = useRef(tripMode);
  useEffect(() => { tripModeRef.current = tripMode; }, [tripMode]);

  // ── Camera-smoothing refs ─────────────────────────────────────────────────
  // These are camera-only; raw GPS values consumed by alerts/navigation are
  // untouched.

  // Low-pass filtered heading — avoids snap-rotations when GPS bearing jumps.
  // null = not yet initialised (use raw target on first fix).
  const camHeadingRef = useRef<number | null>(null);

  // Minimum heading change (degrees) that triggers a map rotation animation.
  // 5° sits just above typical GPS bearing noise (3–4° on a straight road at
  // speed) so the map rotates promptly on gentle curves without reacting to
  // sensor jitter.
  const HEADING_DEAD_BAND = 5;

  // The heading value most recently passed to any animateCamera({ heading })
  // call.  Compared against camHeadingRef to enforce the dead-band gate.
  const lastAnimatedHeadingRef = useRef<number | null>(null);

  // Timestamp of the last heading animation sent to Android Google Maps.
  // Used to rate-limit heading updates to once per ~800 ms so rapid GPS bearing
  // noise on straight roads cannot drive continuous micro-rotations.
  const lastHdgAnimTimeRef = useRef<number | null>(null);

  // iOS-only: interval ID for the dedicated heading channel.  On iOS, Apple
  // Maps (MapKit) crashes when `heading` is combined with `center` in a single
  // animateCamera call at 1 Hz+ (it runs a composite pan + compass-rotation
  // animation and crashes when forced to cancel that composite on every tick).
  // Fix: position and heading are completely separate animation channels.
  //  • Position channel — animateCamera({ center }) only, every GPS tick, safe.
  //  • Heading channel  — animateCamera({ heading }) only, every 1500 ms via
  //    setInterval, safe at any speed/cornering rate.
  // Google Maps (Android) handles combined updates gracefully, so Android keeps
  // the existing single-call animateCamera({ center, heading }) path.
  const headingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // ── Position-smoothing refs ───────────────────────────────────────────────
  // Raw GPS positions have ±5–15 m noise even at speed. Feeding them directly
  // into animateCamera makes the map micro-jitter on every tick. These refs
  // hold a low-pass smoothed copy used exclusively for camera animations.
  const camSmoothLatRef  = useRef<number | null>(null);
  const camSmoothLngRef  = useRef<number | null>(null);
  // Last smoothed coordinate actually sent to animateCamera — the minimum-
  // movement gate compares against this to suppress sub-threshold ticks.
  const lastPosCamLatRef = useRef<number | null>(null);
  const lastPosCamLngRef = useRef<number | null>(null);

  // Post-navigation route-fit timer — stored so unmount can cancel it and a
  // late-firing callback never touches a dead map ref.
  const postNavFitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Trailing heading-animation timer (nav start / zoom change / recenter all
  // schedule a delayed animateCamera) — tracked so unmount cancels it and a
  // late callback never reaches a dead native map view.
  const headingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while this component is mounted — every deferred mapRef call must
  // check it, since clearTimeout alone doesn't cover already-dequeued callbacks.
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
    if (postNavFitTimerRef.current) clearTimeout(postNavFitTimerRef.current);
    if (headingTimerRef.current)    clearTimeout(headingTimerRef.current);
    if (headingIntervalRef.current) clearInterval(headingIntervalRef.current);
  }, []);

  // ── Heading-only interval — both iOS and Android ─────────────────────────
  //
  // Heading is sent to the map exclusively through this interval. During an
  // active drive it uses setCamera() with no interpolation, keeping the road
  // ahead at the top without letting the native renderer spin the long way
  // around 0°/360°. Route preview may still use a short smooth animation.
  //
  // Why separate?
  //   iOS   — MapKit crashes on combined pan+rotation at > 1 Hz.
  //   Android — Google Maps can choose the long interpolation path when a
  //             heading animation crosses 0°/360°, causing an upside-down
  //             rotation. Active drive therefore applies heading directly.
  //
  // Timing:
  //   iOS     — 700 ms animation / 800 ms interval (animation always ends
  //              before the next fires; ~100 ms dead-time).
  //   Android — 500 ms animation / 650 ms interval  (faster for Google Maps'
  //              smoother compositor, keeps heading visually snappy).
  //
  // The interval self-gates via mapDriftedRef (suspended while drifted) and
  // camHeadingRef (no-ops until a smoothed heading is available).
  useEffect(() => {
    if (tripMode) {
      if (headingTimerRef.current) {
        clearTimeout(headingTimerRef.current);
        headingTimerRef.current = null;
      }
      // Cancel any preview animation and immediately align the map with the
      // driver. setCamera avoids the long-way rotation bug in animateCamera.
      const initialHeading = camHeadingRef.current;
      if (initialHeading != null) {
        mapRef.current?.setCamera({ heading: initialHeading });
        lastAnimatedHeadingRef.current = initialHeading;
      }
    }

    const isIOS      = Platform.OS === "ios";
    const animMs     = isIOS ? 700  : 500;
    const intervalMs = isIOS ? 800  : 650;

    headingIntervalRef.current = setInterval(() => {
      if (!mountedRef.current || mapDriftedRef.current) return;
      const hdg = camHeadingRef.current;
      if (hdg == null) return;
      // Only rotate when the heading has moved past the dead-band.  GPS bearing
      // on a straight road fluctuates ≤ 3–4° — the 5° gate absorbs all of it
      // while still responding to gentle curves promptly.
      const prev  = lastAnimatedHeadingRef.current;
      const delta = prev == null
        ? 360
        : Math.abs(((hdg - prev) + 540) % 360 - 180);
      if (delta < 5) return;
      lastAnimatedHeadingRef.current = hdg;
      if (tripModeRef.current) {
        // No tween during active drive: a direct, wrap-safe camera update keeps
        // the road ahead upright and cannot rotate through the long arc.
        mapRef.current?.setCamera({ heading: hdg });
      } else {
        mapRef.current?.animateCamera({ heading: hdg }, { duration: animMs });
      }
    }, intervalMs);

    return () => {
      if (headingIntervalRef.current) {
        clearInterval(headingIntervalRef.current);
        headingIntervalRef.current = null;
      }
    };
  }, [tripMode]); // active drive uses direct heading; preview may animate
  /** Schedule a delayed heading animation, replacing any pending one and
   *  guarding against unmount races. */
  const scheduleHeadingAnim = useCallback((heading: number, delayMs: number, durationMs: number) => {
    if (headingTimerRef.current) clearTimeout(headingTimerRef.current);
    headingTimerRef.current = setTimeout(() => {
      headingTimerRef.current = null;
      if (!mountedRef.current || tripModeRef.current) return;
      mapRef.current?.animateCamera({ heading }, { duration: durationMs });
    }, delayMs);
  }, []);
  const [selectedCluster, setSelectedCluster] = useState<ClusterGroup | null>(null);
  const [selectedHereIncident, setSelectedHereIncident] = useState<HereIncident | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [flaggingId, setFlaggingId] = useState<string | null>(null);
  const [adminLocationTarget, setAdminLocationTarget] = useState<CommunityReport | null>(null);
  const [selectedZone, setSelectedZone] = useState<SpeedZone | null>(null);
  const [adminZoneLocationTarget, setAdminZoneLocationTarget] = useState<SpeedZone | null>(null);
  const [editingZone, setEditingZone] = useState<SpeedZone | null>(null);
  const [editingReport, setEditingReport] = useState<CommunityReport | null>(null);
  const [createZoneCoords, setCreateZoneCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [showModerationQueue, setShowModerationQueue] = useState(false);

  // Android + PROVIDER_GOOGLE: custom marker views must go through at least one
  // full render cycle with tracksViewChanges=true before the native layer
  // captures their bitmap. Setting false immediately causes the marker to appear
  // as a blank dot. We start true, then freeze after 1.5 s — long enough for
  // all static zone icons to paint but short enough to avoid sustained jank.
  const [markersFrozen, setMarkersFrozen] = useState(false);
  const [clusterMarkersFrozen, setClusterMarkersFrozen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      if (!mountedRef.current) return;
      navBreadcrumb("map.render", "markers frozen (tracksViewChanges=false)");
      setMarkersFrozen(true);
    }, 500);
    return () => clearTimeout(t);
  }, []);

  // ── Map-picker freeze snapshot ────────────────────────────────────────────
  //
  // When mapPickerActive becomes true, we capture a still frame of the live
  // MapView *before* unmounting it, then display that image while the picker
  // modal is open.  This replaces the jarring black rectangle that appeared
  // previously and makes the transition feel polished.
  //
  // Two-phase approach to avoid the effect-after-render timing problem:
  //  1. pickerFreezeUri  — file URI of the last captured snapshot (null = none)
  //  2. mapHidden        — controls the actual MapView unmount; only becomes
  //                        true after the snapshot resolves (or on failure)
  //
  // While mapPickerActive=true but mapHidden=false (snapshot in progress, < 100 ms
  // typical), both this MapView and the picker's MapView are briefly alive.
  // This window is so short it's invisible and ends before the slide-in
  // animation completes, so there is no perceivable two-MapView contention.
  const [pickerFreezeUri, setPickerFreezeUri] = useState<string | null>(null);
  const [mapHidden, setMapHidden] = useState(false);

  useEffect(() => {
    if (mapPickerActive) {
      // Capture snapshot while this MapView is still mounted, then hide it.
      const snap = mapRef.current?.takeSnapshot?.({
        format: "png",
        quality: 0.85,
        result: "file",
      });
      if (snap) {
        snap
          .then((uri: string) => {
            if (!mountedRef.current) return;
            setPickerFreezeUri(uri);
            setMapHidden(true);
          })
          .catch(() => {
            // Snapshot failed — fall back to hiding immediately (black frame
            // is still better than a native crash from two concurrent maps).
            if (!mountedRef.current) return;
            setPickerFreezeUri(null);
            setMapHidden(true);
          });
      } else {
        // takeSnapshot not available (unlikely) — hide immediately.
        setMapHidden(true);
      }
    } else {
      // Picker closed — restore live map and discard the frozen image.
      setMapHidden(false);
      setPickerFreezeUri(null);
    }
  }, [mapPickerActive]);

  // ── Focus pulse animation — animated expanding rings shown after:
  //    (a) tapping a Nearby Alert row in the alerts sheet (focusCoords() call)
  //    (b) tapping a push notification that carries lat/lng (pendingFocusCoords)
  // Uses the same Animated.Value / Marker pattern as MapViewScreen so rings
  // stay anchored to the map coordinate instead of floating over the screen.
  const [focusHighlight, setFocusHighlight] = useState<{ lat: number; lng: number } | null>(null);
  const focusHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dmPulseRing1    = useRef(new Animated.Value(0)).current;
  const dmPulseRing2    = useRef(new Animated.Value(0)).current;
  const dmPulseRing3    = useRef(new Animated.Value(0)).current;
  const dmPulseAnimRef  = useRef<Animated.CompositeAnimation | null>(null);

  /** Start the sonar-wave animation at (lat, lng) and clear it after `durationMs`. */
  const triggerFocusPulse = useCallback((lat: number, lng: number, durationMs = 5000) => {
    if (focusHighlightTimerRef.current) clearTimeout(focusHighlightTimerRef.current);
    setFocusHighlight({ lat, lng });
    // Stop any running animation and reset ring values
    dmPulseAnimRef.current?.stop();
    [dmPulseRing1, dmPulseRing2, dmPulseRing3].forEach((v) => v.setValue(0));
    const makeRing = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 1400, useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 0,    useNativeDriver: true }),
        ]),
      );
    const anim = Animated.parallel([
      makeRing(dmPulseRing1, 0),
      makeRing(dmPulseRing2, 467),
      makeRing(dmPulseRing3, 933),
    ]);
    dmPulseAnimRef.current = anim;
    anim.start();
    focusHighlightTimerRef.current = setTimeout(() => {
      dmPulseAnimRef.current?.stop();
      setFocusHighlight(null);
    }, durationMs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dmPulseRing1, dmPulseRing2, dmPulseRing3]);

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
      setSelectedCluster(null);
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
    if (hasCenteredRef.current || currentLat == null || currentLng == null) return;
    hasCenteredRef.current = true;
    const t = setTimeout(() => {
      mapRef.current?.animateToRegion(
        { latitude: currentLat, longitude: currentLng, latitudeDelta: 0.05, longitudeDelta: 0.05 },
        900
      );
    }, 300);
    return () => clearTimeout(t);
  }, [currentLat, currentLng]);

  // Route preview fit: when a route is set, fit the map to show the full polyline.
  useEffect(() => {
    if (!activeRoute?.coords || !activeRoute.coords.every(isSafeMapCoord)) return;
    const coords = boundDisplayRouteCoords(activeRoute.coords);
    if (coords.length < 2) return;
    const t = setTimeout(() => {
      if (!mountedRef.current) return;
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 80, right: 30, bottom: 230, left: 30 },
        animated: true,
      });
    }, 350);
    return () => clearTimeout(t);
  }, [activeRoute?.id]);

  // How long a new zoom band must be sustained before the camera animates to it.
  // This prevents the zoom from pulsing on every noisy per-fix speed reading.
  const ZOOM_SUSTAIN_MS = 5_000;

  // Positional threshold below which we consider the driver stationary and
  // suppress camera panning entirely to avoid GPS-noise shake while parked.
  const STATIONARY_SPEED_KMH = 3.0;   // m/s × 3.6 — below this, apply freeze
  const STATIONARY_MOVE_M    = 5;     // metres — ignore smaller position jitter

  // ── GPS camera follow ─────────────────────────────────────────────────────
  //
  // Keeps the driver centred on screen in a stable heading-up orientation.
  // Active drive applies the smoothed heading directly (without a rotation
  // animation) and shifts the centre forward so the road ahead fills the map.
  // Pauses while the driver manually pans/zooms (drift flag); resumes on Recenter.
  //
  // Stability design:
  //
  //  1. Stationary freeze — speed < 3 km/h AND position < 5 m: skip the entire
  //     update.  GPS bearing at near-zero speed is random noise; updating
  //     camHeadingRef from it would make the map spin while parked.
  //
  //  2. Three-band alpha — smoothing rate adapts to how much the raw bearing
  //     actually changed, not just a single fixed alpha:
  //       raw Δ < 20°  → α = 0.06  straight road; aggressively filters GPS jitter
  //       raw Δ 20–60° → α = 0.18  gradual curve / lane change
  //       raw Δ > 60°  → α = 0.50  sharp turn / intersection — respond promptly
  //
  //  3. Dead-band gate — only schedule a heading animation when the smoothed
  //     heading has moved ≥ HEADING_DEAD_BAND (7°) from the last animated value.
  //     Typical GPS bearing noise is ≤ 5° so the gate absorbs all of it.
  //
  //  4. Android rate limit — even past the dead-band, heading animations are
  //     capped to one per 800 ms on straight roads (< 30° change) to prevent
  //     every 1 Hz GPS tick from issuing a rotation animation.
  //
  //  5. iOS separation — heading is sent exclusively through the 1500 ms interval
  //     above; the position channel never carries heading on iOS (MapKit crashes
  //     on combined pan+rotation at > 1 Hz).
  useEffect(() => {
    if (
      mapDriftedRef.current  ||
      currentLat == null     ||
      currentLng == null     ||
      !hasCenteredRef.current
    ) return;

    // ── 1. Stationary freeze ─────────────────────────────────────────────────
    const isStationary = (currentSpeed ?? 0) < STATIONARY_SPEED_KMH;
    if (isStationary && camLatRef.current != null && camLngRef.current != null) {
      const moved = haversine(camLatRef.current, camLngRef.current, currentLat, currentLng);
      if (moved < STATIONARY_MOVE_M) return; // parked — touch nothing
    }

    camLatRef.current = currentLat;
    camLngRef.current = currentLng;

    // ── 2. Heading smoothing (only while moving) ─────────────────────────────
    // Helper: wrap-safe signed angular difference a→b.
    const wrapDiff = (a: number, b: number) => {
      let d = b - a; if (d > 180) d -= 360; if (d < -180) d += 360; return d;
    };

    if (!isStationary && driverHeading != null && driverHeading >= 0) {
      const rawDiff = camHeadingRef.current != null
        ? Math.abs(wrapDiff(camHeadingRef.current, driverHeading))
        : 180; // first fix — initialise directly
      // Three-band alpha: aggressively filters noise on straight roads while
      // converging quickly after turns.  Higher minimums than before so the
      // camera reaches the correct post-turn heading in 2–3 s rather than 10+ s.
      //   < 20°  straight road / gentle bend  → 0.10 (was 0.06)
      //   20–60° gradual curve / lane change  → 0.30 (was 0.18)
      //   > 60°  sharp turn / intersection    → 0.65 (was 0.50)
      const alpha = rawDiff > 60 ? 0.65 : rawDiff > 20 ? 0.30 : 0.10;
      camHeadingRef.current = smoothHeading(camHeadingRef.current, driverHeading, alpha);
    }

    // ── 2b. Position smoothing ───────────────────────────────────────────────
    // Apply a low-pass filter to the raw GPS position before it reaches the
    // map camera. GPS readings have ±5–15 m of noise even at speed; without
    // smoothing every tick causes a tiny snap that accumulates into visible
    // shaking. Alpha adapts to vehicle speed so the camera responds quickly
    // on highways but rejects more noise in slow city traffic.
    const speedKmh = currentSpeed ?? 0;
    // Higher alpha → less lag, more GPS noise passes through.
    // The 8 m minimum-movement gate below absorbs the extra noise so we can
    // safely reduce lag without introducing per-tick jitter.
    //   > 80 km/h  highway  → 0.75 (was 0.65) — smooth fast cruising
    //   > 40 km/h  suburban → 0.55 (was 0.45) — responsive city driving
    //   ≤ 40 km/h  slow     → 0.40 (was 0.28) — cuts the 20 m position lag in city traffic
    const posAlpha = speedKmh > 80 ? 0.75 : speedKmh > 40 ? 0.55 : 0.40;
    if (camSmoothLatRef.current == null) {
      camSmoothLatRef.current = currentLat;
      camSmoothLngRef.current = currentLng;
    } else {
      camSmoothLatRef.current += posAlpha * (currentLat - camSmoothLatRef.current);
      camSmoothLngRef.current = (camSmoothLngRef.current ?? currentLng) + posAlpha * (currentLng - (camSmoothLngRef.current ?? currentLng));
    }
    const sLat = camSmoothLatRef.current;
    const sLng = camSmoothLngRef.current ?? currentLng;

    // ── Zoom hysteresis (unchanged logic, kept here for locality) ───────────
    const targetDelta = speedToLatDelta(currentSpeed ?? 0);
    const nowMs = Date.now();
    if (Math.abs(targetDelta - appliedDeltaRef.current) > 0.0005) {
      if (zoomBandTimestampRef.current == null) {
        zoomBandTimestampRef.current = nowMs;
      } else if (nowMs - zoomBandTimestampRef.current >= ZOOM_SUSTAIN_MS) {
        const smoothed = appliedDeltaRef.current + (targetDelta - appliedDeltaRef.current) * 0.3;
        appliedDeltaRef.current = smoothed;
        lastDeltaRef.current    = smoothed;
        zoomBandTimestampRef.current = null;
        const laCenter = lookAheadCenter(sLat, sLng, camHeadingRef.current, smoothed);
        lastPosCamLatRef.current = sLat;
        lastPosCamLngRef.current = sLng;
        mapRef.current?.animateToRegion(
          { latitude: laCenter.latitude, longitude: laCenter.longitude, latitudeDelta: smoothed, longitudeDelta: smoothed },
          500,
        );
        if (!tripMode && Platform.OS !== "ios" && camHeadingRef.current != null) {
          scheduleHeadingAnim(camHeadingRef.current, 150, 200);
        }
        return;
      }
    } else {
      zoomBandTimestampRef.current = null;
    }

    // ── 3. Minimum-movement gate ─────────────────────────────────────────────
    // Only issue a camera animation if the smoothed position has moved at
    // least 8 m from the position of the last animation. Sub-threshold
    // deltas are GPS jitter — animating them makes the map shake on straight
    // roads while visually adding nothing. 8 m (reduced from 10 m) gives a
    // better balance: still absorbs GPS noise (~5–6 m) but keeps up with slow
    // city driving (~8–14 km/h). When zoom changes above, we update
    // lastPosCamLatRef there and return; this gate handles the position-only path.
    if (lastPosCamLatRef.current != null) {
      const moved = haversine(lastPosCamLatRef.current, lastPosCamLngRef.current!, sLat, sLng);
      if (moved < 8) return;
    }
    lastPosCamLatRef.current = sLat;
    lastPosCamLngRef.current = sLng;

    // ── Camera animation ─────────────────────────────────────────────────────
    const laCenter = lookAheadCenter(
      sLat, sLng, camHeadingRef.current, appliedDeltaRef.current,
    );

    // Centre-only — heading is sent exclusively through the platform interval
    // above (both iOS and Android).  Combining heading with centre in a single
    // animateCamera call caused the upside-down rotation bug on Android: Google
    // Maps would occasionally animate the heading the long way round (e.g.
    // 330° instead of 30° when crossing north), visually spinning the map.
    // Separating the channels eliminates that race entirely.
    const driveCameraUpdate = { center: laCenter };

    // 350 ms — well inside the ~650–800 ms interval so each position animation
    // completes before the next fires.  Shorter duration also gives the touch
    // gesture recogniser room to breathe; the previous 700 ms left only 300 ms
    // of free time between animations which caused apparent "freezing" on slow
    // GPS devices.
    mapRef.current?.animateCamera(driveCameraUpdate, { duration: 350 });
  }, [currentLat, currentLng, mapDrifted, driverHeading, currentSpeed, tripMode]);

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

  // Deep-link focus: center map on a push-notification incident then clear.
  // Also triggers the sonar-wave pulse so the driver can see exactly which
  // pin the notification was about.
  useEffect(() => {
    if (!pendingFocusCoords) return;
    const { lat, lng } = pendingFocusCoords;
    mapRef.current?.animateToRegion(
      { latitude: lat, longitude: lng, latitudeDelta: 0.008, longitudeDelta: 0.008 },
      700
    );
    triggerFocusPulse(lat, lng, 6000); // 6 s — extra long for cold-start arrival
    setPendingFocusCoords(null);
  // triggerFocusPulse is stable (useCallback with stable deps) — safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
        r.source !== "auto" &&
        !r.roadName?.startsWith("Auto-detected:") &&
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
  const clusterVisualKey = useMemo(
    () => visibleReports
      .map((r) => `${r.id}:${r.type}:${r.status ?? ""}:${r.confirmCount ?? 0}:${r.adminVerified ? 1 : 0}:${r.cameraType ?? ""}`)
      .sort()
      .join("|"),
    [visibleReports],
  );
  useEffect(() => {
    setClusterMarkersFrozen(false);
    const timer = setTimeout(() => {
      if (mountedRef.current) setClusterMarkersFrozen(true);
    }, 500);
    return () => clearTimeout(timer);
  }, [clusterVisualKey]);

  // HERE Live Traffic — filter to valid coordinates only; dismissed ones are
  // already excluded by AppContext before reaching here.
  const visibleHereIncidents = useMemo(
    () => hereIncidents.filter(
      (inc) => typeof inc.lat === "number" && Number.isFinite(inc.lat) &&
               typeof inc.lng === "number" && Number.isFinite(inc.lng)
    ),
    [hereIncidents]
  );

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
    navBreadcrumb("map.camera", "recenter tapped");
    mapDriftedRef.current = false; // synchronous — next GPS tick resumes following
    // Reset position-smoothing state so the camera snaps to the current GPS
    // position immediately on recenter instead of gliding from a stale
    // smoothed value (which could be several metres behind the car).
    camSmoothLatRef.current  = currentLat;
    camSmoothLngRef.current  = currentLng;
    lastPosCamLatRef.current = null; // force next GPS tick to animate unconditionally
    lastPosCamLngRef.current = null;
    const snapDelta = speedToLatDelta(currentSpeed ?? 0);
    appliedDeltaRef.current      = snapDelta;
    lastDeltaRef.current         = snapDelta;
    camLatRef.current            = currentLat;
    camLngRef.current            = currentLng;
    zoomBandTimestampRef.current = null;
    const hdg = (driverHeading != null && driverHeading >= 0)
      ? smoothHeading(null, driverHeading)
      : (camHeadingRef.current ?? 0);
    camHeadingRef.current = hdg;
    lastAnimatedHeadingRef.current = null;
    const laCenter = lookAheadCenter(currentLat, currentLng, hdg, snapDelta);
    mapRef.current?.animateToRegion(
      { latitude: laCenter.latitude, longitude: laCenter.longitude, latitudeDelta: snapDelta, longitudeDelta: snapDelta },
      500,
    );
    if (!tripMode) {
      scheduleHeadingAnim(hdg, 550, 300);
    }
    onDriftChange?.(false);
  }, [currentLat, currentLng, currentSpeed, driverHeading, onDriftChange, scheduleHeadingAnim, tripMode]);

  const focusCoords = useCallback((lat: number, lng: number) => {
    // Pan the map to the alert's location, then sonar-pulse the pin for 5 s.
    mapRef.current?.animateToRegion(
      { latitude: lat, longitude: lng, latitudeDelta: 0.008, longitudeDelta: 0.008 },
      700,
    );
    triggerFocusPulse(lat, lng, 5000);
  }, [triggerFocusPulse]);

  useImperativeHandle(ref, () => ({ recenter, focusCoords }), [recenter, focusCoords]);

  // ── Memoized polyline geometry ──────────────────────────────────────────────
  // Every GPS fix re-renders this component (currentLat/currentLng are state).
  // Rebuilding polyline coordinate arrays on each tick hands react-native-maps
  // a brand-new native geometry object per second — a prime suspect for the
  // in-navigation native crashes. All route geometry below is memoized on
  // route identity so the native Polyline props stay referentially stable
  // across GPS ticks.

  // Alternative routes: sanitized coords + traffic segments, rebuilt only when
  // the altRoutes array itself changes.
  const altRouteSegs = useMemo(
    () =>
      altRoutes
        .map((r) => {
          // ── Crash guard ── strict typeof check avoids isFinite(null)===true.
          const safeCoords = (r.coords ?? []).filter(
            (c) =>
              c != null &&
              typeof c.latitude === "number" && Number.isFinite(c.latitude) &&
              typeof c.longitude === "number" && Number.isFinite(c.longitude),
          );
          if (safeCoords.length < 2) return null;
          return {
            route: { ...r, coords: safeCoords },
            segs: buildTrafficSegments(safeCoords, r.speedIntervals, 0),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null),
    [altRoutes],
  );

  // Keep unsafe coordinates out of both JavaScript projection work and the
  // native map bridge. Route fetching already rejects malformed geometry, but
  // this second boundary also protects restored/cached state and future callers.
  const safeActiveRouteCoords = useMemo(
    () => {
      const coords = activeRoute?.coords ?? [];
      return coords.every(isSafeMapCoord) ? coords : [];
    },
    [activeRoute],
  );

  // Long routes can contain several thousand points. Re-slicing and sending
  // that full geometry through react-native-maps every few seconds creates
  // sustained native allocation pressure. Keep full geometry for projection,
  // but cap display geometry while preserving both endpoints.
  const renderedActiveRouteCoords = useMemo(() => {
    const MAX_RENDER_COORDS = 1200;
    return boundDisplayRouteCoords(safeActiveRouteCoords, MAX_RENDER_COORDS);
  }, [safeActiveRouteCoords]);

  // Active-route "ahead" slice. The nearest-coordinate index still tracks the
  // driver, but it is quantized to steps of AHEAD_IDX_STEP so the memo below
  // only rebuilds the native polyline every ~4 passed coordinates instead of
  // on every single GPS tick. (Showing up to 3 already-passed points is
  // visually imperceptible; the line still starts at the driver's marker.)
  const AHEAD_IDX_STEP = 4;

  // Local cursor ref — tracks the last matched polyline index so the windowed
  // search below only scans ±40 coords instead of the entire route on every
  // GPS tick.  Stored as a ref (not state) so updating it never triggers a
  // render.  Reset to 0 whenever the active route changes (new route ID).
  const navProjIdxRef    = useRef(0);
  const lastRouteIdRef   = useRef<string | null>(null);

  // Windowed nearest-coord search — O(40) instead of O(N) on every GPS tick.
  // The full O(N) scan is used only on route start / reroute (once per route).
  const navAheadStartIdx = useMemo(() => {
    if (!activeRoute || currentLat == null || currentLng == null) {
      navProjIdxRef.current  = 0;
      lastRouteIdRef.current = null;
      return 0;
    }
    const coords = safeActiveRouteCoords;
    if (!Array.isArray(coords) || coords.length < 2) return 0;

    // Route changed — reset cursor and do a full scan once.
    const routeChanged = activeRoute.id !== lastRouteIdRef.current;
    if (routeChanged) {
      lastRouteIdRef.current = activeRoute.id;
      navProjIdxRef.current  = 0;
    }

    const WINDOW = 40;
    const prior  = navProjIdxRef.current;
    // Backward reach expanded to 40 (was 5) so a U-turn — where the driver is
    // heading back toward lower-index coords — doesn't leave the cursor stuck
    // at `prior` because all backward coords fall outside the window.
    const wStart = Math.max(0, prior - 40);
    const wEnd   = Math.min(coords.length - 1, prior + WINDOW);

    let bestIdx  = prior;
    let bestDist = Infinity;
    for (let i = wStart; i <= wEnd; i++) {
      const d = haversine(currentLat, currentLng, coords[i].latitude, coords[i].longitude);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }

    // Widen to a full scan if the windowed result is poor — covers nav start,
    // reroute, and any GPS teleport (e.g. tunnel exit far from last known pos).
    if (bestDist > 200) {
      bestIdx  = 0;
      bestDist = Infinity;
      for (let i = 0; i < coords.length; i++) {
        const d = haversine(currentLat, currentLng, coords[i].latitude, coords[i].longitude);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
    }

    navProjIdxRef.current = bestIdx;
    return bestIdx - (bestIdx % AHEAD_IDX_STEP);
  }, [activeRoute, safeActiveRouteCoords, currentLat, currentLng]);

  // Trip-mode polyline split — find the nearest coord index to the driver's
  // current position so we can render green (covered) and blue (remaining)
  // sections. Windowed search identical to navAheadStartIdx pattern.
  const TRIP_STEP = 3;
  const tripSplitIdx = useMemo(() => {
    if (!tripMode || !activeRoute || currentLat == null || currentLng == null) {
      tripProjIdxRef.current = 0;
      return 0;
    }
    const coords = safeActiveRouteCoords;
    if (!Array.isArray(coords) || coords.length < 2) return 0;
    const prior  = tripProjIdxRef.current;
    // Backward reach expanded to 30 (was 3) so a U-turn correctly walks the
    // green/blue split cursor back toward lower-index coords rather than
    // staying stuck at `prior` while the driver reverses.
    const wStart = Math.max(0, prior - 30);
    const wEnd   = Math.min(coords.length - 1, prior + 20);
    let bestIdx  = prior, bestDist = Infinity;
    for (let i = wStart; i <= wEnd; i++) {
      const d = haversine(currentLat, currentLng, coords[i].latitude, coords[i].longitude);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestDist > 200) {
      bestIdx = 0; bestDist = Infinity;
      for (let i = 0; i < coords.length; i++) {
        const d = haversine(currentLat, currentLng, coords[i].latitude, coords[i].longitude);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
    }
    tripProjIdxRef.current = bestIdx;
    return bestIdx - (bestIdx % TRIP_STEP);
  }, [tripMode, activeRoute, safeActiveRouteCoords, currentLat, currentLng]);

  const renderedTripSplitIdx = useMemo(() => {
    if (
      safeActiveRouteCoords.length < 2 ||
      renderedActiveRouteCoords.length < 2
    ) return 0;
    return Math.min(
      renderedActiveRouteCoords.length - 1,
      Math.round(
        (tripSplitIdx / (safeActiveRouteCoords.length - 1)) *
        (renderedActiveRouteCoords.length - 1),
      ),
    );
  }, [tripSplitIdx, safeActiveRouteCoords.length, renderedActiveRouteCoords.length]);

  // Traffic-coloured segments for the active route — full route with traffic colouring.
  const activeRouteSegs = useMemo(() => {
    if (!activeRoute) return null;
    const coords = safeActiveRouteCoords;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    return buildTrafficSegments(coords, activeRoute.speedIntervals);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoute, safeActiveRouteCoords]);

  return (
    <>
      {/* While any full-screen map picker is open (CrosshairPickerModal,
          AdminLocationPickerModal, SavedPlaceMapPicker) we unmount this MapView
          so there is never more than one concurrent native map surface alive.
          mapHidden is set only AFTER a snapshot is captured, so the transition
          shows a frozen still frame instead of a black rectangle.
          All mapRef.current?.animate* calls use optional chaining and are safe
          to call while the ref is null — they become no-ops until the map
          remounts after the picker closes. */}
      {mapHidden ? (
        pickerFreezeUri ? (
          <Image
            source={{ uri: pickerFreezeUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: "#000" }]} />
        )
      ) : (
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
        userInterfaceStyle={isDark ? "dark" : "light"}
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
        // Explicitly enable scroll and zoom so touch events are never blocked
        // by a default-false platform interpretation.  The GPS follow effect
        // only drives the centre coordinate — it deliberately does not own
        // zoom — so the driver's pinch-zoom is always respected.
        scrollEnabled
        zoomEnabled
        zoomTapEnabled
        // rotateEnabled=false: map rotation is driven exclusively via
        // animateCamera({ heading }) from the interval above; allowing gesture
        // rotation would let the driver accidentally spin the map and fight
        // the heading channel.
        rotateEnabled={false}
        // pitchEnabled=false: 3-D tilt adds no value in drive mode and
        // disabling it keeps the map flat (2-D heading-up), consistent with
        // the look-ahead camera design.
        pitchEnabled={false}
        onRegionChangeComplete={handleRegionChangeComplete}
        // onPanDrag fires reliably on every user drag gesture (unlike
        // onRegionChangeComplete's details.isGesture which is missing on older
        // react-native-maps builds). This is the primary drift-detection path.
        onPanDrag={handlePanDrag}
        onLongPress={(e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
          if (!isAdmin) return;
          const { latitude, longitude } = e.nativeEvent.coordinate;
          setCreateZoneCoords({ lat: latitude, lng: longitude });
        }}
      >
        {/* Nearby-alert focus highlight — three animated sonar-wave rings that
            expand outward from the alert pin for 5–6 s, then auto-dismiss.
            Triggered by:  (a) tapping a Nearby Alerts row → focusCoords()
                           (b) tapping a push notification → pendingFocusCoords
            Uses a Marker so rings are anchored to the map coordinate. */}
        {focusHighlight && (
          <Marker
            coordinate={{ latitude: focusHighlight.lat, longitude: focusHighlight.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={998}
            tracksViewChanges
            onPress={() => {
              dmPulseAnimRef.current?.stop();
              if (focusHighlightTimerRef.current) clearTimeout(focusHighlightTimerRef.current);
              setFocusHighlight(null);
            }}
          >
            <View collapsable={false} style={dmStyles.focusMarkerWrap}>
              {/* Ring 1 — largest, slowest to appear */}
              <Animated.View style={[
                dmStyles.pulseRing,
                {
                  transform: [{ scale: dmPulseRing1.interpolate({ inputRange: [0, 1], outputRange: [0.4, 3.2] }) }],
                  opacity:   dmPulseRing1.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.55, 0] }),
                },
              ]} />
              {/* Ring 2 */}
              <Animated.View style={[
                dmStyles.pulseRing,
                {
                  transform: [{ scale: dmPulseRing2.interpolate({ inputRange: [0, 1], outputRange: [0.4, 2.6] }) }],
                  opacity:   dmPulseRing2.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.60, 0] }),
                },
              ]} />
              {/* Ring 3 — smallest, innermost */}
              <Animated.View style={[
                dmStyles.pulseRing,
                {
                  transform: [{ scale: dmPulseRing3.interpolate({ inputRange: [0, 1], outputRange: [0.4, 2.0] }) }],
                  opacity:   dmPulseRing3.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.65, 0] }),
                },
              ]} />
              {/* Static centre dot */}
              <View style={dmStyles.focusRing}>
                <View style={dmStyles.focusRingInner} />
              </View>
            </View>
          </Marker>
        )}

        {/* Speed zone markers — road-stretch corridors show their limit as a
            badge at each end so you can see how the speed changes along the
            road, instead of a straight line cutting across the map. */}
        {visibleZones.map((z) => {
          if (z.lat == null || z.lng == null || isNaN(z.lat) || isNaN(z.lng)) return null;
          // Mobile cameras → green so drivers distinguish them from fixed cameras.
          // Fixed (or untagged) cameras → red.  Police / general zones keep their own colours.
          const isMobileCamera = z.type === "camera" && z.cameraType === "mobile";
          const bg = z.type === "camera"
            ? (isMobileCamera ? "#00A845" : "#E53935")
            : z.type === "police" ? "#1565C0" : "#E65100";
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
                strokeColor={z.type === "camera" ? (isMobileCamera ? "#00A84555" : "#E5393555") : "#1565C055"}
                fillColor={z.type === "camera" ? (isMobileCamera ? "#00A84512" : "#E5393912") : "#1565C012"}
                strokeWidth={1.5}
              />
            </React.Fragment>
          );
        })}

        {/* Camera halos for community-reported cameras — coloured by type so
            drivers can see the enforcement zone at a glance.
            Rendered before cluster markers so they sit underneath them. */}
        {visibleReports
          .filter((r) => r.type === "camera")
          .map((r) => {
            const isMobile = r.cameraType === "mobile";
            return (
              <Circle
                key={`cam-halo-${r.id}`}
                center={{ latitude: r.lat, longitude: r.lng }}
                radius={180}
                strokeColor={isMobile ? "#00A84555" : "#E5393555"}
                fillColor={isMobile ? "#00A84512" : "#E5393912"}
                strokeWidth={1.5}
              />
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
              tracksViewChanges={!clusterMarkersFrozen}
              onPress={() => openCluster(group)}
              zIndex={10}
            >
              <ClusterMarker group={group} />
            </Marker>
          );
        })}

        {/* HERE Live Traffic incidents — rendered as semi-transparent markers so
            they're visually subordinate to community reports. Tapping opens a
            detail sheet with a "Hide for this session" option. */}
        {visibleHereIncidents.map((inc) => {
          // Defensive: skip any HERE incident whose coordinates are missing or NaN
          // (a bad API response mid-drive should not crash the entire map render).
          if (!Number.isFinite(inc.lat) || !Number.isFinite(inc.lng)) return null;
          const def = resolveIncidentType(inc.type);
          return (
            <Marker
              key={inc.id}
              coordinate={{ latitude: inc.lat, longitude: inc.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              onPress={() => setSelectedHereIncident(inc)}
              zIndex={5}
            >
              <View style={{ alignItems: "center" }}>
                <View style={[hms.hereMarker, { backgroundColor: def.color + "CC", borderColor: def.color }]}>
                  <Text style={hms.hereEmoji}>{def.emoji}</Text>
                </View>
                <View style={hms.hereLiveBadge}>
                  <Text style={hms.hereLiveTxt}>LIVE</Text>
                </View>
              </View>
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

        {/* Alternative routes — only shown in route-preview mode (before trip starts).
            Hidden immediately when tripMode becomes true so the driver sees only
            the active green/blue split, never a cluttered set of grey alternatives.
            Geometry is sanitized + memoized in altRouteSegs (rebuilds only when
            altRoutes changes, never on GPS ticks). The sanitized route object is
            used for BOTH display and selection so selectRoute() never receives
            corrupt coordinates that would crash the native polyline layer. */}
        {!tripMode && altRouteSegs.map(({ route: safeRoute, segs }) => {
          return (
            <React.Fragment key={safeRoute.id}>
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


        {/* Route polyline — only rendered once the trip is active (tripMode=true).
            No polyline is shown in preview/pre-trip mode: the route-info sheet
            already shows destination, duration, and distance as text, and
            drawing a blue line before Start caused it to linger on the home
            map and persist through alt-route selection. */}
        {tripMode && activeRoute && renderedActiveRouteCoords.length >= 2 && (
          <>
            {/* Green section — coords already driven */}
            {renderedTripSplitIdx > 1 && (
              <>
                <Polyline
                  coordinates={renderedActiveRouteCoords.slice(0, renderedTripSplitIdx + 1)}
                  strokeColor="#FFFFFF30"
                  strokeWidth={10}
                  lineCap="round" lineJoin="round"
                />
                <Polyline
                  coordinates={renderedActiveRouteCoords.slice(0, renderedTripSplitIdx + 1)}
                  strokeColor="#00C853"
                  strokeWidth={6}
                  lineCap="round" lineJoin="round"
                />
              </>
            )}
            {/* Blue section — coords ahead */}
            {renderedTripSplitIdx < renderedActiveRouteCoords.length - 1 && (
              <>
                <Polyline
                  coordinates={renderedActiveRouteCoords.slice(renderedTripSplitIdx)}
                  strokeColor="#FFFFFF40"
                  strokeWidth={10}
                  lineCap="round" lineJoin="round"
                />
                <Polyline
                  coordinates={renderedActiveRouteCoords.slice(renderedTripSplitIdx)}
                  strokeColor="#1565C0"
                  strokeWidth={6}
                  lineCap="round" lineJoin="round"
                />
              </>
            )}
          </>
        )}

        {/* Destination marker — red dot in trip mode, blue nav pin in preview */}
        {activeRoute && renderedActiveRouteCoords.length > 0 && (
          <Marker
            coordinate={renderedActiveRouteCoords[renderedActiveRouteCoords.length - 1]}
            anchor={{ x: 0.5, y: tripMode ? 0.5 : 1 }}
            title="Destination"
            tracksViewChanges={false}
          >
            {tripMode ? (
              <View style={{
                width: 18, height: 18, borderRadius: 9,
                backgroundColor: "#E53935",
                borderWidth: 3, borderColor: "#FFF",
                shadowColor: "#E53935", shadowOpacity: 0.6, shadowRadius: 6, elevation: 8,
              }} />
            ) : (
              <MarkerIcon ioniconName="navigate" bg="#1565C0" size={36} />
            )}
          </Marker>
        )}
      </MapView>
      )}

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
                      ? selectedCluster.members[0].type === "camera"
                        ? (selectedCluster.members[0].cameraType === "mobile" ? "Mobile Camera" : "Fixed Camera")
                        : reportLabel(selectedCluster.members[0].type)
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
                  const bg = r.type === "camera" && r.cameraType === "mobile" ? "#00A845" : def.color;
                  const emoji = resolveIncidentEmoji(r.type, r.cameraType);
                  const ageStr = formatTimeAgo(r.timestamp, now);
                  // All reports get the interaction buttons — your own included.
                  // A driver may want to mark their own report "Gone now" if the
                  // situation resolved, or confirm it's "Still here" after circling back.
                  const canVote = true;
                  const confirmed = r.status === "confirmed";
                  const frTier  = reportTier(r.confirmCount);
                  const frLabel = r.type !== "camera"
                    ? freshnessLabel(r.confirmCount, r.timestamp, r.observationContext)
                    : null;
                  const frChip  = frLabel && (frTier !== "new" || r.observationContext === "community_tip")
                    ? freshnessChipColors(r.observationContext, frTier)
                    : null;
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
                          {r.type === "camera" && (() => {
                            const isMob = r.cameraType === "mobile";
                            const camColor = isMob ? "#00A845" : "#E53935";
                            return (
                              <View style={[ms.verifiedBadge, { backgroundColor: camColor + "18", borderColor: camColor + "55" }]}>
                                <Ionicons name="camera" size={11} color={camColor} />
                                <Text style={[ms.verifiedTxt, { color: camColor }]}>
                                  {isMob ? "Mobile" : "Fixed"}
                                </Text>
                              </View>
                            );
                          })()}
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
                          {r.type === "camera"
                            ? (r.cameraType === "mobile" ? "Mobile camera — may have moved" : "Fixed camera — permanent")
                            : ageStr}
                          {r.type !== "camera" && !r.adminVerified && r.confirmCount != null && r.confirmCount > 1 ? `  ·  ${r.confirmCount > 99 ? "99+" : r.confirmCount} say still here` : ""}
                          {r.type !== "camera" && r.adminVerified ? "  ·  Admin verified" : ""}
                          {r.type !== "camera" && !r.adminVerified && r.denyCount != null && r.denyCount > 0 ? `  ·  ${r.denyCount > 99 ? "99+" : r.denyCount} say gone` : ""}
                          {r.type === "camera" && r.speedLimit ? `  ·  ${capSpeedLimit(r.speedLimit, vehicle)} km/h zone` : ""}
                        </Text>
                        {frLabel && (
                          frChip
                            ? <View style={[ms.freshnessChip, { backgroundColor: frChip.bg, borderColor: frChip.border }]}>
                                <Text style={[ms.freshnessChipTxt, { color: frChip.text }]}>{frLabel}</Text>
                              </View>
                            : <Text style={[ms.incidentMeta, { fontStyle: "italic", marginTop: 2 }]}>{frLabel}</Text>
                        )}
                        {r.type === "camera" && r.cameraType !== "mobile" ? (
                          r.status === "admin_review" ? (
                            <View style={ms.pendingReviewBanner}>
                              <Text style={ms.pendingReviewTxt}>⏳ Removal pending admin review</Text>
                            </View>
                          ) : (
                            // Fixed/unclassified camera anchors are managed by admins.
                            // Drivers can flag an outdated position for admin review.
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
                          // Temporary incidents and mobile cameras can be confirmed or
                          // marked Gone now. Mobile cameras must not be treated as permanent.
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
                          <>
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
                            </View>
                            <View style={[ms.adminActionRow, { marginTop: 6 }]}>
                              <TouchableOpacity
                                style={[ms.adminBtn, { backgroundColor: "#EDE7F620", borderColor: "#4A148C40" }]}
                                onPress={() => {
                                  setSelectedCluster(null);
                                  setEditingReport(r);
                                }}
                              >
                                <Ionicons name="create-outline" size={13} color="#4A148C" />
                                <Text style={[ms.adminBtnTxt, { color: "#4A148C" }]}>Edit</Text>
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
                          </>
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

      {/* HERE Live Traffic incident detail sheet */}
      {selectedHereIncident && (() => {
        const def = resolveIncidentType(selectedHereIncident.type);
        return (
          <Modal transparent animationType="slide" visible onRequestClose={() => setSelectedHereIncident(null)}>
            <TouchableOpacity style={ms.backdrop} activeOpacity={1} onPress={() => setSelectedHereIncident(null)}>
              <TouchableOpacity activeOpacity={1} style={ms.sheet}>
                <View style={ms.handle} />
                <View style={ms.headerRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={ms.sheetTitle}>{def.label}</Text>
                    <View style={hms.hereLiveRow}>
                      <View style={hms.hereLivePill}>
                        <Text style={hms.hereLivePillTxt}>LIVE · HERE Traffic</Text>
                      </View>
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedHereIncident(null)} style={ms.closeBtn}>
                    <Ionicons name="close" size={18} color="#555" />
                  </TouchableOpacity>
                </View>
                <View style={ms.incidentRow}>
                  <View style={[ms.incidentIcon, { backgroundColor: def.color + "22" }]}>
                    <Text style={ms.incidentEmoji}>{def.emoji}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    {selectedHereIncident.roadName ? (
                      <Text style={ms.incidentRoad}>{selectedHereIncident.roadName}</Text>
                    ) : null}
                    {selectedHereIncident.description ? (
                      <Text style={ms.incidentMeta}>{selectedHereIncident.description}</Text>
                    ) : null}
                    <Text style={ms.incidentMeta}>
                      {selectedHereIncident.endTime
                        ? `Expected to clear ${new Date(selectedHereIncident.endTime).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" })}`
                        : "Duration unknown"}
                    </Text>
                  </View>
                </View>
                <View style={[ms.voteRow, { marginTop: 8 }]}>
                  <TouchableOpacity
                    style={[ms.voteBtn, { backgroundColor: "#75757518", borderColor: "#75757555" }]}
                    onPress={() => {
                      dismissHereIncident(selectedHereIncident.id);
                      setSelectedHereIncident(null);
                    }}
                  >
                    <Ionicons name="eye-off-outline" size={13} color="#757575" />
                    <Text style={[ms.voteTxt, { color: "#757575" }]}>Hide for this session</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>
        );
      })()}

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
      {/* Admin mode badge + moderation queue button */}
      {isAdmin && (
        <View style={ms.adminModeBadge} pointerEvents="box-none">
          <TouchableOpacity
            style={ms.adminModeBadgeBtn}
            onPress={() => setShowModerationQueue(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="shield" size={12} color="#FFF" />
            <Text style={ms.adminModeBadgeTxt}>Admin</Text>
            <View style={ms.adminModeSep} />
            <Ionicons name="list" size={12} color="#FFF" />
            <Text style={ms.adminModeBadgeTxt}>Queue</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Admin: Edit zone metadata */}
      <AdminZoneEditSheet
        zone={editingZone ?? undefined}
        visible={editingZone !== null}
        onClose={() => setEditingZone(null)}
        onSave={async (fields: ZoneEditFields) => {
          if (!editingZone) return;
          await adminEditZone(editingZone.id, fields, editingZone);
        }}
      />

      {/* Admin: Create new zone via long-press */}
      <AdminZoneEditSheet
        createCoords={createZoneCoords ?? undefined}
        visible={createZoneCoords !== null}
        onClose={() => setCreateZoneCoords(null)}
        onSave={async (fields: ZoneEditFields) => {
          if (!createZoneCoords) return;
          await adminCreateZone({
            name:        fields.name,
            road:        fields.road        || undefined,
            type:        fields.type,
            description: fields.description || undefined,
            speedLimit:  fields.speedLimit  ?? undefined,
            lat: createZoneCoords.lat,
            lng: createZoneCoords.lng,
          });
          setCreateZoneCoords(null);
        }}
      />

      {/* Admin: Edit report type/roadName */}
      {editingReport && (
        <AdminReportEditSheet
          report={editingReport}
          visible
          onClose={() => setEditingReport(null)}
          onSave={async (fields) => {
            if (!editingReport) return;
            const serverId = editingReport.serverId ?? editingReport.id;
            await adminEditReport(serverId, editingReport.id, fields);
          }}
        />
      )}

      {/* Admin: Moderation queue */}
      <AdminModerationQueue
        visible={showModerationQueue}
        onClose={() => setShowModerationQueue(false)}
        onFixPin={(qr) => {
          // Map AdminReport to a minimal CommunityReport for AdminLocationPickerModal
          const synthetic: CommunityReport = {
            id:        qr.id,
            serverId:  qr.id,
            type:      qr.type as CommunityReport["type"],
            lat:       qr.lat,
            lng:       qr.lng,
            timestamp: new Date(qr.createdAt).getTime(),
            confirmed: qr.confirmCount,
            status:    qr.status as CommunityReport["status"],
            roadName:  qr.roadName ?? undefined,
            adminVerified: qr.adminVerified,
          };
          setShowModerationQueue(false);
          setAdminLocationTarget(synthetic);
        }}
        onViewOnMap={(lat, lng) => {
          setShowModerationQueue(false);
          // Brief delay so the modal finishes animating out before the map moves
          setTimeout(() => {
            mapRef.current?.animateToRegion(
              { latitude: lat, longitude: lng, latitudeDelta: 0.004, longitudeDelta: 0.004 },
              700,
            );
          }, 350);
        }}
      />

      {selectedZone && !adminZoneLocationTarget && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setSelectedZone(null)}>
          <TouchableOpacity style={ms.backdrop} activeOpacity={1} onPress={() => setSelectedZone(null)}>
            <TouchableOpacity activeOpacity={1} style={ms.sheet}>
              {/* Header */}
              <View style={ms.sheetHeader}>
                <View style={[ms.zoneIconWrap, {
                  backgroundColor: selectedZone.type === "camera"
                    ? (selectedZone.cameraType === "mobile" ? "#00A84518" : "#E5393518")
                    : selectedZone.type === "police" ? "#1565C018" : "#E6510018",
                }]}>
                  <Ionicons
                    name={selectedZone.type === "camera" ? "camera" : selectedZone.type === "police" ? "person" : "speedometer"}
                    size={20}
                    color={selectedZone.type === "camera"
                      ? (selectedZone.cameraType === "mobile" ? "#00A845" : "#E53935")
                      : selectedZone.type === "police" ? "#1565C0" : "#E65100"}
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
                    ? (selectedZone.cameraType === "mobile"
                      ? "Mobile speed camera — may have moved"
                      : "Fixed speed camera — permanent")
                    : selectedZone.type === "police"
                    ? "Police checkpoint — reported by our team"
                    : "Speed zone — managed by our team"}
                </Text>
              </View>

              {/* Admin actions — available for all zones (both static and DB-managed) */}
              {isAdmin && (
                <>
                  <View style={ms.adminActionRow}>
                    <TouchableOpacity
                      style={[ms.adminBtn, { backgroundColor: "#E8F5E920", borderColor: "#1B5E2040" }]}
                      onPress={async () => {
                        try {
                          await adminVerifyZone(selectedZone.id, selectedZone);
                          Alert.alert("Verified", `"${selectedZone.name}" marked as verified.`);
                        } catch (err: any) {
                          Alert.alert("Failed", err?.message ?? "Could not verify zone.");
                        }
                      }}
                    >
                      <Ionicons name="checkmark-circle" size={13} color="#1B5E20" />
                      <Text style={[ms.adminBtnTxt, { color: "#1B5E20" }]}>
                        {selectedZone.verified ? "✓ Verified" : "Verify"}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[ms.adminBtn, { backgroundColor: "#EDE7F620", borderColor: "#4A148C40" }]}
                      onPress={() => {
                        setEditingZone(selectedZone);
                        setSelectedZone(null);
                      }}
                    >
                      <Ionicons name="create-outline" size={13} color="#4A148C" />
                      <Text style={[ms.adminBtnTxt, { color: "#4A148C" }]}>Edit</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={[ms.adminActionRow, { marginTop: 6 }]}>
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
                </>
              )}
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}
    </>
  );
});

// React.memo prevents re-renders when the parent re-renders for unrelated
// reasons and passes the same mapDrifted/onDriftChange props. Context-driven
// re-renders (via useApp()) are still gated by the adaptive GPS rate and
// position dead-band in AppContext, which is the primary battery fix.
export default React.memo(DriveMapView);

// ─── Styles ──────────────────────────────────────────────────────────────────

const ms = StyleSheet.create({
  // ── Admin mode floating badge ───────────────────────────────────────────────
  adminModeBadge: {
    position: "absolute",
    bottom: 100,
    right: 14,
    zIndex: 20,
  },
  adminModeBadgeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#1565C0DD",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
  adminModeBadgeTxt: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    color: "#FFF",
    letterSpacing: 0.3,
  },
  adminModeSep: {
    width: 1,
    height: 11,
    backgroundColor: "#FFFFFF60",
    marginHorizontal: 2,
  },

  // ── Single emoji marker ─────────────────────────────────────────────────────
  emojiMarker: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: "#FFF",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.28, shadowRadius: 4, elevation: 5,
  },
  emojiMarkerText: { fontSize: 14, lineHeight: 17, fontFamily: EMOJI_FONT_FAMILY },

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
    width: 62, height: 62,
    backgroundColor: "#FFF",
    borderRadius: 17, borderWidth: 2, borderColor: "#E0E0E0",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28, shadowRadius: 6, elevation: 7,
  },
  clusterGrid: {
    flexDirection: "row", flexWrap: "wrap",
    gap: 2, width: 42, height: 42,
    alignItems: "center", justifyContent: "center",
  },
  clusterCell: {
    width: 19, height: 19, borderRadius: 5,
    alignItems: "center", justifyContent: "center",
  },
  clusterEmoji: { fontSize: 12, fontFamily: EMOJI_FONT_FAMILY },
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
  freshnessChip: {
    alignSelf: "flex-start" as const,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginTop: 4,
  },
  freshnessChipTxt: { fontSize: 11, fontWeight: "600" as const },
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

// HERE Live Traffic marker + sheet styles
const hms = StyleSheet.create({
  hereMarker: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5,
  },
  hereEmoji: { fontSize: 16 },
  hereLiveBadge: {
    backgroundColor: "#1565C0",
    borderRadius: 4,
    paddingHorizontal: 3, paddingVertical: 1,
    marginTop: 2,
  },
  hereLiveTxt: { fontSize: 7, fontWeight: "800", color: "#FFF", letterSpacing: 0.5 },
  hereLiveRow: { flexDirection: "row", marginTop: 4 },
  hereLivePill: {
    backgroundColor: "#1565C0",
    borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  hereLivePillTxt: { fontSize: 10, fontWeight: "800", color: "#FFF", letterSpacing: 0.5 },
});

// Styles for the animated sonar-pulse focus marker (notification deep-link highlight)
const dmStyles = StyleSheet.create({
  focusMarkerWrap: {
    width: 80, height: 80,
    alignItems: "center", justifyContent: "center",
  },
  pulseRing: {
    position: "absolute",
    width: 54, height: 54, borderRadius: 27,
    borderWidth: 2.5, borderColor: "#FFD600",
    backgroundColor: "#FFD60012",
  },
  focusRing: {
    width: 54, height: 54, borderRadius: 27,
    borderWidth: 3, borderColor: "#FFD600",
    backgroundColor: "#FFD60018",
    alignItems: "center", justifyContent: "center",
  },
  focusRingInner: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: "#FFD600",
    borderWidth: 2, borderColor: "#FFFFFF",
  },
});
