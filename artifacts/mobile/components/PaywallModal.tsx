import React, { useState } from "react";
import {
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
import { useSubscription } from "@/lib/revenuecat";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  onClose: () => void;
}

const FEATURES = [
  { icon: "shield-checkmark", label: "Speed camera & police alerts" },
  { icon: "navigate", label: "Turn-by-turn navigation" },
  { icon: "mic", label: "Voice announcements" },
  { icon: "map", label: "Community incident reports" },
  { icon: "speedometer", label: "Real-time speed zone warnings" },
  { icon: "car", label: "Trip history & stats" },
];

export function PaywallModal({ visible, onClose }: Props) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { offerings, isLoading, purchase, isPurchasing, restore, isRestoring, error } =
    useSubscription();

  const [selectedPkg, setSelectedPkg] = useState<string>("$rc_monthly");
  const [confirmPkg, setConfirmPkg] = useState<any>(null);

  const currentOffering = offerings?.current;
  const weeklyPkg = currentOffering?.availablePackages.find(
    (p) => p.identifier === "$rc_weekly",
  );
  const monthlyPkg = currentOffering?.availablePackages.find(
    (p) => p.identifier === "$rc_monthly",
  );

  const chosenPkg =
    selectedPkg === "$rc_weekly" ? weeklyPkg : monthlyPkg;

  async function handlePurchase() {
    if (!chosenPkg) return;
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
          <Text style={[styles.headerTitle, { color: c.foreground }]}>Msafiri Pro</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="close" size={24} color={c.mutedForeground} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <View style={styles.heroWrap}>
            <View style={[styles.heroBadge, { backgroundColor: "#E8F5E9" }]}>
              <Ionicons name="shield-checkmark" size={40} color="#2E7D32" />
            </View>
            <Text style={[styles.heroTitle, { color: c.foreground }]}>
              Drive smarter.{"\n"}Stay protected.
            </Text>
            <Text style={[styles.heroSub, { color: c.mutedForeground }]}>
              Join thousands of Kenyan drivers who arrive safely every day.
            </Text>
          </View>

          {/* Free trial badge */}
          <View style={[styles.trialBadge, { backgroundColor: "#FFF9C4", borderColor: "#F9A825" }]}>
            <Ionicons name="gift-outline" size={16} color="#F57F17" />
            <Text style={[styles.trialText, { color: "#E65100" }]}>
              1-day free trial — cancel anytime
            </Text>
          </View>

          {/* Feature list */}
          <View style={[styles.featuresCard, { backgroundColor: c.card, borderColor: c.border }]}>
            {FEATURES.map((f) => (
              <View key={f.label} style={styles.featureRow}>
                <View style={[styles.featureIcon, { backgroundColor: "#E8F5E9" }]}>
                  <Ionicons name={f.icon as any} size={16} color="#2E7D32" />
                </View>
                <Text style={[styles.featureLabel, { color: c.foreground }]}>{f.label}</Text>
              </View>
            ))}
          </View>

          {/* Plan picker */}
          {isLoading ? (
            <ActivityIndicator color={c.primary} style={{ marginVertical: 24 }} />
          ) : (
            <View style={styles.plans}>
              {/* Monthly — shown first as recommended */}
              {monthlyPkg && (
                <TouchableOpacity
                  style={[
                    styles.planCard,
                    {
                      borderColor: selectedPkg === "$rc_monthly" ? "#2E7D32" : c.border,
                      backgroundColor:
                        selectedPkg === "$rc_monthly" ? "#E8F5E9" : c.card,
                    },
                  ]}
                  onPress={() => setSelectedPkg("$rc_monthly")}
                  activeOpacity={0.8}
                >
                  <View style={styles.planBestBadge}>
                    <Text style={styles.planBestText}>BEST VALUE</Text>
                  </View>
                  <View style={styles.planTop}>
                    <View style={[styles.planRadio, { borderColor: selectedPkg === "$rc_monthly" ? "#2E7D32" : c.border }]}>
                      {selectedPkg === "$rc_monthly" && (
                        <View style={[styles.planRadioDot, { backgroundColor: "#2E7D32" }]} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.planName, { color: c.foreground }]}>Monthly</Text>
                      <Text style={[styles.planSave, { color: "#2E7D32" }]}>
                        Save 17% vs weekly
                      </Text>
                    </View>
                    <View style={styles.planPriceWrap}>
                      <Text style={[styles.planPrice, { color: c.foreground }]}>
                        {monthlyPkg.product.priceString}
                      </Text>
                      <Text style={[styles.planPeriod, { color: c.mutedForeground }]}>/month</Text>
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
                      borderColor: selectedPkg === "$rc_weekly" ? "#2E7D32" : c.border,
                      backgroundColor: selectedPkg === "$rc_weekly" ? "#E8F5E9" : c.card,
                    },
                  ]}
                  onPress={() => setSelectedPkg("$rc_weekly")}
                  activeOpacity={0.8}
                >
                  <View style={styles.planTop}>
                    <View style={[styles.planRadio, { borderColor: selectedPkg === "$rc_weekly" ? "#2E7D32" : c.border }]}>
                      {selectedPkg === "$rc_weekly" && (
                        <View style={[styles.planRadioDot, { backgroundColor: "#2E7D32" }]} />
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
            Subscription auto-renews unless cancelled 24 hours before the end of the current period.
            Managed through your App Store or Google Play account.
          </Text>
        </ScrollView>

        {/* CTA */}
        <View style={[styles.ctaWrap, { borderTopColor: c.border }]}>
          <TouchableOpacity
            style={[styles.ctaBtn, { backgroundColor: "#2E7D32", opacity: isPurchasing || isLoading ? 0.6 : 1 }]}
            onPress={handlePurchase}
            disabled={isPurchasing || isLoading || !chosenPkg}
            activeOpacity={0.85}
          >
            {isPurchasing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.ctaBtnTxt}>
                Start Free Trial
              </Text>
            )}
          </TouchableOpacity>

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

        {/* Test-mode purchase confirmation modal */}
        {confirmPkg && (
          <Modal transparent animationType="fade" visible onRequestClose={() => setConfirmPkg(null)}>
            <View style={styles.confirmOverlay}>
              <View style={[styles.confirmSheet, { backgroundColor: c.card }]}>
                <Text style={[styles.confirmTitle, { color: c.foreground }]}>
                  Confirm Purchase (Test Mode)
                </Text>
                <Text style={[styles.confirmBody, { color: c.mutedForeground }]}>
                  Purchase "{confirmPkg.product.title}" for{" "}
                  <Text style={{ fontFamily: "Inter_700Bold", color: c.foreground }}>
                    {confirmPkg.product.priceString}
                  </Text>
                  ?
                </Text>
                <View style={styles.confirmBtns}>
                  <TouchableOpacity
                    style={[styles.confirmCancel, { borderColor: c.border }]}
                    onPress={() => setConfirmPkg(null)}
                  >
                    <Text style={[styles.confirmCancelTxt, { color: c.foreground }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmOk, { backgroundColor: "#2E7D32" }]}
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

  plans: { gap: 12, marginBottom: 16 },
  planCard: {
    borderRadius: 16, borderWidth: 2, padding: 16, overflow: "hidden",
  },
  planBestBadge: {
    position: "absolute", top: 0, right: 0,
    backgroundColor: "#2E7D32", paddingHorizontal: 10, paddingVertical: 4,
    borderBottomLeftRadius: 12,
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

  errorText: { color: "#E53935", fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 8 },

  legal: {
    fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 16, marginTop: 4,
  },

  ctaWrap: { paddingHorizontal: 20, paddingTop: 16, borderTopWidth: 1, gap: 12 },
  ctaBtn: {
    borderRadius: 18, paddingVertical: 17, alignItems: "center",
  },
  ctaBtnTxt: { color: "#fff", fontSize: 17, fontFamily: "Inter_700Bold" },
  restoreBtn: { alignItems: "center" },
  restoreTxt: { fontSize: 13, fontFamily: "Inter_400Regular" },

  confirmOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", padding: 24 },
  confirmSheet: { borderRadius: 20, padding: 24, width: "100%", gap: 16 },
  confirmTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  confirmBody: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  confirmBtns: { flexDirection: "row", gap: 12 },
  confirmCancel: { flex: 1, borderWidth: 1, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  confirmCancelTxt: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  confirmOk: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  confirmOkTxt: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
});
