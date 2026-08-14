/**
 * GlobalAlertOverlay — slim top-bar alert chip shown on every screen
 * ──────────────────────────────────────────────────────────────────
 * Reads activeAlert / activeAlertExtras from AppContext and fires the
 * same sound + voice as DriveAlertOverlay. Suppresses itself entirely
 * when the Drive tab is active (the Drive tab's full overlay handles it).
 *
 * Rendered as an absolute-positioned chip that floats above all tab
 * content without disrupting navigation layout.
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
import { playSound, getSoundsMuted } from "@/utils/sound";
import { speakAlert, speakAlertMulti, getAlertVoiceDisabled } from "@/utils/alertTts";
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

  // Slide-down animation: chip starts off-screen above, slides in when alert fires.
  const slideY = useRef(new Animated.Value(-120)).current;
  const prevAlertId = useRef<string | null>(null);

  // Suppress on the Drive tab — its own full DriveAlertOverlay handles it there.
  // usePathname() returns "/" for the (tabs)/index screen; the drive tab is "/drive".
  const isOnDriveTab = pathname === "/drive" || pathname === "/(tabs)/drive";

  const visible = !isOnDriveTab && activeAlert != null;

  // ── Animate in/out and trigger sound + voice on new alert ─────────────────
  useEffect(() => {
    if (!activeAlert) {
      // No active alert — slide chip back up off-screen.
      Animated.timing(slideY, {
        toValue: -120,
        duration: 240,
        useNativeDriver: true,
      }).start();
      return;
    }

    if (isOnDriveTab) {
      // Drive tab is showing its own overlay — keep chip hidden, no sound.
      Animated.timing(slideY, { toValue: -120, duration: 0, useNativeDriver: true }).start();
      return;
    }

    const isNew = activeAlert.id !== prevAlertId.current;
    prevAlertId.current = activeAlert.id;

    // Slide in
    Animated.spring(slideY, {
      toValue: 0,
      useNativeDriver: true,
      tension: 60,
      friction: 12,
    }).start();

    // Sound + voice only for new alert IDs (not on subsequent distance updates)
    if (isNew) {
      if (!getSoundsMuted()) {
        playSound("alert").catch(() => {});
      }
      if (!getAlertVoiceDisabled()) {
        const hasExtras = activeAlertExtras.length > 0;
        if (hasExtras) {
          speakAlertMulti(activeAlert.type).catch(() => {});
        } else {
          speakAlert(activeAlert.type).catch(() => {});
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAlert?.id, isOnDriveTab, activeAlertExtras.length]);

  // When Drive tab becomes active while chip is shown, hide immediately.
  useEffect(() => {
    if (isOnDriveTab) {
      Animated.timing(slideY, { toValue: -120, duration: 160, useNativeDriver: true }).start();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnDriveTab]);

  if (!visible) return null;

  const alert = activeAlert!;
  const resolved = resolveIncidentType(alert.type);
  const emoji = alert.source !== "zone" ? resolved.emoji : null;
  const accentColor = urgencyColor(alert.distance, colors);
  const hasExtras = activeAlertExtras.length > 0;

  const distText = alert.alongTrackM != null && alert.alongTrackM < 50
    ? "Passing now"
    : `${formatDist(alert.distance)} ahead`;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          top: insets.top + 6,
          borderColor: accentColor + "88",
          backgroundColor: colors.isDark ? "#0C1610F2" : "#F0FBF4F2",
          transform: [{ translateY: slideY }],
        },
      ]}
      pointerEvents="box-none"
    >
      {/* Alert icon / emoji */}
      <View style={[styles.iconWrap, { backgroundColor: accentColor + "22" }]}>
        {emoji ? (
          <Text style={[styles.emoji, { fontFamily: EMOJI_FONT_FAMILY }]}>{emoji}</Text>
        ) : (
          <Ionicons
            name={resolved.icon as React.ComponentProps<typeof Ionicons>["name"]}
            size={14}
            color={accentColor}
          />
        )}
      </View>

      {/* Label + distance */}
      <View style={styles.textCol}>
        <Text style={[styles.typeLabel, { color: accentColor }]} numberOfLines={1}>
          {resolved.label}
          {hasExtras ? ` +${activeAlertExtras.length}` : ""}
        </Text>
        <Text style={[styles.distLabel, { color: colors.mutedForeground }]} numberOfLines={1}>
          {distText}
        </Text>
      </View>

      {/* Dismiss */}
      <TouchableOpacity
        onPress={dismissAlert}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={[styles.closeBtn, { backgroundColor: colors.isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)" }]}
      >
        <Ionicons name="close" size={14} color={colors.foreground} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position:        "absolute",
    left:            16,
    right:           16,
    flexDirection:   "row",
    alignItems:      "center",
    borderRadius:    28,
    borderWidth:     1,
    paddingVertical: 7,
    paddingLeft:     8,
    paddingRight:    10,
    gap:             8,
    zIndex:          9990,
    // Shadow
    shadowColor:     "#000",
    shadowOffset:    { width: 0, height: 3 },
    shadowOpacity:   0.22,
    shadowRadius:    8,
    elevation:       12,
  },
  iconWrap: {
    width:           28,
    height:          28,
    borderRadius:    14,
    alignItems:      "center",
    justifyContent:  "center",
    flexShrink:      0,
  },
  emoji: {
    fontSize: 14,
    lineHeight: 18,
  },
  textCol: {
    flex:    1,
    gap:     1,
  },
  typeLabel: {
    fontSize:   13,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 16,
  },
  distLabel: {
    fontSize:   11,
    fontFamily: "Inter_400Regular",
    lineHeight: 14,
  },
  closeBtn: {
    width:          24,
    height:         24,
    borderRadius:   12,
    alignItems:     "center",
    justifyContent: "center",
    flexShrink:     0,
  },
});
