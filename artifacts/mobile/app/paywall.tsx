import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSubscription } from "@/lib/revenuecat";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";

type Result = "success" | "restored" | "error" | null;

const FEATURES = [
  { icon: "speedometer",      label: "Real-time GPS speed display" },
  { icon: "shield-checkmark", label: "Speed camera & police alerts" },
  { icon: "people",           label: "Community road reports" },
  { icon: "mic",              label: "Voice announcements & haptic alerts" },
  { icon: "alert-circle",     label: "SOS emergency button" },
  { icon: "navigate",         label: "Turn-by-turn navigation" },
  { icon: "time",             label: "Trip history & stats" },
  { icon: "cloud-offline",    label: "Offline speed zone data" },
];

export default function PaywallScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { requestLocationPermission } = useApp();
  const { offerings, isLoading, purchase, isPurchasing, restore, isRestoring } =
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

  async function handleEnterApp() {
    await requestLocationPermission();
    router.replace("/(tabs)");
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
      {/* Logo header */}
      <View style={styles.logoRow}>
        <Ionicons name="navigate" size={22} color={c.primary} />
        <Text style={[styles.logoText, { color: c.foreground }]}>Msafiri</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 8 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.heroWrap}>
          <View style={[styles.heroBadge, { backgroundColor: c.primary + "18" }]}>
            <Ionicons name="shield-checkmark" size={44} color={c.primary} />
          </View>
          <Text style={[styles.heroTitle, { color: c.foreground }]}>
            Drive smarter.{"\n"}Stay protected.
          </Text>
          <Text style={[styles.heroSub, { color: c.mutedForeground }]}>
            Join Kenyan drivers who arrive safely every day with real-time road alerts.
          </Text>
        </View>

        {/* Free trial badge */}
        <View style={[styles.trialBadge, { backgroundColor: c.primary + "15", borderColor: c.primary + "55" }]}>
          <Ionicons name="gift-outline" size={16} color={c.primary} />
          <Text style={[styles.trialText, { color: c.primary }]}>
            Start with a 1-day free trial — cancel anytime
          </Text>
        </View>

        {/* Feature list */}
        <View style={[styles.featuresCard, { backgroundColor: c.card, borderColor: c.border }]}>
          {FEATURES.map((f) => (
            <View key={f.label} style={styles.featureRow}>
              <View style={[styles.featureIcon, { backgroundColor: c.primary + "18" }]}>
                <Ionicons name={f.icon as any} size={16} color={c.primary} />
              </View>
              <Text style={[styles.featureLabel, { color: c.foreground }]}>{f.label}</Text>
              <Ionicons name="checkmark-circle" size={18} color={c.primary} />
            </View>
          ))}
        </View>

        {/* Plan picker */}
        {isLoading ? (
          <ActivityIndicator color={c.primary} style={{ marginVertical: 28 }} />
        ) : (
          <View style={styles.plans}>
            {monthlyPkg && (
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
                    <Text style={[styles.planNote, { color: c.primary }]}>Save 17% vs weekly</Text>
                  </View>
                  <View style={styles.priceWrap}>
                    <Text style={[styles.price, { color: c.foreground }]}>{monthlyPkg.product.priceString}</Text>
                    <Text style={[styles.period, { color: c.mutedForeground }]}>/month</Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}

            {weeklyPkg && (
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
                    <Text style={[styles.price, { color: c.foreground }]}>{weeklyPkg.product.priceString}</Text>
                    <Text style={[styles.period, { color: c.mutedForeground }]}>/week</Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Legal */}
        <Text style={[styles.legal, { color: c.mutedForeground }]}>
          {chosenPkg
            ? `Msafiri Premium starts with a 1-day free trial. Unless cancelled at least 24 hours before the trial ends, you'll be charged ${chosenPkg.product.priceString} per ${selectedPkg === "$rc_weekly" ? "week" : "month"} and your subscription will auto-renew at that price until cancelled. `
            : "Subscription auto-renews unless cancelled at least 24 hours before the end of the current period. "}
          Manage or cancel anytime in your App Store or Google Play account settings.
        </Text>
        <View style={styles.legalLinks}>
          <TouchableOpacity onPress={() => router.push("/terms")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.legalLink, { color: c.primary }]}>Terms of Service</Text>
          </TouchableOpacity>
          <Text style={[styles.legalLinkSep, { color: c.mutedForeground }]}>·</Text>
          <TouchableOpacity onPress={() => router.push("/privacy")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.legalLink, { color: c.primary }]}>Privacy Policy</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Bottom CTA */}
      <View style={[styles.ctaWrap, { borderTopColor: c.border, paddingBottom: botPad }]}>
        <TouchableOpacity
          style={[
            styles.ctaBtn,
            { backgroundColor: c.primary, opacity: isPurchasing || isLoading ? 0.6 : 1 },
          ]}
          onPress={handleSubscribe}
          disabled={isPurchasing || isLoading || !chosenPkg}
          activeOpacity={0.85}
        >
          {isPurchasing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaBtnTxt}>Start 1-Day Free Trial</Text>
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
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14,
  },
  logoText: { fontSize: 20, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },

  scroll: { paddingHorizontal: 24, paddingTop: 8 },

  heroWrap: { alignItems: "center", marginBottom: 20 },
  heroBadge: {
    width: 88, height: 88, borderRadius: 28,
    alignItems: "center", justifyContent: "center", marginBottom: 18,
  },
  heroTitle: {
    fontSize: 28, fontFamily: "Inter_700Bold",
    textAlign: "center", lineHeight: 36, marginBottom: 10,
  },
  heroSub: {
    fontSize: 15, fontFamily: "Inter_400Regular",
    textAlign: "center", lineHeight: 22,
  },

  trialBadge: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 12, borderWidth: 1,
    paddingVertical: 10, paddingHorizontal: 16, marginBottom: 20,
  },
  trialText: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1 },

  featuresCard: {
    borderRadius: 16, borderWidth: 1, padding: 16, gap: 14, marginBottom: 20,
  },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  featureIcon: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  featureLabel: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1 },

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
  legalLinks: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, marginTop: 10,
  },
  legalLink: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  legalLinkSep: { fontSize: 12 },

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
