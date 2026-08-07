/**
 * trip-detail/[id].tsx — Detail view for a single drive session.
 *
 * Opened from the home "My Last Trip" card and from Drive History cards on
 * the Trips tab. Shows the session's route endpoints, score, and full stats
 * via the existing drive-sessions API.
 */

import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import {
  DriveSession,
  getDriveSession,
  scoreColor,
  scoreLabel,
  formatDuration,
} from "@/utils/driveSessionApi";
import TripRouteMap from "@/components/TripRouteMap";
import { reverseGeocode } from "@/utils/geocoding";
import {
  TripLocation,
  getTripLocation,
  saveTripLocation,
} from "@/utils/tripLocationCache";

function distStr(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short", year: "numeric" })} · ${d.toLocaleTimeString("en-KE", { hour: "numeric", minute: "2-digit" })}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-KE", { hour: "numeric", minute: "2-digit" });
}

export default function TripDetailScreen() {
  const c = useColors();
  const { deviceId } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [session, setSession] = useState<DriveSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [locationNames, setLocationNames] = useState<TripLocation | null>(null);

  const load = useCallback(async () => {
    if (!deviceId || !id) return;
    setLoading(true);
    setError(false);
    try {
      setSession(await getDriveSession(deviceId, id));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [deviceId, id]);

  useEffect(() => { load(); }, [load]);

  // Resolve location names: check cache first, then reverse-geocode and persist.
  useEffect(() => {
    if (!session || !id) return;
    let cancelled = false;
    (async () => {
      // Check cache
      const cached = await getTripLocation(id);
      if (cached) { if (!cancelled) setLocationNames(cached); return; }

      // Geocode start and end in parallel
      const startLat = session.startLat ?? 0;
      const startLng = session.startLng ?? 0;
      const endLat   = session.endLat   ?? startLat;
      const endLng   = session.endLng   ?? startLng;

      if (!startLat && !startLng) return; // no coordinates at all

      const [from, to] = await Promise.all([
        reverseGeocode(startLat, startLng),
        (session.endLat != null && session.endLng != null)
          ? reverseGeocode(endLat, endLng)
          : Promise.resolve(""),
      ]);

      if (!from && !to) return; // geocoding failed, don't cache empty result
      const loc: TripLocation = { from: from || "Start", to: to || from };
      await saveTripLocation(id, loc);
      if (!cancelled) setLocationNames(loc);
    })();
    return () => { cancelled = true; };
  }, [session, id]);

  const score = session?.score ?? null;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={["top"]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={c.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>Trip Details</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      ) : error || !session ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={44} color={c.mutedForeground} />
          <Text style={[styles.errTxt, { color: c.mutedForeground }]}>
            Couldn't load this trip. Check your connection.
          </Text>
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: c.primary }]} onPress={load}>
            <Text style={[styles.retryTxt, { color: c.isDark ? "#04170B" : "#FFFFFF" }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {/* Date + route label */}
          <Text style={[styles.dateTxt, { color: c.mutedForeground }]}>{fmtDateTime(session.startedAt)}</Text>
          {locationNames && (
            <Text style={[styles.routeLabel, { color: c.foreground }]} numberOfLines={1}>
              {locationNames.from}
              {locationNames.to && locationNames.to !== locationNames.from
                ? ` → ${locationNames.to}` : ""}
            </Text>
          )}

          {/* Route map — only shown when we have at least a start coordinate */}
          {session.startLat != null && session.startLng != null && (
            <TripRouteMap
              startLat={session.startLat}
              startLng={session.startLng}
              endLat={session.endLat}
              endLng={session.endLng}
            />
          )}

          {/* Score card */}
          <View style={[styles.scoreCard, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
            {score != null ? (
              <>
                <View style={[styles.scoreRing, { borderColor: scoreColor(score) }]}>
                  <Text style={[styles.scoreNum, { color: c.foreground }]}>{score}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.scoreLabel, { color: scoreColor(score) }]}>{scoreLabel(score)}</Text>
                  <Text style={[styles.scoreSub, { color: c.mutedForeground }]}>Driving score for this trip</Text>
                </View>
              </>
            ) : (
              <>
                <View style={[styles.scoreRing, { borderColor: c.mutedForeground }]}>
                  <Text style={[styles.scoreNum, { color: c.mutedForeground }]}>—</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.scoreLabel, { color: c.foreground }]}>Completed trip</Text>
                  <Text style={[styles.scoreSub, { color: c.mutedForeground }]}>No score was recorded</Text>
                </View>
              </>
            )}
          </View>

          {/* Times */}
          <View style={[styles.timesCard, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
            <View style={styles.timeRow}>
              <View style={[styles.timeDot, { backgroundColor: c.primary }]} />
              <Text style={[styles.timeLbl, { color: c.mutedForeground }]}>Started</Text>
              <Text style={[styles.timeVal, { color: c.foreground }]}>{fmtTime(session.startedAt)}</Text>
            </View>
            {session.endedAt && (
              <View style={styles.timeRow}>
                <View style={[styles.timeDot, { backgroundColor: "#E53935" }]} />
                <Text style={[styles.timeLbl, { color: c.mutedForeground }]}>Ended</Text>
                <Text style={[styles.timeVal, { color: c.foreground }]}>{fmtTime(session.endedAt)}</Text>
              </View>
            )}
          </View>

          {/* Main stats grid */}
          <View style={styles.statGrid}>
            {[
              { icon: "navigate-outline" as const,    val: distStr(session.distanceM),                                             lbl: "Distance" },
              { icon: "time-outline" as const,        val: session.durationS != null ? formatDuration(session.durationS) : "—",    lbl: "Duration" },
              { icon: "speedometer-outline" as const, val: session.avgSpeedKmh != null ? `${Math.round(session.avgSpeedKmh)}` : "—", lbl: "Avg km/h" },
              { icon: "flash-outline" as const,       val: session.maxSpeedKmh != null ? `${Math.round(session.maxSpeedKmh)}` : "—", lbl: "Max km/h" },
            ].map((s) => (
              <View key={s.lbl} style={[styles.statTile, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
                <Ionicons name={s.icon} size={18} color={c.primary} />
                <Text style={[styles.statVal, { color: c.foreground }]}>{s.val}</Text>
                <Text style={[styles.statLbl, { color: c.mutedForeground }]}>{s.lbl}</Text>
              </View>
            ))}
          </View>

          {/* Driving events */}
          <Text style={[styles.section, { color: c.foreground }]}>Driving events</Text>
          <View style={[styles.eventsCard, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
            {[
              { lbl: "Harsh braking",     val: session.harshBrakes,     color: "#EF5350" },
              { lbl: "Rapid acceleration", val: session.harshAccels,    color: "#FB8C00" },
              { lbl: "Sharp turns",       val: session.sharpTurns,      color: "#FBC02D" },
              { lbl: "Minutes speeding",  val: session.speedingMinutes, color: "#EF5350" },
              { lbl: "Smooth minutes",    val: session.smoothMinutes,   color: "#00C853" },
            ].map((e, i, arr) => (
              <View key={e.lbl} style={[styles.eventRow, i < arr.length - 1 && [styles.eventDivider, { borderBottomColor: c.border }]]}>
                <View style={[styles.eventDot, { backgroundColor: e.val > 0 ? e.color : c.mutedForeground + "55" }]} />
                <Text style={[styles.eventLbl, { color: c.foreground }]}>{e.lbl}</Text>
                <Text style={[styles.eventVal, { color: e.val > 0 ? e.color : c.mutedForeground }]}>{e.val}</Text>
              </View>
            ))}
          </View>

          {/* Alerts encountered */}
          <Text style={[styles.section, { color: c.foreground }]}>Alerts on this trip</Text>
          <View style={styles.statGrid}>
            {[
              { icon: "camera-outline" as const,  val: `${session.speedCameraAlerts}`, lbl: "Camera alerts" },
              { icon: "person-outline" as const,  val: `${session.policeAlerts}`,      lbl: "Police alerts" },
              { icon: "warning-outline" as const, val: `${session.hazardsEncountered}`, lbl: "Hazards" },
            ].map((s) => (
              <View key={s.lbl} style={[styles.statTile, styles.statTileThird, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
                <Ionicons name={s.icon} size={18} color={c.primary} />
                <Text style={[styles.statVal, { color: c.foreground }]}>{s.val}</Text>
                <Text style={[styles.statLbl, { color: c.mutedForeground }]}>{s.lbl}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, alignItems: "flex-start" },
  headerTitle: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  errTxt: { fontSize: 14, fontFamily: "Inter_500Medium", textAlign: "center" },
  retryBtn: { borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, marginTop: 4 },
  retryTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  dateTxt: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 4 },
  routeLabel: { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 12 },

  scoreCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 18, borderWidth: 1, padding: 16,
  },
  scoreRing: {
    width: 62, height: 62, borderRadius: 31, borderWidth: 4.5,
    alignItems: "center", justifyContent: "center",
  },
  scoreNum: { fontSize: 21, fontFamily: "Inter_700Bold" },
  scoreLabel: { fontSize: 16, fontFamily: "Inter_700Bold" },
  scoreSub: { fontSize: 12.5, fontFamily: "Inter_400Regular", marginTop: 2 },

  timesCard: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 10, marginTop: 12 },
  timeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  timeDot: { width: 9, height: 9, borderRadius: 5 },
  timeLbl: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  timeVal: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  statTile: {
    width: "47%", flexGrow: 1, borderRadius: 16, borderWidth: 1,
    paddingVertical: 14, alignItems: "center", gap: 4,
  },
  statTileThird: { width: "30%" },
  statVal: { fontSize: 16, fontFamily: "Inter_700Bold" },
  statLbl: { fontSize: 11, fontFamily: "Inter_400Regular" },

  section: { fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 22, marginBottom: 2 },

  eventsCard: { borderRadius: 16, borderWidth: 1, marginTop: 10 },
  eventRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  eventDivider: { borderBottomWidth: StyleSheet.hairlineWidth },
  eventDot: { width: 8, height: 8, borderRadius: 4 },
  eventLbl: { fontSize: 13.5, fontFamily: "Inter_500Medium", flex: 1 },
  eventVal: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
