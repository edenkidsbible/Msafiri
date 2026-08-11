/**
 * BackOnlinePill
 *
 * Shows a brief "Back online · data refreshed" pill whenever the app
 * transitions from offline → online. Fades in, holds for ~2 s, then
 * fades out automatically. Positioned at the same location as the
 * OfflineAlertBanner (bottom of screen above map controls) so the
 * driver's eye is already there.
 *
 * Props:
 *   bottomOffset — same convention as OfflineAlertBanner; pass the
 *                  value that places the pill above your map controls.
 */

import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useApp } from "@/context/AppContext";

interface Props {
  /** Absolute distance from the bottom of the container. Matches
   *  OfflineAlertBanner's bottomOffset so the pill appears in the
   *  same spot where the offline pill was. */
  bottomOffset: number;
}

export default function BackOnlinePill({ bottomOffset }: Props) {
  const { isOffline } = useApp();
  const prevOfflineRef = useRef(isOffline);
  const opacity = useRef(new Animated.Value(0)).current;
  const animRef  = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    const wasOffline = prevOfflineRef.current;
    prevOfflineRef.current = isOffline;

    // Only animate on true → false (regained connectivity)
    if (!wasOffline || isOffline) return;

    // Cancel any in-flight animation before restarting
    animRef.current?.stop();
    opacity.setValue(0);

    animRef.current = Animated.sequence([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }),
      Animated.delay(2000),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 420,
        useNativeDriver: true,
      }),
    ]);
    animRef.current.start();
  }, [isOffline]);

  return (
    <Animated.View
      style={[sheet.pill, { bottom: bottomOffset, opacity }]}
      pointerEvents="none"
    >
      <View style={sheet.iconWrap}>
        <Ionicons name="checkmark-circle" size={13} color="#22C55E" />
      </View>
      <Text style={sheet.txt}>Back online · data refreshed</Text>
    </Animated.View>
  );
}

const sheet = StyleSheet.create({
  pill: {
    position:          "absolute",
    left:              40,
    right:             40,
    flexDirection:     "row",
    alignItems:        "center",
    justifyContent:    "center",
    gap:               5,
    paddingVertical:   5,
    paddingHorizontal: 12,
    borderRadius:      20,
    borderWidth:       1,
    backgroundColor:   "#22C55E18",
    borderColor:       "#22C55E40",
    zIndex:            800,
  },
  iconWrap: {
    alignItems:     "center",
    justifyContent: "center",
  },
  txt: {
    fontSize:   11,
    fontFamily: "Inter_600SemiBold",
    color:      "#22C55E",
  },
});
