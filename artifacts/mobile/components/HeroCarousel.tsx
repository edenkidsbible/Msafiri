/**
 * HeroCarousel — Showroom drive-in effect
 *
 * Cars face RIGHT (natural image orientation, no transforms that distort them).
 *
 * Each slide:
 *   1. ENTER  — car slides in slowly from the LEFT, decelerating to a stop.
 *   2. HOLD   — quick zoom-in spotlight moment, tip text visible.
 *   3. EXIT   — car slides RIGHT off frame while the next car pushes in
 *               from the LEFT simultaneously (overlap push effect).
 *
 * Two modes:
 *   HAS VEHICLE — all 5 slides use the user's own car (DefaultVehicleImage).
 *   NO VEHICLE  — slides cycle through the 5 generic vehicle-type PNGs.
 *
 * Used by: app/(tabs)/index.tsx — idle hero-card state only.
 */

import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { DefaultVehicleImage } from "@/components/DefaultVehicleImage";
import { SavedVehicle } from "@/utils/savedVehicles";

// ── Timing (total ≈ 7 s per slide) ───────────────────────────────────────────
const DRIVE_IN_MS  = 1100;  // slide in from left (ease-out, braking feel)
const ZOOM_IN_MS   =  500;  // scale up on arrival
const HOLD_MS      = 3900;  // hold at full zoom with tip visible
const ZOOM_OUT_MS  =  400;  // scale back to 1 before leaving
const TIP_OUT_MS   =  200;  // tip text fade-out
const DRIVE_OUT_MS = 1100;  // slide right + next slides in simultaneously

const OFFSCREEN    = 230;   // px beyond card edge
const ZOOM_SCALE   = 1.09;  // scale at the "spotlight" moment

// ── Types ─────────────────────────────────────────────────────────────────────
interface Slide {
  image: ReturnType<typeof require> | null;
  /** true = mirror the image so it faces RIGHT (for left-facing source images) */
  flipX: boolean;
  tip: string;
}

// ── Content ───────────────────────────────────────────────────────────────────
const TIPS = [
  "Tap the dashcam icon on the drive screen to start recording your journey automatically.",
  "Disable dashcam audio to record with your car music on — no mic interruptions.",
  "Speed zone alerts fire before you reach a camera — stay fine-free on every road.",
  "Every trip is saved to your garage — review routes and past events any time.",
  "Community hazard reports update live — see what other drivers spotted just ahead.",
];

// flipX = true means the source image faces LEFT and must be mirrored to face RIGHT.
// car ✗ left, motorcycle ✓ right, truck ✗ left, bus ✗ left, tractor ✗ left
const GENERIC_SLIDES: { image: ReturnType<typeof require>; flipX: boolean }[] = [
  { image: require("@/assets/images/vehicle-car.png"),        flipX: true  },
  { image: require("@/assets/images/vehicle-motorcycle.png"), flipX: false },
  { image: require("@/assets/images/vehicle-truck.png"),      flipX: true  },
  { image: require("@/assets/images/vehicle-bus.png"),        flipX: true  },
  { image: require("@/assets/images/vehicle-tractor.png"),    flipX: true  },
];

// ── Sub-component: car image ──────────────────────────────────────────────────
function CarImage({ slide, vehicle }: { slide: Slide; vehicle?: SavedVehicle | null }) {
  // scaleX: -1 mirrors left-facing images so every car faces RIGHT
  const flip = slide.flipX ? [{ scaleX: -1 }] : undefined;
  return slide.image === null
    ? <DefaultVehicleImage width={185} height={148} vehicle={vehicle} style={flip ? { transform: flip } : undefined} />
    : <Image source={slide.image} style={[styles.vehicleImg, flip ? { transform: flip } : undefined]} contentFit="contain" />;
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  activeVehicle?: SavedVehicle | null;
  showLongPressHint?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function HeroCarousel({ activeVehicle, showLongPressHint }: Props) {
  const slides: Slide[] = TIPS.map((tip, i) => ({
    image:  !!activeVehicle ? null : GENERIC_SLIDES[i].image,
    // Generic images: mirror if facing left. User's own vehicle images are also
    // conventionally left-facing (web/Wikipedia car photos), so mirror those too.
    flipX: !!activeVehicle ? true : GENERIC_SLIDES[i].flipX,
    tip,
  }));

  // Render state
  const [curIdx, setCurIdx] = useState(0);
  const [incIdx, setIncIdx] = useState<number | null>(null);

  // Animated values
  const currentPos = useRef(new Animated.Value(-OFFSCREEN)).current;
  const incomingPos = useRef(new Animated.Value(-OFFSCREEN)).current;
  const zoomScale  = useRef(new Animated.Value(1)).current;
  const tipOpacity = useRef(new Animated.Value(0)).current;

  // Control refs
  const cancelRef   = useRef(false);
  const slidesRef   = useRef(slides);
  slidesRef.current = slides;

  useEffect(() => {
    cancelRef.current = false;
    const n = slidesRef.current.length;

    // ── STEP 3: zoom out → fade tip → push exit ────────────────────────────
    function doExit(idx: number, onDone: () => void) {
      if (cancelRef.current) return;
      const nextIdx = (idx + 1) % n;

      incomingPos.setValue(-OFFSCREEN);

      Animated.sequence([
        // Zoom back to 1
        Animated.timing(zoomScale, {
          toValue: 1, duration: ZOOM_OUT_MS,
          easing: Easing.in(Easing.cubic), useNativeDriver: true,
        }),
        // Fade tip
        Animated.timing(tipOpacity, {
          toValue: 0, duration: TIP_OUT_MS, useNativeDriver: true,
        }),
      ]).start(() => {
        if (cancelRef.current) return;

        setIncIdx(nextIdx);

        requestAnimationFrame(() => {
          if (cancelRef.current) return;

          // Current exits right, incoming enters from left simultaneously
          Animated.parallel([
            Animated.timing(currentPos, {
              toValue: OFFSCREEN, duration: DRIVE_OUT_MS,
              easing: Easing.in(Easing.cubic), useNativeDriver: true,
            }),
            Animated.timing(incomingPos, {
              toValue: 0, duration: DRIVE_OUT_MS,
              easing: Easing.out(Easing.cubic), useNativeDriver: true,
            }),
          ]).start(({ finished }) => {
            if (!finished || cancelRef.current) return;

            // Swap
            currentPos.setValue(0);
            zoomScale.setValue(1);
            tipOpacity.setValue(0);
            setCurIdx(nextIdx);
            setIncIdx(null);

            requestAnimationFrame(() => onDone());
          });
        });
      });
    }

    // ── STEP 2: zoom in + hold + tip ──────────────────────────────────────
    function doHold(idx: number) {
      if (cancelRef.current) return;

      Animated.parallel([
        Animated.timing(zoomScale, {
          toValue: ZOOM_SCALE, duration: ZOOM_IN_MS,
          easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
        Animated.timing(tipOpacity, {
          toValue: 1, duration: ZOOM_IN_MS, useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (!finished || cancelRef.current) return;

        Animated.delay(HOLD_MS).start(({ finished: f2 }) => {
          if (!f2 || cancelRef.current) return;
          doExit(idx, () => doHold((idx + 1) % n));
        });
      });
    }

    // ── STEP 1: first car drives in from the left ──────────────────────────
    currentPos.setValue(-OFFSCREEN);
    zoomScale.setValue(1);
    tipOpacity.setValue(0);

    Animated.timing(currentPos, {
      toValue: 0, duration: DRIVE_IN_MS,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished || cancelRef.current) return;
      doHold(0);
    });

    return () => { cancelRef.current = true; };
  }, []);

  const curSlide = slides[curIdx];
  const incSlide = incIdx !== null ? slides[incIdx] : null;

  return (
    <>
      {/* Left: image area */}
      <View style={styles.imgWrap}>

        {/* Current car */}
        <Animated.View
          style={[
            styles.carSlot,
            { transform: [{ translateX: currentPos }, { scale: zoomScale }] },
          ]}
        >
          <CarImage slide={curSlide} vehicle={activeVehicle} />
        </Animated.View>

        {/* Incoming car — only during push transition */}
        {incSlide && (
          <Animated.View
            style={[
              styles.carSlot,
              { transform: [{ translateX: incomingPos }] },
            ]}
          >
            <CarImage slide={incSlide} vehicle={activeVehicle} />
          </Animated.View>
        )}

        {/* Dot indicators */}
        <View style={styles.dotsRow}>
          {slides.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === curIdx ? styles.dotActive : styles.dotInactive]}
            />
          ))}
        </View>
      </View>

      {/* Right: text */}
      <View style={styles.textCol}>
        <Text style={styles.title}>Start Driving</Text>

        <Animated.Text style={[styles.tip, { opacity: tipOpacity }]}>
          {curSlide.tip}
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
    overflow: "hidden",
  },
  carSlot: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "flex-end",
    justifyContent: "flex-end",
  },
  vehicleImg: { width: 185, height: 148 },
  dotsRow: {
    position: "absolute",
    bottom: 10,
    left: 10,
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
  },
  dot:         { height: 5, borderRadius: 3 },
  dotActive:   { width: 14, backgroundColor: "#FFFFFF" },
  dotInactive: { width: 5,  backgroundColor: "#FFFFFF55" },
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
