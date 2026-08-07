import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import DARK_MAP_STYLE from "@/constants/darkMapStyle";
import { ActivityIndicator, Alert, Animated, Dimensions, FlatList, Keyboard, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { MAP_CHIPS, CATEGORIES, type QueryCategory, type POIResult, fetchNearbyPOIs, formatDist } from "@/utils/nearbyPlaces";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import MapView, { Circle, Marker, Polyline } from "react-native-maps";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { getVehicleTypeDef, capSpeedLimit } from "@/data/vehicleTypes";
import ReportModal from "@/components/ReportModal";
import { CrosshairPickerModal } from "@/components/CrosshairPicker";
import RouteSearchSheet from "@/components/RouteSearchSheet";
import { nominatimSearch, type GeoResult } from "@/utils/geocoding";
import * as Haptics from "expo-haptics";
import ReportUndoToast, { UndoableReport } from "@/components/ReportUndoToast";
import { AdminLocationPickerModal } from "@/components/AdminLocationPickerModal";
import { snapToRoad, getRoadName } from "@/utils/snapToRoad";
import { INCIDENT_TYPES, INCIDENT_TYPE_ORDER, resolveIncidentType } from "@/constants/incidentTypes";
import { playSound } from "@/utils/sound";
import KenyaFlagPill from "@/components/KenyaFlagPill";
import { speakAlert } from "@/utils/alertTts";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";
import type { CommunityReport } from "@/context/AppContext";
import { formatTimeAgo } from "@/lib/timeAgo";
import { useWeather, weatherIcon } from "@/hooks/useWeather";

const NAIROBI = { latitude: -1.2921, longitude: 36.8219, latitudeDelta: 0.15, longitudeDelta: 0.15 };

// ── Camera helpers (mirrored from DriveMapView) ───────────────────────────────

// Fixed zoom delta used during active navigation on this screen.
// 0.007 ≈ 700 m visible — enough road ahead at city / highway speeds.
const NAV_DELTA = 0.007;

// Low-pass filter for heading — handles 360°/0° wraparound.
function smoothHeading(current: number | null, target: number, alpha = 0.25): number {
  if (current == null) return target;
  let diff = target - current;
  if (diff >  180) diff -= 360;
  if (diff < -180) diff += 360;
  return (current + diff * alpha + 360) % 360;
}

// Offset the map centre forward along the driver's heading so the road ahead
// fills the screen rather than the driver sitting dead-centre.
// LOOK_AHEAD_K = 0.25 → driver sits ≈ 25 % from the bottom edge.
const LOOK_AHEAD_K = 0.25;
function lookAheadCenter(
  lat: number, lng: number,
  heading: number | null, delta: number,
): { latitude: number; longitude: number } {
  if (heading == null) return { latitude: lat, longitude: lng };
  const hdgRad = (heading * Math.PI) / 180;
  return {
    latitude:  lat + delta * LOOK_AHEAD_K * Math.cos(hdgRad),
    longitude: lng + delta * LOOK_AHEAD_K * Math.sin(hdgRad),
  };
}

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
      <View collapsable={false}>
        <View style={[styles.emojiMarker, { backgroundColor: def.color }]}>
          <Text style={styles.emojiMarkerText}>{def.emoji}</Text>
        </View>
      </View>
    );
  }

  const icons = members.slice(0, 4);
  return (
    <View collapsable={false}>
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
  const router = useRouter();
  const {
    currentLat, currentLng,
    communityReports, addReport, deleteReport,
    activeRoute, altRoutes, selectRoute,
    navigationActive, snapToActiveRoute,
    navDestination, setNavDestination, startNavigation,
    showTraffic, setShowTraffic,
    vehicleType, allZones,
    confirmReport, denyReport, flagReport,
    driverHeading, currentSpeed,
    isAdmin, adminVerifyReport, adminDenyReport, adminUpdateReportLocation,
    adminUpdateZoneLocation, adminRemoveZone, adminVerifyZone, adminSyncStaticZones,
    routeIncidentsAhead, setRouteIncidentsExpanded,
    mapPickerActive,
    setMapPickerActive,
  } = useApp();
  const weather = useWeather(currentLat, currentLng);

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
  const [crosshairRequest, setCrosshairRequest] = useState<{
    lat: number; lng: number; onConfirm: (lat: number, lng: number) => void;
  } | null>(null);
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
  const [mapDrifted, setMapDrifted] = useState(false);
  // ── Heading-up compass mode ─────────────────────────────────────────────────
  const [headingUpMode, setHeadingUpMode] = useState(false);
  // ── Inline chip search ──────────────────────────────────────────────────────
  const [activeChipCat, setActiveChipCat] = useState<QueryCategory | null>(null);
  const [chipResults, setChipResults]     = useState<POIResult[]>([]);
  const [chipLoading, setChipLoading]     = useState(false);
  const [chipError, setChipError]         = useState<string | null>(null);
  // ── Inline place search (geocoding) ─────────────────────────────────────────
  const [placeQuery, setPlaceQuery]       = useState("");
  const [placeResults, setPlaceResults]   = useState<GeoResult[]>([]);
  const [placeLoading, setPlaceLoading]   = useState(false);
  const [placeFocused, setPlaceFocused]   = useState(false);
  const placeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ── Incident filter (search-bar filter button) ──────────────────────────────
  // Client-side display filter for community report markers only.
  // "all" = everything, "alcoblow" = alcoblow reports only, "other" = all non-alcoblow.
  const [incidentFilter, setIncidentFilter] = useState<"all" | "alcoblow" | "other">("all");
  const [filterPickerOpen, setFilterPickerOpen] = useState(false);
  const filteredReports = useMemo(() => {
    if (incidentFilter === "alcoblow") return communityReports.filter((r) => r.type === "alcoblow");
    if (incidentFilter === "other")    return communityReports.filter((r) => r.type !== "alcoblow");
    return communityReports;
  }, [communityReports, incidentFilter]);
  const clusters = useMemo(() => clusterReports(filteredReports), [filteredReports]);
  const mapRef = useRef<MapView>(null);

  // ── Alert focus (deep-link from the home screen's Nearby Alerts cards) ─────
  // The home screen pushes /(tabs)/map?focusId=&focusLat=&focusLng=&focusTs=.
  // We centre the camera on the alert and render an emphasized highlight ring
  // under its marker so the driver can see which road it's on. focusTs makes
  // re-tapping the same card re-trigger the effect.
  const { focusId, focusLat, focusLng, focusTs } = useLocalSearchParams<{
    focusId?: string; focusLat?: string; focusLng?: string; focusTs?: string;
  }>();
  const [focusedAlert, setFocusedAlert] = useState<{ id: string; lat: number; lng: number } | null>(null);

  // ── Pulsing ring animation refs ───────────────────────────────────────────
  const pulseRing1 = useRef(new Animated.Value(0)).current;
  const pulseRing2 = useRef(new Animated.Value(0)).current;
  const pulseRing3 = useRef(new Animated.Value(0)).current;
  const pulseAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const focusDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!focusId || !focusLat || !focusLng) return;
    const lat = parseFloat(focusLat);
    const lng = parseFloat(focusLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setFocusedAlert({ id: focusId, lat, lng });

    // Defer one tick so the MapView ref exists when arriving cold on this tab.
    const t = setTimeout(() => {
      mapRef.current?.animateToRegion(
        { latitude: lat, longitude: lng, latitudeDelta: 0.012, longitudeDelta: 0.012 },
        600,
      );
    }, 350);

    // Start expanding ring animation — 3 rings staggered by 466 ms each.
    pulseAnimRef.current?.stop();
    [pulseRing1, pulseRing2, pulseRing3].forEach((v) => v.setValue(0));
    const makeRing = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 1400, useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );
    const anim = Animated.parallel([
      makeRing(pulseRing1, 0),
      makeRing(pulseRing2, 467),
      makeRing(pulseRing3, 933),
    ]);
    pulseAnimRef.current = anim;
    anim.start();

    // Auto-dismiss after 3 seconds.
    if (focusDismissTimer.current) clearTimeout(focusDismissTimer.current);
    focusDismissTimer.current = setTimeout(() => {
      pulseAnimRef.current?.stop();
      setFocusedAlert(null);
    }, 3000);

    return () => {
      clearTimeout(t);
      if (focusDismissTimer.current) clearTimeout(focusDismissTimer.current);
      pulseAnimRef.current?.stop();
    };
  }, [focusId, focusLat, focusLng, focusTs]);
  const openedAtRef = useRef(0);
  const now = Date.now();

  const TAB_H = Platform.OS === "web" ? 84 : 96;
  const HALF_SCREEN = Math.round(Dimensions.get("window").height * 0.5);

  // ── Look-ahead camera refs ──────────────────────────────────────────────────
  // Low-pass smoothed heading for the camera — avoids snap-rotations when GPS
  // bearing jumps.  null = not yet initialised.
  const camHeadingRef        = useRef<number | null>(null);
  // Tracks previous navigationActive so the effect detects the start/end transition.
  const prevNavActiveRef     = useRef(navigationActive);
  // Ref mirror of mapDrifted so callbacks don't capture stale state.
  const mapDriftedRef        = useRef(false);
  // Mounted guard — all deferred native calls check this before running.
  const mountedRef           = useRef(true);
  // iOS heading channel: last heading actually sent to MapKit.
  const lastAnimatedHdgRef   = useRef<number | null>(null);
  // iOS heading interval ID.
  const headingIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep mapDriftedRef in sync with the state value.
  useEffect(() => { mapDriftedRef.current = mapDrifted; }, [mapDrifted]);

  // Unmount cleanup — cancel any pending interval.
  useEffect(() => () => {
    mountedRef.current = false;
    if (headingIntervalRef.current) clearInterval(headingIntervalRef.current);
  }, []);

  // ── iOS heading channel ─────────────────────────────────────────────────────
  // On iOS, combining `heading` with `center` in animateCamera causes a MapKit
  // composite-animation crash at speed.  Send heading-only updates on a
  // separate 1500 ms interval instead (same pattern as DriveMapView).
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (headingIntervalRef.current) { clearInterval(headingIntervalRef.current); headingIntervalRef.current = null; }
    if (!navigationActive && !headingUpMode) return;
    headingIntervalRef.current = setInterval(() => {
      if (!mountedRef.current || mapDriftedRef.current) return;
      const hdg = camHeadingRef.current;
      if (hdg == null) return;
      const prev  = lastAnimatedHdgRef.current;
      const delta = prev == null ? 360 : Math.abs(((hdg - prev) + 540) % 360 - 180);
      if (delta < 2) return;
      lastAnimatedHdgRef.current = hdg;
      mapRef.current?.animateCamera({ heading: hdg }, { duration: 800 });
    }, 1500);
    return () => { if (headingIntervalRef.current) { clearInterval(headingIntervalRef.current); headingIntervalRef.current = null; } };
  }, [navigationActive, headingUpMode]);

  // ── GPS-follow camera with look-ahead ──────────────────────────────────────
  // During active navigation: keep the driver in the lower quarter of the
  // screen so the road ahead is always visible.  Pauses when the driver pans
  // (mapDrifted) and resumes when they tap Recenter.
  useEffect(() => {
    const wasActive = prevNavActiveRef.current;
    prevNavActiveRef.current = navigationActive;

    if (!navigationActive) {
      if (wasActive) {
        // Nav ended — restore north-up.
        camHeadingRef.current = 0;
        mapRef.current?.animateCamera({ heading: 0 }, { duration: 400 });
      }
      return;
    }

    if (currentLat == null || currentLng == null) return;

    // Nav just started — zoom in and orient to heading.
    if (!wasActive) {
      const initialHdg = (driverHeading != null && driverHeading >= 0) ? driverHeading : 0;
      camHeadingRef.current      = initialHdg;
      lastAnimatedHdgRef.current = null;
      const center = lookAheadCenter(currentLat, currentLng, initialHdg, NAV_DELTA);
      mapRef.current?.animateToRegion(
        { ...center, latitudeDelta: NAV_DELTA, longitudeDelta: NAV_DELTA }, 400,
      );
      if (initialHdg > 0) {
        setTimeout(() => {
          if (mountedRef.current) mapRef.current?.animateCamera({ heading: initialHdg }, { duration: 300 });
        }, 450);
      }
      return;
    }

    // Normal follow — skip when drifted or stationary.
    if (mapDriftedRef.current) return;
    if ((currentSpeed ?? 0) < 3) return;

    // Advance smoothed heading.
    if (driverHeading != null && driverHeading >= 0) {
      camHeadingRef.current = smoothHeading(camHeadingRef.current, driverHeading, 0.25);
    }

    const center = lookAheadCenter(currentLat, currentLng, camHeadingRef.current, NAV_DELTA);
    // iOS: position only — heading sent by the 1500 ms interval to avoid
    // MapKit composite-animation crash.  Android: combined update at 1 Hz.
    const update: { center: typeof center; heading?: number } = { center };
    if (Platform.OS !== "ios" && camHeadingRef.current != null) {
      update.heading = camHeadingRef.current;
    }
    mapRef.current?.animateCamera(update, { duration: 300 });
  }, [navigationActive, currentLat, currentLng, driverHeading, currentSpeed]);

  // ── Heading-up compass mode camera ─────────────────────────────────────────
  // Keeps map oriented to driver direction outside of active navigation.
  useEffect(() => {
    if (!headingUpMode || navigationActive) return;
    if (mapDriftedRef.current) return;
    if (currentLat == null || currentLng == null) return;
    if (driverHeading == null || driverHeading < 0) return;
    camHeadingRef.current = smoothHeading(camHeadingRef.current, driverHeading, 0.3);
    const hdg = camHeadingRef.current!;
    const center = lookAheadCenter(currentLat, currentLng, hdg, 0.015);
    if (Platform.OS === "ios") {
      mapRef.current?.animateCamera({ center }, { duration: 300 });
      // iOS heading is sent by the 1500 ms interval above.
    } else {
      mapRef.current?.animateCamera({ center, heading: hdg }, { duration: 300 });
    }
  }, [headingUpMode, navigationActive, currentLat, currentLng, driverHeading]);

  // Restore north-up when compass mode is turned off (outside nav).
  useEffect(() => {
    if (!headingUpMode && !navigationActive) {
      camHeadingRef.current = 0;
      mapRef.current?.animateCamera({ heading: 0 }, { duration: 400 });
    }
  }, [headingUpMode, navigationActive]);

  // Cluster markers always keep tracksViewChanges={true} — see DriveMapView
  // for the full explanation. The freeze optimisation caused tap hit-detection
  // to break whenever communityReports changed (polls, votes, new reports).

  const handleReport = async (type: CommunityReport["type"], speedLimit?: number, location?: { lat: number; lng: number }) => {
    setShowReport(false);
    let id: string | undefined;
    if (location) {
      const road = await getRoadName(location.lat, location.lng).catch(() => null);
      id = addReport(type, location.lat, location.lng, speedLimit, road ?? undefined);
    } else if (currentLat && currentLng) {
      // Use the route polyline snap when a route is active — it pins the marker
      // on the exact road rather than whatever nearest road Google Roads picks.
      const routeSnap = snapToActiveRoute(currentLat, currentLng);
      const [snapped, road] = await Promise.all([
        routeSnap ? Promise.resolve(routeSnap) : snapToRoad(currentLat, currentLng),
        getRoadName(currentLat, currentLng).catch(() => null),
      ]);
      id = addReport(type, snapped.lat, snapped.lng, speedLimit, road ?? undefined);
    }
    if (id) {
      setUndoReport({ id, type });
      // Play confirmation audio after the report is submitted and the undo toast appears
      playSound("confirm").catch(() => {});
      speakAlert("report_submitted").catch(() => {});
    }
  };

  const undoLastReport = () => {
    if (undoReport) deleteReport(undoReport.id);
    setUndoReport(null);
  };

  // ── Inline chip nearby search ───────────────────────────────────────────────
  const runChipSearch = useCallback(async (cat: QueryCategory) => {
    if (currentLat == null || currentLng == null) return;
    setActiveChipCat(cat);
    setChipLoading(true);
    setChipError(null);
    setChipResults([]);
    try {
      const results = await fetchNearbyPOIs(cat, currentLat, currentLng, activeRoute?.coords ?? null);
      setChipResults(results);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Search failed";
      const isConn = msg.toLowerCase().includes("network") || msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("abort");
      setChipError(isConn ? "No connection. Check your data." : "Search failed — try again.");
    } finally {
      setChipLoading(false);
    }
  }, [currentLat, currentLng, activeRoute]);

  // ── Inline place search handlers ────────────────────────────────────────────
  const runPlaceSearch = useCallback(async (q: string) => {
    const text = q.trim();
    if (text.length < 2) { setPlaceResults([]); setPlaceLoading(false); return; }
    setPlaceLoading(true);
    try {
      const data = await nominatimSearch(text);
      setPlaceResults(data);
    } catch { setPlaceResults([]); } finally { setPlaceLoading(false); }
  }, []);

  const handlePlaceChange = (text: string) => {
    setPlaceQuery(text);
    // Tapping the text input clears any active chip category
    if (activeChipCat) { setActiveChipCat(null); setChipResults([]); setChipError(null); }
    if (placeTimerRef.current) clearTimeout(placeTimerRef.current);
    if (text.trim().length < 2) { setPlaceResults([]); setPlaceLoading(false); return; }
    setPlaceLoading(true);
    placeTimerRef.current = setTimeout(() => runPlaceSearch(text), 400);
  };

  const clearPlaceSearch = () => {
    setPlaceQuery(""); setPlaceResults([]); setPlaceLoading(false);
    if (placeTimerRef.current) clearTimeout(placeTimerRef.current);
  };

  const handlePlaceSelect = (name: string, lat: number, lng: number) => {
    Keyboard.dismiss();
    clearPlaceSearch();
    setActiveChipCat(null); setChipResults([]); setChipError(null);
    setNavDestination({ name, lat, lng });
    startNavigation();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.replace("/(tabs)/drive");
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
      if (navigationActive || headingUpMode) {
        const hdg    = camHeadingRef.current ?? driverHeading ?? 0;
        const delta  = navigationActive ? NAV_DELTA : 0.015;
        const center = lookAheadCenter(currentLat, currentLng, hdg, delta);
        mapRef.current.animateToRegion(
          { ...center, latitudeDelta: delta, longitudeDelta: delta }, 600,
        );
        if (hdg > 0) {
          setTimeout(() => {
            if (mountedRef.current) mapRef.current?.animateCamera({ heading: hdg }, { duration: 300 });
          }, 650);
        }
      } else {
        mapRef.current.animateToRegion(
          { latitude: currentLat, longitude: currentLng, latitudeDelta: 0.04, longitudeDelta: 0.04 },
          600,
        );
      }
    }
    mapDriftedRef.current = false;
    setMapDrifted(false);
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
      {/* ── Inline search bar — always-visible TextInput ─────────────────────── */}
      <View style={[styles.searchBar, { top: insets.top + 8, backgroundColor: c.card }]}>
        <Ionicons name="search-outline" size={18} color={placeFocused ? c.primary : c.mutedForeground} />
        <TextInput
          style={[styles.searchBarInput, { color: c.foreground }]}
          placeholder="Where to?"
          placeholderTextColor={c.mutedForeground}
          value={placeQuery}
          onChangeText={handlePlaceChange}
          onFocus={() => setPlaceFocused(true)}
          onBlur={() => setTimeout(() => setPlaceFocused(false), 150)}
          returnKeyType="search"
          onSubmitEditing={() => runPlaceSearch(placeQuery)}
          autoCorrect={false}
          autoCapitalize="words"
        />
        {placeLoading
          ? <ActivityIndicator size="small" color={c.primary} />
          : placeQuery.length > 0
            ? <TouchableOpacity onPress={clearPlaceSearch} hitSlop={10}>
                <Ionicons name="close-circle" size={18} color={c.mutedForeground} />
              </TouchableOpacity>
            : null
        }
        {placeFocused && (
          <TouchableOpacity
            onPress={() => { Keyboard.dismiss(); setPlaceFocused(false); }}
            hitSlop={8}
            style={[styles.searchDismissBtn, { backgroundColor: c.muted }]}
          >
            <Text style={[styles.searchDismissTxt, { color: c.mutedForeground }]}>Done</Text>
          </TouchableOpacity>
        )}
        {/* Incident filter button — far right of the search bar */}
        <TouchableOpacity
          onPress={() => setFilterPickerOpen(true)}
          hitSlop={8}
          style={[
            styles.filterBtn,
            { backgroundColor: incidentFilter !== "all" ? c.primary + "18" : "transparent" },
          ]}
        >
          <Ionicons
            name={incidentFilter !== "all" ? "funnel" : "funnel-outline"}
            size={18}
            color={incidentFilter !== "all" ? c.primary : c.mutedForeground}
          />
          {incidentFilter !== "all" && (
            <View style={[styles.filterDot, { backgroundColor: c.primary, borderColor: c.card }]} />
          )}
        </TouchableOpacity>
      </View>

      {/* ── Incident filter picker ─────────────────────────────────────────── */}
      <Modal
        visible={filterPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFilterPickerOpen(false)}
      >
        <TouchableOpacity
          style={styles.filterBackdrop}
          activeOpacity={1}
          onPress={() => setFilterPickerOpen(false)}
        >
          <View style={[styles.filterSheet, { top: insets.top + 60, backgroundColor: c.card }]}>
            <Text style={[styles.filterTitle, { color: c.mutedForeground }]}>Show on map</Text>
            {([
              { key: "all",      label: "All reports",     icon: "layers-outline" as const },
              { key: "alcoblow", label: "Alcoblow only",   icon: "beer-outline" as const },
              { key: "other",    label: "Other incidents", icon: "warning-outline" as const },
            ] as const).map((opt) => {
              const active = incidentFilter === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.filterRow, active && { backgroundColor: c.primary + "12" }]}
                  activeOpacity={0.7}
                  onPress={() => { setIncidentFilter(opt.key); setFilterPickerOpen(false); }}
                >
                  <Ionicons name={opt.icon} size={18} color={active ? c.primary : c.mutedForeground} />
                  <Text style={[styles.filterRowTxt, { color: active ? c.primary : c.foreground }]}>
                    {opt.label}
                  </Text>
                  {active && <Ionicons name="checkmark" size={18} color={c.primary} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Inline results dropdown — shows below the chips row ─────────────── */}
      {(placeResults.length > 0 || (activeChipCat && (chipLoading || chipResults.length > 0 || !!chipError))) && (
        <View style={[styles.searchDropdown, {
          top: insets.top + 118,
          bottom: insets.bottom + TAB_H + 8,
          backgroundColor: c.card,
          shadowColor: "#000",
        }]}>
          {/* Geocoding results */}
          {placeResults.length > 0 && (
            <FlatList
              data={placeResults}
              keyExtractor={(_, i) => String(i)}
              style={{ flex: 1 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.dropdownRow, { borderColor: c.border }]}
                  activeOpacity={0.72}
                  onPress={() => handlePlaceSelect(item.short, item.lat, item.lng)}
                >
                  <View style={[styles.dropdownIcon, { backgroundColor: c.primary + "15" }]}>
                    <Ionicons name="location-outline" size={16} color={c.primary} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.dropdownName, { color: c.foreground }]} numberOfLines={1}>{item.short}</Text>
                    {item.display !== item.short && (
                      <Text style={[styles.dropdownAddr, { color: c.mutedForeground }]} numberOfLines={1}>{item.display}</Text>
                    )}
                  </View>
                  <Ionicons name="navigate-outline" size={14} color={c.primary} />
                </TouchableOpacity>
              )}
            />
          )}

          {/* Chip POI results */}
          {activeChipCat && !placeResults.length && (
            <>
              {chipLoading && (
                <View style={styles.dropdownStatus}>
                  <ActivityIndicator size="small" color={c.primary} />
                  <Text style={[styles.dropdownStatusTxt, { color: c.mutedForeground }]}>
                    Finding nearby {CATEGORIES[activeChipCat].label.toLowerCase()}…
                  </Text>
                </View>
              )}
              {!chipLoading && chipError && (
                <View style={styles.dropdownStatus}>
                  <Ionicons name="cloud-offline-outline" size={18} color={c.mutedForeground} />
                  <Text style={[styles.dropdownStatusTxt, { color: c.mutedForeground }]}>{chipError}</Text>
                </View>
              )}
              {!chipLoading && !chipError && chipResults.length === 0 && (
                <View style={styles.dropdownStatus}>
                  <Ionicons name="search-outline" size={18} color={c.mutedForeground} />
                  <Text style={[styles.dropdownStatusTxt, { color: c.mutedForeground }]}>Nothing found nearby.</Text>
                </View>
              )}
              {!chipLoading && chipResults.length > 0 && (
                <FlatList
                  data={chipResults}
                  keyExtractor={(item) => String(item.id)}
                  style={{ flex: 1 }}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[styles.dropdownRow, { borderColor: c.border }]}
                      activeOpacity={0.72}
                      onPress={() => {
                        setActiveChipCat(null); setChipResults([]); setChipError(null);
                        setNavDestination({ name: item.name, lat: item.lat, lng: item.lng });
                        startNavigation();
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        router.replace("/(tabs)/drive");
                      }}
                    >
                      <View style={[styles.dropdownIcon, { backgroundColor: item.subtypeColor + "20" }]}>
                        <Ionicons
                          name={(MAP_CHIPS.find(ch => ch.cat === activeChipCat)?.icon ?? "location-outline") as any}
                          size={16} color={item.subtypeColor}
                        />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.dropdownName, { color: c.foreground }]} numberOfLines={1}>{item.name}</Text>
                        {!!item.address && (
                          <Text style={[styles.dropdownAddr, { color: c.mutedForeground }]} numberOfLines={1}>{item.address}</Text>
                        )}
                      </View>
                      <View style={[styles.dropdownGoBtn, { backgroundColor: item.subtypeColor }]}>
                        <Ionicons name="navigate" size={10} color="#FFF" />
                        <Text style={styles.dropdownGoBtnTxt}>Go</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                />
              )}
            </>
          )}
        </View>
      )}

      {/* Category chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.chipsScroll, { top: insets.top + 64 }]}
        contentContainerStyle={styles.chipsContent}
      >
        {MAP_CHIPS.map((chip) => {
          const isActive = activeChipCat === chip.cat;
          const catColor = CATEGORIES[chip.cat].color;
          return (
            <TouchableOpacity
              key={chip.cat}
              style={[styles.chip, {
                backgroundColor: isActive ? catColor + "22" : c.card,
                borderWidth: isActive ? 1 : 0,
                borderColor: isActive ? catColor : "transparent",
              }]}
              onPress={() => {
                if (isActive) {
                  // Deselect — clear results
                  setActiveChipCat(null);
                  setChipResults([]);
                  setChipError(null);
                } else {
                  runChipSearch(chip.cat);
                }
              }}
              activeOpacity={0.82}
            >
              {chipLoading && isActive
                ? <ActivityIndicator size="small" color={catColor} style={{ width: 14 }} />
                : <Ionicons name={chip.icon as any} size={14} color={isActive ? catColor : c.foreground} />
              }
              <Text style={[styles.chipTxt, { color: isActive ? catColor : c.foreground }]}>{chip.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {mapPickerActive ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: "#000" }]} />
      ) : (
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
        onPanDrag={() => { mapDriftedRef.current = true; setMapDrifted(true); }}
        onPress={() => {
          // Dismiss keyboard and collapse search results when tapping the map
          Keyboard.dismiss();
          setPlaceFocused(false);
          if (activeChipCat) {
            setActiveChipCat(null);
            setChipResults([]);
            setChipError(null);
          }
        }}
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
          // Community reports always render at full opacity — the behind-driver
          // dimming used for zones computes a degenerate bearing for pins at the
          // driver's own position, instantly fading a just-submitted report.
          return (
            <Marker
              key={clusterKey}
              coordinate={{ latitude: group.lat, longitude: group.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={true}
              zIndex={10}
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

        {/* Focused alert highlight — three animated expanding rings that pulse
            outward for 3 seconds then auto-dismiss. Tapping the centre dot
            also clears the focus immediately. */}
        {focusedAlert && (
          <>
            <Marker
              coordinate={{ latitude: focusedAlert.lat, longitude: focusedAlert.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              zIndex={999}
              tracksViewChanges
              onPress={() => {
                pulseAnimRef.current?.stop();
                if (focusDismissTimer.current) clearTimeout(focusDismissTimer.current);
                setFocusedAlert(null);
              }}
            >
              <View collapsable={false} style={styles.focusMarkerWrap}>
                {/* Ring 1 — largest, slowest to appear */}
                <Animated.View style={[
                  styles.pulseRing,
                  {
                    transform: [{ scale: pulseRing1.interpolate({ inputRange: [0, 1], outputRange: [0.4, 3.2] }) }],
                    opacity:   pulseRing1.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.6, 0] }),
                  },
                ]} />
                {/* Ring 2 */}
                <Animated.View style={[
                  styles.pulseRing,
                  {
                    transform: [{ scale: pulseRing2.interpolate({ inputRange: [0, 1], outputRange: [0.4, 2.6] }) }],
                    opacity:   pulseRing2.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.65, 0] }),
                  },
                ]} />
                {/* Ring 3 — smallest, innermost */}
                <Animated.View style={[
                  styles.pulseRing,
                  {
                    transform: [{ scale: pulseRing3.interpolate({ inputRange: [0, 1], outputRange: [0.4, 2.0] }) }],
                    opacity:   pulseRing3.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.7, 0] }),
                  },
                ]} />
                {/* Static centre dot */}
                <View style={styles.focusRing}>
                  <View style={styles.focusRingInner} />
                </View>
              </View>
            </Marker>
          </>
        )}

        {/* Destination */}
        {activeRoute && activeRoute.coords.length > 0 && (
          <Marker coordinate={activeRoute.coords[activeRoute.coords.length - 1]} anchor={{ x: 0.5, y: 1 }} title="Destination">
            <MarkerIcon ioniconName="navigate" bg="#1565C0" size={36} />
          </Marker>
        )}
      </MapView>
      )}

      {/* Right controls — compass + layers + locate */}
      <View style={[styles.newControls, { bottom: insets.bottom + TAB_H + 20, right: 12 }]}>
        {/* Compass — toggles heading-up mode (road-ahead tracking) */}
        <TouchableOpacity
          style={[styles.newControlBtn, {
            backgroundColor: headingUpMode ? c.primary : c.card,
          }]}
          onPress={() => {
            const next = !headingUpMode;
            setHeadingUpMode(next);
            if (next) {
              // Immediately snap to heading direction
              mapDriftedRef.current = false;
              setMapDrifted(false);
              centerOnUser();
            }
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
          activeOpacity={0.82}
        >
          <Ionicons
            name="compass-outline"
            size={22}
            color={headingUpMode ? "#FFF" : c.foreground}
          />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.newControlBtn, { backgroundColor: c.card }]} onPress={() => setShowTraffic(!showTraffic)}>
          <Ionicons name="layers-outline" size={20} color={showTraffic ? c.primary : c.foreground} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.newControlBtn, { backgroundColor: c.card }]} onPress={centerOnUser}>
          <Ionicons name="locate-outline" size={22} color={c.primary} />
        </TouchableOpacity>
      </View>

      {/* Weather chip — live current conditions for the driver's location */}
      {weather?.tempC != null && (
        <View style={[styles.weatherChip, { backgroundColor: c.card + "E8", bottom: insets.bottom + TAB_H + 20, left: 12 }]}>
          <Ionicons name={weatherIcon(weather.weatherCode) as any} size={18} color="#FFB300" />
          <View style={{ gap: 1 }}>
            <Text style={[styles.weatherTemp, { color: c.foreground }]}>{weather.tempC}°</Text>
            <Text style={[styles.weatherAqi, { color: c.primary }]} numberOfLines={1}>
              {weather.locality ?? weather.description ?? "Nearby"}
            </Text>
          </View>
        </View>
      )}

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
        onOpenMapPicker={(lat, lng, onConfirm) => {
          // Same fix as index.tsx: dismiss ReportModal first so iOS doesn't
          // queue the CrosshairPickerModal presentation behind it.
          setMapPickerActive(true);
          setShowReport(false);
          setTimeout(() => {
            setCrosshairRequest({ lat, lng, onConfirm });
          }, 320);
        }}
      />

      <CrosshairPickerModal
        visible={!!crosshairRequest}
        initialLat={crosshairRequest?.lat ?? -1.2921}
        initialLng={crosshairRequest?.lng ?? 36.8219}
        title="Pin the Incident Spot"
        onCancel={() => {
          setCrosshairRequest(null);
          setShowReport(true);   // restore report form with state intact
        }}
        onConfirm={(lat, lng) => {
          crosshairRequest?.onConfirm(lat, lng);
          setCrosshairRequest(null);
          setShowReport(true);   // restore report form with picked location set
        }}
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

              {/* Bulk sync — writes every DB-relocated zone back into speedZones.ts */}
              {isAdmin && (
                <TouchableOpacity
                  style={ms.adminSyncBtn}
                  onPress={() => {
                    Alert.alert(
                      "Sync All Zones to Static File",
                      "This writes every admin-relocated zone back into speedZones.ts so fresh installs load correct pin positions without an API call. Continue?",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Sync Now",
                          onPress: async () => {
                            try {
                              const { synced, total } = await adminSyncStaticZones();
                              Alert.alert(
                                "Sync Complete",
                                `${synced} of ${total} relocated zone(s) written to speedZones.ts.`
                              );
                            } catch (err: any) {
                              Alert.alert("Sync Failed", err?.message ?? "Check server logs.");
                            }
                          },
                        },
                      ]
                    );
                  }}
                >
                  <Ionicons name="sync-outline" size={14} color="#6A1B9A" />
                  <Text style={[ms.adminBtnTxt, { color: "#6A1B9A" }]}>Sync All Zones → Static File</Text>
                </TouchableOpacity>
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
                          r.status === "admin_review" ? (
                            <View style={ms.pendingReviewBanner}>
                              <Text style={ms.pendingReviewTxt}>⏳ Removal pending admin review</Text>
                            </View>
                          ) : (
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
                          )
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
  focusMarkerWrap: {
    width: 80, height: 80,
    alignItems: "center", justifyContent: "center",
  },
  pulseRing: {
    position: "absolute",
    width: 54, height: 54, borderRadius: 27,
    borderWidth: 2.5, borderColor: "#00C853",
    backgroundColor: "#00C85312",
  },
  focusRing: {
    width: 54, height: 54, borderRadius: 27,
    borderWidth: 3, borderColor: "#00C853",
    backgroundColor: "#00C85318",
    alignItems: "center", justifyContent: "center",
  },
  focusRingInner: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: "#00C853",
    borderWidth: 2, borderColor: "#FFFFFF",
  },
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
  // ── New map UI overlays (overhaul) ────────────────────────────────────────
  searchBar: {
    position: "absolute", left: 12, right: 12,
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18, shadowRadius: 6, elevation: 8,
    zIndex: 20,
  },
  searchBarInput: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", paddingVertical: 0 },
  // ── Inline search results dropdown ────────────────────────────────────────
  searchDropdown: {
    position: "absolute", left: 12, right: 12, zIndex: 21,
    borderRadius: 16, overflow: "hidden",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 12, elevation: 16,
  },
  searchDismissBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
  },
  searchDismissTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  // ── Incident filter button + picker ───────────────────────────────────────
  filterBtn: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: "center", justifyContent: "center",
  },
  filterDot: {
    position: "absolute", top: 2, right: 2,
    width: 8, height: 8, borderRadius: 4, borderWidth: 1.5,
  },
  filterBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.25)" },
  filterSheet: {
    position: "absolute", right: 12, width: 220,
    borderRadius: 14, paddingVertical: 6,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 10, elevation: 12,
  },
  filterTitle: {
    fontSize: 11, fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase", letterSpacing: 0.6,
    paddingHorizontal: 14, paddingTop: 6, paddingBottom: 4,
  },
  filterRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 11,
  },
  filterRowTxt: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  dropdownRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dropdownIcon: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  dropdownName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  dropdownAddr: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  dropdownGoBtn: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 14,
  },
  dropdownGoBtnTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#FFF" },
  dropdownStatus: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 14,
  },
  dropdownStatusTxt: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  chipsScroll: { position: "absolute", left: 0, right: 0, zIndex: 19 },
  chipsContent: { paddingHorizontal: 12, gap: 8 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12, shadowRadius: 3, elevation: 3,
  },
  chipTxt: { fontSize: 13, fontFamily: "Inter_500Medium" },
  newControls: { position: "absolute", flexDirection: "column", gap: 10, zIndex: 15 },
  newControlBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18, shadowRadius: 5, elevation: 5,
  },
  weatherChip: {
    position: "absolute", flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, zIndex: 15,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18, shadowRadius: 5, elevation: 5,
  },
  weatherTemp: { fontSize: 15, fontFamily: "Inter_700Bold", lineHeight: 18 },
  weatherAqi: { fontSize: 10, fontFamily: "Inter_500Medium", lineHeight: 13 },
  reportPillRow: {
    position: "absolute", left: 0, right: 0,
    alignItems: "center", zIndex: 15,
  },
  reportPill: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 24, paddingVertical: 13, borderRadius: 30,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 10,
  },
  reportPillTxt: { fontSize: 15, fontFamily: "Inter_700Bold" },
  exploreSheet: {
    position: "absolute", left: 0, right: 0, zIndex: 12,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.12, shadowRadius: 8, elevation: 12,
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 10 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  sheetHeaderTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  sheetSeeAll: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  nearbyEmpty: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1, borderRadius: 12, padding: 12,
  },
  nearbyEmptyTxt: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  emojiMarker: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: "#FFF",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.28, shadowRadius: 4, elevation: 5,
  },
  emojiMarkerText: { fontSize: 14, lineHeight: 17, fontFamily: EMOJI_FONT_FAMILY },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendEmoji: { fontSize: 16, width: 22, textAlign: "center", fontFamily: EMOJI_FONT_FAMILY },
  legendDot: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  legendText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  // ── Chip result rows in bottom sheet ────────────────────────────────────────
  chipSheetLoader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingVertical: 12, paddingHorizontal: 4 },
  chipSheetMsg: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  chipResultRow: {
    flexDirection: "row" as const, alignItems: "center" as const,
    paddingVertical: 10, gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chipResultIcon: {
    width: 38, height: 38, borderRadius: 10,
    alignItems: "center" as const, justifyContent: "center" as const, flexShrink: 0,
  },
  chipResultName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  chipResultAddr: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  chipResultRight: { alignItems: "flex-end" as const, gap: 4, flexShrink: 0 },
  chipResultDist: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  chipGoBtn: {
    flexDirection: "row" as const, alignItems: "center" as const, gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20,
  },
  chipGoBtnTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#FFF" },
  // Legacy refs kept to avoid TS errors on any surviving references
  findNearbyBtn: { flexDirection: "row" as const },
  findNearbyBtnText: { fontSize: 13, color: "#FFF" },
  reportBtn:     { flexDirection: "row" as const },
  reportBtnText: { fontSize: 14 },
  clusterWrap: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  clusterGrid: { width: 28, height: 28, flexWrap: "wrap", flexDirection: "row", gap: 2, borderRadius: 8, overflow: "hidden" },
  clusterCell: { width: 13, height: 13, alignItems: "center", justifyContent: "center", borderRadius: 3 },
  clusterEmoji: { fontSize: 7, fontFamily: EMOJI_FONT_FAMILY },
  clusterBadge: {
    position: "absolute", bottom: 0, right: 0,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: "#FFF", alignItems: "center", justifyContent: "center",
    paddingHorizontal: 4, borderWidth: 1.5, borderColor: "#00000020",
  },
  clusterBadgeTxt: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#222" },
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
  adminSyncBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1,
    borderColor: "#6A1B9A40", backgroundColor: "#F3E5F520",
    marginTop: 6, alignSelf: "flex-start",
  },
  pendingReviewBanner: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#FFF8E1", borderRadius: 10, borderWidth: 1, borderColor: "#FFD54F",
    paddingHorizontal: 10, paddingVertical: 7,
  },
  pendingReviewTxt: { fontSize: 12, fontWeight: "600", color: "#F57F17" },
  zonePill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  zonePillTxt: { fontSize: 12, fontWeight: "600" },
});
