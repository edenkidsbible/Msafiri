import { wrapRoot, captureError } from "@/utils/telemetry";

// ── Global crash safety nets ──────────────────────────────────────────────────
// Registered synchronously at module load time, before any component mounts,
// so async throws and fatal errors that escape all component-level try/catch
// are caught here instead of producing a blank screen or force-close.

// 1. Synchronous / fatal JS errors (RN ErrorUtils — works on iOS, Android, web).
if (typeof global !== "undefined" && (global as any).ErrorUtils) {
  const _prevGlobalHandler = (global as any).ErrorUtils.getGlobalHandler?.();
  (global as any).ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    console.error(
      `[GlobalErrorHandler] ${isFatal ? "FATAL" : "non-fatal"}:`,
      error?.message ?? error,
      error?.stack ?? ""
    );
    // Keep the existing handler (Expo dev overlay, etc.) in the chain.
    if (typeof _prevGlobalHandler === "function") {
      _prevGlobalHandler(error, isFatal);
    }
  });
}

// 2. Unhandled Promise rejections (Hermes engine tracker — RN 0.71+ / Expo 49+).
if (typeof global !== "undefined" && (global as any).HermesInternal?.enablePromiseRejectionTracker) {
  try {
    (global as any).HermesInternal.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (id: number, error: unknown) => {
        console.error(
          "[UnhandledRejection id=" + id + "]",
          error instanceof Error ? error.message + "\n" + (error.stack ?? "") : error
        );
        captureError(error, { source: "unhandledRejection", rejectionId: id });
      },
      onHandled: () => {},
    });
  } catch {
    // Tracker may already be registered on Expo Go hot reload — ignore.
  }
}

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
import { Stack, useRouter, useRootNavigationState } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus, InteractionManager, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons, Feather } from "@expo/vector-icons";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import RouteIncidentsPanel from "@/components/RouteIncidentsPanel";
import { AppProvider, useApp } from "@/context/AppContext";
import { DashcamProvider } from "@/context/DashcamContext";
import { VehicleProvider } from "@/context/VehicleContext";
import DashcamOverlay from "@/components/DashcamOverlay";
import { useColors } from "@/hooks/useColors";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useAppVersion } from "@/hooks/useAppVersion";
import { checkForOTAUpdate } from "@/hooks/useOTAUpdates";
import {
  initializeRevenueCat,
  SubscriptionProvider,
  useSubscription,
  BYPASS_PAYWALL,
  IOS_FREE_DRIVE_ACCESS,
} from "@/lib/revenuecat";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { defineShareBackgroundTask } from "@/utils/backgroundShare";
import { defineBackgroundNotificationTask } from "@/utils/backgroundNotificationTask";
import {
  defineBackgroundDriveAlertsTask,
  startBgDriveAlertsTask,
  stopBgDriveAlertsTask,
  BG_ALERT_OWNER_KEY,
} from "@/utils/backgroundDriveAlerts";
import { defineBackgroundOdometerTask } from "@/utils/backgroundOdometer";
import { prewarmAlertAudio, resetAlertPlayerCache, setAlertVoiceDisabled } from "@/utils/alertTts";
import { resetAudioMode, setSoundsMuted } from "@/utils/sound";
import GlobalAlertOverlay from "@/components/GlobalAlertOverlay";
import { setAlertOwner } from "@/utils/alertOwnership";

try {
  initializeRevenueCat();
} catch (err: any) {
  console.warn("RevenueCat unavailable:", err?.message ?? err);
}

// Register background tasks before any React components mount.
// expo-task-manager requires tasks to be defined synchronously at module
// load time — defining them inside a component or effect is too late.
defineShareBackgroundTask();
// Background notification task: wakes the app when a content-available push
// arrives (iOS) or a high-priority FCM arrives (Android) to refresh the
// push token and sync the device's last known location to the server.
defineBackgroundNotificationTask();
// Background drive-alert task: evaluates incoming GPS fixes against cached
// speed zones/reports and fires audible lock-screen notifications while the
// driver has an active trip and the screen is off.
defineBackgroundDriveAlertsTask();
// Background odometer task: accumulates driving distance while the app is
// backgrounded (no active trip) so the vehicle-care odometer doesn't drift low.
defineBackgroundOdometerTask();

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
  const { hydrated, onboardingComplete, requestLocationPermission, setNavDestination, driverName, navTripActive } = useApp();
  // Prevent the name-prompt from firing more than once per app session
  const namePromptShown = useRef(false);
  const {
    isSubscribed,
    isLoading: subLoading,
  } = useSubscription();
  const c = useColors();
  const router = useRouter();
  // Explicit navigator-ready signal: the root navigation state gets a key only
  // once the Stack has mounted. Gating navigation on this (and including it in
  // effect deps) guarantees a rerun after mount, instead of relying on
  // catching "navigate before mount" exceptions.
  const rootNavState = useRootNavigationState();
  const navReady = !!rootNavState?.key;
  const checked = useRef(false);
  // Once we've confirmed a subscription, remember it across brief RevenueCat
  // refresh windows. This prevents a transient isSubscribed=false (which can
  // happen when the SDK re-validates entitlements in the background) from
  // routing an active user back to the paywall if RootLayoutNav remounts.
  const wasSubscribed = useRef(false);
  if (isSubscribed) wasSubscribed.current = true;
  usePushNotifications();
  const versionCheck = useAppVersion();

  // ── Keep-awake: prevent screen dim/sleep while the app is in the foreground ──
  // Activated immediately on mount and whenever the app returns to the foreground.
  // Deactivated whenever the app backgrounds so the OS can dim/sleep normally.
  useEffect(() => {
    if (Platform.OS === "web") return;

    const tag = "msafiri-app";

    // Activate immediately (app is in foreground when this mounts)
    activateKeepAwakeAsync(tag).catch(() => {});

    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        activateKeepAwakeAsync(tag).catch(() => {});
      } else if (nextState === "background") {
        // Only release on true background, never on "inactive".
        // On Android, "inactive" fires for notification shade, system dialogs,
        // and other transient overlays — the app is still fully visible. Releasing
        // the lock there causes the screen to sleep mid-drive.
        deactivateKeepAwake(tag);
      }
    };

    const sub = AppState.addEventListener("change", handleAppStateChange);
    return () => {
      sub.remove();
      deactivateKeepAwake(tag);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Background drive-alert task lifecycle ─────────────────────────────────
  // Start the bg alert task when the driver has an active trip and the app is
  // backgrounded; stop it when the app foregrounds (in-app overlay resumes)
  // or the trip ends. A ref tracks the current AppState so the navTripActive
  // effect can read it without stale-closure issues.
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    if (Platform.OS === "web") return;
    let transition = Promise.resolve();
    if (AppState.currentState === "active") {
      AsyncStorage.setItem(BG_ALERT_OWNER_KEY, "foreground").catch(() => {});
    }
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (next === "background") {
        setAlertOwner("background");
        // Only a true background transition transfers ownership. "inactive"
        // is transient on Android (notification shade/system dialogs) and may
        // still leave foreground GPS/audio running.
        transition = transition.then(async () => {
          await AsyncStorage.setItem(BG_ALERT_OWNER_KEY, "background");
          if (navTripActive) await startBgDriveAlertsTask();
        }).catch(() => {});
      } else if (next === "active" && (prev === "background" || prev === "inactive")) {
        // Synchronously block both foreground producers and any new background
        // delivery while the persisted owner/task shutdown catches up.
        setAlertOwner("handoff");
        // Stop the background producer before handing alert ownership back.
        transition = transition.then(async () => {
          await AsyncStorage.setItem(BG_ALERT_OWNER_KEY, "foreground");
          await stopBgDriveAlertsTask();
          setAlertOwner("foreground");
        }).catch(() => {});

        // ── Restore audio alert capability after foreground return ──────────
        // A phone call, Siri/Google Assistant, or any system audio interruption
        // can leave the iOS AVAudioSession deactivated and cached AudioPlayer
        // instances in a dead/interrupted state.  Without these resets:
        //   • ensureAudioMode() sees a resolved promise and skips reconfiguring
        //     the session → every subsequent duckForAlert() is a no-op.
        //   • seekTo(0) + play() on a stale cached player silently fails →
        //     the code path looks correct but no sound comes out.
        // Resetting both forces a fresh session + fresh players on the very
        // next alert, so audio reliably restarts after any interruption.
        resetAudioMode();
        resetAlertPlayerCache();
        // Re-prewarm in the background so the next alert plays without delay.
        setTimeout(() => prewarmAlertAudio(), 500);
      }
    });
    return () => sub.remove();
  }, [navTripActive]);

  // When the trip ends while the app is already backgrounded, stop the task.
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!navTripActive) {
      setAlertOwner("foreground");
      stopBgDriveAlertsTask()
        .then(() => AsyncStorage.setItem(BG_ALERT_OWNER_KEY, "foreground"))
        .catch(() => {});
    } else if (appStateRef.current === "background") {
      setAlertOwner("background");
      AsyncStorage.setItem(BG_ALERT_OWNER_KEY, "background")
        .then(() => startBgDriveAlertsTask())
        .catch(() => {});
    }
  }, [navTripActive]);

  // Soft-update banner: dismissed once per session, not blocking
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);

  // Dedicated force-update watchdog — runs independently of the one-shot
  // routing guard below so that a force update published while the app is
  // already in the foreground (or when the user brings it back from the
  // background) locks the screen immediately without requiring a cold restart.
  useEffect(() => {
    // navReady gate: on a fast cold start the version check can resolve before
    // the Stack navigator mounts; navigating then throws "attempted to navigate
    // before mount". navReady is in the deps, so the effect reruns post-mount.
    if (!navReady || !versionCheck.checked || !versionCheck.isForceRequired) return;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navReady, versionCheck.checked, versionCheck.isForceRequired]);

  useEffect(() => {
    // Wait until AppContext has hydrated from AsyncStorage and RevenueCat
    // has resolved subscription status before making routing decisions.
    if (!hydrated) return;
    // Never route before the Stack navigator has mounted; navReady is a dep,
    // so the effect is guaranteed to rerun once it flips true.
    if (!navReady) return;
    if (checked.current) return;

    // Always wait for the version check API call to resolve before routing.
    // Without this guard, the effect could fall through to the
    // onboarding/paywall path and lock `checked.current = true` before
    // we know whether a force update is required — the force-update route
    // would then never fire even if the server returns isForceRequired: true.
    if (!versionCheck.checked) return;

    // Force update is handled by the dedicated watchdog above; skip here
    // so the checked.current flag is not consumed before the watchdog fires.
    if (versionCheck.isForceRequired) return;

    if (!onboardingComplete) {
      checked.current = true;
      router.replace("/onboarding");
      return;
    }
    // Android still requires RevenueCat to resolve before app entry. iOS uses a
    // three-drive allowance, so a slow or broken App Store response must never
    // hold the user on the startup/paywall path.
    if (subLoading && !IOS_FREE_DRIVE_ACCESS) return;
    checked.current = true;
    // Only route to paywall if we've never seen a valid subscription in this
    // session. wasSubscribed guards against a transient isSubscribed=false that
    // RevenueCat emits while re-validating entitlements after a background resume.
    if (!IOS_FREE_DRIVE_ACCESS && !isSubscribed && !wasSubscribed.current) {
      // Premium access starts only after the user begins the store-backed trial
      // or buys a plan. The trial itself is capped at three qualifying drives.
      router.replace("/paywall");
    } else {
      requestLocationPermission().catch(() => {});
      // Soft prompt for existing users who never provided a name — shown once
      // per app session so it isn't intrusive, but keeps nudging until they fill it in.
      if (!driverName && !namePromptShown.current) {
        namePromptShown.current = true;
        router.replace({ pathname: "/onboarding-name", params: { mode: "existing" } } as any);
      }
    }
  }, [hydrated, navReady, onboardingComplete, isSubscribed, subLoading, versionCheck]);

  // ── Deep link handler (geo: URIs and msafiri:// scheme) ────────────────────
  // Handles both cold-start (app launched from a location tap) and warm-start
  // (app already running in background when the user taps a location link).
  // Only navigates when the user has finished onboarding and has app access,
  // so the destination is never set before the main tab navigator is mounted.
  // On cold start Linking.getInitialURL() can resolve before the Stack mounts;
  // queue the parsed destination and flush it once navReady flips true.
  const pendingDeepLinkRef = useRef<ReturnType<typeof parseNavigationUrl> | null>(null);
  const handleNavigationUrl = useCallback(
    (url: string) => {
      // Deep links cannot bypass Android's subscription gate. iOS grants app
      // access before subscription and enforces its allowance when Drive starts.
      if (
        !hydrated ||
        !onboardingComplete ||
        (!IOS_FREE_DRIVE_ACCESS && !isSubscribed && !wasSubscribed.current)
      ) return;
      const dest = parseNavigationUrl(url);
      if (!dest) return;
      if (!navReady) {
        pendingDeepLinkRef.current = dest;
        return;
      }
      setNavDestination(dest);
      // Navigate to Drive Mode where the map and navigation live
      router.replace("/(tabs)/drive");
    },
    [hydrated, navReady, onboardingComplete, isSubscribed, setNavDestination, router]
  );

  // Flush a queued deep link as soon as the navigator is ready
  useEffect(() => {
    if (!navReady || !pendingDeepLinkRef.current) return;
    const dest = pendingDeepLinkRef.current;
    pendingDeepLinkRef.current = null;
    setNavDestination(dest);
    router.replace("/(tabs)/drive");
  }, [navReady, setNavDestination, router]);

  useEffect(() => {
    // Cold start: app was launched by tapping a location link
    Linking.getInitialURL()
      .then((url) => {
        if (url) handleNavigationUrl(url);
      })
      .catch(() => {});

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
      {/* Soft update banner — shown when a newer version is available but not
          required. Dismissable per session; taps open the relevant store page. */}
      {versionCheck.updateAvailable && !versionCheck.isForceRequired && !updateBannerDismissed && (
        <View style={styles.updateBanner}>
          <Ionicons name="arrow-up-circle-outline" size={15} color="#FFF" />
          <Text style={styles.updateBannerText} numberOfLines={1}>
            Update available{versionCheck.latestVersion ? ` · v${versionCheck.latestVersion}` : ""}
          </Text>
          {(versionCheck.storeUrlIos || versionCheck.storeUrlAndroid) && (
            <TouchableOpacity
              onPress={() => {
                const url = Platform.OS === "ios" ? versionCheck.storeUrlIos : versionCheck.storeUrlAndroid;
                if (url) Linking.openURL(url).catch(() => {});
              }}
              hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
            >
              <Text style={styles.updateBannerAction}>Update</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => setUpdateBannerDismissed(true)}
            hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={15} color="#FFFFFFCC" />
          </TouchableOpacity>
        </View>
      )}
      <RouteIncidentsPanel />
      {/* Global alert chip — floats above all tab content on every screen
          except the Drive tab, which renders its own full DriveAlertOverlay. */}
      <GlobalAlertOverlay />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.card },
          headerTintColor: c.foreground,
          headerTitleStyle: { fontFamily: "Inter_600SemiBold" },
          headerBackTitle: "Back",
          // On Android the default transition is a vertical fade-push (Material
          // style). Override to the horizontal card slide that iOS uses so
          // navigation feels consistent and more familiar for users coming from
          // iOS or who prefer the directional "go back" cue.
          ...(Platform.OS === "android" && {
            animation: "slide_from_right",
            gestureEnabled: true,
            // Prevents a flash of white/black behind the incoming screen.
            contentStyle: { backgroundColor: c.background },
          }),
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="onboarding"
          options={{ headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen
          name="onboarding-name"
          options={{ headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen
          name="paywall"
          options={{ headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen
          name="trial-ended"
          options={{ headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen name="about"   options={{ title: "About Msafiri" }} />
        <Stack.Screen name="contact" options={{ title: "Contact Us" }} />
        <Stack.Screen name="privacy" options={{ title: "Privacy Policy" }} />
        <Stack.Screen name="terms"         options={{ title: "Terms of Service" }} />
        <Stack.Screen name="force-update"     options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="creator-program" options={{ headerShown: false }} />
        <Stack.Screen name="live/[code]"     options={{ headerShown: false }} />
        <Stack.Screen name="accident-assistant-info" options={{ headerShown: false }} />
        <Stack.Screen name="admin-listings"           options={{ headerShown: false }} />
        <Stack.Screen name="trip-detail/[id]"        options={{ headerShown: false }} />
        <Stack.Screen name="vehicle-care"            options={{ headerShown: false }} />
        <Stack.Screen name="trip-history"            options={{ headerShown: false }} />
        <Stack.Screen name="dashcam-videos"          options={{ headerShown: false }} />
        <Stack.Screen name="accident-reports"        options={{ headerShown: false }} />
        <Stack.Screen name="join-vehicle"            options={{ headerShown: false }} />
        <Stack.Screen name="vehicle-share-code"      options={{ headerShown: false }} />
      </Stack>
    </View>
  );
}

function RootLayout() {
  // Web: skip font loading entirely — fontfaceobserver fires a 6-second timeout
  // as an uncaught rejection in sandboxed environments. The browser handles CSS
  // fonts on its own so we don't need to wait for them.
  // Native: load async and swallow errors so a CDN hiccup never hard-crashes the app.
  const [ready, setReady] = useState(Platform.OS === "web");

  useEffect(() => {
    if (Platform.OS === "web") return;
    let cancelled = false;
    let otaTimer: ReturnType<typeof setTimeout> | null = null;
    let prewarmTimer: ReturnType<typeof setTimeout> | null = null;

    // Fonts are the only resource allowed to hold the native splash screen.
    // Network-dependent OTA checks run after first paint so a weak connection
    // cannot make Android look frozen at launch.
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
    // Initialise audio mute/voice flags from AsyncStorage immediately at startup.
    // voiceDisabled and soundsMuted are module-level variables in alertTts.ts /
    // sound.ts; they default to false but are persisted via the Drive screen
    // toggle.  Without this early read, the flags stay false until the Drive
    // tab first mounts (Expo Router lazily renders tabs).  If the user had
    // previously disabled alerts, alerts would play audio on every cold start
    // until Drive mounts — or, worse, if they had enabled them the Drive tab
    // mount would correctly restore them but any alert that fired in the window
    // between startup and Drive mount would use the wrong state.
    AsyncStorage.multiGet(["voice_alerts_disabled", "sounds_muted"])
      .then(([[, voiceVal], [, soundsVal]]) => {
        setAlertVoiceDisabled(voiceVal === "true");
        setSoundsMuted(soundsVal === "true");
      })
      .catch(() => {});
    fontPromise.then(() => {
      if (cancelled) return;
      setReady(true);
      otaTimer = setTimeout(() => {
        void checkForOTAUpdate();
      }, 1000);
    });

    // Creating every native alert player is useful, but it competes with React
    // and the map during cold start on low-end Android phones. Defer it until
    // initial navigation/animations settle, then give first paint extra room.
    const prewarmTask = InteractionManager.runAfterInteractions(() => {
      prewarmTimer = setTimeout(() => prewarmAlertAudio(), 1500);
    });

    return () => {
      cancelled = true;
      if (otaTimer) clearTimeout(otaTimer);
      if (prewarmTimer) clearTimeout(prewarmTimer);
      prewarmTask.cancel();
    };
  }, []);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <SubscriptionProvider>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <VehicleProvider>
                  <AppProvider>
                    <DashcamProvider>
                      <RootLayoutNav />
                      <DashcamOverlay />
                    </DashcamProvider>
                  </AppProvider>
                </VehicleProvider>
              </KeyboardProvider>
            </GestureHandlerRootView>
          </SubscriptionProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

export default wrapRoot(RootLayout);

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
  updateBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#E65100",
    paddingVertical: 7,
    paddingHorizontal: 14,
    zIndex: 999,
  },
  updateBannerText: {
    flex: 1,
    color: "#FFF",
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  updateBannerAction: {
    color: "#FFD180",
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  offlineText: {
    color: "#fff",
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
});
