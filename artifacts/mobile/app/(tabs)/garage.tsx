import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Circle, Polyline, Path, Rect } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { useSubscription } from "@/hooks/useSubscription";
import {
  DriveSession,
  listDriveSessions,
  scoreColor,
  formatDuration,
} from "@/utils/driveSessionApi";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";
import { getCarImageUrl, getMakeById, getModelById } from "@/data/carModels";
import { API_BASE } from "@/utils/apiClient";
import {
  loadVehicleCareData,
  computeVehicleCareStats,
  VehicleCareStats,
  estimatedOdometerKm,
} from "@/utils/vehicleCare";
export { ErrorBoundary } from "@/components/ErrorBoundary";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getVehicleEmoji(type: string): string {
  switch (type) {
    case "car": return "🚗";
    case "psv": return "🚐";
    case "bus": return "🚌";
    case "truck": return "🚛";
    case "motorcycle": return "🏍️";
    case "tractor": return "🚜";
    default: return "🚗";
  }
}

function tripDateLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === yest.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Vehicle image ─────────────────────────────────────────────────────────────

function VehicleImage({ makeId, modelId, vehicleType }: {
  makeId: string | null; modelId: string | null; vehicleType: string;
}) {
  const [tryDefault, setTryDefault] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const c = useColors();

  const isCustom = !makeId || makeId.startsWith("custom-") ||
    !modelId || modelId.startsWith("custom-");

  if (!makeId || !modelId || failed) {
    return (
      <Text style={{ fontSize: 80, fontFamily: EMOJI_FONT_FAMILY }}>
        {getVehicleEmoji(vehicleType)}
      </Text>
    );
  }

  const uri = tryDefault
    ? `${API_BASE}/car-images/other/default`
    : getCarImageUrl(makeId, modelId);

  return (
    <View style={{ width: 160, height: 120, alignItems: "center", justifyContent: "center" }}>
      {loading && <ActivityIndicator size="small" color={c.primary} style={{ position: "absolute" }} />}
      <Image
        source={{ uri }}
        style={{ width: 160, height: 120 }}
        resizeMode="contain"
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          if (!tryDefault && isCustom) setTryDefault(true);
          else setFailed(true);
        }}
      />
    </View>
  );
}

// ── Circular health ring ──────────────────────────────────────────────────────

function HealthRing({ pct, size = 72, color }: { pct: number; size?: number; color: string }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke="#2A3530" strokeWidth={7} fill="none" />
      <Circle
        cx={size / 2} cy={size / 2} r={r}
        stroke={color} strokeWidth={7} fill="none"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        rotation="-90"
        origin={`${size / 2},${size / 2}`}
      />
    </Svg>
  );
}

// ── Trip map thumbnail ────────────────────────────────────────────────────────

function TripThumb({ color }: { color: string }) {
  // Synthetic route shape – purely decorative
  const points = "8,44 16,36 22,30 30,26 38,20 44,16";
  return (
    <View style={{ width: 56, height: 56, borderRadius: 12, overflow: "hidden", backgroundColor: "#111815" }}>
      <Svg width={56} height={56}>
        {/* Subtle tinted background */}
        <Rect x="0" y="0" width="56" height="56" fill={color} fillOpacity="0.07" />
        {/* Route polyline */}
        <Polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {/* Start dot */}
        <Circle cx="8" cy="44" r="3.5" fill="#EF4444" />
        {/* End dot */}
        <Circle cx="44" cy="16" r="3.5" fill={color} />
      </Svg>
    </View>
  );
}

// ── Gauge icon for overview stats ─────────────────────────────────────────────

function StatIcon({ icon, bg, color }: { icon: string; bg: string; color: string }) {
  return (
    <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name={icon as any} size={18} color={color} />
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function GarageScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const tabBarH = Platform.OS === "web" ? 84 : 96;
  const {
    vehicleType, deviceId, vehicleMakeId, vehicleModelId,
    vehicleCustomMakeName, vehicleCustomModelName,
  } = useApp();

  const [sessions, setSessions] = useState<DriveSession[]>([]);
  const [careStats, setCareStats] = useState<VehicleCareStats | null>(null);
  const [odometerKm, setOdometerKm] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (deviceId) {
        listDriveSessions(deviceId, 50)
          .then(({ sessions: s }) => { if (alive) setSessions(s); })
          .catch(() => {});
      }
      loadVehicleCareData().then(data => {
        if (!alive) return;
        setCareStats(computeVehicleCareStats(data));
        setOdometerKm(estimatedOdometerKm(data));
      });
      return () => { alive = false; };
    }, [deviceId])
  );

  const completed = sessions.filter(s => s.endedAt != null);
  const totalDistKm = completed.reduce((a, s) => a + s.distanceM, 0) / 1000;
  const totalDurS   = completed.reduce((a, s) => a + (s.durationS ?? 0), 0);
  const totalTrips  = completed.length;
  const estSaved    = Math.round(totalDistKm * 8);
  const recentTrips = completed.slice(0, 3);

  const selectedMake  = vehicleMakeId ? getMakeById(vehicleMakeId) : null;
  const selectedModel = (vehicleMakeId && vehicleModelId) ? getModelById(vehicleMakeId, vehicleModelId) : null;
  const vehicleDisplayName =
    selectedMake && selectedModel
      ? `${selectedMake.name} ${selectedModel.name}`
      : vehicleCustomMakeName && vehicleCustomModelName
        ? `${vehicleCustomMakeName} ${vehicleCustomModelName}`
        : "My Vehicle";

  const healthScore = careStats?.healthScore ?? 92;
  const healthLabel = careStats?.healthLabel ?? "Good";
  const healthColor =
    healthScore >= 90 ? "#22DD66"
    : healthScore >= 75 ? "#22DD66"
    : healthScore >= 50 ? "#FFB300"
    : "#E5484D";

  const cardBg     = c.isDark ? "#151917" : c.card;
  const sectionBg  = c.isDark ? "#101310" : "#F4F6F4";
  const borderCol  = c.isDark ? "#242B27" : c.tileBorder;
  const subText    = c.mutedForeground;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: tabBarH + insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Header ── */}
        <View style={[styles.headerRow, { paddingHorizontal: 16 }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.pageTitle, { color: c.foreground }]}>Garage</Text>
            <Text style={[styles.pageSub, { color: subText }]}>
              Your driving hub. Everything about your journeys and your vehicles.
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity
              style={[styles.headerIconBtn, { backgroundColor: cardBg, borderColor: borderCol }]}
              onPress={() => {}}
            >
              <Ionicons name="notifications-outline" size={20} color={c.foreground} />
              {/* Red dot */}
              <View style={styles.notifDot} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.headerIconBtn, { backgroundColor: cardBg, borderColor: borderCol }]}
              onPress={() => router.push("/(tabs)/profile")}
            >
              <Ionicons name="settings-outline" size={20} color={c.foreground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── My Vehicles ── */}
        <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: borderCol }]}>
            {/* Card header */}
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: c.foreground }]}>My Vehicles</Text>
              <TouchableOpacity onPress={() => router.push("/car-picker" as any)}>
                <Text style={[styles.viewAllLink, { color: c.primary }]}>View all</Text>
              </TouchableOpacity>
            </View>

            {/* Vehicle row */}
            <View style={styles.vehicleRow}>
              {/* Left — image */}
              <View style={styles.vehicleImageWrap}>
                <View style={[styles.defaultBadge, { backgroundColor: "#00A84520" }]}>
                  <Ionicons name="star" size={10} color={c.primary} />
                  <Text style={[styles.defaultBadgeTxt, { color: c.primary }]}>Default</Text>
                </View>
                <VehicleImage makeId={vehicleMakeId} modelId={vehicleModelId} vehicleType={vehicleType} />
              </View>

              {/* Middle — info */}
              <View style={styles.vehicleInfo}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Text style={[styles.vehicleName, { color: c.foreground }]} numberOfLines={1}>
                    {vehicleDisplayName}
                  </Text>
                  <View style={styles.primaryBadge}>
                    <Text style={styles.primaryBadgeTxt}>Primary</Text>
                  </View>
                </View>
                <Text style={[styles.vehicleSub, { color: subText }]}>
                  Petrol • Automatic
                </Text>
                <Text style={[styles.vehicleOdoLabel, { color: subText }]}>Estimated Odometer</Text>
                <Text style={[styles.vehicleOdoValue, { color: c.foreground }]}>
                  {odometerKm > 0
                    ? `${odometerKm.toLocaleString(undefined, { maximumFractionDigits: 0 })} km`
                    : "— km"}
                </Text>
                <Text style={[styles.vehicleOdoSub, { color: subText }]}>Updated from your trips</Text>
              </View>

              {/* Right — health ring + chevron */}
              <View style={styles.vehicleHealthWrap}>
                <View style={{ position: "relative", alignItems: "center", justifyContent: "center" }}>
                  <HealthRing pct={healthScore} color={healthColor} />
                  <View style={{ position: "absolute", alignItems: "center" }}>
                    <Text style={[styles.healthPct, { color: c.foreground }]}>{healthScore}%</Text>
                  </View>
                </View>
                <Text style={[styles.healthTitle, { color: subText }]}>Vehicle Health</Text>
                <Text style={[styles.healthLabel, { color: healthColor }]}>{healthLabel}</Text>
                <TouchableOpacity
                  onPress={() => router.push("/vehicle-care" as any)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="chevron-forward" size={18} color={subText} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Pagination dots */}
            <View style={styles.dotRow}>
              <View style={[styles.dot, styles.dotActive, { backgroundColor: c.primary }]} />
              <View style={[styles.dot, { backgroundColor: c.isDark ? "#2A3530" : "#D0D8D4" }]} />
              <View style={[styles.dot, { backgroundColor: c.isDark ? "#2A3530" : "#D0D8D4" }]} />
            </View>
          </View>
        </View>

        {/* ── Garage Overview ── */}
        <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: borderCol }]}>
            <Text style={[styles.sectionTitle, { color: c.foreground, marginBottom: 14 }]}>Garage Overview</Text>
            <View style={styles.overviewGrid}>
              {/* Distance */}
              <View style={styles.overviewTile}>
                <StatIcon icon="navigate-outline" bg="#00A84520" color={c.primary} />
                <Text style={[styles.overviewValue, { color: c.foreground }]} numberOfLines={1}>
                  {totalDistKm >= 1000
                    ? `${(totalDistKm / 1000).toFixed(1)}k`
                    : totalDistKm.toFixed(0)} km
                </Text>
                <Text style={[styles.overviewLabel, { color: subText }]}>Total Distance</Text>
              </View>
              {/* Drive time */}
              <View style={styles.overviewTile}>
                <StatIcon icon="time-outline" bg="#F9731620" color="#F97316" />
                <Text style={[styles.overviewValue, { color: c.foreground }]} numberOfLines={1}>
                  {fmtDuration(totalDurS)}
                </Text>
                <Text style={[styles.overviewLabel, { color: subText }]}>Total Drive Time</Text>
              </View>
              {/* Trips */}
              <View style={styles.overviewTile}>
                <StatIcon icon="git-network-outline" bg="#A855F720" color="#A855F7" />
                <Text style={[styles.overviewValue, { color: c.foreground }]}>{totalTrips}</Text>
                <Text style={[styles.overviewLabel, { color: subText }]}>Total Trips</Text>
              </View>
              {/* Est. saved */}
              <View style={styles.overviewTile}>
                <StatIcon icon="color-fill-outline" bg="#22DD6620" color={c.primary} />
                <Text style={[styles.overviewValue, { color: c.foreground }]} numberOfLines={1}>
                  KSh {estSaved.toLocaleString()}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <Text style={[styles.overviewLabel, { color: subText }]}>Est. Saved</Text>
                  <Ionicons name="information-circle-outline" size={12} color={subText} />
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* ── Garage Tools ── */}
        <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: borderCol }]}>
            <Text style={[styles.sectionTitle, { color: c.foreground, marginBottom: 14 }]}>Garage Tools</Text>
            <View style={styles.toolsRow}>
              {TOOLS.map(tool => (
                <TouchableOpacity
                  key={tool.key}
                  style={[styles.toolTile, { backgroundColor: c.isDark ? "#1A2020" : "#F4F6F4" }]}
                  onPress={() => router.push(tool.href as any)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.toolIconWrap, { backgroundColor: tool.bg }]}>
                    <Ionicons name={tool.icon as any} size={22} color={tool.color} />
                  </View>
                  <Text style={[styles.toolLabel, { color: c.foreground }]} numberOfLines={2}>
                    {tool.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* ── Vehicle Care banner ── */}
        <View style={{ marginHorizontal: 16, marginBottom: 8 }}>
          <LinearGradient
            colors={c.isDark ? ["#0F1F15", "#0B1A10"] : ["#EAF7EE", "#D4F0DC"]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={[styles.careBanner, { borderColor: c.primary + "30" }]}
          >
            {/* Heart pulse icon */}
            <View style={[styles.careIconWrap, { backgroundColor: c.primary + "25" }]}>
              <Ionicons name="heart-outline" size={24} color={c.primary} />
            </View>
            {/* Text */}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.careBannerText, { color: c.foreground }]}>
                Track maintenance, get reminders{"\n"}and keep your vehicle in top shape.
              </Text>
            </View>
            {/* Open button + clipboard icon */}
            <View style={{ alignItems: "flex-end", gap: 6 }}>
              <TouchableOpacity
                style={[styles.openCareBtn, { backgroundColor: c.primary }]}
                onPress={() => router.push("/vehicle-care" as any)}
                activeOpacity={0.85}
              >
                <Text style={styles.openCareBtnTxt}>Open Vehicle Care</Text>
              </TouchableOpacity>
              <Ionicons name="clipboard-outline" size={22} color={c.primary + "80"} />
            </View>
          </LinearGradient>
        </View>

        {/* Vehicle Care mini-stats */}
        <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: borderCol, paddingVertical: 12 }]}>
            <View style={styles.careStatsRow}>
              <View style={[styles.careStatTile, { borderRightWidth: 1, borderRightColor: borderCol }]}>
                <Text style={[styles.careStatValue, { color: c.foreground }]}>
                  {careStats?.upcoming30Days ?? "—"}
                </Text>
                <Text style={[styles.careStatTitle, { color: subText }]}>Upcoming</Text>
                <Text style={[styles.careStatSub, { color: subText }]}>Next 30 days</Text>
              </View>
              <View style={[styles.careStatTile, { borderRightWidth: 1, borderRightColor: borderCol }]}>
                <Text style={[styles.careStatValue, { color: careStats?.overdue ? "#FFB300" : c.foreground }]}>
                  {careStats?.overdue ?? "—"}
                </Text>
                <Text style={[styles.careStatTitle, { color: careStats?.overdue ? "#FFB300" : subText }]}>
                  {(careStats?.overdue ?? 0) > 0 ? "Overdue" : "Overdue"}
                </Text>
                <Text style={[styles.careStatSub, { color: careStats?.overdue ? "#FFB300" : subText }]}>
                  {(careStats?.overdue ?? 0) > 0 ? "Needs attention" : "All good"}
                </Text>
              </View>
              <View style={[styles.careStatTile, { borderRightWidth: 1, borderRightColor: borderCol }]}>
                <Text style={[styles.careStatValue, { color: c.foreground }]}>
                  {careStats?.completedThisYear ?? "—"}
                </Text>
                <Text style={[styles.careStatTitle, { color: subText }]}>Completed</Text>
                <Text style={[styles.careStatSub, { color: subText }]}>This year</Text>
              </View>
              <View style={styles.careStatTile}>
                <Text style={[styles.careStatValue, { color: c.foreground, fontSize: 13 }]} numberOfLines={1}>
                  {careStats?.spentLast12MonthsKSh
                    ? `KSh ${careStats.spentLast12MonthsKSh.toLocaleString()}`
                    : "—"}
                </Text>
                <Text style={[styles.careStatTitle, { color: subText }]}>Spent</Text>
                <Text style={[styles.careStatSub, { color: subText }]}>Last 12 months</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ── Recent Trips ── */}
        <View style={{ marginHorizontal: 16 }}>
          <View style={[styles.sectionHeaderRow, { marginBottom: 12 }]}>
            <Text style={[styles.sectionTitle, { color: c.foreground }]}>Recent Trips</Text>
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/trips" as any)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.viewAllLink, { color: c.primary }]}>View all</Text>
            </TouchableOpacity>
          </View>

          <View style={{ gap: 10 }}>
            {recentTrips.length === 0 ? (
              <View style={[styles.card, { backgroundColor: cardBg, borderColor: borderCol, flexDirection: "row", alignItems: "center", gap: 10 }]}>
                <Ionicons name="car-outline" size={20} color={subText} />
                <Text style={[styles.emptyTxt, { color: subText }]}>No trips recorded yet</Text>
              </View>
            ) : (
              recentTrips.map((t, idx) => (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.tripRow, { backgroundColor: cardBg, borderColor: borderCol }]}
                  onPress={() => router.push("/(tabs)/trips" as any)}
                  activeOpacity={0.8}
                >
                  <TripThumb color={c.primary} />
                  <View style={{ flex: 1, minWidth: 0, justifyContent: "center" }}>
                    <Text style={[styles.tripDate, { color: subText }]} numberOfLines={1}>
                      {tripDateLabel(t.startedAt)}
                    </Text>
                    <Text style={[styles.tripRoute, { color: c.foreground }]} numberOfLines={1}>
                      Nairobi → CBD
                    </Text>
                    <Text style={[styles.tripStats, { color: subText }]} numberOfLines={1}>
                      {t.distanceM >= 1000
                        ? `${(t.distanceM / 1000).toFixed(1)} km`
                        : `${Math.round(t.distanceM)} m`}
                      {" · "}{t.durationS ? fmtDuration(t.durationS) : "—"}
                      {t.avgSpeedKmh ? ` · Avg ${Math.round(t.avgSpeedKmh)} km/h` : ""}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    {t.score != null && (
                      <View style={[styles.scoreRing, { borderColor: scoreColor(t.score) }]}>
                        <Text style={[styles.scoreRingTxt, { color: c.foreground }]}>{t.score}</Text>
                      </View>
                    )}
                    <Ionicons name="chevron-forward" size={16} color={subText} />
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        </View>

      </ScrollView>
    </View>
  );
}

// ── Tool buttons ──────────────────────────────────────────────────────────────

const TOOLS = [
  { key: "history",   icon: "map-outline",              label: "Trip\nHistory",       color: "#3B82F6", bg: "#3B82F620", href: "/(tabs)/trips" },
  { key: "dashcam",  icon: "videocam-outline",          label: "Dashcam\nVideos",     color: "#EF4444", bg: "#EF444420", href: "/dashcam-clips" },
  { key: "insurance",icon: "shield-checkmark-outline",  label: "Insurance\nAssistant",color: "#A855F7", bg: "#A855F720", href: "/crash-vault" },
  { key: "accident", icon: "car-sport-outline",         label: "Accident\nReports",   color: "#EF4444", bg: "#EF444420", href: "/crash-vault" },
  { key: "stats",    icon: "bar-chart-outline",         label: "Driving\nStatistics", color: "#F97316", bg: "#F9731620", href: "/(tabs)/trips" },
];

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 },
  pageTitle: { fontSize: 28, fontFamily: "Inter_700Bold" },
  pageSub:   { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3, lineHeight: 18 },
  headerIconBtn: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  notifDot: {
    position: "absolute", top: 7, right: 7,
    width: 8, height: 8, borderRadius: 4, backgroundColor: "#EF4444",
  },

  card: {
    borderRadius: 18, borderWidth: 1, padding: 16,
  },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle:     { fontSize: 17, fontFamily: "Inter_700Bold" },
  viewAllLink:      { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  // My Vehicles
  vehicleRow: { flexDirection: "row", alignItems: "center", marginTop: 12, gap: 8 },
  vehicleImageWrap: { width: 160, alignItems: "center", justifyContent: "flex-end", paddingBottom: 4 },
  defaultBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20,
    alignSelf: "flex-start", marginBottom: 6,
  },
  defaultBadgeTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  vehicleInfo: { flex: 1, minWidth: 0, gap: 2 },
  vehicleName: { fontSize: 15, fontFamily: "Inter_700Bold", flexShrink: 1 },
  primaryBadge: {
    backgroundColor: "#3B82F620", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6,
  },
  primaryBadgeTxt: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#3B82F6" },
  vehicleSub:      { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  vehicleOdoLabel: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 6 },
  vehicleOdoValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  vehicleOdoSub:   { fontSize: 11, fontFamily: "Inter_400Regular" },

  vehicleHealthWrap: { width: 80, alignItems: "center", gap: 3 },
  healthPct:   { fontSize: 15, fontFamily: "Inter_700Bold" },
  healthTitle: { fontSize: 10, fontFamily: "Inter_500Medium", textAlign: "center" },
  healthLabel: { fontSize: 11, fontFamily: "Inter_700Bold" },

  dotRow: { flexDirection: "row", justifyContent: "center", gap: 5, marginTop: 12 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotActive: { width: 18 },

  // Overview
  overviewGrid: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  overviewTile: { width: "45%", gap: 6 },
  overviewValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  overviewLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },

  // Tools
  toolsRow: { flexDirection: "row", justifyContent: "space-between", gap: 6 },
  toolTile: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingVertical: 10, borderRadius: 12, gap: 8,
  },
  toolIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  toolLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", textAlign: "center", lineHeight: 14 },

  // Vehicle Care banner
  careBanner: {
    borderRadius: 16, borderWidth: 1, padding: 14,
    flexDirection: "row", alignItems: "center", gap: 10,
  },
  careIconWrap: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  careBannerText: { fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 18 },
  openCareBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  openCareBtnTxt: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },

  // Care mini-stats
  careStatsRow: { flexDirection: "row" },
  careStatTile: { flex: 1, alignItems: "center", paddingVertical: 4 },
  careStatValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  careStatTitle: { fontSize: 10, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  careStatSub:   { fontSize: 9,  fontFamily: "Inter_400Regular", textAlign: "center" },

  // Recent Trips
  tripRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 16, borderWidth: 1, padding: 12,
  },
  tripDate:  { fontSize: 11, fontFamily: "Inter_500Medium", marginBottom: 2 },
  tripRoute: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  tripStats: { fontSize: 11, fontFamily: "Inter_400Regular" },
  scoreRing: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 2.5,
    alignItems: "center", justifyContent: "center",
  },
  scoreRingTxt: { fontSize: 13, fontFamily: "Inter_700Bold" },

  emptyTxt: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
});
