/**
 * RadarWaveRings — three concentric expanding circles that pulse outward
 * from a central point, giving a "radar / sonar" effect.
 *
 * Render this inside a View that has `overflow: 'visible'` so the rings
 * extend beyond the parent's bounds. Position it with `position: 'absolute'`
 * and use negative margins or `alignSelf: 'center'` to centre it over the
 * icon/orb it decorates.
 *
 * Props:
 *   color     — ring stroke colour (matched to the alert accent colour)
 *   size      — diameter of the inner-most ring; outer rings scale from this
 *   active    — when false, animation stops and rings are hidden (default true)
 */

import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

interface Props {
  color:   string;
  /** Diameter (px) of the innermost ring. Outer rings scale to 1.6× and 2.4×. */
  size?:   number;
  active?: boolean;
}

export default function RadarWaveRings({ color, size = 60, active = true }: Props) {
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const ring3 = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!active) {
      animRef.current?.stop();
      ring1.setValue(0);
      ring2.setValue(0);
      ring3.setValue(0);
      return;
    }

    const CYCLE = 1600; // ms per full expand
    const makeRing = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: CYCLE, useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 0,     useNativeDriver: true }),
        ]),
      );

    const anim = Animated.parallel([
      makeRing(ring1, 0),
      makeRing(ring2, CYCLE / 3),
      makeRing(ring3, (CYCLE / 3) * 2),
    ]);
    animRef.current = anim;
    anim.start();

    return () => {
      anim.stop();
      ring1.setValue(0);
      ring2.setValue(0);
      ring3.setValue(0);
    };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) return null;

  const ringStyle = (val: Animated.Value, maxScale: number) => ({
    position: "absolute" as const,
    width:    size,
    height:   size,
    borderRadius: size / 2,
    borderWidth:  2,
    borderColor:  color,
    transform: [{ scale: val.interpolate({ inputRange: [0, 1], outputRange: [1, maxScale] }) }],
    opacity:   val.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 0.7, 0.3, 0] }),
  });

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, styles.center]}
    >
      <Animated.View style={ringStyle(ring1, 2.8)} />
      <Animated.View style={ringStyle(ring2, 2.2)} />
      <Animated.View style={ringStyle(ring3, 1.6)} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems:     "center",
    justifyContent: "center",
    overflow:       "visible",
  },
});
