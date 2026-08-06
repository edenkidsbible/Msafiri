/**
 * Home — the new dashboard tab (UI overhaul, mockup: Home1).
 *
 * Sections, top to bottom, matching the mockup exactly:
 *  · Msafiri header (logo mark + name) with notification bell
 *  · Greeting ("Good morning, {name}! 👋 / Let's drive safe today.") + weather chip
 *  · Big green gradient "Start Driving" card with car artwork → /drive
 *  · Four status tiles: Dashcam · Live Alerts · Driving Score · Trip Sharing
 *  · "Nearby Alerts" horizontal cards (See all → Map tab)
 *  · "Accident Assistant / AI Powered" promo card → Crash Assistant
 *  · "My Last Trip" card (from persisted drive sessions; View all → trips)
 */

import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "@/context/AppContext";
import { useDashcam } from "@/context/DashcamContext";
import { useColors } from "@/hooks/useColors";
import { useWeather, weatherIcon } from "@/hooks/useWeather";
import { resolveIncidentType } from "@/constants/incidentTypes";
import {
  DriveSession,
  listDriveSessions,
  scoreColor,
  scoreLabel,
  formatDuration,
} from "@/utils/driveSessionApi";

// ── Helpers ──────────────────────────────────────────────────────────────────

const EMOJI_FONT_FAMILY = Platform.select({ android: "NotoColorEmoji", default: undefined });

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function distStr(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
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

// ── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    driverName,
    deviceId,
    isSharingTrip,
    nearbyZones,
    communityReports,
    hereIncidents,
    currentLat,
    currentLng,
  } = useApp();
  const { isRecording: dashcamRecording, stopDashcam } = useDashcam();
  const weather = useWeather(currentLat, currentLng);

  const tabBarH = Platform.OS === "web" ? 84 : 96;

  // ── Last trip + latest score from the persisted drive-session system ──────
  const [lastSession, setLastSession] = useState<DriveSession | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (deviceId) {
        listDriveSessions(deviceId, 5)
          .then(({ sessions }) => {
            if (!alive) return;
            const done = sessions.find((s) => s.endedAt != null) ?? sessions[0] ?? null;
            setLastSession(done);
          })
          .catch(() => {});
      }
      return () => { alive = false; };
    }, [deviceId]),
  );

  // ── Nearby alerts within 3 km, closest first ───────────────────────────────
  const nearbyAlerts = useMemo(() => {
    if (currentLat == null || currentLng == null) return [];
    const items: { id: string; type: string; label: string; emoji: string; color: string; distanceM: number; road: string | null; lat: number; lng: number }[] = [];
    for (const z of nearbyZones) {
      if (z.lat == null || z.lng == null) continue;
      const meta = resolveIncidentType(z.type);
      items.push({
        id: `z-${z.id}`, type: z.type, label: meta.label, emoji: meta.emoji,
        color: meta.color, distanceM: z.distance, road: z.road ?? null,
        lat: z.lat, lng: z.lng,
      });
    }
    for (const r of communityReports) {
      const d = haversineM(currentLat, currentLng, r.lat, r.lng);
      if (d > 3000) continue;
      const meta = resolveIncidentType(r.type);
      items.push({
        id: `r-${r.id}`, type: r.type, label: meta.label, emoji: meta.emoji,
        color: meta.color, distanceM: d, road: r.roadName ?? null,
        lat: r.lat, lng: r.lng,
      });
    }
    for (const h of hereIncidents) {
      const d = haversineM(currentLat, currentLng, h.lat, h.lng);
      if (d > 3000) continue;
      const meta = resolveIncidentType(h.type);
      items.push({
        id: `h-${h.id}`, type: h.type, label: meta.label, emoji: meta.emoji,
        color: meta.color, distanceM: d, road: h.roadName ?? null,
        lat: h.lat, lng: h.lng,
      });
    }
    items.sort((a, b) => a.distanceM - b.distanceM);
    return items.slice(0, 10);
  }, [nearbyZones, communityReports, hereIncidents, currentLat, currentLng]);

  const score = lastSession?.score ?? null;

  const startDriving = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    router.push("/(tabs)/drive");
  };

  const hour = new Date().getHours();
  const firstName = driverName ? driverName.split(" ")[0] : "driver";

  // ── Status tiles data ──────────────────────────────────────────────────────
  type Tile = {
    key: string;
    icon: React.ComponentProps<typeof Ionicons>["name"];
    iconColor: string;
    title: string;
    value: string;
    valueColor: string;
    sub?: string;
    ring?: boolean;
    onPress: () => void;
  };
  const tiles: Tile[] = [
    {
      key: "dashcam",
      icon: "videocam-outline" as const,
      iconColor: dashcamRecording ? c.speedDanger : c.primary,
      title: "Dashcam",
      value: dashcamRecording ? "Recording" : Platform.OS === "web" ? "Unavailable" : "Off",
      valueColor: dashcamRecording ? c.speedDanger : c.mutedForeground,
      onPress: () => {
        if (dashcamRecording) {
          Alert.alert(
            "Dashcam — Recording",
            "Your dashcam is actively recording.",
            [
              {
                text: "Stop Recording",
                style: "destructive",
                onPress: () => stopDashcam(),
              },
              { text: "View Clips", onPress: () => router.push("/dashcam-clips") },
              { text: "Dismiss", style: "cancel" },
            ]
          );
        } else {
          Alert.alert(
            "Dashcam is Off",
            "Start driving first, then turn on the Dashcam from the Drive screen.",
            [
              { text: "View Clips", onPress: () => router.push("/dashcam-clips") },
              { text: "Start Driving", style: "default", onPress: () => router.push("/(tabs)/drive") },
              { text: "OK", style: "cancel" },
            ]
          );
        }
      },
    },
    {
      key: "alerts",
      icon: "notifications-outline" as const,
      iconColor: "#FFB300",
      title: "Live Alerts",
      value: `${nearbyAlerts.length} Nearby`,
      valueColor: nearbyAlerts.length > 0 ? c.foreground : c.mutedForeground,
      onPress: () => router.push("/(tabs)/map"),
    },
    {
      key: "score",
      icon: "shield-outline" as const,
      iconColor: score != null ? scoreColor(score) : c.mutedForeground,
      title: "Driving Score",
      value: score != null ? `${score}` : "—",
      valueColor: score != null ? scoreColor(score) : c.mutedForeground,
      sub: score != null ? scoreLabel(score) : "No trips yet",
      ring: true,
      onPress: () => router.push("/(tabs)/garage"),
    },
    {
      key: "sharing",
      icon: "radio-outline" as const,
      iconColor: isSharingTrip ? c.primary : "#8B7CF6",
      title: "Trip Sharing",
      value: isSharingTrip ? "Active" : "Inactive",
      valueColor: isSharingTrip ? c.primary : c.mutedForeground,
      onPress: () => router.push("/trip-sharing"),
    },
  ];

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 10,
          paddingBottom: tabBarH + insets.bottom + 24,
          paddingHorizontal: 16,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header: logo + name · bell ─────────────────────────────────── */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <View style={[styles.logoWrap, { backgroundColor: c.primary }]}>
              <Ionicons name="shield-checkmark" size={18} color={c.isDark ? "#04170B" : "#FFFFFF"} />
            </View>
            <View>
              <Text style={[styles.logoTxt, { color: c.foreground }]}>Msafiri</Text>
              <Text style={[styles.logoTag, { color: c.mutedForeground }]}>
                Smarter Roads. Safer Journeys.
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.bellBtn, { backgroundColor: c.card, borderColor: c.tileBorder }]}
            onPress={() => router.push("/app-settings/notifications" as any)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="notifications-outline" size={20} color={c.foreground} />
            {nearbyAlerts.length > 0 && (
              <View style={[styles.bellDot, { backgroundColor: c.primary, borderColor: c.background }]} />
            )}
          </TouchableOpacity>
        </View>

        {/* ── Greeting + weather chip ────────────────────────────────────── */}
        <View style={styles.greetRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.greetTitle, { color: c.foreground }]} numberOfLines={1}>
              {greetingFor(hour)}, {firstName}! 👋
            </Text>
            <Text style={[styles.greetSub, { color: c.mutedForeground }]}>
              Let's drive safe today.
            </Text>
          </View>
          {weather?.tempC != null && (
            <View style={[styles.weatherChip, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Ionicons name={weatherIcon(weather.weatherCode) as any} size={15} color="#FFB300" />
                <Text style={[styles.weatherTxt, { color: c.foreground }]}>{weather.tempC}°</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <Ionicons name="location-outline" size={11} color={c.primary} />
                <Text style={[styles.weatherCity, { color: c.mutedForeground }]} numberOfLines={1}>
                  {weather.locality ?? weather.description ?? "Nearby"}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* ── Start Driving hero card ────────────────────────────────────── */}
        <Pressable onPress={startDriving} style={({ pressed }) => [pressed && { transform: [{ scale: 0.985 }] }]}>
          <LinearGradient
            colors={[c.heroGradientStart, c.heroGradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroCard}
          >
            <View style={styles.heroArtWrap}>
              <View style={styles.heroArtGlow} />
              <Image
                source={require("@/assets/images/hero-car.png")}
                style={styles.heroCarImg}
                resizeMode="cover"
              />
            </View>
            <View style={{ flex: 1, minWidth: 0, alignItems: "center" }}>
              <Text style={styles.heroTitle}>Start Driving</Text>
              <Text style={styles.heroSub}>Navigate, get alerts{"\n"}and stay protected</Text>
            </View>
            <View style={styles.heroChevron}>
              <Ionicons name="chevron-forward" size={22} color="#0A7C3A" />
            </View>
          </LinearGradient>
        </Pressable>

        {/* ── Status tiles 2×2 ───────────────────────────────────────────── */}
        <View style={styles.tileGrid}>
          {tiles.map((t) => (
            <TouchableOpacity
              key={t.key}
              activeOpacity={0.8}
              onPress={t.onPress}
              style={[styles.tile, { backgroundColor: c.card, borderColor: c.tileBorder }]}
            >
              {t.ring ? (
                <View style={[styles.scoreRing, { borderColor: t.iconColor }]}>
                  <Text style={[styles.scoreRingTxt, { color: c.foreground }]}>{t.value}</Text>
                </View>
              ) : (
                <View style={[styles.tileIcon, { backgroundColor: t.iconColor + "1E" }]}>
                  <Ionicons name={t.icon} size={19} color={t.iconColor} />
                </View>
              )}
              <Text style={[styles.tileTitle, { color: c.foreground }]} numberOfLines={1}>
                {t.title}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                {t.key !== "sharing" || isSharingTrip ? (
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.ring ? t.iconColor : t.valueColor === c.mutedForeground ? c.mutedForeground : t.iconColor }} />
                ) : null}
                <Text style={[styles.tileValue, { color: t.valueColor }]} numberOfLines={1}>
                  {t.ring ? (t.sub ?? t.value) : t.value}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Nearby Alerts ──────────────────────────────────────────────── */}
        <View style={styles.sectionRow}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>Nearby Alerts</Text>
          <TouchableOpacity onPress={() => router.push("/(tabs)/map")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.sectionLink, { color: c.primary }]}>See all</Text>
          </TouchableOpacity>
        </View>
        {nearbyAlerts.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
            <Ionicons name="checkmark-circle-outline" size={20} color={c.primary} />
            <Text style={[styles.emptyTxt, { color: c.mutedForeground }]}>
              {currentLat == null ? "Waiting for GPS…" : "All clear around you"}
            </Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 10, paddingRight: 4 }}
            style={{ marginHorizontal: -16, paddingHorizontal: 16 }}
          >
            {nearbyAlerts.map((a) => (
              <TouchableOpacity
                key={a.id}
                activeOpacity={0.8}
                onPress={() =>
                  router.push({
                    pathname: "/(tabs)/map",
                    params: { focusId: a.id, focusLat: String(a.lat), focusLng: String(a.lng), focusTs: String(Date.now()) },
                  })
                }
                style={[styles.alertCard, { backgroundColor: c.card, borderColor: c.tileBorder }]}
              >
                <View style={[styles.alertIcon, { backgroundColor: a.color + "22" }]}>
                  <Text style={{ fontSize: 18, fontFamily: EMOJI_FONT_FAMILY }}>{a.emoji}</Text>
                </View>
                <Text style={[styles.alertType, { color: c.foreground }]} numberOfLines={1}>
                  {a.label}
                </Text>
                <Text style={[styles.alertDist, { color: a.color }]} numberOfLines={1}>
                  {distStr(a.distanceM)} ahead
                </Text>
                {a.road ? (
                  <Text style={[styles.alertRoad, { color: c.mutedForeground }]} numberOfLines={1}>
                    {a.road}
                  </Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* ── Accident Assistant promo ───────────────────────────────────── */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => router.push("/accident-assistant-info")}
          style={[styles.promoCard, { backgroundColor: c.card, borderColor: c.primary + "44" }]}
        >
          <View style={[styles.promoIcon, { backgroundColor: c.primary + "1E" }]}>
            <Ionicons name="medkit-outline" size={22} color={c.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={[styles.promoTitle, { color: c.foreground }]}>Accident Assistant</Text>
              <View style={[styles.promoBadge, { backgroundColor: c.primary + "22" }]}>
                <Text style={[styles.promoBadgeTxt, { color: c.primary }]}>AI Powered</Text>
              </View>
            </View>
            <Text style={[styles.promoSub, { color: c.mutedForeground }]} numberOfLines={2}>
              We've got your back if the unexpected happens.
            </Text>
            <View style={[styles.promoBtn, { backgroundColor: c.isDark ? "#232926" : c.muted }]}>
              <Text style={[styles.promoBtnTxt, { color: c.foreground }]}>Learn More</Text>
              <Ionicons name="chevron-forward" size={13} color={c.foreground} />
            </View>
          </View>
        </TouchableOpacity>

        {/* ── My Last Trip ───────────────────────────────────────────────── */}
        <View style={styles.sectionRow}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>My Last Trip</Text>
          <TouchableOpacity onPress={() => router.push("/(tabs)/garage")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.sectionLink, { color: c.primary }]}>View all</Text>
          </TouchableOpacity>
        </View>
        {lastSession ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => router.push(`/trip-detail/${lastSession.id}`)}
            style={[styles.tripCard, { backgroundColor: c.card, borderColor: c.tileBorder }]}
          >
            <View style={[styles.tripThumb, { backgroundColor: c.primary + "16" }]}>
              <Ionicons name="map-outline" size={24} color={c.primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.tripDate, { color: c.mutedForeground }]} numberOfLines={1}>
                {tripDateLabel(lastSession.startedAt)}
              </Text>
              {lastSession.score != null ? (
                <View style={styles.tripStatsRow}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: scoreColor(lastSession.score) }} />
                  <Text style={[styles.tripStat, { color: c.foreground }]}>
                    Score {lastSession.score} · {scoreLabel(lastSession.score)}
                  </Text>
                </View>
              ) : (
                <View style={styles.tripStatsRow}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.primary }} />
                  <Text style={[styles.tripStat, { color: c.foreground }]}>Completed trip</Text>
                </View>
              )}
            </View>
            <View style={{ alignItems: "flex-end", gap: 6 }}>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.tripStat, { color: c.foreground }]}>{distStr(lastSession.distanceM)}</Text>
                <Text style={[styles.tripStatLbl, { color: c.mutedForeground }]}>Distance</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.tripStat, { color: c.foreground }]}>
                  {lastSession.durationS != null ? formatDuration(lastSession.durationS) : "—"}
                </Text>
                <Text style={[styles.tripStatLbl, { color: c.mutedForeground }]}>Duration</Text>
              </View>
            </View>
          </TouchableOpacity>
        ) : (
          <View style={[styles.emptyCard, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
            <Ionicons name="car-outline" size={20} color={c.mutedForeground} />
            <Text style={[styles.emptyTxt, { color: c.mutedForeground }]}>
              No trips yet — tap Start Driving to begin.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  logoWrap: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  logoTxt: { fontSize: 19, fontFamily: "Inter_700Bold" },
  logoTag: { fontSize: 10.5, fontFamily: "Inter_400Regular", marginTop: 1 },
  bellBtn: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  bellDot: {
    position: "absolute", top: 8, right: 9,
    width: 9, height: 9, borderRadius: 5, borderWidth: 1.5,
  },

  greetRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 18 },
  greetTitle: { fontSize: 21, fontFamily: "Inter_700Bold" },
  greetSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  weatherChip: {
    alignItems: "center", gap: 2,
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7,
  },
  weatherTxt: { fontSize: 14, fontFamily: "Inter_700Bold" },
  weatherCity: { fontSize: 10.5, fontFamily: "Inter_500Medium" },

  heroCard: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 20, paddingVertical: 26, paddingHorizontal: 18,
    marginTop: 16, overflow: "hidden",
  },
  heroTitle: { fontSize: 23, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  heroSub: {
    fontSize: 12.5, fontFamily: "Inter_500Medium", color: "#FFFFFFCC",
    marginTop: 4, textAlign: "center", lineHeight: 17,
  },
  heroArtWrap: { alignItems: "center", justifyContent: "center", width: 74 },
  heroArtGlow: {
    position: "absolute", width: 74, height: 74, borderRadius: 37,
    backgroundColor: "#FFFFFF1E",
  },
  heroCarImg: { width: 74, height: 74, borderRadius: 37 },
  heroChevron: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: "#FFFFFF",
    alignItems: "center", justifyContent: "center",
  },

  tileGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
  tile: {
    width: "47%", flexGrow: 1, borderRadius: 16, borderWidth: 1,
    paddingVertical: 16, paddingHorizontal: 10,
    alignItems: "center", gap: 8,
  },
  tileIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  tileTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  tileValue: { fontSize: 12, fontFamily: "Inter_500Medium" },
  scoreRing: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 3.5,
    alignItems: "center", justifyContent: "center",
  },
  scoreRingTxt: { fontSize: 15, fontFamily: "Inter_700Bold" },

  sectionRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: 20, marginBottom: 10,
  },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  sectionLink: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  alertCard: {
    width: 140, borderRadius: 16, borderWidth: 1, padding: 12, gap: 6,
  },
  alertIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  alertType: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  alertDist: { fontSize: 12.5, fontFamily: "Inter_700Bold" },
  alertRoad: { fontSize: 11, fontFamily: "Inter_400Regular" },

  emptyCard: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 16, borderWidth: 1, padding: 14,
  },
  emptyTxt: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },

  promoCard: {
    flexDirection: "row", gap: 12, borderRadius: 18, borderWidth: 1.5,
    padding: 14, marginTop: 20,
  },
  promoIcon: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  promoTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  promoBadge: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  promoBadgeTxt: { fontSize: 10, fontFamily: "Inter_700Bold" },
  promoSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3, lineHeight: 17 },
  promoBtn: {
    flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7, marginTop: 9,
  },
  promoBtnTxt: { fontSize: 12.5, fontFamily: "Inter_600SemiBold" },

  tripCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 16, borderWidth: 1, padding: 12,
  },
  tripThumb: { width: 52, height: 52, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  tripDate: { fontSize: 12, fontFamily: "Inter_500Medium" },
  tripStatsRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 5 },
  tripStat: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  tripStatLbl: { fontSize: 10.5, fontFamily: "Inter_400Regular", marginTop: 1 },
});
