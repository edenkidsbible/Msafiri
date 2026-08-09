/**
 * MarqueeText — animated ticker for text that overflows its container.
 *
 * Drop-in replacement for <Text numberOfLines={1}> anywhere text can be long
 * enough to get clipped. When the text fits within its container it renders
 * exactly like a plain <Text>. When it overflows it scrolls left to reveal the
 * full content, pauses, then eases back to the start and repeats.
 *
 * ── How it works ──
 *   The outer Animated.View clips with overflow:'hidden' and reports its width
 *   via onLayout. The inner Animated.Text uses alignSelf:'flex-start' so it
 *   sizes to its natural content width (not the parent's width), letting us
 *   measure the true text width via its own onLayout. When textWidth >
 *   containerWidth we run a looping translateX animation; otherwise the text
 *   renders statically with no unnecessary animation overhead.
 *
 * ── Layout props ──
 *   flex, flexGrow, flexShrink, flexBasis, width, margin* and alignSelf are
 *   lifted from `style` onto the container View so flex layout behaves exactly
 *   as it would with a plain Text. All other props (font, color, padding, etc.)
 *   stay on the inner Text element.
 *
 * ── Usage ──
 *   // Simple — replaces <Text numberOfLines={1} style={styles.name}>{text}</Text>
 *   <MarqueeText style={styles.name}>{text}</MarqueeText>
 *
 *   // With inline color (common pattern in this codebase)
 *   <MarqueeText style={[styles.name, { color: c.foreground }]}>{text}</MarqueeText>
 *
 *   // Container needs flex:1 but it isn't in styles.name
 *   <MarqueeText style={styles.name} containerStyle={{ flex: 1 }}>{text}</MarqueeText>
 */

import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  TextStyle,
  ViewStyle,
} from "react-native";

// These style keys belong on the outer container View, not on the Text element.
// Everything else is treated as a text-only style.
const CONTAINER_KEYS = new Set<string>([
  "flex", "flexGrow", "flexShrink", "flexBasis",
  "width", "minWidth", "maxWidth",
  "height", "minHeight", "maxHeight",
  "margin", "marginTop", "marginBottom", "marginLeft", "marginRight",
  "marginHorizontal", "marginVertical", "marginStart", "marginEnd",
  "alignSelf",
  "position", "top", "left", "right", "bottom",
  "zIndex",
]);

interface MarqueeTextProps {
  children?: string | null;
  style?: TextStyle | (TextStyle | false | null | undefined)[];
  /** Extra styles applied directly to the outer container View. */
  containerStyle?: ViewStyle;
  /** Scroll speed in px/s. Default 44. */
  speed?: number;
  /** Pause before scrolling starts, ms. Default 1600. */
  pauseDuration?: number;
  /** Pause at end before snapping back, ms. Default 900. */
  endPause?: number;
}

export function MarqueeText({
  children,
  style,
  containerStyle,
  speed = 44,
  pauseDuration = 1600,
  endPause = 900,
}: MarqueeTextProps) {
  const [containerW, setContainerW] = useState(0);
  const [textW, setTextW] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  // Text scrolls only when it genuinely overflows (2px tolerance for sub-pixel)
  const overflow = containerW > 0 && textW > containerW + 2;
  const scrollDist = Math.max(0, textW - containerW);
  const scrollMs = overflow ? (scrollDist / speed) * 1000 : 0;

  // ── Animation loop ────────────────────────────────────────────────────────
  useEffect(() => {
    loopRef.current?.stop();
    loopRef.current = null;
    translateX.setValue(0);

    if (!overflow || scrollDist <= 0) return;

    const run = () => {
      const anim = Animated.sequence([
        // Pause so user can read the start of the text
        Animated.delay(pauseDuration),
        // Scroll left at constant speed to reveal the end
        Animated.timing(translateX, {
          toValue:         -scrollDist,
          duration:        scrollMs,
          easing:          Easing.linear,
          useNativeDriver: true,
        }),
        // Pause at the end
        Animated.delay(endPause),
        // Ease back to start
        Animated.timing(translateX, {
          toValue:         0,
          duration:        380,
          easing:          Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]);
      loopRef.current = anim;
      anim.start(({ finished }) => { if (finished) run(); });
    };

    run();
    return () => { loopRef.current?.stop(); loopRef.current = null; };
  }, [overflow, scrollDist, scrollMs, pauseDuration, endPause]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Style splitting ───────────────────────────────────────────────────────
  // Flatten the style array into a single object, then split layout props
  // (which go on the container) from text-rendering props (which stay on Text).
  const flat = StyleSheet.flatten(style) ?? {};
  const containerFromStyle: ViewStyle = {};
  const textOnlyStyle: TextStyle = {};

  for (const key of Object.keys(flat)) {
    if (CONTAINER_KEYS.has(key)) {
      (containerFromStyle as Record<string, unknown>)[key] = (flat as Record<string, unknown>)[key];
    } else {
      (textOnlyStyle as Record<string, unknown>)[key] = (flat as Record<string, unknown>)[key];
    }
  }

  return (
    <Animated.View
      style={[containerFromStyle, containerStyle, { overflow: "hidden" }]}
      onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}
    >
      <Animated.Text
        style={[
          textOnlyStyle,
          {
            alignSelf:  "flex-start",
            transform:  [{ translateX }],
          },
        ]}
        onLayout={(e) => setTextW(e.nativeEvent.layout.width)}
        numberOfLines={overflow ? undefined : 1}
      >
        {children}
      </Animated.Text>
    </Animated.View>
  );
}
