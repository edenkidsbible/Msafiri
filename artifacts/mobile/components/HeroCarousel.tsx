/**
 * HeroCarousel — reference-matched Start Driving carousel.
 *
 * The selected vehicle stays visible in front of the layered artwork while
 * the topic copy cross-fades between slides.
 */

import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { DefaultVehicleImage } from "@/components/DefaultVehicleImage";
import { SavedVehicle } from "@/utils/savedVehicles";

// ── Timing ────────────────────────────────────────────────────────────────────
const HOLD_MS = 4600;
const TIP_FADE_MS = 220;

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

  const tipOpacity = useRef(new Animated.Value(1)).current;

  const cancelRef   = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slidesRef   = useRef(slides);
  slidesRef.current = slides;

  useEffect(() => {
    cancelRef.current = false;
    const n = slidesRef.current.length;

    function scheduleNext() {
      timerRef.current = setTimeout(() => {
        if (cancelRef.current) return;
        Animated.timing(tipOpacity, {
          toValue: 0,
          duration: TIP_FADE_MS,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (!finished || cancelRef.current) return;
          setCurIdx((idx) => (idx + 1) % n);
          Animated.timing(tipOpacity, {
            toValue: 1,
            duration: TIP_FADE_MS,
            useNativeDriver: true,
          }).start(({ finished: fadedIn }) => {
            if (fadedIn && !cancelRef.current) scheduleNext();
          });
        });
      }, HOLD_MS);
    }

    tipOpacity.setValue(1);
    scheduleNext();

    return () => {
      cancelRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      tipOpacity.stopAnimation();
    };
  }, []);

  const curSlide = slides[curIdx];
  const watermarkIcon: React.ComponentProps<typeof Ionicons>["name"] =
    curSlide.title === "Emergency Contacts"
      ? "shield-outline"
      : curSlide.title === "Audio Course"
        ? "school-outline"
        : curSlide.icon;

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

          {/* Narrow phone/contact-style watermark inside the circular halo. */}
          <View
            style={[
              styles.artInnerBackdrop,
              {
                width: Math.round(artworkSize * 0.38),
                height: Math.round(artworkSize * 0.65),
              },
            ]}
          >
            <Ionicons
              name={watermarkIcon}
              size={Math.round(artworkSize * 0.43)}
              color="#B8F1CD"
              style={styles.artWatermark}
            />
            {curSlide.title === "Emergency Contacts" && (
              <View pointerEvents="none" style={styles.artInnerPeople}>
                <Ionicons name="people-outline" size={Math.round(artworkSize * 0.2)} color="#B8F1CD" />
              </View>
            )}
          </View>
        </View>

        <View
          style={[
            styles.carSlot,
            { width: carWidth, height: carHeight, bottom: isCompact ? 17 : 20 },
          ]}
        >
          <CarImage
            slide={curSlide}
            vehicle={activeVehicle}
            width={carWidth}
            height={carHeight}
          />
        </View>

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
    borderColor: "#FFFFFF2B",
    backgroundColor: "#FFFFFF0A",
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
    borderWidth: 1,
    borderColor: "#FFFFFF18",
  },
  artInnerBackdrop: {
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#FFFFFF1F",
    backgroundColor: "#FFFFFF05",
    alignItems: "center",
    justifyContent: "center",
  },
  artWatermark: { opacity: 0.15 },
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
