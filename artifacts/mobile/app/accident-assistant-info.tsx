/**
 * accident-assistant-info.tsx — Info page for the Accident (Crash) Assistant.
 *
 * Reached from the home-screen "Accident Assistant" promo card's Learn More
 * button. Explains the guided 7-step flow, the Evidence Vault, and what the
 * assistant captures automatically, with a CTA into Accident Reports.
 */

import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";

const FLOW_STEPS = [
  { icon: "heart-outline" as const,          title: "Safety check",       body: "First things first — confirm you're okay and get emergency numbers if needed." },
  { icon: "location-outline" as const,       title: "Scene snapshot",     body: "Your location, road name, direction, and speed before impact are logged automatically." },
  { icon: "camera-outline" as const,         title: "Photo evidence",     body: "Guided photo checklist: vehicle damage, the other car's plates, and the wider scene." },
  { icon: "people-outline" as const,         title: "Other party & witnesses", body: "Capture the other driver's details and witness contacts while memories are fresh." },
  { icon: "rainy-outline" as const,          title: "Conditions log",     body: "Weather and road conditions at the exact time are recorded for you." },
  { icon: "document-text-outline" as const,  title: "Your account",       body: "Describe what happened in your own words, step by step." },
  { icon: "download-outline" as const,       title: "PDF report",         body: "Everything is compiled into a professional PDF for police and insurance." },
];

const CAPTURES = [
  { icon: "location" as const,      label: "GPS location & road" },
  { icon: "speedometer" as const,   label: "Speed before impact" },
  { icon: "compass" as const,       label: "Direction of travel" },
  { icon: "rainy" as const,         label: "Weather conditions" },
  { icon: "time" as const,          label: "Exact date & time" },
  { icon: "images" as const,        label: "Photos & witnesses" },
];

export default function AccidentAssistantInfoScreen() {
  const c = useColors();

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={["top"]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={c.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>Accident Assistant</Text>
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
            <Ionicons name="medkit-outline" size={34} color="#FFFFFF" />
          </View>
          <Text style={styles.heroTitle}>Calm guidance when{"\n"}it matters most.</Text>
          <Text style={styles.heroSub}>
            If the unexpected happens, the Accident Assistant walks you through
            exactly what to do — and builds your evidence file as you go.
          </Text>
        </LinearGradient>

        {/* 7-step flow */}
        <Text style={[styles.section, { color: c.foreground }]}>A guided 7-step flow</Text>
        <View style={[styles.stepsCard, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
          {FLOW_STEPS.map((s, i) => (
            <View key={s.title} style={[styles.stepRow, i < FLOW_STEPS.length - 1 && [styles.stepDivider, { borderBottomColor: c.border }]]}>
              <View style={[styles.stepIcon, { backgroundColor: c.primary + "18" }]}>
                <Ionicons name={s.icon} size={18} color={c.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.stepTitle, { color: c.foreground }]}>
                  {i + 1}. {s.title}
                </Text>
                <Text style={[styles.stepBody, { color: c.mutedForeground }]}>{s.body}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* What it captures */}
        <Text style={[styles.section, { color: c.foreground }]}>Captured automatically</Text>
        <View style={styles.captureGrid}>
          {CAPTURES.map((cap) => (
            <View key={cap.label} style={[styles.captureChip, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
              <Ionicons name={cap.icon} size={15} color={c.primary} />
              <Text style={[styles.captureTxt, { color: c.foreground }]}>{cap.label}</Text>
            </View>
          ))}
        </View>

        {/* Evidence vault */}
        <View style={[styles.vaultCard, { backgroundColor: c.card, borderColor: c.primary + "44" }]}>
          <View style={[styles.vaultIcon, { backgroundColor: c.primary + "18" }]}>
            <Ionicons name="lock-closed-outline" size={22} color={c.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.vaultTitle, { color: c.foreground }]}>Your Evidence Vault</Text>
            <Text style={[styles.vaultBody, { color: c.mutedForeground }]}>
              Every accident record — photos, witnesses, timeline, and the final
              PDF — is stored safely in your Accident Reports, ready whenever
              police or your insurer ask.
            </Text>
          </View>
        </View>

        {/* CTA */}
        <TouchableOpacity
          style={[styles.cta, { backgroundColor: c.primary }]}
          onPress={() => router.push("/accident-reports")}
          activeOpacity={0.85}
        >
          <Ionicons name="document-text-outline" size={19} color={c.isDark ? "#04170B" : "#FFFFFF"} />
          <Text style={[styles.ctaTxt, { color: c.isDark ? "#04170B" : "#FFFFFF" }]}>View Accident Reports</Text>
        </TouchableOpacity>
        <Text style={[styles.ctaHint, { color: c.mutedForeground }]}>
          You can start a report manually any time — no crash required.
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

  section: { fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 22, marginBottom: 10 },

  stepsCard: { borderRadius: 16, borderWidth: 1 },
  stepRow: { flexDirection: "row", gap: 12, alignItems: "flex-start", padding: 13 },
  stepDivider: { borderBottomWidth: StyleSheet.hairlineWidth },
  stepIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  stepTitle: { fontSize: 13.5, fontFamily: "Inter_600SemiBold" },
  stepBody: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 17 },

  captureGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  captureChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 8,
  },
  captureTxt: { fontSize: 12, fontFamily: "Inter_500Medium" },

  vaultCard: {
    flexDirection: "row", gap: 12, alignItems: "flex-start",
    borderRadius: 18, borderWidth: 1.5, padding: 14, marginTop: 22,
  },
  vaultIcon: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  vaultTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  vaultBody: { fontSize: 12.5, fontFamily: "Inter_400Regular", marginTop: 3, lineHeight: 18 },

  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: 16, paddingVertical: 16, marginTop: 22,
  },
  ctaTxt: { fontSize: 16, fontFamily: "Inter_700Bold" },
  ctaHint: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 10 },
});
