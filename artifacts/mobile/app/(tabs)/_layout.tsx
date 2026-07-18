import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";
import { useColors } from "@/hooks/useColors";

// ─── iOS-only: all native-tab / SF-symbol imports are gated behind
// conditional require() so Metro does NOT bundle them on Android/web.
// Static top-level imports of expo-symbols / expo-router/unstable-native-tabs
// embed iOS Private-Use-Area glyphs in the JS bundle which render as
// "foreign characters" on Android. Conditional require() avoids this entirely.
const isIOS = Platform.OS === "ios";

function getIOSNativeTabs() {
  if (!isIOS) return null;
  try {
    return require("expo-router/unstable-native-tabs") as {
      NativeTabs: React.ComponentType<{ children: React.ReactNode }> & {
        Trigger: React.ComponentType<{ name: string; children: React.ReactNode }>;
      };
      Icon: React.ComponentType<{ sf: { default: string; selected?: string } }>;
      Label: React.ComponentType<{ children: string }>;
    };
  } catch {
    return null;
  }
}
function getSymbolView() {
  if (!isIOS) return null;
  try {
    return (require("expo-symbols") as { SymbolView: React.ComponentType<{ name: string; tintColor?: string; size?: number }> }).SymbolView;
  } catch {
    return null;
  }
}
function isLiquidGlass(): boolean {
  if (!isIOS) return false;
  try {
    return (require("expo-glass-effect") as { isLiquidGlassAvailable: () => boolean }).isLiquidGlassAvailable();
  } catch {
    return false;
  }
}

const NativeTabsModule = getIOSNativeTabs();
const SymbolView = getSymbolView();

function NativeTabLayout() {
  if (!NativeTabsModule) return null;
  const { NativeTabs, Icon, Label } = NativeTabsModule;
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "gauge", selected: "gauge.with.needle.fill" }} />
        <Label>Drive</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="map">
        <Icon sf={{ default: "map", selected: "map.fill" }} />
        <Label>Map</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="browse">
        <Icon sf={{ default: "location", selected: "location.fill" }} />
        <Label>Browse</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="trips">
        <Icon sf={{ default: "calendar", selected: "calendar" }} />
        <Label>Trips</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="learn">
        <Icon sf={{ default: "book", selected: "book.fill" }} />
        <Label>Learn</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} />
        <Label>Settings</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isWeb = Platform.OS === "web";

  const icon = (featherName: React.ComponentProps<typeof Feather>["name"], sfName: string) =>
    ({ color }: { color: string }) =>
      isIOS && SymbolView ? (
        <SymbolView name={sfName} tintColor={color} size={28} />
      ) : (
        <Feather name={featherName} size={24} color={color} />
      );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: "Inter_600SemiBold",
          marginBottom: isIOS ? 0 : 3,
        },
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : { height: 92 }),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={100} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
          ) : null,
      }}
    >
      <Tabs.Screen name="index"   options={{ title: "Drive",   tabBarIcon: icon("activity",   "gauge") }} />
      <Tabs.Screen name="map"     options={{ title: "Map",     tabBarIcon: icon("map",        "map") }} />
      <Tabs.Screen name="browse"  options={{ title: "Browse",  tabBarIcon: icon("compass",    "location") }} />
      <Tabs.Screen name="trips"   options={{ title: "Trips",    tabBarIcon: icon("calendar", "calendar") }} />
      <Tabs.Screen name="learn"   options={{ title: "Learn",   tabBarIcon: icon("book-open", "book"), href: isIOS ? null : undefined }} />
      <Tabs.Screen name="fines"   options={{ href: null }} />
      <Tabs.Screen name="settings"options={{ title: "Settings", tabBarIcon: icon("settings", "gearshape") }} />
    </Tabs>
  );
}

export default function TabLayout() {
  // On iOS, use the native UITabBarController via expo-router/unstable-native-tabs.
  // On iOS 18+ this automatically renders Apple's new floating tab bar (collapses
  // to icons-only while scrolling). On iOS 17 and below it falls back to the
  // standard UITabBarController — if you have 6 tabs that triggers the "More"
  // button, but iOS 18 handles additional tabs without it.
  // Android and web always use ClassicTabLayout (React Navigation + BlurView).
  if (isIOS && NativeTabsModule) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
