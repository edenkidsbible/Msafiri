/**
 * HeroCarousel — Showroom drive-in effect
 *
 * Cars face RIGHT (scaleX: -1 applied via DefaultVehicleImage for user
 * vehicles; GENERIC_SLIDES.flipX for fallback PNGs).
 *
 * Each slide lifecycle:
 *   1. ENTER  — car drives in from LEFT, decelerates to centre.
 *   2. HOLD   — quick zoom spotlight + tip text visible.
 *   3. EXIT   — car drives RIGHT and disappears completely.
 *   4. SWAP   — index changes, car repositions off-screen left (invisible).
 *   5. Repeat from ENTER with the next car.
 *
 * No two cars are ever on screen simultaneously.
 */

import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { DefaultVehicleImage } from "@/components/DefaultVehicleImage";
import { SavedVehicle } from "@/utils/savedVehicles";

// ── Timing ────────────────────────────────────────────────────────────────────
const DRIVE_IN_MS  = 1100;  // enter from left (ease-out)
const ZOOM_IN_MS   =  450;  // scale up on arrival
const HOLD_MS      = 3800;  // hold at full zoom with tip visible
const ZOOM_OUT_MS  =  350;  // scale back before leaving
const TIP_OUT_MS   =  200;  // tip fade-out
const DRIVE_OUT_MS = 1000;  // exit right (ease-in)

const OFFSCREEN    = 260;   // px beyond card edge — car is invisible here
const ZOOM_SCALE   = 1.09;

// ── Types ─────────────────────────────────────────────────────────────────────
interface Slide {
  image: ReturnType<typeof require> | null;
  /** true = apply scaleX:-1 to the generic PNG so it faces right */
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

// car ✗ left, motorcycle ✓ right, truck ✗ left, bus/van ✗ left, tractor ✗ left
const GENERIC_SLIDES: { image: ReturnType<typeof require>; flipX: boolean }[] = [
  { image: require("@/assets/images/vehicle-car.png"),        flipX: true  },
  { image: require("@/assets/images/vehicle-motorcycle.png"), flipX: false },
  { image: require("@/assets/images/vehicle-truck.png"),      flipX: true  },
  { image: require("@/assets/images/vehicle-bus.png"),        flipX: true  },
  { image: require("@/assets/images/vehicle-tractor.png"),    flipX: true  },
];

// ── Sub-component: car image ──────────────────────────────────────────────────
function CarImage({ slide, vehicle }: { slide: Slide; vehicle?: SavedVehicle | null }) {
  // DefaultVehicleImage handles FACE_RIGHT internally, so no extra flip needed.
  // Generic PNGs are flipped here via scaleX when flipX is true.
  const flip = slide.flipX ? [{ scaleX: -1 }] : undefined;
  return slide.image === null
    ? <DefaultVehicleImage width={185} height={148} vehicle={vehicle} />
    : <Image
        source={slide.image}
        style={[styles.vehicleImg, flip ? { transform: flip } : undefined]}
        contentFit="contain"
      />;
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
    // User vehicles: DefaultVehicleImage handles FACE_RIGHT internally → no flipX.
    // Generic images: mirror if the source faces left.
    flipX: !!activeVehicle ? false : GENERIC_SLIDES[i].flipX,
    tip,
  }));

  const [curIdx, setCurIdx] = useState(0);

  // Single animated car — reused for every slide.
  const carPos   = useRef(new Animated.Value(-OFFSCREEN)).current;
  const zoomScale = useRef(new Animated.Value(1)).current;
  const tipOpacity = useRef(new Animated.Value(0)).current;

  const cancelRef   = useRef(false);
  const slidesRef   = useRef(slides);
  slidesRef.current = slides;

  useEffect(() => {
    cancelRef.current = false;
    const n = slidesRef.current.length;

    // ── Phase 3: zoom out → tip out → drive off right ────────────────────────
    // Then swap the index and immediately begin the next slide's entry.
    function doExit(idx: number) {
      if (cancelRef.current) return;
      const next = (idx + 1) % n;

      Animated.sequence([
        Animated.timing(zoomScale, {
          toValue: 1, duration: ZOOM_OUT_MS,
          easing: Easing.in(Easing.cubic), useNativeDriver: true,
        }),
        Animated.timing(tipOpacity, {
          toValue: 0, duration: TIP_OUT_MS, useNativeDriver: true,
        }),
        // Drive off to the RIGHT — car disappears completely before anything happens.
        Animated.timing(carPos, {
          toValue: OFFSCREEN, duration: DRIVE_OUT_MS,
          easing: Easing.in(Easing.cubic), useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (!finished || cancelRef.current) return;

        // Snap values: reset scale/opacity, teleport car to entry position.
        zoomScale.setValue(1);
        tipOpacity.setValue(0);
        carPos.setValue(-OFFSCREEN); // invisible off-screen left

        // Swap the slide index — car image changes while off-screen.
        setCurIdx(next);

        // One frame later, drive the new car in.
        requestAnimationFrame(() => doEnter(next));
      });
    }

    // ── Phase 2: zoom in + hold, then exit ───────────────────────────────────
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
          doExit(idx);
        });
      });
    }

    // ── Phase 1: drive car in from the left ──────────────────────────────────
    function doEnter(idx: number) {
      if (cancelRef.current) return;

      Animated.timing(carPos, {
        toValue: 0, duration: DRIVE_IN_MS,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished || cancelRef.current) return;
        doHold(idx);
      });
    }

    // Kick off with the first slide.
    carPos.setValue(-OFFSCREEN);
    zoomScale.setValue(1);
    tipOpacity.setValue(0);
    doEnter(0);

    return () => { cancelRef.current = true; };
  }, []);

  const curSlide = slides[curIdx];

  return (
    <>
      {/* Left: image area */}
      <View style={styles.imgWrap}>
        <Animated.View
          style={[
            styles.carSlot,
            { transform: [{ translateX: carPos }, { scale: zoomScale }] },
          ]}
        >
          <CarImage slide={curSlide} vehicle={activeVehicle} />
        </Animated.View>

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
