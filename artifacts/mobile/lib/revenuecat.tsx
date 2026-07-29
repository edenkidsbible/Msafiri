import React, { createContext, useContext } from "react";
import { Platform } from "react-native";
import Purchases from "react-native-purchases";
import { useMutation, useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

const REVENUECAT_TEST_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;
const REVENUECAT_IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
const REVENUECAT_ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;

// Test-only escape hatch: lets us hand out a sideloaded APK (via the "preview"
// EAS build profile) that skips the paywall entirely, so the rest of the app
// can be tested before Google Play Console subscription products exist.
// Must NEVER be set in the "production" build profile — see eas.json.
export const BYPASS_PAYWALL = process.env.EXPO_PUBLIC_BYPASS_PAYWALL === "true";

export const REVENUECAT_ENTITLEMENT_IDENTIFIER = "pro";

function getRevenueCatApiKey() {
  if (!REVENUECAT_TEST_API_KEY || !REVENUECAT_IOS_API_KEY || !REVENUECAT_ANDROID_API_KEY) {
    throw new Error("RevenueCat Public API Keys not found");
  }

  if (__DEV__ || Platform.OS === "web" || Constants.executionEnvironment === "storeClient") {
    return REVENUECAT_TEST_API_KEY;
  }

  if (Platform.OS === "ios") {
    return REVENUECAT_IOS_API_KEY;
  }

  if (Platform.OS === "android") {
    return REVENUECAT_ANDROID_API_KEY;
  }

  return REVENUECAT_TEST_API_KEY;
}

let _rcInitialized = false;

export function initializeRevenueCat() {
  // Guard against double-init: Expo Go hot-reload re-evaluates module-level
  // code on every file save, which would call Purchases.configure() again and
  // corrupt any in-flight purchase or subscription state.
  if (_rcInitialized) return;
  _rcInitialized = true;
  const apiKey = getRevenueCatApiKey();
  if (!apiKey) throw new Error("RevenueCat Public API Key not found");
  Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
  Purchases.configure({ apiKey });
  console.log("RevenueCat configured");
}

const REVIEWER_MODE_KEY = "sdk_reviewer_mode";

function useSubscriptionContext() {
  const customerInfoQuery = useQuery({
    queryKey: ["revenuecat", "customer-info"],
    queryFn: async () => Purchases.getCustomerInfo(),
    staleTime: 60 * 1000,
  });

  const offeringsQuery = useQuery({
    queryKey: ["revenuecat", "offerings"],
    queryFn: async () => {
      const result = await Purchases.getOfferings();
      // Treat an empty/null current offering as a retryable failure so the
      // query engine keeps trying rather than settling on an empty state.
      // This catches the case where RevenueCat returns successfully but App
      // Store Connect products haven't propagated to the sandbox yet.
      if (!result?.current) throw new Error("No current offering available");
      return result;
    },
    staleTime: 300 * 1000,
    // Up to 5 attempts (1 original + 4 retries) with exponential back-off
    // capped at 15 s. This lets a transient sandbox / network hiccup self-heal
    // within ~30 s without hammering the RevenueCat API.
    retry: 4,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
    // Always refetch when the paywall mounts or the app foregrounds, so a
    // reviewer who retries after a network blip gets a fresh attempt.
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const productIdentifiers =
    offeringsQuery.data?.current?.availablePackages.map((p) => p.product.identifier) ?? [];

  // Free-trial-abuse mitigation: ask the store whether THIS account has already used a
  // trial/intro offer for these products. This is iOS-only — Apple ties trial eligibility
  // to the App Store account, so it survives uninstall/reinstall on the same account.
  // Android's Play Billing API has no equivalent check (always returns UNKNOWN), and no
  // client-side check can catch a different store account on the same device, so this is
  // a real but partial mitigation, not a hard technical block.
  const trialEligibilityQuery = useQuery({
    queryKey: ["revenuecat", "trial-eligibility", productIdentifiers],
    queryFn: async () => Purchases.checkTrialOrIntroductoryPriceEligibility(productIdentifiers),
    enabled: Platform.OS === "ios" && productIdentifiers.length > 0,
    staleTime: 300 * 1000,
  });

  // Default to "eligible" (current behavior) whenever we can't determine otherwise —
  // Android, web, or an unknown/error result — so we never wrongly hide the trial offer.
  const isTrialEligible = (productIdentifier: string) => {
    if (Platform.OS !== "ios") return true;
    const status = trialEligibilityQuery.data?.[productIdentifier]?.status;
    return status !== Purchases.INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE;
  };

  const purchaseMutation = useMutation({
    mutationFn: async (packageToPurchase: any) => {
      const { customerInfo } = await Purchases.purchasePackage(packageToPurchase);
      return customerInfo;
    },
    onSuccess: () => {
      customerInfoQuery.refetch();
      // Fire-and-forget welcome notification — server gates on welcomeSentAt
      // so duplicate calls (e.g. restore purchases, refetch) are silently ignored.
      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      if (domain) {
        AsyncStorage.getItem("sdk_device_id")
          .then((id) => {
            if (!id) return;
            fetch(`https://${domain}/api/push/welcome`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ deviceId: id }),
            });
          })
          .catch(() => {});
      }
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async () => Purchases.restorePurchases(),
    onSuccess: () => customerInfoQuery.refetch(),
  });

  // Reviewer mode — toggled by a hidden 4-tap gesture on the paywall logo.
  // Persisted to AsyncStorage so it survives restarts during store review.
  // On each startup we check a public API endpoint: if an admin has disabled
  // it from the dashboard, the local flag is cleared on all devices instantly.
  const [reviewerMode, setReviewerModeState] = React.useState(false);
  React.useEffect(() => {
    (async () => {
      try {
        const domain = process.env.EXPO_PUBLIC_DOMAIN;
        if (domain) {
          const res = await fetch(`https://${domain}/api/settings/reviewer-mode`);
          if (res.ok) {
            const { enabled } = (await res.json()) as { enabled: boolean };
            if (!enabled) {
              // Admin killed reviewer mode remotely — wipe the local flag
              await AsyncStorage.removeItem(REVIEWER_MODE_KEY);
              setReviewerModeState(false);
              return;
            }
          }
        }
      } catch { /* network unavailable — fall back to local storage */ }
      // Remote allows it (or unreachable) — restore from local storage
      AsyncStorage.getItem(REVIEWER_MODE_KEY)
        .then(v => { if (v === "true") setReviewerModeState(true); })
        .catch(() => {});
    })();
  }, []);
  const setReviewerMode = async (enabled: boolean) => {
    setReviewerModeState(enabled);
    if (enabled) {
      await AsyncStorage.setItem(REVIEWER_MODE_KEY, "true");
    } else {
      await AsyncStorage.removeItem(REVIEWER_MODE_KEY);
    }
  };

  const isSubscribed =
    BYPASS_PAYWALL ||
    reviewerMode ||
    customerInfoQuery.data?.entitlements.active?.[REVENUECAT_ENTITLEMENT_IDENTIFIER] !== undefined;

  return {
    customerInfo: customerInfoQuery.data,
    offerings: offeringsQuery.data,
    isSubscribed,
    // isLoading: subscription status only — used by _layout.tsx to gate routing.
    // Offerings loading is intentionally excluded so the routing gate doesn't
    // block for the full retry window when sandbox products are slow to resolve.
    isLoading: customerInfoQuery.isLoading,
    // offeringsLoading: used by the paywall to show a spinner and disable the CTA.
    offeringsLoading: offeringsQuery.isLoading || offeringsQuery.isFetching,
    offeringsError: offeringsQuery.error ?? null,
    refetchOfferings: offeringsQuery.refetch,
    purchase: purchaseMutation.mutateAsync,
    restore: restoreMutation.mutateAsync,
    isPurchasing: purchaseMutation.isPending,
    isRestoring: restoreMutation.isPending,
    isTrialEligible,
    error: customerInfoQuery.error ?? offeringsQuery.error ?? purchaseMutation.error ?? null,
    reviewerMode,
    setReviewerMode,
  };
}

type SubscriptionContextValue = ReturnType<typeof useSubscriptionContext>;
const Context = createContext<SubscriptionContextValue | null>(null);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const value = useSubscriptionContext();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSubscription() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useSubscription must be used within a SubscriptionProvider");
  return ctx;
}
