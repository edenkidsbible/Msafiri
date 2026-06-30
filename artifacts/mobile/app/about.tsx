import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

const FEATURES = [
  { icon: "speedometer",       text: "Real-time GPS speed display with speed limit warnings" },
  { icon: "shield-checkmark",  text: "Speed camera and police checkpoint alerts" },
  { icon: "people",            text: "Community-powered road hazard reports" },
  { icon: "mic",               text: "Voice announcements and haptic alerts" },
  { icon: "alert-circle",      text: "SOS emergency button with one-tap contact" },
  { icon: "navigate",          text: "Turn-by-turn navigation" },
  { icon: "time",              text: "Trip history and driving stats" },
  { icon: "cloud-offline",     text: "Offline speed zone data for Kenya" },
];

export default function AboutScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={[s.screen, { backgroundColor: c.background }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 40, paddingTop: 24 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Hero */}
      <View style={s.hero}>
        <View style={[s.iconBadge, { backgroundColor: c.primary + "18" }]}>
          <Ionicons name="navigate" size={36} color={c.primary} />
        </View>
        <Text style={[s.appName, { color: c.foreground }]}>Msafiri</Text>
        <Text style={[s.version, { color: c.mutedForeground }]}>Version 1.0.0</Text>
        <Text style={[s.tagline, { color: c.mutedForeground }]}>
          Drive smarter. Stay protected on Kenyan roads.
        </Text>
      </View>

      {/* Mission */}
      <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[s.sectionLabel, { color: c.mutedForeground }]}>OUR MISSION</Text>
        <Text style={[s.body, { color: c.foreground }]}>
          Msafiri gives Kenyan drivers real-time road awareness — speed limits, cameras, police
          checkpoints, and community hazard reports — so every journey is safer and smarter.
        </Text>
        <Text style={[s.body, { color: c.mutedForeground, marginTop: 8 }]}>
          No account required. No location data leaves your device. Built by Kenyans, for Kenyans.
        </Text>
      </View>

      {/* Features */}
      <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[s.sectionLabel, { color: c.mutedForeground }]}>WHAT'S INCLUDED</Text>
        {FEATURES.map((f) => (
          <View key={f.icon} style={s.featureRow}>
            <View style={[s.featureIcon, { backgroundColor: c.primary + "18" }]}>
              <Ionicons name={f.icon as any} size={16} color={c.primary} />
            </View>
            <Text style={[s.featureText, { color: c.foreground }]}>{f.text}</Text>
          </View>
        ))}
      </View>

      {/* Disclaimer */}
      <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[s.sectionLabel, { color: c.mutedForeground }]}>DISCLAIMER</Text>
        <Text style={[s.body, { color: c.mutedForeground }]}>
          Speed zone and alert data is for guidance only. Always obey official traffic signs,
          road markings, and all applicable Kenyan traffic laws. Msafiri does not replace safe,
          attentive driving.
        </Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  hero: { alignItems: "center", paddingHorizontal: 24, marginBottom: 24, gap: 6 },
  iconBadge: {
    width: 76, height: 76, borderRadius: 24,
    alignItems: "center", justifyContent: "center", marginBottom: 8,
  },
  appName: { fontSize: 28, fontFamily: "Inter_700Bold" },
  version: { fontSize: 13, fontFamily: "Inter_400Regular" },
  tagline: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22, marginTop: 4 },
  card: {
    marginHorizontal: 16, marginBottom: 16,
    borderRadius: 16, borderWidth: 1, padding: 16, gap: 12,
  },
  sectionLabel: {
    fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1.5,
  },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  featureIcon: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1,
  },
  featureText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, flex: 1 },
});
