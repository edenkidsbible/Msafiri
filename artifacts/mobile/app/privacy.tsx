import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

export default function PrivacyScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();

  const B = ({ children }: { children: string }) => (
    <Text style={[s.bold, { color: c.foreground }]}>{children}</Text>
  );

  type LiProps = { children: React.ReactNode };
  const Li = ({ children }: LiProps) => (
    <View style={s.listRow}>
      <Text style={[s.bullet, { color: c.mutedForeground }]}>{"\u2022"}</Text>
      <Text style={[s.listText, { color: c.mutedForeground }]}>{children}</Text>
    </View>
  );

  return (
    <ScrollView
      style={[s.screen, { backgroundColor: c.background }]}
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40, paddingTop: 16 }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[s.effectiveDate, { color: c.mutedForeground }]}>
        Effective: July 28, 2026 · Last updated: July 28, 2026
      </Text>

      <Text style={[s.intro, { color: c.mutedForeground }]}>
        Msafiri Kenya ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy
        explains what information we collect, how we use it, how long we retain it, and your rights as a
        user. This policy applies to our mobile application ("App") available on iOS (Apple App Store)
        and Android (Google Play Store), as well as the msafirikenya.com website.
      </Text>
      <Text style={[s.intro, { color: c.mutedForeground }]}>
        By downloading, installing, or using Msafiri, you agree to the collection and use of information
        in accordance with this Privacy Policy. If you do not agree, please do not use the App.
      </Text>

      {/* 1 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>1. Information We Collect</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>We collect the following categories of information:</Text>

      <Text style={[s.h3, { color: c.primary }]}>1.1 Precise Location Data</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Location data is the core function of Msafiri. With your permission, we collect:
      </Text>
      <Li><B>GPS coordinates (latitude and longitude)</B>{" — used in real time to calculate your speed, detect nearby speed cameras, police checkpoints, and speed zones."}</Li>
      <Li><B>Location when the app is in use ("When In Use")</B>{" — collected while you have the app open and are actively driving."}</Li>
      <Li><B>Background location ("Always")</B>{" — collected when Live Trip Sharing is active, so people following your journey can see your position even when your screen is locked. You may revoke this at any time in your device Settings."}</Li>
      <Li><B>Location at time of SOS</B>{" — a single GPS coordinate is included in emergency SMS messages sent via the SOS feature."}</Li>
      <View style={[s.callout, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[s.p, { color: c.mutedForeground, marginBottom: 0 }]}>
          <B>When location is transmitted:</B>{" Your GPS coordinates are sent to servers in four situations: (a) when you submit a community road report; (b) when you activate the SOS feature; (c) every 8 seconds while Live Trip Sharing is active; and (d) when you request navigation directions (your origin and destination are sent to the Google Maps routing service). Speed calculation and hazard detection happen on-device and do not require location to be transmitted."}
        </Text>
      </View>

      <Text style={[s.h3, { color: c.primary }]}>1.2 Speed and Motion Data</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Msafiri calculates your driving speed entirely from GPS coordinates — we do not access your
        device's accelerometer, gyroscope, barometer, or any other motion or fitness sensor. No motion
        or fitness data is transmitted to our servers. Your speed is calculated locally on-device and
        is never stored or logged.
      </Text>
      <Li><B>GPS-derived speed</B>{" — computed from successive location fixes; used only for on-screen display and alert triggering. Never stored."}</Li>
      <Li><B>Heading (direction of travel)</B>{" — derived from GPS; used locally to determine whether a hazard is ahead of you. Never stored."}</Li>

      <Text style={[s.h3, { color: c.primary }]}>1.3 Device and Technical Information</Text>
      <Li><B>Device identifier (device ID)</B>{" — a unique anonymous identifier assigned to your device. Msafiri does not require account registration; your device ID is used in place of a user account."}</Li>
      <Li><B>Operating system and version</B>{" — iOS or Android version for compatibility and bug-fix purposes."}</Li>
      <Li><B>App version</B>{" — to ensure you receive feature-compatible responses from our API."}</Li>
      <Li><B>Network type</B>{" — Wi-Fi or mobile data, used solely for optimising data usage."}</Li>
      <Li><B>Push notification token</B>{" — a device-specific token issued by Apple (APNs) or Google (FCM) to deliver safety alerts and trip notifications. Stored on our servers linked to your device ID. You can revoke notification permission at any time in your device Settings."}</Li>

      <Text style={[s.h3, { color: c.primary }]}>1.4 Community Road Reports</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        When you submit a road report (e.g., speed camera, police checkpoint, speed zone, road hazard), we collect:
      </Text>
      <Li>{"The "}<B>type of report</B>{" (e.g., speed camera, pothole, alcoblow checkpoint)."}</Li>
      <Li>{"The "}<B>GPS coordinates</B>{" at the time of submission."}</Li>
      <Li>{"The "}<B>timestamp</B>{" of the report."}</Li>
      <Li>{"Your "}<B>device ID</B>{" (to prevent spam and enable report editing)."}</Li>
      <Li>{"Confirmation or denial votes submitted by other users for that report."}</Li>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Reports are shared with other Msafiri users on an aggregated, anonymised basis. We do not attach
        your name, phone number, or any personally identifiable information to community reports.
      </Text>

      <Text style={[s.h3, { color: c.primary }]}>1.5 Live Trip Sharing</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        When you activate Live Trip Sharing, we collect and transmit:
      </Text>
      <Li><B>GPS coordinates and speed</B>{" — sent to our servers approximately every 8 seconds while sharing is active, so people with your trip link can follow your journey in real time."}</Li>
      <Li><B>Session token</B>{" — a randomly generated link identifying your sharing session. Expires after 24 hours or when you stop sharing."}</Li>
      <Li><B>Display name</B>{" — if you enter an optional name for your trip, it is shown to people viewing your live journey."}</Li>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Live trip GPS pings are permanently deleted when the session expires. We do not retain a history
        of your journeys.
      </Text>

      <Text style={[s.h3, { color: c.primary }]}>1.6 Payment and Subscription Information (Msafiri Pro)</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Msafiri Pro subscriptions are processed by <B>RevenueCat</B> and billed through the Apple App
        Store or Google Play Store. We do not directly handle, store, or have access to your payment
        card details.
      </Text>
      <Li>{"RevenueCat provides us with a "}<B>non-identifiable subscriber token</B>{" linked to your device ID, confirming your subscription status (active, expired, or in trial)."}</Li>
      <Li>{"Apple and Google handle all payment processing under their own privacy policies."}</Li>
      <Li>{"We retain subscription status data for as long as your account is active, plus a reasonable period for billing dispute resolution."}</Li>

      <Text style={[s.h3, { color: c.primary }]}>1.7 SOS Emergency Data</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        If you use the SOS emergency feature, the App composes an emergency message with your GPS
        location and opens your device's native SMS app for you to review and send. The message includes:
      </Text>
      <Li>{"A standardised emergency message (\"EMERGENCY – I need help!\")."}</Li>
      <Li>{"A Google Maps link containing your current GPS coordinates."}</Li>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Msafiri does not transmit, store, or have access to the content of these messages or the
        recipients' phone numbers. Your device's carrier may retain this data under its own privacy policy.
      </Text>

      <Text style={[s.h3, { color: c.primary }]}>1.8 Voice Guidance and Audio</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Msafiri provides voice-guided navigation and hazard alerts using bundled audio clips and, for
        dynamic phrases such as road names and speed limit announcements, on-demand text-to-speech via
        <B> ElevenLabs</B>.
      </Text>
      <Li>{"When on-demand TTS is used, a "}<B>short text phrase</B>{" (e.g., \"Turn right onto Ngong Road\") is sent to ElevenLabs' API servers to generate an audio clip. No location data, device ID, or personal information is included in these requests."}</Li>
      <Li>{"Generated audio clips are "}<B>cached on your device for up to 90 days</B>{" to minimise repeated network requests."}</Li>

      <Text style={[s.h3, { color: c.primary }]}>1.9 Server and API Logs</Text>
      <Li>{"API request logs (server-side): IP address, endpoint, and timestamp — retained for up to 30 days for security monitoring."}</Li>

      {/* 2 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>2. How We Use Your Information</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>We use the information we collect for the following purposes:</Text>
      <Li><B>Core app functionality</B>{" — providing real-time speed awareness, road alert notifications, and displaying community reports on the in-app map."}</Li>
      <Li><B>Turn-by-turn navigation</B>{" — calculating driving routes, step-by-step directions, and announcing upcoming hazards along your route."}</Li>
      <Li><B>Community report system</B>{" — validating, aggregating, and expiring road reports submitted by users."}</Li>
      <Li><B>Live Trip Sharing</B>{" — transmitting your real-time position to people you've shared your trip link with."}</Li>
      <Li><B>Voice guidance</B>{" — generating navigation and hazard announcements via on-device audio and ElevenLabs TTS."}</Li>
      <Li><B>Subscription management</B>{" — verifying your Msafiri Pro subscription status via RevenueCat to unlock premium features."}</Li>
      <Li><B>Safety features</B>{" — enabling the SOS emergency SMS feature to function correctly."}</Li>
      <Li><B>App improvement</B>{" — analysing server-side error logs to fix bugs and improve performance."}</Li>
      <Li><B>Security and fraud prevention</B>{" — detecting and preventing spam reports, abuse, or unauthorised access to our API."}</Li>
      <Li><B>Legal compliance</B>{" — complying with applicable laws, regulations, and lawful requests from Kenyan authorities."}</Li>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        <B>We do not use your data for advertising, sell it to third parties, or use it to build profiles beyond what is necessary for the App's stated functionality.</B>
      </Text>

      {/* 3 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>3. How We Share Your Information</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>We share your information only in the following limited circumstances:</Text>

      <Text style={[s.h3, { color: c.primary }]}>3.1 With Other Msafiri Users</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Community road reports you submit are shared with other users in anonymised form (report type,
        location, and timestamp only). Your device ID is never exposed to other users. Live Trip Sharing
        data is visible only to people who have your specific trip link.
      </Text>

      <Text style={[s.h3, { color: c.primary }]}>3.2 With Service Providers</Text>
      <Li><B>RevenueCat</B>{" — subscription management. Receives your device ID and subscription events. Privacy: revenuecat.com/privacy."}</Li>
      <Li><B>ElevenLabs</B>{" — on-demand voice guidance synthesis. Receives short text phrases only (no location or personal data). Privacy: elevenlabs.io/privacy."}</Li>
      <Li><B>Google Maps SDK</B>{" — map rendering on Android and iOS. Privacy: policies.google.com/privacy."}</Li>
      <Li><B>Google Maps Routes API</B>{" — route calculation. Your origin and destination GPS coordinates are sent to the Google Maps platform to calculate driving routes. No personal information included. Privacy: policies.google.com/privacy."}</Li>
      <Li><B>OpenStreetMap / Nominatim / Photon</B>{" — reverse geocoding and place search. Queries do not include your device ID. Privacy: openstreetmap.org/privacy."}</Li>
      <Li><B>Overpass API</B>{" — Search Along Route POI queries. A route bounding box is sent; no device ID or personal data included."}</Li>
      <Li><B>Hosting and infrastructure providers</B>{" — cloud hosting with access to server logs; contractually restricted from using data for other purposes."}</Li>

      <Text style={[s.h3, { color: c.primary }]}>3.3 For Legal Reasons</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        We may disclose your information if required to do so by law, court order, or governmental
        authority, or if we believe in good faith that such disclosure is necessary to protect our rights,
        protect your safety or the safety of others, or investigate fraud.
      </Text>

      <Text style={[s.h3, { color: c.primary }]}>3.4 Business Transfers</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        If Msafiri Kenya is involved in a merger, acquisition, or sale of assets, your information may be
        transferred as part of that transaction. We will notify you via the App or our website before your
        information becomes subject to a different privacy policy.
      </Text>

      {/* 4 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>4. Data Retention</Text>
      <Li><B>Community reports</B>{" — active reports are automatically expired (typically 24–48 hours for most types). Expired reports are retained for up to 90 days for abuse analysis, then permanently deleted."}</Li>
      <Li><B>Live trip sharing data</B>{" — GPS pings deleted immediately when the session expires (after 24 hours or when you stop sharing). No journey history is retained."}</Li>
      <Li><B>Device ID and push notification token</B>{" — retained for up to 12 months of inactivity, then permanently deleted or anonymised."}</Li>
      <Li><B>API access logs (IP addresses)</B>{" — retained for up to 30 days for security monitoring."}</Li>
      <Li><B>Subscription records</B>{" — retained for the duration of your subscription and up to 12 months after cancellation."}</Li>
      <Li><B>Cached voice audio</B>{" — stored locally on your device for up to 90 days; clearing the App's storage removes these files."}</Li>

      {/* 5 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>5. Data Security</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        We take the security of your data seriously. Our security measures include:
      </Text>
      <Li>{"All data transmitted between the App and our servers is encrypted using "}<B>TLS (Transport Layer Security)</B>{"."}</Li>
      <Li>{"Our API servers are protected by authentication middleware; public endpoints are rate-limited to prevent abuse."}</Li>
      <Li>{"Access to our production database is restricted to authorised personnel only, protected by role-based access controls."}</Li>
      <Li>{"Admin panel access requires strong password authentication and is protected with time-limited JWT tokens."}</Li>
      <Li>{"We do not store payment card data on our servers; all payment processing is handled by Apple, Google, and RevenueCat."}</Li>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        While we implement industry-standard safeguards, no method of electronic transmission or storage
        is 100% secure. If you believe your data has been compromised, please contact us immediately at
        privacy@msafirikenya.com.
      </Text>

      {/* 6 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>6. Your Rights and Choices</Text>

      <Text style={[s.h3, { color: c.primary }]}>6.1 Location Permissions</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        You control location access through your device Settings at any time:
      </Text>
      <Li><B>iOS:</B>{" Settings → Privacy & Security → Location Services → Msafiri. Choose \"Never,\" \"While Using,\" or \"Always.\""}</Li>
      <Li><B>Android:</B>{" Settings → Apps → Msafiri → Permissions → Location. Choose \"Allow only while using the app\" or \"Allow all the time.\""}</Li>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Revoking location access will prevent core app functionality (speed display, alerts, and
        navigation) from working, but will not affect your subscription status.
      </Text>

      <Text style={[s.h3, { color: c.primary }]}>6.2 Notification Permissions</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        You can revoke push notification permission at any time:
      </Text>
      <Li><B>iOS:</B>{" Settings → Notifications → Msafiri → Allow Notifications (toggle off)."}</Li>
      <Li><B>Android:</B>{" Settings → Apps → Msafiri → Notifications (toggle off)."}</Li>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Revoking notifications means you will not receive push alerts for trip events, hazard
        notifications while the app is in the background, or admin messages.
      </Text>

      <Text style={[s.h3, { color: c.primary }]}>6.3 Deleting Your Data</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Because Msafiri does not require account registration, your data is linked only to your device ID.
        To request deletion of all data associated with your device:
      </Text>
      <Li>{"Email us at "}<B>privacy@msafirikenya.com</B>{" with the subject line \"Data Deletion Request.\""}</Li>
      <Li>{"We will delete all data tied to your device ID within "}<B>30 days</B>{" of receiving your request, except where retention is required by law or for legitimate security purposes."}</Li>

      <Text style={[s.h3, { color: c.primary }]}>6.4 Subscription Cancellation</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        You may cancel your Msafiri Pro subscription at any time through the App Store or Google Play
        Store. Cancellation stops future billing; you retain Pro access until the end of the current
        billing period.
      </Text>

      {/* 7 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>7. Location Data — Specific Disclosures</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        In compliance with Apple App Store and Google Play Store requirements:
      </Text>
      <Li><B>Primary purpose:</B>{" Location is used to (a) calculate your driving speed on-device, (b) detect nearby road hazards and speed zones, (c) provide turn-by-turn navigation, (d) attach a coordinate to SOS emergency messages and community reports, and (e) transmit your position during Live Trip Sharing."}</Li>
      <Li><B>Background location:</B>{" Used only when Live Trip Sharing is active and you have granted \"Always\" permission. Background pings are sent every 8 seconds during an active session and deleted when the session ends."}</Li>
      <Li><B>Route calculation:</B>{" When you request navigation directions, your start and end coordinates are sent to the Google Maps Routes API via our server. Your live position during navigation is not continuously sent to Google."}</Li>
      <Li><B>Not used for:</B>{" Advertising, targeted marketing, building a movement history, or any purpose unrelated to road safety and navigation."}</Li>
      <Li><B>Data minimisation:</B>{" We do not collect location when the App is closed and background mode is disabled."}</Li>

      {/* 8 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>8. SMS Permissions</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        The SOS emergency feature composes an emergency message with your location and opens your
        device's native SMS app for you to review and send. Msafiri does not request the restricted
        SEND_SMS permission and cannot send a text message without you tapping send. We do not:
      </Text>
      <Li>{"Send SMS messages without your explicit action."}</Li>
      <Li>{"Read your existing SMS messages."}</Li>
      <Li>{"Access your contacts list (emergency contacts are entered manually by you)."}</Li>
      <Li>{"Transmit the content of any SMS to our servers."}</Li>

      {/* 9 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>9. Children's Privacy</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Msafiri is not directed to children under the age of 13. We do not knowingly collect personal
        information from children under 13. If you are a parent or guardian and believe your child has
        provided us with personal information, please contact us at privacy@msafirikenya.com and we will
        take steps to delete that information.
      </Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Users between the ages of 13 and 17 should obtain parental or guardian consent before using the
        App, particularly before enabling the SOS feature or Live Trip Sharing.
      </Text>

      {/* 10 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>10. Third-Party Services</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        The App integrates with the following third-party services. We encourage you to review their
        respective privacy policies:
      </Text>
      <Li><B>RevenueCat</B>{" — revenuecat.com/privacy — in-app subscription management."}</Li>
      <Li><B>ElevenLabs</B>{" — elevenlabs.io/privacy — on-demand voice guidance text-to-speech."}</Li>
      <Li><B>Google Maps</B>{" — policies.google.com/privacy — map rendering and geocoding."}</Li>
      <Li><B>Google Maps Routes API</B>{" — policies.google.com/privacy — routing engine for navigation directions and road snapping."}</Li>
      <Li><B>OpenStreetMap / Nominatim / Photon</B>{" — openstreetmap.org/privacy — road name lookup and place search."}</Li>
      <Li><B>Overpass API</B>{" — overpass-api.de — points-of-interest search for Search Along Route."}</Li>
      <Li><B>Apple App Store</B>{" — apple.com/legal/privacy — app distribution, payment processing."}</Li>
      <Li><B>Google Play Store</B>{" — policies.google.com/privacy — app distribution, payment processing."}</Li>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Msafiri is not responsible for the privacy practices or content of these third-party services.
      </Text>

      {/* 11 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>11. International Data Transfers</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Msafiri Kenya is based in Kenya. Your data may be processed on servers located outside Kenya,
        including in the European Union and the United States, by our infrastructure and service providers
        (including ElevenLabs, RevenueCat, and Google Maps). We take reasonable steps to ensure that
        any international transfer of data complies with applicable data protection laws and that your
        data receives an adequate level of protection.
      </Text>

      {/* 12 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>12. Changes to This Privacy Policy</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        We may update this Privacy Policy from time to time. When we do, we will:
      </Text>
      <Li>{"Update the \"Last Updated\" date at the top of this page."}</Li>
      <Li>{"Display an in-app notification for material changes."}</Li>
      <Li>{"Where required by law, obtain your consent before the changes take effect."}</Li>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Your continued use of the App after the effective date of any changes constitutes your acceptance
        of the updated Privacy Policy.
      </Text>

      {/* 13 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>13. Contact Us</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        If you have any questions, concerns, or requests regarding this Privacy Policy, please contact us:
      </Text>
      <View style={[s.callout, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[s.p, { color: c.mutedForeground, marginBottom: 4 }]}><B>Msafiri Kenya</B></Text>
        <Text style={[s.p, { color: c.mutedForeground, marginBottom: 4 }]}>{"Email: "}<B>privacy@msafirikenya.com</B></Text>
        <Text style={[s.p, { color: c.mutedForeground, marginBottom: 4 }]}>{"Support: "}<B>support@msafirikenya.com</B></Text>
        <Text style={[s.p, { color: c.mutedForeground, marginBottom: 0 }]}>{"Website: "}<B>msafirikenya.com</B></Text>
      </View>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        {"We aim to respond to all privacy-related requests within "}<B>14 business days</B>{"."}</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  effectiveDate: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 16 },
  intro: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 24, marginBottom: 16 },
  h2: {
    fontSize: 15, fontFamily: "Inter_700Bold",
    marginTop: 28, marginBottom: 10,
    paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  h3: { fontSize: 14, fontFamily: "Inter_700Bold", marginTop: 18, marginBottom: 6 },
  p: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22, marginBottom: 10 },
  bold: { fontFamily: "Inter_600SemiBold" },
  listRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 6, paddingRight: 8 },
  bullet: { fontSize: 14, lineHeight: 22, marginRight: 8, width: 12 },
  listText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  callout: { borderRadius: 12, padding: 14, marginVertical: 12, borderWidth: 1 },
});
