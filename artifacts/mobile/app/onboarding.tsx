import React, { useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewToken,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useApp } from "@/context/AppContext";
import { VEHICLE_TYPES, VehicleTypeId } from "@/data/vehicleTypes";

const { width } = Dimensions.get("window");

// ── Brand palette ─────────────────────────────────────────────────────────────
const GREEN       = "#00A845";
const GREEN_DARK  = "#006B3C";
const FLAG_RED    = "#BB0000";
const SCREEN_BG   = "#EDF7F2";
const SURFACE     = "#DDEEE6";
const BORDER      = "#C8E6D5";

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

type FeatureSlide = BaseSlide & { kind: "feature"; features: { emoji: string; text: string }[] };
type PickerSlide  = BaseSlide & { kind: "picker" };
type Slide = FeatureSlide | PickerSlide;

// ── Slide data — 3 slides ─────────────────────────────────────────────────────
const SLIDES: Slide[] = [
  {
    id:         "1",
    kind:       "feature",
    accentColor: GREEN,
    chip:       "SAFETY",
    heroEmoji:  "🛡️",
    headline:   "Every Threat.\nDetected.",
    sub:        "Speed cameras, alcoblow, police, roadblocks — all reported live.",
    features: [
      { emoji: "📷", text: "Speed cameras & alcoblow alerts" },
      { emoji: "👮", text: "Police & roadblock notifications" },
      { emoji: "🎥", text: "Built-in dashcam & crash detection" },
      { emoji: "📋", text: "Instant insurance-ready reports" },
    ],
  },
  {
    id:         "2",
    kind:       "feature",
    accentColor: GREEN,
    chip:       "DRIVE SMART",
    heroEmoji:  "🗺️",
    headline:   "Drive Smart.\nArrive Safe.",
    sub:        "Camera-aware routing, live ETA, audio driving lessons and quizzes.",
    features: [
      { emoji: "📍", text: "Share your live location with family" },
      { emoji: "🛡️", text: "Camera-aware routes & live ETA" },
      { emoji: "📖", text: "Full NTSA audio driving course" },
      { emoji: "✅", text: "Progress-tracked quizzes" },
    ],
  },
  {
    id:         "3",
    kind:       "picker",
    accentColor: GREEN,
    chip:       "YOUR VEHICLE & NAME",
    heroEmoji:  "🚗",
    headline:   "Personalise\nYour Experience.",
    sub:        "Speed limits differ by vehicle class. Set yours once — we handle the rest.",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const lettersOnly = (s: string) => s.replace(/[^a-zA-Z]/g, "");
const capitalize  = (s: string) =>
  s.length === 0 ? s : s[0].toUpperCase() + s.slice(1).toLowerCase();

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
  list:    { width: "100%", gap: 8 },
  row: {
    flexDirection:     "row",
    alignItems:        "center",
    gap:               12,
    paddingVertical:   12,
    paddingHorizontal: 14,
    borderRadius:      16,
    borderWidth:       1,
  },
  emojiBox: {
    width:          40,
    height:         40,
    borderRadius:   12,
    alignItems:     "center",
    justifyContent: "center",
  },
  emoji:   { fontSize: 20 },
  text: {
    flex:       1,
    fontSize:   14,
    fontFamily: "Inter_600SemiBold",
    color:      "#0C120E",
    lineHeight: 18,
  },
  check: {
    width:          22,
    height:         22,
    borderRadius:   11,
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
            <IconComp name={vt.icon as any} size={26} color={sel ? accent : "#8A9E8A"} />
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
    gap:            8,
    width:          "100%",
  },
  vehicleCard: {
    paddingVertical: 12,
    borderRadius:    16,
    borderWidth:     1.5,
    alignItems:      "center",
    gap:             6,
  },
  vehicleLabel: {
    fontSize:   11,
    fontFamily: "Inter_600SemiBold",
    textAlign:  "center",
  },
});

// ── Inline name input for slide 3 ─────────────────────────────────────────────
function NameInput({
  value,
  onChange,
  showNudge,
  accent,
}: {
  value: string;
  onChange: (t: string) => void;
  showNudge: boolean;
  accent: string;
}) {
  const isValid = value.length >= 2;
  return (
    <View style={ni.wrap}>
      <Text style={[ni.label, { color: accent }]}>Your first name</Text>
      <TextInput
        style={[
          ni.input,
          isValid && { borderColor: accent, shadowColor: accent, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.14, shadowRadius: 4, elevation: 2 },
        ]}
        value={value}
        onChangeText={(t) => onChange(lettersOnly(t))}
        placeholder="e.g. Peter"
        placeholderTextColor="#A0B5A0"
        autoCorrect={false}
        autoCapitalize="none"
        maxLength={30}
        returnKeyType="done"
      />
      {isValid && (
        <View style={ni.hint}>
          <Ionicons name="checkmark-circle" size={13} color={accent} />
          <Text style={[ni.hintTxt, { color: accent }]}>
            Saved as <Text style={{ fontFamily: "Inter_700Bold" }}>{capitalize(value)}</Text>
          </Text>
        </View>
      )}
      {showNudge && value.length > 0 && !isValid && (
        <View style={ni.hint}>
          <Ionicons name="information-circle-outline" size={13} color="#9AAA9A" />
          <Text style={[ni.hintTxt, { color: "#9AAA9A" }]}>Enter at least 2 letters</Text>
        </View>
      )}
    </View>
  );
}

const ni = StyleSheet.create({
  wrap:  { width: "100%", gap: 6, marginBottom: 14 },
  label: { fontSize: 12, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },
  input: {
    width:             "100%",
    backgroundColor:   "#FFFFFF",
    borderRadius:      14,
    borderWidth:       1.5,
    borderColor:       BORDER,
    paddingHorizontal: 16,
    paddingVertical:   12,
    fontSize:          18,
    fontFamily:        "Inter_600SemiBold",
    color:             "#0C120E",
    textAlign:         "center",
    letterSpacing:     0.5,
  },
  hint: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  hintTxt: { fontSize: 12, fontFamily: "Inter_400Regular" },
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
    setDriverName,
  } = useApp();

  const [activeIdx, setActiveIdx] = useState(0);
  const [name, setName] = useState("");
  const [showNameNudge, setShowNameNudge] = useState(false);
  const flatRef = useRef<FlatList<Slide>>(null);

  const topInset    = Platform.OS === "web" ? 44 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const onViewRef = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems[0]) setActiveIdx(viewableItems[0].index ?? 0);
  });

  const isLast   = activeIdx === SLIDES.length - 1;
  const safeIdx  = Math.max(0, Math.min(activeIdx, SLIDES.length - 1));
  const accent   = SLIDES[safeIdx].accentColor;

  const finish = async (skipName = false) => {
    // Persist name if valid
    if (!skipName && name.length >= 2) {
      setDriverName(capitalize(name));
    }
    completeOnboarding();
    // Record when onboarding completed so home screen can gate the 7-day phone-link banner
    await AsyncStorage.setItem("onboardingCompletedAt", Date.now().toString()).catch(() => {});
    await requestLocationPermission();
    await requestNotificationPermission();
    // First-time users start with the three-session free allowance. Vehicle
    // setup is the next step; the paywall is only reached after the allowance
    // is exhausted.
    router.replace("/vehicle-setup");
  };

  const next = () => {
    if (!isLast) {
      flatRef.current?.scrollToIndex({ index: activeIdx + 1 });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    // Last slide — validate name nudge if partially typed
    if (name.length > 0 && name.length < 2) {
      setShowNameNudge(true);
      return;
    }
    void finish(name.length === 0);
  };

  const skip = () => {
    void finish(true); // Skip always ignores name
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
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
          <TouchableOpacity onPress={skip} hitSlop={{ top: 12, bottom: 12, left: 12, right: 4 }}>
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
              {item.kind === "feature" && (
                <FeatureList features={item.features} accent={item.accentColor} />
              )}
              {item.kind === "picker" && (
                <>
                  <NameInput
                    value={name}
                    onChange={(t) => { setName(t); if (showNameNudge) setShowNameNudge(false); }}
                    showNudge={showNameNudge}
                    accent={item.accentColor}
                  />
                  <Text style={[styles.vehicleLabel, { color: item.accentColor }]}>Vehicle type</Text>
                  <VehiclePicker
                    accent={item.accentColor}
                    vehicleType={vehicleType}
                    setVehicleType={setVehicleType}
                  />
                </>
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

    </KeyboardAvoidingView>
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
    fontSize:          13,
    fontFamily:        "Inter_500Medium",
    color:             "#9AAA9A",
    paddingVertical:   4,
    paddingHorizontal: 8,
  },

  // Slide
  slide: {
    alignItems:        "center",
    paddingHorizontal: 24,
    paddingTop:        4,
    paddingBottom:     4,
    gap:               12,
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
    width:          80,
    height:         80,
    borderRadius:   24,
    alignItems:     "center",
    justifyContent: "center",
  },
  heroEmoji: { fontSize: 44, lineHeight: 52 },

  // Content area
  contentArea: {
    width: "100%",
  },

  vehicleLabel: {
    fontSize:      12,
    fontFamily:    "Inter_600SemiBold",
    letterSpacing: 0.5,
    marginBottom:  8,
  },

  // Text block
  textBlock: {
    width:      "100%",
    alignItems: "center",
    gap:        6,
  },
  headline: {
    fontSize:      28,
    fontFamily:    "Inter_700Bold",
    textAlign:     "center",
    lineHeight:    36,
    letterSpacing: -0.5,
  },
  sub: {
    fontSize:   14,
    fontFamily: "Inter_400Regular",
    color:      "#5F6B62",
    textAlign:  "center",
    lineHeight: 20,
    maxWidth:   300,
  },

  // Dots
  dots: {
    flexDirection:   "row",
    justifyContent:  "center",
    alignItems:      "center",
    gap:             6,
    paddingVertical: 8,
  },
  dot: {
    height:      8,
    borderRadius: 4,
  },

  // CTA
  actions:    { paddingHorizontal: 24 },
  ctaBtn: {
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    gap:             10,
    paddingVertical: 17,
    borderRadius:    20,
    shadowOffset:    { width: 0, height: 6 },
    shadowOpacity:   0.25,
    shadowRadius:    14,
    elevation:       8,
  },
  ctaTxt: {
    fontSize:      17,
    fontFamily:    "Inter_700Bold",
    color:         "#FFF",
    letterSpacing: 0.2,
  },
});
