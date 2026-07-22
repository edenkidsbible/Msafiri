import React, { useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Image,
  ImageSourcePropType,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewToken,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { VEHICLE_TYPES, VehicleTypeId } from "@/data/vehicleTypes";

const { width, height } = Dimensions.get("window");

// Phone mockup proportions
const FRAME_W  = width * 0.74;
const FRAME_H  = FRAME_W * 1.92;   // ~19.5:9 tall-phone ratio

type ImageSlide = {
  id: string;
  image: ImageSourcePropType;
  accentColor: string;
  accentLabel: string;
  headline: [string, string];
  accentLine: 0 | 1;
  body: string;
  vehiclePicker?: false;
};

type PickerSlide = {
  id: string;
  accentColor: string;
  accentLabel: string;
  headline: [string, string];
  accentLine: 0 | 1;
  body: string;
  vehiclePicker: true;
};

type Slide = ImageSlide | PickerSlide;

const SLIDES: Slide[] = [
  {
    id: "1",
    image: require("@/assets/images/ob_drive.jpg"),
    accentColor: "#BE0000",     // Kenya flag red
    accentLabel: "LIVE ALERTS",
    headline: ["Know Every Camera", "Before It Sees You"],
    accentLine: 0,
    body: "Speed cameras, police checkpoints, and alcoblows — all mapped and announced ahead of you, in real time.",
  },
  {
    id: "2",
    image: require("@/assets/images/ob_route.jpg"),
    accentColor: "#006600",     // Kenya flag green
    accentLabel: "NAVIGATION",
    headline: ["Navigate Routes", "Camera-Aware"],
    accentLine: 0,
    body: "See every camera along your route before you even start moving. Pick the path that keeps you compliant.",
  },
  {
    id: "3",
    image: require("@/assets/images/ob_map.jpg"),
    accentColor: "#1565C0",     // blue
    accentLabel: "COMMUNITY MAP",
    headline: ["Every Hazard,", "Mapped Live"],
    accentLine: 1,
    body: "Accidents, traffic jams, road works, potholes — all reported live by Kenyan drivers around you.",
  },
  {
    id: "4",
    image: require("@/assets/images/ob_learn.jpg"),
    accentColor: "#5B2D8E",     // purple
    accentLabel: "LEARN",
    headline: ["Master Kenya's", "Traffic Laws"],
    accentLine: 1,
    body: "64 lessons covering road signs, NTSA fines, and defensive driving — study at your own pace.",
  },
  {
    id: "5",
    vehiclePicker: true,
    accentColor: "#E65100",     // orange
    accentLabel: "YOUR VEHICLE",
    headline: ["Your Vehicle,", "Your Speed Limit"],
    accentLine: 0,
    body: "Speed limits in Kenya vary by vehicle class. Tell us what you drive so we always show the right limit.",
  },
];

// ── Phone mockup frame ────────────────────────────────────────────────────────
function PhoneFrame({ image }: { image: ImageSourcePropType }) {
  return (
    <View style={styles.phoneOuter}>
      {/* Speaker pill */}
      <View style={styles.phoneSpeaker} />
      <View style={styles.phoneInner}>
        <Image source={image} style={styles.phoneImage} resizeMode="cover" />
      </View>
      {/* Home bar */}
      <View style={styles.phoneHomeBar} />
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function OnboardingScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    completeOnboarding,
    requestLocationPermission,
    requestNotificationPermission,
    vehicleType,
    setVehicleType,
  } = useApp();

  const [activeIdx, setActiveIdx] = useState(0);
  const flatRef = useRef<FlatList<Slide>>(null);

  const topInset    = Platform.OS === "web" ? 44 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const onViewRef = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems[0]) setActiveIdx(viewableItems[0].index ?? 0);
  });

  const next = () => {
    if (activeIdx < SLIDES.length - 1) {
      flatRef.current?.scrollToIndex({ index: activeIdx + 1 });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      finish();
    }
  };

  const finish = async () => {
    completeOnboarding();
    await requestLocationPermission();
    await requestNotificationPermission();
    router.replace("/paywall");
  };

  const isLast = activeIdx === SLIDES.length - 1;
  const accent  = SLIDES[activeIdx].accentColor;

  return (
    <View style={[styles.screen, { backgroundColor: "#FFFFFF" }]}>

      {/* ── Global header (sits above the FlatList) ── */}
      <View style={[styles.header, { paddingTop: topInset + 12 }]}>
        <View style={styles.brandRow}>
          <Image
            source={require("@/assets/images/icon.png")}
            style={styles.brandIcon}
          />
          <Text style={styles.brandName}>
            Msafiri{" "}
            <Text style={styles.brandKenya}>Kenya</Text>
          </Text>
        </View>

        <TouchableOpacity onPress={finish} hitSlop={{ top: 12, bottom: 12, left: 12, right: 4 }}>
          <Text style={styles.skipTxt}>Skip</Text>
        </TouchableOpacity>
      </View>

      {/* ── Slides ── */}
      <FlatList<Slide>
        ref={flatRef}
        data={SLIDES}
        keyExtractor={(s) => s.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewRef.current}
        viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
        style={{ flex: 1 }}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]}>

            {/* Accent label chip */}
            <View style={[styles.labelChip, { backgroundColor: item.accentColor + "18", borderColor: item.accentColor + "55" }]}>
              <View style={[styles.labelDot, { backgroundColor: item.accentColor }]} />
              <Text style={[styles.labelTxt, { color: item.accentColor }]}>{item.accentLabel}</Text>
            </View>

            {/* Hero: phone mockup OR vehicle picker */}
            {item.vehiclePicker ? (
              <View style={styles.vehicleHero}>
                <View style={[styles.vehicleIconCircle, { borderColor: item.accentColor + "44" }]}>
                  <Ionicons name="car-sport" size={72} color={item.accentColor} />
                </View>
                <View style={styles.vehicleGrid}>
                  {VEHICLE_TYPES.map((v) => {
                    const sel = vehicleType === v.id;
                    const Icon = v.iconSet === "Ionicons" ? Ionicons : MaterialCommunityIcons;
                    return (
                      <TouchableOpacity
                        key={v.id}
                        style={[
                          styles.vehicleCard,
                          {
                            backgroundColor: sel ? item.accentColor + "18" : "#F5F5F5",
                            borderColor: sel ? item.accentColor : "#E0E0E0",
                          },
                        ]}
                        onPress={() => { setVehicleType(v.id as VehicleTypeId); Haptics.selectionAsync(); }}
                        activeOpacity={0.8}
                      >
                        <Icon name={v.icon as any} size={28} color={sel ? item.accentColor : "#777"} />
                        <Text style={[styles.vehicleCardLabel, { color: sel ? item.accentColor : "#444" }]}>
                          {v.shortLabel}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : (
              <PhoneFrame image={(item as ImageSlide).image} />
            )}

            {/* Headline */}
            <View style={styles.textBlock}>
              <Text style={styles.headlineNormal}>
                {item.headline[item.accentLine === 0 ? 1 : 0]}
              </Text>
              <Text style={[styles.headlineAccent, { color: item.accentColor }]}>
                {item.headline[item.accentLine]}
              </Text>
              <Text style={styles.body}>{item.body}</Text>
            </View>
          </View>
        )}
      />

      {/* ── Kenya stripe accent ── */}
      <View style={styles.kenyaStripe}>
        <View style={[styles.stripeSeg, { backgroundColor: "#006600" }]} />
        <View style={[styles.stripeSeg, { backgroundColor: "#000000" }]} />
        <View style={[styles.stripeSeg, { backgroundColor: "#BE0000" }]} />
      </View>

      {/* ── Dots ── */}
      <View style={styles.dots}>
        {SLIDES.map((s, i) => (
          <TouchableOpacity key={s.id} onPress={() => flatRef.current?.scrollToIndex({ index: i })} activeOpacity={0.7}>
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: i === activeIdx ? accent : "#D0D0D0",
                  width: i === activeIdx ? 28 : 8,
                },
              ]}
            />
          </TouchableOpacity>
        ))}
      </View>

      {/* ── CTA ── */}
      <View style={[styles.actions, { paddingBottom: bottomInset + 16 }]}>
        <TouchableOpacity
          style={[styles.ctaBtn, { backgroundColor: accent }]}
          onPress={next}
          activeOpacity={0.87}
        >
          <Text style={styles.ctaTxt}>{isLast ? "Get Started" : "Next"}</Text>
          <Ionicons name={isLast ? "checkmark-circle" : "arrow-forward-circle"} size={22} color="#FFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1 },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "space-between",
    paddingHorizontal: 24,
    paddingBottom:   12,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandIcon: { width: 28, height: 28, borderRadius: 6 },
  brandName: {
    fontSize:   17,
    fontFamily: "Inter_700Bold",
    color:      "#0A0E1A",
    letterSpacing: -0.3,
  },
  brandKenya: { color: "#BE0000" },
  skipTxt: {
    fontSize:   14,
    fontFamily: "Inter_500Medium",
    color:      "#888",
  },

  // ── Slide ─────────────────────────────────────────────────────────────────
  slide: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 4,
  },

  // Accent label chip
  labelChip: {
    flexDirection:  "row",
    alignItems:     "center",
    gap:            6,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius:   20,
    borderWidth:    1,
    marginBottom:   16,
  },
  labelDot:  { width: 6, height: 6, borderRadius: 3 },
  labelTxt:  { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1.2 },

  // ── Phone mockup ──────────────────────────────────────────────────────────
  phoneOuter: {
    width:           FRAME_W,
    height:          FRAME_H,
    backgroundColor: "#1A1A2E",
    borderRadius:    44,
    alignItems:      "center",
    paddingVertical: 10,
    shadowColor:     "#000",
    shadowOffset:    { width: 0, height: 10 },
    shadowOpacity:   0.28,
    shadowRadius:    22,
    elevation:       18,
    marginBottom:    20,
  },
  phoneSpeaker: {
    width:           48,
    height:          5,
    backgroundColor: "#3A3A5C",
    borderRadius:    3,
    marginBottom:    8,
  },
  phoneInner: {
    flex:            1,
    width:           "100%",
    paddingHorizontal: 4,
    overflow:        "hidden",
    borderRadius:    36,
  },
  phoneImage: {
    width:           "100%",
    height:          "100%",
    borderRadius:    34,
  },
  phoneHomeBar: {
    width:           48,
    height:          5,
    backgroundColor: "#3A3A5C",
    borderRadius:    3,
    marginTop:       8,
  },

  // ── Vehicle picker hero ───────────────────────────────────────────────────
  vehicleHero: {
    alignItems: "center",
    width:      "100%",
    marginBottom: 20,
  },
  vehicleIconCircle: {
    width:         110,
    height:        110,
    borderRadius:  55,
    borderWidth:   2,
    alignItems:    "center",
    justifyContent: "center",
    marginBottom:  20,
    backgroundColor: "#FAFAFA",
  },
  vehicleGrid: {
    flexDirection: "row",
    flexWrap:      "wrap",
    justifyContent: "center",
    gap:           10,
    width:         "100%",
  },
  vehicleCard: {
    width:          width * 0.26,
    paddingVertical: 14,
    borderRadius:   14,
    borderWidth:    1.5,
    alignItems:     "center",
    gap:            6,
  },
  vehicleCardLabel: {
    fontSize:   12,
    fontFamily: "Inter_600SemiBold",
    textAlign:  "center",
  },

  // ── Text block ────────────────────────────────────────────────────────────
  textBlock: {
    alignItems: "center",
    paddingHorizontal: 8,
    gap: 2,
  },
  headlineNormal: {
    fontSize:      26,
    fontFamily:    "Inter_700Bold",
    color:         "#0A0E1A",
    textAlign:     "center",
    lineHeight:    32,
  },
  headlineAccent: {
    fontSize:      26,
    fontFamily:    "Inter_700Bold",
    textAlign:     "center",
    lineHeight:    32,
    marginBottom:  10,
  },
  body: {
    fontSize:   14,
    fontFamily: "Inter_400Regular",
    color:      "#666",
    textAlign:  "center",
    lineHeight: 21,
  },

  // ── Kenya stripe ──────────────────────────────────────────────────────────
  kenyaStripe: {
    flexDirection: "row",
    height:        4,
    marginHorizontal: 32,
    borderRadius:  2,
    overflow:      "hidden",
    marginBottom:  16,
    marginTop:     12,
  },
  stripeSeg: { flex: 1 },

  // ── Dots ──────────────────────────────────────────────────────────────────
  dots: {
    flexDirection:   "row",
    justifyContent:  "center",
    alignItems:      "center",
    gap:             6,
    marginBottom:    18,
  },
  dot: { height: 8, borderRadius: 4 },

  // ── CTA ───────────────────────────────────────────────────────────────────
  actions: { paddingHorizontal: 24 },
  ctaBtn: {
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    gap:             10,
    paddingVertical: 17,
    borderRadius:    18,
    shadowColor:     "#000",
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.18,
    shadowRadius:    10,
    elevation:       6,
  },
  ctaTxt: {
    fontSize:   17,
    fontFamily: "Inter_700Bold",
    color:      "#FFF",
  },
});
