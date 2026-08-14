/**
 * HeroCarousel
 *
 * Each car drives INTO the frame from the direction it faces:
 *   · right-facing car → enters from the left edge, exits to the right
 *   · left-facing car  → enters from the right edge, exits to the left
 *
 * The NEXT car enters from the SAME side the current one exits, creating
 * the "new car pushes old car out of the way" showroom effect.
 *
 * While stationary, each car breathes (gentle scale pulse) under a
 * spotlight feel.  Tip text fades in after arrival and out before exit.
 *
 * Timing (≈ 7 s per slide):
 *   Drive in  900 ms  — ease-out (braking into position)
 *   Tip fade  350 ms  — parallel with breathe start
 *   Breathe   3600 ms — one full in/out cycle
 *   Rest      1300 ms — stationary pause
 *   Tip out    200 ms
 *   Push out   900 ms — current exits + next enters simultaneously (ease-in/out)
 *
 * Two modes, chosen by whether activeVehicle is set:
 *   HAS VEHICLE  — all 5 slides show the user's own car (via DefaultVehicleImage),
 *                  alternating between right-facing and left-facing poses.
 *   NO VEHICLE   — slides cycle through generic vehicle-type PNGs.
 *
 * Used by: app/(tabs)/index.tsx — idle hero-card state only.
 */

import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { DefaultVehicleImage } from "@/components/DefaultVehicleImage";
import { SavedVehicle } from "@/utils/savedVehicles";

// ── Timing ────────────────────────────────────────────────────────────────────

const DRIVE_IN_MS   = 900;   // entry animation (ease-out, braking feel)
const BREATHE_MS    = 1800;  // one half of breathing cycle
const HOLD_EXTRA_MS = 1300;  // additional rest after breathing
const TIP_FADE_MS   = 350;   // tip text fade in
const TIP_OUT_MS    = 200;   // tip text fade out (before exit)
const DRIVE_OUT_MS  = 900;   // exit + simultaneous next-entry animation

// Off-screen distance (px) — large enough to fully clear the card edges
const OFFSCREEN     = 230;
const SCALE_MAX     = 1.06;  // max scale during breathing

// ── Slide types ───────────────────────────────────────────────────────────────

interface Slide {
  image: ReturnType<typeof require> | null; // null → DefaultVehicleImage
  flipX: boolean;                           // mirror for left-facing pose
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

// ── Generic vehicle images (no-vehicle mode) ──────────────────────────────────

const GENERIC_IMAGES = [
  require("@/assets/images/vehicle-car.png"),
  require("@/assets/images/vehicle-motorcycle.png"),
  require("@/assets/images/vehicle-truck.png"),
  require("@/assets/images/vehicle-bus.png"),
  require("@/assets/images/vehicle-tractor.png"),
];

// All cars face right for a uniform showroom look
const FLIP_PATTERN = [false, false, false, false, false];

// ── Position helpers ──────────────────────────────────────────────────────────

/** Starting X when a car drives in:
 *  right-facing → enters from the LEFT (negative X)
 *  left-facing  → enters from the RIGHT (positive X) */
function entryX(flipX: boolean) { return flipX ? OFFSCREEN : -OFFSCREEN; }

/** Exit X:  right-facing → exits RIGHT, left-facing → exits LEFT */
function exitX(flipX: boolean)  { return flipX ? -OFFSCREEN : OFFSCREEN; }

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  activeVehicle?: SavedVehicle | null;
  showLongPressHint?: boolean;
}

// ── Car image sub-component ───────────────────────────────────────────────────

function CarImage({ slide, vehicle }: { slide: Slide; vehicle?: SavedVehicle | null }) {
  if (slide.image === null) {
    return <DefaultVehicleImage width={185} height={148} vehicle={vehicle} />;
  }
  return (
    <Image source={slide.image} style={styles.vehicleImg} contentFit="contain" />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function HeroCarousel({ activeVehicle, showLongPressHint }: Props) {
  const hasVehicle = !!activeVehicle;

  const slides: Slide[] = TIPS.map((tip, i) => ({
    image: hasVehicle ? null : GENERIC_IMAGES[i],
    flipX: FLIP_PATTERN[i],
    tip,
  }));

  // ── Render state ────────────────────────────────────────────────────────
  const [curIdx, setCurIdx] = useState(0);           // which slide is "current"
  const [incIdx, setIncIdx] = useState<number | null>(null); // incoming during push

  // ── Animated values ─────────────────────────────────────────────────────
  const currentPos  = useRef(new Animated.Value(entryX(FLIP_PATTERN[0]))).current;
  const incomingPos = useRef(new Animated.Value(0)).current;
  const tipOpacity  = useRef(new Animated.Value(0)).current;
  const breathScale = useRef(new Animated.Value(1)).current;

  // ── Animation refs ───────────────────────────────────────────────────────
  const cancelRef  = useRef(false);
  const slidesRef  = useRef(slides);
  slidesRef.current = slides; // always fresh even after prop changes

  // ── Animation chain ───────────────────────────────────────────────────────
  useEffect(() => {
    cancelRef.current = false;
    const n = slidesRef.current.length;

    // --- STEP 3: exit current car while pushing in the next ----------------
    function doExit(idx: number, onDone: () => void) {
      if (cancelRef.current) return;
      const s       = slidesRef.current[idx];
      const nextIdx = (idx + 1) % n;
      const myExit  = exitX(s.flipX);

      // Position the incoming car at its entry point (same side as our exit)
      incomingPos.setValue(myExit);

      breathScale.stopAnimation();
      breathScale.setValue(1);

      // Fade out tip, then start the push
      Animated.timing(tipOpacity, {
        toValue: 0, duration: TIP_OUT_MS, useNativeDriver: true,
      }).start(() => {
        if (cancelRef.current) return;

        // Show incoming car (it's currently off-screen at incomingPos)
        setIncIdx(nextIdx);

        // Give React one frame to mount the incoming car before animating it
        requestAnimationFrame(() => {
          if (cancelRef.current) return;

          Animated.parallel([
            Animated.timing(currentPos, {
              toValue: myExit, duration: DRIVE_OUT_MS,
              easing: Easing.in(Easing.cubic), useNativeDriver: true,
            }),
            Animated.timing(incomingPos, {
              toValue: 0, duration: DRIVE_OUT_MS,
              easing: Easing.out(Easing.cubic), useNativeDriver: true,
            }),
          ]).start(({ finished }) => {
            if (!finished || cancelRef.current) return;

            // Swap: set currentPos to 0 BEFORE state update so the re-render
            // immediately shows the new current car at center (no flash).
            currentPos.setValue(0);
            tipOpacity.setValue(0);
            breathScale.setValue(1);

            setCurIdx(nextIdx);
            setIncIdx(null);

            requestAnimationFrame(() => onDone());
          });
        });
      });
    }

    // --- STEP 2: breathe + tip while stationary ----------------------------
    function doHold(idx: number) {
      if (cancelRef.current) return;
      breathScale.setValue(1);

      Animated.parallel([
        // Tip fades in
        Animated.timing(tipOpacity, {
          toValue: 1, duration: TIP_FADE_MS, useNativeDriver: true,
        }),
        // One breathing cycle + rest
        Animated.sequence([
          Animated.timing(breathScale, {
            toValue: SCALE_MAX, duration: BREATHE_MS,
            easing: Easing.inOut(Easing.sin), useNativeDriver: true,
          }),
          Animated.timing(breathScale, {
            toValue: 1, duration: BREATHE_MS,
            easing: Easing.inOut(Easing.sin), useNativeDriver: true,
          }),
          Animated.delay(HOLD_EXTRA_MS),
        ]),
      ]).start(({ finished }) => {
        if (!finished || cancelRef.current) return;
        doExit(idx, () => doHold((idx + 1) % n));
      });
    }

    // --- STEP 1: drive car in from off-screen ------------------------------
    function doEntry(idx: number) {
      if (cancelRef.current) return;
      const s = slidesRef.current[idx];
      currentPos.setValue(entryX(s.flipX));
      tipOpacity.setValue(0);
      breathScale.setValue(1);

      Animated.timing(currentPos, {
        toValue: 0, duration: DRIVE_IN_MS,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished || cancelRef.current) return;
        doHold(idx);
      });
    }

    doEntry(0);

    return () => { cancelRef.current = true; };
  }, []); // runs once on mount

  // ── Derived values ────────────────────────────────────────────────────────
  const curSlide = slides[curIdx];
  const incSlide = incIdx !== null ? slides[incIdx] : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Left: animated image column ──────────────────────────────────── */}
      <View style={styles.imgWrap}>

        {/* Current car — position + breathe scale + facing flip */}
        <Animated.View
          style={[
            styles.carSlot,
            {
              transform: [
                { translateX: currentPos },
                { scaleX: curSlide.flipX ? -1 : 1 },
                { scale: breathScale },
              ],
            },
          ]}
        >
          <CarImage slide={curSlide} vehicle={activeVehicle} />
        </Animated.View>

        {/* Incoming car — only mounted during the push transition */}
        {incSlide && (
          <Animated.View
            style={[
              styles.carSlot,
              {
                transform: [
                  { translateX: incomingPos },
                  { scaleX: incSlide.flipX ? -1 : 1 },
                ],
              },
            ]}
          >
            <CarImage slide={incSlide} vehicle={activeVehicle} />
          </Animated.View>
        )}

        {/* Dot indicator strip */}
        <View style={styles.dotsRow}>
          {slides.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === curIdx ? styles.dotActive : styles.dotInactive,
              ]}
            />
          ))}
        </View>
      </View>

      {/* ── Right: fixed title + animated tip + chevron ───────────────────── */}
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
    overflow: "hidden", // clips cars that are off-screen left/right
  },
  // Both current and incoming cars sit at the same origin; translateX moves them
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
  dot: {
    height: 5,
    borderRadius: 3,
  },
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
