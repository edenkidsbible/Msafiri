/**
 * TripSummaryModal
 *
 * Slides up from the bottom after a trip ends, presenting the key stats
 * collected during the drive plus action shortcuts (go home, view dashcam
 * clips, stop link sharing, view history).
 *
 * The caller owns visibility — pass `data={null}` to keep it hidden,
 * `data={...}` to show it. The modal calls `onDismiss` when it wants to
 * close, and `onStopSharing` when the driver taps "Stop Sharing".
 */

import React, { useEffect, useRef, useCallback } from "react";
import {
  Animated,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";

// ── Public data type ──────────────────────────────────────────────────────────

export interface TripSummaryData {
  durationS:         number;
  distanceM:         number;
  avgSpeedKmh:       number;
  maxSpeedKmh:       number;
  /** null when the trip was too short (< 1 km) to produce a meaningful score */
  score:             number | null;
  harshBrakes:       number;
  harshAccels:       number;
  sharpTurns:        number;
  speedingMinutes:   number;
  smoothMinutes:     number;
  speedCameraAlerts: number;
  policeAlerts:      number;
  /** true when dashcam was recording at the moment the trip was stopped */
  hadDashcam:        boolean;
  /** true when live link sharing was active at the moment the trip stopped */
  isSharing:         boolean;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  data:           TripSummaryData | null;
  onDismiss:      () => void;
  onStopSharing:  () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(s: number): string {
  if (s <= 0) return "0s";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function fmtDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

function fmtSpeed(kmh: number): string {
  return `${Math.round(kmh)} km/h`;
}

function scoreColor(score: number): string {
  if (score >= 86) return "#22C55E";   // green
  if (score >= 71) return "#F59E0B";   // amber
  if (score >= 51) return "#F97316";   // orange
  return "#EF4444";                    // red
}

function scoreLabel(score: number): string {
  if (score >= 86) return "Excellent";
  if (score >= 71) return "Good Drive";
  if (score >= 51) return "Fair Drive";
  return "Needs Improvement";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatTile({
  label, value, icon, color, bg,
}: { label: string; value: string; icon: string; color: string; bg: string }) {
  return (
    <View style={[statTileStyle.tile, { backgroundColor: bg }]}>
      <Ionicons name={icon as any} size={15} color={color} style={{ marginBottom: 4 }} />
      <Text style={[statTileStyle.value, { color }]}>{value}</Text>
      <Text style={statTileStyle.label}>{label}</Text>
    </View>
  );
}

const statTileStyle = StyleSheet.create({
  tile:  { flex: 1, borderRadius: 12, padding: 12, alignItems: "center", gap: 2 },
  value: { fontSize: 18, fontWeight: "700", letterSpacing: -0.5 },
  label: { fontSize: 11, color: "#888", textAlign: "center", marginTop: 1 },
});

function EventBadge({
  icon, count, label, warn,
}: { icon: string; count: number; label: string; warn: boolean }) {
  const dimColor  = count === 0 ? "#555" : warn ? "#EF4444" : "#F59E0B";
  const badgeBg   = count === 0 ? "#2A2A2A" : warn ? "#EF444420" : "#F59E0B20";
  return (
    <View style={[badge.wrap, { backgroundColor: badgeBg }]}>
      <Ionicons name={icon as any} size={13} color={dimColor} />
      <Text style={[badge.count, { color: dimColor }]}>{count}</Text>
      <Text style={[badge.lbl, { color: dimColor }]}>{label}</Text>
    </View>
  );
}

const badge = StyleSheet.create({
  wrap:  { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20,
           paddingHorizontal: 10, paddingVertical: 5 },
  count: { fontSize: 13, fontWeight: "700" },
  lbl:   { fontSize: 12 },
});

// ── Main component ────────────────────────────────────────────────────────────

export default function TripSummaryModal({ data, onDismiss, onStopSharing }: Props) {
  const c      = useColors();
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(600)).current;
  const bgOpacity = useRef(new Animated.Value(0)).current;

  // ── Animate in / out ───────────────────────────────────────────────────────
  useEffect(() => {
    if (data) {
      Animated.parallel([
        Animated.spring(slideY, {
          toValue: 0, damping: 22, stiffness: 280,
          useNativeDriver: true,
        }),
        Animated.timing(bgOpacity, {
          toValue: 1, duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      slideY.setValue(600);
      bgOpacity.setValue(0);
    }
  }, [data]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Navigation helpers (each also dismisses the modal) ────────────────────
  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideY, {
        toValue: 600, duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(bgOpacity, {
        toValue: 0, duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => onDismiss());
  }, [onDismiss, slideY, bgOpacity]);  // eslint-disable-line react-hooks/exhaustive-deps

  const goHome = useCallback(() => {
    dismiss();
    // Small delay so the dismiss animation plays before navigation
    setTimeout(() => router.replace("/(tabs)"), 180);
  }, [dismiss]);

  const goClips = useCallback(() => {
    // Navigate first so the new screen covers the drive tab instantly —
    // no 180 ms gap that would briefly expose the drive screen behind the modal.
    router.push("/dashcam-videos" as any);
    dismiss();
  }, [dismiss]);

  const goHistory = useCallback(() => {
    dismiss();
    setTimeout(() => router.push("/trip-history" as any), 180);
  }, [dismiss]);

  const handleStopSharing = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onStopSharing();
  }, [onStopSharing]);

  if (!data) return null;

  const sc        = data.score != null ? scoreColor(data.score) : "#9CA3AF";
  const isDark    = c.background === "#0D120E" || c.background?.startsWith("#0") ||
                    c.background?.startsWith("#1");
  const cardBg    = isDark ? "#161B17" : "#F4F7F5";
  const tileBg    = isDark ? "#1F2B23" : "#E8F0EA";
  const sepColor  = isDark ? "#2A3B2E" : "#D4E4D8";

  return (
    <Modal
      visible={!!data}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={goHome}
    >
      {/* Dim backdrop */}
      <Animated.View
        style={[styles.backdrop, { opacity: bgOpacity }]}
        pointerEvents="none"
      />

      {/* Tapping outside the sheet goes home */}
      <TouchableOpacity
        style={styles.backdropTap}
        activeOpacity={1}
        onPress={goHome}
      />

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: cardBg,
            paddingBottom: insets.bottom + 16,
            transform: [{ translateY: slideY }],
          },
        ]}
      >
        {/* Drag handle */}
        <View style={[styles.handle, { backgroundColor: sepColor }]} />

        {/* ── Header ───────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={[styles.headerIcon, { backgroundColor: "#22C55E20" }]}>
            <Ionicons name="checkmark-circle" size={22} color="#22C55E" />
          </View>
          <Text style={[styles.headerTitle, { color: c.foreground }]}>
            Trip Complete
          </Text>
          <TouchableOpacity
            onPress={goHome}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={[styles.closeBtn, { backgroundColor: tileBg }]}
          >
            <Ionicons name="close" size={16} color={c.mutedForeground} />
          </TouchableOpacity>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}
        >
          {/* ── Drive Score ──────────────────────────────────────────────── */}
          <View style={styles.scoreRow}>
            <View style={[styles.scoreRing, { borderColor: sc + "55", backgroundColor: sc + "12" }]}>
              {data.score != null ? (
                <>
                  <Text style={[styles.scoreNum, { color: sc }]}>{Math.round(data.score)}</Text>
                  <Text style={[styles.scoreOf, { color: sc + "AA" }]}>/100</Text>
                </>
              ) : (
                <Text style={[styles.scoreOf, { color: sc, fontSize: 22, textAlign: "center" }]}>—</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.scoreLbl, { color: sc }]}>
                {data.score != null ? scoreLabel(data.score) : "Trip too short"}
              </Text>
              <Text style={[styles.scoreSub, { color: c.mutedForeground }]}>
                {data.score != null ? "Drive score" : "Score needs at least 1 km"}
              </Text>
              {data.score != null && data.smoothMinutes > 0 && (
                <Text style={[styles.scoreSub, { color: "#22C55E", marginTop: 2 }]}>
                  {data.smoothMinutes}m smooth driving ✓
                </Text>
              )}
              {data.score != null && data.speedingMinutes > 0 && (
                <Text style={[styles.scoreSub, { color: "#F97316", marginTop: 2 }]}>
                  {data.speedingMinutes}m above speed limit
                </Text>
              )}
            </View>
          </View>

          {/* ── Stat tiles ───────────────────────────────────────────────── */}
          <View style={styles.tilesRow}>
            <StatTile
              label="Duration"
              value={fmtDuration(data.durationS)}
              icon="time-outline"
              color={c.primary}
              bg={tileBg}
            />
            <View style={{ width: 8 }} />
            <StatTile
              label="Distance"
              value={fmtDistance(data.distanceM)}
              icon="navigate-outline"
              color={c.primary}
              bg={tileBg}
            />
          </View>
          <View style={[styles.tilesRow, { marginTop: 8 }]}>
            <StatTile
              label="Avg Speed"
              value={fmtSpeed(data.avgSpeedKmh)}
              icon="speedometer-outline"
              color={c.foreground}
              bg={tileBg}
            />
            <View style={{ width: 8 }} />
            <StatTile
              label="Top Speed"
              value={fmtSpeed(data.maxSpeedKmh)}
              icon="flash-outline"
              color={data.maxSpeedKmh > 110 ? "#EF4444" : c.foreground}
              bg={tileBg}
            />
          </View>

          {/* ── Safety Events ────────────────────────────────────────────── */}
          <View style={[styles.sectionSep, { backgroundColor: sepColor }]} />
          <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>
            SAFETY EVENTS
          </Text>
          <View style={styles.badgesRow}>
            <EventBadge
              icon="alert-circle-outline"
              count={data.harshBrakes}
              label="Hard Brakes"
              warn={data.harshBrakes > 2}
            />
            <EventBadge
              icon="trending-up-outline"
              count={data.harshAccels}
              label="Hard Accels"
              warn={data.harshAccels > 2}
            />
            <EventBadge
              icon="refresh-outline"
              count={data.sharpTurns}
              label="Sharp Turns"
              warn={data.sharpTurns > 3}
            />
          </View>

          {/* ── Alerts ───────────────────────────────────────────────────── */}
          {(data.speedCameraAlerts > 0 || data.policeAlerts > 0) && (
            <>
              <View style={[styles.sectionSep, { backgroundColor: sepColor }]} />
              <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>
                ALERTS TRIGGERED
              </Text>
              <View style={styles.badgesRow}>
                {data.speedCameraAlerts > 0 && (
                  <EventBadge
                    icon="camera-outline"
                    count={data.speedCameraAlerts}
                    label="Speed Cameras"
                    warn={false}
                  />
                )}
                {data.policeAlerts > 0 && (
                  <EventBadge
                    icon="shield-outline"
                    count={data.policeAlerts}
                    label="Police"
                    warn={false}
                  />
                )}
              </View>
            </>
          )}

          <View style={[styles.sectionSep, { backgroundColor: sepColor }]} />

          {/* ── Contextual action buttons ─────────────────────────────────── */}
          {data.isSharing && (
            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: "#F97316", backgroundColor: "#F9731610" }]}
              onPress={handleStopSharing}
              activeOpacity={0.75}
            >
              <Ionicons name="radio-outline" size={16} color="#F97316" />
              <Text style={[styles.secondaryBtnTxt, { color: "#F97316" }]}>
                Stop Link Sharing
              </Text>
            </TouchableOpacity>
          )}

          {data.hadDashcam && (
            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: c.primary, backgroundColor: c.primary + "10" }]}
              onPress={goClips}
              activeOpacity={0.75}
            >
              <Ionicons name="videocam-outline" size={16} color={c.primary} />
              <Text style={[styles.secondaryBtnTxt, { color: c.primary }]}>
                View Dashcam Clips
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.secondaryBtn, { borderColor: sepColor }]}
            onPress={goHistory}
            activeOpacity={0.75}
          >
            <Ionicons name="list-outline" size={16} color={c.mutedForeground} />
            <Text style={[styles.secondaryBtnTxt, { color: c.mutedForeground }]}>
              View Trip History
            </Text>
          </TouchableOpacity>

          {/* ── Primary: Go Home ─────────────────────────────────────────── */}
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: c.primary }]}
            onPress={goHome}
            activeOpacity={0.85}
          >
            <Ionicons name="home-outline" size={18} color="#FFF" />
            <Text style={styles.primaryBtnTxt}>Go to Home</Text>
          </TouchableOpacity>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
    opacity: 0.55,
  },
  backdropTap: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    // iOS shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    // Android
    elevation: 24,
    maxHeight: "90%",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 10,
  },
  headerIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },

  // Score
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    marginBottom: 16,
  },
  scoreRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreNum: {
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -1,
    lineHeight: 34,
  },
  scoreOf: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: -2,
  },
  scoreLbl: {
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  scoreSub: {
    fontSize: 12,
    lineHeight: 17,
  },

  // Stat tiles
  tilesRow: {
    flexDirection: "row",
  },

  // Section divider
  sectionSep: {
    height: 1,
    marginVertical: 14,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 10,
  },

  // Badges (safety events)
  badgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  // Action buttons
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  secondaryBtnTxt: {
    fontSize: 14,
    fontWeight: "600",
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
    marginTop: 4,
  },
  primaryBtnTxt: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFF",
  },
});
