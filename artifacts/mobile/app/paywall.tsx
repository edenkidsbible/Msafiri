import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSubscription } from "@/lib/revenuecat";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";

type Result = "success" | "restored" | "error" | null;

const FEATURES = [
  { icon: "speedometer",      label: "GPS speed display" },
  { icon: "shield-checkmark", label: "Speed camera alerts" },
  { icon: "people",           label: "Community reports" },
  { icon: "mic",              label: "Voice & haptic alerts" },
  { icon: "alert-circle",     label: "SOS button" },
  { icon: "navigate",         label: "Navigation" },
  { icon: "time",             label: "Trip history" },
  { icon: "cloud-offline",    label: "Offline mode" },
];

export default function PaywallScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { requestLocationPermission } = useApp();
  const { offerings, isLoading, offeringsError, refetchOfferings, purchase, isPurchasing, restore, isRestoring, isTrialEligible, setReviewerMode } =
    useSubscription();

  const [selectedPkg, setSelectedPkg] = useState<string>("$rc_monthly");
  const [result, setResult] = useState<Result>(null);
  const [activePlanLabel, setActivePlanLabel] = useState("");
  const [activePlanPrice, setActivePlanPrice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const topPad = Platform.OS === "web" ? 20 : insets.top + 8;
  const botPad = Platform.OS === "web" ? 20 : insets.bottom + 16;

  const currentOffering = offerings?.current;
  const weeklyPkg  = currentOffering?.availablePackages.find((p) => p.identifier === "$rc_weekly");
  const monthlyPkg = currentOffering?.availablePackages.find((p) => p.identifier === "$rc_monthly");
  const chosenPkg  = selectedPkg === "$rc_weekly" ? weeklyPkg : monthlyPkg;

  // Always use the authoritative priceString from the store via RevenueCat.
  // Never show hardcoded fallback prices in the purchase UI — a mismatch between
  // displayed and charged currency/amount violates store subscription policies.
  // While loading, the plan cards show an ActivityIndicator (see isLoading guard below).
  const weeklyPriceString  = weeklyPkg?.product.priceString  ?? "";
  const monthlyPriceString = monthlyPkg?.product.priceString ?? "";
  const chosenPriceString  = selectedPkg === "$rc_weekly" ? weeklyPriceString : monthlyPriceString;

  // If this store account has already used its free trial (iOS only — Android/web
  // always report eligible), show regular pricing copy instead of trial copy.
  const trialEligible = chosenPkg ? isTrialEligible(chosenPkg.product.identifier) : true;

  async function handleSubscribe() {
    if (!chosenPkg) return;
    try {
      await purchase(chosenPkg);
      setActivePlanLabel(selectedPkg === "$rc_weekly" ? "Weekly" : "Monthly");
      setActivePlanPrice(chosenPkg.product.priceString);
      setResult("success");
    } catch (e: any) {
      if (e?.userCancelled) return;
      setErrorMessage(
        e?.message && !e.message.includes("userCancelled")
          ? e.message
          : "The payment could not be completed. Please check your payment details and try again."
      );
      setResult("error");
    }
  }

  async function handleRestore() {
    try {
      await restore();
      setResult("restored");
    } catch (e: any) {
      setErrorMessage(
        e?.message ?? "No active subscription was found for your account. If you believe this is an error, please contact support."
      );
      setResult("error");
    }
  }

  // Hidden reviewer bypass — tap the logo 4 times quickly.
  // Unlocks full access and routes straight into the app so store reviewers
  // can evaluate the complete experience without a subscription.
  const logoTapCount = useRef(0);
  const logoTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleLogoTap() {
    logoTapCount.current += 1;
    if (logoTapTimer.current) clearTimeout(logoTapTimer.current);
    if (logoTapCount.current >= 4) {
      logoTapCount.current = 0;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Reviewer Mode",
        "Enable Reviewer Mode? Full app access will be unlocked so you can review the complete experience without a subscription.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Enable",
            onPress: async () => {
              await setReviewerMode(true);
              await handleEnterApp();
            },
          },
        ]
      );
    } else {
      logoTapTimer.current = setTimeout(() => { logoTapCount.current = 0; }, 1500);
    }
  }

  async function handleEnterApp() {
    await requestLocationPermission();
    router.replace("/(tabs)");
  }

  // Called by the X button and "Not now" link.
  // All app features require a subscription, so dismissing doesn't grant access —
  // but store policy requires a clearly visible way to dismiss the offer.
  // We show an explanatory alert rather than routing anywhere (routing to tabs
  // would just loop straight back here via _layout.tsx's subscription gate).
  function handleDismiss() {
    const buttons: any[] = [
      {
        text: trialEligible ? "Start Free Trial" : "Subscribe Now",
        style: "default",
        // No onPress — just dismisses the alert, leaving the user on the paywall
      },
    ];
    // Android allows programmatic app exit; iOS does not.
    if (Platform.OS === "android") {
      buttons.push({
        text: "Exit App",
        style: "destructive",
        onPress: () => BackHandler.exitApp(),
      });
    }
    Alert.alert(
      "Subscription Required",
      "All Msafiri features require an active subscription.\n\n" +
        (trialEligible
          ? "Start your 3-day free trial — it's free to begin and you can cancel anytime before it ends."
          : "Subscribe to get full access. You can cancel anytime from your App Store or Google Play settings."),
      buttons,
      { cancelable: true }
    );
  }

  // ── Success screen ──────────────────────────────────────────────────────────
  if (result === "success") {
    return (
      <View style={[styles.root, styles.centred, { backgroundColor: c.background, paddingTop: topPad, paddingBottom: botPad }]}>
        <View style={[styles.resultBadge, { backgroundColor: "#E8F5E9" }]}>
          <Ionicons name="checkmark-circle" size={56} color="#2E7D32" />
        </View>
        <Text style={[styles.resultTitle, { color: c.foreground }]}>You're all set!</Text>
        <Text style={[styles.resultSub, { color: c.mutedForeground }]}>
          Your <Text style={{ fontFamily: "Inter_600SemiBold", color: c.foreground }}>{activePlanLabel}</Text> subscription
          is now active.
        </Text>

        <View style={[styles.planSummaryCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.planSummaryRow}>
            <Ionicons name="calendar-outline" size={18} color={c.mutedForeground} />
            <Text style={[styles.planSummaryLabel, { color: c.mutedForeground }]}>Plan</Text>
            <Text style={[styles.planSummaryValue, { color: c.foreground }]}>{activePlanLabel}</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: c.border }]} />
          <View style={styles.planSummaryRow}>
            <Ionicons name="card-outline" size={18} color={c.mutedForeground} />
            <Text style={[styles.planSummaryLabel, { color: c.mutedForeground }]}>Price</Text>
            <Text style={[styles.planSummaryValue, { color: c.foreground }]}>
              {activePlanPrice}/{activePlanLabel === "Weekly" ? "week" : "month"}
            </Text>
          </View>
          <View style={[styles.divider, { backgroundColor: c.border }]} />
          <View style={styles.planSummaryRow}>
            <Ionicons name="refresh-circle-outline" size={18} color={c.mutedForeground} />
            <Text style={[styles.planSummaryLabel, { color: c.mutedForeground }]}>Renewal</Text>
            <Text style={[styles.planSummaryValue, { color: c.foreground }]}>Auto — cancel anytime</Text>
          </View>
        </View>

        <Text style={[styles.resultNote, { color: c.mutedForeground }]}>
          Manage or cancel your subscription at any time via your App Store or Google Play account settings.
        </Text>

        <View style={[styles.ctaWrap, { borderTopColor: "transparent", paddingBottom: 0, paddingHorizontal: 0, alignSelf: "stretch" }]}>
          <TouchableOpacity
            style={[styles.ctaBtn, { backgroundColor: c.primary }]}
            onPress={handleEnterApp}
            activeOpacity={0.85}
          >
            <Text style={styles.ctaBtnTxt}>Start Driving</Text>
            <Ionicons name="arrow-forward" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Restored screen ─────────────────────────────────────────────────────────
  if (result === "restored") {
    return (
      <View style={[styles.root, styles.centred, { backgroundColor: c.background, paddingTop: topPad, paddingBottom: botPad }]}>
        <View style={[styles.resultBadge, { backgroundColor: "#E3F2FD" }]}>
          <Ionicons name="cloud-done" size={56} color="#1565C0" />
        </View>
        <Text style={[styles.resultTitle, { color: c.foreground }]}>Subscription Restored!</Text>
        <Text style={[styles.resultSub, { color: c.mutedForeground }]}>
          Your previous subscription has been successfully restored. You have full access to Msafiri.
        </Text>

        <View style={[styles.infoCard, { backgroundColor: c.card, borderColor: "#1565C020" }]}>
          <Ionicons name="information-circle-outline" size={20} color="#1565C0" />
          <Text style={[styles.infoText, { color: c.mutedForeground }]}>
            Your subscription continues to be managed through your App Store or Google Play account. No additional charge was made.
          </Text>
        </View>

        <View style={[styles.ctaWrap, { borderTopColor: "transparent", paddingBottom: 0, paddingHorizontal: 0, alignSelf: "stretch" }]}>
          <TouchableOpacity
            style={[styles.ctaBtn, { backgroundColor: c.primary }]}
            onPress={handleEnterApp}
            activeOpacity={0.85}
          >
            <Text style={styles.ctaBtnTxt}>Start Driving</Text>
            <Ionicons name="arrow-forward" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Error screen ────────────────────────────────────────────────────────────
  if (result === "error") {
    return (
      <View style={[styles.root, styles.centred, { backgroundColor: c.background, paddingTop: topPad, paddingBottom: botPad }]}>
        <View style={[styles.resultBadge, { backgroundColor: "#FFEBEE" }]}>
          <Ionicons name="close-circle" size={56} color="#C62828" />
        </View>
        <Text style={[styles.resultTitle, { color: c.foreground }]}>Payment Unsuccessful</Text>
        <Text style={[styles.resultSub, { color: c.mutedForeground }]}>
          {errorMessage || "Something went wrong. Please check your payment details and try again."}
        </Text>

        <View style={[styles.infoCard, { backgroundColor: c.card, borderColor: "#C6282820" }]}>
          <Ionicons name="help-circle-outline" size={20} color="#C62828" />
          <Text style={[styles.infoText, { color: c.mutedForeground }]}>
            If you were charged but can't access Msafiri, use "Restore Purchases" below or contact{" "}
            <Text style={{ fontFamily: "Inter_600SemiBold", color: c.foreground }}>support@msafirikenya.com</Text>
          </Text>
        </View>

        <View style={[styles.ctaWrap, { borderTopColor: "transparent", paddingBottom: 0, gap: 10 }]}>
          <TouchableOpacity
            style={[styles.ctaBtn, { backgroundColor: c.primary }]}
            onPress={() => { setResult(null); setErrorMessage(""); }}
            activeOpacity={0.85}
          >
            <Text style={styles.ctaBtnTxt}>Try Again</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={async () => { setResult(null); setErrorMessage(""); await handleRestore(); }}
            disabled={isRestoring}
            style={styles.restoreBtn}
          >
            <Text style={[styles.restoreTxt, { color: c.mutedForeground }]}>
              {isRestoring ? "Restoring…" : "Restore purchases"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Main paywall ─────────────────────────────────────────────────────────────
  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: topPad }]}>
      {/* Logo header with dismiss button */}
      <View style={styles.logoRow}>
        {/* Spacer so logo stays centred */}
        <View style={styles.logoSide} />
        {/* "Msafiri" text — hidden 4-tap gesture unlocks Reviewer Mode for store reviewers */}
        <TouchableOpacity
          style={styles.logoCenter}
          onPress={handleLogoTap}
          activeOpacity={1}
          accessibilityLabel="Msafiri"
        >
          <Ionicons name="navigate" size={22} color={c.primary} />
          <Text style={[styles.logoText, { color: c.foreground }]}>Msafiri</Text>
        </TouchableOpacity>
        {/* Clearly visible dismiss button — required by store subscription policies */}
        <TouchableOpacity
          style={[styles.dismissBtn, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={handleDismiss}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Close"
          accessibilityRole="button"
        >
          <Ionicons name="close" size={18} color={c.mutedForeground} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 8 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.heroWrap}>
          <View style={[styles.heroBadge, { backgroundColor: c.primary + "18" }]}>
            <Ionicons name="shield-checkmark" size={28} color={c.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.heroTitle, { color: c.foreground }]}>
              Drive smarter. Stay protected.
            </Text>
            <Text style={[styles.heroSub, { color: c.mutedForeground }]}>
              Real-time alerts for Kenyan roads
            </Text>
          </View>
        </View>

        {/* Free trial badge */}
        <View style={[styles.trialBadge, { backgroundColor: c.primary + "15", borderColor: c.primary + "55" }]}>
          <Ionicons name={trialEligible ? "gift-outline" : "shield-checkmark-outline"} size={15} color={c.primary} />
          <Text style={[styles.trialText, { color: c.primary }]}>
            {trialEligible ? "3-day free trial — cancel anytime" : "Cancel anytime — no long-term commitment"}
          </Text>
        </View>

        {/* Feature grid — 2 columns */}
        <View style={[styles.featuresGrid, { borderColor: c.border }]}>
          {FEATURES.map((f) => (
            <View key={f.label} style={[styles.featureChip, { backgroundColor: c.card }]}>
              <Ionicons name={f.icon as any} size={13} color={c.primary} />
              <Text style={[styles.featureChipText, { color: c.foreground }]}>{f.label}</Text>
            </View>
          ))}
        </View>

        {/* Plan picker */}
        {isLoading ? (
          <ActivityIndicator color={c.primary} style={{ marginVertical: 28 }} />
        ) : offeringsError || (!monthlyPkg && !weeklyPkg) ? (
          <View style={[styles.offeringsError, { borderColor: c.border, backgroundColor: c.card }]}>
            <Ionicons name="cloud-offline-outline" size={28} color={c.mutedForeground} />
            <Text style={[styles.offeringsErrorTitle, { color: c.foreground }]}>
              Couldn't load plans
            </Text>
            <Text style={[styles.offeringsErrorSub, { color: c.mutedForeground }]}>
              Check your connection and try again.
            </Text>
            <TouchableOpacity
              style={[styles.retryBtn, { borderColor: c.primary }]}
              onPress={() => refetchOfferings()}
              activeOpacity={0.75}
            >
              <Ionicons name="refresh" size={15} color={c.primary} />
              <Text style={[styles.retryTxt, { color: c.primary }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.plans}>
            <TouchableOpacity
              style={[
                styles.planCard,
                {
                  borderColor: selectedPkg === "$rc_monthly" ? c.primary : c.border,
                  backgroundColor: selectedPkg === "$rc_monthly" ? c.primary + "12" : c.card,
                },
              ]}
              onPress={() => setSelectedPkg("$rc_monthly")}
              activeOpacity={0.8}
            >
              <View style={[styles.bestBadge, { backgroundColor: c.primary }]}>
                <Text style={styles.bestText}>BEST VALUE</Text>
              </View>
              <View style={styles.planTop}>
                <View style={[styles.radio, { borderColor: selectedPkg === "$rc_monthly" ? c.primary : c.border }]}>
                  {selectedPkg === "$rc_monthly" && (
                    <View style={[styles.radioDot, { backgroundColor: c.primary }]} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.planName, { color: c.foreground }]}>Monthly</Text>
                  <Text style={[styles.planNote, { color: c.primary }]}>Save 25% vs weekly</Text>
                </View>
                <View style={styles.priceWrap}>
                  <Text style={[styles.price, { color: c.foreground }]}>{monthlyPriceString}</Text>
                  <Text style={[styles.period, { color: c.mutedForeground }]}>/month</Text>
                </View>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.planCard,
                {
                  borderColor: selectedPkg === "$rc_weekly" ? c.primary : c.border,
                  backgroundColor: selectedPkg === "$rc_weekly" ? c.primary + "12" : c.card,
                },
              ]}
              onPress={() => setSelectedPkg("$rc_weekly")}
              activeOpacity={0.8}
            >
              <View style={styles.planTop}>
                <View style={[styles.radio, { borderColor: selectedPkg === "$rc_weekly" ? c.primary : c.border }]}>
                  {selectedPkg === "$rc_weekly" && (
                    <View style={[styles.radioDot, { backgroundColor: c.primary }]} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.planName, { color: c.foreground }]}>Weekly</Text>
                  <Text style={[styles.planNote, { color: c.mutedForeground }]}>Flexible, cancel anytime</Text>
                </View>
                <View style={styles.priceWrap}>
                  <Text style={[styles.price, { color: c.foreground }]}>{weeklyPriceString}</Text>
                  <Text style={[styles.period, { color: c.mutedForeground }]}>/week</Text>
                </View>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Legal — only show the specific price once the store has returned it,
            so the displayed amount is always authoritative and matches the charge. */}
        <Text style={[styles.legal, { color: c.mutedForeground }]}>
          {chosenPriceString
            ? trialEligible
              ? `Msafiri Premium starts with a 3-day free trial. Unless cancelled at least 24 hours before the trial ends, you'll be charged ${chosenPriceString} per ${selectedPkg === "$rc_weekly" ? "week" : "month"} and your subscription will auto-renew. `
              : `You'll be charged ${chosenPriceString} per ${selectedPkg === "$rc_weekly" ? "week" : "month"} and your subscription will auto-renew. `
            : trialEligible
              ? "Msafiri Premium starts with a 3-day free trial that auto-renews unless cancelled. "
              : "Subscription auto-renews unless cancelled at least 24 hours before the end of the current period. "}
          By subscribing you agree to our{" "}
          <Text style={[styles.agreeLink, { color: c.primary }]} onPress={() => router.push("/terms")}>Terms of Service</Text>
          {" "}and{" "}
          <Text style={[styles.agreeLink, { color: c.primary }]} onPress={() => router.push("/privacy")}>Privacy Policy</Text>
          . Manage or cancel anytime in your App Store or Google Play settings.
        </Text>
      </ScrollView>

      {/* Bottom CTA */}
      <View style={[styles.ctaWrap, { borderTopColor: c.border, paddingBottom: botPad }]}>
        {!isLoading && !offeringsError && !chosenPkg && (
          <Text style={[styles.noProductsNote, { color: c.mutedForeground }]}>
            Subscriptions unavailable in this build — store products not configured yet.
          </Text>
        )}

        <TouchableOpacity
          style={[
            styles.ctaBtn,
            { backgroundColor: c.primary, opacity: isPurchasing || isLoading || !chosenPkg ? 0.5 : 1 },
          ]}
          onPress={handleSubscribe}
          disabled={isPurchasing || isLoading || !chosenPkg}
          activeOpacity={0.85}
        >
          {isPurchasing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaBtnTxt}>{trialEligible ? "Start 3-Day Free Trial" : "Subscribe Now"}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleRestore}
          disabled={isRestoring}
          style={styles.restoreBtn}
        >
          <Text style={[styles.restoreTxt, { color: c.mutedForeground }]}>
            {isRestoring ? "Restoring…" : "Restore purchases"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.creatorBtn, { borderColor: c.border, backgroundColor: c.card }]}
          onPress={() => router.push("/creator-program" as any)}
          activeOpacity={0.8}
        >
          <Ionicons name="star-outline" size={15} color={c.primary} />
          <Text style={[styles.creatorTxt, { color: c.foreground }]}>
            Join as Msafiri Creator —{" "}
            <Text style={{ color: c.primary, fontFamily: "Inter_600SemiBold" }}>get 1 month free</Text>
          </Text>
          <Ionicons name="chevron-forward" size={14} color={c.mutedForeground} />
        </TouchableOpacity>

        {/* Secondary dismiss option — required by store subscription policies */}
        <TouchableOpacity
          onPress={handleDismiss}
          style={styles.maybeLaterBtn}
          accessibilityLabel="Not now"
          accessibilityRole="button"
        >
          <Text style={[styles.maybeLaterTxt, { color: c.mutedForeground }]}>
            Not now
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centred: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },

  logoRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10, paddingHorizontal: 16,
  },
  logoSide: { width: 36 },
  logoCenter: { flexDirection: "row", alignItems: "center", gap: 8 },
  logoText: { fontSize: 18, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  dismissBtn: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },

  scroll: { paddingHorizontal: 20, paddingTop: 4 },

  heroWrap: {
    flexDirection: "row", alignItems: "center",
    gap: 14, marginBottom: 12,
  },
  heroBadge: {
    width: 52, height: 52, borderRadius: 16,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  heroTitle: {
    fontSize: 18, fontFamily: "Inter_700Bold", lineHeight: 24, marginBottom: 3,
  },
  heroSub: {
    fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18,
  },

  trialBadge: {
    flexDirection: "row", alignItems: "center", gap: 7,
    borderRadius: 10, borderWidth: 1,
    paddingVertical: 8, paddingHorizontal: 12, marginBottom: 12,
  },
  trialText: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1 },

  featuresGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14,
  },
  featureChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    width: "47.5%", borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 10,
  },
  featureChipText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1, lineHeight: 16 },

  plans: { gap: 12, marginBottom: 16 },
  planCard: { borderRadius: 16, borderWidth: 2, padding: 16, overflow: "hidden" },
  bestBadge: {
    position: "absolute", top: 0, right: 0,
    paddingHorizontal: 10, paddingVertical: 4, borderBottomLeftRadius: 12,
  },
  bestText: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },
  planTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  planName: { fontSize: 16, fontFamily: "Inter_700Bold" },
  planNote: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  priceWrap: { alignItems: "flex-end" },
  price: { fontSize: 20, fontFamily: "Inter_700Bold" },
  period: { fontSize: 12, fontFamily: "Inter_400Regular" },

  legal: {
    fontSize: 11, fontFamily: "Inter_400Regular",
    textAlign: "center", lineHeight: 16, marginTop: 4,
  },
  agreeLink: { fontFamily: "Inter_600SemiBold" },
  noProductsNote: {
    fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center",
    lineHeight: 15, marginBottom: 8,
  },
  offeringsError: {
    alignItems: "center", gap: 8,
    borderRadius: 16, borderWidth: 1,
    paddingVertical: 24, paddingHorizontal: 20, marginBottom: 16,
  },
  offeringsErrorTitle: {
    fontSize: 15, fontFamily: "Inter_600SemiBold", textAlign: "center",
  },
  offeringsErrorSub: {
    fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18,
  },
  retryBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1.5, borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 18, marginTop: 4,
  },
  retryTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  ctaWrap: {
    paddingHorizontal: 24, paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  ctaBtn: {
    borderRadius: 18, paddingVertical: 17,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  ctaBtnTxt: { color: "#fff", fontSize: 17, fontFamily: "Inter_700Bold" },
  restoreBtn: { alignItems: "center", paddingBottom: 4 },
  restoreTxt: { fontSize: 13, fontFamily: "Inter_400Regular" },
  creatorBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14,
    justifyContent: "center",
  },
  creatorTxt: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  maybeLaterBtn: { alignItems: "center", paddingVertical: 4 },
  maybeLaterTxt: {
    fontSize: 12, fontFamily: "Inter_400Regular",
    textAlign: "center", lineHeight: 17,
    textDecorationLine: "underline",
  },

  // Result screens
  resultBadge: {
    width: 100, height: 100, borderRadius: 32,
    alignItems: "center", justifyContent: "center", marginBottom: 24,
  },
  resultTitle: {
    fontSize: 26, fontFamily: "Inter_700Bold",
    textAlign: "center", marginBottom: 12,
  },
  resultSub: {
    fontSize: 15, fontFamily: "Inter_400Regular",
    textAlign: "center", lineHeight: 22, marginBottom: 28,
  },
  planSummaryCard: {
    width: "100%", borderRadius: 16, borderWidth: 1,
    paddingHorizontal: 20, paddingVertical: 4, marginBottom: 20,
  },
  planSummaryRow: {
    flexDirection: "row", alignItems: "center",
    gap: 10, paddingVertical: 14,
  },
  planSummaryLabel: { fontSize: 14, fontFamily: "Inter_400Regular", flex: 1 },
  planSummaryValue: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  divider: { height: StyleSheet.hairlineWidth },
  infoCard: {
    width: "100%", flexDirection: "row", alignItems: "flex-start",
    gap: 12, borderRadius: 14, borderWidth: 1,
    padding: 16, marginBottom: 28,
  },
  infoText: {
    fontSize: 13, fontFamily: "Inter_400Regular",
    lineHeight: 20, flex: 1,
  },
  resultNote: {
    fontSize: 12, fontFamily: "Inter_400Regular",
    textAlign: "center", lineHeight: 18,
    marginBottom: 32, paddingHorizontal: 8,
  },
});
