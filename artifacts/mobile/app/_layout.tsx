import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import * as Font from "expo-font";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import RouteIncidentsPanel from "@/components/RouteIncidentsPanel";
import { AppProvider, useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useAppVersion } from "@/hooks/useAppVersion";
import { initializeRevenueCat, SubscriptionProvider, useSubscription } from "@/lib/revenuecat";

try {
  initializeRevenueCat();
} catch (err: any) {
  console.warn("RevenueCat unavailable:", err?.message ?? err);
}

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function OfflineBanner() {
  const { isOffline } = useApp();
  if (!isOffline) return null;
  return (
    <View style={styles.offlineBanner}>
      <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
      <Text style={styles.offlineText}>No internet — using offline data</Text>
    </View>
  );
}

function RootLayoutNav() {
  const { hydrated, onboardingComplete, requestLocationPermission } = useApp();
  const { isSubscribed, isLoading: subLoading } = useSubscription();
  const c = useColors();
  const router = useRouter();
  const checked = useRef(false);
  usePushNotifications();
  const versionCheck = useAppVersion();

  useEffect(() => {
    // Wait until AppContext has hydrated from AsyncStorage and RevenueCat
    // has resolved subscription status before making routing decisions.
    if (!hydrated) return;
    if (checked.current) return;

    // Check for required update before anything else
    if (versionCheck.checked && versionCheck.isForceRequired) {
      checked.current = true;
      router.replace({
        pathname: "/force-update",
        params: {
          latestVersion:   versionCheck.latestVersion ?? "",
          releaseNotes:    versionCheck.releaseNotes ?? "",
          storeUrlIos:     versionCheck.storeUrlIos ?? "",
          storeUrlAndroid: versionCheck.storeUrlAndroid ?? "",
          isSoft:          "false",
        },
      } as any);
      return;
    }

    if (!onboardingComplete) {
      checked.current = true;
      router.replace("/onboarding");
      return;
    }
    // Onboarding done — wait for RevenueCat to confirm subscription status
    if (subLoading) return;
    checked.current = true;
    if (!isSubscribed) {
      router.replace("/paywall");
    } else {
      requestLocationPermission();
    }
  }, [hydrated, onboardingComplete, isSubscribed, subLoading, versionCheck]);

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <RouteIncidentsPanel />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.card },
          headerTintColor: c.foreground,
          headerTitleStyle: { fontFamily: "Inter_600SemiBold" },
          headerBackTitle: "Back",
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="onboarding"
          options={{ headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen
          name="paywall"
          options={{ headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen name="about"   options={{ title: "About Msafiri" }} />
        <Stack.Screen name="contact" options={{ title: "Contact Us" }} />
        <Stack.Screen name="privacy" options={{ title: "Privacy Policy" }} />
        <Stack.Screen name="terms"         options={{ title: "Terms of Service" }} />
        <Stack.Screen name="force-update"  options={{ headerShown: false, gestureEnabled: false }} />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  // Web: skip font loading entirely — fontfaceobserver fires a 6-second timeout
  // as an uncaught rejection in sandboxed environments. The browser handles CSS
  // fonts on its own so we don't need to wait for them.
  // Native: load async and swallow errors so a CDN hiccup never hard-crashes the app.
  const [ready, setReady] = useState(Platform.OS === "web");

  useEffect(() => {
    if (Platform.OS === "web") return;
    Font.loadAsync({
      Inter_400Regular,
      Inter_500Medium,
      Inter_600SemiBold,
      Inter_700Bold,
      // Bundled ourselves because some Android builds (emulators/devices
      // without Google Play Services) lack the system Noto Color Emoji
      // font — without it, Android falls back to a CJK font and our
      // incident emoji render as random Chinese/Japanese characters.
      // Subsetted to only the ~18 codepoints this app actually uses.
      NotoColorEmoji: require("@/assets/fonts/NotoColorEmoji.ttf"),
    })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <SubscriptionProvider>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <AppProvider>
                  <RootLayoutNav />
                </AppProvider>
              </KeyboardProvider>
            </GestureHandlerRootView>
          </SubscriptionProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#555",
    paddingVertical: 6,
    paddingHorizontal: 16,
    zIndex: 999,
  },
  offlineText: {
    color: "#fff",
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
});
