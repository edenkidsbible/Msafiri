/**
 * HeroCarousel
 *
 * Renders the idle-state content inside the home screen's green hero card.
 *
 * TWO modes, chosen automatically:
 *
 *   HAS VEHICLE  — all 5 slides show the user's own car, each from a slightly
 *                  different showroom "angle" (normal, mirrored, tilted, etc.)
 *                  via transform: scaleX + rotate on the wrapping view.
 *
 *   NO VEHICLE   — slides cycle through the generic vehicle-type PNGs
 *                  (car → motorcycle → truck → bus → tractor), each also
 *                  shown from a slightly different angle.
 *
 * Each slide breathes with a gentle scale pulse (showroom spotlight feel).
 * Slides advance every 3 seconds with a 350 ms crossfade.
 * Dot indicators at the bottom-left of the image column track the position.
 *
 * Used by: app/(tabs)/index.tsx (idle hero-card state only).
 * Active-trip and paused-trip states remain untouched in index.tsx.
 */

import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { DefaultVehicleImage } from "@/components/DefaultVehicleImage";
import { SavedVehicle } from "@/utils/savedVehicles";

// ── Slide types ───────────────────────────────────────────────────────────────

interface SlideAngle {
  /** null = render user's vehicle via DefaultVehicleImage */
  image: ReturnType<typeof require> | null;
  /** Mirror the image along the X axis to show the "other side". */
  flipX?: boolean;
  /** Subtle fixed tilt — e.g. '4deg' for a low-angle dramatic look. */
  rotate?: string;
}

// ── Angle variants (5 showroom poses) ────────────────────────────────────────
// Applied to both the user's car and the generic vehicle images.
const ANGLES: Pick<SlideAngle, "flipX" | "rotate">[] = [
  { flipX: false, rotate: "0deg"   },  // 0 — straight on, right-facing
  { flipX: true,  rotate: "0deg"   },  // 1 — mirrored, left-facing
  { flipX: false, rotate: "60deg"  },  // 2 — steep nose-up tilt
  { flipX: true,  rotate: "-60deg" },  // 3 — mirrored steep tilt
  { flipX: false, rotate: "-60deg" },  // 4 — steep reverse tilt
];

// ── Generic vehicle images (used when no vehicle is set) ──────────────────────
const GENERIC_IMAGES: ReturnType<typeof require>[] = [
  require("@/assets/images/vehicle-car.png"),
  require("@/assets/images/vehicle-motorcycle.png"),
  require("@/assets/images/vehicle-truck.png"),
  require("@/assets/images/vehicle-bus.png"),
  require("@/assets/images/vehicle-tractor.png"),
];

// ── Tips (one per slide, same in both modes) ──────────────────────────────────
const TIPS = [
  "Tap the dashcam icon on the drive screen to start recording your journey automatically.",
  "Disable dashcam audio to record with your car music on — no mic interruptions.",
  "Speed zone alerts fire before you reach a camera — stay fine-free on every road.",
  "Every trip is saved to your garage — review routes and past events any time.",
  "Community hazard reports update live — see what other drivers spotted just ahead.",
];

// ── Timing ────────────────────────────────────────────────────────────────────
const SLIDE_HOLD_MS  = 7000; // ms each slide is fully visible
const FADE_DURATION  = 350;  // image + tip crossfade
const BREATHE_IN_MS  = 2000; // showroom scale-up
const BREATHE_OUT_MS = 2000; // showroom scale-down
const SCALE_MAX      = 1.07; // max scale during breathing

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  /** Active vehicle from VehicleContext — shown in all slides when non-null. */
  activeVehicle?: SavedVehicle | null;
  /** Show the "Hold to open checklist" micro-hint when quick-start is ready. */
  showLongPressHint?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function HeroCarousel({ activeVehicle, showLongPressHint }: Props) {
  const [index, setIndex] = useState(0);

  const fadeAnim  = useRef(new Animated.Value(1)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const breatheRef = useRef<Animated.CompositeAnimation | null>(null);

  // Whether we have a real user vehicle to show across all slides
  const hasVehicle = !!activeVehicle;

  // Build the 5 slides based on mode
  const slides: SlideAngle[] = ANGLES.map((angle, i) => ({
    image: hasVehicle ? null : GENERIC_IMAGES[i],
    ...angle,
  }));

  // ── Breathing loop ────────────────────────────────────────────────────────
  function startBreathe() {
    breatheRef.current?.stop();
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

  // ── Slide advance ─────────────────────────────────────────────────────────
  const indexRef = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => {
      // Fade out image + tip together
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: FADE_DURATION,
        useNativeDriver: true,
      }).start(() => {
        const next = (indexRef.current + 1) % slides.length;
        indexRef.current = next;
        setIndex(next);

        // Restart breathe from scale 1 so every slide starts the same way
        scaleAnim.setValue(1);
        startBreathe();

        // Fade back in
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: FADE_DURATION,
          useNativeDriver: true,
        }).start();
      });
    }, SLIDE_HOLD_MS);

    return () => clearInterval(timer);
  }, [slides.length]);

  // ── Current slide ─────────────────────────────────────────────────────────
  const slide = slides[index];
  const flipX  = slide.flipX  ? -1 : 1;
  const rotate = slide.rotate ?? "0deg";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Left: animated vehicle image ─────────────────────────────────── */}
      <View style={styles.imgWrap}>
        <Animated.View
          style={{
            opacity: fadeAnim,
            transform: [
              { scaleX: flipX },
              { rotate },
              { scale: scaleAnim },
            ],
          }}
        >
          {slide.image === null ? (
            // User's own car — rendered via the same 3-phase fallback as Garage
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

        {/* Dot indicators */}
        <View style={styles.dotsRow}>
          {slides.map((_, i) => (
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
          {TIPS[index]}
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

  dotsRow: {
    position: "absolute",
    bottom: 10,
    left: 10,
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
  },
  dot: {
    height: 5,
    borderRadius: 3,
  },
  dotActive: {
    width: 14,
    backgroundColor: "#FFFFFF",
  },
  dotInactive: {
    width: 5,
    backgroundColor: "#FFFFFF55",
  },

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
