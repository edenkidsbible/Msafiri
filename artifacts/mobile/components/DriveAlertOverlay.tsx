/**
 * DriveAlertOverlay — bottom-sheet in-drive alert (redesigned)
 * ─────────────────────────────────────────────────────────────
 * SINGLE SOURCE OF TRUTH for all in-drive alert UI while on the Drive tab.
 * Do NOT create a parallel alert component — extend this one.
 *
 * Design principles:
 *  • Distance chip in the header always shows the true signed along-track
 *    value (never "X m ahead" after the driver has passed the pin).
 *  • "Passed ✓" state shown immediately when alongTrackM goes negative.
 *  • Camera priority: when camera is in the cluster it appears first in the
 *    extras list and its audio always plays (handled in AppContext).
 *  • ScrollView body prevents content clipping on small phones.
 *  • No bottom dismiss button — the X in the header is the only dismiss path.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  ScrollView,
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
import { useHeartbeatPulse } from "@/utils/useHeartbeatPulse";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";
import { MarqueeText } from "@/components/MarqueeText";
import { reportTier, freshnessLabel } from "@/lib/freshnessLabel";
import RadarWaveRings from "@/components/RadarWaveRings";

interface Props {
  alert: DriveAlert;
  /** Additional alerts within 1 km of the lead, sorted by distance. */
  extraAlerts?: DriveAlert[];
  onDismiss: () => void;
  /** Called (in addition to onDismiss) when the driver dismisses a cluster. */
  onDismissAll?: () => void;
  currentSpeed: number;
  /**
   * When false the overlay slides out of view (driver stationary). Not dismissed;
   * slides back in when visible returns to true.
   */
  visible?: boolean;
  /**
   * Minimum panel height. Caller passes the drive gauge height so the sheet
   * always covers it exactly. Defaults to 340.
   */
  minPanelHeight?: number;
}

// ── Distance helpers ──────────────────────────────────────────────────────────

function formatDist(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/** Signed along-track → human label + passed flag. */
function distInfo(alert: DriveAlert): { text: string; passed: boolean } {
  const atm = alert.alongTrackM;
  const v   = atm ?? alert.distance;
  if (v < -30) return { text: "Passed ✓", passed: true };
  if (v <  50) return { text: "Here now",  passed: false };
  return { text: formatDist(v), passed: false };
}

// ── Colour helpers ────────────────────────────────────────────────────────────

function urgencyColor(distance: number, colors: ReturnType<typeof useColors>): string {
  if (distance < 200) return colors.speedDanger;
  if (distance < 400) return "#E65100";
  return colors.warning;
}

// ── Type priority for display sorting (camera always first) ───────────────────

const TYPE_PRIORITY: Record<string, number> = { camera: 0, police: 1, alcoblow: 2 };

function sortedExtras(extras: DriveAlert[]): DriveAlert[] {
  return [...extras].sort((a, b) => {
    const pa = TYPE_PRIORITY[a.type] ?? 99;
    const pb = TYPE_PRIORITY[b.type] ?? 99;
    return pa !== pb ? pa - pb : a.distance - b.distance;
  });
}

// Extra-alert distance pill colour
function extraPillColor(m: number): string {
  if (m < 200) return "#E53935";
  if (m < 500) return "#E65100";
  return "#00C853";
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ANIM_OFFSCREEN = 560;

// ── Extra-alert row ───────────────────────────────────────────────────────────

function ExtraAlertRow({
  extra,
  colors,
}: {
  extra: DriveAlert;
  colors: ReturnType<typeof useColors>;
}) {
  const resolved  = resolveIncidentType(extra.type);
  const isZone    = extra.source === "zone";
  const emoji     = !isZone ? resolved.emoji : null;
  const isPassed  = (extra.alongTrackM ?? extra.distance) < -30;
  const pillColor = extraPillColor(extra.distance);
  const { text: distText } = distInfo(extra);

  return (
    <View style={[styles.extraRow, { opacity: isPassed ? 0.35 : 1 }]}>
      {/* Type icon */}
      <View style={[styles.extraIconWrap, { backgroundColor: resolved.color + "1E" }]}>
        {emoji ? (
          <Text style={[styles.extraEmoji, { fontFamily: EMOJI_FONT_FAMILY }]}>{emoji}</Text>
        ) : (
          <Ionicons
            name={resolved.icon as React.ComponentProps<typeof Ionicons>["name"]}
            size={15}
            color={resolved.color}
          />
        )}
      </View>

      {/* Name */}
      <Text style={[styles.extraName, { color: colors.foreground }]} numberOfLines={1}>
        {resolved.label}
      </Text>

      {/* Distance chip */}
      <View style={[
        styles.extraDistPill,
        { backgroundColor: (isPassed ? colors.mutedForeground : pillColor) + "1E",
          borderColor:     (isPassed ? colors.mutedForeground : pillColor) + "55" },
      ]}>
        <Text style={[styles.extraDistTxt, {
          color: isPassed ? colors.mutedForeground : pillColor,
        }]}>
          {distText}
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
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const slideY  = useRef(new Animated.Value(ANIM_OFFSCREEN)).current;
  const prevId  = useRef<string | null>(null);
  const activeIdRef = useRef(alert.id);
  const [dismissing, setDismissing] = useState(false);
  const isFirstRenderRef = useRef(true);

  const hasExtras     = extraAlerts.length > 0;
  const sortedExtrasArr = sortedExtras(extraAlerts);

  useEffect(() => { activeIdRef.current = alert.id; }, [alert.id]);

  const visibleRef = useRef(visible);
  useEffect(() => { visibleRef.current = visible; }, [visible]);

  // ── Distance + urgency ────────────────────────────────────────────────────
  const { text: distText, passed: isPassed } = distInfo(alert);
  const effectiveDist  = alert.alongTrackM ?? alert.distance;
  const urgent         = !isPassed && effectiveDist < 200;
  const accentColor    = isPassed
    ? colors.mutedForeground
    : urgencyColor(effectiveDist, colors);
  const pulse          = useHeartbeatPulse(urgent && !dismissing);

  // ── Alert type ────────────────────────────────────────────────────────────
  const isZone    = alert.source === "zone";
  const resolved  = resolveIncidentType(alert.type);
  const typeLabel = resolved.label;
  const typeIcon  = resolved.icon as React.ComponentProps<typeof Ionicons>["name"];
  const emoji     = !isZone ? resolved.emoji : null;

  // The live speed comparison belongs exclusively to speed-camera alerts.
  // Other zone types can carry a speedLimit for matching/alert logic, but
  // showing it here makes police, hazards, and roadworks look like cameras.
  // Keep the card for a camera even when its submitted limit is missing so the
  // driver still gets the useful live-speed readout.
  const isCamera       = alert.type === "camera";
  const hasSpeedBadges = isCamera && alert.speedLimit != null;
  const showSpeedCard  = isCamera;
  const overLimit      = hasSpeedBadges && currentSpeed > alert.speedLimit!;
  const speedColor     = overLimit ? colors.speedDanger : "#2E7D32";

  const tier        = !isZone ? reportTier(alert.confirmCount) : null;

  const sheetBg = colors.isDark ? "#0C1610F5" : "#F5FAF6F8";

  // ── Slide-in when a new alert appears ────────────────────────────────────
  useEffect(() => {
    if (alert.id !== prevId.current) {
      prevId.current = alert.id;
      setDismissing(false);
      slideY.setValue(ANIM_OFFSCREEN);
      if (visibleRef.current) {
        Animated.spring(slideY, {
          toValue: 0, useNativeDriver: true, tension: 58, friction: 10,
        }).start();
      }
    }
  }, [alert.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Show / hide when driver stops / starts moving ────────────────────────
  useEffect(() => {
    if (isFirstRenderRef.current) { isFirstRenderRef.current = false; return; }
    if (dismissing) return;
    Animated.spring(slideY, {
      toValue: visible ? 0 : ANIM_OFFSCREEN,
      useNativeDriver: true, tension: 58, friction: 10,
    }).start();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dismiss ───────────────────────────────────────────────────────────────
  const handleDismiss = () => {
    const dismissedId = alert.id;
    const wasCluster  = hasExtras;
    setDismissing(true);
    Animated.timing(slideY, {
      toValue: ANIM_OFFSCREEN, duration: 260, useNativeDriver: true,
    }).start(() => {
      if (activeIdRef.current === dismissedId) {
        onDismiss();
        if (wasCluster) onDismissAll?.();
      }
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Animated.View
      style={[
        styles.sheet,
        {
          minHeight:       minPanelHeight,
          paddingBottom:   insets.bottom + 16,
          borderTopColor:  isPassed ? (colors.isDark ? "#2A3A2E" : "#C8DCC8") : accentColor,
          backgroundColor: sheetBg,
          transform:       [{ translateY: slideY }],
        },
      ]}
    >
      {/* ── Handle pill ── */}
      <View style={[styles.handle, {
        backgroundColor: colors.isDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.12)",
      }]} />

      {/* ── Header: orb + labels + distance chip + dismiss ── */}
      <View style={styles.headerRow}>
        {/* Alert type orb — radar waves radiate outward when approaching */}
        <View style={styles.orbWrap}>
          {/* Radar rings: shown when < 500 m away and not yet passed */}
          <RadarWaveRings
            color={accentColor}
            size={52}
            active={!isPassed && effectiveDist < 500}
          />
          <Animated.View style={[styles.alertOrb, {
            backgroundColor: accentColor + "1E",
            borderColor:     accentColor + "50",
            transform:       [{ scale: urgent ? pulse : 1 }],
          }]}>
            {emoji ? (
              <Text style={[styles.orbEmoji, { fontFamily: EMOJI_FONT_FAMILY }]}>{emoji}</Text>
            ) : (
              <Ionicons name={typeIcon} size={26} color={accentColor} />
            )}
          </Animated.View>
        </View>

        {/* Type + sub-info */}
        <View style={styles.headerTextCol}>
          <Text style={[styles.typeLabel, { color: accentColor }]} numberOfLines={1}>
            {typeLabel}
          </Text>

          {/* Distance as primary subtitle — replaces the old distChip pill */}
          <Text style={[styles.subLabel, { color: colors.mutedForeground }]} numberOfLines={1}>
            {distText}
          </Text>

          {!isZone && alert.source === "report" && tier && tier !== "new" && (
            <View style={[styles.tierChip, {
              backgroundColor: tier === "reliable" ? "#00C85318" : "#FFD60018",
              borderColor:     tier === "reliable" ? "#00C85350" : "#FFD60050",
            }]}>
              <Ionicons
                name={tier === "reliable" ? "shield-checkmark" : "checkmark-circle"}
                size={10}
                color={tier === "reliable" ? "#00C853" : "#D4A000"}
              />
              <Text style={[styles.tierChipTxt, {
                color: tier === "reliable" ? "#00C853" : "#D4A000",
              }]}>
                {tier === "reliable" ? "Highly reliable" : "Confirmed"}
              </Text>
            </View>
          )}
          {alert.source === "here" && (
            <View style={styles.liveBadge}>
              <Text style={styles.liveBadgeTxt}>LIVE</Text>
            </View>
          )}
        </View>

        {/* Dismiss */}
        <TouchableOpacity
          onPress={handleDismiss}
          hitSlop={{ top: 16, bottom: 16, left: 12, right: 12 }}
          style={[styles.closeBtn, {
            backgroundColor: colors.isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.06)",
          }]}
        >
          <Ionicons name="close" size={17} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      {/* ── Accent divider ── */}
      <View style={[styles.divider, {
        backgroundColor: isPassed
          ? (colors.isDark ? "#1E2E22" : "#D8EAD8")
          : accentColor + "30",
      }]} />

      {/* ── Scrollable body — prevents clipping on small phones ── */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={false} // disabled until content actually overflows
        nestedScrollEnabled
      >

        {/* ── Speed comparison card (speed-camera alerts only) ── */}
        {showSpeedCard && (
          <View style={[styles.speedCard, {
            backgroundColor: colors.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
            borderColor:     colors.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)",
          }]}>
            {/* YOUR SPEED — always shown */}
            <View style={[styles.speedHalf, !hasSpeedBadges && styles.speedHalfFull]}>
              <Text style={[styles.speedLabel, { color: colors.mutedForeground }]}>YOUR SPEED</Text>
              <View style={styles.speedNumRow}>
                <Text style={[styles.speedNum, { color: speedColor }]}>
                  {Math.round(currentSpeed)}
                </Text>
                <Text style={[styles.speedUnit, { color: speedColor }]}>km/h</Text>
              </View>
              {overLimit && (
                <View style={[styles.overLimitChip, {
                  backgroundColor: colors.speedDanger + "18",
                  borderColor:     colors.speedDanger + "50",
                }]}>
                  <Ionicons name="warning" size={11} color={colors.speedDanger} />
                  <Text style={[styles.overLimitTxt, { color: colors.speedDanger }]}>OVER LIMIT</Text>
                </View>
              )}
            </View>

            {/* Vertical divider + SPEED LIMIT — only when a limit is stored */}
            {hasSpeedBadges && (
              <>
                <View style={[styles.speedVdiv, {
                  backgroundColor: colors.isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.08)",
                }]} />
                <Animated.View style={[styles.speedHalf, { transform: [{ scale: urgent ? pulse : 1 }] }]}>
                  <Text style={[styles.speedLabel, { color: colors.mutedForeground }]}>SPEED LIMIT</Text>
                  <View style={styles.speedNumRow}>
                    <Text style={[styles.speedNum, {
                      color: isPassed ? colors.mutedForeground : accentColor,
                    }]}>
                      {alert.speedLimit}
                    </Text>
                    <Text style={[styles.speedUnit, {
                      color: isPassed ? colors.mutedForeground : accentColor,
                    }]}>km/h</Text>
                  </View>
                  {urgent && !isPassed && (
                    <View style={[styles.limitRing, { borderColor: accentColor + "50" }]} />
                  )}
                </Animated.View>
              </>
            )}
          </View>
        )}

        {/* ── Location name + road (all alerts) ── */}
        <View style={[styles.locationRow, {
          backgroundColor: colors.isDark ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.025)",
          borderColor:     colors.isDark ? "rgba(255,255,255,0.07)"  : "rgba(0,0,0,0.055)",
        }]}>
          <View style={[styles.locationIconWrap, { backgroundColor: accentColor + "1E" }]}>
            <Ionicons name="location-sharp" size={14} color={accentColor} />
          </View>
          <View style={{ flex: 1 }}>
            <MarqueeText style={[styles.locationName, { color: colors.foreground }]}>
              {alert.name}
            </MarqueeText>
            {alert.road ? (
              <MarqueeText style={[styles.locationRoad, { color: colors.mutedForeground }]}>
                {alert.road}
              </MarqueeText>
            ) : null}
            {/* Freshness label for community reports */}
            {alert.source === "report" && (
              <Text style={[styles.locationRoad, {
                color: alert.observationContext === "community_tip"
                  ? "#FF9800"
                  : tier === "reliable" ? "#22C55E" : colors.mutedForeground,
                fontStyle: tier === "new" && alert.observationContext !== "community_tip"
                  ? "italic"
                  : "normal",
              }]}>
                {freshnessLabel(alert.confirmCount, alert.createdAt, alert.observationContext)}
              </Text>
            )}
          </View>
        </View>

        {/* ── Multi-alert extras ── */}
        {hasExtras && (
          <>
            <View style={[styles.extrasHeader, {
              borderBottomColor: colors.isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)",
            }]}>
              <View style={[styles.extrasCountChip, {
                backgroundColor: accentColor + "18",
                borderColor:     accentColor + "40",
              }]}>
                <Text style={[styles.extrasCountTxt, { color: accentColor }]}>
                  +{sortedExtrasArr.length} nearby
                </Text>
              </View>
              <Text style={[styles.extrasHint, { color: colors.mutedForeground }]}>
                along your route
              </Text>
            </View>
            <View style={styles.extrasList}>
              {sortedExtrasArr.map((extra) => (
                <ExtraAlertRow key={extra.id} extra={extra} colors={colors} />
              ))}
            </View>
          </>
        )}

      </ScrollView>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  sheet: {
    position:             "absolute",
    left:                 0,
    right:                0,
    bottom:               0,
    borderTopLeftRadius:  26,
    borderTopRightRadius: 26,
    borderTopWidth:       3,
    shadowColor:          "#000",
    shadowOffset:         { width: 0, height: -10 },
    shadowOpacity:        0.28,
    shadowRadius:         22,
    elevation:            30,
    zIndex:               9999,
  },

  handle: {
    alignSelf:    "center",
    marginTop:    10,
    width:        36,
    height:       4,
    borderRadius: 2,
  },

  // ── Header ──────────────────────────────────────────────────────────────────
  headerRow: {
    flexDirection:    "row",
    alignItems:       "center",
    marginHorizontal: 14,
    marginTop:        12,
    gap:              10,
  },
  orbWrap: {
    width:          52,
    height:         52,
    flexShrink:     0,
    alignItems:     "center",
    justifyContent: "center",
    overflow:       "visible",
  },
  alertOrb: {
    width:          52,
    height:         52,
    borderRadius:   16,
    alignItems:     "center",
    justifyContent: "center",
  },
  orbEmoji: { fontSize: 28 },
  headerTextCol: {
    flex: 1,
    gap:  3,
    minWidth: 0,
  },
  typeLabel: {
    fontSize:      18,
    fontFamily:    "Inter_700Bold",
    letterSpacing: 0.1,
    flexShrink:    1,
  },
  subLabel: {
    fontSize:   13,
    fontFamily: "Inter_400Regular",
    marginTop:  1,
  },
  tierChip: {
    flexDirection:    "row",
    alignItems:       "center",
    gap:              4,
    alignSelf:        "flex-start",
    borderWidth:      1,
    borderRadius:     6,
    paddingHorizontal: 6,
    paddingVertical:  2,
    marginTop:        4,
  },
  tierChipTxt: {
    fontSize:      10,
    fontFamily:    "Inter_600SemiBold",
    letterSpacing: 0.3,
  },
  liveBadge: {
    backgroundColor:  "#D32F2F",
    borderRadius:     4,
    paddingHorizontal: 5,
    paddingVertical:  1,
    alignSelf:        "flex-start",
    marginTop:        4,
  },
  liveBadgeTxt: {
    fontSize:      9,
    fontFamily:    "Inter_700Bold",
    color:         "#FFF",
    letterSpacing: 0.8,
  },

  // Distance chip — replaces the old "X m ahead" text label
  distChip: {
    flexDirection:    "row",
    alignItems:       "center",
    borderWidth:      1.5,
    borderRadius:     10,
    paddingHorizontal: 10,
    paddingVertical:  6,
    flexShrink:       0,
  },
  distChipTxt: {
    fontSize:      13,
    fontFamily:    "Inter_700Bold",
    letterSpacing: 0.2,
  },

  closeBtn: {
    width:          32,
    height:         32,
    borderRadius:   16,
    alignItems:     "center",
    justifyContent: "center",
    flexShrink:     0,
  },

  // Divider
  divider: {
    height:           1.5,
    marginHorizontal: 14,
    marginTop:        12,
    borderRadius:     1,
  },

  // ── Body ─────────────────────────────────────────────────────────────────────
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 14,
    paddingTop:        10,
    gap:               10,
  },

  // ── Speed comparison card ─────────────────────────────────────────────────
  speedCard: {
    flexDirection: "row",
    borderRadius:  18,
    borderWidth:   1,
    overflow:      "hidden",
  },
  speedHalf: {
    flex:           1,
    alignItems:     "center",
    justifyContent: "center",
    paddingVertical:   22,
    paddingHorizontal: 10,
    position:       "relative",
    gap:            2,
  },
  /** Used when only YOUR SPEED is shown (no stored limit). */
  speedHalfFull: {
    flex: 1, // already full-width; no companion column
  },
  speedLabel: {
    fontSize:      11,
    fontFamily:    "Inter_700Bold",
    letterSpacing: 1.6,
  },
  speedNumRow: {
    flexDirection: "row",
    alignItems:    "flex-end",
    gap:           4,
    marginTop:     3,
  },
  speedNum: {
    fontSize:           72,
    fontFamily:         "Inter_700Bold",
    lineHeight:         74,
    includeFontPadding: false,
  },
  speedUnit: {
    fontSize:      15,
    fontFamily:    "Inter_600SemiBold",
    marginBottom:  9,
  },
  overLimitChip: {
    flexDirection:    "row",
    alignItems:       "center",
    gap:              3,
    marginTop:        6,
    paddingHorizontal: 8,
    paddingVertical:  3,
    borderRadius:     7,
    borderWidth:      1,
  },
  overLimitTxt: {
    fontSize:      9,
    fontFamily:    "Inter_700Bold",
    letterSpacing: 0.8,
  },
  speedVdiv: {
    width:          1,
    marginVertical: 14,
  },
  limitRing: {
    position:     "absolute",
    top:          8,
    left:         8,
    right:        8,
    bottom:       8,
    borderRadius: 100,
    borderWidth:  2,
    opacity:      0.35,
  },

  // ── Location row ──────────────────────────────────────────────────────────
  locationRow: {
    flexDirection:    "row",
    alignItems:       "center",
    gap:              10,
    paddingHorizontal: 12,
    paddingVertical:  11,
    borderRadius:     13,
    borderWidth:      1,
  },
  locationIconWrap: {
    width:          30,
    height:         30,
    borderRadius:   9,
    alignItems:     "center",
    justifyContent: "center",
    flexShrink:     0,
  },
  locationName: {
    fontSize:   14,
    fontFamily: "Inter_600SemiBold",
    flexShrink: 1,
  },
  locationRoad: {
    fontSize:   12,
    fontFamily: "Inter_400Regular",
    marginTop:  2,
    flexShrink: 1,
  },

  // ── Multi-alert extras ────────────────────────────────────────────────────
  extrasHeader: {
    flexDirection:  "row",
    alignItems:     "center",
    gap:            8,
    paddingBottom:  9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginTop:      2,
  },
  extrasCountChip: {
    borderRadius:     7,
    borderWidth:      1,
    paddingHorizontal: 8,
    paddingVertical:  3,
  },
  extrasCountTxt: {
    fontSize:      11,
    fontFamily:    "Inter_700Bold",
    letterSpacing: 0.4,
  },
  extrasHint: {
    fontSize:   12,
    fontFamily: "Inter_400Regular",
  },
  extrasList: {
    gap: 1,
  },
  extraRow: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           10,
    paddingVertical: 7,
  },
  extraIconWrap: {
    width:          34,
    height:         34,
    borderRadius:   10,
    alignItems:     "center",
    justifyContent: "center",
    flexShrink:     0,
  },
  extraEmoji: {
    fontSize:  16,
    textAlign: "center",
  },
  extraName: {
    flex:       1,
    fontSize:   14,
    fontFamily: "Inter_500Medium",
  },
  extraDistPill: {
    borderWidth:      1.5,
    borderRadius:     7,
    paddingHorizontal: 8,
    paddingVertical:  3,
    flexShrink:       0,
  },
  extraDistTxt: {
    fontSize:   12,
    fontFamily: "Inter_700Bold",
  },
});
