import React from "react";
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

const CHANNELS = [
  {
    icon: "mail-outline" as const,
    label: "General Support",
    value: "support@msafirikenya.com",
    note: "Questions, feedback, or issues",
    href: "mailto:support@msafirikenya.com",
  },
  {
    icon: "shield-outline" as const,
    label: "Privacy & Data",
    value: "privacy@msafirikenya.com",
    note: "Data requests, deletion, GDPR",
    href: "mailto:privacy@msafirikenya.com",
  },
  {
    icon: "briefcase-outline" as const,
    label: "Business & Partnerships",
    value: "hello@msafirikenya.com",
    note: "Partnerships and enterprise enquiries",
    href: "mailto:hello@msafirikenya.com",
  },
];

export default function ContactScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={[s.screen, { backgroundColor: c.background }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 40, paddingTop: 24 }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[s.intro, { color: c.mutedForeground }]}>
        We're a small team — we read every message and aim to reply within 2 business days.
      </Text>

      {CHANNELS.map((ch) => (
        <TouchableOpacity
          key={ch.label}
          style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={() => Linking.openURL(ch.href)}
          activeOpacity={0.75}
        >
          <View style={[s.iconWrap, { backgroundColor: c.primary + "18" }]}>
            <Ionicons name={ch.icon} size={22} color={c.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.label, { color: c.foreground }]}>{ch.label}</Text>
            <Text style={[s.email, { color: c.primary }]}>{ch.value}</Text>
            <Text style={[s.note, { color: c.mutedForeground }]}>{ch.note}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={c.mutedForeground} />
        </TouchableOpacity>
      ))}

      <View style={[s.infoCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <Ionicons name="information-circle-outline" size={18} color={c.mutedForeground} />
        <Text style={[s.infoText, { color: c.mutedForeground }]}>
          For subscription billing issues, please contact Apple Support (iOS) or Google Play
          Support (Android) directly, as all payments are processed through their platforms.
        </Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  intro: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21, paddingHorizontal: 20, marginBottom: 20 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 14,
    marginHorizontal: 16, marginBottom: 12,
    borderRadius: 16, borderWidth: 1, padding: 16,
  },
  iconWrap: {
    width: 46, height: 46, borderRadius: 14,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  label: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  email: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 2 },
  note: { fontSize: 12, fontFamily: "Inter_400Regular" },
  infoCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    marginHorizontal: 16, marginTop: 8,
    borderRadius: 14, borderWidth: 1, padding: 14,
  },
  infoText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, flex: 1 },
});
