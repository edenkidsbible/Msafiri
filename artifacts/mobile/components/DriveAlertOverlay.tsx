/**
 * DriveAlertOverlay
 * ─────────────────
 * Full-width bottom panel that slides up when the driver approaches a speed
 * camera, police check, or speed zone. Replaces the old small AlertBanner.
 *
 * Urgency tiers (based on distance):
 *   • 1000–400 m  →  yellow  (warning)
 *   •  400–200 m  →  orange  (caution)
 *   •    < 200 m  →  red     (danger, pulsing speed-limit badge)
 */

import React, { useEffect, useRef } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { SpeedZone } from "@/data/speedZones";
import { playSound } from "@/utils/sound";

type AlertZone = SpeedZone & { distance: number };

interface Props {
  zone: AlertZone;
  onDismiss: () => void;
  currentSpeed: number;
}

const TYPE_LABELS  = { camera: "Speed Camera", police: "Police Check", zone: "Speed Zone" } as const;
const TYPE_ICONS   = { camera: "camera"  as const, police: "shield" as const, zone: "warning" as const };
const ICON_SIZES   = { camera: 36, police: 34, zone: 34 };

function urgencyColor(distance: number, colors: ReturnType<typeof useColors>) {
  if (distance < 200) return colors.speedDanger;          // red
  if (distance < 400) return "#E65100";                   // deep orange
  return colors.warning;                                   // yellow/amber
}

function formatDist(m: number) {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export default function DriveAlertOverlay({ zone, onDismiss, currentSpeed }: Props) {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const slideY  = useRef(new Animated.Value(340)).current;
  const pulse   = useRef(new Animated.Value(1)).current;
  const prevId  = useRef<string | null>(null);
  const prevUrgent = useRef(false);

  const urgent = zone.distance < 200;
  const bg     = urgencyColor(zone.distance, colors);

  // ── Slide in on first appearance of a new zone ────────────────────────────
  useEffect(() => {
    if (zone.id !== prevId.current) {
      prevId.current = zone.id;
      slideY.setValue(340);
      Animated.spring(slideY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 60,
        friction: 10,
      }).start();
      playSound("alert");
    }
  }, [zone.id]);

  // ── Start pulsing when entering the 200 m danger zone ────────────────────
  useEffect(() => {
    if (urgent && !prevUrgent.current) {
      prevUrgent.current = true;
      playSound("alert");
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
  }, [urgent]);

  return (
    <Animated.View
      style={[
        styles.sheet,
        {
          paddingBottom: insets.bottom + 12,
          borderColor: bg,
          transform: [{ translateY: slideY }],
        },
      ]}
    >
      {/* ── Handle pill ── */}
      <View style={styles.handle} />

      {/* ── Header: icon  +  type label  +  distance  +  close ── */}
      <View style={[styles.header, { backgroundColor: bg }]}>
        <Ionicons name={TYPE_ICONS[zone.type]} size={ICON_SIZES[zone.type]} color="#FFF" />
        <View style={styles.headerText}>
          <Text style={styles.typeLabel}>{TYPE_LABELS[zone.type].toUpperCase()}</Text>
          <Text style={styles.distLabel}>{formatDist(zone.distance)} ahead</Text>
        </View>
        <TouchableOpacity
          onPress={onDismiss}
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          style={styles.closeBtn}
        >
          <Ionicons name="close-circle" size={28} color="rgba(255,255,255,0.85)" />
        </TouchableOpacity>
      </View>

      {/* ── Body: location name  +  speed badges ── */}
      <View style={styles.body}>
        {/* Location */}
        <View style={styles.locationRow}>
          <Ionicons name="location-sharp" size={16} color={bg} style={{ marginTop: 1 }} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.zoneName, { color: colors.text }]} numberOfLines={1}>
              {zone.name}
            </Text>
            {zone.road ? (
              <Text style={[styles.zoneRoad, { color: colors.mutedForeground }]} numberOfLines={1}>
                {zone.road}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Speed badges — driver speed + limit side by side */}
        <View style={styles.badgesCol}>
          {/* Driver's current speed */}
          {(() => {
            const overLimit = zone.speedLimit != null && currentSpeed > zone.speedLimit;
            const speedColor = overLimit ? colors.speedDanger : "#2E7D32";
            return (
              <View style={[styles.speedBadge, { borderColor: speedColor }]}>
                <Text style={[styles.speedLabel, { color: colors.mutedForeground }]}>YOU</Text>
                <Text style={[styles.limitNumber, { color: speedColor, fontSize: 28, lineHeight: 30 }]}>
                  {Math.round(currentSpeed)}
                </Text>
                <Text style={[styles.limitUnit, { color: speedColor }]}>km/h</Text>
              </View>
            );
          })()}

          {/* Speed limit badge */}
          <Animated.View
            style={[
              styles.limitBadge,
              { borderColor: bg, transform: [{ scale: pulse }] },
            ]}
          >
            <Text style={[styles.limitLabel, { color: colors.mutedForeground }]}>LIMIT</Text>
            <Text style={[styles.limitNumber, { color: bg }]}>{zone.speedLimit}</Text>
            <Text style={[styles.limitUnit, { color: bg }]}>km/h</Text>
            {urgent && (
              <View style={[styles.limitUrgentRing, { borderColor: bg }]} />
            )}
          </Animated.View>
        </View>
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
    // shadow
    shadowColor:    "#000",
    shadowOffset:   { width: 0, height: -6 },
    shadowOpacity:  0.22,
    shadowRadius:   18,
    elevation:      24,
    // ensure it's above everything else
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

  // Two badges side-by-side: driver speed + speed limit
  badgesCol: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           8,
  },

  // Driver's current speed — same circle shape as limit badge but smaller
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

  // Speed limit circle
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
