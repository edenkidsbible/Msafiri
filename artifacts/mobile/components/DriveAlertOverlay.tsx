/**
 * DriveAlertOverlay — CANONICAL in-drive alert component
 * ───────────────────────────────────────────────────────
 * This is the SINGLE SOURCE OF TRUTH for all speed/zone/hazard alerts shown
 * to the driver while driving. All in-drive alert UI lives here.
 *
 * ⚠️  If you need a new alert type or new alert behaviour, extend THIS component
 *     (or its DriveAlert interface in AppContext) — do NOT create a parallel
 *     alert component (e.g. AlertBanner or similar). Parallel alert paths cause
 *     silent duplication, missed dismissals, and z-index conflicts.
 *
 * Full-width bottom panel that slides up when the driver approaches a speed
 * camera, police check, speed zone, or community-reported hazard.
 *
 * Urgency tiers (based on distance):
 *   • 1000–400 m  →  yellow  (warning)
 *   •  400–200 m  →  orange  (caution)
 *   •    < 200 m  →  red     (danger, pulsing)
 *
 * When extraAlerts is non-empty (multi-alert cluster), the overlay renders
 * a stacked layout:
 *   • Lead section: full camera gauge OR standard header (unchanged)
 *   • Divider
 *   • Compact rows for each extra (emoji + name + distance)
 *   • "Got it — dismiss all" button
 *
 * Height:
 *   The caller passes `minPanelHeight` — computed from the drive gauge's
 *   measured size — so the sheet always covers the gauge area exactly,
 *   making it the dominant element on screen while the alert is active.
 */

import React, { useEffect, useRef, useState } from "react";
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
import { useHeartbeatPulse } from "@/utils/useHeartbeatPulse";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";

interface Props {
  alert: DriveAlert;
  /** Additional alerts within 1 km of the lead, sorted by distance. */
  extraAlerts?: DriveAlert[];
  onDismiss: () => void;
  /** Called (in addition to onDismiss) when the driver taps "Got it — dismiss
   *  all" on a multi-alert cluster. Use this to surface the re-arm hint. */
  onDismissAll?: () => void;
  currentSpeed: number;
  /**
   * Minimum panel height in points. The caller should pass a value that
   * covers the drive gauge so the overlay is dominant while active.
   * Defaults to 340 if omitted.
   */
  minPanelHeight?: number;
}

// Distance at which an alert is considered "passed" (driver is inside/past it)
const IN_ZONE_DIST = 250; // metres — must match AppContext constant

// ── Confidence tier helpers ───────────────────────────────────────────────────

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

function tierBg(baseBg: string, tier: "new" | "confirmed" | "reliable"): string {
  if (tier === "new") return "#8D6E63";
  return baseBg;
}

// ── Zone-type helpers ─────────────────────────────────────────────────────────

function urgencyColor(distance: number, colors: ReturnType<typeof useColors>) {
  if (distance < 200) return colors.speedDanger;
  if (distance < 400) return "#E65100";
  return colors.warning;
}

function formatDist(m: number) {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

// The sheet always starts off-screen by at least this much before animating in.
const ANIM_OFFSCREEN = 520;

// ── Extra-alert compact row ───────────────────────────────────────────────────

function ExtraAlertRow({ extra, colors }: { extra: DriveAlert; colors: ReturnType<typeof useColors> }) {
  const resolved = resolveIncidentType(extra.type);
  const isZone = extra.source === "zone";
  const emoji = !isZone ? resolved.emoji : null;
  const isPassed = extra.distance < IN_ZONE_DIST;
  const opacity = isPassed ? 0.35 : 1;

  return (
    <View style={[styles.extraRow, { opacity, borderColor: colors.border }]}>
      {emoji ? (
        <Text style={styles.extraEmoji}>{emoji}</Text>
      ) : (
        <Ionicons
          name={resolved.icon as React.ComponentProps<typeof Ionicons>["name"]}
          size={18}
          color={colors.mutedForeground}
        />
      )}
      <Text style={[styles.extraName, { color: colors.text }]} numberOfLines={1}>
        {resolved.label}
      </Text>
      <Text style={[styles.extraDist, { color: colors.mutedForeground }]}>
        {formatDist(extra.distance)}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function DriveAlertOverlay({
  alert,
  extraAlerts = [],
  onDismiss,
  onDismissAll,
  currentSpeed,
  minPanelHeight = 340,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slideY       = useRef(new Animated.Value(ANIM_OFFSCREEN)).current;
  const prevId       = useRef<string | null>(null);
  // Always holds the latest alert.id so the dismiss callback can compare.
  const activeIdRef  = useRef(alert.id);
  const [dismissing, setDismissing] = useState(false);

  const hasExtras = extraAlerts.length > 0;

  // Keep activeIdRef in sync with the prop so the callback sees the current ID.
  useEffect(() => { activeIdRef.current = alert.id; }, [alert.id]);

  const urgent = alert.distance < 200;
  const bg     = urgencyColor(alert.distance, colors);
  // Stop pulsing the instant the driver taps dismiss — don't wait for unmount.
  const pulse  = useHeartbeatPulse(urgent && !dismissing);

  // ── Slide in + sound on first appearance of a new alert ──────────────────
  useEffect(() => {
    if (alert.id !== prevId.current) {
      prevId.current = alert.id;
      setDismissing(false);          // reset for the incoming alert
      slideY.setValue(ANIM_OFFSCREEN);
      Animated.spring(slideY, {
        toValue:         0,
        useNativeDriver: true,
        tension:         58,
        friction:        10,
      }).start();
      void playSound("alert");
    }
  }, [alert.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dismiss: stop pulse immediately, slide out, then notify parent ─────────
  const handleDismiss = () => {
    const dismissedId = alert.id;
    const wasCluster  = hasExtras; // capture now — avoids stale closure on animation end
    setDismissing(true);
    Animated.timing(slideY, {
      toValue:         ANIM_OFFSCREEN,
      duration:        280,
      useNativeDriver: true,
    }).start(() => {
      if (activeIdRef.current === dismissedId) {
        onDismiss();
        // For cluster dismissals, fire the secondary callback so the parent can
        // surface a brief re-arm hint ("Alerts paused near this area for 10 min").
        if (wasCluster) onDismissAll?.();
      }
    });
  };

  // ── Resolve display values ────────────────────────────────────────────────
  const isZone    = alert.source === "zone";
  const resolved  = resolveIncidentType(alert.type);
  const typeLabel = resolved.label;
  const typeIcon  = resolved.icon as React.ComponentProps<typeof Ionicons>["name"];
  const emoji = !isZone ? resolved.emoji : null;

  const hasSpeedBadges = isZone && alert.speedLimit != null;
  const overLimit      = hasSpeedBadges && currentSpeed > alert.speedLimit!;
  const speedColor     = overLimit ? colors.speedDanger : "#2E7D32";

  const tier        = !isZone ? reportTier(alert.confirmCount) : null;
  const effectiveBg = tier ? tierBg(bg, tier) : bg;

  return (
    <Animated.View
      style={[
        styles.sheet,
        {
          minHeight:       minPanelHeight,
          paddingBottom:   insets.bottom + 16,
          borderColor:     bg,
          backgroundColor: colors.card,
          transform:       [{ translateY: slideY }],
        },
      ]}
    >
      {/* ── Handle pill ── */}
      <View style={styles.handle} />

      {/* ── Header: coloured band with icon + label + distance + close ── */}
      <View style={[styles.header, { backgroundColor: effectiveBg }]}>
        {emoji ? (
          <Text style={[styles.headerEmoji, { fontFamily: EMOJI_FONT_FAMILY }]}>{emoji}</Text>
        ) : (
          <Ionicons name={typeIcon} size={34} color="#FFF" />
        )}
        <View style={styles.headerText}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={styles.typeLabel}>{typeLabel.toUpperCase()}</Text>
            {alert.source === "here" && (
              <View style={styles.liveBadge}>
                <Text style={styles.liveBadgeTxt}>LIVE</Text>
              </View>
            )}
          </View>
          <Text style={styles.distLabel}>
            {alert.alongTrackM != null && alert.alongTrackM < 0
              ? "Behind you"
              : alert.alongTrackM != null && alert.alongTrackM < 50
                ? "Passing now"
                : `${formatDist(alert.distance)} ahead`}
          </Text>
          {tier && tier !== "new" && (
            <View style={[
              styles.tierBadge,
              { backgroundColor: tier === "reliable" ? "#00C853" : "#FFD600" },
            ]}>
              <Text style={[
                styles.tierBadgeTxt,
                { color: tier === "reliable" ? "#FFF" : "#333" },
              ]}>
                {tier === "reliable" ? "✓ Highly Reliable" : "✓ Confirmed"}
              </Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          onPress={handleDismiss}
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          style={styles.closeBtn}
        >
          <Ionicons name="close-circle" size={28} color="rgba(255,255,255,0.85)" />
        </TouchableOpacity>
      </View>

      {/* ── Full-width speed comparison — zone alerts only ── */}
      {hasSpeedBadges && (
        <View style={[styles.speedCompare, { borderColor: bg + "45" }]}>

          {/* Left half: driver's current speed */}
          <View style={styles.speedHalf}>
            <Text style={[styles.speedHalfLbl, { color: colors.mutedForeground }]}>
              YOUR SPEED
            </Text>
            <Text style={[styles.speedHalfNum, { color: speedColor }]}>
              {Math.round(currentSpeed)}
            </Text>
            <Text style={[styles.speedHalfUnit, { color: speedColor }]}>km/h</Text>
            {overLimit && (
              <View style={[styles.overLimitPill, { backgroundColor: colors.speedDanger }]}>
                <Text style={styles.overLimitTxt}>OVER LIMIT</Text>
              </View>
            )}
          </View>

          <View style={[styles.speedVdiv, { backgroundColor: bg + "38" }]} />

          {/* Right half: speed limit (pulses in danger zone) */}
          <Animated.View style={[styles.speedHalf, { transform: [{ scale: pulse }] }]}>
            <Text style={[styles.speedHalfLbl, { color: colors.mutedForeground }]}>
              SPEED LIMIT
            </Text>
            <Text style={[styles.speedHalfNum, { color: bg }]}>
              {alert.speedLimit}
            </Text>
            <Text style={[styles.speedHalfUnit, { color: bg }]}>km/h</Text>
            {urgent && (
              <View style={[styles.limitUrgentRing, { borderColor: bg }]} />
            )}
          </Animated.View>
        </View>
      )}

      {/* ── Speed limit row for report-type alerts that have a known limit ── */}
      {!isZone && alert.speedLimit != null && (
        <View style={[styles.reportLimitRow, {
          backgroundColor: bg + "14",
          borderColor:     bg + "38",
        }]}>
          <Ionicons name="speedometer-outline" size={20} color={bg} />
          <Text style={[styles.reportLimitLbl, { color: colors.mutedForeground }]}>
            Speed limit at hazard:
          </Text>
          <Animated.View style={{ transform: [{ scale: pulse }] }}>
            <Text style={[styles.reportLimitNum, { color: bg }]}>
              {alert.speedLimit} km/h
            </Text>
          </Animated.View>
        </View>
      )}

      {/* ── Location name + road (single-alert only, skip when extras present to save space) ── */}
      {!hasExtras && (
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
      )}

      {/* ── Extra alerts section (multi-alert cluster) ── */}
      {hasExtras && (
        <>
          <View style={[styles.extraDivider, { backgroundColor: colors.border }]} />
          <View style={styles.extraList}>
            {extraAlerts.map((extra) => (
              <ExtraAlertRow key={extra.id} extra={extra} colors={colors} />
            ))}
          </View>
        </>
      )}

      {/* ── Dismiss button (filled — more actionable than outline) ── */}
      <TouchableOpacity
        onPress={handleDismiss}
        activeOpacity={0.8}
        style={[styles.dismissBtn, { backgroundColor: bg }]}
      >
        <Ionicons name="checkmark-circle-outline" size={19} color="#FFF" />
        <Text style={styles.dismissTxt}>
          {hasExtras ? "Got it — dismiss all" : "Got it — dismiss"}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position:            "absolute",
    left:                0,
    right:               0,
    bottom:              0,
    borderTopLeftRadius:  26,
    borderTopRightRadius: 26,
    borderTopWidth:      3,
    borderLeftWidth:     3,
    borderRightWidth:    3,
    shadowColor:         "#000",
    shadowOffset:        { width: 0, height: -8 },
    shadowOpacity:       0.26,
    shadowRadius:        22,
    elevation:           30,
    zIndex:              9999,
  },
  handle: {
    alignSelf:       "center",
    marginTop:       10,
    width:           44,
    height:          4,
    borderRadius:    2,
    backgroundColor: "rgba(0,0,0,0.15)",
  },

  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    flexDirection:     "row",
    alignItems:        "center",
    marginHorizontal:  16,
    marginTop:         12,
    borderRadius:      16,
    paddingHorizontal: 16,
    paddingVertical:   14,
    gap:               12,
  },
  headerEmoji: { fontSize: 32 },
  headerText:  { flex: 1, gap: 2 },
  typeLabel: {
    fontSize:     11,
    fontFamily:   "Inter_700Bold",
    letterSpacing: 1.8,
    color:        "#FFF",
  },
  distLabel: {
    fontSize:   20,
    fontFamily: "Inter_700Bold",
    color:      "#FFF",
  },
  closeBtn: { padding: 2 },
  liveBadge: {
    backgroundColor: "#D32F2F",
    borderRadius:    4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  liveBadgeTxt: {
    fontSize:     9,
    fontFamily:   "Inter_700Bold",
    color:        "#FFF",
    letterSpacing: 0.8,
  },

  // ── Full-width speed comparison (zone alerts) ────────────────────────────
  speedCompare: {
    flexDirection:    "row",
    marginHorizontal: 16,
    marginTop:        14,
    borderRadius:     18,
    borderWidth:      1.5,
    overflow:         "hidden",
  },
  speedHalf: {
    flex:           1,
    alignItems:     "center",
    justifyContent: "center",
    paddingVertical:   22,
    paddingHorizontal: 8,
    position:       "relative",
  },
  speedVdiv: {
    width:         1.5,
    marginVertical: 18,
  },
  speedHalfLbl: {
    fontSize:      9,
    fontFamily:    "Inter_700Bold",
    letterSpacing: 1.4,
    marginBottom:  4,
  },
  speedHalfNum: {
    fontSize:           58,
    fontFamily:         "Inter_700Bold",
    lineHeight:         60,
    includeFontPadding: false,
  },
  speedHalfUnit: {
    fontSize:   13,
    fontFamily: "Inter_600SemiBold",
    marginTop:  2,
  },
  overLimitPill: {
    marginTop:         8,
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderRadius:      8,
  },
  overLimitTxt: {
    fontSize:      9,
    fontFamily:    "Inter_700Bold",
    color:         "#FFF",
    letterSpacing: 1,
  },
  limitUrgentRing: {
    position:     "absolute",
    top:          8,
    left:         8,
    right:        8,
    bottom:       8,
    borderRadius: 120,
    borderWidth:  2,
    opacity:      0.32,
  },

  // ── Speed limit inline row for report alerts ─────────────────────────────
  reportLimitRow: {
    flexDirection:     "row",
    alignItems:        "center",
    marginHorizontal:  16,
    marginTop:         14,
    gap:               8,
    paddingHorizontal: 14,
    paddingVertical:   11,
    borderRadius:      12,
    borderWidth:       1,
  },
  reportLimitLbl: {
    flex:       1,
    fontSize:   13,
    fontFamily: "Inter_500Medium",
  },
  reportLimitNum: {
    fontSize:   16,
    fontFamily: "Inter_700Bold",
  },

  // ── Location ─────────────────────────────────────────────────────────────
  locationRow: {
    flexDirection:    "row",
    alignItems:       "flex-start",
    marginHorizontal: 16,
    marginTop:        14,
    gap:              6,
  },
  zoneName: {
    fontSize:   16,
    fontFamily: "Inter_700Bold",
    flexShrink: 1,
  },
  zoneRoad: {
    fontSize:   13,
    fontFamily: "Inter_400Regular",
    marginTop:  2,
    flexShrink: 1,
  },

  // ── Confidence tier badge ────────────────────────────────────────────────
  tierBadge: {
    marginTop:         4,
    alignSelf:         "flex-start",
    borderRadius:      6,
    paddingHorizontal: 6,
    paddingVertical:   2,
  },
  tierBadgeTxt: {
    fontSize:      10,
    fontFamily:    "Inter_700Bold",
    letterSpacing: 0.5,
  },

  // ── Extra alerts (multi-alert cluster) ───────────────────────────────────
  extraDivider: {
    height:           1,
    marginHorizontal: 16,
    marginTop:        12,
  },
  extraList: {
    marginHorizontal: 16,
    marginTop:        8,
    gap:              2,
  },
  extraRow: {
    flexDirection:    "row",
    alignItems:       "center",
    gap:              10,
    paddingVertical:  9,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  extraEmoji: {
    fontSize:   18,
    width:      24,
    textAlign:  "center",
  },
  extraName: {
    flex:       1,
    fontSize:   14,
    fontFamily: "Inter_500Medium",
  },
  extraDist: {
    fontSize:   13,
    fontFamily: "Inter_600SemiBold",
  },

  // ── Dismiss button (solid fill) ──────────────────────────────────────────
  dismissBtn: {
    flexDirection:    "row",
    alignItems:       "center",
    justifyContent:   "center",
    gap:              8,
    marginHorizontal: 16,
    marginTop:        16,
    paddingVertical:  15,
    borderRadius:     14,
  },
  dismissTxt: {
    fontSize:   15,
    fontFamily: "Inter_600SemiBold",
    color:      "#FFF",
  },
});
