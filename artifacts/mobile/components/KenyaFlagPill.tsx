import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, ViewStyle } from "react-native";

/**
 * A pill-shaped button background that cycles through Kenya's flag colours
 * (Red → Black → Green → Red) every 3 seconds.
 *
 * Battery/heat note: the previous implementation used Animated.timing with
 * useNativeDriver:false to interpolate backgroundColor, which fired a JS-thread
 * frame callback at 60 fps continuously.  This version animates only `opacity`
 * on three stacked background layers — opacity IS native-driver-safe, so ALL
 * animation work runs on the native UI thread with zero JS-thread overhead.
 */
const KenyaFlagPill: React.FC<{ style?: ViewStyle; children: React.ReactNode }> = ({
  style,
  children,
}) => {
  const redOpacity   = useRef(new Animated.Value(1)).current;
  const blackOpacity = useRef(new Animated.Value(0)).current;
  const greenOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Each colour is held for HOLD ms then crossfades to the next over FADE ms.
    // Total cycle = 3 × (HOLD + FADE) = 3 000 ms — identical to the old loop.
    const HOLD = 500;
    const FADE = 500;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(HOLD),
        // Red → Black
        Animated.parallel([
          Animated.timing(redOpacity,   { toValue: 0, duration: FADE, useNativeDriver: true }),
          Animated.timing(blackOpacity, { toValue: 1, duration: FADE, useNativeDriver: true }),
        ]),
        Animated.delay(HOLD),
        // Black → Green
        Animated.parallel([
          Animated.timing(blackOpacity, { toValue: 0, duration: FADE, useNativeDriver: true }),
          Animated.timing(greenOpacity, { toValue: 1, duration: FADE, useNativeDriver: true }),
        ]),
        Animated.delay(HOLD),
        // Green → Red
        Animated.parallel([
          Animated.timing(greenOpacity, { toValue: 0, duration: FADE, useNativeDriver: true }),
          Animated.timing(redOpacity,   { toValue: 1, duration: FADE, useNativeDriver: true }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [redOpacity, blackOpacity, greenOpacity]);

  return (
    <View style={[s.pill, style]}>
      {/* Background layers — absolutely fill the pill, crossfade on the UI thread */}
      <Animated.View style={[StyleSheet.absoluteFill, s.red,   { opacity: redOpacity }]} />
      <Animated.View style={[StyleSheet.absoluteFill, s.black, { opacity: blackOpacity }]} />
      <Animated.View style={[StyleSheet.absoluteFill, s.green, { opacity: greenOpacity }]} />
      {/* Content sits above all three layers */}
      {children}
    </View>
  );
};

export default KenyaFlagPill;

const s = StyleSheet.create({
  pill:  { overflow: "hidden" },
  red:   { backgroundColor: "#CE1126" },
  black: { backgroundColor: "#1A1A1A" },
  green: { backgroundColor: "#006600" },
});
