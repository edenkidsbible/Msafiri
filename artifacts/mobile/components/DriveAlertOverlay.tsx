/**
 * DriveAlertOverlay
 * ─────────────────
 * Full-width bottom panel that slides up when the driver approaches a speed
 * camera, police check, speed zone, or community-reported hazard.
 *
 * Urgency tiers (based on distance):
 *   • 1000–400 m  →  yellow  (warning)
 *   •  400–200 m  →  orange  (caution)
 *   •    < 200 m  →  red     (danger, pulsing badge)
 *
 * Sound policy:
 *   Play once when a NEW alert appears (id changes). No repeat sound on
 *   entering the 200 m danger zone — the visual pulse is enough signal.
 *
 * Type-aware layout:
 *   "zone" source (camera / police / speed zone) → speed-limit + driver-speed badges.
 *   "report" source (accident, pothole, roadblock, …) → incident card with emoji.
 */

import React, { useEffect, useRef } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { DriveAlert } from "@/context/AppContext";
import { resolveIncidentType } from "@/constants/incidentTypes";
import { playSound } from "@/utils/sound";

interface Props {
  alert: DriveAlert;
  onDismiss: () => void;
  currentSpeed: number;
}

// ── Confidence tier helpers (#31) ─────────────────────────────────────────────

function reportTier(confirmCount: number | undefined): "new" | "confirmed" | "reliable" {
  const c = confirmCount ?? 0;
  if (c >= 5) return "reliable";
  if (c >= 2) return "confirmed";
  return "new";
}

function tierLabel(count: number | undefined): string {
  const c = count ?? 0;
  if (c === 0) return "Reported by a driver";
  if (c < 5)  return `Confirmed by ${c} driver${c === 1 ? "" : "s"}`;
  return `Highly reliable · ${c} drivers`;
}

/** Blend the urgency colour toward a desaturated grey for low-confidence reports */
function tierBg(baseBg: string, tier: "new" | "confirmed" | "reliable"): string {
  if (tier === "new")       return "#8D6E63"; // muted warm brown — clearly a fresh report
  if (tier === "confirmed") return baseBg;    // normal urgency colour
  return baseBg;                              // reliable: same colour, ring added in UI
}

// ── Zone-type helpers ─────────────────────────────────────────────────────────

const ZONE_LABELS: Record<string, string> = {
  camera: "Speed Camera",
  police: "Police Check",
  zone:   "Speed Zone",
};
const ZONE_ICONS: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
  camera: "camera",
  police: "shield",
  zone:   "warning",
};

function urgencyColor(distance: number, colors: ReturnType<typeof useColors>) {
  if (distance < 200) return colors.speedDanger;   // red
  if (distance < 400) return "#E65100";             // deep orange
  return colors.warning;                             // yellow/amber
}

function formatDist(m: number) {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function DriveAlertOverlay({ alert, onDismiss, currentSpeed }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(340)).current;
  const pulse  = useRef(new Animated.Value(1)).current;
  const prevId = useRef<string | null>(null);
  const prevUrgent = useRef(false);

  const urgent = alert.distance < 200;
  const bg     = urgencyColor(alert.distance, colors);

  // ── Slide in + sound on first appearance of a new alert ──────────────────
  useEffect(() => {
    if (alert.id !== prevId.current) {
      prevId.current = alert.id;
      prevUrgent.current = false;
      pulse.stopAnimation();
      pulse.setValue(1);
      slideY.setValue(340);
      Animated.spring(slideY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 60,
        friction: 10,
      }).start();
      void playSound("alert");
    }
  }, [alert.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Start pulsing when entering the 200 m danger zone (no extra sound) ───
  useEffect(() => {
    if (urgent && !prevUrgent.current) {
      prevUrgent.current = true;
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.08, duration: 380, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1.00, duration: 380, useNativeDriver: true }),
        ])
      ).start();
    } else if (!urgent && prevUrgent.current) {
      prevUrgent.current = false;
      pulse.stopAnimation();
      pulse.setValue(1);
    }
  }, [urgent]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Resolve display values ────────────────────────────────────────────────
  const isZone   = alert.source === "zone";
  const typeLabel = isZone
    ? (ZONE_LABELS[alert.type] ?? "Speed Zone")
    : resolveIncidentType(alert.type).label;
  // For zone alerts we use the ZONE_ICONS map; for report alerts the emoji
  // is always shown first so the icon is a safety-net fallback only.
  const typeIcon: React.ComponentProps<typeof Ionicons>["name"] = isZone
    ? (ZONE_ICONS[alert.type] ?? "warning")
    : "warning";
  const emoji = !isZone ? resolveIncidentType(alert.type).emoji : null;

  const hasSpeedBadges = isZone && alert.speedLimit != null;
  const overLimit      = hasSpeedBadges && currentSpeed > alert.speedLimit!;
  const speedColor     = overLimit ? colors.speedDanger : "#2E7D32";

  // Confidence tier (#31) — only applies to community reports
  const tier       = !isZone ? reportTier(alert.confirmCount) : null;
  const effectiveBg = tier ? tierBg(bg, tier) : bg;

  return (
    <Animated.View
      style={[
        styles.sheet,
        {
          paddingBottom: insets.bottom + 12,
          borderColor:   bg,
          transform:     [{ translateY: slideY }],
        },
      ]}
    >
      {/* ── Handle pill ── */}
      <View style={styles.handle} />

      {/* ── Header: icon + label + distance + close ── */}
      <View style={[styles.header, { backgroundColor: effectiveBg }]}>
        {emoji ? (
          <Text style={styles.headerEmoji}>{emoji}</Text>
        ) : (
          <Ionicons name={typeIcon} size={34} color="#FFF" />
        )}
        <View style={styles.headerText}>
          <Text style={styles.typeLabel}>{typeLabel.toUpperCase()}</Text>
          <Text style={styles.distLabel}>{formatDist(alert.distance)} ahead</Text>
          {/* Confidence tier label for community reports */}
          {tier && tier !== "new" && (
            <View style={[styles.tierBadge, { backgroundColor: tier === "reliable" ? "#00C853" : "#FFD600" }]}>
              <Text style={[styles.tierBadgeTxt, { color: tier === "reliable" ? "#FFF" : "#333" }]}>
                {tier === "reliable" ? "✓ Highly Reliable" : "✓ Confirmed"}
              </Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          onPress={onDismiss}
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          style={styles.closeBtn}
        >
          <Ionicons name="close-circle" size={28} color="rgba(255,255,255,0.85)" />
        </TouchableOpacity>
      </View>

      {/* ── Body ── */}
      <View style={styles.body}>
        {/* Location / name */}
        <View style={styles.locationRow}>
          <Ionicons name="location-sharp" size={16} color={effectiveBg} style={{ marginTop: 1 }} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.zoneName, { color: colors.text }]} numberOfLines={1}>
              {alert.name}
            </Text>
            {alert.road ? (
              <Text style={[styles.zoneRoad, { color: colors.mutedForeground }]} numberOfLines={1}>
                {alert.road}
              </Text>
            ) : null}
            {/* Tier sub-label for "New" reports so driver knows it's unconfirmed */}
            {tier === "new" && (
              <Text style={[styles.zoneRoad, { color: colors.mutedForeground, fontStyle: "italic" }]}>
                Reported by a driver · unconfirmed
              </Text>
            )}
            {tier === "confirmed" && (
              <Text style={[styles.zoneRoad, { color: colors.mutedForeground }]}>
                {tierLabel(alert.confirmCount)}
              </Text>
            )}
          </View>
        </View>

        {/* Speed badges — only for zone alerts with a speed limit */}
        {hasSpeedBadges && (
          <View style={styles.badgesCol}>
            {/* Driver's current speed */}
            <View style={[styles.speedBadge, { borderColor: speedColor }]}>
              <Text style={[styles.speedLabel, { color: colors.mutedForeground }]}>YOU</Text>
              <Text style={[styles.limitNumber, { color: speedColor, fontSize: 28, lineHeight: 30 }]}>
                {Math.round(currentSpeed)}
              </Text>
              <Text style={[styles.limitUnit, { color: speedColor }]}>km/h</Text>
            </View>

            {/* Speed limit badge */}
            <Animated.View style={[styles.limitBadge, { borderColor: bg, transform: [{ scale: pulse }] }]}>
              <Text style={[styles.limitLabel, { color: colors.mutedForeground }]}>LIMIT</Text>
              <Text style={[styles.limitNumber, { color: bg }]}>{alert.speedLimit}</Text>
              <Text style={[styles.limitUnit, { color: bg }]}>km/h</Text>
              {urgent && <View style={[styles.limitUrgentRing, { borderColor: bg }]} />}
            </Animated.View>
          </View>
        )}

        {/* For report-type alerts with a known speed limit, show just the limit */}
        {!isZone && alert.speedLimit != null && (
          <Animated.View style={[styles.limitBadge, { borderColor: bg, transform: [{ scale: pulse }] }]}>
            <Text style={[styles.limitLabel, { color: colors.mutedForeground }]}>LIMIT</Text>
            <Text style={[styles.limitNumber, { color: bg }]}>{alert.speedLimit}</Text>
            <Text style={[styles.limitUnit, { color: bg }]}>km/h</Text>
          </Animated.View>
        )}
      </View>

      {/* ── Dismiss button ── */}
      <TouchableOpacity
        onPress={onDismiss}
        activeOpacity={0.75}
        style={[styles.dismissBtn, { borderColor: bg }]}
      >
        <Ionicons name="checkmark-circle-outline" size={18} color={bg} />
        <Text style={[styles.dismissTxt, { color: bg }]}>Got it — dismiss</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position:        "absolute",
    left:            0,
    right:           0,
    bottom:          0,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius:  24,
    borderTopRightRadius: 24,
    borderTopWidth:  3,
    borderLeftWidth: 3,
    borderRightWidth: 3,
    shadowColor:    "#000",
    shadowOffset:   { width: 0, height: -6 },
    shadowOpacity:  0.22,
    shadowRadius:   18,
    elevation:      24,
    zIndex: 9999,
  },
  handle: {
    alignSelf:       "center",
    marginTop:       10,
    width:           42,
    height:          4,
    borderRadius:    2,
    backgroundColor: "rgba(0,0,0,0.15)",
  },

  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    flexDirection:  "row",
    alignItems:     "center",
    marginHorizontal: 16,
    marginTop:      12,
    borderRadius:   16,
    paddingHorizontal: 16,
    paddingVertical:   12,
    gap:            12,
  },
  headerEmoji: {
    fontSize: 30,
  },
  headerText: { flex: 1, gap: 2 },
  typeLabel: {
    fontSize:     11,
    fontFamily:   "Inter_700Bold",
    letterSpacing: 1.8,
    color:        "#FFF",
  },
  distLabel: {
    fontSize:   18,
    fontFamily: "Inter_700Bold",
    color:      "#FFF",
  },
  closeBtn: { padding: 2 },

  // ── Body ────────────────────────────────────────────────────────────────
  body: {
    flexDirection:   "row",
    alignItems:      "center",
    marginHorizontal: 16,
    marginTop:       16,
    gap:             12,
  },

  locationRow: {
    flex:           1,
    flexDirection:  "row",
    alignItems:     "flex-start",
    gap:            6,
  },
  zoneName: {
    fontSize:   17,
    fontFamily: "Inter_700Bold",
    flexShrink: 1,
  },
  zoneRoad: {
    fontSize:   13,
    fontFamily: "Inter_400Regular",
    marginTop:  2,
    flexShrink: 1,
  },

  // Speed badges
  badgesCol: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           8,
  },
  speedBadge: {
    width:          76,
    height:         76,
    borderRadius:   38,
    borderWidth:    3,
    alignItems:     "center",
    justifyContent: "center",
    backgroundColor: "#FFF",
  },
  speedLabel: {
    fontSize:   9,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.2,
    marginBottom: -2,
  },
  limitBadge: {
    width:          96,
    height:         96,
    borderRadius:   48,
    borderWidth:    4,
    alignItems:     "center",
    justifyContent: "center",
    backgroundColor: "#FFF",
    position:       "relative",
  },
  limitLabel: {
    fontSize:   9,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.2,
    marginBottom: -2,
  },
  limitNumber: {
    fontSize:   42,
    fontFamily: "Inter_700Bold",
    lineHeight: 44,
    includeFontPadding: false,
  },
  limitUnit: {
    fontSize:   12,
    fontFamily: "Inter_600SemiBold",
    marginTop:  -2,
  },
  limitUrgentRing: {
    position:     "absolute",
    top:          -8,
    left:         -8,
    right:        -8,
    bottom:       -8,
    borderRadius: 58,
    borderWidth:  2,
    opacity:      0.4,
  },

  // ── Confidence tier badge ────────────────────────────────────────────────
  tierBadge: {
    marginTop: 4,
    alignSelf: "flex-start",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tierBadgeTxt: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
  },

  // ── Dismiss button ───────────────────────────────────────────────────────
  dismissBtn: {
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    gap:             8,
    marginHorizontal: 16,
    marginTop:       14,
    paddingVertical: 13,
    borderRadius:    14,
    borderWidth:     1.5,
  },
  dismissTxt: {
    fontSize:   15,
    fontFamily: "Inter_600SemiBold",
  },
});
