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
      effectiveDate="July 28, 2026"
      lastUpdated="July 28, 2026"
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
        <li style={S.li}><span style={S.bold}>Background location ("Always")</span> — optionally collected when Live Trip Sharing is active, so people following your journey can see your position even when your screen is locked. You may revoke this at any time in your device Settings.</li>
        <li style={S.li}><span style={S.bold}>Location at time of SOS</span> — a single GPS coordinate is included in emergency SMS messages sent via the SOS feature.</li>
      </ul>
      <div style={S.callout}>
        <p style={{ ...S.p, marginBottom: 0 }}>
          <span style={S.bold}>When location is transmitted:</span> Your GPS coordinates are sent to our servers or third-party services in four situations: (a) when you submit a community road report; (b) when you activate the SOS feature; (c) every 8 seconds while Live Trip Sharing is active; and (d) when you request turn-by-turn navigation directions (your origin and destination are sent to the OSRM routing service). Speed calculation and hazard detection happen on-device and do not require location to be transmitted.
        </p>
      </div>

      <h3 style={S.h3}>1.2 Speed and Motion Data</h3>
      <p style={S.p}>
        Msafiri calculates your driving speed entirely from GPS coordinates provided by your device's
        location hardware. We do not access your device's accelerometer, gyroscope, barometer, or any
        other motion or fitness sensor. No motion or fitness data is transmitted to our servers. The
        speed value displayed in the App is calculated locally on your device and is not stored or logged.
      </p>
      <ul style={S.ul}>
        <li style={S.li}><span style={S.bold}>GPS-derived speed</span> — computed from successive location fixes; used only for on-screen display and alert triggering. Never stored.</li>
        <li style={S.li}><span style={S.bold}>Heading (direction of travel)</span> — derived from GPS; used locally to determine whether a hazard is ahead of you. Never stored.</li>
      </ul>

      <h3 style={S.h3}>1.3 Device and Technical Information</h3>
      <ul style={S.ul}>
        <li style={S.li}><span style={S.bold}>Device identifier (device ID)</span> — a unique anonymous identifier assigned to your device. Msafiri does not require account registration; your device ID is used in place of a user account.</li>
        <li style={S.li}><span style={S.bold}>Operating system and version</span> — iOS or Android version for compatibility and bug-fix purposes.</li>
        <li style={S.li}><span style={S.bold}>App version</span> — to ensure you receive feature-compatible responses from our API.</li>
        <li style={S.li}><span style={S.bold}>Network type</span> — Wi-Fi or mobile data, used solely for optimising data usage.</li>
        <li style={S.li}><span style={S.bold}>Push notification token</span> — a device-specific token issued by Apple (APNs) or Google (FCM) used to deliver safety alerts and trip notifications. Stored on our servers and associated with your device ID. You can revoke notification permission at any time in your device Settings.</li>
      </ul>

      <h3 style={S.h3}>1.4 Community Road Reports</h3>
      <p style={S.p}>
        When you submit a road report (e.g., speed camera, police checkpoint, speed zone, road hazard), we collect:
      </p>
      <ul style={S.ul}>
        <li style={S.li}>The <span style={S.bold}>type of report</span> (e.g., speed camera, checkpoint, pothole).</li>
        <li style={S.li}>The <span style={S.bold}>GPS coordinates</span> at the time of submission.</li>
        <li style={S.li}>The <span style={S.bold}>timestamp</span> of the report.</li>
        <li style={S.li}>Your <span style={S.bold}>device ID</span> (to prevent spam and enable report editing).</li>
        <li style={S.li}>Confirmation or denial votes submitted by other users for that report.</li>
      </ul>
      <p style={S.p}>
        Reports are shared with other Msafiri users on an aggregated, anonymised basis. We do not attach
        your name, phone number, or any personally identifiable information to community reports.
      </p>

      <h3 style={S.h3}>1.5 Live Trip Sharing</h3>
      <p style={S.p}>
        When you activate Live Trip Sharing, we collect and transmit:
      </p>
      <ul style={S.ul}>
        <li style={S.li}><span style={S.bold}>GPS coordinates and speed</span> — sent to our servers approximately every 8 seconds while sharing is active, so people you've shared your trip link with can follow your journey in real time.</li>
        <li style={S.li}><span style={S.bold}>Session token</span> — a randomly generated link used to identify your sharing session. The link expires after 24 hours or when you stop sharing, whichever is sooner.</li>
        <li style={S.li}><span style={S.bold}>Display name</span> — if you enter a name for your trip, it is stored with the session and shown to people viewing your live trip. This is optional and you may leave it blank.</li>
      </ul>
      <p style={S.p}>
        Live trip data (coordinates and speed pings) is permanently deleted when the session expires.
        We do not retain a history of your trips.
      </p>

      <h3 style={S.h3}>1.6 Payment and Subscription Information (Msafiri Pro)</h3>
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

      <h3 style={S.h3}>1.7 SOS Emergency Data</h3>
      <p style={S.p}>
        If you use the SOS emergency feature, the App composes an emergency message with your GPS
        location and opens your device's native SMS app for you to send. The message includes:
      </p>
      <ul style={S.ul}>
        <li style={S.li}>A standardised emergency message ("EMERGENCY – I need help!").</li>
        <li style={S.li}>A Google Maps link containing your current GPS coordinates.</li>
      </ul>
      <p style={S.p}>
        Msafiri does not transmit, store, or have access to the content of these messages or the
        recipients' phone numbers. Your device's carrier may retain this data under its own privacy policy.
      </p>

      <h3 style={S.h3}>1.8 Voice Guidance and Audio</h3>
      <p style={S.p}>
        Msafiri provides voice-guided navigation and hazard alerts using pre-recorded audio clips
        bundled with the App and, for certain phrases (such as road names and dynamic speed limit
        announcements), on-demand text-to-speech synthesis via <span style={S.bold}>ElevenLabs</span>.
      </p>
      <ul style={S.ul}>
        <li style={S.li}>When on-demand TTS is used, a <span style={S.bold}>short text phrase</span> (e.g., "Turn right onto Ngong Road in 200 metres") is sent to ElevenLabs' API servers to generate an audio clip. No location data, device ID, or personal information is included in these requests.</li>
        <li style={S.li}>Generated audio clips are <span style={S.bold}>cached on your device for up to 90 days</span> to minimise repeated network requests for the same phrase.</li>
      </ul>

      <h3 style={S.h3}>1.9 Usage and Crash Data</h3>
      <ul style={S.ul}>
        <li style={S.li}><span style={S.bold}>Crash and error reports</span> — we use <span style={S.bold}>Sentry</span> (sentry.io) to automatically capture crash reports and performance traces. Sentry payloads are scrubbed of GPS coordinates and location-related fields before transmission. Reports include device model, OS version, App version, and a stack trace. No precise location data is included in Sentry reports.</li>
        <li style={S.li}><span style={S.bold}>API request logs</span> — server-side request logs including IP address, endpoint called, and timestamp, retained for up to 30 days for security and abuse monitoring.</li>
      </ul>

      {/* 2 */}
      <h2 style={S.h2}>2. How We Use Your Information</h2>
      <p style={S.p}>We use the information we collect for the following purposes:</p>
      <ul style={S.ul}>
        <li style={S.li}><span style={S.bold}>Core app functionality</span> — providing real-time speed awareness, road alert notifications, and displaying community reports on the in-app map.</li>
        <li style={S.li}><span style={S.bold}>Turn-by-turn navigation</span> — calculating driving routes, providing step-by-step directions, and announcing upcoming hazards along your route.</li>
        <li style={S.li}><span style={S.bold}>Community report system</span> — validating, aggregating, and expiring road reports submitted by users.</li>
        <li style={S.li}><span style={S.bold}>Live Trip Sharing</span> — transmitting your real-time position to people you've shared your trip link with.</li>
        <li style={S.li}><span style={S.bold}>Subscription management</span> — verifying your Msafiri Pro subscription status via RevenueCat to unlock premium features.</li>
        <li style={S.li}><span style={S.bold}>Safety features</span> — enabling the SOS emergency SMS feature to function correctly.</li>
        <li style={S.li}><span style={S.bold}>Voice guidance</span> — generating spoken navigation instructions and hazard announcements via on-device audio and ElevenLabs TTS.</li>
        <li style={S.li}><span style={S.bold}>App improvement</span> — analysing crash data and error logs via Sentry to fix bugs and improve performance.</li>
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
        location, and timestamp only). Your device ID is never exposed to other users. Live Trip Sharing
        data is shared only with people who have your specific trip link.
      </p>

      <h3 style={S.h3}>3.2 With Service Providers</h3>
      <ul style={S.ul}>
        <li style={S.li}><span style={S.bold}>RevenueCat</span> — for subscription management. Receives your device ID and subscription events. Privacy policy: revenuecat.com/privacy.</li>
        <li style={S.li}><span style={S.bold}>Sentry</span> — for crash and error reporting. Receives device model, OS version, App version, and error stack traces. Location data is scrubbed before transmission. Privacy policy: sentry.io/privacy.</li>
        <li style={S.li}><span style={S.bold}>ElevenLabs</span> — for on-demand voice guidance synthesis. Receives short text phrases only (no location or personal data). Privacy policy: elevenlabs.io/privacy.</li>
        <li style={S.li}><span style={S.bold}>Google Maps SDK</span> — for map rendering on Android and iOS. Google's Maps SDK may collect device and usage data per Google's privacy policy: policies.google.com/privacy.</li>
        <li style={S.li}><span style={S.bold}>OSRM (Open Source Routing Machine)</span> — for route calculation. Your origin and destination GPS coordinates are sent to an OSRM server to calculate driving routes. No personally identifiable information is included.</li>
        <li style={S.li}><span style={S.bold}>OpenStreetMap / Nominatim / Photon</span> — for reverse geocoding (converting GPS coordinates to road names) and place search. Queries do not include your device ID. Privacy policy: openstreetmap.org/privacy.</li>
        <li style={S.li}><span style={S.bold}>Overpass API</span> — for the Search Along Route feature. A bounding box derived from your route is sent to query nearby points of interest. No device ID or personal data is included.</li>
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
        <li style={S.li}><span style={S.bold}>Community reports</span> — retained for as long as they are active (typically 24–48 hours) then automatically expired. Expired reports are retained for up to 90 days for abuse-prevention analysis, then permanently deleted.</li>
        <li style={S.li}><span style={S.bold}>Live trip sharing data</span> — GPS pings are deleted immediately when the trip session expires (after 24 hours or when you stop sharing). We do not retain a history of your journeys.</li>
        <li style={S.li}><span style={S.bold}>Device ID and push notification token</span> — retained for up to 12 months of inactivity, after which they are permanently deleted or anonymised.</li>
        <li style={S.li}><span style={S.bold}>API access logs (IP addresses)</span> — retained for up to 30 days for security monitoring.</li>
        <li style={S.li}><span style={S.bold}>Subscription records</span> — retained for the duration of your subscription and for up to 12 months after cancellation for billing and legal dispute purposes.</li>
        <li style={S.li}><span style={S.bold}>Crash and error reports (Sentry)</span> — retained for up to 90 days to assist with bug resolution.</li>
        <li style={S.li}><span style={S.bold}>Cached voice audio</span> — stored locally on your device for up to 90 days; automatically evicted after that. Clearing the App's storage removes these files.</li>
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
        is 100% secure. If you believe your data has been compromised, please contact us at privacy@msafirikenya.com.
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
        Revoking location access will prevent core app functionality (speed display, road alerts, and navigation) from working, but will not affect your subscription status.
      </p>

      <h3 style={S.h3}>6.2 Notification Permissions</h3>
      <p style={S.p}>
        You can revoke push notification permission at any time:
      </p>
      <ul style={S.ul}>
        <li style={S.li}><span style={S.bold}>iOS:</span> Settings &rarr; Notifications &rarr; Msafiri &rarr; Allow Notifications (toggle off).</li>
        <li style={S.li}><span style={S.bold}>Android:</span> Settings &rarr; Apps &rarr; Msafiri &rarr; Notifications (toggle off).</li>
      </ul>
      <p style={S.p}>
        Revoking notifications means you will not receive push alerts for trip confirmations, hazard notifications while the app is in the background, or admin messages.
      </p>

      <h3 style={S.h3}>6.3 Deleting Your Data</h3>
      <p style={S.p}>
        Because Msafiri does not require account registration, your data is linked only to your device ID.
        To request deletion of all data associated with your device:
      </p>
      <ul style={S.ul}>
        <li style={S.li}>Email us at <span style={S.bold}>privacy@msafirikenya.com</span> with the subject line "Data Deletion Request."</li>
        <li style={S.li}>We will delete all data tied to your device ID within <span style={S.bold}>30 days</span> of receiving your request, except where retention is required by law or for legitimate security purposes.</li>
      </ul>

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
        <li style={S.li}><span style={S.bold}>Primary purpose:</span> Location is used to (a) calculate your driving speed on-device, (b) detect nearby road hazards and speed zone alerts, (c) provide turn-by-turn navigation, (d) attach a coordinate to SOS emergency messages and community reports, and (e) transmit your position during Live Trip Sharing.</li>
        <li style={S.li}><span style={S.bold}>Background location:</span> Used only when Live Trip Sharing is active and you have granted "Always" permission. Background location pings are sent to our servers every 8 seconds during an active sharing session and deleted when the session ends.</li>
        <li style={S.li}><span style={S.bold}>Route calculation:</span> When you request navigation directions, your start and end coordinates are sent to an OSRM routing server. This is a one-time request per route; your live position during navigation is not continuously sent to OSRM.</li>
        <li style={S.li}><span style={S.bold}>Not used for:</span> Advertising, targeted marketing, building a movement history, or any purpose unrelated to road safety and navigation.</li>
        <li style={S.li}><span style={S.bold}>Data minimisation:</span> We do not collect location when the App is closed and background mode is disabled.</li>
      </ul>

      {/* 8 */}
      <h2 style={S.h2}>8. SMS Permissions</h2>
      <p style={S.p}>
        The SOS emergency feature composes an emergency message with your location and opens your
        device's native SMS app for you to review and send. Msafiri does not request the restricted
        SEND_SMS permission and cannot send a text message without you tapping send. We do not:
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
        App, particularly before enabling the SOS feature or Live Trip Sharing.
      </p>

      {/* 10 */}
      <h2 style={S.h2}>10. Third-Party Services</h2>
      <p style={S.p}>
        The App integrates with the following third-party services. We encourage you to review their
        respective privacy policies:
      </p>
      <ul style={S.ul}>
        <li style={S.li}><span style={S.bold}>RevenueCat</span> — revenuecat.com/privacy — in-app subscription management.</li>
        <li style={S.li}><span style={S.bold}>Sentry</span> — sentry.io/privacy — crash and error reporting (location-scrubbed).</li>
        <li style={S.li}><span style={S.bold}>ElevenLabs</span> — elevenlabs.io/privacy — on-demand voice guidance text-to-speech.</li>
        <li style={S.li}><span style={S.bold}>Google Maps</span> — policies.google.com/privacy — map rendering and geocoding on Android and iOS.</li>
        <li style={S.li}><span style={S.bold}>OSRM</span> — project-osrm.org — open-source routing engine for navigation directions.</li>
        <li style={S.li}><span style={S.bold}>OpenStreetMap / Nominatim / Photon</span> — openstreetmap.org/privacy — road name lookup and place search.</li>
        <li style={S.li}><span style={S.bold}>Overpass API</span> — overpass-api.de — points-of-interest search for Search Along Route.</li>
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
        including in the European Union and the United States, by our infrastructure and service providers
        (including Sentry, ElevenLabs, RevenueCat, and OSRM). We take reasonable steps to ensure that
        any international transfer of data complies with applicable data protection laws and that your
        data receives an adequate level of protection.
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
        of the updated Privacy Policy.
      </p>

      {/* 13 */}
      <h2 style={S.h2}>13. Contact Us</h2>
      <p style={S.p}>
        If you have any questions, concerns, or requests regarding this Privacy Policy, please contact us:
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
