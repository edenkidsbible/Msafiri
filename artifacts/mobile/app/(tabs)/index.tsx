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
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const COURSE_DISCLAIMER_KEY = "course_disclaimer_agreed";
import { useApp } from "@/context/AppContext";
import { useLiveLocation } from "@/context/LocationContext";
import { useDashcam } from "@/context/DashcamContext";
import { useColors } from "@/hooks/useColors";
import { useWeather, weatherIcon } from "@/hooks/useWeather";
import { resolveIncidentType } from "@/constants/incidentTypes";
import { DefaultVehicleImage } from "@/components/DefaultVehicleImage";
import { HeroCarousel } from "@/components/HeroCarousel";
import {
  DriveSession,
  listDriveSessions,
  scoreColor,
  scoreLabel,
  formatDuration,
} from "@/utils/driveSessionApi";
import {
  TripLocation,
  TripLocationMap,
  loadTripLocationCache,
  saveTripLocation,
} from "@/utils/tripLocationCache";
import { reverseGeocode } from "@/utils/geocoding";
import { useVehicle } from "@/context/VehicleContext";
import { QUICK_START_KEY } from "@/app/pretrip-check";
import { getLinkedEmail } from "@/utils/backupSync";

const EMAIL_LINK_BANNER_DISMISSED_KEY = "emailLinkBannerDismissedAt";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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

function tripLabel(
  s: { startedAt: string; distanceM: number },
  loc?: TripLocation | null,
): string {
  if (loc?.from) {
    const from = loc.from;
    const to   = loc.to && loc.to !== loc.from ? loc.to : null;
    return to ? `${from} → ${to}` : from;
  }
  const h = new Date(s.startedAt).getHours();
  const tod = h < 5 ? "Night" : h < 12 ? "Morning" : h < 17 ? "Afternoon" : h < 21 ? "Evening" : "Night";
  return `${tod} drive`;
}

function tripMetaLine(s: { distanceM: number; durationS: number | null; avgSpeedKmh: number | null }): string {
  const parts: string[] = [distStr(s.distanceM)];
  if (s.durationS != null) parts.push(formatDuration(s.durationS));
  if (s.avgSpeedKmh != null) parts.push(`Avg ${Math.round(s.avgSpeedKmh)} km/h`);
  return parts.join(" · ");
}

function distStr(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function greetingFor(hour: number): string {
  if (hour < 5)  return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 20) return "Good evening";
  return "Good night";
}

const EAT = "Africa/Nairobi";

function tripDateLabel(iso: string): string {
  const d   = new Date(iso);
  const now = new Date();
  const eatDate = (dt: Date) => dt.toLocaleDateString("en-KE", { timeZone: EAT, year: "numeric", month: "2-digit", day: "2-digit" });
  const sameDay = eatDate(d) === eatDate(now);
  const yest    = new Date(now.getTime() - 86_400_000);
  const time    = d.toLocaleTimeString("en-KE", { hour: "numeric", minute: "2-digit", timeZone: EAT });
  if (sameDay) return `Today, ${time}`;
  if (eatDate(d) === eatDate(yest)) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString("en-KE", { month: "short", day: "numeric", timeZone: EAT })}, ${time}`;
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
    themeOverride,
    setThemeOverride,
    navTripActive,
    navTripPaused,
    profilePhotoUri,
    isOffline,
    lastAlertDataSyncedAt,
  } = useApp();
  const { currentLat, currentLng } = useLiveLocation();
  const { activeVehicle, activeVehicleId } = useVehicle();

  // Increments each time the Home tab gains focus so DefaultVehicleImage
  // re-reads loadVehicles() and shows any vehicle the user just changed.
  const [heroRefreshKey, setHeroRefreshKey] = useState(0);

  const { isRecording: dashcamRecording, stopDashcam, requestDashcamPermissions } = useDashcam();
  const weather = useWeather(currentLat, currentLng);

  const tabBarH = Platform.OS === "web" ? 84 : 96;

  // ── Last trip + latest score from the persisted drive-session system ──────
  // Scoped to the active vehicle so the card changes when the user switches cars.
  const [lastSession, setLastSession] = useState<DriveSession | null>(null);
  // Location cache shared with garage / trip-history: reverse-geocoded from/to
  // names for sessions so the trip card shows "Westlands → CBD" not "Afternoon drive".
  const [locationCache, setLocationCache] = useState<TripLocationMap>({});

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (deviceId) {
        listDriveSessions(
          deviceId,
          5,
          0,
          activeVehicleId ?? undefined,
          activeVehicle?.isDefault ?? true,
        )
          .then(({ sessions }) => {
            if (!alive) return;
            const done = sessions.find((s) => s.endedAt != null) ?? sessions[0] ?? null;
            setLastSession(done);
          })
          .catch(() => {});
      }
      // Load location cache so the trip title shows real place names immediately
      loadTripLocationCache()
        .then((cache) => { if (alive) setLocationCache(cache); })
        .catch(() => {});
      return () => { alive = false; };
    }, [deviceId, activeVehicleId, activeVehicle]),
  );

  // ── Reverse-geocode the last session if not yet cached ─────────────────────
  // Runs whenever lastSession changes. Skips immediately if the location is
  // already in the cache. Writes the result back to AsyncStorage so garage and
  // trip-history screens benefit from the same cache entry.
  useEffect(() => {
    if (!lastSession?.endedAt) return;
    if (locationCache[lastSession.id]) return; // already have it
    if (lastSession.startLat == null || lastSession.startLng == null) return;

    let cancelled = false;
    (async () => {
      try {
        const [from, to] = await Promise.all([
          reverseGeocode(lastSession.startLat!, lastSession.startLng!),
          lastSession.endLat != null && lastSession.endLng != null
            ? reverseGeocode(lastSession.endLat, lastSession.endLng)
            : Promise.resolve(""),
        ]);
        if (cancelled || !from) return;
        const loc: TripLocation = { from, to: to || from };
        await saveTripLocation(lastSession.id, loc);
        if (!cancelled) {
          setLocationCache(prev => ({ ...prev, [lastSession.id]: loc }));
        }
      } catch { /* keep time-of-day fallback */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSession?.id]);

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

  // ── Course disclaimer gate ────────────────────────────────────────────────
  const [courseDisclaimerAgreed, setCourseDisclaimerAgreed] = useState(false);
  const [showCourseDisclaimer, setShowCourseDisclaimer] = useState(false);
  useFocusEffect(useCallback(() => {
    AsyncStorage.getItem(COURSE_DISCLAIMER_KEY).then((v) => {
      if (v === "1") setCourseDisclaimerAgreed(true);
    }).catch(() => {});
    // Bump the refresh key so DefaultVehicleImage re-reads loadVehicles()
    // and shows any vehicle the user just changed in the Garage.
    setHeroRefreshKey((k) => k + 1);
  }, []));

  const openCourse = () => {
    if (courseDisclaimerAgreed) {
      router.push("/(tabs)/learn");
    } else {
      setShowCourseDisclaimer(true);
    }
  };

  const handleCourseAgree = async () => {
    await AsyncStorage.setItem(COURSE_DISCLAIMER_KEY, "1").catch(() => {});
    setCourseDisclaimerAgreed(true);
    setShowCourseDisclaimer(false);
    router.push("/(tabs)/learn");
  };

  // ── Score info popup ──────────────────────────────────────────────────────
  const [showScoreInfo, setShowScoreInfo] = useState(false);

  // ── Quick-start: skip checklist when setting is on + permissions OK ────────
  const [quickStartReady, setQuickStartReady] = useState(false);
  const quickStartReadyRef = useRef(false);
  // Tracks whether the long-press gesture just fired so onPress can be suppressed.
  const longPressedRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      // Synchronously invalidate the ref so any tap during the async check
      // opens the checklist rather than bypassing it with stale state.
      quickStartReadyRef.current = false;
      setQuickStartReady(false);

      let alive = true;
      (async () => {
        try {
          const stored = await AsyncStorage.getItem(QUICK_START_KEY);
          if (!alive || stored !== "1") return;

          // Check essential permissions without requesting them
          const fg = await Location.getForegroundPermissionsAsync();
          if (!alive || !fg.granted) return;

          // Default true only on web (notifications not applicable).
          // On native, fail closed: only set true after a confirmed grant.
          let notifGranted = Platform.OS === "web";
          if (Platform.OS !== "web") {
            try {
              const Notifications = require("expo-notifications");
              const n = await Notifications.getPermissionsAsync();
              notifGranted = n.granted === true;
            } catch { /* permission check failed — leave notifGranted false */ }
          }
          if (!alive || !notifGranted) return;

          // All checks passed — enable quick-start
          quickStartReadyRef.current = true;
          setQuickStartReady(true);
        } catch { /* permissions unavailable — leave ref false */ }
      })();
      return () => { alive = false; };
    }, []),
  );

  const startDriving = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    // Drive is already running (active or paused) — return immediately.
    // Don't re-request permissions mid-session.
    if (navTripActive || navTripPaused) {
      router.replace("/(tabs)/drive");
      return;
    }
    // Request camera + microphone for the dashcam right now, before any navigation.
    // On first launch this shows the system permission dialogs so they are fully
    // resolved before the checklist or drive screen renders — meaning the checklist
    // will reflect the real permission state immediately and the dashcam can start
    // without a mid-session prompt.  On subsequent calls (already granted) this
    // returns in under a millisecond and navigation is instant.
    // Denial is handled gracefully by the dashcam; we never block on the result.
    await requestDashcamPermissions().catch(() => {});
    if (quickStartReadyRef.current) {
      // All permissions confirmed — go straight to drive
      router.replace("/(tabs)/drive");
    } else {
      router.push("/pretrip-check");
    }
  }, [navTripActive, navTripPaused, requestDashcamPermissions]);

  const openChecklist = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    router.push("/pretrip-check");
  }, []);

  const [hour, setHour] = useState(() => new Date().getHours());
  useFocusEffect(useCallback(() => { setHour(new Date().getHours()); }, []));
  const firstName = driverName ? driverName.split(" ")[0] : "driver";

  // ── Email-link nudge banner ────────────────────────────────────────────────
  // Shown for up to 7 days after onboarding when no recovery email is linked
  // and the banner hasn't been permanently dismissed.
  const [showEmailLinkBanner, setShowEmailLinkBanner] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        try {
          const [linkedEmail, dismissedAt, completedAt] = await Promise.all([
            getLinkedEmail().catch(() => null),
            AsyncStorage.getItem(EMAIL_LINK_BANNER_DISMISSED_KEY),
            AsyncStorage.getItem("onboardingCompletedAt"),
          ]);
          if (!alive) return;
          if (linkedEmail) { setShowEmailLinkBanner(false); return; }
          if (dismissedAt) { setShowEmailLinkBanner(false); return; }
          // Only show for users who went through the new onboarding flow
          // (onboardingCompletedAt written by finish()). Missing key = pre-update
          // user → no banner so they aren't nagged indefinitely.
          if (!completedAt) { setShowEmailLinkBanner(false); return; }
          const elapsed = Date.now() - parseInt(completedAt, 10);
          if (isNaN(elapsed) || elapsed > SEVEN_DAYS_MS) { setShowEmailLinkBanner(false); return; }
          setShowEmailLinkBanner(true);
        } catch {
          setShowEmailLinkBanner(false);
        }
      })();
      return () => { alive = false; };
    }, []),
  );

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
              { text: "View Clips", onPress: () => router.push("/dashcam-videos") },
              { text: "Dismiss", style: "cancel" },
            ]
          );
        } else {
          Alert.alert(
            "Dashcam is Off",
            "Start driving first, then turn on the Dashcam from the Drive screen.",
            [
              { text: "View Clips", onPress: () => router.push("/dashcam-videos") },
              { text: "Start Driving", style: "default", onPress: () => router.push("/pretrip-check") },
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
      onPress: () => setShowScoreInfo(true),
    },
    {
      key: "sharing",
      icon: "radio-outline" as const,
      iconColor: isSharingTrip ? c.primary : "#8B7CF6",
      title: "Trip Sharing",
      value: isSharingTrip ? "Active" : "Inactive",
      valueColor: isSharingTrip ? c.primary : c.mutedForeground,
      onPress: () => router.push("/trip-history?tab=shared" as any),
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
        {/* ── Header: logo + name · theme toggle · profile avatar ────────── */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            {/* Logo mark — white bg ring ensures the black arc stays visible
                on dark surfaces without needing a separate dark-mode asset. */}
            <View style={[styles.logoWrap, {
              backgroundColor: c.isDark ? "#FFFFFF" : "transparent",
              borderRadius: 12,
              overflow: "hidden",
            }]}>
              <Image
                source={require("@/assets/images/msafiri-logo-transparent.png")}
                style={{ width: 40, height: 40 }}
                resizeMode="contain"
              />
            </View>
            <View>
              <Text style={[styles.logoTxt, { color: c.foreground }]}>Msafiri</Text>
              <Text style={[styles.logoTag, { color: c.mutedForeground }]}>
                Smarter Roads. Safer Journeys.
              </Text>
            </View>
          </View>

          {/* Theme toggle + profile avatar — grouped tight on the right */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {/* Dark / light mode toggle */}
            <TouchableOpacity
              style={[styles.bellBtn, { backgroundColor: c.card, borderColor: c.tileBorder }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                const next = c.isDark ? "light" : "dark";
                setThemeOverride(next);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name={c.isDark ? "sunny" : "moon"}
                size={18}
                color={c.isDark ? "#FFC107" : "#3949AB"}
              />
            </TouchableOpacity>

            {/* Profile avatar — navigates to personal information */}
            <TouchableOpacity
              style={[styles.profileAvatarBtn, { backgroundColor: c.card, borderColor: c.tileBorder }]}
              onPress={() => router.push("/personal-information" as any)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {profilePhotoUri ? (
                <Image
                  source={{ uri: profilePhotoUri }}
                  style={styles.profileAvatarImg}
                />
              ) : (
                <Ionicons name="person-outline" size={19} color={c.mutedForeground} />
              )}
            </TouchableOpacity>
          </View>
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

        {/* ── Offline banner — inline, sits between greeting and hero card ── */}
        {isOffline && Platform.OS !== "web" && (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {/* OfflineAlertBanner handles its own modal on map/drive screens;
                              here we just show a quick inline strip — no modal needed */}}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 7,
              backgroundColor: "#F59E0B18",
              borderWidth: 1,
              borderColor: "#F59E0B50",
              borderRadius: 12,
              paddingVertical: 9,
              paddingHorizontal: 14,
              marginBottom: 14,
            }}
          >
            <Ionicons name="cloud-offline-outline" size={15} color="#D97706" />
            <Text style={{ flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#D97706" }}>
              You're offline
              {lastAlertDataSyncedAt
                ? ` · alert data from ${Math.floor((Date.now() - lastAlertDataSyncedAt.getTime()) / 60000)}m ago`
                : " · no alert data synced yet"}
            </Text>
            <Ionicons name="chevron-forward" size={14} color="#D97706" />
          </TouchableOpacity>
        )}

        {/* ── Email-link nudge banner ────────────────────────────────────── */}
        {showEmailLinkBanner && (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => router.push("/link-email" as any)}
            style={[styles.phoneLinkBanner, { backgroundColor: c.card, borderColor: c.primary + "44" }]}
          >
            <View style={[styles.phoneLinkIcon, { backgroundColor: c.primary + "18" }]}>
              <Ionicons name="shield-checkmark-outline" size={18} color={c.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.phoneLinkTitle, { color: c.foreground }]}>
                Secure your account
              </Text>
              <Text style={[styles.phoneLinkSub, { color: c.mutedForeground }]}>
                Link an email address to restore your data on any new device.
              </Text>
            </View>
            <TouchableOpacity
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 6 }}
              onPress={async (e) => {
                e.stopPropagation();
                await AsyncStorage.setItem(EMAIL_LINK_BANNER_DISMISSED_KEY, Date.now().toString()).catch(() => {});
                setShowEmailLinkBanner(false);
              }}
            >
              <Ionicons name="close" size={16} color={c.mutedForeground} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}

        {/* ── Start / Resume / View Driving hero card (state-aware) ──────── */}
        <Pressable
          onPress={() => {
            // If a long-press just fired, consume the flag and do nothing.
            // This prevents the normal press from also running after a hold.
            if (longPressedRef.current) { longPressedRef.current = false; return; }
            startDriving();
          }}
          onLongPress={() => { longPressedRef.current = true; openChecklist(); }}
          delayLongPress={600}
          style={({ pressed }) => [pressed && { transform: [{ scale: 0.985 }] }]}
        >
          <LinearGradient
            colors={
              navTripPaused
                ? ["#7C5C00", "#3A2D00"]
                : navTripActive
                ? ["#0A4A28", "#052215"]
                : [c.heroGradientStart, c.heroGradientEnd]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroCard}
          >
            {navTripPaused || navTripActive ? (
              <>
                {/* Vehicle image — static during an active/paused trip */}
                <View style={styles.heroImgWrap}>
                  <DefaultVehicleImage
                    width={185}
                    height={148}
                    vehicle={activeVehicle}
                  />
                </View>

                {/* Text + CTA, right-aligned */}
                <View style={styles.heroTextCol}>
                  {navTripPaused ? (
                    <>
                      <View style={styles.heroStatusRow}>
                        <View style={[styles.heroStatusDot, { backgroundColor: "#FFB300" }]} />
                        <Text style={[styles.heroStatusLabel, { color: "#FFB300" }]}>Trip Paused</Text>
                      </View>
                      <Text style={styles.heroActionLine}>Tap to resume driving</Text>
                      <Text style={styles.heroLongPressHint}>Long press ▶ on drive screen to end trip</Text>
                    </>
                  ) : (
                    <>
                      <View style={styles.heroStatusRow}>
                        <View style={[styles.heroStatusDot, { backgroundColor: "#34D399" }]} />
                        <Text style={[styles.heroStatusLabel, { color: "#34D399" }]}>Drive Active</Text>
                      </View>
                      <Text style={styles.heroActionLine}>Tap to view drive screen</Text>
                      <Text style={styles.heroLongPressHint}>Long press ⏸ on drive screen to end trip</Text>
                    </>
                  )}
                  <View style={styles.heroChevron}>
                    <Ionicons
                      name={navTripPaused ? "play" : "radio-outline"}
                      size={18}
                      color={navTripPaused ? "#FFB300" : "#34D399"}
                    />
                  </View>
                </View>
              </>
            ) : (
              /* Idle state — showroom carousel with rotating tips */
              <HeroCarousel
                activeVehicle={activeVehicle}
                showLongPressHint={quickStartReady}
              />
            )}
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

        {/* ── Nearby Alerts + Driving Course (adaptive) ──────────────────── */}
        {nearbyAlerts.length === 0 ? (
          /* ── 0 alerts: full course marketing card replaces the section ── */
          <TouchableOpacity activeOpacity={0.88} onPress={openCourse} style={[styles.courseFull, { borderColor: c.primary + "44" }]}>
            <LinearGradient
              colors={c.isDark ? ["#0D2B1A", "#0A1F14"] : ["#E8F5EE", "#D0EDD9"]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={styles.courseFullGrad}
            >
              <View style={styles.courseFullTop}>
                <View style={[styles.courseFullIcon, { backgroundColor: c.primary + "22" }]}>
                  <Ionicons name="book-outline" size={28} color={c.primary} />
                </View>
                <View style={[styles.courseFullBadge, { backgroundColor: c.primary }]}>
                  <Text style={styles.courseFullBadgeTxt}>Free</Text>
                </View>
              </View>
              <Text style={[styles.courseFullTitle, { color: c.foreground }]}>Kenya Driving Course</Text>
              <Text style={[styles.courseFullSub, { color: c.mutedForeground }]}>
                Road rules, traffic signs, hazard awareness &amp; more — 6 chapters written for Kenyan roads.
              </Text>
              <View style={styles.courseFullStats}>
                <View style={styles.courseFullStat}>
                  <Ionicons name="layers-outline" size={13} color={c.primary} />
                  <Text style={[styles.courseFullStatTxt, { color: c.mutedForeground }]}>6 Chapters</Text>
                </View>
                <View style={styles.courseFullStat}>
                  <Ionicons name="time-outline" size={13} color={c.primary} />
                  <Text style={[styles.courseFullStatTxt, { color: c.mutedForeground }]}>~45 min read</Text>
                </View>
                <View style={styles.courseFullStat}>
                  <Ionicons name="trophy-outline" size={13} color={c.primary} />
                  <Text style={[styles.courseFullStatTxt, { color: c.mutedForeground }]}>With quizzes</Text>
                </View>
              </View>
              <View style={[styles.courseFullBtn, { backgroundColor: c.primary }]}>
                <Text style={styles.courseFullBtnTxt}>Start Learning</Text>
                <Ionicons name="arrow-forward" size={15} color="#fff" />
              </View>
            </LinearGradient>
          </TouchableOpacity>
        ) : (
          <>
            <View style={styles.sectionRow}>
              <Text style={[styles.sectionTitle, { color: c.foreground }]}>Nearby Alerts</Text>
              <TouchableOpacity onPress={() => router.push("/(tabs)/map")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[styles.sectionLink, { color: c.primary }]}>See all</Text>
              </TouchableOpacity>
            </View>
            {nearbyAlerts.length >= 2 ? (
              /* ── 2+ alerts: full-width 2-column grid — show first two only ── */
              <View style={styles.alertDuoRow}>
                {nearbyAlerts.slice(0, 2).map((a) => (
                  <TouchableOpacity
                    key={a.id}
                    activeOpacity={0.8}
                    onPress={() =>
                      router.push({
                        pathname: "/(tabs)/map",
                        params: { focusId: a.id, focusLat: String(a.lat), focusLng: String(a.lng), focusTs: String(Date.now()) },
                      })
                    }
                    style={[styles.alertDuoCard, { backgroundColor: c.card, borderColor: c.tileBorder }]}
                  >
                    <View style={[styles.alertDuoIcon, { backgroundColor: a.color + "22" }]}>
                      <Text style={{ fontSize: 22, fontFamily: EMOJI_FONT_FAMILY }}>{a.emoji}</Text>
                    </View>
                    <View style={styles.alertDuoText}>
                      <Text style={[styles.alertDuoType, { color: c.foreground }]} numberOfLines={1}>
                        {a.label}
                      </Text>
                      <Text style={[styles.alertDuoDist, { color: a.color }]} numberOfLines={1}>
                        {distStr(a.distanceM)} ahead
                      </Text>
                      {a.road ? (
                        <Text style={[styles.alertDuoRoad, { color: c.mutedForeground }]} numberOfLines={1}>
                          {a.road}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : nearbyAlerts.length === 1 ? (
              /* ── 1 alert: same 2-column duo grid — alert card + course card ── */
              <View style={styles.alertDuoRow}>
                {/* Alert card */}
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() =>
                    router.push({
                      pathname: "/(tabs)/map",
                      params: {
                        focusId: nearbyAlerts[0].id,
                        focusLat: String(nearbyAlerts[0].lat),
                        focusLng: String(nearbyAlerts[0].lng),
                        focusTs: String(Date.now()),
                      },
                    })
                  }
                  style={[styles.alertDuoCard, { backgroundColor: c.card, borderColor: c.tileBorder }]}
                >
                  <View style={[styles.alertDuoIcon, { backgroundColor: nearbyAlerts[0].color + "22" }]}>
                    <Text style={{ fontSize: 22, fontFamily: EMOJI_FONT_FAMILY }}>{nearbyAlerts[0].emoji}</Text>
                  </View>
                  <View style={styles.alertDuoText}>
                    <Text style={[styles.alertDuoType, { color: c.foreground }]} numberOfLines={1}>
                      {nearbyAlerts[0].label}
                    </Text>
                    <Text style={[styles.alertDuoDist, { color: nearbyAlerts[0].color }]} numberOfLines={1}>
                      {distStr(nearbyAlerts[0].distanceM)} ahead
                    </Text>
                    {nearbyAlerts[0].road ? (
                      <Text style={[styles.alertDuoRoad, { color: c.mutedForeground }]} numberOfLines={1}>
                        {nearbyAlerts[0].road}
                      </Text>
                    ) : null}
                  </View>
                </TouchableOpacity>

                {/* Course promo card — same width, horizontal layout */}
                <TouchableOpacity
                  activeOpacity={0.88}
                  onPress={openCourse}
                  style={[styles.alertDuoCard, { borderColor: c.primary + "44", padding: 0, overflow: "hidden" }]}
                >
                  <LinearGradient
                    colors={c.isDark ? ["#0D2B1A", "#0A1F14"] : ["#E8F5EE", "#D0EDD9"]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}
                  >
                    <View style={[styles.alertDuoIcon, { backgroundColor: c.primary + "22", flexShrink: 0 }]}>
                      <Ionicons name="book-outline" size={22} color={c.primary} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Text style={[styles.alertDuoType, { color: c.foreground }]} numberOfLines={1}>
                        Driving 101
                      </Text>
                      <Text style={[styles.alertDuoRoad, { color: c.mutedForeground }]} numberOfLines={2}>
                        Kenya road rules &amp; signs
                      </Text>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: c.primary, marginTop: 2 }}>
                        Learn →
                      </Text>
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            ) : null}
            {/* Course promo banner — shown below the alert duo when there are 2+ alerts */}
            {nearbyAlerts.length >= 2 && (
              <TouchableOpacity activeOpacity={0.88} onPress={openCourse} style={[styles.courseBanner, { borderColor: c.primary + "44" }]}>
                <LinearGradient
                  colors={c.isDark ? ["#0D2B1A", "#0A1F14"] : ["#E8F5EE", "#D0EDD9"]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={styles.courseBannerGrad}
                >
                  <View style={[styles.courseBannerIcon, { backgroundColor: c.primary + "22" }]}>
                    <Ionicons name="book-outline" size={18} color={c.primary} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.courseBannerTitle, { color: c.foreground }]}>Kenya Driving Course</Text>
                    <Text style={[styles.courseBannerSub, { color: c.mutedForeground }]} numberOfLines={1}>
                      6 chapters · road rules, signs &amp; hazards
                    </Text>
                  </View>
                  <View style={[styles.courseBannerBtn, { backgroundColor: c.primary }]}>
                    <Text style={styles.courseBannerBtnTxt}>Start</Text>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            )}
          </>
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
          <TouchableOpacity onPress={() => router.push("/trip-history")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.sectionLink, { color: c.primary }]}>View all</Text>
          </TouchableOpacity>
        </View>
        {lastSession ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => router.push(`/trip-detail/${lastSession.id}`)}
            style={[styles.tripCard, { backgroundColor: c.card, borderColor: c.tileBorder }]}
          >
            {/* Route thumbnail — dark square with diagonal line */}
            <View style={styles.tripThumb}>
              <View style={styles.routeLine} />
              <View style={styles.routeDotStart} />
              <View style={styles.routeDotEnd} />
            </View>

            {/* Middle: timestamp · title · stats */}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.tripDate, { color: c.mutedForeground }]} numberOfLines={1}>
                {tripDateLabel(lastSession.startedAt)}
              </Text>
              <Text style={[styles.tripTitle, { color: c.foreground }]} numberOfLines={1}>
                {tripLabel(lastSession, locationCache[lastSession.id])}
              </Text>
              <Text style={[styles.tripMeta, { color: c.mutedForeground }]} numberOfLines={1}>
                {tripMetaLine(lastSession)}
              </Text>
            </View>

            {/* Score ring */}
            {lastSession.score != null && (
              <View style={[styles.scoreRing, { borderColor: scoreColor(lastSession.score) }]}>
                <Text style={[styles.scoreRingTxt, { color: scoreColor(lastSession.score) }]}>
                  {lastSession.score}
                </Text>
              </View>
            )}

            <Ionicons name="chevron-forward" size={16} color={c.mutedForeground} />
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

      {/* ── Score Info Modal ──────────────────────────────────────────────── */}
      <Modal visible={showScoreInfo} transparent animationType="fade" onRequestClose={() => setShowScoreInfo(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowScoreInfo(false)}>
          <Pressable style={[styles.modalSheet, { backgroundColor: c.card }]} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <View style={[styles.modalHeaderIcon, { backgroundColor: score != null ? scoreColor(score) + "1E" : c.primary + "1E" }]}>
                <Ionicons name="shield-checkmark-outline" size={22} color={score != null ? scoreColor(score) : c.primary} />
              </View>
              <View>
                <Text style={[styles.modalTitle, { color: c.foreground }]}>Driving Score</Text>
                {score != null && (
                  <Text style={[styles.modalSub, { color: scoreColor(score) }]}>{score} · {scoreLabel(score)}</Text>
                )}
              </View>
            </View>
            <Text style={[styles.modalBody, { color: c.mutedForeground }]}>
              Your score is calculated at the end of each trip based on how safely you drive. It ranges from 0–100.
            </Text>
            <View style={[styles.modalDivider, { backgroundColor: c.tileBorder }]} />
            <Text style={[styles.modalSectionHead, { color: c.foreground }]}>What we measure</Text>
            {[
              { icon: "speedometer-outline" as const, color: "#EF5350", label: "Speed compliance", desc: "Staying within posted speed limits" },
              { icon: "car-outline" as const,         color: "#FB8C00", label: "Smooth braking",   desc: "Avoiding harsh, sudden stops" },
              { icon: "trending-up-outline" as const, color: "#29B6F6", label: "Smooth acceleration", desc: "Gentle throttle inputs from rest" },
              { icon: "analytics-outline" as const,   color: "#66BB6A", label: "Consistent speed", desc: "Steady flow without erratic surges" },
            ].map((f) => (
              <View key={f.label} style={styles.scoreFactorRow}>
                <View style={[styles.scoreFactorIcon, { backgroundColor: f.color + "1E" }]}>
                  <Ionicons name={f.icon} size={17} color={f.color} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.scoreFactorLabel, { color: c.foreground }]}>{f.label}</Text>
                  <Text style={[styles.scoreFactorDesc, { color: c.mutedForeground }]}>{f.desc}</Text>
                </View>
              </View>
            ))}
            <View style={[styles.modalDivider, { backgroundColor: c.tileBorder }]} />
            <Text style={[styles.modalSectionHead, { color: c.foreground }]}>Score bands</Text>
            {[
              { range: "95 – 100", label: "Excellent", color: "#00C853" },
              { range: "90 – 94",  label: "Great",     color: "#43A047" },
              { range: "80 – 89",  label: "Good",      color: "#FBC02D" },
              { range: "70 – 79",  label: "Fair",      color: "#FB8C00" },
              { range: "0 – 69",   label: "Needs work", color: "#EF5350" },
            ].map((b) => (
              <View key={b.range} style={styles.scoreBandRow}>
                <View style={[styles.scoreBandDot, { backgroundColor: b.color }]} />
                <Text style={[styles.scoreBandRange, { color: c.mutedForeground }]}>{b.range}</Text>
                <Text style={[styles.scoreBandLabel, { color: b.color }]}>{b.label}</Text>
              </View>
            ))}
            <TouchableOpacity
              style={[styles.modalCloseBtn, { backgroundColor: c.primary }]}
              onPress={() => setShowScoreInfo(false)}
              activeOpacity={0.85}
            >
              <Text style={styles.modalCloseBtnTxt}>Got it</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Course Disclaimer Modal ───────────────────────────────────────── */}
      <Modal visible={showCourseDisclaimer} transparent animationType="slide" onRequestClose={() => setShowCourseDisclaimer(false)}>
        <View style={[styles.modalOverlay, { justifyContent: "flex-end" }]}>
          <View style={[styles.disclaimerSheet, { backgroundColor: c.card }]}>
            <View style={styles.modalHandle} />
            <View style={[styles.disclaimerIconWrap, { backgroundColor: c.primary + "1E" }]}>
              <Ionicons name="book-outline" size={32} color={c.primary} />
            </View>
            <Text style={[styles.disclaimerTitle, { color: c.foreground }]}>Before you start</Text>
            <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
              <Text style={[styles.disclaimerBody, { color: c.mutedForeground }]}>
                The Msafiri Kenya driving course is a refresher resource designed to help you review key road rules, traffic signs, and safe driving practices.
              </Text>
              <View style={[styles.disclaimerWarning, { backgroundColor: "#F59E0B" + "18", borderColor: "#F59E0B44" }]}>
                <Ionicons name="warning-outline" size={18} color="#F59E0B" />
                <Text style={[styles.disclaimerWarningTxt, { color: c.foreground }]}>
                  <Text style={{ fontFamily: "Inter_600SemiBold" }}>This course is not a substitute </Text>
                  for attending a licensed driving school, obtaining a valid driver's licence, or complying with NTSA requirements. It does not certify you to drive.
                </Text>
              </View>
              <Text style={[styles.disclaimerBody, { color: c.mutedForeground }]}>
                Always drive in accordance with the Traffic Act and exercise good judgement on the road. Msafiri Kenya is not liable for any decisions made based on course content.
              </Text>
            </ScrollView>
            <TouchableOpacity
              style={[styles.disclaimerBtn, { backgroundColor: c.primary }]}
              onPress={handleCourseAgree}
              activeOpacity={0.85}
            >
              <Text style={styles.disclaimerBtnTxt}>I understand, open the course</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowCourseDisclaimer(false)} style={{ alignSelf: "center", marginTop: 12, paddingVertical: 4 }}>
              <Text style={[styles.disclaimerCancelTxt, { color: c.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  logoWrap: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
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
  profileAvatarBtn: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1,
    alignItems: "center", justifyContent: "center", overflow: "hidden",
  },
  profileAvatarImg: { width: 40, height: 40, borderRadius: 20 },

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
    flexDirection: "row", alignItems: "stretch",
    borderRadius: 22, marginTop: 16, overflow: "hidden",
    minHeight: 182,
  },
  // Large vehicle image on the left — no padding so it bleeds to the card edge
  heroImgWrap: {
    width: 175, alignItems: "flex-end", justifyContent: "flex-end",
  },
  heroVehicleImg: { width: 185, height: 148 },
  // Text + CTA column on the right
  heroTextCol: {
    flex: 1, paddingVertical: 20, paddingRight: 18, paddingLeft: 4,
    justifyContent: "center", gap: 6,
  },
  heroStatusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  heroStatusDot: { width: 8, height: 8, borderRadius: 4 },
  heroStatusLabel: { fontSize: 16, fontFamily: "Inter_700Bold" },
  heroActionLine: {
    fontSize: 12, fontFamily: "Inter_400Regular", color: "#FFFFFFBB", lineHeight: 17,
  },
  heroLongPressHint: {
    fontSize: 10, fontFamily: "Inter_400Regular", color: "#FFFFFF66",
    lineHeight: 14, marginTop: 2,
  },
  heroTitle: { fontSize: 21, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  heroSub: {
    fontSize: 12, fontFamily: "Inter_400Regular", color: "#FFFFFFBB",
    lineHeight: 17,
  },
  heroChevron: {
    marginTop: 8, width: 36, height: 36, borderRadius: 18, backgroundColor: "#FFFFFF",
    alignItems: "center", justifyContent: "center", alignSelf: "flex-start",
  },
  // Legacy — kept so no unused-style warnings; no longer rendered
  heroArtWrap: { width: 0, height: 0 },
  heroArtGlow: { width: 0, height: 0, position: "absolute" },
  heroCarImg: { width: 0, height: 0 },

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

  // ── 2-column full-width grid cards (1–2 alerts) ──────────────────────────
  alertDuoRow: {
    flexDirection: "row", gap: 10,
  },
  alertDuoCard: {
    flex: 1, flexDirection: "row", alignItems: "center",
    gap: 10, borderRadius: 16, borderWidth: 1, padding: 12,
  },
  alertDuoIcon: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  alertDuoText: { flex: 1, minWidth: 0, gap: 2 },
  alertDuoType: { fontSize: 14, fontFamily: "Inter_700Bold" },
  alertDuoDist: { fontSize: 13, fontFamily: "Inter_700Bold" },
  alertDuoRoad: { fontSize: 11, fontFamily: "Inter_400Regular" },

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
  // Route thumbnail
  tripThumb: {
    width: 62, height: 62, borderRadius: 14,
    backgroundColor: "#0F1A12",
    overflow: "hidden", position: "relative",
  },
  routeLine: {
    position: "absolute",
    width: 44, height: 2.5,
    backgroundColor: "#22C55E",
    top: 29, left: 9,
    transform: [{ rotate: "-40deg" }],
  },
  routeDotStart: {
    position: "absolute", bottom: 10, left: 7,
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: "#EF4444",
    borderWidth: 1.5, borderColor: "#0F1A12",
  },
  routeDotEnd: {
    position: "absolute", top: 8, right: 7,
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: "#22C55E",
    borderWidth: 1.5, borderColor: "#0F1A12",
  },
  // Text
  tripDate: { fontSize: 12, fontFamily: "Inter_400Regular" },
  tripTitle: { fontSize: 15, fontFamily: "Inter_700Bold", marginTop: 1 },
  tripMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  tripStatsRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 5 },
  tripStat: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  tripStatLbl: { fontSize: 10.5, fontFamily: "Inter_400Regular", marginTop: 1 },

  // ── Course promo — full card (0 alerts) ────────────────────────────────────
  courseFull: { borderRadius: 20, borderWidth: 1.5, marginTop: 18, overflow: "hidden" },
  courseFullGrad: { padding: 18, gap: 10 },
  courseFullTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  courseFullIcon: { width: 50, height: 50, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  courseFullBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  courseFullBadgeTxt: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  courseFullTitle: { fontSize: 19, fontFamily: "Inter_700Bold" },
  courseFullSub: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  courseFullStats: { flexDirection: "row", gap: 14 },
  courseFullStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  courseFullStatTxt: { fontSize: 12, fontFamily: "Inter_500Medium" },
  courseFullBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    borderRadius: 13, paddingHorizontal: 18, paddingVertical: 11, marginTop: 4,
  },
  courseFullBtnTxt: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },

  // ── Course promo — inline tile (1 alert in scroll) ─────────────────────────
  courseTile: { width: 185, borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  courseTileGrad: { flex: 1, padding: 12, gap: 6 },
  courseTileIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  courseTileTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  courseTileSub: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
  courseTileBtn: { borderRadius: 9, paddingHorizontal: 10, paddingVertical: 5, alignSelf: "flex-start", marginTop: 2 },
  courseTileBtnTxt: { fontSize: 12, fontFamily: "Inter_700Bold" },

  // ── Course promo — compact banner (2 alerts, below scroll) ─────────────────
  courseBanner: { borderRadius: 14, borderWidth: 1, marginTop: 10, overflow: "hidden" },
  courseBannerGrad: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  courseBannerIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  courseBannerTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  courseBannerSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  courseBannerBtn: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  courseBannerBtnTxt: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },

  // ── Score info modal ───────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1, backgroundColor: "#00000077",
    alignItems: "center", justifyContent: "center", padding: 20,
  },
  modalSheet: {
    width: "100%", maxWidth: 420, borderRadius: 24,
    padding: 20, gap: 12,
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: "#88888844",
    alignSelf: "center", marginBottom: 4,
  },
  modalHeaderIcon: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  modalTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  modalSub: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 1 },
  modalBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  modalDivider: { height: 1, marginVertical: 2 },
  modalSectionHead: { fontSize: 13, fontFamily: "Inter_700Bold", marginBottom: 2 },
  scoreFactorRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  scoreFactorIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  scoreFactorLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  scoreFactorDesc: { fontSize: 11.5, fontFamily: "Inter_400Regular", marginTop: 1 },
  scoreBandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  scoreBandDot: { width: 8, height: 8, borderRadius: 4 },
  scoreBandRange: { fontSize: 12.5, fontFamily: "Inter_500Medium", width: 70 },
  scoreBandLabel: { fontSize: 12.5, fontFamily: "Inter_700Bold" },
  modalCloseBtn: { borderRadius: 14, paddingVertical: 13, alignItems: "center", marginTop: 4 },
  modalCloseBtnTxt: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },

  // ── Course disclaimer modal ────────────────────────────────────────────────
  disclaimerSheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: Platform.OS === "ios" ? 40 : 28,
    gap: 14,
    maxHeight: "82%",
  },
  disclaimerIconWrap: {
    width: 60, height: 60, borderRadius: 18,
    alignItems: "center", justifyContent: "center", alignSelf: "center",
  },
  disclaimerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  disclaimerBody: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  disclaimerWarning: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    borderRadius: 12, borderWidth: 1, padding: 12,
  },
  disclaimerWarningTxt: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  disclaimerBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 4 },
  disclaimerBtnTxt: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  disclaimerCancelTxt: { fontSize: 13, fontFamily: "Inter_500Medium" },

  // ── Phone-link nudge banner ────────────────────────────────────────────────
  phoneLinkBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  phoneLinkIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  phoneLinkTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  phoneLinkSub:   { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
});
