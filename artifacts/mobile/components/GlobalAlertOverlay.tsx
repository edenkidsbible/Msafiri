/**
 * GlobalAlertOverlay — prominent alert banner shown on every non-drive screen
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads activeAlert / activeAlertExtras from AppContext and displays a card
 * matching the drive-screen top banner style: large emoji, type name, distance
 * chip, and urgency-coloured border.
 *
 * Audio (chime + voice) is intentionally NOT fired here. AppContext's
 * isNewAlert block fires playSound("alert") + speakAlert(type) for every
 * screen — duplicating audio here would cause double-play.
 *
 * Suppresses itself on the Drive tab where DriveAlertOverlay handles display.
 * Rendered as an absolute-positioned banner that floats above all tab content.
 */

import React, { useEffect, useRef } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { resolveIncidentType } from "@/constants/incidentTypes";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";

// ── Distance formatter ────────────────────────────────────────────────────────

function formatDist(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

// ── Urgency colour ────────────────────────────────────────────────────────────

function urgencyColor(distance: number, colors: ReturnType<typeof useColors>): string {
  if (distance < 200) return colors.speedDanger;
  if (distance < 400) return "#E65100";
  return colors.warning;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function GlobalAlertOverlay() {
  const pathname = usePathname();
  const { activeAlert, activeAlertExtras, dismissAlert } = useApp();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  // Slide-down animation: banner starts off-screen above, slides in when active.
  const slideY = useRef(new Animated.Value(-180)).current;
  const prevAlertId = useRef<string | null>(null);

  // Suppress on the Drive tab — DriveAlertOverlay handles it there.
  const isOnDriveTab = pathname === "/drive" || pathname === "/(tabs)/drive";
  // Hide once the driver has passed the alert pin (>100 m behind). AppContext's
  // shouldDismiss path will eventually clear activeAlert entirely, but the UI
  // gate here gives an immediate visual response so the banner never shows an
  // ever-increasing "behind you" distance while the dismissal logic catches up.
  const isAlertPassed = activeAlert != null &&
    activeAlert.alongTrackM != null &&
    activeAlert.alongTrackM < -100;
  const visible = !isOnDriveTab && activeAlert != null && !isAlertPassed;

  // ── Animate in/out ────────────────────────────────────────────────────────
  // Audio is handled entirely by AppContext (isNewAlert block). This effect
  // is responsible only for sliding the banner in and out.
  useEffect(() => {
    if (!activeAlert || isOnDriveTab || isAlertPassed) {
      Animated.timing(slideY, {
        toValue: -180,
        duration: 260,
        useNativeDriver: true,
      }).start();
      return;
    }

    prevAlertId.current = activeAlert.id;

    Animated.spring(slideY, {
      toValue: 0,
      useNativeDriver: true,
      tension: 55,
      friction: 11,
    }).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAlert?.id, isOnDriveTab, isAlertPassed]);

  // Hide immediately when switching to the Drive tab
  useEffect(() => {
    if (isOnDriveTab) {
      Animated.timing(slideY, { toValue: -180, duration: 160, useNativeDriver: true }).start();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnDriveTab]);

  if (!visible) return null;

  const alert = activeAlert!;
  const resolved = resolveIncidentType(alert.type);
  const accentColor = urgencyColor(alert.distance, colors);
  const hasExtras = activeAlertExtras.length > 0;
  const isDark = colors.isDark;

  // Distance display — prefer the signed along-track value (decreases as driver
  // approaches, goes negative once passed) over haversine (always positive, rises
  // when moving away — confusing after a pass-through).
  const distText = (() => {
    const atm = alert.alongTrackM;
    if (atm != null) {
      if (atm < 0) return "Just passed";   // between -100 m and 0 (not yet hidden)
      if (atm < 50) return "Passing now";
      return `${formatDist(atm)} ahead`;
    }
    // No heading yet — fall back to haversine
    return alert.distance < 50 ? "Passing now" : `${formatDist(alert.distance)} ahead`;
  })();

  return (
    <Animated.View
      style={[
        styles.container,
        {
          top: insets.top + 8,
          backgroundColor: isDark ? "#101613F5" : "#FFFFFFF5",
          borderColor: accentColor + "99",
          borderLeftColor: accentColor,
          transform: [{ translateY: slideY }],
        },
      ]}
      pointerEvents="box-none"
    >
      {/* Coloured left-edge accent bar */}
      <View style={[styles.leftBar, { backgroundColor: accentColor }]} />

      {/* Alert icon / emoji */}
      <View style={[styles.iconWrap, { backgroundColor: accentColor + "20" }]}>
        <Text style={[styles.emoji, { fontFamily: EMOJI_FONT_FAMILY }]}>
          {resolved.emoji}
        </Text>
      </View>

      {/* Label + distance */}
      <View style={styles.textCol}>
        <Text style={[styles.typeLabel, { color: accentColor }]} numberOfLines={1}>
          {resolved.label}
          {hasExtras ? ` +${activeAlertExtras.length}` : ""}
        </Text>
        <View style={styles.distRow}>
          <Text style={[styles.distValue, { color: accentColor }]}>
            {distText}
          </Text>
          {alert.speedLimit != null && (
            <View style={[styles.limitBadge, { backgroundColor: accentColor + "20", borderColor: accentColor + "60" }]}>
              <Text style={[styles.limitTxt, { color: accentColor }]}>{alert.speedLimit} km/h</Text>
            </View>
          )}
        </View>
      </View>

      {/* Dismiss */}
      <TouchableOpacity
        onPress={dismissAlert}
        hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        style={[styles.closeBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.07)" }]}
      >
        <Ionicons name="close" size={15} color={colors.foreground} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position:        "absolute",
    left:            12,
    right:           12,
    flexDirection:   "row",
    alignItems:      "center",
    borderRadius:    16,
    borderWidth:     1,
    borderLeftWidth: 4,
    overflow:        "hidden",
    paddingVertical: 11,
    paddingLeft:     10,
    paddingRight:    12,
    gap:             10,
    zIndex:          9990,
    // Shadow
    shadowColor:     "#000",
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.25,
    shadowRadius:    10,
    elevation:       14,
  },
  leftBar: {
    position:     "absolute",
    left:         0,
    top:          0,
    bottom:       0,
    width:        4,
  },
  iconWrap: {
    width:           46,
    height:          46,
    borderRadius:    13,
    alignItems:      "center",
    justifyContent:  "center",
    flexShrink:      0,
  },
  emoji: {
    fontSize:   24,
    lineHeight: 28,
  },
  textCol: {
    flex: 1,
    gap:  3,
  },
  typeLabel: {
    fontSize:   15,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 18,
  },
  distRow: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           6,
    flexWrap:      "wrap",
  },
  distValue: {
    fontSize:   12,
    fontFamily: "Inter_700Bold",
    lineHeight: 15,
  },
  limitBadge: {
    borderRadius:    6,
    borderWidth:     1,
    paddingHorizontal: 6,
    paddingVertical:   1,
  },
  limitTxt: {
    fontSize:   11,
    fontFamily: "Inter_600SemiBold",
  },
  closeBtn: {
    width:          28,
    height:         28,
    borderRadius:   14,
    alignItems:     "center",
    justifyContent: "center",
    flexShrink:     0,
  },
});
