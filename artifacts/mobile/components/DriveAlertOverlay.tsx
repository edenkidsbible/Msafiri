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
 *   • Compact rows for each extra (emoji + name + distance pill)
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
// Note: alert chime (playSound) is now fired from AppContext alongside
// speakAlert so both sounds are triggered from a single call site, preventing
// the race condition where overlay and AppContext played sounds independently.
import { useHeartbeatPulse } from "@/utils/useHeartbeatPulse";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";
import { MarqueeText } from "@/components/MarqueeText";

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
   * When false the overlay slides out of view (driver is stationary — no need
   * to show alerts until they start moving again). The alert is NOT dismissed;
   * it slides back in automatically when visible returns to true.
   * Defaults to true.
   */
  visible?: boolean;
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

import { reportTier, freshnessLabel } from "@/lib/freshnessLabel";

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

// Extra-alert distance pill color
function distPillColor(m: number): string {
  if (m < 200) return "#E53935";
  if (m < 500) return "#E65100";
  return "#00C853";
}

// The sheet always starts off-screen by at least this much before animating in.
const ANIM_OFFSCREEN = 520;

// ── Extra-alert compact row ───────────────────────────────────────────────────

function ExtraAlertRow({ extra, colors }: { extra: DriveAlert; colors: ReturnType<typeof useColors> }) {
  const resolved = resolveIncidentType(extra.type);
  const isZone   = extra.source === "zone";
  const emoji    = !isZone ? resolved.emoji : null;
  const isPassed = extra.distance < IN_ZONE_DIST;
  const pillColor = distPillColor(extra.distance);

  return (
    <View style={[styles.extraRow, { opacity: isPassed ? 0.38 : 1 }]}>
      <View style={[styles.extraIconWrap, { backgroundColor: resolved.color + "22" }]}>
        {emoji ? (
          <Text style={[styles.extraEmoji, { fontFamily: EMOJI_FONT_FAMILY }]}>{emoji}</Text>
        ) : (
          <Ionicons
            name={resolved.icon as React.ComponentProps<typeof Ionicons>["name"]}
            size={16}
            color={resolved.color}
          />
        )}
      </View>
      <Text style={[styles.extraName, { color: colors.foreground }]} numberOfLines={1}>
        {resolved.label}
      </Text>
      <View style={[styles.extraDistPill, {
        backgroundColor: pillColor + "20",
        borderColor:     pillColor + "55",
      }]}>
        <Text style={[styles.extraDistTxt, { color: pillColor }]}>
          {formatDist(extra.distance)}
        </Text>
      </View>
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
  visible = true,
  minPanelHeight = 340,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slideY       = useRef(new Animated.Value(ANIM_OFFSCREEN)).current;
  const prevId       = useRef<string | null>(null);
  const activeIdRef  = useRef(alert.id);
  const [dismissing, setDismissing] = useState(false);

  const hasExtras = extraAlerts.length > 0;

  useEffect(() => { activeIdRef.current = alert.id; }, [alert.id]);

  const visibleRef = useRef(visible);
  useEffect(() => { visibleRef.current = visible; }, [visible]);

  const isFirstRenderRef = useRef(true);

  const urgent      = alert.distance < 200;
  const accentColor = urgencyColor(alert.distance, colors);
  const pulse       = useHeartbeatPulse(urgent && !dismissing);

  // ── Slide in + sound on first appearance of a new alert ──────────────────
  useEffect(() => {
    if (alert.id !== prevId.current) {
      prevId.current = alert.id;
      setDismissing(false);
      slideY.setValue(ANIM_OFFSCREEN);
      if (visibleRef.current) {
        Animated.spring(slideY, {
          toValue: 0, useNativeDriver: true,
          tension: 58, friction: 10,
        }).start();
      }
    }
  }, [alert.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Show / hide based on driver motion ───────────────────────────────────
  useEffect(() => {
    if (isFirstRenderRef.current) { isFirstRenderRef.current = false; return; }
    if (dismissing) return;
    if (visible) {
      Animated.spring(slideY, {
        toValue: 0, useNativeDriver: true,
        tension: 58, friction: 10,
      }).start();
    } else {
      Animated.timing(slideY, {
        toValue: ANIM_OFFSCREEN, duration: 280, useNativeDriver: true,
      }).start();
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dismiss ───────────────────────────────────────────────────────────────
  const handleDismiss = () => {
    const dismissedId = alert.id;
    const wasCluster  = hasExtras;
    setDismissing(true);
    Animated.timing(slideY, {
      toValue: ANIM_OFFSCREEN, duration: 280, useNativeDriver: true,
    }).start(() => {
      if (activeIdRef.current === dismissedId) {
        onDismiss();
        if (wasCluster) onDismissAll?.();
      }
    });
  };

  // ── Resolve display values ────────────────────────────────────────────────
  const isZone    = alert.source === "zone";
  const resolved  = resolveIncidentType(alert.type);
  const typeLabel = resolved.label;
  const typeIcon  = resolved.icon as React.ComponentProps<typeof Ionicons>["name"];
  const emoji     = !isZone ? resolved.emoji : null;

  const hasSpeedBadges = isZone && alert.speedLimit != null;
  const overLimit      = hasSpeedBadges && currentSpeed > alert.speedLimit!;
  const speedColor     = overLimit ? colors.speedDanger : "#2E7D32";

  const tier        = !isZone ? reportTier(alert.confirmCount) : null;
  const effectiveBg = tier ? tierBg(accentColor, tier) : accentColor;

  // Sheet glass background — matches the top alert banner's treatment
  const sheetBg = colors.isDark ? "#0C1610F5" : "#F6FBF8F8";

  return (
    <Animated.View
      style={[
        styles.sheet,
        {
          minHeight:       minPanelHeight,
          paddingBottom:   insets.bottom + 20,
          borderTopColor:  effectiveBg,
          backgroundColor: sheetBg,
          transform:       [{ translateY: slideY }],
        },
      ]}
    >
      {/* ── Handle pill ── */}
      <View style={[styles.handle, {
        backgroundColor: colors.isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.14)",
      }]} />

      {/* ── Header: glow orb + type + distance + close ── */}
      <View style={styles.headerRow}>
        {/* Alert type orb — pulses when urgent */}
        <Animated.View style={[styles.alertOrb, {
          backgroundColor: effectiveBg + "22",
          borderColor:     effectiveBg + "55",
          transform:       [{ scale: urgent ? pulse : 1 }],
        }]}>
          {emoji ? (
            <Text style={[styles.orbEmoji, { fontFamily: EMOJI_FONT_FAMILY }]}>{emoji}</Text>
          ) : (
            <Ionicons name={typeIcon} size={28} color={effectiveBg} />
          )}
        </Animated.View>

        {/* Text column */}
        <View style={styles.headerTextCol}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={[styles.typeLabel, { color: effectiveBg }]}>
              {typeLabel}
            </Text>
            {alert.source === "here" && (
              <View style={styles.liveBadge}>
                <Text style={styles.liveBadgeTxt}>LIVE</Text>
              </View>
            )}
          </View>
          <Text style={[styles.distLabel, { color: colors.mutedForeground }]}>
            {`${formatDist(alert.distance)} ahead`}
          </Text>
          {tier && tier !== "new" && (
            <View style={[styles.tierBadge, {
              backgroundColor: tier === "reliable" ? "#00C85322" : "#FFD60022",
              borderColor:     tier === "reliable" ? "#00C85360" : "#FFD60060",
            }]}>
              <Ionicons
                name={tier === "reliable" ? "shield-checkmark" : "checkmark-circle"}
                size={10}
                color={tier === "reliable" ? "#00C853" : "#D4A000"}
              />
              <Text style={[styles.tierBadgeTxt, {
                color: tier === "reliable" ? "#00C853" : "#D4A000",
              }]}>
                {tier === "reliable" ? "Highly Reliable" : "Confirmed"}
              </Text>
            </View>
          )}
        </View>

        {/* Close button */}
        <TouchableOpacity
          onPress={handleDismiss}
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          style={[styles.closeBtn, {
            backgroundColor: colors.isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)",
          }]}
        >
          <Ionicons name="close" size={18} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      {/* Hairline accent divider */}
      <View style={[styles.accentDivider, { backgroundColor: effectiveBg + "38" }]} />

      {/* ── Speed comparison — zone alerts only ── */}
      {hasSpeedBadges && (
        <View style={[styles.speedCompare, {
          backgroundColor: colors.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
          borderColor:     colors.isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.08)",
        }]}>
          {/* Your speed */}
          <View style={styles.speedHalf}>
            <Text style={[styles.speedHalfLbl, { color: colors.mutedForeground }]}>
              YOUR SPEED
            </Text>
            <Text style={[styles.speedHalfNum, { color: speedColor }]}>
              {Math.round(currentSpeed)}
            </Text>
            <Text style={[styles.speedHalfUnit, { color: speedColor }]}>km/h</Text>
            {overLimit && (
              <View style={[styles.overLimitPill, {
                backgroundColor: colors.speedDanger + "20",
                borderColor:     colors.speedDanger + "55",
              }]}>
                <Ionicons name="warning" size={9} color={colors.speedDanger} />
                <Text style={[styles.overLimitTxt, { color: colors.speedDanger }]}>
                  OVER LIMIT
                </Text>
              </View>
            )}
          </View>

          <View style={[styles.speedVdiv, {
            backgroundColor: colors.isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.09)",
          }]} />

          {/* Speed limit — pulses when urgent */}
          <Animated.View style={[styles.speedHalf, { transform: [{ scale: pulse }] }]}>
            <Text style={[styles.speedHalfLbl, { color: colors.mutedForeground }]}>
              SPEED LIMIT
            </Text>
            <Text style={[styles.speedHalfNum, { color: effectiveBg }]}>
              {alert.speedLimit}
            </Text>
            <Text style={[styles.speedHalfUnit, { color: effectiveBg }]}>km/h</Text>
            {urgent && (
              <View style={[styles.limitUrgentRing, { borderColor: effectiveBg + "55" }]} />
            )}
          </Animated.View>
        </View>
      )}

      {/* ── Speed limit inline row — report-type alerts with a known limit ── */}
      {!isZone && alert.speedLimit != null && (
        <View style={[styles.reportLimitRow, {
          backgroundColor: effectiveBg + "12",
          borderColor:     effectiveBg + "30",
        }]}>
          <Ionicons name="speedometer-outline" size={18} color={effectiveBg} />
          <Text style={[styles.reportLimitLbl, { color: colors.mutedForeground }]}>
            Speed limit at hazard
          </Text>
          <Animated.View style={{ transform: [{ scale: pulse }] }}>
            <Text style={[styles.reportLimitNum, { color: effectiveBg }]}>
              {alert.speedLimit} km/h
            </Text>
          </Animated.View>
        </View>
      )}

      {/* ── Location name + road (single alert only) ── */}
      {!hasExtras && (
        <View style={[styles.locationRow, {
          backgroundColor: colors.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
          borderColor:     colors.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
        }]}>
          <View style={[styles.locationIconWrap, { backgroundColor: effectiveBg + "22" }]}>
            <Ionicons name="location-sharp" size={15} color={effectiveBg} />
          </View>
          <View style={{ flex: 1 }}>
            <MarqueeText style={[styles.zoneName, { color: colors.foreground }]}>
              {alert.name}
            </MarqueeText>
            {alert.road ? (
              <MarqueeText style={[styles.zoneRoad, { color: colors.mutedForeground }]}>
                {alert.road}
              </MarqueeText>
            ) : null}
            {/* Freshness + confidence label for community reports */}
            {alert.source === "report" && (
              <Text style={[
                styles.zoneRoad,
                {
                  color: alert.observationContext === "community_tip"
                    ? "#FF9800"
                    : tier === "reliable" ? "#22C55E" : colors.mutedForeground,
                  fontStyle: tier === "new" && alert.observationContext !== "community_tip" ? "italic" : "normal",
                },
              ]}>
                {freshnessLabel(alert.confirmCount, alert.createdAt, alert.observationContext)}
              </Text>
            )}
          </View>
        </View>
      )}

      {/* ── Extra alerts section (multi-alert cluster) ── */}
      {hasExtras && (
        <>
          <View style={[styles.extraHeader, {
            borderBottomColor: colors.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)",
          }]}>
            <View style={[styles.extraCountPill, {
              backgroundColor: effectiveBg + "20",
              borderColor:     effectiveBg + "45",
            }]}>
              <Text style={[styles.extraCountTxt, { color: effectiveBg }]}>
                +{extraAlerts.length} nearby
              </Text>
            </View>
            <Text style={[styles.extraHeaderHint, { color: colors.mutedForeground }]}>
              along your route
            </Text>
          </View>
          <View style={styles.extraList}>
            {extraAlerts.map((extra) => (
              <ExtraAlertRow key={extra.id} extra={extra} colors={colors} />
            ))}
          </View>
        </>
      )}

      {/* ── Dismiss button — always app-green to match brand CTA ── */}
      <TouchableOpacity
        onPress={handleDismiss}
        activeOpacity={0.82}
        style={styles.dismissBtn}
      >
        <Ionicons name="checkmark-circle" size={18} color="#FFF" />
        <Text style={styles.dismissTxt}>
          {hasExtras ? "Got it — dismiss all" : "Got it"}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position:             "absolute",
    left:                 0,
    right:                0,
    bottom:               0,
    borderTopLeftRadius:  28,
    borderTopRightRadius: 28,
    borderTopWidth:       2.5,
    shadowColor:          "#000",
    shadowOffset:         { width: 0, height: -10 },
    shadowOpacity:        0.30,
    shadowRadius:         24,
    elevation:            30,
    zIndex:               9999,
  },
  handle: {
    alignSelf:    "center",
    marginTop:    10,
    width:        40,
    height:       4,
    borderRadius: 2,
  },

  // ── Header ──────────────────────────────────────────────────────────────
  headerRow: {
    flexDirection: "row",
    alignItems:    "center",
    marginHorizontal: 16,
    marginTop:     14,
    gap:           12,
  },
  alertOrb: {
    width:          64,
    height:         64,
    borderRadius:   20,
    borderWidth:    1,
    alignItems:     "center",
    justifyContent: "center",
  },
  orbEmoji: { fontSize: 32 },
  headerTextCol: { flex: 1, gap: 2 },
  typeLabel: {
    fontSize:      17,
    fontFamily:    "Inter_700Bold",
    letterSpacing: 0.2,
  },
  distLabel: {
    fontSize:           14,
    fontFamily:         "Inter_500Medium",
    lineHeight:         18,
    includeFontPadding: false,
    marginTop:          1,
  },
  closeBtn: {
    width:          34,
    height:         34,
    borderRadius:   17,
    alignItems:     "center",
    justifyContent: "center",
  },
  liveBadge: {
    backgroundColor:  "#D32F2F",
    borderRadius:     4,
    paddingHorizontal: 5,
    paddingVertical:  1,
  },
  liveBadgeTxt: {
    fontSize:      9,
    fontFamily:    "Inter_700Bold",
    color:         "#FFF",
    letterSpacing: 0.8,
  },
  tierBadge: {
    flexDirection:    "row",
    alignItems:       "center",
    gap:              4,
    alignSelf:        "flex-start",
    borderWidth:      1,
    borderRadius:     7,
    paddingHorizontal: 6,
    paddingVertical:  2,
    marginTop:        5,
  },
  tierBadgeTxt: {
    fontSize:      10,
    fontFamily:    "Inter_600SemiBold",
    letterSpacing: 0.3,
  },

  accentDivider: {
    height:           1,
    marginHorizontal: 16,
    marginTop:        14,
  },

  // ── Speed comparison ──────────────────────────────────────────────────
  speedCompare: {
    flexDirection:    "row",
    marginHorizontal: 16,
    marginTop:        12,
    borderRadius:     20,
    borderWidth:      1,
    overflow:         "hidden",
  },
  speedHalf: {
    flex:           1,
    alignItems:     "center",
    justifyContent: "center",
    paddingVertical:   20,
    paddingHorizontal: 8,
    position:       "relative",
  },
  speedVdiv: {
    width:          1,
    marginVertical: 18,
  },
  speedHalfLbl: {
    fontSize:      9,
    fontFamily:    "Inter_700Bold",
    letterSpacing: 1.4,
    marginBottom:  4,
  },
  speedHalfNum: {
    fontSize:           54,
    fontFamily:         "Inter_700Bold",
    lineHeight:         56,
    includeFontPadding: false,
  },
  speedHalfUnit: {
    fontSize:   12,
    fontFamily: "Inter_600SemiBold",
    marginTop:  2,
  },
  overLimitPill: {
    flexDirection:    "row",
    alignItems:       "center",
    gap:              3,
    marginTop:        8,
    paddingHorizontal: 8,
    paddingVertical:  3,
    borderRadius:     8,
    borderWidth:      1,
  },
  overLimitTxt: {
    fontSize:      9,
    fontFamily:    "Inter_700Bold",
    letterSpacing: 0.8,
  },
  limitUrgentRing: {
    position:     "absolute",
    top:          8,
    left:         8,
    right:        8,
    bottom:       8,
    borderRadius: 100,
    borderWidth:  2,
    opacity:      0.4,
  },

  // ── Report-type speed limit row ───────────────────────────────────────
  reportLimitRow: {
    flexDirection:    "row",
    alignItems:       "center",
    marginHorizontal: 16,
    marginTop:        12,
    gap:              10,
    paddingHorizontal: 14,
    paddingVertical:  11,
    borderRadius:     14,
    borderWidth:      1,
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

  // ── Location name + road ──────────────────────────────────────────────
  locationRow: {
    flexDirection:    "row",
    alignItems:       "center",
    marginHorizontal: 16,
    marginTop:        12,
    gap:              10,
    paddingHorizontal: 14,
    paddingVertical:  12,
    borderRadius:     14,
    borderWidth:      1,
  },
  locationIconWrap: {
    width:          32,
    height:         32,
    borderRadius:   10,
    alignItems:     "center",
    justifyContent: "center",
  },
  zoneName: {
    fontSize:   15,
    fontFamily: "Inter_700Bold",
    flexShrink: 1,
  },
  zoneRoad: {
    fontSize:   12,
    fontFamily: "Inter_400Regular",
    marginTop:  2,
    flexShrink: 1,
  },

  // ── Extra alerts cluster ──────────────────────────────────────────────
  extraHeader: {
    flexDirection:  "row",
    alignItems:     "center",
    gap:            8,
    marginHorizontal: 16,
    marginTop:      14,
    paddingBottom:  10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  extraCountPill: {
    borderRadius:     8,
    borderWidth:      1,
    paddingHorizontal: 8,
    paddingVertical:  3,
  },
  extraCountTxt: {
    fontSize:      11,
    fontFamily:    "Inter_700Bold",
    letterSpacing: 0.5,
  },
  extraHeaderHint: {
    fontSize:   12,
    fontFamily: "Inter_400Regular",
  },
  extraList: {
    marginHorizontal: 16,
    marginTop:        6,
    gap:              2,
  },
  extraRow: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           10,
    paddingVertical: 8,
  },
  extraIconWrap: {
    width:          36,
    height:         36,
    borderRadius:   10,
    alignItems:     "center",
    justifyContent: "center",
  },
  extraEmoji: {
    fontSize:  17,
    textAlign: "center",
  },
  extraName: {
    flex:       1,
    fontSize:   14,
    fontFamily: "Inter_500Medium",
  },
  extraDistPill: {
    borderWidth:      1,
    borderRadius:     8,
    paddingHorizontal: 8,
    paddingVertical:  3,
  },
  extraDistTxt: {
    fontSize:   12,
    fontFamily: "Inter_700Bold",
  },

  // ── Dismiss button — always app-green ────────────────────────────────
  dismissBtn: {
    flexDirection:    "row",
    alignItems:       "center",
    justifyContent:   "center",
    gap:              8,
    marginHorizontal: 16,
    marginTop:        16,
    paddingVertical:  15,
    borderRadius:     16,
    backgroundColor:  "#00C853",
    shadowColor:      "#00C853",
    shadowOffset:     { width: 0, height: 4 },
    shadowOpacity:    0.35,
    shadowRadius:     10,
    elevation:        6,
  },
  dismissTxt: {
    fontSize:   15,
    fontFamily: "Inter_700Bold",
    color:      "#FFF",
  },
});
