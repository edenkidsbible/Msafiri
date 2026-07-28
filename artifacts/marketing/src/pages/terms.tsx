import { LegalLayout } from "@/components/legal-layout";

const S = {
  intro: { fontSize: "1.0625rem", lineHeight: "1.8", color: "hsl(var(--muted-foreground))", marginBottom: "2rem" } as React.CSSProperties,
  h2: { fontSize: "1.25rem", fontWeight: 700, color: "hsl(var(--primary))", marginTop: "3rem", marginBottom: "0.75rem", paddingBottom: "0.5rem", borderBottom: "1px solid hsl(var(--border) / 0.4)" } as React.CSSProperties,
  h3: { fontSize: "1rem", fontWeight: 700, color: "hsl(var(--primary) / 0.85)", marginTop: "1.75rem", marginBottom: "0.5rem" } as React.CSSProperties,
  p: { fontSize: "0.9375rem", lineHeight: "1.8", color: "hsl(var(--muted-foreground))", marginBottom: "1rem" } as React.CSSProperties,
  ul: { paddingLeft: "1.5rem", marginBottom: "1rem", listStyleType: "disc" } as React.CSSProperties,
  li: { fontSize: "0.9375rem", lineHeight: "1.8", color: "hsl(var(--muted-foreground))", marginBottom: "0.375rem" } as React.CSSProperties,
  bold: { fontWeight: 600, color: "hsl(var(--foreground))" } as React.CSSProperties,
  callout: { background: "hsl(var(--card))", border: "1px solid hsl(var(--border) / 0.5)", borderRadius: "0.5rem", padding: "1rem 1.25rem", marginBottom: "1rem" } as React.CSSProperties,
  warning: { background: "hsl(var(--primary) / 0.08)", border: "1px solid hsl(var(--primary) / 0.3)", borderRadius: "0.5rem", padding: "1rem 1.25rem", marginBottom: "1rem" } as React.CSSProperties,
};

export default function Terms() {
  return (
    <LegalLayout
      badge="Legal"
      title="Terms & Conditions"
      effectiveDate="July 28, 2026"
      lastUpdated="July 28, 2026"
    >
      <p style={S.intro}>
        Welcome to Msafiri. These Terms and Conditions ("Terms") govern your access to and use of the
        Msafiri mobile application ("App"), operated by Msafiri Kenya ("we," "our," or "us"). By
        downloading, installing, or using the App, you agree to be bound by these Terms. If you do not
        agree, do not use the App.
      </p>

      {/* 1 */}
      <h2 style={S.h2}>1. Acknowledgement</h2>
      <p style={S.p}>
        This agreement is between you and Msafiri Kenya — <span style={S.bold}>not</span> with Apple Inc.
        ("Apple") or Google LLC ("Google"). Msafiri Kenya, not Apple or Google, is solely responsible for
        the App and all content, functionality, and services provided through it.
      </p>
      <p style={S.p}>
        Apple and Google are not parties to these Terms and have no obligation whatsoever to provide any
        maintenance, support, warranty, or other services with respect to the App. Nothing in these Terms
        may conflict with the Apple Media Services Terms and Conditions or Google Play Terms of Service
        as applicable.
      </p>
      <p style={S.p}>
        If you are a parent or legal guardian accepting these Terms on behalf of a minor, you accept full
        responsibility for the minor's use of the App and agree to these Terms on their behalf.
      </p>

      {/* 2 */}
      <h2 style={S.h2}>2. Eligibility</h2>
      <p style={S.p}>
        You must be at least <span style={S.bold}>13 years old</span> to use Msafiri (or 16 in certain
        jurisdictions where required by applicable law, including the EU). By using the App, you represent
        and warrant that you meet the applicable age requirement.
      </p>
      <p style={S.p}>
        If you are between 13 and 17 years of age, you confirm that you have obtained parental or guardian
        consent to use the App. The SOS emergency feature and Live Trip Sharing should only be used with
        the knowledge and approval of a parent or guardian.
      </p>

      {/* 3 */}
      <h2 style={S.h2}>3. License Grant</h2>
      <p style={S.p}>
        Subject to these Terms, Msafiri Kenya grants you a <span style={S.bold}>limited, non-exclusive,
        non-transferable, revocable licence</span> to download and use the App on a device that you own or
        control, solely for your personal, non-commercial use.
      </p>
      <p style={S.p}>You may not:</p>
      <ul style={S.ul}>
        <li style={S.li}>Copy, modify, distribute, sell, or lease any part of the App.</li>
        <li style={S.li}>Reverse engineer, decompile, or attempt to extract the source code of the App, except where permitted by applicable law.</li>
        <li style={S.li}>Remove, obscure, or alter any proprietary notices or labels on the App.</li>
        <li style={S.li}>Use the App to build a competing product or service.</li>
        <li style={S.li}>Use automated scripts, bots, or scraping tools to access the App or our API.</li>
      </ul>

      {/* 4 */}
      <h2 style={S.h2}>4. Acceptable Use</h2>
      <p style={S.p}>You agree to use the App only for lawful purposes. You must not use the App to:</p>
      <ul style={S.ul}>
        <li style={S.li}>Submit false, misleading, or fabricated road reports.</li>
        <li style={S.li}>Deliberately flood our system with spam reports ("report spamming") to disrupt service for other users.</li>
        <li style={S.li}>Abuse the SOS feature by sending emergency messages when no emergency exists — this wastes emergency responder resources and may be illegal under Kenyan law.</li>
        <li style={S.li}>Share Live Trip Sharing links with malicious intent or to facilitate surveillance of another person without their consent.</li>
        <li style={S.li}>Interfere with or disrupt the integrity or performance of the App, its servers, or networks connected to it.</li>
        <li style={S.li}>Attempt to gain unauthorised access to any portion of the App, our servers, our admin systems, or any system or network connected to Msafiri.</li>
        <li style={S.li}>Violate any applicable local, national, or international laws or regulations, including Kenyan traffic laws.</li>
        <li style={S.li}>Impersonate any person or entity or misrepresent your affiliation with any person or entity.</li>
      </ul>
      <p style={S.p}>
        We reserve the right to block access to the App from any device ID that we reasonably believe is
        engaging in abusive behaviour, without prior notice.
      </p>

      {/* 5 */}
      <h2 style={S.h2}>5. Msafiri Pro Subscription</h2>

      <h3 style={S.h3}>5.1 Subscription Plans</h3>
      <p style={S.p}>
        Msafiri offers a premium subscription tier, <span style={S.bold}>Msafiri Pro</span>, which unlocks
        additional features. Current pricing is:
      </p>
      <ul style={S.ul}>
        <li style={S.li}><span style={S.bold}>Weekly plan:</span> KES 100 per week, with a 3-day free trial for new subscribers.</li>
        <li style={S.li}><span style={S.bold}>Monthly plan:</span> KES 300 per month, with a 3-day free trial for new subscribers.</li>
        <li style={S.li}>Other subscription durations (annual, etc.) may be offered from time to time as listed in the App.</li>
      </ul>
      <p style={S.p}>
        Pricing may change. We will give you at least 30 days' notice of any price increase before it
        takes effect. Continued use after the price change constitutes your acceptance of the new price.
      </p>

      <h3 style={S.h3}>5.2 Free Trial</h3>
      <p style={S.p}>
        New subscribers may be eligible for a <span style={S.bold}>3-day free trial</span>. The free trial
        automatically converts to a paid subscription at the end of the trial period unless you cancel
        before the trial ends. Free trial eligibility is determined by Apple or Google and is generally
        limited to one trial per account.
      </p>

      <h3 style={S.h3}>5.3 Billing and Renewal</h3>
      <p style={S.p}>
        Subscriptions are billed through the <span style={S.bold}>Apple App Store</span> or
        <span style={S.bold}> Google Play Store</span> and managed via RevenueCat. Your subscription
        automatically renews at the end of each billing period unless you cancel at least 24 hours before
        the renewal date.
      </p>
      <ul style={S.ul}>
        <li style={S.li}>You will be charged through your App Store or Google Play account.</li>
        <li style={S.li}>Renewal charges occur within 24 hours prior to the end of the current period.</li>
        <li style={S.li}>You can manage and cancel your subscription in your App Store or Google Play account settings.</li>
      </ul>

      <h3 style={S.h3}>5.4 Cancellation and Refunds</h3>
      <p style={S.p}>
        You may cancel your Msafiri Pro subscription at any time. Cancellation stops future billing;
        you retain Pro access until the end of the current billing period. We do not provide partial
        refunds for unused subscription time.
      </p>
      <p style={S.p}>
        Refund requests for App Store purchases must be submitted directly to Apple at
        reportaproblem.apple.com. Refund requests for Google Play purchases must be submitted to Google
        at play.google.com/store/account. We cannot process refunds on behalf of Apple or Google.
      </p>

      <h3 style={S.h3}>5.5 Changes to Pro Features</h3>
      <p style={S.p}>
        We reserve the right to modify, add, or remove features included in Msafiri Pro at any time.
        Material reductions in Pro features will be communicated in advance. If a material feature you
        paid for is removed, you may cancel your subscription and request a pro-rated refund within
        14 days of the change.
      </p>

      {/* 6 */}
      <h2 style={S.h2}>6. Community Road Reports</h2>
      <p style={S.p}>
        By submitting a community road report through the App, you grant Msafiri Kenya a
        <span style={S.bold}> worldwide, royalty-free, non-exclusive licence</span> to use, aggregate,
        display, and distribute that report (in anonymised form) to other users of the App for road
        safety purposes.
      </p>
      <p style={S.p}>You represent and warrant that:</p>
      <ul style={S.ul}>
        <li style={S.li}>All reports you submit are truthful and based on your genuine observation.</li>
        <li style={S.li}>You will not submit reports that are false, misleading, or intended to deceive other drivers.</li>
        <li style={S.li}>You will not submit reports for commercial gain or to harass specific individuals or law enforcement officers.</li>
      </ul>
      <p style={S.p}>
        Msafiri does not guarantee the accuracy, completeness, or timeliness of community reports.
        Reports are automatically expired after a set period. You should always rely on official road
        signage and obey all applicable traffic laws regardless of what the App displays.
      </p>

      {/* 7 */}
      <h2 style={S.h2}>7. Navigation and Route Guidance</h2>
      <div style={S.warning}>
        <p style={{ ...S.p, marginBottom: 0 }}>
          <span style={S.bold}>Turn-by-turn navigation in Msafiri is a supplemental driving aid only.</span> Always
          follow official road signs, traffic signals, and the instructions of traffic officers. Do not
          follow in-app navigation directions if they appear to conflict with posted signage or road
          conditions.
        </p>
      </div>
      <ul style={S.ul}>
        <li style={S.li}>Route data is sourced from OpenStreetMap and calculated by OSRM. Routes may be incorrect, outdated, or unavailable in areas with poor map coverage.</li>
        <li style={S.li}>GPS accuracy limitations mean the App may temporarily show you off-route or suggest incorrect turns. Always use your own judgement.</li>
        <li style={S.li}>Estimated arrival times are calculated based on distance and speed; they do not account for traffic conditions, road works, or other delays unless reported by the community.</li>
        <li style={S.li}>Voice guidance instructions are computer-generated and may occasionally mispronounce road names or give imprecise timing. Road names sourced from OpenStreetMap data.</li>
        <li style={S.li}>We are not responsible for any consequences — including fines, accidents, fuel costs, or delays — arising from following in-app navigation directions.</li>
      </ul>

      {/* 8 */}
      <h2 style={S.h2}>8. Live Trip Sharing</h2>
      <p style={S.p}>
        Msafiri allows you to share a live trip link so trusted contacts can follow your journey in real time.
      </p>
      <ul style={S.ul}>
        <li style={S.li}><span style={S.bold}>You control who sees your location.</span> The trip link is generated by you and shared at your discretion. Msafiri does not share your link with anyone on your behalf.</li>
        <li style={S.li}>Trip links expire automatically after <span style={S.bold}>24 hours</span> or when you stop sharing, whichever is sooner.</li>
        <li style={S.li}>Do not share your trip link publicly or with people you do not trust — anyone with the link can view your real-time position while sharing is active.</li>
        <li style={S.li}>You may stop sharing at any time by tapping Stop Sharing in the App. Location transmission ceases immediately upon stopping.</li>
        <li style={S.li}>We are not responsible for any consequences arising from you sharing a trip link with an unintended party.</li>
      </ul>

      {/* 9 */}
      <h2 style={S.h2}>9. Driver Safety Course</h2>
      <p style={S.p}>
        Msafiri includes an in-app <span style={S.bold}>Driver Safety Course</span> covering Kenyan road rules,
        NTSA speed regulations, and safe driving practices.
      </p>
      <ul style={S.ul}>
        <li style={S.li}>Course content is <span style={S.bold}>educational and informational only</span>. Completing the course does not constitute official NTSA training, certification, or licensing.</li>
        <li style={S.li}>While we strive to keep course content aligned with current Kenyan traffic laws (including LN 161/2016 speed regulations), we do not guarantee that content reflects the most recent legislative changes. Always consult official NTSA resources for authoritative information.</li>
        <li style={S.li}>Course audio is generated using AI text-to-speech technology. Content accuracy is our responsibility; audio generation is provided by ElevenLabs.</li>
        <li style={S.li}>Course progress is stored locally on your device. We do not transmit or store your course completion status on our servers.</li>
      </ul>

      {/* 10 */}
      <h2 style={S.h2}>10. SOS Emergency Feature</h2>
      <div style={S.warning}>
        <p style={{ ...S.p, marginBottom: 0 }}>
          <span style={S.bold}>The SOS feature is intended for genuine emergencies only.</span> Misuse of
          this feature — including sending false emergency messages — may constitute a criminal offence
          under Kenyan law and could result in termination of your access to the App.
        </p>
      </div>
      <p style={S.p}>
        The SOS feature composes an emergency message with your GPS location and opens your device's
        native SMS app for you to review and send to pre-configured contacts. You are solely responsible for:
      </p>
      <ul style={S.ul}>
        <li style={S.li}>Ensuring your emergency contacts are correctly entered in the App.</li>
        <li style={S.li}>Ensuring your device has sufficient SMS credit or connectivity to send the message.</li>
        <li style={S.li}>Standard SMS charges from your mobile carrier may apply when sending emergency messages.</li>
      </ul>
      <p style={S.p}>
        Msafiri Kenya is not responsible for any failure to deliver SOS messages. The SOS feature is a
        supplemental safety tool and is not a substitute for calling emergency services
        (<span style={S.bold}>999 in Kenya</span>).
      </p>

      {/* 11 */}
      <h2 style={S.h2}>11. Road Safety Disclaimer</h2>
      <div style={S.warning}>
        <p style={{ ...S.p, marginBottom: "0.5rem" }}>
          <span style={S.bold}>Msafiri is a supplemental driving awareness tool. It is not a substitute
          for safe driving practices, attention to road conditions, or compliance with Kenyan traffic laws
          and regulations.</span>
        </p>
        <p style={{ ...S.p, marginBottom: 0 }}>
          Always keep your eyes on the road. Do not operate the App while driving in a manner that
          distracts you. Use audio alerts where available. Msafiri does not guarantee the accuracy or
          completeness of any road alert, speed limit, hazard data, or navigation instruction.
        </p>
      </div>
      <ul style={S.ul}>
        <li style={S.li}>Road data displayed in the App is crowd-sourced and may be inaccurate, outdated, or incomplete.</li>
        <li style={S.li}>Speed limit information is indicative only. Always follow posted road signs.</li>
        <li style={S.li}>The App's GPS-based speed reading may differ from your vehicle's speedometer due to GPS accuracy limitations. Always refer to your vehicle's speedometer for accurate speed.</li>
        <li style={S.li}>Confidence tier labels on community reports (e.g., "Confirmed by drivers") are crowd-sourced indicators, not verified facts. A highly-rated report may still be inaccurate.</li>
        <li style={S.li}>Msafiri is not responsible for any fines, penalties, accidents, injuries, or other consequences arising from reliance on App data or navigation instructions.</li>
      </ul>

      {/* 12 */}
      <h2 style={S.h2}>12. Intellectual Property</h2>
      <p style={S.p}>
        The App and all its content — including but not limited to the Msafiri name, logo, design,
        software code, text, graphics, map overlays, and audio alerts — are the exclusive property of
        Msafiri Kenya and are protected by Kenyan and international intellectual property laws.
      </p>
      <p style={S.p}>
        Map data is sourced from OpenStreetMap contributors under the Open Database Licence (ODbL).
        Attribution: © OpenStreetMap contributors.
      </p>
      <p style={S.p}>
        Nothing in these Terms grants you any right, title, or interest in the App or its content beyond
        the limited licence described in Section 3. If you believe any content in the App infringes your
        intellectual property rights, please contact us at legal@msafirikenya.com.
      </p>

      {/* 13 */}
      <h2 style={S.h2}>13. Disclaimers and Limitation of Liability</h2>

      <h3 style={S.h3}>13.1 Disclaimer of Warranties</h3>
      <p style={S.p}>
        THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS
        OR IMPLIED. TO THE FULLEST EXTENT PERMITTED BY LAW, MSAFIRI KENYA DISCLAIMS ALL WARRANTIES,
        INCLUDING BUT NOT LIMITED TO:
      </p>
      <ul style={S.ul}>
        <li style={S.li}>Implied warranties of merchantability, fitness for a particular purpose, and non-infringement.</li>
        <li style={S.li}>Any warranty that the App will be error-free, uninterrupted, or free of viruses or other harmful components.</li>
        <li style={S.li}>Any warranty regarding the accuracy, reliability, or timeliness of road data, speed camera locations, checkpoint data, navigation directions, or any other user-generated content.</li>
      </ul>

      <h3 style={S.h3}>13.2 Limitation of Liability</h3>
      <p style={S.p}>
        TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, MSAFIRI KENYA AND ITS OFFICERS, DIRECTORS,
        EMPLOYEES, AND AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL,
        OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO:
      </p>
      <ul style={S.ul}>
        <li style={S.li}>Loss of profits, revenue, data, or goodwill.</li>
        <li style={S.li}>Traffic fines, penalties, or legal consequences arising from reliance on App data.</li>
        <li style={S.li}>Personal injury or property damage caused while using the App while driving.</li>
        <li style={S.li}>Failure of the SOS feature to deliver an emergency message.</li>
        <li style={S.li}>Incorrect navigation directions or route calculation errors.</li>
        <li style={S.li}>Service interruptions, data loss, or inaccurate road data.</li>
      </ul>
      <p style={S.p}>
        Our total liability to you for any claim arising out of or related to these Terms or the App is
        limited to the amount you paid for Msafiri Pro in the 3 months preceding the claim, or KES 1,000,
        whichever is greater.
      </p>

      {/* 14 */}
      <h2 style={S.h2}>14. Indemnification</h2>
      <p style={S.p}>
        You agree to indemnify, defend, and hold harmless Msafiri Kenya and its officers, directors,
        employees, agents, and licensors from and against any and all claims, damages, losses, costs,
        and expenses (including reasonable legal fees) arising out of or relating to:
      </p>
      <ul style={S.ul}>
        <li style={S.li}>Your use of the App in violation of these Terms.</li>
        <li style={S.li}>Any road report you submit that is false or misleading.</li>
        <li style={S.li}>Misuse of the SOS emergency feature.</li>
        <li style={S.li}>Sharing a Live Trip Sharing link in a manner that causes harm to another person.</li>
        <li style={S.li}>Your violation of any applicable law or third-party rights.</li>
      </ul>

      {/* 15 */}
      <h2 style={S.h2}>15. Termination</h2>
      <p style={S.p}>
        We may suspend or terminate your access to the App at any time, with or without cause, including
        for violations of these Terms. Upon termination:
      </p>
      <ul style={S.ul}>
        <li style={S.li}>Your licence to use the App is immediately revoked.</li>
        <li style={S.li}>You remain bound by any provisions of these Terms that by their nature should survive termination (including Sections 12, 13, 14, 16, and 17).</li>
        <li style={S.li}>If you have an active Msafiri Pro subscription, we will issue a pro-rated refund for the unused portion where required by applicable law.</li>
      </ul>
      <p style={S.p}>
        You may stop using the App at any time. Deleting the App from your device terminates your use
        but does not automatically delete data we hold — see Section 6.3 of our Privacy Policy for data
        deletion instructions.
      </p>

      {/* 16 */}
      <h2 style={S.h2}>16. Governing Law</h2>
      <p style={S.p}>
        These Terms are governed by and construed in accordance with the laws of the
        <span style={S.bold}> Republic of Kenya</span>, without regard to its conflict-of-law provisions.
        You agree that any dispute arising out of or relating to these Terms or the App shall be subject
        to the exclusive jurisdiction of the courts of Kenya, unless otherwise required by applicable law
        in your country of residence.
      </p>

      {/* 17 */}
      <h2 style={S.h2}>17. Dispute Resolution</h2>
      <p style={S.p}>
        Before initiating any formal legal proceedings, you agree to first contact us at
        legal@msafirikenya.com to attempt to resolve the dispute informally. We will try to resolve
        the dispute within 30 days. If we cannot resolve it informally, either party may pursue
        formal legal proceedings.
      </p>
      <p style={S.p}>
        Notwithstanding the above, either party may seek injunctive or other equitable relief from a
        court of competent jurisdiction to prevent irreparable harm while a dispute is pending.
      </p>

      {/* 18 */}
      <h2 style={S.h2}>18. Third-Party Services and App Stores</h2>
      <p style={S.p}>
        The App integrates with third-party services including RevenueCat (subscription management),
        Google Maps (map rendering), OpenStreetMap / OSRM (routing and geocoding), ElevenLabs (voice
        guidance), and Sentry (crash reporting). Your use of these third-party services is governed by
        their own terms and conditions. Msafiri Kenya is not responsible for the acts or omissions of
        any third-party service provider.
      </p>
      <p style={S.p}>
        In the event of any conflict between these Terms and the applicable App Store terms (Apple Media
        Services Terms and Conditions or Google Play Terms of Service), the App Store terms shall
        prevail with respect to the relevant App Store's responsibilities only.
      </p>

      {/* 19 */}
      <h2 style={S.h2}>19. Modifications to These Terms</h2>
      <p style={S.p}>
        We reserve the right to modify these Terms at any time. When we make material changes, we will:
      </p>
      <ul style={S.ul}>
        <li style={S.li}>Update the "Last Updated" date at the top of this page.</li>
        <li style={S.li}>Display a prominent notice within the App.</li>
        <li style={S.li}>Where required by law, obtain your consent before the changes take effect.</li>
      </ul>
      <p style={S.p}>
        Your continued use of the App after the effective date of any changes constitutes your acceptance
        of the updated Terms.
      </p>

      {/* 20 */}
      <h2 style={S.h2}>20. Severability and Entire Agreement</h2>
      <p style={S.p}>
        If any provision of these Terms is held to be invalid or unenforceable, that provision will be
        modified to the minimum extent necessary to make it enforceable, and the remaining provisions will
        continue in full force and effect. These Terms, together with our Privacy Policy, constitute the
        entire agreement between you and Msafiri Kenya regarding the App.
      </p>

      {/* 21 */}
      <h2 style={S.h2}>21. Contact Us</h2>
      <p style={S.p}>
        If you have any questions about these Terms, please contact us:
      </p>
      <div style={S.callout}>
        <p style={{ ...S.p, marginBottom: "0.25rem" }}><span style={S.bold}>Msafiri Kenya</span></p>
        <p style={{ ...S.p, marginBottom: "0.25rem" }}>Legal enquiries: <span style={S.bold}>legal@msafirikenya.com</span></p>
        <p style={{ ...S.p, marginBottom: "0.25rem" }}>General support: <span style={S.bold}>support@msafirikenya.com</span></p>
        <p style={{ ...S.p, marginBottom: 0 }}>Website: <span style={S.bold}>msafirikenya.com</span></p>
      </div>
    </LegalLayout>
  );
}
