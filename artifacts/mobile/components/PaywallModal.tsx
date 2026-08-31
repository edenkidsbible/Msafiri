import React, { useRef, useState } from "react";
import { SCROLL_PROPS } from "@/lib/scrollProps";
import {
  Alert,
  ActivityIndicator,
  Modal,
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
import { AdminPinModal } from "./AdminPinModal";

interface Props {
  visible: boolean;
  onClose: () => void;
}

// Minimal shape we rely on — matches PurchasesIntroPrice from react-native-purchases.
interface IntroPrice {
  price: number;
  priceString: string;
  cycles: number;
  period: string;
  periodUnit: string;     // "DAY" | "WEEK" | "MONTH" | "YEAR"
  periodNumberOfUnits: number;
}

const FEATURES = [
  { icon: "shield-checkmark", label: "Speed camera & police alerts" },
  { icon: "navigate", label: "Turn-by-turn navigation" },
  { icon: "mic", label: "Voice announcements" },
  { icon: "map", label: "Community incident reports" },
  { icon: "speedometer", label: "Real-time speed zone warnings" },
  { icon: "car", label: "Trip history & stats" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derive a human-readable label for the intro period from the store data.
 * Examples: "first month", "first 3 months", "first week", "first 2 weeks".
 * Uses cycles × periodNumberOfUnits so a single P3M billing period (cycles=1,
 * periodNumberOfUnits=3) correctly renders as "first 3 months", not "first month".
 */
function formatIntroPeriod(intro: IntroPrice): string {
  // Total duration = billing cycles × units per billing period
  // e.g. cycles=1, periodNumberOfUnits=3, periodUnit=MONTH → 3 months
  //      cycles=3, periodNumberOfUnits=1, periodUnit=MONTH → 3 months
  const totalUnits = intro.cycles * intro.periodNumberOfUnits;
  const unit = intro.periodUnit.toLowerCase(); // "day" | "week" | "month" | "year"
  return totalUnits === 1 ? `first ${unit}` : `first ${totalUnits} ${unit}s`;
}

/**
 * Build the renewal description shown in legal text and confirmation dialog.
 * e.g. "KSh 99 for the first month, then KSh 299/month"
 */
function formatIntroWithRenewal(intro: IntroPrice, regularPriceString: string, regularPeriodLabel: string): string {
  const period = formatIntroPeriod(intro);
  return `${intro.priceString} for the ${period}, then ${regularPriceString}/${regularPeriodLabel}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PaywallModal({ visible, onClose }: Props) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    offerings,
    offeringsLoading,
    purchase,
    isPurchasing,
    restore,
    isRestoring,
    error,
    isTrialEligible,
    isDefinitelyIntroEligible,
  } = useSubscription();
  const { isAdmin, adminLogout } = useApp();

  const [selectedPkg, setSelectedPkg] = useState<string>("$rc_monthly");
  const [confirmPkg, setConfirmPkg] = useState<any>(null);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // ── Hidden admin entry: 3 taps on "Drive" in the hero ───────────────────────
  const [adminTapCount, setAdminTapCount] = useState(0);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const adminTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleAdminTap() {
    if (adminTapTimer.current) clearTimeout(adminTapTimer.current);
    const next = adminTapCount + 1;
    if (next >= 3) {
      setAdminTapCount(0);
      if (isAdmin) {
        Alert.alert("Admin Mode", "Deactivate admin access on this device?", [
          { text: "Cancel", style: "cancel" },
          { text: "Deactivate", style: "destructive", onPress: () => { void adminLogout(); } },
        ]);
      } else {
        setShowAdminLogin(true);
      }
    } else {
      setAdminTapCount(next);
      adminTapTimer.current = setTimeout(() => setAdminTapCount(0), 2000);
    }
  }

  const currentOffering = offerings?.current;
  const weeklyPkg = currentOffering?.availablePackages.find(
    (p) => p.identifier === "$rc_weekly",
  );
  const monthlyPkg = currentOffering?.availablePackages.find(
    (p) => p.identifier === "$rc_monthly",
  );

  const chosenPkg = selectedPkg === "$rc_weekly" ? weeklyPkg : monthlyPkg;

  // ── Intro price gate ──────────────────────────────────────────────────────────
  // Use the STRICTER gate (isDefinitelyIntroEligible) so we only advertise the
  // offer when the store has positively confirmed eligibility — never for unknown
  // or pending iOS states, and never on web. On Android, Google Play only
  // populates product.introPrice when the user is eligible, so introPrice != null
  // is itself the reliable signal; the Android branch of isDefinitelyIntroEligible
  // always returns true and we rely on the field being null when ineligible.
  const monthlyIntroPrice: IntroPrice | null =
    monthlyPkg && isDefinitelyIntroEligible(monthlyPkg.product.identifier)
      ? (monthlyPkg.product.introPrice as IntroPrice | null) ?? null
      : null;

  // Intro offer is only active for the monthly plan (weekly has no intro offer).
  const chosenIntroPrice: IntroPrice | null =
    selectedPkg === "$rc_monthly" ? monthlyIntroPrice : null;

  // For the plain free-trial gate (used elsewhere), keep the existing looser check.
  const trialEligible = chosenPkg ? isTrialEligible(chosenPkg.product.identifier) : true;

  // ── Handlers ──────────────────────────────────────────────────────────────────

  async function handlePurchase() {
    if (!chosenPkg || !agreedToTerms) return;
    setConfirmPkg(chosenPkg);
  }

  async function confirmPurchase() {
    if (!confirmPkg) return;
    try {
      await purchase(confirmPkg);
      setConfirmPkg(null);
      onClose();
    } catch (e: any) {
      if (e?.userCancelled) {
        setConfirmPkg(null);
      }
    }
  }

  // ── Derived display strings ───────────────────────────────────────────────────

  // CTA label leads with the intro price so the first action feels low-stakes.
  const ctaLabel = chosenIntroPrice
    ? `Start at ${chosenIntroPrice.priceString}`
    : "Subscribe Now";

  const regularPeriodLabel = selectedPkg === "$rc_weekly" ? "week" : "month";

  // Full charge description used in both the legal paragraph and the confirm dialog.
  const chargeDescription = chosenPkg
    ? chosenIntroPrice
      ? formatIntroWithRenewal(chosenIntroPrice, chosenPkg.product.priceString, regularPeriodLabel)
      : `${chosenPkg.product.priceString} per ${regularPeriodLabel}`
    : null;

  // ── Legal copy ────────────────────────────────────────────────────────────────
  function buildLegalText(): string {
    if (!chosenPkg) {
      return "Subscription auto-renews unless cancelled at least 24 hours before the end of the current period. Manage or cancel anytime in your App Store or Google Play account settings.";
    }
    if (chosenIntroPrice) {
      // Describe intro period then renewal — no duplication.
      return `You'll be charged ${chosenIntroPrice.priceString} for the ${formatIntroPeriod(chosenIntroPrice)}, then ${chosenPkg.product.priceString}/${regularPeriodLabel} thereafter. Subscription auto-renews at the regular price until cancelled at least 24 hours before renewal. Manage or cancel anytime in your App Store or Google Play account settings.`;
    }
    return `You'll be charged ${chosenPkg.product.priceString} per ${regularPeriodLabel} and your subscription will auto-renew at that price until cancelled. Manage or cancel anytime in your App Store or Google Play account settings.`;
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { backgroundColor: c.background, paddingBottom: insets.bottom + 16 }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <View style={styles.headerLeft} />
          <Text style={[styles.headerTitle, { color: c.foreground }]}>Msafiri</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 4, right: 12 }}>
            <Ionicons name="close" size={24} color={c.mutedForeground} />
          </TouchableOpacity>
        </View>

        <ScrollView
          {...SCROLL_PROPS}
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <View style={styles.heroWrap}>
            <View style={[styles.heroBadge, { backgroundColor: c.primary + "18" }]}>
              <Ionicons name="shield-checkmark" size={40} color={c.primary} />
            </View>
            <Text style={[styles.heroTitle, { color: c.foreground }]}>
              {/* 3 taps on "Drive" opens admin PIN entry */}
              <Text onPress={handleAdminTap}>Drive</Text>
              {" smarter."}{"\n"}Stay protected.
            </Text>
            <Text style={[styles.heroSub, { color: c.mutedForeground }]}>
              Join thousands of Kenyan drivers who arrive safely every day.
            </Text>
          </View>

          {/* Commitment / intro-offer badge */}
          {monthlyIntroPrice ? (
            // Green badge describing the intro offer — only shown when eligibility is
            // positively confirmed; never shown while iOS query is still loading.
            <View style={[styles.introBadge, { backgroundColor: "#16a34a18", borderColor: "#16a34a55" }]}>
              <Ionicons name="pricetag" size={16} color="#16a34a" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.introBadgeTitle, { color: "#16a34a" }]}>
                  Introductory offer — {monthlyIntroPrice.priceString} {formatIntroPeriod(monthlyIntroPrice)}
                </Text>
                <Text style={[styles.introBadgeSub, { color: "#16a34a" }]}>
                  then {monthlyPkg!.product.priceString}/month · Cancel anytime
                </Text>
              </View>
            </View>
          ) : (
            <View style={[styles.trialBadge, { backgroundColor: c.primary + "15", borderColor: c.primary + "55" }]}>
              <Ionicons name="shield-checkmark-outline" size={16} color={c.primary} />
              <Text style={[styles.trialText, { color: c.primary }]}>
                Cancel anytime — no long-term commitment
              </Text>
            </View>
          )}

          {/* Feature list */}
          <View style={[styles.featuresCard, { backgroundColor: c.card, borderColor: c.border }]}>
            {FEATURES.map((f) => (
              <View key={f.label} style={styles.featureRow}>
                <View style={[styles.featureIcon, { backgroundColor: c.primary + "18" }]}>
                  <Ionicons name={f.icon as any} size={16} color={c.primary} />
                </View>
                <Text style={[styles.featureLabel, { color: c.foreground }]}>{f.label}</Text>
              </View>
            ))}
          </View>

          {/* Plan picker */}
          {offeringsLoading ? (
            <ActivityIndicator color={c.primary} style={{ marginVertical: 24 }} />
          ) : !monthlyPkg && !weeklyPkg ? (
            // Offerings loaded but App Store hasn't made the products available yet
            // (common right after a new app is approved — IAPs go through separate review)
            <View style={[styles.plansComingSoon, { borderColor: c.border, backgroundColor: c.card }]}>
              <Ionicons name="time-outline" size={28} color={c.mutedForeground} />
              <Text style={[styles.plansComingSoonTitle, { color: c.foreground }]}>
                Plans coming soon
              </Text>
              <Text style={[styles.plansComingSoonSub, { color: c.mutedForeground }]}>
                Subscription plans are being finalised in the App Store. Please check back in a few minutes.
              </Text>
            </View>
          ) : (
            <View style={styles.plans}>
              {/* Monthly — shown first as recommended */}
              {monthlyPkg && (
                <TouchableOpacity
                  style={[
                    styles.planCard,
                    {
                      borderColor: selectedPkg === "$rc_monthly" ? c.primary : c.border,
                      backgroundColor:
                        selectedPkg === "$rc_monthly" ? c.primary + "12" : c.card,
                    },
                  ]}
                  onPress={() => setSelectedPkg("$rc_monthly")}
                  activeOpacity={0.8}
                >
                  {/* Badge: "INTRO OFFER" when eligible, otherwise "BEST VALUE" */}
                  <View style={[
                    styles.planBestBadge,
                    { backgroundColor: monthlyIntroPrice ? "#16a34a" : c.primary },
                  ]}>
                    <Text style={styles.planBestText}>
                      {monthlyIntroPrice ? "INTRO OFFER" : "BEST VALUE"}
                    </Text>
                  </View>

                  <View style={styles.planTop}>
                    <View style={[styles.planRadio, { borderColor: selectedPkg === "$rc_monthly" ? c.primary : c.border }]}>
                      {selectedPkg === "$rc_monthly" && (
                        <View style={[styles.planRadioDot, { backgroundColor: c.primary }]} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.planName, { color: c.foreground }]}>Monthly</Text>
                      {monthlyIntroPrice ? (
                        // Subtext derived from actual period data, not hard-coded
                        <Text style={[styles.planSave, { color: "#16a34a" }]}>
                          {monthlyIntroPrice.priceString} for the {formatIntroPeriod(monthlyIntroPrice)}
                        </Text>
                      ) : (
                        <Text style={[styles.planSave, { color: c.primary }]}>
                          Save 25% vs weekly
                        </Text>
                      )}
                    </View>
                    {/* Pricing column: intro price prominent + regular price as renewal note */}
                    {monthlyIntroPrice ? (
                      <View style={styles.planPriceWrap}>
                        <Text style={[styles.planPrice, { color: "#16a34a" }]}>
                          {monthlyIntroPrice.priceString}
                        </Text>
                        <Text style={[styles.planPriceRegular, { color: c.mutedForeground }]}>
                          then {monthlyPkg.product.priceString}/mo
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.planPriceWrap}>
                        <Text style={[styles.planPrice, { color: c.foreground }]}>
                          {monthlyPkg.product.priceString}
                        </Text>
                        <Text style={[styles.planPeriod, { color: c.mutedForeground }]}>/month</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              )}

              {/* Weekly */}
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
                    <View style={[styles.planRadio, { borderColor: selectedPkg === "$rc_weekly" ? c.primary : c.border }]}>
                      {selectedPkg === "$rc_weekly" && (
                        <View style={[styles.planRadioDot, { backgroundColor: c.primary }]} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.planName, { color: c.foreground }]}>Weekly</Text>
                      <Text style={[styles.planSave, { color: c.mutedForeground }]}>
                        Flexible, cancel anytime
                      </Text>
                    </View>
                    <View style={styles.planPriceWrap}>
                      <Text style={[styles.planPrice, { color: c.foreground }]}>
                        {weeklyPkg.product.priceString}
                      </Text>
                      <Text style={[styles.planPeriod, { color: c.mutedForeground }]}>/week</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          )}

          {error && (
            <Text style={styles.errorText}>
              Something went wrong. Please try again.
            </Text>
          )}

          {/* Legal note */}
          <Text style={[styles.legal, { color: c.mutedForeground }]}>
            {buildLegalText()}
          </Text>

          {/* Terms agreement checkbox */}
          <TouchableOpacity
            style={styles.agreeRow}
            onPress={() => setAgreedToTerms((v) => !v)}
            activeOpacity={0.7}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          >
            <View
              style={[
                styles.checkbox,
                {
                  borderColor: agreedToTerms ? c.primary : c.border,
                  backgroundColor: agreedToTerms ? c.primary : "transparent",
                },
              ]}
            >
              {agreedToTerms && <Ionicons name="checkmark" size={14} color="#fff" />}
            </View>
            <Text style={[styles.agreeText, { color: c.mutedForeground }]}>
              By starting my subscription, I agree to the{" "}
              <Text
                style={[styles.agreeLink, { color: c.primary }]}
                onPress={(e) => { e.stopPropagation(); onClose(); router.push("/terms"); }}
              >
                Terms of Service
              </Text>{" "}
              and{" "}
              <Text
                style={[styles.agreeLink, { color: c.primary }]}
                onPress={(e) => { e.stopPropagation(); onClose(); router.push("/privacy"); }}
              >
                Privacy Policy
              </Text>
              .
            </Text>
          </TouchableOpacity>
        </ScrollView>

        {/* CTA */}
        <View style={[styles.ctaWrap, { borderTopColor: c.border }]}>
          <TouchableOpacity
            style={[
              styles.ctaBtn,
              {
                backgroundColor: chosenIntroPrice ? "#16a34a" : c.primary,
                opacity: isPurchasing || offeringsLoading || !agreedToTerms ? 0.5 : 1,
              },
            ]}
            onPress={handlePurchase}
            disabled={isPurchasing || offeringsLoading || !chosenPkg || !agreedToTerms}
            activeOpacity={0.85}
          >
            {isPurchasing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.ctaBtnTxt}>{ctaLabel}</Text>
            )}
          </TouchableOpacity>

          {/* Renewal reminder under the CTA — driven by actual period data */}
          {chosenIntroPrice && chosenPkg && (
            <Text style={[styles.ctaRenewalNote, { color: c.mutedForeground }]}>
              Renews at {chosenPkg.product.priceString}/{regularPeriodLabel} after the {formatIntroPeriod(chosenIntroPrice)}
            </Text>
          )}

          <TouchableOpacity
            onPress={() => restore()}
            disabled={isRestoring}
            style={styles.restoreBtn}
          >
            <Text style={[styles.restoreTxt, { color: c.mutedForeground }]}>
              {isRestoring ? "Restoring…" : "Restore purchases"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Admin login — triggered by 3-tap on "Drive" in the hero */}
        <AdminPinModal
          visible={showAdminLogin}
          onClose={() => setShowAdminLogin(false)}
          onSuccess={() => setShowAdminLogin(false)}
        />

        {/* Test-mode purchase confirmation modal.
            Shows intro pricing when applicable so the confirmation matches what
            the driver sees on the plan card — no contradictory pricing. */}
        {confirmPkg && (
          <Modal transparent animationType="fade" visible onRequestClose={() => setConfirmPkg(null)}>
            <View style={styles.confirmOverlay}>
              <View style={[styles.confirmSheet, { backgroundColor: c.card }]}>
                <Text style={[styles.confirmTitle, { color: c.foreground }]}>
                  Confirm Purchase (Test Mode)
                </Text>
                <Text style={[styles.confirmBody, { color: c.mutedForeground }]}>
                  {chargeDescription ? (
                    <>
                      Purchase "{confirmPkg.product.title}" for{" "}
                      <Text style={{ fontFamily: "Inter_700Bold", color: c.foreground }}>
                        {chargeDescription}
                      </Text>
                      ?
                    </>
                  ) : (
                    <>
                      Purchase "{confirmPkg.product.title}" for{" "}
                      <Text style={{ fontFamily: "Inter_700Bold", color: c.foreground }}>
                        {confirmPkg.product.priceString}
                      </Text>
                      ?
                    </>
                  )}
                </Text>
                <View style={styles.confirmBtns}>
                  <TouchableOpacity
                    style={[styles.confirmCancel, { borderColor: c.border }]}
                    onPress={() => setConfirmPkg(null)}
                  >
                    <Text style={[styles.confirmCancelTxt, { color: c.foreground }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmOk, { backgroundColor: c.primary }]}
                    onPress={confirmPurchase}
                  >
                    <Text style={styles.confirmOkTxt}>Confirm</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1,
  },
  headerLeft: { width: 24 },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  scroll: { padding: 20, paddingBottom: 8 },

  heroWrap: { alignItems: "center", marginBottom: 20 },
  heroBadge: {
    width: 80, height: 80, borderRadius: 24,
    alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  heroTitle: {
    fontSize: 26, fontFamily: "Inter_700Bold", textAlign: "center", lineHeight: 34, marginBottom: 8,
  },
  heroSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },

  // Intro offer badge (green) — shown only when eligibility is positively confirmed
  introBadge: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    borderRadius: 12, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 16,
    marginBottom: 20,
  },
  introBadgeTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  introBadgeSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  // Fallback badge (brand color) — shown when no confirmed intro offer
  trialBadge: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 12, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 16,
    marginBottom: 20,
  },
  trialText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  featuresCard: {
    borderRadius: 16, borderWidth: 1, padding: 16, gap: 12, marginBottom: 20,
  },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  featureIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  featureLabel: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1 },

  plansComingSoon: {
    borderRadius: 16, borderWidth: 1, padding: 20, alignItems: "center", gap: 10, marginBottom: 16,
  },
  plansComingSoonTitle: { fontSize: 16, fontFamily: "Inter_700Bold", textAlign: "center" },
  plansComingSoonSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },

  plans: { gap: 12, marginBottom: 16 },
  planCard: { borderRadius: 16, borderWidth: 2, padding: 16, overflow: "hidden" },
  planBestBadge: {
    position: "absolute", top: 0, right: 0,
    paddingHorizontal: 10, paddingVertical: 4, borderBottomLeftRadius: 12,
  },
  planBestText: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },
  planTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  planRadio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  planRadioDot: { width: 10, height: 10, borderRadius: 5 },
  planName: { fontSize: 16, fontFamily: "Inter_700Bold" },
  planSave: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  planPriceWrap: { alignItems: "flex-end" },
  planPrice: { fontSize: 20, fontFamily: "Inter_700Bold" },
  planPeriod: { fontSize: 12, fontFamily: "Inter_400Regular" },
  // Renewal rate shown below the intro price on the plan card
  planPriceRegular: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },

  errorText: { color: "#E53935", fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 8 },

  legal: {
    fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 16, marginTop: 4,
  },
  agreeRow: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    marginTop: 16, paddingHorizontal: 4,
  },
  checkbox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 2,
    alignItems: "center", justifyContent: "center", marginTop: 1,
  },
  agreeText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, flex: 1 },
  agreeLink: { fontFamily: "Inter_600SemiBold" },

  ctaWrap: { paddingHorizontal: 20, paddingTop: 16, borderTopWidth: 1, gap: 8 },
  ctaBtn: { borderRadius: 18, paddingVertical: 17, alignItems: "center" },
  ctaBtnTxt: { color: "#fff", fontSize: 17, fontFamily: "Inter_700Bold" },
  ctaRenewalNote: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center" },
  restoreBtn: { alignItems: "center", paddingVertical: 4 },
  restoreTxt: { fontSize: 13, fontFamily: "Inter_400Regular" },

  confirmOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  confirmSheet: { borderRadius: 20, padding: 24, width: "100%", gap: 16 },
  confirmTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  confirmBody: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  confirmBtns: { flexDirection: "row", gap: 12 },
  confirmCancel: { flex: 1, borderWidth: 1, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  confirmCancelTxt: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  confirmOk: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  confirmOkTxt: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
});
