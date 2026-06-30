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
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";

const { width } = Dimensions.get("window");

const SLIDES = [
  {
    id: "1",
    image: require("@/assets/images/onboarding1.png"),
    title: "Drive Safer in Kenya",
    body: "SafeDrive Kenya warns you about speed cameras, police checkpoints, and speed zones before you reach them — so you're never caught by surprise.",
    color: "#00C853",
  },
  {
    id: "2",
    image: require("@/assets/images/onboarding2.png"),
    title: "Know Your Speed",
    body: "Your device's GPS shows your real-time speed in km/h. The app instantly alerts you when you're approaching a speed limit ahead.",
    color: "#1565C0",
  },
  {
    id: "3",
    image: require("@/assets/images/onboarding3.png"),
    title: "Community Reports",
    body: "Drivers on the road report new cameras, police checks, accidents, and more in real time. You can contribute too — and help fellow drivers.",
    color: "#7B1FA2",
  },
  {
    id: "4",
    image: require("@/assets/images/onboarding4.png"),
    title: "We Need Your Location",
    body: "To show your speed and detect nearby zones, we need access to your device's location. Your data stays on your device and is never shared.",
    color: "#F57C00",
  },
];

export default function OnboardingScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { completeOnboarding, requestLocationPermission } = useApp();
  const [activeIdx, setActiveIdx] = useState(0);
  const flatRef = useRef<FlatList<(typeof SLIDES)[0]>>(null);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
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
    await requestLocationPermission();
    completeOnboarding();
    router.replace("/(tabs)");
  };

  const isLast = activeIdx === SLIDES.length - 1;

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <FlatList
        ref={flatRef}
        data={SLIDES}
        keyExtractor={(s) => s.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewRef.current}
        viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]}>
            <Image
              source={item.image}
              style={[styles.slideImage, { marginTop: topInset + 24, borderColor: item.color + "44" }]}
              resizeMode="cover"
            />
            <Text style={[styles.slideTitle, { color: c.foreground }]}>{item.title}</Text>
            <Text style={[styles.slideBody, { color: c.mutedForeground }]}>{item.body}</Text>
          </View>
        )}
      />

      {/* Dots */}
      <View style={styles.dots}>
        {SLIDES.map((s, i) => (
          <View
            key={s.id}
            style={[
              styles.dot,
              {
                backgroundColor: i === activeIdx ? c.primary : c.border,
                width: i === activeIdx ? 24 : 8,
              },
            ]}
          />
        ))}
      </View>

      {/* Actions */}
      <View style={[styles.actions, { paddingBottom: bottomInset + 24 }]}>
        <TouchableOpacity
          style={[styles.nextBtn, { backgroundColor: c.primary }]}
          onPress={next}
          activeOpacity={0.88}
        >
          <Text style={[styles.nextText, { color: c.primaryForeground }]}>
            {isLast ? "Get Started" : "Next"}
          </Text>
          <Ionicons
            name={isLast ? "checkmark" : "arrow-forward"}
            size={18}
            color={c.primaryForeground}
          />
        </TouchableOpacity>

        {!isLast && (
          <TouchableOpacity onPress={finish} style={styles.skipBtn}>
            <Text style={[styles.skipText, { color: c.mutedForeground }]}>Skip</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  slide: { alignItems: "center", paddingHorizontal: 36, paddingBottom: 20 },
  slideImage: {
    width: width * 0.78,
    height: 260,
    borderRadius: 24,
    marginBottom: 28,
    borderWidth: 2,
  },
  slideTitle: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    marginBottom: 16,
  },
  slideBody: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 24,
  },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, marginBottom: 32 },
  dot: { height: 8, borderRadius: 4 },
  actions: { paddingHorizontal: 24, gap: 12 },
  nextBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
  },
  nextText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  skipBtn: { alignItems: "center", paddingVertical: 10 },
  skipText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
