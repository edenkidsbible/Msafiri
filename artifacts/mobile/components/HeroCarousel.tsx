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
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  tip: string;
  isNew?: boolean;
}

// ── Content ───────────────────────────────────────────────────────────────────
const FEATURES: Omit<Slide, "image" | "flipX">[] = [
  {
    icon: "mic-outline",
    title: "Road Channels",
    tip: "While driving, tap Road Channel to share a short voice update about your road. Confirm it before it reaches other drivers.",
    isNew: true,
  },
  {
    icon: "share-social-outline",
    title: "Share Trip",
    tip: "Share your live route with trusted contacts so they can follow your journey and know when you arrive.",
  },
  {
    icon: "school-outline",
    title: "Audio Course",
    tip: "Learn Kenya's road rules hands-free with short audio lessons whenever you have a few minutes.",
  },
  {
    icon: "videocam-outline",
    title: "Dashcam",
    tip: "Tap the dashcam control on the Drive screen to record your journey automatically.",
  },
  {
    icon: "lock-closed-outline",
    title: "Lock to Save",
    tip: "See something important? Tap the lock while recording to protect that dashcam clip from being overwritten.",
  },
  {
    icon: "construct-outline",
    title: "Vehicle Care",
    tip: "Keep your vehicle healthy with service reminders, care records and important maintenance details in your Garage.",
  },
  {
    icon: "warning-outline",
    title: "Accident Reports",
    tip: "After a crash, Accident Assistant helps you record what happened, collect evidence and prepare a report.",
  },
  {
    icon: "people-outline",
    title: "Emergency Contacts",
    tip: "Add trusted contacts in your Profile so Msafiri can alert them with your location when you need urgent help.",
  },
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
    ? <DefaultVehicleImage width={212} height={166} vehicle={vehicle} />
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
  const slides: Slide[] = FEATURES.map((feature, i) => ({
    ...feature,
    image:  !!activeVehicle ? null : GENERIC_SLIDES[i % GENERIC_SLIDES.length].image,
    // User vehicles: DefaultVehicleImage handles FACE_RIGHT internally → no flipX.
    // Generic images: mirror if the source faces left.
    flipX: !!activeVehicle ? false : GENERIC_SLIDES[i % GENERIC_SLIDES.length].flipX,
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
        {/* Soft showroom artwork behind the selected vehicle. The feature icon
            changes with the slide, while the vehicle itself remains the user's
            currently selected vehicle. */}
        <View pointerEvents="none" style={styles.artHalo}>
          <View style={styles.artIconTile}>
            <Ionicons name={curSlide.icon} size={38} color="#B8F1CD" />
          </View>
        </View>

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
        <View style={styles.titleRow}>
          <Text style={styles.title}>Start Driving</Text>
          {curSlide.isNew && (
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>NEW</Text>
            </View>
          )}
        </View>

        <View style={styles.featureRow}>
          <View style={styles.featureIconBubble}>
            <Ionicons name={curSlide.icon} size={20} color="#FFFFFF" />
          </View>
          <Text style={styles.featureTitle} numberOfLines={1}>{curSlide.title}</Text>
        </View>

        <Animated.Text style={[styles.tip, { opacity: tipOpacity }]}>
          {curSlide.tip}
        </Animated.Text>

        {showLongPressHint && (
          <Text style={styles.longPressHint}>Hold to open checklist</Text>
        )}

        <View style={styles.chevron}>
          <Ionicons name="chevron-forward" size={25} color="#0A7C3A" />
        </View>
      </View>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  imgWrap: {
    width: "46%",
    position: "relative",
    alignItems: "flex-end",
    justifyContent: "flex-end",
  },
  artHalo: {
    position: "absolute",
    width: 156,
    height: 156,
    left: 10,
    top: 10,
    borderRadius: 78,
    borderWidth: 3,
    borderColor: "#FFFFFF2E",
    backgroundColor: "#FFFFFF0A",
    alignItems: "center",
    justifyContent: "center",
  },
  artIconTile: {
    width: 76,
    height: 92,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "#FFFFFF16",
    backgroundColor: "#FFFFFF0A",
    alignItems: "center",
    justifyContent: "center",
  },
  carSlot: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "flex-end",
    justifyContent: "flex-end",
  },
  vehicleImg: { width: 212, height: 166 },
  dotsRow: {
    position: "absolute",
    bottom: 12,
    left: 12,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  dot:         { height: 5, borderRadius: 3 },
  dotActive:   { width: 14, backgroundColor: "#FFFFFF" },
  dotInactive: { width: 5,  backgroundColor: "#FFFFFF55" },
  textCol: {
    flex: 1,
    paddingVertical: 18,
    paddingRight: 18,
    paddingLeft: 8,
    justifyContent: "center",
    gap: 8,
  },
  title: {
    fontSize: 23,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  newBadge: {
    backgroundColor: "#A7F3D0",
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  newBadgeText: {
    fontSize: 8,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.6,
    color: "#065F35",
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 0,
  },
  featureIconBubble: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#FFFFFF22",
    alignItems: "center",
    justifyContent: "center",
  },
  featureTitle: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  tip: {
    fontSize: 13.5,
    fontFamily: "Inter_400Regular",
    color: "#D7F4E0",
    lineHeight: 20,
  },
  longPressHint: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: "#FFFFFF66",
    lineHeight: 14,
    marginTop: 2,
  },
  chevron: {
    marginTop: 10,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
});
