import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { StatusBar } from "expo-status-bar";
import * as Font from "expo-font";
import * as Linking from "expo-linking";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons, Feather } from "@expo/vector-icons";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import RouteIncidentsPanel from "@/components/RouteIncidentsPanel";
import { AppProvider, useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useAppVersion } from "@/hooks/useAppVersion";
import { checkForOTAUpdate } from "@/hooks/useOTAUpdates";
import { initializeRevenueCat, SubscriptionProvider, useSubscription, BYPASS_PAYWALL } from "@/lib/revenuecat";

try {
  initializeRevenueCat();
} catch (err: any) {
  console.warn("RevenueCat unavailable:", err?.message ?? err);
}

// Every @expo/vector-icons component (Ionicons, MaterialCommunityIcons,
// Feather — the three families this app uses) calls `Font.loadAsync()` for
// itself, uncaught, inside its own `componentDidMount` the first time it
// mounts on web. On web that call goes through `fontfaceobserver` with a
// hard 6-second timeout, and if the font fetch is merely slow (common in
// sandboxed/proxied preview environments) rather than actually broken, that
// becomes a genuine unhandled promise rejection we can't wrap in try/catch
// at the source. A global `unhandledrejection` listener added later (e.g.
// inside a component) isn't reliable here because Expo's own web dev-error
// overlay registers its listener first and shows the redbox regardless of
// whether our handler calls preventDefault().
//
// The real fix is to never let that internal call be the one that rejects
// unhandled: `Font.loadAsync()` synchronously registers the @font-face CSS
// rule before it starts waiting for confirmation, so calling it ourselves
// here — once, up front, with our own `.catch()` — makes `Font.isLoaded()`
// true by the time any icon component mounts and constructs its state, so
// the icon component's own internal loadAsync call never fires at all.
if (Platform.OS === "web") {
  [Ionicons, MaterialCommunityIcons, Feather].forEach((set) => {
    set.loadFont().catch(() => {});
  });
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

function PaywallBypassBanner() {
  if (!BYPASS_PAYWALL) return null;
  return (
    <View style={styles.bypassBanner}>
      <Ionicons name="construct-outline" size={14} color="#fff" />
      <Text style={styles.offlineText}>TEST BUILD — paywall bypassed, no real subscription</Text>
    </View>
  );
}

/**
 * Parse a navigation URL into a {name, lat, lng} object, or return null if
 * the URL is not a recognisable navigation link.
 *
 * Supported formats:
 *   geo:lat,lng                                (Android geo: intent)
 *   geo:lat,lng?q=lat,lng(Label)               (Android geo: with label)
 *   geo:0,0?q=lat,lng(Label)                   (WhatsApp Android format)
 *   msafiri://navigate?lat=X&lng=Y&name=Label  (our own deep link)
 *   msafiri://maps?daddr=lat,lng               (iOS Apple Maps handoff format)
 *   msafiri://maps?daddr=lat,lng&saddr=...     (iOS with source — daddr only used)
 */
function parseNavigationUrl(url: string): { name: string; lat: number; lng: number } | null {
  try {
    // ── msafiri:// deep links ─────────────────────────────────────────────
    if (url.startsWith("msafiri://navigate")) {
      const parsed = Linking.parse(url);
      const lat = parseFloat((parsed.queryParams?.lat as string) ?? "");
      const lng = parseFloat((parsed.queryParams?.lng as string) ?? "");
      const name = (parsed.queryParams?.name as string) || "Shared location";
      if (!isNaN(lat) && !isNaN(lng)) return { name, lat, lng };
    }

    // ── iOS Apple Maps handoff format ─────────────────────────────────────
    // When a user picks Msafiri from the iOS directions chooser (e.g. after
    // tapping directions on a WhatsApp location), Apple Maps opens the app
    // with: msafiri://maps?daddr=DESTINATION&saddr=SOURCE
    // daddr can be "lat,lng" or a place name — we only handle the coord form.
    if (url.startsWith("msafiri://maps")) {
      const parsed = Linking.parse(url);
      const daddr = (parsed.queryParams?.daddr as string) ?? "";
      // daddr may be "lat,lng" or "lat,lng (Label)" or a plain address string
      const coordMatch = daddr.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/);
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lng = parseFloat(coordMatch[2]);
        // Label is anything in parentheses after the coords, or fallback
        const labelMatch = daddr.match(/\((.+)\)$/);
        const name = labelMatch ? labelMatch[1] : "Shared location";
        if (!isNaN(lat) && !isNaN(lng)) return { name, lat, lng };
      }
    }

    // ── geo: URI (Android intent, also valid on iOS) ──────────────────────
    if (url.startsWith("geo:")) {
      const withoutScheme = url.slice(4); // e.g. "lat,lng?q=..."
      const [coords, queryString] = withoutScheme.split("?");

      // Parse optional label from q parameter: q=lat,lng(Label) or q=Label
      let label = "Shared location";
      let qLat: number | null = null;
      let qLng: number | null = null;
      if (queryString) {
        const qMatch = queryString.match(/q=([^&]+)/);
        if (qMatch) {
          const qVal = decodeURIComponent(qMatch[1]);
          // q=lat,lng(Label)
          const coordLabel = qVal.match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)\((.+)\)$/);
          if (coordLabel) {
            qLat = parseFloat(coordLabel[1]);
            qLng = parseFloat(coordLabel[2]);
            label = coordLabel[3];
          } else {
            // q=lat,lng (no label)
            const coordOnly = qVal.match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)$/);
            if (coordOnly) {
              qLat = parseFloat(coordOnly[1]);
              qLng = parseFloat(coordOnly[2]);
            } else {
              // q is a plain text label — no coords in q
              label = qVal;
            }
          }
        }
      }

      // The main coord pair in "geo:lat,lng" — used when q= has no coords
      const baseParts = coords?.split(",");
      const baseLat = baseParts ? parseFloat(baseParts[0] ?? "") : NaN;
      const baseLng = baseParts ? parseFloat(baseParts[1] ?? "") : NaN;

      // If q= had explicit coords, prefer them; otherwise fall back to base pair
      // (geo:0,0?q=lat,lng pattern is common in WhatsApp)
      const finalLat = qLat ?? baseLat;
      const finalLng = qLng ?? baseLng;

      if (!isNaN(finalLat) && !isNaN(finalLng)) {
        return { name: label, lat: finalLat, lng: finalLng };
      }
    }
  } catch {
    // Malformed URL — ignore
  }
  return null;
}

function RootLayoutNav() {
  const { hydrated, onboardingComplete, requestLocationPermission, setNavDestination } = useApp();
  const { isSubscribed, isLoading: subLoading } = useSubscription();
  const c = useColors();
  const router = useRouter();
  const checked = useRef(false);
  // Once we've confirmed a subscription, remember it across brief RevenueCat
  // refresh windows. This prevents a transient isSubscribed=false (which can
  // happen when the SDK re-validates entitlements in the background) from
  // routing an active user back to the paywall if RootLayoutNav remounts.
  const wasSubscribed = useRef(false);
  if (isSubscribed) wasSubscribed.current = true;
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
    // Only route to paywall if we've never seen a valid subscription in this
    // session. wasSubscribed guards against a transient isSubscribed=false that
    // RevenueCat emits while re-validating entitlements after a background resume.
    if (!isSubscribed && !wasSubscribed.current) {
      router.replace("/paywall");
    } else {
      requestLocationPermission();
    }
  }, [hydrated, onboardingComplete, isSubscribed, subLoading, versionCheck]);

  // ── Deep link handler (geo: URIs and msafiri:// scheme) ────────────────────
  // Handles both cold-start (app launched from a location tap) and warm-start
  // (app already running in background when the user taps a location link).
  // Only navigates when the user has finished onboarding and is subscribed,
  // so the destination is never set before the main tab navigator is mounted.
  const handleNavigationUrl = useCallback(
    (url: string) => {
      if (!hydrated || !onboardingComplete || (!isSubscribed && !wasSubscribed.current)) return;
      const dest = parseNavigationUrl(url);
      if (!dest) return;
      setNavDestination(dest);
      // Navigate to the Drive tab (index) where the map and navigation live
      router.replace("/(tabs)");
    },
    [hydrated, onboardingComplete, isSubscribed, setNavDestination, router]
  );

  useEffect(() => {
    // Cold start: app was launched by tapping a location link
    Linking.getInitialURL().then((url) => {
      if (url) handleNavigationUrl(url);
    });

    // Warm start: app was already running when a location link was tapped
    const sub = Linking.addEventListener("url", ({ url }) => handleNavigationUrl(url));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleNavigationUrl]);

  return (
    <View style={{ flex: 1 }}>
      {/* Reactive status bar — icon colour must follow the effective theme, not
          the system setting, so it stays in sync when the user overrides it
          in Settings. On Android the background colour matches the app chrome. */}
      <StatusBar
        style={c.isDark ? "light" : "dark"}
        backgroundColor={c.isDark ? "#000000" : "#ffffff"}
        translucent
      />
      <PaywallBypassBanner />
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
        <Stack.Screen name="force-update"     options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="creator-program" options={{ headerShown: false }} />
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
    // Run font loading and OTA update check in parallel behind the splash screen.
    // If an OTA update is available, checkForOTAUpdate() calls Updates.reloadAsync()
    // and returns true — in that case the app restarts and we must NOT hide the
    // splash screen (setReady must not be called).
    const fontPromise = Font.loadAsync({
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
    }).catch(() => {});
    const updatePromise = checkForOTAUpdate();
    Promise.all([fontPromise, updatePromise]).then(([, didReload]) => {
      if (!didReload) setReady(true);
    });
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
  bypassBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#C62828",
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
