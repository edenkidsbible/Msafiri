/**
 * HeroCarousel — reference-matched Start Driving carousel.
 *
 * Each selected vehicle enters from the left, holds in the reference
 * composition, and exits to the right before the next topic is shown.
 */

import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { DefaultVehicleImage } from "@/components/DefaultVehicleImage";
import { SavedVehicle } from "@/utils/savedVehicles";

// ── Timing ────────────────────────────────────────────────────────────────────
const DRIVE_IN_MS = 1100;
const ZOOM_IN_MS = 450;
const HOLD_MS = 3800;
const ZOOM_OUT_MS = 350;
const TIP_OUT_MS = 200;
const DRIVE_OUT_MS = 1000;
const OFFSCREEN = 260;
const ZOOM_SCALE = 1.09;

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
function CarImage({
  slide,
  vehicle,
  width,
  height,
}: {
  slide: Slide;
  vehicle?: SavedVehicle | null;
  width: number;
  height: number;
}) {
  // DefaultVehicleImage handles FACE_RIGHT internally, so no extra flip needed.
  // Generic PNGs are flipped here via scaleX when flipX is true.
  const flip = slide.flipX ? [{ scaleX: -1 }] : undefined;
  return slide.image === null
    ? <DefaultVehicleImage width={width} height={height} vehicle={vehicle} />
    : <Image
        source={slide.image}
        style={[{ width, height }, flip ? { transform: flip } : undefined]}
        contentFit="contain"
      />;
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  activeVehicle?: SavedVehicle | null;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function HeroCarousel({ activeVehicle }: Props) {
  const { width: viewportWidth } = useWindowDimensions();
  const isCompact = viewportWidth < 380;
  const artworkSize = isCompact ? 128 : 138;
  const carWidth = isCompact ? 178 : 194;
  const carHeight = isCompact ? 122 : 132;
  const slides: Slide[] = FEATURES.map((feature, i) => ({
    ...feature,
    image:  !!activeVehicle ? null : GENERIC_SLIDES[i % GENERIC_SLIDES.length].image,
    // User vehicles: DefaultVehicleImage handles FACE_RIGHT internally → no flipX.
    // Generic images: mirror if the source faces left.
    flipX: !!activeVehicle ? false : GENERIC_SLIDES[i % GENERIC_SLIDES.length].flipX,
  }));

  const [curIdx, setCurIdx] = useState(0);

  const carPos = useRef(new Animated.Value(-OFFSCREEN)).current;
  const zoomScale = useRef(new Animated.Value(1)).current;
  const tipOpacity = useRef(new Animated.Value(0)).current;

  const cancelRef   = useRef(false);
  const slidesRef   = useRef(slides);
  slidesRef.current = slides;

  useEffect(() => {
    cancelRef.current = false;
    const n = slidesRef.current.length;

    function doEnter(idx: number) {
      if (cancelRef.current) return;
      Animated.timing(carPos, {
        toValue: 0,
        duration: DRIVE_IN_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished || cancelRef.current) return;
        Animated.parallel([
          Animated.timing(zoomScale, {
            toValue: ZOOM_SCALE,
            duration: ZOOM_IN_MS,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(tipOpacity, {
            toValue: 1,
            duration: ZOOM_IN_MS,
            useNativeDriver: true,
          }),
        ]).start(({ finished: held }) => {
          if (!held || cancelRef.current) return;
          Animated.delay(HOLD_MS).start(({ finished: delayed }) => {
            if (delayed && !cancelRef.current) doExit(idx);
          });
        });
      });
    }

    function doExit(idx: number) {
      if (cancelRef.current) return;
      const next = (idx + 1) % n;
      Animated.sequence([
        Animated.timing(zoomScale, {
          toValue: 1,
          duration: ZOOM_OUT_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(tipOpacity, {
          toValue: 0,
          duration: TIP_OUT_MS,
          useNativeDriver: true,
        }),
        Animated.timing(carPos, {
          toValue: OFFSCREEN,
          duration: DRIVE_OUT_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (!finished || cancelRef.current) return;
        zoomScale.setValue(1);
        tipOpacity.setValue(0);
        carPos.setValue(-OFFSCREEN);
        setCurIdx(next);
        requestAnimationFrame(() => doEnter(next));
      });
    }

    carPos.setValue(-OFFSCREEN);
    zoomScale.setValue(1);
    tipOpacity.setValue(0);
    doEnter(0);

    return () => {
      cancelRef.current = true;
      carPos.stopAnimation();
      zoomScale.stopAnimation();
      tipOpacity.stopAnimation();
    };
  }, []);

  const curSlide = slides[curIdx];
  const watermarkIcon = curSlide.icon;

  return (
    <>
      {/* Left: layered artwork area. The halo and watermark stay behind the
          selected vehicle; neither is a separate tile or a second vehicle. */}
      <View style={styles.imgWrap}>
        <View
          pointerEvents="none"
          style={[
            styles.artHalo,
            {
              width: artworkSize,
              height: artworkSize,
              borderRadius: artworkSize / 2,
              left: isCompact ? 9 : 14,
              top: isCompact ? 13 : 16,
            },
          ]}
        >
          <View pointerEvents="none" style={styles.artHaloInnerRing} />

          <Ionicons
            name={watermarkIcon}
            size={Math.round(artworkSize * 0.43)}
            color="#E4FFED"
            style={styles.artWatermark}
          />
        </View>

        <Animated.View
          style={[
            styles.carSlot,
            { width: carWidth, height: carHeight, bottom: isCompact ? 17 : 20 },
            { transform: [{ translateX: carPos }, { scale: zoomScale }] },
          ]}
        >
          <CarImage
            slide={curSlide}
            vehicle={activeVehicle}
            width={carWidth}
            height={carHeight}
          />
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

      {/* Right: content column */}
      <View style={styles.textCol}>
        <Text style={[styles.title, isCompact && styles.titleCompact]}>Start Driving</Text>

        <View style={styles.featureRow}>
          <View style={[styles.featureIconBubble, isCompact && styles.featureIconBubbleCompact]}>
            <Ionicons name={curSlide.icon} size={isCompact ? 13 : 15} color="#FFFFFF" />
          </View>
          <Text style={[styles.featureTitle, isCompact && styles.featureTitleCompact]} numberOfLines={1}>{curSlide.title}</Text>
        </View>

        <Animated.Text
          style={[styles.tip, isCompact && styles.tipCompact, { opacity: tipOpacity }]}
          numberOfLines={4}
        >
          {curSlide.tip}
        </Animated.Text>

        <View style={[styles.chevron, isCompact && styles.chevronCompact]}>
          <Ionicons name="chevron-forward" size={isCompact ? 18 : 20} color="#0A7C3A" />
        </View>
      </View>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  imgWrap: {
    width: "48%",
    position: "relative",
    alignItems: "flex-start",
    justifyContent: "flex-end",
  },
  artHalo: {
    position: "absolute",
    borderWidth: 3,
    borderColor: "#FFFFFF4A",
    backgroundColor: "#FFFFFF12",
    alignItems: "center",
    justifyContent: "center",
  },
  artHaloInnerRing: {
    position: "absolute",
    top: 7,
    right: 7,
    bottom: 7,
    left: 7,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#FFFFFF2E",
  },
  artWatermark: { opacity: 0.3 },
  artInnerPeople: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.9,
  },
  carSlot: {
    position: "absolute",
    left: -8,
    alignItems: "flex-start",
    justifyContent: "flex-end",
    zIndex: 2,
  },
  dotsRow: {
    position: "absolute",
    bottom: 10,
    left: 24,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    zIndex: 3,
  },
  dot:         { height: 5, borderRadius: 3 },
  dotActive:   { width: 14, backgroundColor: "#FFFFFF" },
  dotInactive: { width: 5,  backgroundColor: "#FFFFFF55" },
  textCol: {
    flex: 1,
    paddingTop: 13,
    paddingBottom: 10,
    paddingRight: 18,
    paddingLeft: 7,
    justifyContent: "flex-start",
  },
  title: {
    fontSize: 21,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  titleCompact: { fontSize: 18 },
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
    gap: 6,
    marginTop: 5,
  },
  featureIconBubble: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#FFFFFF22",
    alignItems: "center",
    justifyContent: "center",
  },
  featureIconBubbleCompact: { width: 22, height: 22, borderRadius: 11 },
  featureTitle: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  featureTitleCompact: { fontSize: 12.5 },
  tip: {
    fontSize: 11.2,
    fontFamily: "Inter_400Regular",
    color: "#D7F4E0",
    lineHeight: 15.5,
    marginTop: 5,
  },
  tipCompact: { fontSize: 10, lineHeight: 14 },
  chevron: {
    position: "absolute",
    left: 7,
    bottom: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  chevronCompact: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
});
