import React, { useEffect, useRef, useState } from "react";
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
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSubscription, REVENUECAT_ENTITLEMENT_IDENTIFIER } from "@/lib/revenuecat";
import { loadVehicles } from "@/utils/savedVehicles";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { AdminPinModal } from "@/components/AdminPinModal";
import { FREE_TRIAL_SESSIONS } from "@/hooks/useTrialSessions";

type Result = "success" | "restored" | "error" | null;

// ── Intro-price helpers ────────────────────────────────────────────────────────
// Mirrors the same helpers in components/PaywallModal.tsx so both paywalls stay
// in sync. If you update one, update the other.

interface IntroPrice {
  price: number;
  priceString: string;
  cycles: number;
  period: string;
  periodUnit: string;       // "DAY" | "WEEK" | "MONTH" | "YEAR"
  periodNumberOfUnits: number;
}

/** "first month", "first 3 months", "first week" — derived from store data, never hard-coded. */
function formatIntroPeriod(intro: IntroPrice): string {
  const totalUnits = intro.cycles * intro.periodNumberOfUnits;
  const unit = intro.periodUnit.toLowerCase();
  return totalUnits === 1 ? `first ${unit}` : `first ${totalUnits} ${unit}s`;
}

function formatIntroDuration(intro: IntroPrice): string {
  const totalUnits = intro.cycles * intro.periodNumberOfUnits;
  const unit = intro.periodUnit.toLowerCase();
  return totalUnits === 1 ? `1 ${unit}` : `${totalUnits} ${unit}s`;
}

/** Full charge description, e.g. "KSh 99 for the first month, then KSh 299/month". */
function formatIntroWithRenewal(intro: IntroPrice, regularPriceString: string, regularPeriodLabel: string): string {
  return `${intro.priceString} for the ${formatIntroPeriod(intro)}, then ${regularPriceString}/${regularPeriodLabel}`;
}

const FEATURES: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
  badge?: string;
}[] = [
  {
    icon: "speedometer-outline",
    title: "Speed Camera & Road Alerts",
    desc: "Real-time alerts for fixed cameras, mobile patrols, and Alcoblow checkpoints.",
  },
  {
    icon: "videocam-outline",
    title: "Dashcam",
    desc: "Record, lock, and manage your drive footage — always ready when you need it.",
  },
  {
    icon: "location-outline",
    title: "Trip Live Location Sharing",
    desc: "Let family and friends follow your journey safely in real time.",
  },
  {
    icon: "car-sport-outline",
    title: "Automatic Crash Detection",
    desc: "Detects impacts and automatically notifies your emergency contacts.",
  },
  {
    icon: "construct-outline",
    title: "Vehicle Care & Reminders",
    desc: "Service schedules and care tips for your vehicles.",
    badge: "Up to 4 vehicles",
  },
  {
    icon: "headset-outline",
    title: "Free Audio Driving Course",
    desc: "Learn safer driving habits with guided audio lessons.",
  },
  {
    icon: "call-outline",
    title: "Emergency Contacts",
    desc: "One tap to alert your contacts — or we do it automatically in a crash.",
  },
  {
    icon: "ellipsis-horizontal-circle-outline",
    title: "And more",
    desc: "New features and exclusive benefits added regularly.",
  },
];

const TRUST = [
  { icon: "shield-checkmark-outline" as const, label: "3 free\ndrives" },
  { icon: "refresh-circle-outline" as const,   label: "Cancel\nanytime" },
  { icon: "lock-closed-outline" as const,       label: "Secure & private\npayments" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Decorative shield — pure View composition, no external dependency
// ─────────────────────────────────────────────────────────────────────────────
function ShieldDecor({ primary }: { primary: string }) {
  return (
    <View style={sd.wrap} pointerEvents="none">
      <View style={[sd.glow, { backgroundColor: primary + "18" }]} />
      <View style={[sd.ring, { borderColor: primary + "30" }]} />
      <View style={[sd.body, { backgroundColor: primary + "22", borderColor: primary + "44" }]}>
        <Ionicons name="shield-checkmark" size={52} color={primary} />
      </View>
    </View>
  );
}
const sd = StyleSheet.create({
  wrap:  { width: 100, height: 100, alignItems: "center", justifyContent: "center" },
  glow:  { position: "absolute", width: 90, height: 90, borderRadius: 45 },
  ring:  { position: "absolute", width: 80, height: 80, borderRadius: 40, borderWidth: 1 },
  body:  { width: 68, height: 68, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});

// ─────────────────────────────────────────────────────────────────────────────
// Success screen
// ─────────────────────────────────────────────────────────────────────────────
function SuccessScreen({
  planLabel,
  planPrice,
  trialDuration,
  onEnter,
  colors: c,
  topPad,
  botPad,
}: {
  planLabel: string;
  planPrice: string;
  trialDuration?: string | null;
  onEnter: () => void;
  colors: ReturnType<typeof useColors>;
  topPad: number;
  botPad: number;
}) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={[ss.root, { paddingTop: topPad, paddingBottom: botPad }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Glow badge */}
      <View style={ss.badgeWrap}>
        <View style={[ss.glowBig,  { backgroundColor: c.primary + "18" }]} />
        <View style={[ss.glowMid,  { backgroundColor: c.primary + "28" }]} />
        <View style={[ss.badgeInner, { backgroundColor: c.primary + "22", borderColor: c.primary + "55" }]}>
          <Ionicons name="checkmark-circle" size={52} color={c.primary} />
        </View>
      </View>

      <Text style={[ss.title, { color: c.foreground }]}>
        {trialDuration ? "Your Free Trial Is Active!" : "You're on Premium!"}
      </Text>
      <Text style={[ss.sub, { color: c.mutedForeground }]}>
        {trialDuration ? (
          <>
            Your{" "}
            <Text style={{ color: c.foreground, fontFamily: "Inter_600SemiBold" }}>{trialDuration}</Text>
            {" "}trial includes up to {FREE_TRIAL_SESSIONS} qualifying drives. Unlimited driving begins when the paid period starts.
          </>
        ) : (
          <>
            Your{" "}
            <Text style={{ color: c.foreground, fontFamily: "Inter_600SemiBold" }}>{planLabel}</Text>
            {" "}plan is active. Every Msafiri feature is now unlocked.
          </>
        )}
      </Text>

      {/* Plan summary card */}
      <View style={[ss.card, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
        <View style={ss.cardRow}>
          <View style={[ss.iconWrap, { backgroundColor: c.primary + "18" }]}>
            <Ionicons name="calendar-outline" size={18} color={c.primary} />
          </View>
          <Text style={[ss.cardLabel, { color: c.mutedForeground }]}>Plan</Text>
          <Text style={[ss.cardValue, { color: c.foreground }]}>
            {trialDuration ? `${trialDuration} free trial` : planLabel}
          </Text>
        </View>
        <View style={[ss.div, { backgroundColor: c.border }]} />
        <View style={ss.cardRow}>
          <View style={[ss.iconWrap, { backgroundColor: c.primary + "18" }]}>
            <Ionicons name="card-outline" size={18} color={c.primary} />
          </View>
          <Text style={[ss.cardLabel, { color: c.mutedForeground }]}>Price</Text>
          <Text style={[ss.cardValue, { color: c.foreground }]}>
            {trialDuration ? "Free today" : `${planPrice}/${planLabel === "Weekly" ? "week" : "month"}`}
          </Text>
        </View>
        <View style={[ss.div, { backgroundColor: c.border }]} />
        <View style={ss.cardRow}>
          <View style={[ss.iconWrap, { backgroundColor: c.primary + "18" }]}>
            <Ionicons name="refresh-circle-outline" size={18} color={c.primary} />
          </View>
          <Text style={[ss.cardLabel, { color: c.mutedForeground }]}>Renewal</Text>
          <Text style={[ss.cardValue, { color: c.foreground }]}>Auto — cancel anytime</Text>
        </View>
      </View>

      <Text style={[ss.note, { color: c.mutedForeground }]}>
        Manage or cancel anytime in your App Store or Google Play account settings.
      </Text>

      {/* Start Driving CTA */}
      <TouchableOpacity
        style={[ss.cta, { backgroundColor: c.primary }]}
        onPress={onEnter}
        activeOpacity={0.85}
      >
        <Text style={ss.ctaTxt}>Start Driving</Text>
        <Ionicons name="arrow-forward" size={20} color="#fff" />
      </TouchableOpacity>
    </ScrollView>
  );
}
const ss = StyleSheet.create({
  root:       { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, gap: 20 },
  badgeWrap:  { width: 120, height: 120, alignItems: "center", justifyContent: "center" },
  glowBig:    { position: "absolute", width: 120, height: 120, borderRadius: 60 },
  glowMid:    { position: "absolute", width: 90, height: 90, borderRadius: 45 },
  badgeInner: { width: 72, height: 72, borderRadius: 24, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  title:      { fontSize: 26, fontFamily: "Inter_700Bold", textAlign: "center" },
  sub:        { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  card:       { alignSelf: "stretch", borderRadius: 20, borderWidth: 1, padding: 6 },
  cardRow:    { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  iconWrap:   { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardLabel:  { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  cardValue:  { fontSize: 13, fontFamily: "Inter_600SemiBold", textAlign: "right", maxWidth: "50%" },
  div:        { height: StyleSheet.hairlineWidth, marginHorizontal: 12 },
  note:         { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
  cta:          { alignSelf: "stretch", borderRadius: 18, paddingVertical: 17, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  ctaTxt:       { color: "#fff", fontSize: 17, fontFamily: "Inter_700Bold" },
  phoneCard:       { alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 12,
                     borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  phonePrompt:     { alignSelf: "stretch", borderRadius: 20, borderWidth: 1.5,
                     padding: 20, gap: 10, alignItems: "center" },
  phonePromptIcon: { width: 52, height: 52, borderRadius: 16,
                     alignItems: "center", justifyContent: "center", marginBottom: 2 },
  phonePromptTitle:{ fontSize: 16, fontFamily: "Inter_700Bold", textAlign: "center" },
  phonePromptBody: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center",
                     lineHeight: 19, marginBottom: 4 },
  phonePromptBtn:  { alignSelf: "stretch", flexDirection: "row", alignItems: "center",
                     justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 14 },
  phonePromptBtnTxt:{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
});

// ─────────────────────────────────────────────────────────────────────────────
// Restored screen
// ─────────────────────────────────────────────────────────────────────────────
function RestoredScreen({
  onEnter,
  colors: c,
  topPad,
  botPad,
}: {
  onEnter: () => void;
  colors: ReturnType<typeof useColors>;
  topPad: number;
  botPad: number;
}) {
  return (
    <View style={[ss.root, { backgroundColor: c.background, paddingTop: topPad, paddingBottom: botPad }]}>
      <View style={ss.badgeWrap}>
        <View style={[ss.glowBig,  { backgroundColor: "#1565C018" }]} />
        <View style={[ss.glowMid,  { backgroundColor: "#1565C028" }]} />
        <View style={[ss.badgeInner, { backgroundColor: "#1565C022", borderColor: "#1565C055" }]}>
          <Ionicons name="cloud-done" size={52} color="#1565C0" />
        </View>
      </View>
      <Text style={[ss.title, { color: c.foreground }]}>Subscription Restored</Text>
      <Text style={[ss.sub, { color: c.mutedForeground }]}>
        Your previous subscription is active again. No additional charge was made — you have full access to Msafiri.
      </Text>
      <View style={[ss.card, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
        <View style={[ss.cardRow, { gap: 10 }]}>
          <Ionicons name="information-circle-outline" size={20} color="#1565C0" />
          <Text style={[ss.note, { color: c.mutedForeground, textAlign: "left", flex: 1 }]}>
            Your subscription is managed through your App Store or Google Play account.
          </Text>
        </View>
      </View>
      <TouchableOpacity style={[ss.cta, { backgroundColor: c.primary }]} onPress={onEnter} activeOpacity={0.85}>
        <Text style={ss.ctaTxt}>Start Driving</Text>
        <Ionicons name="arrow-forward" size={20} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Error screen
// ─────────────────────────────────────────────────────────────────────────────
function ErrorScreen({
  message,
  onRetry,
  onRestore,
  isRestoring,
  colors: c,
  topPad,
  botPad,
}: {
  message: string;
  onRetry: () => void;
  onRestore: () => void;
  isRestoring: boolean;
  colors: ReturnType<typeof useColors>;
  topPad: number;
  botPad: number;
}) {
  return (
    <View style={[ss.root, { backgroundColor: c.background, paddingTop: topPad, paddingBottom: botPad }]}>
      <View style={ss.badgeWrap}>
        <View style={[ss.glowBig,  { backgroundColor: "#C6282818" }]} />
        <View style={[ss.glowMid,  { backgroundColor: "#C6282828" }]} />
        <View style={[ss.badgeInner, { backgroundColor: "#C6282822", borderColor: "#C6282855" }]}>
          <Ionicons name="close-circle" size={52} color="#C62828" />
        </View>
      </View>
      <Text style={[ss.title, { color: c.foreground }]}>Payment Unsuccessful</Text>
      <Text style={[ss.sub, { color: c.mutedForeground }]}>
        {message || "Something went wrong. Please check your payment details and try again."}
      </Text>
      <View style={[ss.card, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
        <View style={[ss.cardRow, { gap: 10 }]}>
          <Ionicons name="help-circle-outline" size={20} color="#C62828" />
          <Text style={[ss.note, { color: c.mutedForeground, textAlign: "left", flex: 1 }]}>
            Charged but can't access Msafiri? Use "Restore Purchases" below or email{" "}
            <Text style={{ color: c.foreground, fontFamily: "Inter_600SemiBold" }}>support@msafirikenya.com</Text>
          </Text>
        </View>
      </View>
      <TouchableOpacity style={[ss.cta, { backgroundColor: c.primary }]} onPress={onRetry} activeOpacity={0.85}>
        <Text style={ss.ctaTxt}>Try Again</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onRestore} disabled={isRestoring} style={{ paddingVertical: 4 }}>
        <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: c.mutedForeground }}>
          {isRestoring ? "Restoring…" : "Restore purchases"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main paywall
// ─────────────────────────────────────────────────────────────────────────────
export default function PaywallScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { requestLocationPermission, isAdmin, adminLogout } = useApp();
  const {
    offerings, offeringsLoading, offeringsError, refetchOfferings,
    purchase, isPurchasing, restore, isRestoring, isDefinitelyIntroEligible,
  } = useSubscription();

  const [selectedPkg, setSelectedPkg] = useState<string>("$rc_monthly");
  const [result, setResult] = useState<Result>(null);
  const [activePlanLabel, setActivePlanLabel] = useState("");
  const [activePlanPrice, setActivePlanPrice] = useState("");
  const [activeTrialDuration, setActiveTrialDuration] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const topPad = Platform.OS === "web" ? 20 : insets.top + 8;
  const botPad = Platform.OS === "web" ? 20 : insets.bottom + 16;

  const currentOffering = offerings?.current;
  const weeklyPkg  = currentOffering?.availablePackages.find((p) => p.identifier === "$rc_weekly");
  const monthlyPkg = currentOffering?.availablePackages.find((p) => p.identifier === "$rc_monthly");
  const chosenPkg  = selectedPkg === "$rc_weekly" ? weeklyPkg : monthlyPkg;

  const weeklyPriceString  = weeklyPkg?.product.priceString  ?? "";
  const monthlyPriceString = monthlyPkg?.product.priceString ?? "";
  const chosenPriceString  = selectedPkg === "$rc_weekly" ? weeklyPriceString : monthlyPriceString;
  const periodLabel = selectedPkg === "$rc_weekly" ? "week" : "month";
  const storeName = Platform.OS === "ios" ? "Apple App Store" : "Google Play";

  // ── Intro (discounted first-period) price ─────────────────────────────────────
  // Only advertised when eligibility is POSITIVELY confirmed (isDefinitelyIntroEligible).
  // Gracefully absent when the offer isn't configured in the store or the user
  // is ineligible / iOS query hasn't resolved yet.
  const rawMonthlyIntroPrice: IntroPrice | null =
    monthlyPkg && isDefinitelyIntroEligible(monthlyPkg.product.identifier)
      ? (monthlyPkg.product.introPrice as IntroPrice | null) ?? null
      : null;
  const monthlyIntroPrice = rawMonthlyIntroPrice;
  const chosenIntroPrice: IntroPrice | null =
    selectedPkg === "$rc_monthly" ? monthlyIntroPrice : null;
  const chosenIsFreeTrial = chosenIntroPrice?.price === 0;
  // Unified charge description reused in legal text, CTA pricing, and trust note.
  const chargeDescription = chosenPkg && chosenIntroPrice
    ? formatIntroWithRenewal(chosenIntroPrice, chosenPkg.product.priceString, periodLabel)
    : null;

  // Hidden admin tap — 3 quick taps on the "Msafiri Premium" label
  const adminTapCount = useRef(0);
  const adminTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  function handleAdminTap() {
    adminTapCount.current += 1;
    if (adminTapTimer.current) clearTimeout(adminTapTimer.current);
    if (adminTapCount.current >= 3) {
      adminTapCount.current = 0;
      if (isAdmin) {
        Alert.alert("Admin Mode", "Deactivate admin access on this device?", [
          { text: "Cancel", style: "cancel" },
          { text: "Deactivate", style: "destructive", onPress: () => { void adminLogout(); } },
        ]);
      } else {
        setShowAdminLogin(true);
      }
    } else {
      adminTapTimer.current = setTimeout(() => { adminTapCount.current = 0; }, 2000);
    }
  }

  async function handleSubscribe() {
    if (!chosenPkg) return;
    try {
      await purchase(chosenPkg);
      setActivePlanLabel(selectedPkg === "$rc_weekly" ? "Weekly" : "Monthly");
      setActivePlanPrice(chosenPkg.product.priceString);
      setActiveTrialDuration(chosenIsFreeTrial ? formatIntroDuration(chosenIntroPrice!) : null);
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
      const info = await restore();
      // Purchases.restorePurchases() always "succeeds" from the SDK's perspective —
      // it only throws on network errors. We must check whether an active entitlement
      // was actually found; if not, the restore succeeded technically but the user
      // has no subscription we can honour.
      const hasActive =
        info?.entitlements?.active?.[REVENUECAT_ENTITLEMENT_IDENTIFIER] !== undefined;
      if (hasActive) {
        setResult("restored");
      } else {
        setErrorMessage(
          "No active subscription was found for this account. If you subscribed on a different Apple or Google account, switch accounts and try again. Contact support@msafirikenya.com if the issue persists."
        );
        setResult("error");
      }
    } catch (e: any) {
      setErrorMessage(
        e?.message ??
          "Restore failed. Please check your connection and try again."
      );
      setResult("error");
    }
  }

  async function handleEnterApp() {
    await requestLocationPermission();
    // Route new users to vehicle setup before the main app — existing users
    // who already have vehicles saved go straight to the home tab.
    try {
      const vehicles = await loadVehicles();
      if (vehicles.length === 0) {
        router.replace("/vehicle-setup" as any);
        return;
      }
    } catch { /* proceed to tabs on error */ }
    router.replace("/(tabs)");
  }

  function handleDismiss() {
    // iOS users retain access to the app. The subscription screen is enforced
    // only when they attempt a fourth qualifying drive.
    if (Platform.OS === "ios") {
      router.replace("/(tabs)");
      return;
    }
    const buttons: any[] = [
      { text: "Subscribe Now", style: "default" },
    ];
    if (Platform.OS === "android") {
      buttons.push({ text: "Exit App", style: "destructive", onPress: () => BackHandler.exitApp() });
    }
    Alert.alert(
      "Subscription Required",
      `Start your free trial or subscribe to access Msafiri Premium. The free trial includes up to ${FREE_TRIAL_SESSIONS} qualifying drives and can be cancelled anytime from your ${storeName} settings.`,
      buttons,
      { cancelable: true }
    );
  }

  // ── Result screens ───────────────────────────────────────────────────────
  if (result === "success") {
    return (
      <SuccessScreen
        planLabel={activePlanLabel} planPrice={activePlanPrice}
        trialDuration={activeTrialDuration}
        onEnter={handleEnterApp} colors={c} topPad={topPad} botPad={botPad}
      />
    );
  }
  if (result === "restored") {
    return <RestoredScreen onEnter={handleEnterApp} colors={c} topPad={topPad} botPad={botPad} />;
  }
  if (result === "error") {
    return (
      <ErrorScreen
        message={errorMessage} onRetry={() => { setResult(null); setErrorMessage(""); }}
        onRestore={async () => { setResult(null); setErrorMessage(""); await handleRestore(); }}
        isRestoring={isRestoring} colors={c} topPad={topPad} botPad={botPad}
      />
    );
  }

  // ── Main paywall ─────────────────────────────────────────────────────────
  // periodLabel is derived earlier (before intro-price computation). No re-declare.

  return (
    <View style={[p.root, { backgroundColor: c.background, paddingTop: topPad }]}>

      {/* Top bar */}
      <View style={p.topBar}>
        <TouchableOpacity style={p.brandRow} onPress={handleAdminTap} activeOpacity={0.7}>
          <Ionicons name="navigate" size={14} color={c.primary} />
          <Text style={[p.brandTxt, { color: c.primary }]}>Msafiri Premium</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[p.closeBtn, { backgroundColor: c.card, borderColor: c.tileBorder }]}
          onPress={handleDismiss}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Close"
          accessibilityRole="button"
        >
          <Ionicons name="close" size={18} color={c.mutedForeground} />
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={[p.scroll, { paddingBottom: botPad + 8 }]} showsVerticalScrollIndicator={false}>

        {/* Hero */}
        <View style={p.hero}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={[p.heroTitle, { color: c.foreground }]}>
              {"Everything you need\nfor "}
              <Text style={{ color: c.primary }}>safer, smarter</Text>
              {" drives."}
            </Text>
            <Text style={[p.heroSub, { color: c.mutedForeground }]}>
              Premium tools to protect you, your car, and the people who matter.
            </Text>
            {monthlyIntroPrice?.price === 0 ? (
              <View style={[p.trialPill, { backgroundColor: c.primary + "18", borderColor: c.primary + "44" }]}>
                <Ionicons name="gift-outline" size={13} color={c.primary} />
                <Text style={[p.trialTxt, { color: c.primary }]}>
                  {formatIntroDuration(monthlyIntroPrice).toUpperCase()} FREE TRIAL · {FREE_TRIAL_SESSIONS} DRIVES MAX
                </Text>
              </View>
            ) : monthlyIntroPrice ? (
              <View style={[p.trialPill, { backgroundColor: "#16a34a18", borderColor: "#16a34a44" }]}>
                <Ionicons name="pricetag-outline" size={13} color="#16a34a" />
                <Text style={[p.trialTxt, { color: "#16a34a" }]}>
                  INTRO OFFER · {monthlyIntroPrice.priceString} {formatIntroPeriod(monthlyIntroPrice).toUpperCase()}
                </Text>
              </View>
            ) : (
              <View style={[p.trialPill, { backgroundColor: c.primary + "18", borderColor: c.primary + "44" }]}>
                <Ionicons name="shield-checkmark-outline" size={13} color={c.primary} />
                <Text style={[p.trialTxt, { color: c.primary }]}>
                  CANCEL ANYTIME
                </Text>
              </View>
            )}
          </View>
          <ShieldDecor primary={c.primary} />
        </View>

        {/* Feature cards — 2 columns */}
        <View style={p.grid}>
          {FEATURES.map((f) => (
            <View key={f.title} style={[p.featureCard, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
              <View style={[p.featureIconWrap, { backgroundColor: c.primary + "1A" }]}>
                <Ionicons name={f.icon} size={22} color={c.primary} />
              </View>
              <Text style={[p.featureTitle, { color: c.foreground }]}>{f.title}</Text>
              <Text style={[p.featureDesc, { color: c.mutedForeground }]} numberOfLines={3}>{f.desc}</Text>
              {f.badge && (
                <View style={[p.featureBadge, { backgroundColor: c.primary + "1A", borderColor: c.primary + "33" }]}>
                  <Text style={[p.featureBadgeTxt, { color: c.primary }]}>{f.badge}</Text>
                </View>
              )}
            </View>
          ))}
        </View>

        {/* Choose your plan */}
        <Text style={[p.planHeading, { color: c.foreground }]}>Choose your plan</Text>

        {offeringsLoading ? (
          <ActivityIndicator color={c.primary} style={{ marginVertical: 28 }} />
        ) : offeringsError ? (
          <View style={[p.errCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Ionicons name="cloud-offline-outline" size={28} color={c.mutedForeground} />
            <Text style={[p.errTitle, { color: c.foreground }]}>Couldn't load plans</Text>
            <Text style={[p.errSub, { color: c.mutedForeground }]}>Check your connection and try again.</Text>
            <TouchableOpacity style={[p.retryBtn, { borderColor: c.primary }]} onPress={() => refetchOfferings()} activeOpacity={0.75}>
              <Ionicons name="refresh" size={15} color={c.primary} />
              <Text style={[p.retryTxt, { color: c.primary }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : !monthlyPkg && !weeklyPkg ? (
          <View style={[p.errCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Ionicons name="time-outline" size={28} color={c.mutedForeground} />
            <Text style={[p.errTitle, { color: c.foreground }]}>Plans coming soon</Text>
            <Text style={[p.errSub, { color: c.mutedForeground }]}>
              Subscription plans are being finalised in the App Store. Please check back in a few minutes.
            </Text>
            <TouchableOpacity style={[p.retryBtn, { borderColor: c.primary }]} onPress={() => refetchOfferings()} activeOpacity={0.75}>
              <Ionicons name="refresh" size={15} color={c.primary} />
              <Text style={[p.retryTxt, { color: c.primary }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={p.plans}>
            {/* Monthly */}
            <TouchableOpacity
              style={[p.planCard, {
                borderColor: selectedPkg === "$rc_monthly" ? c.primary : c.tileBorder,
                backgroundColor: selectedPkg === "$rc_monthly" ? c.primary + "0F" : c.card,
              }]}
              onPress={() => setSelectedPkg("$rc_monthly")}
              activeOpacity={0.8}
            >
              <View style={[p.bestBadge, { backgroundColor: monthlyIntroPrice ? "#16a34a" : c.primary }]}>
                <Text style={p.bestTxt}>{monthlyIntroPrice?.price === 0 ? "FREE TRIAL" : monthlyIntroPrice ? "INTRO OFFER" : "BEST VALUE"}</Text>
              </View>
              <View style={p.planRow}>
                <View style={[p.radio, { borderColor: selectedPkg === "$rc_monthly" ? c.primary : c.mutedForeground }]}>
                  {selectedPkg === "$rc_monthly" && <View style={[p.radioDot, { backgroundColor: c.primary }]} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[p.planName, { color: c.foreground }]}>Monthly</Text>
                  {monthlyIntroPrice ? (
                    <Text style={[p.planNote, { color: "#16a34a" }]}>
                      {monthlyIntroPrice.price === 0
                        ? `${formatIntroDuration(monthlyIntroPrice)} free · maximum ${FREE_TRIAL_SESSIONS} drives`
                        : `${monthlyIntroPrice.priceString} ${formatIntroPeriod(monthlyIntroPrice)}`}
                    </Text>
                  ) : (
                    <Text style={[p.planNote, { color: c.primary }]}>
                      Save 25% vs weekly
                    </Text>
                  )}
                </View>
                {monthlyIntroPrice ? (
                  <View style={p.priceBlock}>
                    <Text style={[p.price, { color: "#16a34a" }]}>
                      {monthlyIntroPrice.price === 0 ? "Free" : monthlyIntroPrice.priceString}
                    </Text>
                    <Text style={[p.pricePeriod, { color: c.mutedForeground }]}>then {monthlyPriceString}/mo</Text>
                  </View>
                ) : (
                  <View style={p.priceBlock}>
                    <Text style={[p.price, { color: c.foreground }]}>{monthlyPriceString || "—"}</Text>
                    <Text style={[p.pricePeriod, { color: c.mutedForeground }]}>/month</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>

            {/* Weekly */}
            <TouchableOpacity
              style={[p.planCard, {
                borderColor: selectedPkg === "$rc_weekly" ? c.primary : c.tileBorder,
                backgroundColor: selectedPkg === "$rc_weekly" ? c.primary + "0F" : c.card,
              }]}
              onPress={() => setSelectedPkg("$rc_weekly")}
              activeOpacity={0.8}
            >
              <View style={p.planRow}>
                <View style={[p.radio, { borderColor: selectedPkg === "$rc_weekly" ? c.primary : c.mutedForeground }]}>
                  {selectedPkg === "$rc_weekly" && <View style={[p.radioDot, { backgroundColor: c.primary }]} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[p.planName, { color: c.foreground }]}>Weekly</Text>
                  <Text style={[p.planNote, { color: c.mutedForeground }]}>
                    Flexible · Cancel anytime
                  </Text>
                </View>
                <View style={p.priceBlock}>
                  <Text style={[p.price, { color: c.foreground }]}>{weeklyPriceString || "—"}</Text>
                  <Text style={[p.pricePeriod, { color: c.mutedForeground }]}>/week</Text>
                </View>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Trust badges */}
        <View style={[p.trustRow, { borderColor: c.tileBorder, backgroundColor: c.card }]}>
          {TRUST.map((t, i) => (
            <React.Fragment key={t.label}>
              {i > 0 && <View style={[p.trustDiv, { backgroundColor: c.border }]} />}
              <View style={p.trustItem}>
                <Ionicons name={t.icon} size={16} color={c.primary} />
                <Text style={[p.trustTxt, { color: c.mutedForeground }]}>{t.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>

        {/* Legal */}
        <Text style={[p.legal, { color: c.mutedForeground }]}>
          {chosenIntroPrice && chosenPkg
            ? chosenIsFreeTrial
              ? `No charge today. Your ${formatIntroDuration(chosenIntroPrice)} free trial includes up to ${FREE_TRIAL_SESSIONS} qualifying drives. After the trial, ${chosenPkg.product.priceString}/${periodLabel} will be charged automatically unless cancelled at least 24 hours before renewal. `
              : `You'll be charged ${chosenIntroPrice.priceString} for the ${formatIntroPeriod(chosenIntroPrice)}, then ${chosenPkg.product.priceString}/${periodLabel} thereafter. Subscription auto-renews at the regular price until cancelled at least 24 hours before renewal. `
            : chosenPriceString
              ? `If you subscribe, you'll be charged ${chosenPriceString}/${periodLabel}. The subscription auto-renews until cancelled from your ${storeName} settings. `
              : "Subscriptions auto-renew unless cancelled at least 24 hours before the end of the current period. "}
          By subscribing you agree to our{" "}
          <Text style={[p.legalLink, { color: c.primary }]} onPress={() => router.push("/terms")}>Terms of Service</Text>
          {" "}and{" "}
          <Text style={[p.legalLink, { color: c.primary }]} onPress={() => router.push("/privacy")}>Privacy Policy</Text>.
        </Text>
      </ScrollView>

      {/* Bottom CTA */}
      <View style={[p.cta, { borderTopColor: c.tileBorder, paddingBottom: botPad }]}>
        {/* Price context — stacked above the button */}
        {!offeringsLoading && !offeringsError && chosenPriceString && (
          <View style={p.priceContext}>
            {chosenIntroPrice ? (
              <>
                <Text style={[p.ctaPriceMain, { color: "#16a34a" }]}>
                  {chosenIsFreeTrial ? "Free" : chosenIntroPrice.priceString}
                  <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: "#16a34a" }}>
                    {" "}{chosenIsFreeTrial ? `for ${formatIntroDuration(chosenIntroPrice)}` : formatIntroPeriod(chosenIntroPrice)}
                  </Text>
                </Text>
                <Text style={[p.ctaPriceSub, { color: c.mutedForeground }]}>
                  Then {chosenPkg!.product.priceString}/{periodLabel} · cancel anytime
                </Text>
              </>
            ) : (
              <>
                <Text style={[p.ctaPriceMain, { color: c.foreground }]}>
                  {chosenPriceString}
                  <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular" }}> /{periodLabel}</Text>
                </Text>
                <Text style={[p.ctaPriceSub, { color: c.mutedForeground }]}>
                  Cancel anytime from {storeName} settings
                </Text>
              </>
            )}
          </View>
        )}

        {/* Premium gradient CTA button */}
        <TouchableOpacity
          onPress={handleSubscribe}
          disabled={isPurchasing || offeringsLoading || !chosenPkg}
          activeOpacity={0.88}
          style={[
            p.ctaBtnWrap,
            { opacity: isPurchasing || offeringsLoading || !chosenPkg ? 0.6 : 1 },
          ]}
        >
          <LinearGradient
            colors={[c.primary, c.primary + "CC"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={p.ctaBtnGradient}
          >
            {/* Subtle inner highlight */}
            <View style={p.ctaBtnHighlight} />
            {isPurchasing || offeringsLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons
                  name={chosenIsFreeTrial ? "gift-outline" : chosenIntroPrice ? "pricetag-outline" : "shield-checkmark-outline"}
                  size={20}
                  color="#fff"
                />
                <Text style={p.ctaBtnTxt}>
                  {chosenIsFreeTrial
                    ? `Start ${formatIntroDuration(chosenIntroPrice)} Free Trial`
                    : chosenIntroPrice
                    ? `Start at ${chosenIntroPrice.priceString}`
                    : "Subscribe Now"}
                </Text>
                <Ionicons name="arrow-forward" size={18} color="rgba(255,255,255,0.7)" />
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>

        {/* Trust signal */}
        <View style={p.trustNote}>
          <Ionicons name="lock-closed-outline" size={12} color={c.mutedForeground} />
          <Text style={[p.trustNoteTxt, { color: c.mutedForeground }]}>
            {chosenIsFreeTrial
              ? `No charge today · Secured by ${storeName}`
              : chosenIntroPrice
              ? `${chosenIntroPrice.priceString} today · Secured by ${storeName}`
              : `Secured by ${storeName} · Cancel anytime`}
          </Text>
        </View>

        {/* Restore */}
        <TouchableOpacity onPress={handleRestore} disabled={isRestoring} style={p.restoreBtn}>
          <Text style={[p.restoreTxt, { color: c.mutedForeground }]}>
            {isRestoring ? "Restoring…" : "Restore purchases"}
          </Text>
        </TouchableOpacity>

        {/* Creator program */}
        <TouchableOpacity
          style={[p.creatorBtn, { backgroundColor: c.card, borderColor: c.tileBorder }]}
          onPress={() => router.push("/creator-program" as any)}
          activeOpacity={0.8}
        >
          <Ionicons name="star-outline" size={16} color={c.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[p.creatorTitle, { color: c.foreground }]}>Join as a Msafiri Creator</Text>
            <Text style={[p.creatorSub, { color: c.mutedForeground }]}>
              Create with us and get{" "}
              <Text style={{ color: c.primary, fontFamily: "Inter_600SemiBold" }}>1 month of Premium free</Text>
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={c.mutedForeground} />
        </TouchableOpacity>

        {/* Dismiss */}
        <TouchableOpacity
          onPress={handleDismiss}
          style={p.notNowBtn}
          accessibilityLabel="Not now"
          accessibilityRole="button"
        >
          <Text style={[p.notNowTxt, { color: c.mutedForeground }]}>
            Not now
          </Text>
        </TouchableOpacity>
      </View>

      <AdminPinModal visible={showAdminLogin} onClose={() => setShowAdminLogin(false)} />
    </View>
  );
}

const p = StyleSheet.create({
  root: { flex: 1 },

  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 10 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  brandTxt: { fontSize: 13, fontFamily: "Inter_700Bold", letterSpacing: 0.3 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: "center", justifyContent: "center" },

  scroll: { paddingHorizontal: 16, paddingTop: 4 },

  hero: { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  heroTitle: { fontSize: 24, fontFamily: "Inter_700Bold", lineHeight: 32, marginBottom: 8 },
  heroSub: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, marginBottom: 12 },
  trialPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "flex-start", borderRadius: 20, borderWidth: 1,
    paddingVertical: 6, paddingHorizontal: 12,
  },
  trialTxt: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 24 },
  featureCard: {
    width: "47.5%", borderRadius: 16, borderWidth: 1,
    padding: 14, gap: 8,
  },
  featureIconWrap: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  featureTitle: { fontSize: 13, fontFamily: "Inter_700Bold", lineHeight: 17 },
  featureDesc: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 15 },
  featureBadge: { alignSelf: "flex-start", borderRadius: 8, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3 },
  featureBadgeTxt: { fontSize: 10, fontFamily: "Inter_600SemiBold" },

  planHeading: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 12 },
  plans: { gap: 10, marginBottom: 14 },
  planCard: { borderRadius: 16, borderWidth: 1.5, padding: 16, overflow: "hidden" },
  bestBadge: { position: "absolute", top: 0, right: 0, paddingHorizontal: 10, paddingVertical: 4, borderBottomLeftRadius: 12 },
  bestTxt: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },
  planRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  planName: { fontSize: 16, fontFamily: "Inter_700Bold" },
  planNote: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  priceBlock: { alignItems: "flex-end" },
  price: { fontSize: 18, fontFamily: "Inter_700Bold" },
  pricePeriod: { fontSize: 11, fontFamily: "Inter_400Regular" },

  trustRow: { flexDirection: "row", borderRadius: 16, borderWidth: 1, marginBottom: 16, overflow: "hidden" },
  trustDiv: { width: StyleSheet.hairlineWidth },
  trustItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14, paddingHorizontal: 4 },
  trustTxt: { fontSize: 10, fontFamily: "Inter_500Medium", textAlign: "center", lineHeight: 14 },

  legal: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 16 },
  legalLink: { fontFamily: "Inter_600SemiBold" },

  errCard: { alignItems: "center", gap: 8, borderRadius: 16, borderWidth: 1, paddingVertical: 24, paddingHorizontal: 20, marginBottom: 16 },
  errTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  errSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
  retryBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1.5, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 18, marginTop: 4 },
  retryTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  cta: { paddingHorizontal: 16, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },

  priceContext: { alignItems: "center", marginBottom: 4 },
  ctaPriceMain: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  ctaPriceSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, textAlign: "center" },

  // Premium gradient CTA button
  ctaBtnWrap: {
    borderRadius: 20,
    // iOS shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    // Android elevation
    elevation: 8,
  },
  ctaBtnGradient: {
    borderRadius: 20,
    paddingVertical: 18,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 10,
    overflow: "hidden" as const,
  },
  ctaBtnHighlight: {
    position: "absolute" as const,
    top: 0, left: 0, right: 0,
    height: "50%",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  ctaBtnTxt: { color: "#fff", fontSize: 17, fontFamily: "Inter_700Bold", letterSpacing: 0.2 },

  trustNote: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  trustNoteTxt: { fontSize: 11, fontFamily: "Inter_400Regular" },

  restoreBtn: { alignItems: "center", paddingVertical: 2 },
  restoreTxt: { fontSize: 13, fontFamily: "Inter_400Regular", textDecorationLine: "underline" },

  creatorBtn: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14 },
  creatorTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  creatorSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },

  notNowBtn: { alignItems: "center", paddingBottom: 4 },
  notNowTxt: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
