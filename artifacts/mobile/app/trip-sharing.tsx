/**
 * trip-sharing.tsx — Marketing-style page selling the Trip Sharing feature.
 *
 * Reached from the home-screen "Trip Sharing" status tile. Explains what it
 * is, key benefits, and how to use it, with a CTA that starts a drive (Trip
 * Sharing is only available during an active drive).
 */

import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";

const BENEFITS = [
  {
    icon: "eye-outline" as const,
    title: "Live location, real time",
    body: "Family and friends watch you move on a map the whole way — no more \"almost there\" calls.",
  },
  {
    icon: "globe-outline" as const,
    title: "No app needed to follow",
    body: "Your link opens in any browser, on any phone or computer. Watchers don't install anything.",
  },
  {
    icon: "shield-checkmark-outline" as const,
    title: "Private by design",
    body: "Only people you send the link to can see you. Sharing stops the moment you end it.",
  },
  {
    icon: "battery-charging-outline" as const,
    title: "Light on your battery",
    body: "Optimised background updates keep your position fresh without draining your phone.",
  },
];

const STEPS = [
  { n: "1", title: "Start driving", body: "Tap Start Driving and begin your trip as usual." },
  { n: "2", title: "Tap \"Share Trip\"", body: "A Share Trip button appears while you're driving. Tap it once." },
  { n: "3", title: "Send your link", body: "Share via WhatsApp, SMS, or any app — and they're watching over you." },
];

export default function TripSharingScreen() {
  const c = useColors();
  const { isSharingTrip } = useApp();

  const startDriving = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    router.push("/(tabs)/drive");
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={["top"]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={c.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>Trip Sharing</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <LinearGradient
          colors={[c.heroGradientStart, c.heroGradientEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroIconWrap}>
            <Ionicons name="radio-outline" size={34} color="#FFFFFF" />
          </View>
          <Text style={styles.heroTitle}>They see you home,{"\n"}every kilometre.</Text>
          <Text style={styles.heroSub}>
            Share a live link so the people who care can follow your journey in real time.
          </Text>
          {isSharingTrip && (
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveBadgeTxt}>Sharing is active right now</Text>
            </View>
          )}
        </LinearGradient>

        {/* Benefits */}
        <Text style={[styles.section, { color: c.foreground }]}>Why drivers love it</Text>
        {BENEFITS.map((b) => (
          <View key={b.title} style={[styles.benefitRow, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
            <View style={[styles.benefitIcon, { backgroundColor: c.primary + "18" }]}>
              <Ionicons name={b.icon} size={20} color={c.primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.benefitTitle, { color: c.foreground }]}>{b.title}</Text>
              <Text style={[styles.benefitBody, { color: c.mutedForeground }]}>{b.body}</Text>
            </View>
          </View>
        ))}

        {/* How to use */}
        <Text style={[styles.section, { color: c.foreground }]}>How to use it</Text>
        <View style={[styles.stepsCard, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
          {STEPS.map((s, i) => (
            <View key={s.n} style={[styles.stepRow, i < STEPS.length - 1 && [styles.stepDivider, { borderBottomColor: c.border }]]}>
              <View style={[styles.stepNum, { backgroundColor: c.primary }]}>
                <Text style={[styles.stepNumTxt, { color: c.isDark ? "#04170B" : "#FFFFFF" }]}>{s.n}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.stepTitle, { color: c.foreground }]}>{s.title}</Text>
                <Text style={[styles.stepBody, { color: c.mutedForeground }]}>{s.body}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* CTA */}
        <TouchableOpacity style={[styles.cta, { backgroundColor: c.primary }]} onPress={startDriving} activeOpacity={0.85}>
          <Ionicons name="navigate" size={19} color={c.isDark ? "#04170B" : "#FFFFFF"} />
          <Text style={[styles.ctaTxt, { color: c.isDark ? "#04170B" : "#FFFFFF" }]}>Start Driving &amp; Share</Text>
        </TouchableOpacity>
        <Text style={[styles.ctaHint, { color: c.mutedForeground }]}>
          You can also manage sharing any time from Trips → Share.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, alignItems: "flex-start" },
  headerTitle: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },

  hero: { borderRadius: 20, padding: 22, alignItems: "center" },
  heroIconWrap: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: "#FFFFFF22",
    alignItems: "center", justifyContent: "center", marginBottom: 14,
  },
  heroTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#FFFFFF", textAlign: "center", lineHeight: 29 },
  heroSub: {
    fontSize: 13, fontFamily: "Inter_500Medium", color: "#FFFFFFCC",
    textAlign: "center", marginTop: 8, lineHeight: 19,
  },
  liveBadge: {
    flexDirection: "row", alignItems: "center", gap: 7,
    backgroundColor: "#FFFFFF22", borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 6, marginTop: 14,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FFFFFF" },
  liveBadgeTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },

  section: { fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 22, marginBottom: 10 },

  benefitRow: {
    flexDirection: "row", gap: 12, alignItems: "flex-start",
    borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10,
  },
  benefitIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  benefitTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  benefitBody: { fontSize: 12.5, fontFamily: "Inter_400Regular", marginTop: 3, lineHeight: 18 },

  stepsCard: { borderRadius: 16, borderWidth: 1 },
  stepRow: { flexDirection: "row", gap: 12, alignItems: "flex-start", padding: 14 },
  stepDivider: { borderBottomWidth: StyleSheet.hairlineWidth },
  stepNum: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", marginTop: 1 },
  stepNumTxt: { fontSize: 13, fontFamily: "Inter_700Bold" },
  stepTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  stepBody: { fontSize: 12.5, fontFamily: "Inter_400Regular", marginTop: 3, lineHeight: 18 },

  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: 16, paddingVertical: 16, marginTop: 24,
  },
  ctaTxt: { fontSize: 16, fontFamily: "Inter_700Bold" },
  ctaHint: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 10 },
});
