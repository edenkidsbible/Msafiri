/**
 * FloatingTabBar — iOS 18-style floating pill tab bar.
 *
 * Rendered via the Expo Router <Tabs tabBar={...}> prop (iOS only).
 * Appears as a frosted-glass capsule floating above the home indicator,
 * with full-width margins and a drop shadow.
 */

import { BlurView } from "expo-blur";
import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useColors } from "@/hooks/useColors";

const isIOS = Platform.OS === "ios";

// SF Symbols — conditional require so Android/web never see the module
function loadSymbolView() {
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
const SymbolView = loadSymbolView();

// ─── Tab metadata ────────────────────────────────────────────────────────────

const VISIBLE_TABS = ["index", "map", "browse", "trips", "settings"] as const;
type TabName = (typeof VISIBLE_TABS)[number];

const TAB_META: Record<
  TabName,
  {
    label: string;
    feather: React.ComponentProps<typeof Feather>["name"];
    sfDefault: string;
    sfSelected: string;
  }
> = {
  index: {
    label: "Drive",
    feather: "activity",
    sfDefault: "gauge",
    sfSelected: "gauge.with.needle.fill",
  },
  map: {
    label: "Map",
    feather: "map",
    sfDefault: "map",
    sfSelected: "map.fill",
  },
  browse: {
    label: "Learn",
    feather: "compass",
    sfDefault: "location",
    sfSelected: "location.fill",
  },
  trips: {
    label: "Trips",
    feather: "calendar",
    sfDefault: "calendar",
    sfSelected: "calendar",
  },
  settings: {
    label: "Settings",
    feather: "settings",
    sfDefault: "gearshape",
    sfSelected: "gearshape.fill",
  },
};

// ─── Component ───────────────────────────────────────────────────────────────

export function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  // Only render the tabs that belong in the floating bar
  const visibleRoutes = state.routes.filter(
    (r: { key: string; name: string }) =>
      (VISIBLE_TABS as readonly string[]).includes(r.name)
  );

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        // Sit just above the home indicator (or screen bottom on older iPhones)
        { bottom: Math.max(insets.bottom, 12) + 6 },
      ]}
    >
      {/* Separate shadow shell — allows drop shadow while pill clips content */}
      <View
        style={[
          styles.shadowShell,
          {
            shadowColor: isDark ? "#000" : "#1a1a2e",
            shadowOpacity: isDark ? 0.5 : 0.14,
          },
        ]}
      >
        <BlurView
          intensity={85}
          tint={isDark ? "systemChromeMaterialDark" : "systemChromeMaterial"}
          style={styles.pill}
        >
          {/* Subtle border for definition against the background */}
          <View
            style={[
              StyleSheet.absoluteFill,
              styles.pillBorder,
              { borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)" },
            ]}
            pointerEvents="none"
          />

          {visibleRoutes.map((route: { key: string; name: string }) => {
            const name = route.name as TabName;
            const meta = TAB_META[name];
            if (!meta) return null;

            const focused = state.index === state.routes.indexOf(route);
            const color = focused ? colors.primary : colors.mutedForeground;

            const onPress = () => {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                accessibilityRole="button"
                accessibilityState={focused ? { selected: true } : {}}
                accessibilityLabel={meta.label}
                style={({ pressed }) => [
                  styles.tab,
                  pressed && styles.tabPressed,
                ]}
              >
                {/* Active indicator dot */}
                {focused && (
                  <View
                    style={[styles.activeDot, { backgroundColor: colors.primary }]}
                  />
                )}

                {isIOS && SymbolView ? (
                  <SymbolView
                    name={focused ? meta.sfSelected : meta.sfDefault}
                    tintColor={color}
                    size={23}
                  />
                ) : (
                  <Feather name={meta.feather} size={22} color={color} />
                )}

                <Text numberOfLines={1} style={[styles.label, { color }]}>
                  {meta.label}
                </Text>
              </Pressable>
            );
          })}
        </BlurView>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const RADIUS = 30;

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 16,
    right: 16,
  },
  shadowShell: {
    borderRadius: RADIUS,
    // iOS shadow
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 20,
    elevation: 14, // Android fallback
  },
  pill: {
    borderRadius: RADIUS,
    overflow: "hidden",
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  pillBorder: {
    borderRadius: RADIUS,
    borderWidth: 0.5,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    gap: 3,
  },
  tabPressed: {
    opacity: 0.65,
  },
  activeDot: {
    position: "absolute",
    top: 2,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  label: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
    letterSpacing: 0.1,
  },
});
