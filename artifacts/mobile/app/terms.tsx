import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

const SECTIONS = [
  {
    heading: "1. Acceptance",
    body: "By downloading or using Msafiri you agree to these Terms. If you do not agree, please uninstall the app.",
  },
  {
    heading: "2. Use of the App",
    body: "Msafiri is licensed, not sold, to you for personal, non-commercial use. You may not reverse-engineer, redistribute, or use the app in a manner that violates Kenyan law or these Terms.",
  },
  {
    heading: "3. Subscription",
    body: "A paid subscription is required after any free trial period. Subscriptions auto-renew unless cancelled at least 24 hours before the renewal date through your App Store or Google Play account settings. We do not issue refunds outside the platform's own refund policies.",
  },
  {
    heading: "4. Community Reports",
    body: "You are responsible for the accuracy of any road reports you submit. Intentionally submitting false or misleading reports is a violation of these Terms and may result in your device being blocked from the community feature.",
  },
  {
    heading: "5. Safety Disclaimer",
    body: "Speed zone data and alerts are provided for informational purposes only. Msafiri is not a substitute for your own judgment and attentive driving. Always obey official road signs and Kenyan traffic laws. We are not liable for any accident, fine, or loss arising from use of this app.",
  },
  {
    heading: "6. Data & Privacy",
    body: "Our use of your data is governed by the Privacy Policy. You agree to that policy by using Msafiri.",
  },
  {
    heading: "7. Intellectual Property",
    body: "All content, branding, and code in Msafiri are the property of the developer. You may not copy, modify, or distribute them without express written permission.",
  },
  {
    heading: "8. Limitation of Liability",
    body: "To the fullest extent permitted by Kenyan law, Msafiri and its developer are not liable for any direct, indirect, or consequential damages arising from use or inability to use this app.",
  },
  {
    heading: "9. Changes",
    body: "We may update these Terms at any time. Continued use of the app after changes means you accept the updated Terms. The effective date is shown below.",
  },
  {
    heading: "10. Governing Law",
    body: "These Terms are governed by the laws of Kenya. Any disputes shall be subject to the exclusive jurisdiction of Kenyan courts.",
  },
];

export default function TermsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={[s.screen, { backgroundColor: c.background }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 40, paddingTop: 20 }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[s.effective, { color: c.mutedForeground }]}>Effective: 1 January 2025</Text>

      {SECTIONS.map((sec) => (
        <View key={sec.heading} style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[s.heading, { color: c.foreground }]}>{sec.heading}</Text>
          <Text style={[s.body, { color: c.mutedForeground }]}>{sec.body}</Text>
        </View>
      ))}

      <Text style={[s.footer, { color: c.mutedForeground }]}>
        Questions? Email support@msafirikenya.com
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  effective: { fontSize: 12, fontFamily: "Inter_400Regular", paddingHorizontal: 20, marginBottom: 16 },
  card: {
    marginHorizontal: 16, marginBottom: 12,
    borderRadius: 16, borderWidth: 1, padding: 16, gap: 8,
  },
  heading: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  footer: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 8, paddingHorizontal: 24 },
});
