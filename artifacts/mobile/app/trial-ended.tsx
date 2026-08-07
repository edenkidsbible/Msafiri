/**
 * Trial Ended screen
 *
 * Shown on cold-start when the user's free trial has expired without
 * them converting to a paid plan. Routes here from _layout.tsx instead
 * of /paywall so we can explain what happened and offer a clean path to
 * subscribe (with no trial option — they've already used it).
 */
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
import { useColors } from "@/hooks/useColors";
import { useSubscription } from "@/lib/revenuecat";
import { useApp } from "@/context/AppContext";
import { REVENUECAT_ENTITLEMENT_IDENTIFIER } from "@/lib/revenuecat";

const AMBER = "#F59E0B";

const MISSING = [
  { icon: "speedometer-outline" as const,          label: "Real-time speed camera & road alerts" },
  { icon: "videocam-outline" as const,             label: "Dashcam recording & locked clips" },
  { icon: "car-sport-outline" as const,            label: "Automatic crash detection & SOS" },
  { icon: "location-outline" as const,             label: "Live trip location sharing" },
  { icon: "construct-outline" as const,            label: "Vehicle care reminders" },
  { icon: "headset-outline" as const,              label: "Free audio driving course" },
];

export default function TrialEndedScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { requestLocationPermission } = useApp();
  const { restore, isRestoring } = useSubscription();

  const topPad = Platform.OS === "web" ? 24 : insets.top + 16;
  const botPad = Platform.OS === "web" ? 24 : insets.bottom + 24;

  const [restoreError, setRestoreError] = useState("");
  const [restoreSuccess, setRestoreSuccess] = useState(false);

  async function handleRestore() {
    setRestoreError("");
    try {
      const info = await restore();
      const hasActive = info?.entitlements?.active?.[REVENUECAT_ENTITLEMENT_IDENTIFIER] !== undefined;
      if (hasActive) {
        setRestoreSuccess(true);
        await requestLocationPermission();
        router.replace("/(tabs)");
      } else {
        setRestoreError(
          "No active subscription found for this account. If you subscribed on a different Apple or Google account, switch accounts and try again."
        );
      }
    } catch (e: any) {
      setRestoreError(
        e?.message && !e.message.includes("userCancelled")
          ? e.message
          : "Restore failed. Please check your connection and try again."
      );
    }
  }

  return (
    <View style={[s.root, { backgroundColor: c.background, paddingTop: topPad }]}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: botPad }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Icon badge */}
        <View style={s.badgeWrap}>
          <View style={[s.glowOuter, { backgroundColor: AMBER + "15" }]} />
          <View style={[s.glowInner, { backgroundColor: AMBER + "25" }]} />
          <View style={[s.badge, { backgroundColor: AMBER + "20", borderColor: AMBER + "50" }]}>
            <Ionicons name="hourglass-outline" size={44} color={AMBER} />
          </View>
        </View>

        {/* Headline */}
        <Text style={[s.title, { color: c.foreground }]}>Your free trial has ended</Text>
        <Text style={[s.sub, { color: c.mutedForeground }]}>
          Your 3-day trial gave you full access to everything Msafiri has to offer.
          Subscribe now to keep driving with real-time protection on Kenyan roads.
        </Text>

        {/* What they're missing */}
        <View style={[s.missingCard, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
          <Text style={[s.missingHeading, { color: c.foreground }]}>What you're missing</Text>
          <View style={s.missingList}>
            {MISSING.map((m) => (
              <View key={m.label} style={s.missingRow}>
                <View style={[s.missingIconWrap, { backgroundColor: AMBER + "18" }]}>
                  <Ionicons name={m.icon} size={16} color={AMBER} />
                </View>
                <Text style={[s.missingLabel, { color: c.foreground }]}>{m.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Plans reminder */}
        <View style={[s.plansNote, { backgroundColor: c.primary + "12", borderColor: c.primary + "33" }]}>
          <Ionicons name="shield-checkmark-outline" size={18} color={c.primary} />
          <Text style={[s.plansNoteTxt, { color: c.mutedForeground }]}>
            Choose{" "}
            <Text style={{ color: c.foreground, fontFamily: "Inter_600SemiBold" }}>Monthly</Text>
            {" "}or{" "}
            <Text style={{ color: c.foreground, fontFamily: "Inter_600SemiBold" }}>Weekly</Text>
            {" "}— cancel anytime from your App Store or Google Play settings.
          </Text>
        </View>

        {/* Restore error */}
        {!!restoreError && (
          <View style={[s.errorCard, { backgroundColor: "#C6282812", borderColor: "#C6282840" }]}>
            <Ionicons name="alert-circle-outline" size={16} color="#C62828" />
            <Text style={[s.errorTxt, { color: "#C62828" }]}>{restoreError}</Text>
          </View>
        )}
      </ScrollView>

      {/* Bottom CTAs */}
      <View style={[s.cta, { borderTopColor: c.tileBorder, paddingBottom: botPad }]}>
        {/* Primary: Subscribe */}
        <TouchableOpacity
          style={[s.subscribeBtn, { backgroundColor: c.primary }]}
          onPress={() => router.push("/paywall" as any)}
          activeOpacity={0.85}
        >
          <Text style={s.subscribeBtnTxt}>Subscribe Now</Text>
          <Ionicons name="chevron-forward" size={18} color="#fff" />
        </TouchableOpacity>

        {/* Restore */}
        <TouchableOpacity
          onPress={handleRestore}
          disabled={isRestoring || restoreSuccess}
          style={s.restoreBtn}
          activeOpacity={0.7}
        >
          {isRestoring ? (
            <ActivityIndicator size="small" color={c.mutedForeground} />
          ) : (
            <Text style={[s.restoreTxt, { color: c.mutedForeground }]}>
              I already subscribed — Restore purchases
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:  { flex: 1 },
  scroll: { paddingHorizontal: 24, paddingTop: 8, gap: 20 },

  badgeWrap:  { alignSelf: "center", width: 120, height: 120, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  glowOuter:  { position: "absolute", width: 120, height: 120, borderRadius: 60 },
  glowInner:  { position: "absolute", width: 88,  height: 88,  borderRadius: 44 },
  badge:      { width: 70, height: 70, borderRadius: 22, borderWidth: 1, alignItems: "center", justifyContent: "center" },

  title: { fontSize: 26, fontFamily: "Inter_700Bold", textAlign: "center", lineHeight: 34 },
  sub:   { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21, color: "#888" },

  missingCard:    { borderRadius: 20, borderWidth: 1, padding: 18, gap: 14 },
  missingHeading: { fontSize: 15, fontFamily: "Inter_700Bold" },
  missingList:    { gap: 12 },
  missingRow:     { flexDirection: "row", alignItems: "center", gap: 12 },
  missingIconWrap:{ width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  missingLabel:   { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1 },

  plansNote:    { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 14, borderWidth: 1, padding: 14 },
  plansNoteTxt: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, flex: 1 },

  errorCard: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 12, borderWidth: 1, padding: 12 },
  errorTxt:  { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18, flex: 1 },

  cta:          { paddingHorizontal: 24, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, gap: 12 },
  subscribeBtn: { borderRadius: 18, paddingVertical: 17, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  subscribeBtnTxt: { color: "#fff", fontSize: 17, fontFamily: "Inter_700Bold" },
  restoreBtn:   { alignItems: "center", paddingVertical: 4 },
  restoreTxt:   { fontSize: 13, fontFamily: "Inter_400Regular", textDecorationLine: "underline" },
});
