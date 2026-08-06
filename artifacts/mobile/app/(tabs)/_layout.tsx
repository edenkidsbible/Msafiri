import { Tabs } from "expo-router";
import React from "react";
import { MsafiriTabBar } from "@/components/MsafiriTabBar";

/**
 * Five-tab navigation matching the UI-overhaul mockups:
 * Home · Map · Report (elevated round green center button) · Garage · Profile.
 *
 * The same custom MsafiriTabBar renders on iOS, Android, and web so the bar
 * is pixel-identical across platforms.
 *
 * Legacy screens (browse, trips, learn, fines, settings) stay registered as
 * hidden tabs (href: null) so their routes keep working — they are rehomed /
 * restyled in follow-up tasks. The drive screen is also a hidden tab so the
 * tab bar remains visible in Drive Mode (per the mockup).
 */
export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <MsafiriTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        // Hide the default tab bar — MsafiriTabBar takes over visually.
        tabBarStyle: {
          position: "absolute",
          height: 0,
          opacity: 0,
          overflow: "hidden",
        },
      }}
    >
      {/* Visible tabs (order matters — matches the bar slots) */}
      <Tabs.Screen name="index"   options={{ title: "Home" }} />
      <Tabs.Screen name="map"     options={{ title: "Map" }} />
      <Tabs.Screen name="report"  options={{ title: "Report" }} />
      <Tabs.Screen name="garage"  options={{ title: "Garage" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />

      {/* Drive Mode — hidden tab so the tab bar stays visible while driving */}
      <Tabs.Screen name="drive"   options={{ href: null }} />

      {/* Legacy routes — hidden but still routable until follow-up tasks rehome them */}
      <Tabs.Screen name="browse"   options={{ href: null }} />
      <Tabs.Screen name="trips"    options={{ href: null }} />
      <Tabs.Screen name="learn"    options={{ href: null }} />
      <Tabs.Screen name="fines"    options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  );
}
