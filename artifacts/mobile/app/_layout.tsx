import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppProvider, useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

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
  const { onboardingComplete, locationGranted, requestLocationPermission } = useApp();
  const c = useColors();
  const router = useRouter();
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    if (!onboardingComplete) {
      router.replace("/onboarding");
    } else if (!locationGranted) {
      requestLocationPermission();
    }
  }, [onboardingComplete]);

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
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
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // On web, fontfaceobserver blocks for 6 s then throws when the Google Fonts
  // CDN is unreachable (common in sandboxed environments). The browser loads
  // CSS fonts on its own — we don't need to gate rendering on them.
  const ready = Platform.OS === "web" || fontsLoaded || !!fontError;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <AppProvider>
                <RootLayoutNav />
              </AppProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
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
