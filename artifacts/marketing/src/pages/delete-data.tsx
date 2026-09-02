import { Link } from "wouter";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Mail,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";
import { LegalLayout } from "@/components/legal-layout";

const S = {
  intro: {
    fontSize: "1.0625rem",
    lineHeight: "1.8",
    color: "hsl(var(--muted-foreground))",
    marginBottom: "1rem",
  } as React.CSSProperties,
  p: {
    fontSize: "0.9375rem",
    lineHeight: "1.8",
    color: "hsl(var(--muted-foreground))",
    marginBottom: "1rem",
  } as React.CSSProperties,
  h2: {
    fontSize: "1.25rem",
    fontWeight: 700,
    color: "hsl(var(--primary))",
    marginTop: "3rem",
    marginBottom: "0.75rem",
    paddingBottom: "0.5rem",
    borderBottom: "1px solid hsl(var(--border) / 0.4)",
  } as React.CSSProperties,
  h3: {
    fontSize: "1rem",
    fontWeight: 700,
    color: "hsl(var(--foreground))",
    marginTop: "1.5rem",
    marginBottom: "0.5rem",
  } as React.CSSProperties,
  ul: {
    paddingLeft: "1.5rem",
    marginBottom: "1rem",
    listStyleType: "disc",
  } as React.CSSProperties,
  li: {
    fontSize: "0.9375rem",
    lineHeight: "1.8",
    color: "hsl(var(--muted-foreground))",
    marginBottom: "0.375rem",
  } as React.CSSProperties,
  bold: { fontWeight: 600, color: "hsl(var(--foreground))" } as React.CSSProperties,
};

const deletedData = [
  ["Trip history and routes", "Past drive sessions, route records, and planned trips."],
  ["Saved places and vehicles", "Home, work, custom places, vehicle profiles, and drive statistics."],
  ["Community activity", "Road reports and other submissions associated with your device."],
  ["Crash and accident records", "Incident details, witness information, uploaded photos, and generated report records."],
  ["Dashcam cloud records", "Cloud clip metadata, thumbnails, and locked clips uploaded to Msafiri storage."],
  ["Learning data", "Msafiri Academy course progress and bookmarks."],
  ["Emergency and recovery data", "Saved SOS contacts and cloud backup snapshots linked to your device."],
  ["Device identifiers and push registrations", "Your Msafiri device ID, push token, and related notification registration."],
];

const retainedData = [
  ["Local dashcam video files", "Videos saved on your phone are not deleted by a server request. Delete them from the Dashcam screen or your phone's storage."],
  ["App preferences stored on the phone", "Theme, notification, audio, and other local preferences may remain on the device. Clear the app's storage or uninstall the app to remove local files."],
  ["Google Play subscription records", "Google Play controls billing and subscription history. Deleting Msafiri data does not cancel a subscription; cancel it in Google Play."],
  ["Limited legal and security records", "We may retain information required by law or needed to investigate fraud, abuse, disputes, or security incidents."],
];

const retentionPeriods = [
  ["Deletion request", "Server-side data associated with the device is deleted within 30 days of a valid request."],
  ["Community reports", "Active reports normally expire after 24–48 hours. Expired reports may be retained for up to 90 days for abuse-prevention analysis, then deleted."],
  ["Live Trip Sharing", "Location pings are deleted when sharing stops or the session expires, no later than 24 hours."],
  ["Device ID and push token", "Retained for up to 12 months of inactivity, then deleted or anonymised. A completed deletion request removes the associated records sooner."],
  ["API security logs", "IP addresses and access records may be retained for up to 30 days."],
  ["Subscription records", "Retained for the subscription period and up to 12 months after cancellation for billing and dispute resolution."],
];

export default function DeleteData() {
  return (
    <LegalLayout
      badge="Privacy & Control"
      title="Delete All My Data"
      effectiveDate="September 2, 2026"
      lastUpdated="September 2, 2026"
    >
      <div
        style={{
          border: "1px solid hsl(var(--primary) / 0.35)",
          background: "linear-gradient(135deg, hsl(var(--primary) / 0.12), hsl(var(--card)))",
          borderRadius: "1rem",
          padding: "1.5rem",
          marginBottom: "2rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.875rem" }}>
          <div
            style={{
              width: "2.75rem",
              height: "2.75rem",
              borderRadius: "0.75rem",
              background: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Trash2 size={21} aria-hidden="true" />
          </div>
          <div>
            <h2 style={{ ...S.h3, margin: 0, fontSize: "1.125rem" }}>
              Delete your Msafiri data any time
            </h2>
            <p style={{ ...S.p, marginTop: "0.5rem", marginBottom: 0 }}>
              Msafiri Kenya lets you permanently delete the data associated with your
              app profile from inside the app. This is the fastest way to make a
              deletion request.
            </p>
          </div>
        </div>
      </div>

      <p style={S.intro}>
        This page explains how to delete all data held by Msafiri Kenya, the
        developer of the Msafiri mobile application shown on Google Play. Msafiri
        does not require a traditional account: your app data is associated with
        an anonymous device profile and any features you choose to use.
      </p>

      <h2 style={{ ...S.h2, marginTop: "2rem" }}>Delete from the Msafiri app</h2>
      <p style={S.p}>
        Follow these steps whenever you want to delete your data:
      </p>

      <ol
        style={{
          listStyle: "none",
          padding: 0,
          margin: "1.25rem 0 1.5rem",
          display: "grid",
          gap: "0.75rem",
        }}
      >
        {[
          ["Open Msafiri", "Launch the Msafiri app on your phone."],
          ["Open Profile", "Tap the Profile tab in the app."],
          ["Open Delete My Data", "Scroll to Danger Zone and tap Delete My Data."],
          ["Review the impact", "Read the deleted and retained data lists before continuing."],
          ["Confirm deletion", "Type DELETE, then tap Delete All My Data and confirm the final warning."],
        ].map(([title, detail], index) => (
          <li
            key={title}
            style={{
              display: "flex",
              gap: "0.875rem",
              alignItems: "flex-start",
              border: "1px solid hsl(var(--border) / 0.7)",
              background: "hsl(var(--card))",
              borderRadius: "0.75rem",
              padding: "1rem",
            }}
          >
            <span
              style={{
                width: "1.75rem",
                height: "1.75rem",
                borderRadius: "999px",
                background: "hsl(var(--primary) / 0.12)",
                color: "hsl(var(--primary))",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: "0.875rem",
                flexShrink: 0,
              }}
            >
              {index + 1}
            </span>
            <span style={{ display: "grid", gap: "0.2rem" }}>
              <span style={{ ...S.bold, fontSize: "0.9375rem" }}>{title}</span>
              <span style={{ ...S.p, margin: 0, fontSize: "0.875rem" }}>{detail}</span>
            </span>
          </li>
        ))}
      </ol>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          alignItems: "center",
          padding: "1rem 1.125rem",
          borderRadius: "0.75rem",
          background: "hsl(var(--muted))",
          marginBottom: "1rem",
        }}
      >
        <Smartphone size={20} style={{ color: "hsl(var(--primary))", flexShrink: 0 }} aria-hidden="true" />
        <span style={{ ...S.p, margin: 0, flex: 1, minWidth: "14rem" }}>
          Deletion is permanent. Export or save anything you need before confirming.
        </span>
        <Link
          href="/privacy"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            color: "hsl(var(--primary))",
            fontWeight: 700,
            fontSize: "0.875rem",
            textDecoration: "none",
          }}
        >
          Read privacy policy <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>

      <h2 style={S.h2}>What gets deleted</h2>
      <p style={S.p}>
        When the in-app deletion request succeeds, Msafiri deletes the following
        server-side data associated with your device profile:
      </p>
      <ul style={S.ul}>
        {deletedData.map(([title, detail]) => (
          <li key={title} style={S.li}>
            <span style={S.bold}>{title}</span> — {detail}
          </li>
        ))}
      </ul>

      <h2 style={S.h2}>What is kept or needs a separate action</h2>
      <p style={S.p}>
        Deleting Msafiri server data cannot delete files controlled by your phone,
        Google Play, or records we are legally required to retain:
      </p>
      <ul style={S.ul}>
        {retainedData.map(([title, detail]) => (
          <li key={title} style={S.li}>
            <span style={S.bold}>{title}</span> — {detail}
          </li>
        ))}
      </ul>

      <h2 style={S.h2}>Retention after a request</h2>
      <div style={{ display: "grid", gap: "0.75rem" }}>
        {retentionPeriods.map(([title, detail]) => (
          <div
            key={title}
            style={{
              display: "flex",
              gap: "0.75rem",
              alignItems: "flex-start",
              padding: "0.875rem 1rem",
              borderLeft: "3px solid hsl(var(--primary) / 0.55)",
              background: "hsl(var(--card))",
              borderRadius: "0 0.5rem 0.5rem 0",
            }}
          >
            <Clock3 size={17} style={{ color: "hsl(var(--primary))", marginTop: "0.2rem", flexShrink: 0 }} aria-hidden="true" />
            <p style={{ ...S.p, margin: 0 }}>
              <span style={S.bold}>{title}</span> — {detail}
            </p>
          </div>
        ))}
      </div>

      <h2 style={S.h2}>If you cannot access the app</h2>
      <p style={S.p}>
        If you cannot open Msafiri or the in-app deletion option is unavailable,
        email us from the address associated with your request. Include
        <span style={S.bold}> “Data Deletion Request”</span> in the subject and
        provide enough information for us to identify your device profile. Do not
        send passwords, payment card details, or other unnecessary sensitive
        information.
      </p>
      <a
        href="mailto:privacy@msafirikenya.com?subject=Data%20Deletion%20Request"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.75rem 1rem",
          borderRadius: "0.625rem",
          background: "hsl(var(--primary))",
          color: "hsl(var(--primary-foreground))",
          fontWeight: 700,
          textDecoration: "none",
          fontSize: "0.9375rem",
        }}
      >
        <Mail size={17} aria-hidden="true" />
        Email privacy@msafirikenya.com
      </a>
      <p style={{ ...S.p, fontSize: "0.875rem", marginTop: "0.75rem" }}>
        We aim to respond to privacy requests within 14 business days. A valid
        deletion request is completed within 30 days, subject to the limited
        legal and security exceptions described above.
      </p>

      <div
        style={{
          marginTop: "2.5rem",
          padding: "1.25rem",
          border: "1px solid hsl(var(--border) / 0.7)",
          borderRadius: "0.75rem",
          display: "flex",
          gap: "0.75rem",
          alignItems: "flex-start",
        }}
      >
        <ShieldCheck size={21} style={{ color: "hsl(var(--primary))", marginTop: "0.15rem", flexShrink: 0 }} aria-hidden="true" />
        <p style={{ ...S.p, margin: 0 }}>
          <span style={S.bold}>Your choice matters.</span> Msafiri does not sell
          your data or use it for advertising. See the{" "}
          <Link href="/privacy" style={{ color: "hsl(var(--primary))", fontWeight: 700 }}>
            full Privacy Policy
          </Link>{" "}
          for our wider data practices.
        </p>
      </div>
    </LegalLayout>
  );
}