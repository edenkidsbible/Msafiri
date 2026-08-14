/**
 * HeroCarousel — Showroom drive-in effect
 *
 * Every car performs the same choreography:
 *
 *   1. ENTER  — slides in slowly from the LEFT as a right-facing side profile
 *               (rotateY ≈ 0°).  While moving toward centre it simultaneously
 *               rotates on the Y-axis so that by the time it stops it is facing
 *               STRAIGHT FORWARD (rotateY ≈ 55°, giving the "turning to face
 *               the viewer" perspective effect — no extra images required).
 *
 *   2. HOLD   — car is centred and forward-facing.  A quick zoom-in (scale up)
 *               lands the car for the "ta-da" moment, then it holds while the
 *               tip text is visible.
 *
 *   3. EXIT   — tip text fades out.  The current car slowly rotates BACK to
 *               its side profile while sliding RIGHT off frame.  Simultaneously
 *               the NEXT car slides in from the LEFT doing its own rotate-in,
 *               so the two cars overlap briefly in a natural push effect.
 *
 * Two modes:
 *   HAS VEHICLE  — all 5 slides use the user's own car via DefaultVehicleImage.
 *   NO VEHICLE   — slides cycle through the 5 generic vehicle-type PNGs.
 *
 * Used by: app/(tabs)/index.tsx — idle hero-card state only.
 * Active / paused trip states are untouched in index.tsx.
 */

import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { DefaultVehicleImage } from "@/components/DefaultVehicleImage";
import { SavedVehicle } from "@/utils/savedVehicles";

// ── Timing (all in ms, total ≈ 7 s per slide) ────────────────────────────────
const DRIVE_IN_MS   = 1200;  // entry:  side-profile → forward-facing + slide to centre
const ZOOM_IN_MS    = 500;   // zoom up on arrival
const HOLD_MS       = 3800;  // stationary hold (forward-facing, zoomed in)
const ZOOM_OUT_MS   = 400;   // zoom back to 1 before leaving
const TIP_OUT_MS    = 200;   // tip text fade-out before exit
const DRIVE_OUT_MS  = 1200;  // exit: unrotate + slide right, simultaneously push in next

// ── Visual constants ──────────────────────────────────────────────────────────
const OFFSCREEN     = 230;   // px off-screen to start/end each animation
const PERSPECTIVE   = 700;   // 3-D perspective distance (lower = more dramatic)
const ROTATE_Y_DEG  = 55;    // degrees of Y-axis rotation at full "forward-facing"
const ZOOM_SCALE    = 1.10;  // scale at the centre "ta-da" moment

// ── Slide types ───────────────────────────────────────────────────────────────
interface Slide {
  image: ReturnType<typeof require> | null; // null → DefaultVehicleImage
  tip: string;
}

// ── Tips ──────────────────────────────────────────────────────────────────────
const TIPS = [
  "Tap the dashcam icon on the drive screen to start recording your journey automatically.",
  "Disable dashcam audio to record with your car music on — no mic interruptions.",
  "Speed zone alerts fire before you reach a camera — stay fine-free on every road.",
  "Every trip is saved to your garage — review routes and past events any time.",
  "Community hazard reports update live — see what other drivers spotted just ahead.",
];

// ── Generic vehicle images ────────────────────────────────────────────────────
const GENERIC_IMAGES = [
  require("@/assets/images/vehicle-car.png"),
  require("@/assets/images/vehicle-motorcycle.png"),
  require("@/assets/images/vehicle-truck.png"),
  require("@/assets/images/vehicle-bus.png"),
  require("@/assets/images/vehicle-tractor.png"),
];

// ── Car image sub-component ───────────────────────────────────────────────────
function CarImage({ slide, vehicle }: { slide: Slide; vehicle?: SavedVehicle | null }) {
  return slide.image === null
    ? <DefaultVehicleImage width={185} height={148} vehicle={vehicle} />
    : <Image source={slide.image} style={styles.vehicleImg} contentFit="contain" />;
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  activeVehicle?: SavedVehicle | null;
  showLongPressHint?: boolean;
}

// ── rotateY interpolation helper ──────────────────────────────────────────────
// animValue goes 0 → 1; output is '0deg' → '{ROTATE_Y_DEG}deg'
function rotateInterp(anim: Animated.Value) {
  return anim.interpolate({
    inputRange:  [0, 1],
    outputRange: ["0deg", `${ROTATE_Y_DEG}deg`],
  });
}

// ── Component ─────────────────────────────────────────────────────────────────
export function HeroCarousel({ activeVehicle, showLongPressHint }: Props) {
  const slides: Slide[] = TIPS.map((tip, i) => ({
    image: !!activeVehicle ? null : GENERIC_IMAGES[i],
    tip,
  }));

  // ── Render state ──────────────────────────────────────────────────────────
  const [curIdx, setCurIdx]   = useState(0);
  const [incIdx, setIncIdx]   = useState<number | null>(null);

  // ── Animated values ───────────────────────────────────────────────────────
  //   currentPos / currentRot  — the visible/current car
  //   incomingPos / incomingRot — the car being pushed in during transitions
  //   zoomScale                — current car zoom during hold
  //   tipOpacity               — tip text
  const currentPos   = useRef(new Animated.Value(-OFFSCREEN)).current;
  const currentRot   = useRef(new Animated.Value(0)).current;  // 0=side, 1=forward
  const incomingPos  = useRef(new Animated.Value(-OFFSCREEN)).current;
  const incomingRot  = useRef(new Animated.Value(0)).current;
  const zoomScale    = useRef(new Animated.Value(1)).current;
  const tipOpacity   = useRef(new Animated.Value(0)).current;

  // ── Stable refs ───────────────────────────────────────────────────────────
  const cancelRef   = useRef(false);
  const slidesRef   = useRef(slides);
  slidesRef.current = slides;

  // ── Animation chain ───────────────────────────────────────────────────────
  useEffect(() => {
    cancelRef.current = false;
    const n = slidesRef.current.length;

    // STEP 3 — exit current + push in next ─────────────────────────────────
    function doExit(idx: number, onDone: () => void) {
      if (cancelRef.current) return;
      const nextIdx = (idx + 1) % n;

      // Reset incoming car: side-profile, off-screen left
      incomingPos.setValue(-OFFSCREEN);
      incomingRot.setValue(0);

      // First: zoom out to natural size
      Animated.timing(zoomScale, {
        toValue: 1, duration: ZOOM_OUT_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true,
      }).start(() => {
        if (cancelRef.current) return;

        // Fade tip text out
        Animated.timing(tipOpacity, {
          toValue: 0, duration: TIP_OUT_MS, useNativeDriver: true,
        }).start(() => {
          if (cancelRef.current) return;

          // Show incoming car (off-screen, will animate in)
          setIncIdx(nextIdx);

          // One frame so React mounts the incoming car before animating it
          requestAnimationFrame(() => {
            if (cancelRef.current) return;

            // Parallel push: current exits right+unrotates, incoming enters left+rotates
            Animated.parallel([
              // Current — slide right, rotate back to side profile
              Animated.timing(currentPos, {
                toValue: OFFSCREEN, duration: DRIVE_OUT_MS,
                easing: Easing.in(Easing.cubic), useNativeDriver: true,
              }),
              Animated.timing(currentRot, {
                toValue: 0, duration: DRIVE_OUT_MS,
                easing: Easing.in(Easing.cubic), useNativeDriver: true,
              }),
              // Incoming — slide from left to centre, rotate toward viewer
              Animated.timing(incomingPos, {
                toValue: 0, duration: DRIVE_OUT_MS,
                easing: Easing.out(Easing.cubic), useNativeDriver: true,
              }),
              Animated.timing(incomingRot, {
                toValue: 1, duration: DRIVE_OUT_MS,
                easing: Easing.out(Easing.cubic), useNativeDriver: true,
              }),
            ]).start(({ finished }) => {
              if (!finished || cancelRef.current) return;

              // Swap — incoming is now current (centred, forward-facing)
              currentPos.setValue(0);
              currentRot.setValue(1);  // forward-facing
              zoomScale.setValue(1);
              tipOpacity.setValue(0);

              setCurIdx(nextIdx);
              setIncIdx(null);

              requestAnimationFrame(() => onDone());
            });
          });
        });
      });
    }

    // STEP 2 — zoom in + hold + tip ────────────────────────────────────────
    function doHold(idx: number) {
      if (cancelRef.current) return;

      // Zoom in and fade tip simultaneously
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

        // Hold at full zoom
        Animated.delay(HOLD_MS).start(({ finished: f2 }) => {
          if (!f2 || cancelRef.current) return;
          doExit(idx, () => doHold((idx + 1) % n));
        });
      });
    }

    // STEP 1 — initial drive-in (only for the very first slide) ───────────
    function doEntry() {
      if (cancelRef.current) return;

      // Start: off-screen left, side-profile, no zoom, no tip
      currentPos.setValue(-OFFSCREEN);
      currentRot.setValue(0);
      zoomScale.setValue(1);
      tipOpacity.setValue(0);

      // Slide in from left while rotating to face forward
      Animated.parallel([
        Animated.timing(currentPos, {
          toValue: 0, duration: DRIVE_IN_MS,
          easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
        Animated.timing(currentRot, {
          toValue: 1, duration: DRIVE_IN_MS,
          easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (!finished || cancelRef.current) return;
        doHold(0);
      });
    }

    doEntry();
    return () => { cancelRef.current = true; };
  }, []); // runs once on mount

  // ── Derived ───────────────────────────────────────────────────────────────
  const curSlide = slides[curIdx];
  const incSlide = incIdx !== null ? slides[incIdx] : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Left: image column with clipping ─────────────────────────────── */}
      <View style={styles.imgWrap}>

        {/* Current car */}
        <Animated.View
          style={[
            styles.carSlot,
            {
              transform: [
                { perspective: PERSPECTIVE },
                { rotateY: rotateInterp(currentRot) },
                { translateX: currentPos },
                { scale: zoomScale },
              ],
            },
          ]}
        >
          <CarImage slide={curSlide} vehicle={activeVehicle} />
        </Animated.View>

        {/* Incoming car — only rendered during the push transition */}
        {incSlide && (
          <Animated.View
            style={[
              styles.carSlot,
              {
                transform: [
                  { perspective: PERSPECTIVE },
                  { rotateY: rotateInterp(incomingRot) },
                  { translateX: incomingPos },
                ],
              },
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

      {/* ── Right: title + tip + chevron ─────────────────────────────────── */}
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
