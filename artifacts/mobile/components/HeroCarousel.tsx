/**
 * HeroCarousel
 *
 * Renders the idle-state content inside the home screen's green hero card:
 *   · Left  — vehicle image that cross-fades between slides with a slow
 *             "showroom spotlight" breathing-scale effect on each car.
 *   · Right — "Start Driving" title (fixed) + tip text that fades with each
 *             slide + the chevron CTA.
 *
 * Carousel order:
 *   0  user's active vehicle  → dashcam recording tip
 *   1  generic car            → disable dashcam audio tip
 *   2  motorcycle             → speed zone alert tip
 *   3  truck                  → trip log tip
 *   4  PSV / bus              → community report tip
 *
 * Used by: app/(tabs)/index.tsx (idle hero-card state only).
 * Active-trip and paused-trip states remain untouched in index.tsx.
 */

import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { DefaultVehicleImage } from "@/components/DefaultVehicleImage";
import { SavedVehicle } from "@/utils/savedVehicles";

// ── Slide definitions ─────────────────────────────────────────────────────────

const SLIDES: { image: ReturnType<typeof require> | null; tip: string }[] = [
  {
    image: null, // slot 0 → renders user's active vehicle via DefaultVehicleImage
    tip: "Tap the dashcam icon on the drive screen to start recording your journey automatically.",
  },
  {
    image: require("@/assets/images/vehicle-car.png"),
    tip: "Disable dashcam audio to record with your car music on — no mic interruptions.",
  },
  {
    image: require("@/assets/images/vehicle-motorcycle.png"),
    tip: "Speed zone alerts fire before you reach a camera — stay fine-free on every road.",
  },
  {
    image: require("@/assets/images/vehicle-truck.png"),
    tip: "Every trip is saved to your garage — review routes and past events any time.",
  },
  {
    image: require("@/assets/images/vehicle-bus.png"),
    tip: "Community hazard reports update live — see what other drivers spotted just ahead.",
  },
];

const SLIDE_HOLD_MS  = 4000; // how long each slide is fully visible
const FADE_DURATION  = 350;  // image + tip crossfade
const BREATHE_IN_MS  = 2000; // showroom scale-up duration
const BREATHE_OUT_MS = 2000; // showroom scale-down duration
const SCALE_MAX      = 1.07; // max scale during breathing

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  /** Active vehicle from VehicleContext — shown on slide 0. */
  activeVehicle?: SavedVehicle | null;
  /** Show the "Hold to open checklist" micro-hint when quick-start is ready. */
  showLongPressHint?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function HeroCarousel({ activeVehicle, showLongPressHint }: Props) {
  const [index, setIndex] = useState(0);

  // Fade shared by image + tip so they always move together
  const fadeAnim  = useRef(new Animated.Value(1)).current;
  // Breathing scale — loops continuously
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const breatheRef = useRef<Animated.CompositeAnimation | null>(null);

  // ── Breathing loop (runs once, loops forever) ─────────────────────────────
  function startBreathe() {
    breatheRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: SCALE_MAX,
          duration: BREATHE_IN_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: BREATHE_OUT_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    breatheRef.current.start();
  }

  useEffect(() => {
    startBreathe();
    return () => breatheRef.current?.stop();
  }, []);

  // ── Slide advance interval ────────────────────────────────────────────────
  const indexRef = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => {
      // Fade out
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: FADE_DURATION,
        useNativeDriver: true,
      }).start(() => {
        // Swap slide + reset breathe from the beginning
        const next = (indexRef.current + 1) % SLIDES.length;
        indexRef.current = next;
        setIndex(next);
        scaleAnim.setValue(1);
        startBreathe();

        // Fade in
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: FADE_DURATION,
          useNativeDriver: true,
        }).start();
      });
    }, SLIDE_HOLD_MS);

    return () => clearInterval(timer);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  const slide = SLIDES[index];

  return (
    <>
      {/* ── Left: animated vehicle image ─────────────────────────────────── */}
      <View style={styles.imgWrap}>
        <Animated.View
          style={{
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          }}
        >
          {slide.image === null ? (
            <DefaultVehicleImage
              width={185}
              height={148}
              vehicle={activeVehicle}
            />
          ) : (
            <Image
              source={slide.image}
              style={styles.vehicleImg}
              contentFit="contain"
            />
          )}
        </Animated.View>

        {/* Carousel dot indicators */}
        <View style={styles.dotsRow}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === index ? styles.dotActive : styles.dotInactive,
              ]}
            />
          ))}
        </View>
      </View>

      {/* ── Right: fixed title + animated tip + chevron ───────────────────── */}
      <View style={styles.textCol}>
        <Text style={styles.title}>Start Driving</Text>

        <Animated.Text style={[styles.tip, { opacity: fadeAnim }]}>
          {slide.tip}
        </Animated.Text>

        {showLongPressHint && (
          <Text style={styles.longPressHint}>Hold to open checklist</Text>
        )}

        <View style={styles.chevron}>
          <Ionicons name="chevron-forward" size={18} color="#0A7C3A" />
        </View>
      </View>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  imgWrap: {
    width: 175,
    alignItems: "flex-end",
    justifyContent: "flex-end",
  },
  vehicleImg: {
    width: 185,
    height: 148,
  },

  // Dot strip sits at the bottom-left of the image column
  dotsRow: {
    position: "absolute",
    bottom: 10,
    left: 10,
    flexDirection: "row",
    gap: 5,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  dotActive: {
    backgroundColor: "#FFFFFF",
    width: 14, // elongated pill for the active dot
  },
  dotInactive: {
    backgroundColor: "#FFFFFF55",
  },

  // Text column (mirrors heroTextCol in index.tsx)
  textCol: {
    flex: 1,
    paddingVertical: 20,
    paddingRight: 18,
    paddingLeft: 4,
    justifyContent: "center",
    gap: 6,
  },
  title: {
    fontSize: 21,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  tip: {
    fontSize: 11.5,
    fontFamily: "Inter_400Regular",
    color: "#FFFFFFBB",
    lineHeight: 17,
  },
  longPressHint: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: "#FFFFFF66",
    lineHeight: 14,
    marginTop: 2,
  },
  chevron: {
    marginTop: 8,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
});
