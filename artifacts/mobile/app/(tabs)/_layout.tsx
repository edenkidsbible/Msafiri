import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";
import { useColors } from "@/hooks/useColors";
import { FloatingTabBar } from "@/components/FloatingTabBar";

// ─── Platform helpers ─────────────────────────────────────────────────────────

const isIOS = Platform.OS === "ios";

// SF Symbols — conditional require so Metro never bundles iOS-only glyphs
// into Android/web bundles (they render as foreign characters otherwise).
function getSymbolView() {
  if (!isIOS) return null;
  try {
    return (
      require("expo-symbols") as {
        SymbolView: React.ComponentType<{
          name: string;
          tintColor?: string;
          size?: number;
        }>;
      }
    ).SymbolView;
  } catch {
    return null;
  }
}
const SymbolView = getSymbolView();

// ─── Floating tab layout (iOS) ────────────────────────────────────────────────
//
// Uses a custom <FloatingTabBar> rendered via the `tabBar` prop so the bar
// appears as a frosted-glass pill floating above the home indicator.
// `tabBarStyle` is hidden so React Navigation doesn't render a second bar.

function FloatingTabLayout() {
  const colors = useColors();

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        // Hide the default tab bar — FloatingTabBar takes over visually.
        // Keep position:absolute so screens are full-height (no inset added).
        tabBarStyle: {
          position: "absolute",
          height: 0,
          opacity: 0,
          overflow: "hidden",
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
      }}
    >
      <Tabs.Screen name="index"    options={{ title: "Drive" }} />
      <Tabs.Screen name="map"      options={{ title: "Map" }} />
      <Tabs.Screen name="browse"   options={{ title: "Learn" }} />
      <Tabs.Screen name="trips"    options={{ title: "Trips" }} />
      {/* Learn hidden on iOS — only 5 tabs fit the floating bar cleanly */}
      <Tabs.Screen name="learn"    options={{ title: "Learn", href: null }} />
      <Tabs.Screen name="fines"    options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}

// ─── Classic tab layout (Android / web) ───────────────────────────────────────

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isWeb = Platform.OS === "web";

  const icon =
    (
      featherName: React.ComponentProps<typeof Feather>["name"],
      sfName: string
    ) =>
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
          marginBottom: 3,
        },
        tabBarStyle: {
          position: "absolute",
          backgroundColor: colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          height: isWeb ? 84 : 92,
        },
        tabBarBackground: () => (
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.background },
            ]}
          />
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Drive", tabBarIcon: icon("activity", "gauge") }}
      />
      <Tabs.Screen
        name="map"
        options={{ title: "Map", tabBarIcon: icon("map", "map") }}
      />
      <Tabs.Screen
        name="browse"
        options={{
          title: "Learn",
          tabBarIcon: icon("book-open", "book"),
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: "Trips",
          tabBarIcon: icon("calendar", "calendar"),
        }}
      />
      <Tabs.Screen
        name="learn"
        options={{
          title: "Learn",
          tabBarIcon: icon("book-open", "book"),
        }}
      />
      <Tabs.Screen name="fines" options={{ href: null }} />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: icon("settings", "gearshape"),
        }}
      />
    </Tabs>
  );
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export default function TabLayout() {
  // iOS → floating pill tab bar (iOS 18-style)
  // Android / web → classic bottom tab bar
  return isIOS ? <FloatingTabLayout /> : <ClassicTabLayout />;
}
