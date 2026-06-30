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

const FEATURES = [
  { icon: "speedometer",        label: "Real-time GPS speed display" },
  { icon: "shield-checkmark",   label: "Speed camera & police alerts" },
  { icon: "people",             label: "Community road reports" },
  { icon: "mic",                label: "Voice announcements & haptic alerts" },
  { icon: "alert-circle",       label: "SOS emergency button" },
  { icon: "navigate",           label: "Turn-by-turn navigation" },
  { icon: "time",               label: "Trip history & stats" },
  { icon: "cloud-offline",      label: "Offline speed zone data" },
];

export default function PaywallScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { requestLocationPermission } = useApp();
  const { offerings, isLoading, purchase, isPurchasing, restore, isRestoring, error } =
    useSubscription();

  const [selectedPkg, setSelectedPkg] = useState<string>("$rc_monthly");

  const currentOffering = offerings?.current;
  const weeklyPkg = currentOffering?.availablePackages.find(
    (p) => p.identifier === "$rc_weekly",
  );
  const monthlyPkg = currentOffering?.availablePackages.find(
    (p) => p.identifier === "$rc_monthly",
  );
  const chosenPkg = selectedPkg === "$rc_weekly" ? weeklyPkg : monthlyPkg;

  const topPad = Platform.OS === "web" ? 20 : insets.top + 8;
  const botPad = Platform.OS === "web" ? 20 : insets.bottom + 16;

  async function handleSubscribe() {
    if (!chosenPkg) return;
    try {
      await purchase(chosenPkg);
      await requestLocationPermission();
      router.replace("/(tabs)");
    } catch (e: any) {
      // user cancelled — stay on screen
    }
  }

  async function handleRestore() {
    try {
      await restore();
      await requestLocationPermission();
      router.replace("/(tabs)");
    } catch {
      // restore failed — stay on screen
    }
  }

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
            {/* Monthly — shown first as recommended */}
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
                    <Text style={[styles.price, { color: c.foreground }]}>
                      {monthlyPkg.product.priceString}
                    </Text>
                    <Text style={[styles.period, { color: c.mutedForeground }]}>/month</Text>
                  </View>
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
                    <Text style={[styles.price, { color: c.foreground }]}>
                      {weeklyPkg.product.priceString}
                    </Text>
                    <Text style={[styles.period, { color: c.mutedForeground }]}>/week</Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}
          </View>
        )}

        {error && (
          <Text style={styles.errorText}>Something went wrong. Please try again.</Text>
        )}

        {/* Legal */}
        <Text style={[styles.legal, { color: c.mutedForeground }]}>
          Subscription auto-renews unless cancelled at least 24 hours before the end of
          the current period. Managed through your App Store or Google Play account.
        </Text>
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

  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
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
    paddingHorizontal: 10, paddingVertical: 4,
    borderBottomLeftRadius: 12,
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

  errorText: {
    color: "#E53935", fontSize: 13, fontFamily: "Inter_400Regular",
    textAlign: "center", marginBottom: 8,
  },
  legal: {
    fontSize: 11, fontFamily: "Inter_400Regular",
    textAlign: "center", lineHeight: 16, marginTop: 4,
  },

  ctaWrap: {
    paddingHorizontal: 24, paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  ctaBtn: { borderRadius: 18, paddingVertical: 17, alignItems: "center" },
  ctaBtnTxt: { color: "#fff", fontSize: 17, fontFamily: "Inter_700Bold" },
  restoreBtn: { alignItems: "center", paddingBottom: 4 },
  restoreTxt: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
