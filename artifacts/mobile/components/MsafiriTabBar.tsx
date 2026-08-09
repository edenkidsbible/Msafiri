/**
 * MsafiriTabBar — shared bottom tab bar matching the UI-overhaul mockups.
 *
 * Five slots: Home · Map · [elevated round green Report "+" button] · Garage ·
 * Profile. Rendered on BOTH iOS and Android via the Expo Router
 * <Tabs tabBar={...}> prop so the bar is pixel-identical across platforms.
 *
 * The Report button is a raised green circle that sits proud of the bar —
 * exactly like the mockups — and navigates to the Report tab.
 *
 * Android feel improvements:
 * — Spring-bounce press animation on every tab (quick compress → elastic return)
 * — android_ripple on each Pressable for the material ink-spread on tap
 * — Haptic feedback on every tab press (not just Report)
 */

import { Feather, Ionicons } from "@expo/vector-icons";
import React, { useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";

// Order of visible slots in the bar. "report" renders as the center + button.
const SLOTS = ["index", "map", "report", "garage", "profile"] as const;
type SlotName = (typeof SLOTS)[number];

const TAB_META: Record<
  Exclude<SlotName, "report">,
  { label: string; icon: React.ComponentProps<typeof Feather>["name"] }
> = {
  index:   { label: "Home",    icon: "home" },
  map:     { label: "Map",     icon: "map" },
  garage:  { label: "Garage",  icon: "truck" },
  profile: { label: "Profile", icon: "user" },
};

export const TAB_BAR_BASE_HEIGHT = 64;

export function MsafiriTabBar({ state, navigation }: BottomTabBarProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, Platform.OS === "web" ? 10 : 8);

  // ── Per-slot animated scale values ─────────────────────────────────────────
  // Each tab press runs a quick compress → springy bounce-back animation.
  const scaleAnims = useRef(
    SLOTS.reduce<Record<string, Animated.Value>>((acc, name) => {
      acc[name] = new Animated.Value(1);
      return acc;
    }, {}),
  ).current;

  const animatePress = (name: string) => {
    const anim = scaleAnims[name];
    Animated.sequence([
      Animated.timing(anim, {
        toValue: 0.80,
        duration: 70,
        useNativeDriver: true,
      }),
      Animated.spring(anim, {
        toValue: 1,
        tension: 260,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const routeFor = (name: string) =>
    state.routes.find((r: { name: string }) => r.name === name);

  const navigate = (name: string) => {
    const route = routeFor(name);
    if (!route) return;
    const focused =
      state.index === state.routes.findIndex((r: { key: string }) => r.key === route.key);
    const event = navigation.emit({
      type: "tabPress",
      target: route.key,
      canPreventDefault: true,
    });
    if (!focused && !event.defaultPrevented) {
      navigation.navigate(name);
    }
  };

  const handlePress = (name: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    animatePress(name);
    navigate(name);
  };

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: c.isDark ? "#101312" : "#FFFFFF",
          borderTopColor: c.border,
          paddingBottom: bottomPad,
          height: TAB_BAR_BASE_HEIGHT + bottomPad,
        },
      ]}
    >
      {SLOTS.map((name) => {
        if (name === "report") {
          return (
            <View key="report" style={styles.centerSlot} pointerEvents="box-none">
              <Animated.View style={{ transform: [{ scale: scaleAnims["report"] }] }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Report"
                  onPress={() => handlePress("report")}
                  android_ripple={
                    Platform.OS === "android"
                      ? { color: "rgba(255,255,255,0.25)", borderless: true, radius: 36 }
                      : undefined
                  }
                  style={[
                    styles.centerBtn,
                    {
                      backgroundColor: c.primary,
                      shadowColor: c.primary,
                      borderColor: c.isDark ? "#0B0D0C" : "#FFFFFF",
                    },
                  ]}
                >
                  <Ionicons name="add" size={30} color={c.isDark ? "#04170B" : "#FFFFFF"} />
                </Pressable>
              </Animated.View>
              <Text style={[styles.label, { color: c.mutedForeground, marginTop: 33 }]}>
                Report
              </Text>
            </View>
          );
        }

        const route = routeFor(name);
        if (!route) return null;
        const focused =
          state.index ===
          state.routes.findIndex((r: { key: string }) => r.key === route.key);
        const meta = TAB_META[name];
        const color = focused ? c.primary : c.mutedForeground;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={meta.label}
            onPress={() => handlePress(name)}
            android_ripple={
              Platform.OS === "android"
                ? { color: c.primary + "25", borderless: true, radius: 36 }
                : undefined
            }
            style={styles.tab}
          >
            <Animated.View
              style={[
                styles.iconWrapOuter,
                { transform: [{ scale: scaleAnims[name] }] },
              ]}
            >
              <View
                style={[
                  styles.iconWrap,
                  focused && {
                    backgroundColor: c.primary + (c.isDark ? "1E" : "16"),
                    borderColor: c.primary + "44",
                    borderWidth: 1,
                  },
                ]}
              >
                <Feather name={meta.icon} size={21} color={color} />
              </View>
              <Text numberOfLines={1} style={[styles.label, { color }]}>
                {meta.label}
              </Text>
            </Animated.View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    paddingHorizontal: 6,
  },
  tab: {
    flex: 1,
    alignItems: "center",
  },
  iconWrapOuter: {
    alignItems: "center",
    gap: 3,
  },
  iconWrap: {
    width: 44,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  centerSlot: {
    flex: 1,
    alignItems: "center",
  },
  centerBtn: {
    position: "absolute",
    top: -26,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 12,
  },
  label: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
});
