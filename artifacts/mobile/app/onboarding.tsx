import React, { useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Image,
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
import { useApp } from "@/context/AppContext";
import { VEHICLE_TYPES, VehicleTypeId } from "@/data/vehicleTypes";

const { width } = Dimensions.get("window");

// ── Kenya flag palette ─────────────────────────────────────────────────────────
const FLAG_RED   = "#BB0000";
const FLAG_BLACK = "#1C1C1E";
const FLAG_GREEN = "#006B3C";

// ── Types ─────────────────────────────────────────────────────────────────────
type FeatureCard = {
  icon: string;
  iconSet: "Ionicons" | "MaterialCommunityIcons";
  title: string;
  sub: string;
};

type BaseSlide = {
  id: string;
  accentColor: string;
  accentLabel: string;
  headline: [string, string];
  accentLine: 0 | 1;
  body: string;
};

type CardSlide    = BaseSlide & { kind: "card";     heroIcon: string; heroIconSet: "Ionicons" | "MaterialCommunityIcons"; features: FeatureCard[] };
type IncidentSlide= BaseSlide & { kind: "incident"; heroIcon: string };
type PickerSlide  = BaseSlide & { kind: "picker" };
type Slide = CardSlide | IncidentSlide | PickerSlide;

// ── Incident data ─────────────────────────────────────────────────────────────
const INCIDENTS = [
  { emoji: "📷", label: "Speed Camera",  color: FLAG_RED   },
  { emoji: "👮", label: "Police",         color: "#1565C0" },
  { emoji: "🍺", label: "Alcoblow",       color: "#E65100" },
  { emoji: "💥", label: "Accident",       color: "#C62828" },
  { emoji: "🚧", label: "Roadblock",      color: "#F57C00" },
  { emoji: "🚦", label: "Traffic Jam",    color: FLAG_GREEN },
];

// ── Slide data ────────────────────────────────────────────────────────────────
const SLIDES: Slide[] = [
  {
    id: "1",
    kind: "card",
    accentColor: FLAG_RED,
    accentLabel: "SPEED CAMERAS",
    heroIcon: "camera",
    heroIconSet: "Ionicons",
    features: [
      { icon: "location",     iconSet: "Ionicons", title: "Live Distance",   sub: "Updates every second"  },
      { icon: "volume-high",  iconSet: "Ionicons", title: "Voice Alert",     sub: "Voice alerts warn you early"  },
      { icon: "flash",        iconSet: "Ionicons", title: "Instant Warning", sub: "Before you arrive"     },
    ],
    headline: ["Never Get Caught", "by a Speed Camera"],
    accentLine: 0,
    body: "Live distance warnings, voice alerts, and alarm sounds — all before you reach any camera.",
  },
  {
    id: "2",
    kind: "card",
    accentColor: FLAG_BLACK,
    accentLabel: "NAVIGATION",
    heroIcon: "navigate",
    heroIconSet: "Ionicons",
    features: [
      { icon: "shield-checkmark", iconSet: "Ionicons", title: "Camera-Aware",  sub: "See every camera ahead" },
      { icon: "time",             iconSet: "Ionicons", title: "ETA + Delays",  sub: "Traffic accounted for"  },
      { icon: "git-branch",       iconSet: "Ionicons", title: "Alt Routes",    sub: "Pick the safest path"   },
    ],
    headline: ["Plan Every Route", "Around Cameras"],
    accentLine: 0,
    body: "See every camera ahead before you start. Pick the fastest route that keeps you compliant.",
  },
  {
    id: "3",
    kind: "incident",
    accentColor: FLAG_GREEN,
    accentLabel: "COMMUNITY MAP",
    heroIcon: "people",
    headline: ["Kenyan Drivers", "Are Watching for You"],
    accentLine: 0,
    body: "Police checkpoints, alcoblows, accidents, and road works — all reported live by drivers around you.",
  },
  {
    id: "4",
    kind: "card",
    accentColor: FLAG_BLACK,
    accentLabel: "DRIVE MODE",
    heroIcon: "speedometer",
    heroIconSet: "Ionicons",
    features: [
      { icon: "speedometer", iconSet: "Ionicons", title: "Live Speed",      sub: "Real GPS km/h"           },
      { icon: "eye",         iconSet: "Ionicons", title: "Zone Limit",      sub: "Current road's limit"    },
      { icon: "warning",     iconSet: "Ionicons", title: "Overspeed Alert", sub: "Red warning instantly"   },
    ],
    headline: ["Your Speed vs the Limit.", "Every Single Second."],
    accentLine: 0,
    body: "Real-time speed display, zone limits, and an instant red alert the moment you exceed the limit.",
  },
  {
    id: "5",
    kind: "picker",
    accentColor: FLAG_RED,
    accentLabel: "YOUR VEHICLE",
    headline: ["Your Vehicle,", "Your Speed Limit"],
    accentLine: 0,
    body: "Speed limits vary by vehicle class in Kenya. Set yours once and we always show the right limit.",
  },
];

// ── Hero icon box ─────────────────────────────────────────────────────────────
function HeroIcon({ icon, iconSet, color }: { icon: string; iconSet: "Ionicons" | "MaterialCommunityIcons"; color: string }) {
  const IconComp = iconSet === "Ionicons" ? Ionicons : MaterialCommunityIcons;
  return (
    <View style={[styles.heroBox, { backgroundColor: color + "14" }]}>
      <IconComp name={icon as any} size={64} color={color} />
    </View>
  );
}

// ── Three feature cards ───────────────────────────────────────────────────────
function FeatureCards({ features, accent }: { features: FeatureCard[]; accent: string }) {
  return (
    <View style={styles.cardsRow}>
      {features.map((f, i) => {
        const IconComp = f.iconSet === "Ionicons" ? Ionicons : MaterialCommunityIcons;
        return (
          <View key={i} style={styles.card}>
            <IconComp name={f.icon as any} size={22} color={accent} />
            <Text style={styles.cardTitle}>{f.title}</Text>
            <Text style={styles.cardSub}>{f.sub}</Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Incident type grid ────────────────────────────────────────────────────────
function IncidentGrid() {
  const cellW = (width - 40 - 16) / 3;
  return (
    <View style={styles.incidentGrid}>
      {INCIDENTS.map((inc, i) => (
        <View key={i} style={[styles.incidentCell, { width: cellW, backgroundColor: inc.color + "12", borderColor: inc.color + "33" }]}>
          <Text style={styles.incidentEmoji}>{inc.emoji}</Text>
          <Text style={[styles.incidentLabel, { color: inc.color }]}>{inc.label}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Vehicle picker ────────────────────────────────────────────────────────────
function VehiclePicker({ accent, vehicleType, setVehicleType }: {
  accent: string;
  vehicleType: VehicleTypeId | null;
  setVehicleType: (id: VehicleTypeId) => void;
}) {
  const cardW = (width - 40 - 16) / 3;
  return (
    <View style={styles.vehicleHero}>
      <View style={[styles.heroBox, { backgroundColor: accent + "14" }]}>
        <Ionicons name="car-sport" size={64} color={accent} />
      </View>
      <View style={styles.vehicleGrid}>
        {VEHICLE_TYPES.map((v) => {
          const sel = vehicleType === v.id;
          const IconComp = v.iconSet === "Ionicons" ? Ionicons : MaterialCommunityIcons;
          return (
            <TouchableOpacity
              key={v.id}
              style={[styles.vehicleCard, {
                width: cardW,
                backgroundColor: sel ? accent + "14" : "#F5F5F5",
                borderColor:     sel ? accent       : "#E0E0E0",
              }]}
              onPress={() => { setVehicleType(v.id as VehicleTypeId); Haptics.selectionAsync(); }}
              activeOpacity={0.8}
            >
              <IconComp name={v.icon as any} size={26} color={sel ? accent : "#888"} />
              <Text style={[styles.vehicleCardLabel, { color: sel ? accent : "#555" }]}>
                {v.shortLabel}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

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

  const isLast = activeIdx === SLIDES.length - 1;
  // Clamp defensively — rapid swipe gestures can momentarily push activeIdx
  // out of range before the state settles, causing a crash on `.accentColor`.
  const safeIdx = Math.max(0, Math.min(activeIdx, SLIDES.length - 1));
  const accent  = SLIDES[safeIdx].accentColor;

  return (
    <View style={[styles.screen, { backgroundColor: "#FFFFFF" }]}>

      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: topInset + 12 }]}>
        {/* Left spacer balances the Skip button so brand stays truly centred */}
        <View style={styles.headerSide} />
        <View style={styles.brandRow}>
          <Image
            source={require("@/assets/images/icon.png")}
            style={styles.brandIcon}
          />
          <Text style={styles.brandName}>
            Msafiri{" "}<Text style={styles.brandKenya}>Kenya</Text>
          </Text>
        </View>
        <View style={[styles.headerSide, { alignItems: "flex-end" }]}>
          <TouchableOpacity onPress={finish} hitSlop={{ top: 12, bottom: 12, left: 12, right: 4 }}>
            <Text style={styles.skipTxt}>Skip</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Divider ── */}
      <View style={styles.headerDivider} />

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
            <View style={[styles.labelChip, { backgroundColor: item.accentColor + "14", borderColor: item.accentColor + "44" }]}>
              <View style={[styles.labelDot, { backgroundColor: item.accentColor }]} />
              <Text style={[styles.labelTxt, { color: item.accentColor }]}>{item.accentLabel}</Text>
            </View>

            {/* Hero section */}
            {item.kind === "card" && (
              <>
                <HeroIcon icon={item.heroIcon} iconSet={item.heroIconSet} color={item.accentColor} />
                <FeatureCards features={item.features} accent={item.accentColor} />
              </>
            )}
            {item.kind === "incident" && (
              <>
                <HeroIcon icon={item.heroIcon} iconSet="Ionicons" color={item.accentColor} />
                <IncidentGrid />
              </>
            )}
            {item.kind === "picker" && (
              <VehiclePicker
                accent={item.accentColor}
                vehicleType={vehicleType}
                setVehicleType={setVehicleType}
              />
            )}

            {/* Text block */}
            <View style={styles.textBlock}>
              <Text style={[styles.headlineAccent, { color: item.accentColor }]}>
                {item.headline[item.accentLine]}
              </Text>
              <Text style={styles.headlineNormal}>
                {item.headline[item.accentLine === 0 ? 1 : 0]}
              </Text>
              <Text style={styles.body}>{item.body}</Text>
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
              backgroundColor: i === activeIdx ? accent : "#D0D0D0",
              width:           i === activeIdx ? 28     : 8,
            }]} />
          </TouchableOpacity>
        ))}
      </View>

      {/* ── CTA ── */}
      <View style={[styles.actions, { paddingBottom: bottomInset + 16 }]}>
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
  screen: { flex: 1 },

  // Header
  header: {
    flexDirection:     "row",
    alignItems:        "center",
    paddingHorizontal: 24,
    paddingBottom:     12,
  },
  headerSide: { flex: 1 },
  headerDivider: {
    height:           1,
    backgroundColor:  "#F0F0F0",
    marginHorizontal: 20,
    marginBottom:     4,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandIcon: { width: 28, height: 28, borderRadius: 6 },
  brandName: {
    fontSize:      17,
    fontFamily:    "Inter_700Bold",
    color:         "#0A0E1A",
    letterSpacing: -0.3,
  },
  brandKenya: { color: FLAG_RED },
  skipTxt: {
    fontSize:   14,
    fontFamily: "Inter_500Medium",
    color:      "#888",
  },

  // Slide
  slide: {
    alignItems:        "center",
    paddingHorizontal: 20,
    paddingTop:        16,
  },

  // Accent label chip
  labelChip: {
    flexDirection:     "row",
    alignItems:        "center",
    alignSelf:         "center",
    gap:               6,
    paddingVertical:   5,
    paddingHorizontal: 12,
    borderRadius:      20,
    borderWidth:       1,
    marginBottom:      20,
  },
  labelDot: { width: 6, height: 6, borderRadius: 3 },
  labelTxt: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1.2 },

  // Hero icon box
  heroBox: {
    width:          112,
    height:         112,
    borderRadius:   28,
    alignItems:     "center",
    justifyContent: "center",
    marginBottom:   16,
  },

  // Feature cards
  cardsRow: {
    flexDirection: "row",
    gap:           8,
    marginBottom:  18,
    width:         "100%",
  },
  card: {
    flex:            1,
    backgroundColor: "#F6F6F6",
    borderRadius:    16,
    borderWidth:     1,
    borderColor:     "#EBEBEB",
    paddingVertical:   12,
    paddingHorizontal: 6,
    alignItems:      "center",
    gap:             4,
  },
  cardTitle: {
    fontSize:   12,
    fontFamily: "Inter_600SemiBold",
    color:      "#1a1a1a",
    textAlign:  "center",
    lineHeight: 16,
  },
  cardSub: {
    fontSize:   10,
    fontFamily: "Inter_400Regular",
    color:      "#888",
    textAlign:  "center",
    lineHeight: 14,
  },

  // Incident grid
  incidentGrid: {
    flexDirection:  "row",
    flexWrap:       "wrap",
    gap:            8,
    marginBottom:   24,
    width:          "100%",
    justifyContent: "center",
  },
  incidentCell: {
    borderRadius:   14,
    borderWidth:    1,
    paddingVertical: 10,
    alignItems:     "center",
    gap:            4,
  },
  incidentEmoji: { fontSize: 22 },
  incidentLabel: {
    fontSize:   11,
    fontFamily: "Inter_600SemiBold",
    textAlign:  "center",
    lineHeight: 14,
  },

  // Vehicle picker hero
  vehicleHero: {
    alignItems: "center",
    width:      "100%",
  },
  vehicleGrid: {
    flexDirection:  "row",
    flexWrap:       "wrap",
    justifyContent: "center",
    gap:            8,
    width:          "100%",
    marginBottom:   24,
  },
  vehicleCard: {
    paddingVertical: 12,
    borderRadius:    14,
    borderWidth:     1.5,
    alignItems:      "center",
    gap:             6,
  },
  vehicleCardLabel: {
    fontSize:   12,
    fontFamily: "Inter_600SemiBold",
    textAlign:  "center",
  },

  // Text block — flex:1 so it fills the remaining slide height;
  // justifyContent:"center" spreads the whitespace evenly above and below.
  textBlock: {
    flex:              1,
    width:             "100%",
    alignItems:        "center",
    justifyContent:    "center",
    paddingHorizontal: 8,
  },
  headlineAccent: {
    fontSize:   34,
    fontFamily: "Inter_700Bold",
    textAlign:  "center",
    lineHeight: 40,
  },
  headlineNormal: {
    fontSize:     34,
    fontFamily:   "Inter_700Bold",
    color:        "#0A0E1A",
    textAlign:    "center",
    lineHeight:   40,
    marginBottom: 12,
  },
  body: {
    fontSize:   16,
    fontFamily: "Inter_400Regular",
    color:      "#666",
    textAlign:  "center",
    lineHeight: 24,
  },

  // Dots
  dots: {
    flexDirection:  "row",
    justifyContent: "center",
    alignItems:     "center",
    gap:            6,
    marginBottom:   18,
  },
  dot: { height: 8, borderRadius: 4 },

  // CTA
  actions: { paddingHorizontal: 24 },
  ctaBtn: {
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    gap:             10,
    paddingVertical: 17,
    borderRadius:    18,
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.22,
    shadowRadius:    12,
    elevation:       6,
  },
  ctaTxt: {
    fontSize:   17,
    fontFamily: "Inter_700Bold",
    color:      "#FFF",
  },
});
