import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

const SECTIONS = [
  {
    heading: "Data We Collect",
    body: "Msafiri stores trip history, reported incidents, your SOS emergency contact, and display preferences locally on your device only. No account is required and no personal data is transmitted to our servers.",
  },
  {
    heading: "Location",
    body: "Your GPS location is used in real time to display your speed, trigger zone alerts, and attach coordinates to road reports you choose to submit. Location data is never stored on our servers or shared with third parties.",
  },
  {
    heading: "Community Reports",
    body: "When you submit a road report (e.g. speed camera, pothole), the incident type, approximate coordinates, and a random device-generated ID are submitted to our servers. No name, email, or account information is attached.",
  },
  {
    heading: "Subscriptions",
    body: "Subscription payments are handled entirely by Apple (App Store) or Google (Play Store). We receive only a confirmation of your subscription status from RevenueCat — never your payment card details.",
  },
  {
    heading: "Third-Party Services",
    body: "We use RevenueCat for subscription management and Apple/Google Maps for map tiles. These services have their own privacy policies. We do not use advertising SDKs or analytics trackers.",
  },
  {
    heading: "Your Rights",
    body: "You can delete all locally stored data at any time from Settings → Delete All My Data. To request removal of any server-side community reports linked to your device ID, email privacy@msafirikenya.com.",
  },
  {
    heading: "Changes to This Policy",
    body: "We may update this policy as the app evolves. Continued use of Msafiri after changes constitutes acceptance. The effective date is shown below.",
  },
];

export default function PrivacyScreen() {
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
        Questions? Email privacy@msafirikenya.com
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
