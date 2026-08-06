/**
 * Report tab — full redesign matching the UI-overhaul mockup.
 * Grid of 12 report types, recent nearby reports, stats card.
 * Tapping a type opens ReportModal pre-selected on that type.
 */
import { Ionicons } from "@expo/vector-icons";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CrosshairPickerModal } from "@/components/CrosshairPicker";
import ReportModal from "@/components/ReportModal";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { speakAlert } from "@/utils/alertTts";
import { playSound } from "@/utils/sound";
import { snapToRoad } from "@/utils/snapToRoad";
import type { CommunityReport } from "@/context/AppContext";
import { resolveIncidentType } from "@/constants/incidentTypes";
import { formatTimeAgo } from "@/lib/timeAgo";

type ReportType = CommunityReport["type"];

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distStr(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

// Grid items — order matches mockup exactly.
// Each entry resolves its emoji, color, and label from the canonical INCIDENT_TYPES map.
const GRID_TYPES: (ReportType | null)[] = [
  "camera", "police", "alcoblow", "accident",
  "roadworks", "traffic", "hazard", "pothole",
  "debris", "weather", "breakdown", null,
];

export default function ReportScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    addReport, currentLat, currentLng,
    communityReports, snapToActiveRoute, setMapPickerActive,
  } = useApp();

  const [showReport, setShowReport] = useState(false);
  const [initialType, setInitialType] = useState<ReportType | null>(null);
  const [crosshairRequest, setCrosshairRequest] = useState<{
    lat: number; lng: number; onConfirm: (lat: number, lng: number) => void;
  } | null>(null);

  const now = Date.now();
  const TAB_H = Platform.OS === "web" ? 84 : 96;

  const nearbyReports = useMemo(() => {
    if (currentLat == null || currentLng == null) {
      return communityReports.slice(0, 4).map((r) => ({ ...r, distance: null as number | null }));
    }
    return [...communityReports]
      .filter((r) => r.lat != null && r.lng != null && !isNaN(r.lat) && !isNaN(r.lng))
      .map((r) => ({ ...r, distance: haversineM(currentLat, currentLng, r.lat, r.lng) }))
      .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
      .slice(0, 4);
  }, [communityReports, currentLat, currentLng]);

  const openReport = (type: ReportType | null) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setInitialType(type);
    setShowReport(true);
  };

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: TAB_H + 24, paddingHorizontal: 16 }}
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.pageTitle, { color: c.foreground }]}>Report</Text>
            <Text style={[styles.pageSubtitle, { color: c.mutedForeground }]}>
              Help keep our roads safe for everyone.
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.myReportsBtn, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={() => router.push("/(tabs)/map")}
            activeOpacity={0.82}
          >
            <Ionicons name="clipboard-outline" size={14} color={c.primary} />
            <Text style={[styles.myReportsTxt, { color: c.foreground }]}>My Reports</Text>
            <Ionicons name="chevron-forward" size={12} color={c.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* ── Quick-action cards ───────────────────────────────────────── */}
        <View style={styles.quickCards}>
          <TouchableOpacity
            style={[styles.quickCard, { backgroundColor: c.card, borderColor: c.primary + "60" }]}
            onPress={() => openReport(null)}
            activeOpacity={0.82}
          >
            <View style={[styles.quickCardIcon, { backgroundColor: c.primary + "20" }]}>
              <Ionicons name="create-outline" size={22} color={c.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.quickCardTitle, { color: c.foreground }]}>Report Incident</Text>
              <Text style={[styles.quickCardSub, { color: c.mutedForeground }]}>Share what's happening</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickCard, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={() => router.push("/(tabs)/map")}
            activeOpacity={0.82}
          >
            <View style={[styles.quickCardIcon, { backgroundColor: "#1565C020" }]}>
              <Ionicons name="people-outline" size={22} color="#1565C0" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.quickCardTitle, { color: c.foreground }]}>Nearby Reports</Text>
              <Text style={[styles.quickCardSub, { color: c.mutedForeground }]}>See what others reported</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* ── Report type grid ─────────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: c.foreground }]}>What would you like to report?</Text>
        <View style={styles.grid}>
          {GRID_TYPES.map((type, i) => {
            const def = resolveIncidentType(type ?? "__unknown");
            const label = type === null ? "Other" : def.label;
            return (
              <TouchableOpacity
                key={i}
                style={[styles.gridTile, { backgroundColor: c.card }]}
                onPress={() => openReport(type)}
                activeOpacity={0.78}
              >
                <View style={[styles.gridIconBox, { backgroundColor: def.color + "25" }]}>
                  <Text style={{ fontSize: 26, fontFamily: EMOJI_FONT_FAMILY }}>{def.emoji}</Text>
                </View>
                <Text style={[styles.gridLabel, { color: c.foreground }]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Recent nearby reports ────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: c.foreground, marginBottom: 0 }]}>Recent Nearby Reports</Text>
          <TouchableOpacity onPress={() => router.push("/(tabs)/map")} activeOpacity={0.8}>
            <Text style={[styles.seeAllTxt, { color: c.primary }]}>View map &gt;</Text>
          </TouchableOpacity>
        </View>

        {nearbyReports.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Ionicons name="map-outline" size={26} color={c.mutedForeground} />
            <Text style={[styles.emptyTxt, { color: c.mutedForeground }]}>No nearby reports yet. Be the first!</Text>
          </View>
        ) : (
          <View style={[styles.reportsList, { backgroundColor: c.card, borderColor: c.border }]}>
            {nearbyReports.map((r, i) => {
              const def = resolveIncidentType(r.type);
              const isClose = r.distance != null && r.distance < 500;
              const distColor = isClose ? "#E53935" : c.primary;
              return (
                <View
                  key={r.id}
                  style={[
                    styles.reportRow,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
                  ]}
                >
                  <View style={[styles.reportIconBox, { backgroundColor: def.color + "22" }]}>
                    <Text style={{ fontSize: 18 }}>{def.emoji}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.reportType, { color: c.foreground }]}>{def.label}</Text>
                    {r.roadName ? (
                      <Text style={[styles.reportRoad, { color: c.mutedForeground }]} numberOfLines={1}>{r.roadName}</Text>
                    ) : null}
                    <Text style={[styles.reportMeta, { color: c.mutedForeground }]}>
                      Reported {formatTimeAgo(r.timestamp, now)}
                    </Text>
                  </View>
                  {r.distance != null && (
                    <View style={styles.reportDist}>
                      <Text style={[styles.reportDistTxt, { color: distColor }]}>{distStr(r.distance)}</Text>
                      <Ionicons name={isClose ? "chevron-down" : "chevron-forward"} size={14} color={distColor} />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* ── Thank you stats card ─────────────────────────────────────── */}
        <View style={[styles.statsCard, { backgroundColor: c.isDark ? "#0D3320" : "#006622" }]}>
          <View style={[styles.statsIconWrap, { borderColor: "#FFFFFF30" }]}>
            <Ionicons name="shield-checkmark" size={28} color="#FFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.statsThanks}>Thank you for reporting!</Text>
            <Text style={styles.statsSub}>Your reports help thousands of drivers stay safe every day.</Text>
          </View>
          <View style={styles.statsRight}>
            <Text style={[styles.statsNum, { color: c.primary }]}>42K+</Text>
            <Text style={styles.statsLabel}>Drivers reporting</Text>
          </View>
        </View>
      </ScrollView>

      <ReportModal
        visible={showReport}
        initialType={initialType}
        onClose={() => { setShowReport(false); setInitialType(null); }}
        currentLat={currentLat}
        currentLng={currentLng}
        onOpenMapPicker={(initialLat, initialLng, onConfirm) => {
          setMapPickerActive(true);
          setShowReport(false);
          setTimeout(() => setCrosshairRequest({ lat: initialLat, lng: initialLng, onConfirm }), 320);
        }}
        onSubmit={async (type, speedLimit, location) => {
          setShowReport(false);
          setInitialType(null);
          if (location) {
            addReport(type, location.lat, location.lng, speedLimit);
          } else if (currentLat !== null && currentLng !== null) {
            try {
              const routeSnap = snapToActiveRoute(currentLat, currentLng);
              const snapped = routeSnap ?? await snapToRoad(currentLat, currentLng);
              addReport(type, snapped.lat, snapped.lng, speedLimit);
            } catch {
              addReport(type, currentLat, currentLng, speedLimit);
            }
          }
          playSound("confirm").catch(() => {});
          speakAlert("report_submitted").catch(() => {});
        }}
      />

      <CrosshairPickerModal
        visible={!!crosshairRequest}
        initialLat={crosshairRequest?.lat ?? -1.2921}
        initialLng={crosshairRequest?.lng ?? 36.8219}
        title="Pin the Incident Spot"
        onCancel={() => { setCrosshairRequest(null); setShowReport(true); }}
        onConfirm={(lat, lng) => {
          crosshairRequest?.onConfirm(lat, lng);
          setCrosshairRequest(null);
          setShowReport(true);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18, gap: 12 },
  pageTitle: { fontSize: 26, fontFamily: "Inter_700Bold", lineHeight: 30 },
  pageSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 3, lineHeight: 18 },
  myReportsBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 6, marginTop: 4,
  },
  myReportsTxt: { fontSize: 12.5, fontFamily: "Inter_500Medium" },

  quickCards: { flexDirection: "row", gap: 10, marginBottom: 22 },
  quickCard: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1.5, borderRadius: 14, padding: 12,
  },
  quickCardIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  quickCardTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  quickCardSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 14 },

  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 14 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 24, marginBottom: 14 },
  seeAllTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 4 },
  gridTile: {
    width: "23%", flexGrow: 1, alignItems: "center", justifyContent: "center",
    borderRadius: 14, paddingVertical: 14, paddingHorizontal: 6, gap: 8,
    minWidth: 72,
  },
  gridIconBox: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  gridLabel: { fontSize: 11.5, fontFamily: "Inter_500Medium", textAlign: "center", lineHeight: 14 },

  emptyCard: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 4,
  },
  emptyTxt: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },

  reportsList: { borderWidth: 1, borderRadius: 14, overflow: "hidden", marginBottom: 4 },
  reportRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  reportIconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  reportType: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  reportRoad: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  reportMeta: { fontSize: 11.5, fontFamily: "Inter_400Regular", marginTop: 1 },
  reportDist: { flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 },
  reportDistTxt: { fontSize: 13, fontFamily: "Inter_700Bold" },

  statsCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 16, padding: 16, marginTop: 20,
  },
  statsIconWrap: {
    width: 52, height: 52, borderRadius: 26, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
    backgroundColor: "rgba(0,0,0,0.15)",
  },
  statsThanks: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#FFF" },
  statsSub: { fontSize: 11.5, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.75)", marginTop: 3, lineHeight: 16 },
  statsRight: { alignItems: "center", flexShrink: 0 },
  statsNum: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statsLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.75)", textAlign: "center" },
});
