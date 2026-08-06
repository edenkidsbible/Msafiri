/**
 * MsafiriTabBar — shared bottom tab bar matching the UI-overhaul mockups.
 *
 * Five slots: Home · Map · [elevated round green Report "+" button] · Garage ·
 * Profile. Rendered on BOTH iOS and Android via the Expo Router
 * <Tabs tabBar={...}> prop so the bar is pixel-identical across platforms.
 *
 * The Report button is a raised green circle that sits proud of the bar —
 * exactly like the mockups — and navigates to the Report tab.
 */

import { Feather, Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
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
          // Elevated round green center button
          return (
            <View key="report" style={styles.centerSlot} pointerEvents="box-none">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Report"
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                  navigate("report");
                }}
                style={({ pressed }) => [
                  styles.centerBtn,
                  {
                    backgroundColor: c.primary,
                    shadowColor: c.primary,
                    borderColor: c.isDark ? "#0B0D0C" : "#FFFFFF",
                  },
                  pressed && { transform: [{ scale: 0.94 }] },
                ]}
              >
                <Ionicons name="add" size={30} color={c.isDark ? "#04170B" : "#FFFFFF"} />
              </Pressable>
              <Text style={[styles.label, { color: c.mutedForeground, marginTop: 26 }]}>
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
            onPress={() => navigate(name)}
            style={({ pressed }) => [styles.tab, pressed && { opacity: 0.65 }]}
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
