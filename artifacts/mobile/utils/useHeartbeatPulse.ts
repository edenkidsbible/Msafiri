/**
 * useHeartbeatPulse
 * ─────────────────
 * Returns an Animated.Value that loops a cardiac "lub-dub" scale sequence
 * while `active` is true, and resets to 1 when deactivated.
 *
 * Sequence (≈ 900 ms total):
 *   1.0 → 1.07  (lub up, 120 ms)
 *   1.07 → 1.0  (lub down, 100 ms)
 *   1.0 → 1.05  (dub up, 100 ms)
 *   1.05 → 1.0  (dub down, 100 ms)
 *   rest at 1.0 (480 ms pause)
 *
 * Usage:
 *   const pulse = useHeartbeatPulse(active);
 *   <Animated.View style={{ transform: [{ scale: pulse }] }}>…</Animated.View>
 */

import { useEffect, useRef } from "react";
import { Animated } from "react-native";

export function useHeartbeatPulse(active: boolean): Animated.Value {
  const anim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (active) {
      const loop = Animated.loop(
        Animated.sequence([
          // Lub — first beat (stronger)
          Animated.timing(anim, { toValue: 1.07, duration: 120, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 1.00, duration: 100, useNativeDriver: true }),
          // Dub — second beat (softer)
          Animated.timing(anim, { toValue: 1.05, duration: 100, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 1.00, duration: 100, useNativeDriver: true }),
          // Rest between beats
          Animated.delay(480),
        ])
      );
      loop.start();
      return () => {
        loop.stop();
        anim.setValue(1);
      };
    } else {
      anim.stopAnimation();
      anim.setValue(1);
    }
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  return anim;
}
