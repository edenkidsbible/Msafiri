import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

export default function TermsScreen() {
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
        Welcome to Msafiri. These Terms and Conditions ("Terms") govern your access to and use of the
        Msafiri mobile application ("App"), operated by Msafiri Kenya ("we," "our," or "us"). By
        downloading, installing, or using the App, you agree to be bound by these Terms. If you do not
        agree, do not use the App.
      </Text>

      {/* 1 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>1. Acknowledgement</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        {"This agreement is between you and Msafiri Kenya — "}<B>not</B>{' with Apple Inc. ("Apple") or Google LLC ("Google"). Msafiri Kenya, not Apple or Google, is solely responsible for the App and all content, functionality, and services provided through it.'}
      </Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Apple and Google are not parties to these Terms and have no obligation whatsoever to provide any
        maintenance, support, warranty, or other services with respect to the App. Nothing in these Terms
        may conflict with the Apple Media Services Terms and Conditions or Google Play Terms of Service
        as applicable.
      </Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        If you are a parent or legal guardian accepting these Terms on behalf of a minor, you accept full
        responsibility for the minor's use of the App and agree to these Terms on their behalf.
      </Text>

      {/* 2 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>2. Eligibility</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        {"You must be at least "}<B>13 years old</B>{" to use Msafiri (or 16 in certain jurisdictions where required by applicable law, including the EU). By using the App, you represent and warrant that you meet the applicable age requirement."}
      </Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        If you are between 13 and 17 years of age, you confirm that you have obtained parental or guardian
        consent to use the App. The SOS emergency feature and Live Trip Sharing should only be used with
        the knowledge and approval of a parent or guardian.
      </Text>

      {/* 3 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>3. License Grant</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        {"Subject to these Terms, Msafiri Kenya grants you a "}<B>limited, non-exclusive, non-transferable, revocable licence</B>{" to download and use the App on a device that you own or control, solely for your personal, non-commercial use."}
      </Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>{"You may not:"}</Text>
      <Li>{"Copy, modify, distribute, sell, or lease any part of the App."}</Li>
      <Li>{"Reverse engineer, decompile, or attempt to extract the source code of the App, except where permitted by applicable law."}</Li>
      <Li>{"Remove, obscure, or alter any proprietary notices or labels on the App."}</Li>
      <Li>{"Use the App to build a competing product or service."}</Li>
      <Li>{"Use automated scripts, bots, or scraping tools to access the App or our API."}</Li>

      {/* 4 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>4. Acceptable Use</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>{"You agree to use the App only for lawful purposes. You must not use the App to:"}</Text>
      <Li>{"Submit false, misleading, or fabricated road reports."}</Li>
      <Li>{"Deliberately flood our system with spam reports (\"report spamming\") to disrupt service for other users."}</Li>
      <Li>{"Abuse the SOS feature by sending emergency messages when no emergency exists — this wastes emergency responder resources and may be illegal under Kenyan law."}</Li>
      <Li>{"Share Live Trip Sharing links with malicious intent or to facilitate surveillance of another person without their consent."}</Li>
      <Li>{"Interfere with or disrupt the integrity or performance of the App, its servers, or networks connected to it."}</Li>
      <Li>{"Attempt to gain unauthorised access to any portion of the App, our servers, our admin systems, or any system or network connected to Msafiri."}</Li>
      <Li>{"Violate any applicable local, national, or international laws or regulations, including Kenyan traffic laws."}</Li>
      <Li>{"Impersonate any person or entity or misrepresent your affiliation with any person or entity."}</Li>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        We reserve the right to block access to the App from any device ID that we reasonably believe is
        engaging in abusive behaviour, without prior notice.
      </Text>

      {/* 5 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>5. Msafiri Pro Subscription</Text>

      <Text style={[s.h3, { color: c.primary }]}>5.1 Subscription Plans</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        {"Msafiri offers a premium subscription tier, "}<B>Msafiri Pro</B>{", which unlocks additional features. Current pricing is:"}
      </Text>
      <Li><B>Weekly plan:</B>{" KES 100 per week, with a 3-day free trial for new subscribers."}</Li>
      <Li><B>Monthly plan:</B>{" KES 300 per month, with a 3-day free trial for new subscribers."}</Li>
      <Li>{"Other subscription durations may be offered from time to time as listed in the App."}</Li>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Pricing may change. We will give you at least 30 days' notice of any price increase before it
        takes effect.
      </Text>

      <Text style={[s.h3, { color: c.primary }]}>5.2 Free Trial</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        {"New subscribers may be eligible for a "}<B>3-day free trial</B>{". The free trial automatically converts to a paid subscription at the end of the trial period unless you cancel before the trial ends. Free trial eligibility is determined by Apple or Google and is generally limited to one trial per account — reinstalling the App does not grant an additional trial."}
      </Text>

      <Text style={[s.h3, { color: c.primary }]}>5.3 Billing and Renewal</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        {"Subscriptions are billed through the "}<B>Apple App Store</B>{" or "}<B>Google Play Store</B>{" and managed via RevenueCat. Your subscription automatically renews at the end of each billing period unless you cancel at least 24 hours before the renewal date."}
      </Text>
      <Li>{"You will be charged through your App Store or Google Play account."}</Li>
      <Li>{"Renewal charges occur within 24 hours prior to the end of the current period."}</Li>
      <Li>{"You can manage and cancel your subscription in your App Store or Google Play account settings."}</Li>

      <Text style={[s.h3, { color: c.primary }]}>5.4 Cancellation and Refunds</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        You may cancel your Msafiri Pro subscription at any time. Cancellation stops future billing;
        you retain Pro access until the end of the current billing period. We do not provide partial
        refunds for unused subscription time.
      </Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Refund requests for App Store purchases must be submitted directly to Apple at
        reportaproblem.apple.com. Refund requests for Google Play purchases must be submitted to Google
        at play.google.com/store/account. We cannot process refunds on behalf of Apple or Google.
      </Text>

      <Text style={[s.h3, { color: c.primary }]}>5.5 Changes to Pro Features</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        We reserve the right to modify, add, or remove features included in Msafiri Pro at any time.
        Material reductions in Pro features will be communicated in advance. If a material feature you
        paid for is removed, you may cancel your subscription and request a pro-rated refund within
        14 days of the change.
      </Text>

      {/* 6 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>6. Community Road Reports</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        {"By submitting a community road report through the App, you grant Msafiri Kenya a "}<B>worldwide, royalty-free, non-exclusive licence</B>{" to use, aggregate, display, and distribute that report (in anonymised form) to other users of the App for road safety purposes."}
      </Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>{"You represent and warrant that:"}</Text>
      <Li>{"All reports you submit are truthful and based on your genuine observation."}</Li>
      <Li>{"You will not submit reports that are false, misleading, or intended to deceive other drivers."}</Li>
      <Li>{"You will not submit reports for commercial gain or to harass specific individuals or law enforcement officers."}</Li>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Msafiri does not guarantee the accuracy, completeness, or timeliness of community reports.
        Reports are automatically expired after a set period. You should always rely on official road
        signage and obey all applicable traffic laws regardless of what the App displays.
      </Text>

      {/* 7 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>7. Navigation and Route Guidance</Text>
      <View style={[s.warning, { backgroundColor: c.primary + "14", borderColor: c.primary + "4D" }]}>
        <Text style={[s.p, { color: c.foreground, marginBottom: 0 }]}>
          <B>Turn-by-turn navigation in Msafiri is a supplemental driving aid only.</B>{" Always follow official road signs, traffic signals, and the instructions of traffic officers. Do not follow in-app navigation directions if they appear to conflict with posted signage or road conditions."}
        </Text>
      </View>
      <Li>{"Route data is sourced from OpenStreetMap and calculated by Mapbox. Routes may be incorrect, outdated, or unavailable in areas with poor map coverage."}</Li>
      <Li>{"GPS accuracy limitations mean the App may temporarily show you off-route or suggest incorrect turns. Always use your own judgement."}</Li>
      <Li>{"Estimated arrival times are calculated based on distance and speed and do not fully account for traffic conditions."}</Li>
      <Li>{"Voice guidance instructions are computer-generated and may occasionally mispronounce road names or give imprecise timing."}</Li>
      <Li>{"We are not responsible for any consequences — including fines, accidents, fuel costs, or delays — arising from following in-app navigation directions."}</Li>

      {/* 8 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>8. Live Trip Sharing</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Msafiri allows you to share a live trip link so trusted contacts can follow your journey in
        real time.
      </Text>
      <Li><B>You control who sees your location.</B>{" The trip link is generated by you and shared at your discretion. Msafiri does not share your link with anyone on your behalf."}</Li>
      <Li>{"Trip links expire automatically after "}<B>24 hours</B>{" or when you stop sharing, whichever is sooner."}</Li>
      <Li>{"Do not share your trip link publicly or with people you do not trust — anyone with the link can view your real-time position while sharing is active."}</Li>
      <Li>{"You may stop sharing at any time by tapping Stop Sharing in the App. Location transmission ceases immediately."}</Li>
      <Li>{"We are not responsible for any consequences arising from sharing a trip link with an unintended party."}</Li>

      {/* 9 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>9. Driver Safety Course</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        {"Msafiri includes an in-app "}<B>Driver Safety Course</B>{" covering Kenyan road rules, NTSA speed regulations, and safe driving practices."}
      </Text>
      <Li>{"Course content is "}<B>educational and informational only</B>{". Completing the course does not constitute official NTSA training, certification, or licensing."}</Li>
      <Li>{"While we strive to keep course content aligned with current Kenyan traffic laws (including LN 161/2016 speed regulations), we do not guarantee that content reflects the most recent legislative changes. Always consult official NTSA resources for authoritative information."}</Li>
      <Li>{"Course audio is generated using AI text-to-speech technology (ElevenLabs). Content accuracy is our responsibility; audio generation is provided by ElevenLabs."}</Li>
      <Li>{"Course progress is stored locally on your device. We do not transmit or store your course completion status on our servers."}</Li>

      {/* 10 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>10. SOS Emergency Feature</Text>
      <View style={[s.warning, { backgroundColor: c.primary + "14", borderColor: c.primary + "4D" }]}>
        <Text style={[s.p, { color: c.foreground, marginBottom: 0 }]}>
          <B>The SOS feature is intended for genuine emergencies only.</B>{" Misuse of this feature — including sending false emergency messages — may constitute a criminal offence under Kenyan law and could result in termination of your access to the App."}
        </Text>
      </View>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        The SOS feature composes an emergency message with your GPS location and opens your device's
        native SMS app for you to review and send to pre-configured contacts. You are solely responsible for:
      </Text>
      <Li>{"Ensuring your emergency contacts are correctly entered in the App."}</Li>
      <Li>{"Ensuring your device has sufficient SMS credit or connectivity to send the message."}</Li>
      <Li>{"Standard SMS charges from your mobile carrier may apply when sending emergency messages."}</Li>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Msafiri Kenya is not responsible for any failure to deliver SOS messages. The SOS feature is a
        supplemental safety tool and is not a substitute for calling emergency services{" "}
        (<B>999 in Kenya</B>).
      </Text>

      {/* 11 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>11. Road Safety Disclaimer</Text>
      <View style={[s.warning, { backgroundColor: c.primary + "14", borderColor: c.primary + "4D" }]}>
        <Text style={[s.p, { color: c.foreground, marginBottom: 8 }]}>
          <B>Msafiri is a supplemental driving awareness tool. It is not a substitute for safe driving practices, attention to road conditions, or compliance with Kenyan traffic laws and regulations.</B>
        </Text>
        <Text style={[s.p, { color: c.foreground, marginBottom: 0 }]}>
          Always keep your eyes on the road. Do not operate the App while driving in a manner that
          distracts you. Use audio alerts where available. Msafiri does not guarantee the accuracy or
          completeness of any road alert, speed limit, hazard data, or navigation instruction.
        </Text>
      </View>
      <Li>{"Road data displayed in the App is crowd-sourced and may be inaccurate, outdated, or incomplete."}</Li>
      <Li>{"Speed limit information is indicative only. Always follow posted road signs."}</Li>
      <Li>{"The App's GPS-based speed reading may differ from your vehicle's speedometer due to GPS accuracy limitations. Always refer to your vehicle's speedometer for accurate speed."}</Li>
      <Li>{"Confidence tier labels on community reports (e.g., \"Confirmed by drivers\") are crowd-sourced indicators, not verified facts."}</Li>
      <Li>{"Msafiri is not responsible for any fines, penalties, accidents, injuries, or other consequences arising from reliance on App data or navigation instructions."}</Li>

      {/* 12 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>12. Intellectual Property</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        The App and all its content — including but not limited to the Msafiri name, logo, design,
        software code, text, graphics, map overlays, and audio alerts — are the exclusive property of
        Msafiri Kenya and are protected by Kenyan and international intellectual property laws.
      </Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Map data is sourced from OpenStreetMap contributors under the Open Database Licence (ODbL).
        Attribution: © OpenStreetMap contributors.
      </Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Nothing in these Terms grants you any right, title, or interest in the App or its content beyond
        the limited licence described in Section 3. If you believe any content in the App infringes your
        intellectual property rights, please contact us at legal@msafirikenya.com.
      </Text>

      {/* 13 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>13. Disclaimers and Limitation of Liability</Text>

      <Text style={[s.h3, { color: c.primary }]}>13.1 Disclaimer of Warranties</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS
        OR IMPLIED. TO THE FULLEST EXTENT PERMITTED BY LAW, MSAFIRI KENYA DISCLAIMS ALL WARRANTIES,
        INCLUDING BUT NOT LIMITED TO:
      </Text>
      <Li>{"Implied warranties of merchantability, fitness for a particular purpose, and non-infringement."}</Li>
      <Li>{"Any warranty that the App will be error-free, uninterrupted, or free of viruses or other harmful components."}</Li>
      <Li>{"Any warranty regarding the accuracy, reliability, or timeliness of road data, speed camera locations, checkpoint data, navigation directions, or any other user-generated content."}</Li>

      <Text style={[s.h3, { color: c.primary }]}>13.2 Limitation of Liability</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, MSAFIRI KENYA AND ITS OFFICERS, DIRECTORS,
        EMPLOYEES, AND AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL,
        OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO:
      </Text>
      <Li>{"Loss of profits, revenue, data, or goodwill."}</Li>
      <Li>{"Traffic fines, penalties, or legal consequences arising from reliance on App data."}</Li>
      <Li>{"Personal injury or property damage caused while using the App while driving."}</Li>
      <Li>{"Failure of the SOS feature to deliver an emergency message."}</Li>
      <Li>{"Incorrect navigation directions or route calculation errors."}</Li>
      <Li>{"Service interruptions, data loss, or inaccurate road data."}</Li>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Our total liability to you for any claim arising out of or related to these Terms or the App is
        limited to the amount you paid for Msafiri Pro in the 3 months preceding the claim, or KES 1,000,
        whichever is greater.
      </Text>

      {/* 14 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>14. Indemnification</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        You agree to indemnify, defend, and hold harmless Msafiri Kenya and its officers, directors,
        employees, agents, and licensors from and against any and all claims, damages, losses, costs,
        and expenses (including reasonable legal fees) arising out of or relating to:
      </Text>
      <Li>{"Your use of the App in violation of these Terms."}</Li>
      <Li>{"Any road report you submit that is false or misleading."}</Li>
      <Li>{"Misuse of the SOS emergency feature."}</Li>
      <Li>{"Sharing a Live Trip Sharing link in a manner that causes harm to another person."}</Li>
      <Li>{"Your violation of any applicable law or third-party rights."}</Li>

      {/* 15 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>15. Termination</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        We may suspend or terminate your access to the App at any time, with or without cause, including
        for violations of these Terms. Upon termination:
      </Text>
      <Li>{"Your licence to use the App is immediately revoked."}</Li>
      <Li>{"You remain bound by any provisions of these Terms that by their nature should survive termination (including Sections 12, 13, 14, 16, and 17)."}</Li>
      <Li>{"If you have an active Msafiri Pro subscription, we will issue a pro-rated refund for the unused portion where required by applicable law."}</Li>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        You may stop using the App at any time. Deleting the App from your device terminates your use
        but does not automatically delete data we hold — see Section 6.3 of our Privacy Policy for data
        deletion instructions.
      </Text>

      {/* 16 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>16. Governing Law</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        {"These Terms are governed by and construed in accordance with the laws of the "}<B>Republic of Kenya</B>{", without regard to its conflict-of-law provisions. You agree that any dispute arising out of or relating to these Terms or the App shall be subject to the exclusive jurisdiction of the courts of Kenya, unless otherwise required by applicable law in your country of residence."}
      </Text>

      {/* 17 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>17. Dispute Resolution</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Before initiating any formal legal proceedings, you agree to first contact us at
        legal@msafirikenya.com to attempt to resolve the dispute informally. We will try to resolve
        the dispute within 30 days. If we cannot resolve it informally, either party may pursue
        formal legal proceedings.
      </Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Notwithstanding the above, either party may seek injunctive or other equitable relief from a
        court of competent jurisdiction to prevent irreparable harm while a dispute is pending.
      </Text>

      {/* 18 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>18. Third-Party Services and App Stores</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        The App integrates with third-party services including RevenueCat (subscription management),
        Google Maps (map rendering), Mapbox (navigation routing), OpenStreetMap (geocoding),
        ElevenLabs (course audio), and Sentry (crash reporting). Your use of these third-party services is governed by
        their own terms and conditions. Msafiri Kenya is not responsible for the acts or omissions of
        any third-party service provider.
      </Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        In the event of any conflict between these Terms and the applicable App Store terms (Apple Media
        Services Terms and Conditions or Google Play Terms of Service), the App Store terms shall
        prevail with respect to the relevant App Store's responsibilities only.
      </Text>

      {/* 19 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>19. Modifications to These Terms</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        We reserve the right to modify these Terms at any time. When we make material changes, we will:
      </Text>
      <Li>{"Update the \"Last Updated\" date at the top of this page."}</Li>
      <Li>{"Display a prominent notice within the App."}</Li>
      <Li>{"Where required by law, obtain your consent before the changes take effect."}</Li>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        Your continued use of the App after the effective date of any changes constitutes your acceptance
        of the updated Terms. If you do not agree with the changes, you must stop using the App and, if
        applicable, cancel your Msafiri Pro subscription.
      </Text>

      {/* 20 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>20. Severability and Entire Agreement</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        If any provision of these Terms is held to be invalid or unenforceable, that provision will be
        modified to the minimum extent necessary to make it enforceable, and the remaining provisions will
        continue in full force and effect. These Terms, together with our Privacy Policy, constitute the
        entire agreement between you and Msafiri Kenya regarding the App and supersede all prior
        agreements and understandings.
      </Text>

      {/* 21 */}
      <Text style={[s.h2, { color: c.primary, borderBottomColor: c.border }]}>21. Contact Us</Text>
      <Text style={[s.p, { color: c.mutedForeground }]}>
        If you have any questions about these Terms, please contact us:
      </Text>
      <View style={[s.callout, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[s.p, { color: c.mutedForeground, marginBottom: 4 }]}><B>Msafiri Kenya</B></Text>
        <Text style={[s.p, { color: c.mutedForeground, marginBottom: 4 }]}>{"Legal enquiries: "}<B>legal@msafirikenya.com</B></Text>
        <Text style={[s.p, { color: c.mutedForeground, marginBottom: 4 }]}>{"General support: "}<B>support@msafirikenya.com</B></Text>
        <Text style={[s.p, { color: c.mutedForeground, marginBottom: 0 }]}>{"Website: "}<B>msafirikenya.com</B></Text>
      </View>
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
  warning: { borderRadius: 12, padding: 14, marginVertical: 12, borderWidth: 1 },
});
