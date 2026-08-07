import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { useSubscription } from "@/hooks/useSubscription";
import { DriveSession, listDriveSessions, scoreColor, scoreLabel, formatDuration } from "@/utils/driveSessionApi";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";
import { useDriveScore } from "@/hooks/useDriveScore";
import { getCarImageUrl, getMakeById, getModelById } from "@/data/carModels";
export { ErrorBoundary } from "@/components/ErrorBoundary";

const QUICK_LINKS = [
  { key: "history", icon: "map-outline" as const, color: "#3B82F6", label: "Trip History", href: "/(tabs)/trips" },
  { key: "dashcam", icon: "videocam-outline" as const, color: "#EF4444", label: "Dashcam Videos", href: "/dashcam-clips" },
  { key: "accident", icon: "shield-half-outline" as const, color: "#EF4444", label: "Accident Reports", href: "/crash-vault" },
  { key: "insurance", icon: "shield-checkmark-outline" as const, color: "#8B5CF6", label: "Insurance Assistant", href: "/crash-vault" },
  { key: "stats", icon: "bar-chart-outline" as const, color: "#F97316", label: "Driving Statistics", href: "/(tabs)/trips" },
];

function getVehicleLabel(type: string): string {
  switch (type) {
    case "car": return "Private Car";
    case "psv": return "Matatu";
    case "bus": return "Bus";
    case "truck": return "Truck";
    case "motorcycle": return "Motorcycle";
    case "tractor": return "Tractor";
    default: return "Vehicle";
  }
}

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
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  if (d.toDateString() === yest.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

/** Car image in the My Vehicle card — transparent PNG from R2, falls back to emoji.
 *  Rendered large; the parent positions it to pop out of the card's boundaries. */
function VehicleImage({ makeId, modelId, vehicleType }: { makeId: string | null; modelId: string | null; vehicleType: string }) {
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const c = useColors();

  if (!makeId || !modelId || failed) {
    return (
      <Text style={{ fontSize: 90, fontFamily: EMOJI_FONT_FAMILY, textShadowColor: "rgba(0,0,0,0.18)", textShadowOffset: { width: 0, height: 6 }, textShadowRadius: 10 }}>
        {getVehicleEmoji(vehicleType)}
      </Text>
    );
  }

  return (
    <View style={styles.vehicleImgWrap}>
      {loading && <ActivityIndicator size="small" color={c.primary} style={{ position: "absolute" }} />}
      <Image
        source={{ uri: getCarImageUrl(makeId, modelId) }}
        style={styles.vehicleImg}
        resizeMode="contain"
        onLoad={() => setLoading(false)}
        onError={() => { setFailed(true); setLoading(false); }}
      />
    </View>
  );
}

export default function GarageScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const tabBarH = Platform.OS === "web" ? 84 : 96;
  const { vehicleType, deviceId, vehicleMakeId, vehicleModelId } = useApp();


  // Load drive sessions
  const [sessions, setSessions] = useState<DriveSession[]>([]);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (deviceId) {
        listDriveSessions(deviceId, 50)
          .then(({ sessions }) => {
            if (alive) setSessions(sessions);
          })
          .catch(() => {});
      }
      return () => { alive = false; };
    }, [deviceId])
  );

  // Compute stats
  const completedSessions = sessions.filter(s => s.endedAt != null);
  const totalDistanceM = completedSessions.reduce((acc, s) => acc + s.distanceM, 0);
  const totalDistanceKm = totalDistanceM / 1000;
  const totalDurationS = completedSessions.reduce((acc, s) => acc + (s.durationS || 0), 0);
  const totalTrips = completedSessions.length;
  const estSaved = (totalDistanceKm * 8).toFixed(0);
  
  const lastSessionScore = completedSessions[0]?.score ?? 100;
  const sColor = scoreColor(lastSessionScore);

  const recentTrips = completedSessions.slice(0, 3);

  // Resolve selected make/model display names
  const selectedMake = vehicleMakeId ? getMakeById(vehicleMakeId) : null;
  const selectedModel = (vehicleMakeId && vehicleModelId) ? getModelById(vehicleMakeId, vehicleModelId) : null;
  const vehicleDisplayName = selectedMake && selectedModel
    ? `${selectedMake.name} ${selectedModel.name}`
    : getVehicleLabel(vehicleType);

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={{
        paddingTop: insets.top + 14,
        paddingBottom: tabBarH + insets.bottom + 24,
      }} showsVerticalScrollIndicator={false}>
        
        {/* Header */}
        <View style={[styles.headerRow, { paddingHorizontal: 16 }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.title, { color: c.foreground }]}>Garage</Text>
            <Text style={[styles.sub, { color: c.mutedForeground }]}>
              Your driving hub. Everything about your journeys.
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: c.card, borderColor: c.tileBorder }]}
            onPress={() => router.push("/(tabs)/profile")}
          >
            <Ionicons name="settings-outline" size={20} color={c.foreground} />
          </TouchableOpacity>
        </View>

        {/* Driving Score Card */}
        <View style={[styles.scoreCard, { backgroundColor: c.card, borderColor: c.tileBorder, marginHorizontal: 16 }]}>
          <View style={styles.scoreLeft}>
            <View style={[styles.scoreRing, { borderColor: sColor }]}>
              <Text style={[styles.scoreNum, { color: c.foreground }]}>{lastSessionScore}</Text>
            </View>
            <Text style={[styles.scoreLabel, { color: sColor }]}>{scoreLabel(lastSessionScore)}</Text>
            <Text style={[styles.scoreKeepUp, { color: c.primary }]}>Keep it up! ↗</Text>
          </View>
          <View style={styles.scoreRight}>
            <View style={styles.statGrid}>
              <View style={styles.statTile}>
                <View style={[styles.statIcon, { backgroundColor: "#3B82F622" }]}>
                  <Ionicons name="map-outline" size={16} color="#3B82F6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.statValue, { color: c.foreground }]} numberOfLines={1}>
                    {totalDistanceKm >= 1000 ? totalDistanceKm.toLocaleString(undefined, {maximumFractionDigits: 0}) : totalDistanceKm.toFixed(1)} km
                  </Text>
                  <Text style={[styles.statTitle, { color: c.mutedForeground }]} numberOfLines={1}>Total Distance</Text>
                </View>
              </View>
              <View style={styles.statTile}>
                <View style={[styles.statIcon, { backgroundColor: "#F9731622" }]}>
                  <Ionicons name="time-outline" size={16} color="#F97316" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.statValue, { color: c.foreground }]} numberOfLines={1}>
                    {formatDuration(totalDurationS)}
                  </Text>
                  <Text style={[styles.statTitle, { color: c.mutedForeground }]} numberOfLines={1}>Total Drive Time</Text>
                </View>
              </View>
              <View style={styles.statTile}>
                <View style={[styles.statIcon, { backgroundColor: "#A855F722" }]}>
                  <Ionicons name="git-network-outline" size={16} color="#A855F7" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.statValue, { color: c.foreground }]} numberOfLines={1}>
                    {totalTrips}
                  </Text>
                  <Text style={[styles.statTitle, { color: c.mutedForeground }]} numberOfLines={1}>Total Trips</Text>
                </View>
              </View>
              <View style={styles.statTile}>
                <View style={[styles.statIcon, { backgroundColor: c.primary + "22" }]}>
                  <Ionicons name="color-fill-outline" size={16} color={c.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.statValue, { color: c.foreground }]} numberOfLines={1}>
                    KSh {Number(estSaved).toLocaleString()}
                  </Text>
                  <Text style={[styles.statTitle, { color: c.mutedForeground }]} numberOfLines={1}>Est. Saved</Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* My Vehicle Card — outer wrapper is the positioning context for the pop-out car */}
        <View style={[styles.vehicleCardOuter, { marginHorizontal: 16 }]}>
          <View style={[styles.vehicleCard, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
            <Text style={[styles.sectionTitle, { color: c.foreground }]}>My Vehicle</Text>
            <View style={styles.vehicleContent}>
              <View style={styles.vehicleLeft}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Text style={[styles.vehicleLabel, { color: c.foreground }]} numberOfLines={1}>
                    {vehicleDisplayName}
                  </Text>
                  <View style={[styles.primaryBadge, { backgroundColor: c.primary + "22" }]}>
                    <Text style={[styles.primaryBadgeTxt, { color: c.primary }]}>Primary</Text>
                  </View>
                </View>

                {!vehicleMakeId && (
                  /* Prompt to pick a car */
                  <TouchableOpacity
                    style={[styles.selectCarBtn, { backgroundColor: c.primary }]}
                    onPress={() => router.push("/car-picker" as any)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="car-outline" size={14} color="#fff" />
                    <Text style={styles.selectCarBtnTxt}>Select your car</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[styles.outlineBtn, { borderColor: c.border }]}
                  onPress={() => router.push("/car-picker" as any)}
                >
                  <Text style={[styles.outlineBtnTxt, { color: c.foreground }]}>
                    {vehicleMakeId ? "Change Car >" : "Vehicle Details >"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Car image — absolutely positioned so it bleeds above and below the card */}
          <View style={styles.vehicleImagePop} pointerEvents="none">
            <VehicleImage makeId={vehicleMakeId} modelId={vehicleModelId} vehicleType={vehicleType} />
          </View>
        </View>

        {/* Quick Access */}
        <View style={styles.quickAccessSection}>
          <Text style={[styles.sectionTitle, { color: c.foreground, marginHorizontal: 16 }]}>Quick Access</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingVertical: 12 }}
          >
            {QUICK_LINKS.map(l => (
              <TouchableOpacity
                key={l.key}
                style={[styles.quickCard, { backgroundColor: c.card, borderColor: c.tileBorder }]}
                onPress={() => router.push(l.href as any)}
              >
                <View style={[styles.quickIcon, { backgroundColor: l.color + "22" }]}>
                  <Ionicons name={l.icon} size={24} color={l.color} />
                </View>
                <Text style={[styles.quickLabel, { color: c.foreground }]} numberOfLines={2}>
                  {l.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Recent Trips */}
        <View style={{ marginHorizontal: 16 }}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: c.foreground }]}>Recent Trips</Text>
            <TouchableOpacity onPress={() => router.push("/(tabs)/trips")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.sectionLink, { color: c.primary }]}>View all {">"}</Text>
            </TouchableOpacity>
          </View>
          
          <View style={{ gap: 10, marginTop: 12 }}>
            {recentTrips.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
                <Ionicons name="car-outline" size={20} color={c.mutedForeground} />
                <Text style={[styles.emptyTxt, { color: c.mutedForeground }]}>No trips recorded yet</Text>
              </View>
            ) : (
              recentTrips.map(t => (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.recentTripRow, { backgroundColor: c.card, borderColor: c.tileBorder }]}
                  onPress={() => router.push("/(tabs)/trips")}
                >
                  <View style={[styles.mapThumb, { backgroundColor: c.primary + "16" }]}>
                     {/* Suggestive route line */}
                     <View style={{ width: 24, height: 3, backgroundColor: c.primary, transform: [{rotate: '-45deg'}], borderRadius: 2 }} />
                     <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.primary, position: 'absolute', top: 8, right: 8 }} />
                     <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.primary, position: 'absolute', bottom: 8, left: 8 }} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
                    <Text style={[styles.recentTripDate, { color: c.mutedForeground }]} numberOfLines={1}>
                      {tripDateLabel(t.startedAt)}
                    </Text>
                    <Text style={[styles.recentTripRoute, { color: c.foreground }]} numberOfLines={1}>
                      Nairobi → CBD
                    </Text>
                    <Text style={[styles.recentTripStats, { color: c.mutedForeground }]} numberOfLines={1}>
                      {t.distanceM >= 1000 ? (t.distanceM/1000).toFixed(1) + " km" : Math.round(t.distanceM) + " m"} · {t.durationS ? formatDuration(t.durationS) : "—"} · {t.avgSpeedKmh ? Math.round(t.avgSpeedKmh) : 0} km/h
                    </Text>
                  </View>
                  <View style={styles.recentTripRight}>
                    {t.score != null ? (
                      <View style={[styles.smallScoreRing, { borderColor: scoreColor(t.score) }]}>
                        <Text style={[styles.smallScoreTxt, { color: c.foreground }]}>{t.score}</Text>
                      </View>
                    ) : null}
                    <Ionicons name="chevron-forward" size={16} color={c.mutedForeground} />
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        </View>

        {/* Driving Course Promo */}
        <TouchableOpacity
          style={[styles.courseBanner, { backgroundColor: c.isDark ? "#0A1F2E" : "#EAF3FB", borderColor: "#3B82F644" }]}
          onPress={() => router.push("/(tabs)/learn" as any)}
          activeOpacity={0.82}
        >
          <View style={[styles.courseIconWrap, { backgroundColor: "#3B82F622" }]}>
            <Ionicons name="school-outline" size={24} color="#3B82F6" />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.courseTitle, { color: c.foreground }]}>Kenya Driving Course</Text>
            <Text style={[styles.courseSub, { color: c.mutedForeground }]}>
              Master road rules, signs & safe driving habits. Included with your plan.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#3B82F6" />
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 3 },
  iconBtn: {
    width: 42, height: 42, borderRadius: 21, borderWidth: 1,
    alignItems: "center", justifyContent: "center"
  },

  scoreCard: {
    flexDirection: "row", borderRadius: 20, borderWidth: 1, padding: 18,
    alignItems: "center", marginBottom: 20,
  },
  scoreLeft: { width: 110, alignItems: "center", justifyContent: "center" },
  scoreRing: {
    width: 86, height: 86, borderRadius: 43, borderWidth: 7,
    alignItems: "center", justifyContent: "center", marginBottom: 8,
  },
  scoreNum: { fontSize: 32, fontFamily: "Inter_700Bold" },
  scoreLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 4 },

  scoreKeepUp: { fontSize: 11, fontFamily: "Inter_500Medium" },
  
  scoreRight: { flex: 1, marginLeft: 12 },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  statTile: { width: "47%", flexDirection: "row", alignItems: "center", gap: 8 },
  statIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  statValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  statTitle: { fontSize: 11, fontFamily: "Inter_500Medium" },

  // Outer wrapper is the positioning context; bottom margin accounts for image bleed
  vehicleCardOuter: {
    position: "relative",
    marginBottom: 36,
  },
  vehicleCard: {
    borderRadius: 20, borderWidth: 1,
    paddingTop: 18, paddingBottom: 18, paddingLeft: 18,
    // Reserve ~half the card for the pop-out car image; text lives in the left half
    paddingRight: 176,
  },
  // Car image sits absolutely to the right, bleeding above and below the card
  vehicleImagePop: {
    position: "absolute",
    right: -14,
    top: -26,
    bottom: -26,
    width: 204,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  vehicleImgWrap: {
    // Fill the full bleed height so contain-mode uses all available vertical space
    width: 204,
    flex: 1,
    alignSelf: "stretch",
    alignItems: "center", justifyContent: "center",
    // Drop shadow gives the 3-D lift
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 10,
  },
  vehicleImg: {
    width: 204,
    // Tall enough that contain-mode fills a big chunk of the card height
    height: 200,
  },

  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  vehicleContent: { marginTop: 14 },
  vehicleLeft: { alignItems: "flex-start", gap: 10 },
  vehicleLabel: { fontSize: 17, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  primaryBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  primaryBadgeTxt: { fontSize: 11, fontFamily: "Inter_700Bold" },
  selectCarBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
  },
  selectCarBtnTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  outlineBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, marginTop: 4
  },
  outlineBtnTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  quickAccessSection: { marginBottom: 20 },
  quickCard: {
    width: 100, height: 110, borderRadius: 16, borderWidth: 1,
    alignItems: "center", justifyContent: "center", padding: 12,
  },
  quickIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  quickLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", textAlign: "center", lineHeight: 16 },

  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionLink: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  
  recentTripRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 16, borderWidth: 1, padding: 12,
  },
  mapThumb: { width: 56, height: 56, borderRadius: 12, alignItems: "center", justifyContent: "center", overflow: 'hidden' },
  recentTripDate: { fontSize: 11, fontFamily: "Inter_500Medium", marginBottom: 2 },
  recentTripRoute: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  recentTripStats: { fontSize: 12, fontFamily: "Inter_400Regular" },
  recentTripRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  smallScoreRing: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  smallScoreTxt: { fontSize: 12, fontFamily: "Inter_700Bold" },

  emptyCard: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 16, borderWidth: 1, padding: 14,
  },
  emptyTxt: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },

  courseBanner: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 16, borderWidth: 1, padding: 16,
    marginHorizontal: 16, marginTop: 24,
  },
  courseIconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  courseTitle: { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 2 },
  courseSub: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
});
