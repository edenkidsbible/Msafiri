import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import LiveTrackerMap from "@/components/LiveTrackerMap";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ShareSession {
  lat: number | null;
  lng: number | null;
  speedKmh: number | null;
  durationRemainingS: number | null;
  distanceRemainingM: number | null;
  driverName: string | null;
  destinationName: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
  lastPingAt: string | null;
  endedAt: string | null;
  ended: boolean;
  expiresAt: string;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? "";
const API_BASE = DOMAIN ? `https://${DOMAIN}/api` : "";
const POLL_MS = 5000;
const MAX_RETRIES = 3;

function timeSince(isoStr: string): string {
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function distStr(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function durationStr(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function LiveShareScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const [session, setSession] = useState<ShareSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [, forceRender] = useState(0); // for "last seen X ago" live updates

  const retryCountRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSession = useCallback(async () => {
    if (!code || !API_BASE) return;
    try {
      const res = await fetch(`${API_BASE}/share/${encodeURIComponent(code.toUpperCase())}`);
      if (res.status === 404) {
        setExpired(true);
        setLoading(false);
        if (intervalRef.current) clearInterval(intervalRef.current);
        return;
      }
      if (!res.ok) {
        retryCountRef.current += 1;
        if (retryCountRef.current >= MAX_RETRIES) {
          setExpired(true);
          setLoading(false);
          if (intervalRef.current) clearInterval(intervalRef.current);
        }
        return;
      }
      const data: ShareSession = await res.json();
      retryCountRef.current = 0;

      // Check if session has ended or expired
      if (data.ended || (data.expiresAt && new Date(data.expiresAt) < new Date())) {
        setExpired(true);
        setLoading(false);
        if (intervalRef.current) clearInterval(intervalRef.current);
        return;
      }

      setSession(data);
      setLoading(false);
      setExpired(false);
    } catch {
      retryCountRef.current += 1;
      if (retryCountRef.current >= MAX_RETRIES) {
        setExpired(true);
        setLoading(false);
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    }
  }, [code]);

  // Initial fetch + polling
  useEffect(() => {
    fetchSession();
    intervalRef.current = setInterval(fetchSession, POLL_MS);
    // Refresh "last seen" label every second
    const labelTimer = setInterval(() => forceRender(n => n + 1), 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      clearInterval(labelTimer);
    };
  }, [fetchSession]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }, [router]);

  const handleOpenInBrowser = useCallback(async () => {
    const url = `https://${DOMAIN}/live/${code}`;
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      await Linking.openURL(url);
    }
  }, [code]);

  const shareTitle = session?.driverName
    ? `${session.driverName} is sharing their location`
    : "Live Location";

  // ── Expired / not-found state ──────────────────────────────────────────────
  if (expired) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={[styles.topBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Pressable onPress={handleBack} style={styles.backBtn} hitSlop={10}>
            <Ionicons name="close" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.topBarTitle, { color: colors.foreground }]} numberOfLines={1}>Live Location</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.center}>
          <Ionicons name="location-outline" size={56} color={colors.muted} />
          <Text style={[styles.expiredTitle, { color: colors.foreground }]}>
            Live share has ended
          </Text>
          <Text style={[styles.expiredSub, { color: colors.muted }]}>
            This live location link has expired or the driver has stopped sharing.
          </Text>
          <Pressable
            onPress={handleBack}
            style={[styles.homeBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.homeBtnText}>Go to Home</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading || !session || session.lat == null || session.lng == null) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={[styles.topBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Pressable onPress={handleBack} style={styles.backBtn} hitSlop={10}>
            <Ionicons name="close" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.topBarTitle, { color: colors.foreground }]} numberOfLines={1}>{shareTitle}</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.muted }]}>
            {loading ? "Loading live location…" : "Waiting for driver location…"}
          </Text>
        </View>
      </View>
    );
  }

  // ── Map state ──────────────────────────────────────────────────────────────
  const lastSeen = session.lastPingAt ? timeSince(session.lastPingAt) : "—";

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Map fills the background */}
      <LiveTrackerMap
        lat={session.lat}
        lng={session.lng}
        speedKmh={session.speedKmh}
        destinationLat={session.destinationLat}
        destinationLng={session.destinationLng}
        destinationName={session.destinationName}
      />

      {/* Top bar overlay */}
      <View style={[styles.topBarOverlay, { backgroundColor: colors.card + "F0" }]}>
        <Pressable onPress={handleBack} style={styles.backBtn} hitSlop={10}>
          <Ionicons name="close" size={22} color={colors.foreground} />
        </Pressable>
        <View style={styles.topBarInfo}>
          <Text style={[styles.topBarTitle, { color: colors.foreground }]} numberOfLines={1}>{shareTitle}</Text>
          <Text style={[styles.topBarSub, { color: colors.muted }]}>Last seen {lastSeen}</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      {/* Speed badge */}
      {session.speedKmh != null && (
        <View style={[styles.speedBadge, { backgroundColor: colors.primary }]}>
          <Text style={styles.speedNum}>{Math.round(session.speedKmh)}</Text>
          <Text style={styles.speedUnit}>km/h</Text>
        </View>
      )}

      {/* Bottom panel */}
      <View
        style={[
          styles.bottomPanel,
          { backgroundColor: colors.card + "F5", paddingBottom: insets.bottom + 12 },
        ]}
      >
        {/* Route info row */}
        {(session.destinationName || session.durationRemainingS != null || session.distanceRemainingM != null) && (
          <View style={styles.routeRow}>
            {session.destinationName ? (
              <View style={styles.routeDestContainer}>
                <Ionicons name="location" size={14} color={colors.primary} style={{ marginRight: 4 }} />
                <Text style={[styles.routeDestText, { color: colors.foreground }]} numberOfLines={1}>
                  {session.destinationName}
                </Text>
              </View>
            ) : null}
            <View style={styles.routeEtaRow}>
              {session.durationRemainingS != null && (
                <Text style={[styles.routeEta, { color: colors.foreground }]}>
                  {durationStr(session.durationRemainingS)}
                </Text>
              )}
              {session.distanceRemainingM != null && (
                <Text style={[styles.routeDist, { color: colors.muted }]}>
                  {distStr(session.distanceRemainingM)} remaining
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Open in browser */}
        <Pressable
          onPress={handleOpenInBrowser}
          style={({ pressed }) => [
            styles.browserBtn,
            { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Ionicons name="open-outline" size={16} color={colors.muted} style={{ marginRight: 6 }} />
          <Text style={[styles.browserBtnText, { color: colors.muted }]}>Open in browser</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topBarOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    zIndex: 10,
  },
  topBarInfo: {
    flex: 1,
    alignItems: "center",
  },
  topBarTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  topBarSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginTop: 8,
    textAlign: "center",
  },
  expiredTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    marginTop: 8,
  },
  expiredSub: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  homeBtn: {
    marginTop: 8,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
  },
  homeBtnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  speedBadge: {
    position: "absolute",
    top: "50%",
    right: 16,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
  speedNum: {
    color: "#fff",
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    lineHeight: 22,
  },
  speedUnit: {
    color: "#ffffffcc",
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    lineHeight: 12,
  },
  bottomPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 14,
    paddingHorizontal: 16,
    zIndex: 10,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
  },
  routeRow: {
    marginBottom: 10,
    gap: 4,
  },
  routeDestContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  routeDestText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  routeEtaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  routeEta: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  routeDist: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  browserBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  browserBtnText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
});
