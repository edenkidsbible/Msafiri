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
};

export default function Privacy() {
  return (
    <LegalLayout
      badge="Legal"
      title="Privacy Policy"
      effectiveDate="June 30, 2026"
      lastUpdated="June 30, 2026"
    >
      <p style={S.intro}>
        Msafiri Kenya ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy
        explains what information we collect, how we use it, how long we retain it, and your rights as a
        user. This policy applies to our mobile application ("App") available on iOS (Apple App Store)
        and Android (Google Play Store), as well as the msafirikenya.com website.
      </p>
      <p style={S.intro}>
        By downloading, installing, or using Msafiri, you agree to the collection and use of information
        in accordance with this Privacy Policy. If you do not agree, please do not use the App.
      </p>

      {/* 1 */}
      <h2 style={S.h2}>1. Information We Collect</h2>
      <p style={S.p}>We collect the following categories of information:</p>

      <h3 style={S.h3}>1.1 Precise Location Data</h3>
      <p style={S.p}>
        Location data is the core function of Msafiri. With your permission, we collect:
      </p>
      <ul style={S.ul}>
        <li style={S.li}><span style={S.bold}>GPS coordinates (latitude and longitude)</span> — used in real time to calculate your speed, detect nearby speed cameras, police checkpoints, and speed zones.</li>
        <li style={S.li}><span style={S.bold}>Location when the app is in use ("When In Use")</span> — collected while you have the app open and are actively driving.</li>
        <li style={S.li}><span style={S.bold}>Background location ("Always")</span> — optionally collected when you enable background driving mode, so alerts continue while the screen is off. You may revoke this at any time in your device Settings.</li>
        <li style={S.li}><span style={S.bold}>Location at time of SOS</span> — a single GPS coordinate is included in emergency SMS messages sent via the SOS feature.</li>
      </ul>
      <div style={S.callout}>
        <p style={{ ...S.p, marginBottom: 0 }}>
          <span style={S.bold}>Important:</span> Your precise location is processed on-device in real time and is not transmitted to our servers for the purpose of speed calculation or alert generation. Location data is only transmitted when you submit a community road report or trigger the SOS feature.
        </p>
      </div>

      <h3 style={S.h3}>1.2 Device and Technical Information</h3>
      <ul style={S.ul}>
        <li style={S.li}><span style={S.bold}>Device identifier (device ID)</span> — a unique anonymous identifier assigned to your device. Msafiri does not require account registration; your device ID is used in place of a user account.</li>
        <li style={S.li}><span style={S.bold}>Operating system and version</span> — iOS or Android version for compatibility and bug-fix purposes.</li>
        <li style={S.li}><span style={S.bold}>App version</span> — to ensure you receive feature-compatible responses from our API.</li>
        <li style={S.li}><span style={S.bold}>Network type</span> — Wi-Fi or mobile data, used solely for optimising data usage.</li>
      </ul>

      <h3 style={S.h3}>1.3 Community Road Reports</h3>
      <p style={S.p}>
        When you submit a road report (e.g., speed camera, police checkpoint, speed zone, road hazard), we collect:
      </p>
      <ul style={S.ul}>
        <li style={S.li}>The <span style={S.bold}>type of report</span> (e.g., speed camera, checkpoint).</li>
        <li style={S.li}>The <span style={S.bold}>GPS coordinates</span> at the time of submission.</li>
        <li style={S.li}>The <span style={S.bold}>timestamp</span> of the report.</li>
        <li style={S.li}>Your <span style={S.bold}>device ID</span> (to prevent spam and enable report editing).</li>
        <li style={S.li}>Confirmation or denial votes submitted by other users for that report.</li>
      </ul>
      <p style={S.p}>
        Reports are shared with other Msafiri users on an aggregated, anonymised basis. We do not attach
        your name, phone number, or any personally identifiable information to community reports.
      </p>

      <h3 style={S.h3}>1.4 Payment and Subscription Information (Msafiri Pro)</h3>
      <p style={S.p}>
        Msafiri Pro subscriptions are processed by <span style={S.bold}>RevenueCat</span> (our payment
        infrastructure provider) and billed through the Apple App Store or Google Play Store. We do not
        directly handle, store, or have access to your payment card details.
      </p>
      <ul style={S.ul}>
        <li style={S.li}>RevenueCat provides us with a <span style={S.bold}>non-identifiable subscriber token</span> linked to your device ID, confirming your subscription status (active, expired, or in trial).</li>
        <li style={S.li}>Apple and Google handle all payment processing under their own privacy policies.</li>
        <li style={S.li}>We retain subscription status data for as long as your account is active, plus a reasonable period for billing dispute resolution.</li>
      </ul>

      <h3 style={S.h3}>1.5 SOS Emergency Data</h3>
      <p style={S.p}>
        If you use the SOS emergency feature, the App sends an SMS from your device using your
        device's own SMS functionality. The message includes:
      </p>
      <ul style={S.ul}>
        <li style={S.li}>A standardised emergency message ("EMERGENCY – I need help!").</li>
        <li style={S.li}>A Google Maps link containing your current GPS coordinates.</li>
      </ul>
      <p style={S.p}>
        This SMS is sent directly from your device to your nominated emergency contacts. Msafiri does
        not transmit, store, or have access to the content of these messages or the recipients' phone
        numbers. Your device's carrier may retain this data under its own privacy policy.
      </p>

      <h3 style={S.h3}>1.6 Usage and Analytics Data</h3>
      <ul style={S.ul}>
        <li style={S.li}><span style={S.bold}>App interaction logs</span> — screens visited, features used, session duration (collected anonymously via device ID only).</li>
        <li style={S.li}><span style={S.bold}>Crash reports</span> — automatic crash logs that include device model, OS version, and stack trace. These do not include location data.</li>
        <li style={S.li}><span style={S.bold}>API request logs</span> — server-side request logs including IP address, endpoint called, and timestamp, retained for up to 30 days for security and abuse monitoring.</li>
      </ul>

      {/* 2 */}
      <h2 style={S.h2}>2. How We Use Your Information</h2>
      <p style={S.p}>We use the information we collect for the following purposes:</p>
      <ul style={S.ul}>
        <li style={S.li}><span style={S.bold}>Core app functionality</span> — providing real-time speed awareness, road alert notifications, and displaying community reports on the in-app map.</li>
        <li style={S.li}><span style={S.bold}>Community report system</span> — validating, aggregating, and expiring road reports submitted by users.</li>
        <li style={S.li}><span style={S.bold}>Subscription management</span> — verifying your Msafiri Pro subscription status via RevenueCat to unlock premium features.</li>
        <li style={S.li}><span style={S.bold}>Safety features</span> — enabling the SOS emergency SMS feature to function correctly.</li>
        <li style={S.li}><span style={S.bold}>App improvement</span> — analysing anonymised usage patterns and crash data to fix bugs and improve performance.</li>
        <li style={S.li}><span style={S.bold}>Security and fraud prevention</span> — detecting and preventing spam reports, abuse, or unauthorised access to our API.</li>
        <li style={S.li}><span style={S.bold}>Legal compliance</span> — complying with applicable laws, regulations, and lawful requests from Kenyan authorities.</li>
      </ul>
      <p style={S.p}>
        <span style={S.bold}>We do not use your data for advertising, sell it to third parties, or use it to build profiles beyond what is necessary for the App's stated functionality.</span>
      </p>

      {/* 3 */}
      <h2 style={S.h2}>3. How We Share Your Information</h2>
      <p style={S.p}>We share your information only in the following limited circumstances:</p>

      <h3 style={S.h3}>3.1 With Other Msafiri Users</h3>
      <p style={S.p}>
        Community road reports you submit are shared with other users in anonymised form (report type,
        location, and timestamp only). Your device ID is never exposed to other users.
      </p>

      <h3 style={S.h3}>3.2 With Service Providers</h3>
      <ul style={S.ul}>
        <li style={S.li}><span style={S.bold}>RevenueCat</span> — for subscription management. RevenueCat processes subscription events and provides us with your subscription status. See RevenueCat's privacy policy at revenuecat.com/privacy.</li>
        <li style={S.li}><span style={S.bold}>OpenStreetMap / Nominatim</span> — for reverse geocoding (converting GPS coordinates to road names). Queries are sent with a custom User-Agent and do not include your device ID. See OpenStreetMap's privacy policy at openstreetmap.org/privacy.</li>
        <li style={S.li}><span style={S.bold}>Hosting and infrastructure providers</span> — our server infrastructure runs on cloud hosting services. These providers have access to server logs but are contractually restricted from using the data for any purpose other than providing infrastructure services.</li>
      </ul>

      <h3 style={S.h3}>3.3 For Legal Reasons</h3>
      <p style={S.p}>
        We may disclose your information if required to do so by law, court order, or governmental
        authority, or if we believe in good faith that such disclosure is necessary to protect our rights,
        protect your safety or the safety of others, or investigate fraud.
      </p>

      <h3 style={S.h3}>3.4 Business Transfers</h3>
      <p style={S.p}>
        If Msafiri Kenya is involved in a merger, acquisition, or sale of assets, your information may be
        transferred as part of that transaction. We will notify you via the App or our website before your
        information becomes subject to a different privacy policy.
      </p>

      {/* 4 */}
      <h2 style={S.h2}>4. Data Retention</h2>
      <ul style={S.ul}>
        <li style={S.li}><span style={S.bold}>Community reports</span> — retained for as long as they are active (typically 24–48 hours for most report types) and then automatically expired. Expired reports are retained in our database for up to 90 days for abuse-prevention analysis, then permanently deleted.</li>
        <li style={S.li}><span style={S.bold}>Device ID and usage logs</span> — retained for up to 12 months, after which they are permanently deleted or anonymised beyond recovery.</li>
        <li style={S.li}><span style={S.bold}>API access logs (IP addresses)</span> — retained for up to 30 days for security monitoring.</li>
        <li style={S.li}><span style={S.bold}>Subscription records</span> — retained for the duration of your subscription and for up to 12 months after cancellation for billing and legal dispute purposes.</li>
        <li style={S.li}><span style={S.bold}>Crash reports</span> — retained for up to 6 months to assist with bug resolution.</li>
      </ul>

      {/* 5 */}
      <h2 style={S.h2}>5. Data Security</h2>
      <p style={S.p}>
        We take the security of your data seriously. Our security measures include:
      </p>
      <ul style={S.ul}>
        <li style={S.li}>All data transmitted between the App and our servers is encrypted using <span style={S.bold}>TLS (Transport Layer Security)</span>.</li>
        <li style={S.li}>Our API servers are protected by authentication middleware; public endpoints are rate-limited to prevent abuse.</li>
        <li style={S.li}>Access to our production database is restricted to authorised personnel only, protected by role-based access controls.</li>
        <li style={S.li}>Admin panel access requires strong password authentication and is protected with time-limited JWT tokens.</li>
        <li style={S.li}>We do not store payment card data on our servers; all payment processing is handled by Apple, Google, and RevenueCat.</li>
      </ul>
      <p style={S.p}>
        While we implement industry-standard safeguards, no method of electronic transmission or storage
        is 100% secure. We cannot guarantee absolute security. If you believe your data has been
        compromised, please contact us immediately at privacy@msafirikenya.com.
      </p>

      {/* 6 */}
      <h2 style={S.h2}>6. Your Rights and Choices</h2>

      <h3 style={S.h3}>6.1 Location Permissions</h3>
      <p style={S.p}>
        You control location access through your device Settings at any time:
      </p>
      <ul style={S.ul}>
        <li style={S.li}><span style={S.bold}>iOS:</span> Settings &rarr; Privacy &amp; Security &rarr; Location Services &rarr; Msafiri. You can set this to "Never," "While Using," or "Always."</li>
        <li style={S.li}><span style={S.bold}>Android:</span> Settings &rarr; Apps &rarr; Msafiri &rarr; Permissions &rarr; Location. You can grant "Allow only while using the app" or "Allow all the time."</li>
      </ul>
      <p style={S.p}>
        Revoking location access will prevent core app functionality (speed display and road alerts) from working, but will not affect your subscription status.
      </p>

      <h3 style={S.h3}>6.2 Deleting Your Data</h3>
      <p style={S.p}>
        Because Msafiri does not require account registration, your data is linked only to your device ID.
        To request deletion of all data associated with your device:
      </p>
      <ul style={S.ul}>
        <li style={S.li}>Email us at <span style={S.bold}>privacy@msafirikenya.com</span> with the subject line "Data Deletion Request."</li>
        <li style={S.li}>We will delete all data tied to your device ID within <span style={S.bold}>30 days</span> of receiving your request, except where retention is required by law or for legitimate security purposes.</li>
      </ul>

      <h3 style={S.h3}>6.3 Opting Out of Analytics</h3>
      <p style={S.p}>
        You may opt out of anonymised analytics collection within the App under Settings &rarr; Privacy.
        Opting out does not affect crash reporting, which is required for app stability.
      </p>

      <h3 style={S.h3}>6.4 Subscription Cancellation</h3>
      <p style={S.p}>
        You may cancel your Msafiri Pro subscription at any time through the App Store or Google Play
        Store. Cancellation stops future billing; you retain Pro access until the end of the current
        billing period. We do not issue refunds for unused subscription time except as required by
        applicable law.
      </p>

      {/* 7 */}
      <h2 style={S.h2}>7. Location Data — Specific Disclosures</h2>
      <p style={S.p}>
        In compliance with Apple App Store and Google Play Store requirements, we provide the following
        specific disclosures about how Msafiri uses location data:
      </p>
      <ul style={S.ul}>
        <li style={S.li}><span style={S.bold}>Purpose:</span> Location is used exclusively to (a) calculate your driving speed, (b) detect nearby road hazards and alerts, and (c) attach a coordinate to SOS emergency messages and user-submitted community reports.</li>
        <li style={S.li}><span style={S.bold}>Background location:</span> Used only when you have explicitly granted "Always" permission and have background mode enabled. Background location is processed on-device; it is not continuously transmitted to our servers.</li>
        <li style={S.li}><span style={S.bold}>Not used for:</span> Advertising, targeted marketing, tracking your movement history, sharing your location with third parties (except the limited SOS use case described in Section 1.5), or any purpose unrelated to road safety.</li>
        <li style={S.li}><span style={S.bold}>Data minimisation:</span> We request only the level of location precision required for the feature in use. We do not collect location when the App is closed and background mode is disabled.</li>
      </ul>

      {/* 8 */}
      <h2 style={S.h2}>8. SMS Permissions</h2>
      <p style={S.p}>
        Msafiri requests <span style={S.bold}>SEND_SMS</span> permission on Android solely to enable the SOS emergency feature.
        This permission is used only when you deliberately press and hold the SOS button. We do not:
      </p>
      <ul style={S.ul}>
        <li style={S.li}>Send SMS messages without your explicit action.</li>
        <li style={S.li}>Read your existing SMS messages.</li>
        <li style={S.li}>Access your contacts list (emergency contacts are entered manually by you).</li>
        <li style={S.li}>Transmit the content of any SMS to our servers.</li>
      </ul>

      {/* 9 */}
      <h2 style={S.h2}>9. Children's Privacy</h2>
      <p style={S.p}>
        Msafiri is not directed to children under the age of 13. We do not knowingly collect personal
        information from children under 13. If you are a parent or guardian and believe your child has
        provided us with personal information, please contact us at privacy@msafirikenya.com and we will
        take steps to delete that information.
      </p>
      <p style={S.p}>
        Users between the ages of 13 and 17 should obtain parental or guardian consent before using the
        App, particularly before enabling the SOS feature.
      </p>

      {/* 10 */}
      <h2 style={S.h2}>10. Third-Party Services and Links</h2>
      <p style={S.p}>
        The App integrates with or links to the following third-party services. We encourage you to
        review their respective privacy policies:
      </p>
      <ul style={S.ul}>
        <li style={S.li}><span style={S.bold}>RevenueCat</span> — revenuecat.com/privacy — in-app subscription management.</li>
        <li style={S.li}><span style={S.bold}>OpenStreetMap / Nominatim</span> — openstreetmap.org/privacy — geocoding (road name lookup from coordinates).</li>
        <li style={S.li}><span style={S.bold}>Apple App Store</span> — apple.com/legal/privacy — app distribution, payment processing.</li>
        <li style={S.li}><span style={S.bold}>Google Play Store</span> — policies.google.com/privacy — app distribution, payment processing.</li>
      </ul>
      <p style={S.p}>
        Msafiri is not responsible for the privacy practices or content of these third-party services.
      </p>

      {/* 11 */}
      <h2 style={S.h2}>11. International Data Transfers</h2>
      <p style={S.p}>
        Msafiri Kenya is based in Kenya. Your data may be processed on servers located outside Kenya,
        including in the European Union and the United States, by our infrastructure and service providers.
        We take reasonable steps to ensure that any international transfer of data complies with applicable
        data protection laws and that your data receives an adequate level of protection.
      </p>

      {/* 12 */}
      <h2 style={S.h2}>12. Changes to This Privacy Policy</h2>
      <p style={S.p}>
        We may update this Privacy Policy from time to time. When we do, we will:
      </p>
      <ul style={S.ul}>
        <li style={S.li}>Update the "Last Updated" date at the top of this page.</li>
        <li style={S.li}>Display an in-app notification for material changes.</li>
        <li style={S.li}>Where required by law, obtain your consent before the changes take effect.</li>
      </ul>
      <p style={S.p}>
        Your continued use of the App after the effective date of any changes constitutes your acceptance
        of the updated Privacy Policy. If you do not agree with the changes, you should stop using the App.
      </p>

      {/* 13 */}
      <h2 style={S.h2}>13. Contact Us</h2>
      <p style={S.p}>
        If you have any questions, concerns, or requests regarding this Privacy Policy or how we handle
        your data, please contact us:
      </p>
      <div style={S.callout}>
        <p style={{ ...S.p, marginBottom: "0.25rem" }}><span style={S.bold}>Msafiri Kenya</span></p>
        <p style={{ ...S.p, marginBottom: "0.25rem" }}>Email: <span style={S.bold}>privacy@msafirikenya.com</span></p>
        <p style={{ ...S.p, marginBottom: "0.25rem" }}>Support: <span style={S.bold}>support@msafirikenya.com</span></p>
        <p style={{ ...S.p, marginBottom: 0 }}>Website: <span style={S.bold}>msafirikenya.com</span></p>
      </div>
      <p style={S.p}>
        We aim to respond to all privacy-related requests within <span style={S.bold}>14 business days</span>.
      </p>
    </LegalLayout>
  );
}
