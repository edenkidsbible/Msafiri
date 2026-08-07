import React, { useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Image,
  Platform,
  StatusBar,
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
import { useApp } from "@/context/AppContext";
import { VEHICLE_TYPES, VehicleTypeId } from "@/data/vehicleTypes";

const { width, height } = Dimensions.get("window");

// ── Brand palette ─────────────────────────────────────────────────────────────
const GREEN       = "#00A845";
const GREEN_DARK  = "#006B3C";
const FLAG_RED    = "#BB0000";   // Kenya flag red — badge colours & brand name only
const SCREEN_BG   = "#EDF7F2";   // light green tint — matches app-wide background
const SURFACE     = "#DDEEE6";   // slightly deeper tint for card surfaces
const BORDER      = "#C8E6D5";   // green-tinted border

// ── Types ─────────────────────────────────────────────────────────────────────
type AlertBadge = { emoji: string; label: string; color: string };

type BaseSlide = {
  id: string;
  accentColor: string;
  chip: string;
  heroEmoji: string;
  headline: string;
  sub: string;
};

type GridSlide   = BaseSlide & { kind: "grid";   badges: AlertBadge[] };
type FeatureSlide= BaseSlide & { kind: "feature"; features: { emoji: string; text: string }[] };
type PickerSlide = BaseSlide & { kind: "picker" };
type Slide = GridSlide | FeatureSlide | PickerSlide;

// ── Slide data ────────────────────────────────────────────────────────────────
const SLIDES: Slide[] = [
  {
    id:         "1",
    kind:       "grid",
    accentColor: GREEN,
    chip:       "ALERTS",
    heroEmoji:  "📡",
    headline:   "Every Threat.\nDetected.",
    sub:        "Speed cameras, alcoblow, police & roadblocks — all reported live.",
    badges: [
      { emoji: "📷", label: "Speed Camera",  color: FLAG_RED    },
      { emoji: "🍺", label: "Alcoblow",       color: "#E65100"  },
      { emoji: "👮", label: "Police",          color: "#1565C0"  },
      { emoji: "🚧", label: "Roadblock",       color: "#F57C00"  },
      { emoji: "🚦", label: "Traffic Jam",     color: GREEN_DARK },
      { emoji: "⚠️", label: "Hazards",         color: "#795548"  },
    ],
  },
  {
    id:         "2",
    kind:       "feature",
    accentColor: GREEN,
    chip:       "DASHCAM & SAFETY",
    heroEmoji:  "🎥",
    headline:   "Record Every\nJourney.",
    sub:        "Built-in dashcam. Automatic crash detection. Instant reports.",
    features: [
      { emoji: "📹", text: "Auto dashcam recording" },
      { emoji: "🆘", text: "Crash detection & SOS" },
      { emoji: "📋", text: "Insurance-ready reports" },
    ],
  },
  {
    id:         "3",
    kind:       "feature",
    accentColor: GREEN,
    chip:       "NAVIGATION",
    heroEmoji:  "🗺️",
    headline:   "Drive Smart.\nArrive Safe.",
    sub:        "Camera-aware routing, live ETA, and real-time trip sharing.",
    features: [
      { emoji: "📍", text: "Share live location" },
      { emoji: "🛡️", text: "Camera-aware routes" },
      { emoji: "⏱️", text: "Live ETA with delays" },
    ],
  },
  {
    id:         "4",
    kind:       "feature",
    accentColor: GREEN,
    chip:       "LEARN",
    heroEmoji:  "🎓",
    headline:   "Pass Your Test.\nDrive Better.",
    sub:        "Official NTSA driving course with audio lessons and quizzes.",
    features: [
      { emoji: "📖", text: "Full NTSA course content" },
      { emoji: "🔊", text: "Audio lessons to listen along" },
      { emoji: "✅", text: "Progress-tracked quizzes" },
    ],
  },
  {
    id:         "5",
    kind:       "picker",
    accentColor: GREEN,
    chip:       "YOUR VEHICLE",
    heroEmoji:  "🚗",
    headline:   "Your Vehicle,\nYour Limit.",
    sub:        "Speed limits differ by class in Kenya. Set yours once — we handle the rest.",
  },
];

// ── Alert badge grid ──────────────────────────────────────────────────────────
function AlertGrid({ badges }: { badges: AlertBadge[] }) {
  const cellW = (width - 48 - 12) / 3;
  return (
    <View style={g.grid}>
      {badges.map((b, i) => (
        <View key={i} style={[g.cell, { width: cellW, backgroundColor: b.color + "10", borderColor: b.color + "30" }]}>
          <Text style={g.emoji}>{b.emoji}</Text>
          <Text style={[g.label, { color: b.color }]}>{b.label}</Text>
        </View>
      ))}
    </View>
  );
}

const g = StyleSheet.create({
  grid: {
    flexDirection:  "row",
    flexWrap:       "wrap",
    gap:            8,
    width:          "100%",
    justifyContent: "center",
  },
  cell: {
    borderRadius:    16,
    borderWidth:     1,
    paddingVertical: 14,
    alignItems:      "center",
    gap:             6,
  },
  emoji: { fontSize: 26 },
  label: {
    fontSize:   11,
    fontFamily: "Inter_600SemiBold",
    textAlign:  "center",
    lineHeight: 14,
  },
});

// ── Feature list ──────────────────────────────────────────────────────────────
function FeatureList({ features, accent }: { features: { emoji: string; text: string }[]; accent: string }) {
  return (
    <View style={f.list}>
      {features.map((item, i) => (
        <View key={i} style={[f.row, { borderColor: accent + "20", backgroundColor: accent + "08" }]}>
          <View style={[f.emojiBox, { backgroundColor: accent + "16" }]}>
            <Text style={f.emoji}>{item.emoji}</Text>
          </View>
          <Text style={f.text}>{item.text}</Text>
          <View style={[f.check, { backgroundColor: accent }]}>
            <Ionicons name="checkmark" size={12} color="#fff" />
          </View>
        </View>
      ))}
    </View>
  );
}

const f = StyleSheet.create({
  list:    { width: "100%", gap: 10 },
  row: {
    flexDirection:     "row",
    alignItems:        "center",
    gap:               14,
    paddingVertical:   14,
    paddingHorizontal: 16,
    borderRadius:      18,
    borderWidth:       1,
  },
  emojiBox: {
    width:          44,
    height:         44,
    borderRadius:   12,
    alignItems:     "center",
    justifyContent: "center",
  },
  emoji:   { fontSize: 22 },
  text: {
    flex:       1,
    fontSize:   15,
    fontFamily: "Inter_600SemiBold",
    color:      "#0C120E",
    lineHeight: 20,
  },
  check: {
    width:          24,
    height:         24,
    borderRadius:   12,
    alignItems:     "center",
    justifyContent: "center",
  },
});

// ── Vehicle picker ────────────────────────────────────────────────────────────
function VehiclePicker({ accent, vehicleType, setVehicleType }: {
  accent: string;
  vehicleType: VehicleTypeId | null;
  setVehicleType: (id: VehicleTypeId) => void;
}) {
  const cardW = (width - 48 - 16) / 3;
  return (
    <View style={v.vehicleGrid}>
      {VEHICLE_TYPES.map((vt) => {
        const sel = vehicleType === vt.id;
        const IconComp = vt.iconSet === "Ionicons" ? Ionicons : MaterialCommunityIcons;
        return (
          <TouchableOpacity
            key={vt.id}
            style={[v.vehicleCard, {
              width:           cardW,
              backgroundColor: sel ? accent + "16" : SURFACE,
              borderColor:     sel ? accent        : BORDER,
              shadowColor:     sel ? accent        : "transparent",
              shadowOpacity:   sel ? 0.18          : 0,
              shadowOffset:    { width: 0, height: 4 },
              shadowRadius:    8,
              elevation:       sel ? 4             : 0,
            }]}
            onPress={() => { setVehicleType(vt.id as VehicleTypeId); Haptics.selectionAsync(); }}
            activeOpacity={0.8}
          >
            <IconComp name={vt.icon as any} size={28} color={sel ? accent : "#8A9E8A"} />
            <Text style={[v.vehicleLabel, { color: sel ? accent : "#555" }]}>{vt.shortLabel}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const v = StyleSheet.create({
  vehicleGrid: {
    flexDirection:  "row",
    flexWrap:       "wrap",
    justifyContent: "center",
    gap:            10,
    width:          "100%",
  },
  vehicleCard: {
    paddingVertical: 14,
    borderRadius:    18,
    borderWidth:     1.5,
    alignItems:      "center",
    gap:             7,
  },
  vehicleLabel: {
    fontSize:   11,
    fontFamily: "Inter_600SemiBold",
    textAlign:  "center",
  },
});

// ── Main screen ───────────────────────────────────────────────────────────────
export default function OnboardingScreen() {
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

  const isLast  = activeIdx === SLIDES.length - 1;
  const safeIdx = Math.max(0, Math.min(activeIdx, SLIDES.length - 1));
  const accent  = SLIDES[safeIdx].accentColor;

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" />

      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: topInset + 12 }]}>
        <View style={styles.headerSide} />
        <View style={styles.brandRow}>
          <Image source={require("@/assets/images/icon.png")} style={styles.brandIcon} />
          <Text style={styles.brandName}>
            Msafiri<Text style={styles.brandKenya}> Kenya</Text>
          </Text>
        </View>
        <View style={[styles.headerSide, { alignItems: "flex-end" }]}>
          <TouchableOpacity onPress={finish} hitSlop={{ top: 12, bottom: 12, left: 12, right: 4 }}>
            <Text style={styles.skipTxt}>Skip</Text>
          </TouchableOpacity>
        </View>
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

            {/* Chip */}
            <View style={[styles.chip, { backgroundColor: item.accentColor + "12", borderColor: item.accentColor + "40" }]}>
              <View style={[styles.chipDot, { backgroundColor: item.accentColor }]} />
              <Text style={[styles.chipTxt, { color: item.accentColor }]}>{item.chip}</Text>
            </View>

            {/* Hero emoji */}
            <View style={[styles.heroWrap, { backgroundColor: item.accentColor + "0F" }]}>
              <Text style={styles.heroEmoji}>{item.heroEmoji}</Text>
            </View>

            {/* Content area */}
            <View style={styles.contentArea}>
              {item.kind === "grid"    && <AlertGrid   badges={item.badges}   />}
              {item.kind === "feature" && <FeatureList features={item.features} accent={item.accentColor} />}
              {item.kind === "picker"  && (
                <VehiclePicker
                  accent={item.accentColor}
                  vehicleType={vehicleType}
                  setVehicleType={setVehicleType}
                />
              )}
            </View>

            {/* Text block */}
            <View style={styles.textBlock}>
              <Text style={[styles.headline, { color: item.accentColor }]}>{item.headline}</Text>
              <Text style={styles.sub}>{item.sub}</Text>
            </View>

          </View>
        )}
      />

      {/* ── Dots ── */}
      <View style={styles.dots}>
        {SLIDES.map((s, i) => (
          <TouchableOpacity
            key={s.id}
            onPress={() => flatRef.current?.scrollToIndex({ index: i })}
            activeOpacity={0.7}
          >
            <View style={[styles.dot, {
              backgroundColor: i === activeIdx ? accent : "#D0D5D0",
              width:           i === activeIdx ? 28     : 8,
              opacity:         i === activeIdx ? 1      : 0.6,
            }]} />
          </TouchableOpacity>
        ))}
      </View>

      {/* ── CTA ── */}
      <View style={[styles.actions, { paddingBottom: bottomInset + 20 }]}>
        <TouchableOpacity
          style={[styles.ctaBtn, { backgroundColor: accent, shadowColor: accent }]}
          onPress={next}
          activeOpacity={0.87}
        >
          <Text style={styles.ctaTxt}>{isLast ? "Get Started" : "Next"}</Text>
          <Ionicons
            name={isLast ? "checkmark-circle" : "arrow-forward-circle"}
            size={22}
            color="#FFF"
          />
        </TouchableOpacity>
      </View>

    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: {
    flex:            1,
    backgroundColor: SCREEN_BG,
  },

  // Header
  header: {
    flexDirection:     "row",
    alignItems:        "center",
    paddingHorizontal: 24,
    paddingBottom:     14,
  },
  headerSide: { flex: 1 },
  brandRow:   { flexDirection: "row", alignItems: "center", gap: 8 },
  brandIcon:  { width: 30, height: 30, borderRadius: 8 },
  brandName: {
    fontSize:      17,
    fontFamily:    "Inter_700Bold",
    color:         "#0C120E",
    letterSpacing: -0.3,
  },
  brandKenya: { color: FLAG_RED },
  skipTxt: {
    fontSize:        13,
    fontFamily:      "Inter_500Medium",
    color:           "#9AAA9A",
    paddingVertical: 4,
    paddingHorizontal: 8,
  },

  // Slide
  slide: {
    alignItems:        "center",
    paddingHorizontal: 24,
    paddingTop:        6,
    paddingBottom:     4,
    gap:               16,
  },

  // Chip
  chip: {
    flexDirection:     "row",
    alignItems:        "center",
    alignSelf:         "center",
    gap:               6,
    paddingVertical:   6,
    paddingHorizontal: 14,
    borderRadius:      24,
    borderWidth:       1,
  },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipTxt: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1.4 },

  // Hero emoji
  heroWrap: {
    width:          96,
    height:         96,
    borderRadius:   28,
    alignItems:     "center",
    justifyContent: "center",
  },
  heroEmoji: { fontSize: 52, lineHeight: 60 },

  // Content area (grid / feature list / picker)
  contentArea: {
    width: "100%",
  },

  // Text block
  textBlock: {
    width:      "100%",
    alignItems: "center",
    gap:        8,
    paddingTop: 4,
  },
  headline: {
    fontSize:      34,
    fontFamily:    "Inter_700Bold",
    textAlign:     "center",
    lineHeight:    42,
    letterSpacing: -0.5,
  },
  sub: {
    fontSize:   15,
    fontFamily: "Inter_400Regular",
    color:      "#5F6B62",
    textAlign:  "center",
    lineHeight: 22,
    maxWidth:   300,
  },

  // Dots
  dots: {
    flexDirection:  "row",
    justifyContent: "center",
    alignItems:     "center",
    gap:            6,
    paddingVertical: 10,
  },
  dot: { height: 8, borderRadius: 4, transition: "width 0.2s" } as any,

  // CTA
  actions: {
    paddingHorizontal: 24,
  },
  ctaBtn: {
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    gap:             10,
    paddingVertical: 18,
    borderRadius:    20,
    shadowOffset:    { width: 0, height: 6 },
    shadowOpacity:   0.25,
    shadowRadius:    14,
    elevation:       8,
  },
  ctaTxt: {
    fontSize:   17,
    fontFamily: "Inter_700Bold",
    color:      "#FFF",
    letterSpacing: 0.2,
  },
});
