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
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { VEHICLE_TYPES, VehicleTypeId } from "@/data/vehicleTypes";

const { width } = Dimensions.get("window");

const SLIDES = [
  {
    id: "1",
    image: require("@/assets/images/onboarding1.webp"),
    title: "Drive Safer in Kenya",
    body: "Msafiri warns you about speed cameras, police checkpoints, and speed zones before you reach them — so you're never caught by surprise.",
    color: "#00C853",
  },
  {
    id: "2",
    image: require("@/assets/images/onboarding2.webp"),
    title: "Know Your Speed",
    body: "Your device's GPS shows your real-time speed in km/h. The app instantly alerts you when you're approaching a speed limit ahead.",
    color: "#1565C0",
  },
  {
    id: "3",
    image: require("@/assets/images/onboarding3.webp"),
    title: "Community Reports",
    body: "Drivers on the road report new cameras, police checks, accidents, and more in real time. You can contribute too — and help fellow drivers.",
    color: "#7B1FA2",
  },
  {
    id: "4",
    image: require("@/assets/images/onboarding4.webp"),
    title: "We Need Your Location",
    body: "To show your speed and detect nearby zones, we need access to your device's location. Your data stays on your device and is never shared.",
    color: "#F57C00",
  },
  {
    id: "5",
    vehiclePicker: true,
    title: "What Do You Drive?",
    body: "Speed limits in Kenya vary by vehicle class. Tell us what you drive so we can show you the correct limit for every zone.",
    color: "#D32F2F",
  },
];

export default function OnboardingScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { completeOnboarding, requestLocationPermission, vehicleType, setVehicleType } = useApp();
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
    completeOnboarding();
    router.replace("/paywall");
  };

  const selectVehicle = (id: VehicleTypeId) => {
    setVehicleType(id);
    Haptics.selectionAsync();
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
            {"vehiclePicker" in item ? (
              <View style={[styles.vehicleIconWrap, { marginTop: topInset + 24, borderColor: item.color + "44" }]}>
                <Ionicons name="car-sport" size={64} color={item.color} />
              </View>
            ) : (
              <Image
                source={item.image}
                style={[styles.slideImage, { marginTop: topInset + 24, borderColor: item.color + "44" }]}
                resizeMode="cover"
              />
            )}
            <Text style={[styles.slideTitle, { color: c.foreground }]}>{item.title}</Text>
            <Text style={[styles.slideBody, { color: c.mutedForeground }]}>{item.body}</Text>

            {"vehiclePicker" in item && (
              <View style={styles.vehicleGrid}>
                {VEHICLE_TYPES.map((v) => {
                  const selected = vehicleType === v.id;
                  const IconComponent = v.iconSet === "Ionicons" ? Ionicons : MaterialCommunityIcons;
                  return (
                    <TouchableOpacity
                      key={v.id}
                      style={[
                        styles.vehicleCard,
                        {
                          backgroundColor: selected ? item.color + "1A" : c.card,
                          borderColor: selected ? item.color : c.border,
                        },
                      ]}
                      onPress={() => selectVehicle(v.id)}
                      activeOpacity={0.8}
                    >
                      <IconComponent name={v.icon as any} size={26} color={selected ? item.color : c.mutedForeground} />
                      <Text
                        style={[
                          styles.vehicleCardLabel,
                          { color: selected ? item.color : c.foreground },
                        ]}
                      >
                        {v.shortLabel}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
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
  vehicleIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  vehicleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
    marginTop: 20,
  },
  vehicleCard: {
    width: width * 0.27,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    gap: 6,
  },
  vehicleCardLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
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
