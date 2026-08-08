import { PageLayout } from "@/components/page-layout";
import {
  Shield, MapPin, Users, Zap, Heart, Lock, Video, HeartPulse,
  Navigation, Route, BookOpen, Share2, Camera, BarChart2, Bookmark,
  Moon, ShieldCheck, CheckCircle2, Star,
} from "lucide-react";

const S = {
  p:  { fontSize: "0.9375rem", lineHeight: "1.8", color: "hsl(var(--muted-foreground))", marginBottom: "1rem" } as React.CSSProperties,
  h2: { fontSize: "1.25rem", fontWeight: 700, color: "hsl(var(--primary))", marginTop: "3rem", marginBottom: "0.75rem", paddingBottom: "0.5rem", borderBottom: "1px solid hsl(var(--border) / 0.4)" } as React.CSSProperties,
  h3: { fontSize: "1rem", fontWeight: 700, color: "hsl(var(--foreground))", marginBottom: "0.4rem" } as React.CSSProperties,
  bold: { fontWeight: 600, color: "hsl(var(--foreground))" } as React.CSSProperties,
  callout: { background: "hsl(var(--card))", border: "1px solid hsl(var(--border) / 0.5)", borderRadius: "0.75rem", padding: "1.25rem 1.5rem", marginBottom: "1.5rem" } as React.CSSProperties,
  stat: { textAlign: "center" as const, padding: "1.5rem", background: "hsl(var(--card))", borderRadius: "0.75rem", border: "1px solid hsl(var(--border) / 0.4)" },
  statNum: { fontSize: "2rem", fontWeight: 800, color: "hsl(var(--primary))", lineHeight: 1, display: "block", marginBottom: "0.35rem" } as React.CSSProperties,
  statLabel: { fontSize: "0.8125rem", color: "hsl(var(--muted-foreground))", fontWeight: 500 } as React.CSSProperties,
};

const values = [
  { icon: Lock,       title: "Privacy-first",        desc: "No account required. Your GPS data stays on your device — we never sell or share it." },
  { icon: Users,      title: "Community-powered",    desc: "Real road conditions shared by Kenyan drivers, for Kenyan drivers — verified in real time." },
  { icon: Zap,        title: "Real-time",             desc: "Speed camera alerts, checkpoint warnings, and hazard reports in the moment they matter." },
  { icon: Heart,      title: "Built for Kenya",       desc: "Road networks, NTSA enforcement patterns, driving culture, and local conditions — understood from the inside." },
  { icon: Shield,     title: "Safety over profit",    desc: "We will never sell your data, compromise your privacy, or water down our safety features for ad revenue." },
  { icon: MapPin,     title: "Always improving",      desc: "Every report, every confirmed alert, every denied false positive makes the map more accurate for everyone." },
];

const features = [
  { icon: Camera,      title: "NTSA Speed Camera Alerts",    desc: "Voice warnings before fixed and mobile NTSA cameras on all major Kenyan highways — speed-adaptive, so alerts come earlier at higher speeds." },
  { icon: Shield,      title: "Police Checkpoint Warnings",  desc: "Real-time community alerts for police roadblocks, spot checks, and alcoblow (breathalyser) checkpoints across all 47 counties." },
  { icon: Navigation,  title: "Turn-by-Turn Navigation",     desc: "Full route guidance with voice instructions and speed alerts — tailored for Kenyan road names and junction landmarks." },
  { icon: Route,       title: "Route Hazard Preview",        desc: "See every camera, checkpoint, and community-reported hazard on your entire route before you start driving." },
  { icon: Video,       title: "Built-in Dashcam",            desc: "Background recording while you drive. Clips auto-split, important moments locked, cloud backup on Wi-Fi — no extra device needed." },
  { icon: HeartPulse,  title: "Crash / Accident Assistant",  desc: "7-step guided accident documentation: emergency call, scene photo, witness details, police report, and a PDF export for insurance." },
  { icon: Share2,      title: "Live Trip Sharing",           desc: "One-tap link lets family watch your position, speed, and ETA live in any browser — no app download on their end." },
  { icon: BookOpen,    title: "NTSA Driver Safety Course",   desc: "Interactive lessons, traffic sign guides, and the full NTSA fine schedule — built into the app, free to access." },
  { icon: Bookmark,    title: "Saved Places & Planned Trips", desc: "Save Home, Work, and frequent destinations. Plan trips ahead and get a full hazard briefing before you leave." },
  { icon: Moon,        title: "Night HUD Mode",              desc: "High-contrast full-screen speed and alert display designed for night driving — glance and refocus instantly." },
  { icon: BarChart2,   title: "Post-Trip Summary",           desc: "After each drive: distance, time, speed events, and safety alerts encountered — to help you understand and improve your driving." },
  { icon: MapPin,      title: "Works with Google Maps & Waze", desc: "Run Msafiri in the background alongside your preferred navigation app. Safety layer on top — no interference." },
];

export default function About() {
  return (
    <PageLayout
      badge="Our Story"
      title="About Msafiri"
      subtitle="We are building Kenya's most trusted road safety companion — one kilometre at a time."
    >
      {/* Mission */}
      <h2 style={S.h2}>Our Mission</h2>
      <p style={S.p}>
        Kenya loses thousands of lives to road accidents every year. Many of those lives could be saved
        with better information — knowing where a speed trap is, where an alcoblow checkpoint has appeared,
        where a pothole has opened up on a dark highway, where a breakdown is blocking traffic ahead.
        That information exists. Drivers know it. But until now there has been no easy, privacy-respecting
        way to share it in real time.
      </p>
      <p style={S.p}>
        <span style={S.bold}>Msafiri</span> (Swahili for "traveller") is our answer. A mobile app that
        gives every Kenyan driver real-time speed awareness, a community safety map, built-in navigation,
        a dashcam, a crash documentation tool, and tools to share their journey safely — all without
        requiring an account or surrendering personal data.
      </p>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem", margin: "2rem 0" }}>
        <div style={S.stat}>
          <span style={S.statNum}>50K+</span>
          <span style={S.statLabel}>Active drivers</span>
        </div>
        <div style={S.stat}>
          <span style={S.statNum}>47</span>
          <span style={S.statLabel}>Counties covered</span>
        </div>
        <div style={S.stat}>
          <span style={S.statNum}>13+</span>
          <span style={S.statLabel}>Incident types tracked</span>
        </div>
        <div style={S.stat}>
          <span style={S.statNum}>0</span>
          <span style={S.statLabel}>Accounts required</span>
        </div>
      </div>

      {/* Problem */}
      <h2 style={S.h2}>The Problem We Are Solving</h2>
      <p style={S.p}>
        Kenya's roads are some of the most dynamic in Africa. Speed zones change without warning. Police
        checkpoints move daily. Alcoblow operations appear overnight on roads that were clear the evening
        before. Potholes open up between map updates. Matatu breakdowns block entire carriageways at rush
        hour. Yet most navigation apps treat Kenyan roads as a static map with a speed limit overlay from
        a decade ago.
      </p>
      <p style={S.p}>
        Drivers are forced to rely on word of mouth, WhatsApp groups, and instinct. Msafiri turns that
        informal network into a real-time, structured, crowd-verified safety layer available to every
        driver — without needing a social account, a data subscription, or a compatible car.
      </p>
      <p style={S.p}>
        Beyond alerts, we saw a second problem: when accidents happen on Kenyan roads, most drivers don't
        know what to do. Panic sets in, evidence is lost, insurance claims fall apart. The Msafiri Accident
        Assistant gives every driver a guided process — step by step, even when they can't think clearly.
      </p>

      {/* How it works */}
      <div style={S.callout}>
        <p style={{ ...S.p, marginBottom: "0.5rem", fontWeight: 600, color: "hsl(var(--foreground))" }}>
          How Msafiri works
        </p>
        <p style={{ ...S.p, marginBottom: 0 }}>
          The app uses your device's GPS to calculate your real-time speed and compare it against known
          speed zones. Other drivers submit road conditions — speed cameras, checkpoints, alcoblow
          operations, potholes, debris, and weather hazards — which appear on your map within seconds.
          A built-in dashcam records the road continuously in the background. Everything happens without
          requiring you to create an account or share personal information.
        </p>
      </div>

      {/* Full Feature Inventory */}
      <h2 style={S.h2}>What's Inside the App</h2>
      <p style={S.p}>
        Msafiri is not a single-feature alert tool. It is Kenya's most complete road safety platform —
        built over years of listening to Kenyan drivers and iterating on real road conditions.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(1, 1fr)", gap: "0.75rem", marginTop: "1rem", marginBottom: "2rem" }}>
        {features.map(({ icon: Icon, title, desc }) => (
          <div
            key={title}
            style={{
              display: "flex", alignItems: "flex-start", gap: "0.875rem",
              padding: "1rem 1.25rem",
              background: "hsl(var(--card))", borderRadius: "0.75rem",
              border: "1px solid hsl(var(--border) / 0.4)",
            }}
          >
            <div style={{
              width: "2.25rem", height: "2.25rem", borderRadius: "0.625rem",
              background: "hsl(var(--primary) / 0.1)",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <Icon size={16} style={{ color: "hsl(var(--primary))" }} />
            </div>
            <div>
              <p style={S.h3}>{title}</p>
              <p style={{ ...S.p, marginBottom: 0, fontSize: "0.875rem" }}>{desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Values */}
      <h2 style={S.h2}>What We Stand For</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem", marginTop: "1rem" }}>
        {values.map(({ icon: Icon, title, desc }) => (
          <div key={title} style={{ padding: "1.25rem", background: "hsl(var(--card))", borderRadius: "0.75rem", border: "1px solid hsl(var(--border) / 0.4)", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Icon size={16} style={{ color: "hsl(var(--primary))", flexShrink: 0 }} />
              <span style={{ fontWeight: 700, fontSize: "0.9375rem", color: "hsl(var(--foreground))" }}>{title}</span>
            </div>
            <p style={{ ...S.p, marginBottom: 0, fontSize: "0.875rem" }}>{desc}</p>
          </div>
        ))}
      </div>

      {/* Built in Kenya */}
      <h2 style={S.h2}>Built in Kenya, for Kenya</h2>
      <p style={S.p}>
        Msafiri is developed in Nairobi by a small, passionate team of engineers and road-safety advocates
        who drive these roads every day — on Thika Road in the morning rush, on Mombasa Road after dark,
        on the Nakuru highway at speed. Every design decision reflects those experiences.
      </p>
      <p style={S.p}>
        We are not a Silicon Valley product retrofitted to Africa. We are African-built from day one —
        using local NTSA data, listening to Kenyan drivers, and iterating fast based on what actually
        helps people stay safe on roads that most mapping apps still get wrong.
      </p>
      <p style={S.p}>
        Every speed zone, every camera placement, every fine bracket in the app reflects Kenya's actual
        traffic law — the Traffic (Amendment) Act (LN 161/2016), NTSA enforcement patterns, and the
        realities of road safety in 2025 Kenya.
      </p>

      {/* NTSA speed / fines context — SEO value */}
      <h2 style={S.h2}>Speed Cameras & Fines in Kenya — What Every Driver Needs to Know</h2>
      <p style={S.p}>
        NTSA operates both fixed and mobile speed cameras across Kenya's highway network. Fixed cameras
        are installed at permanent locations on major roads including Thika Road, Mombasa Road, Waiyaki
        Way, the Southern Bypass, and the Nairobi Expressway. Mobile cameras are deployed by traffic
        police at any location without notice.
      </p>
      <p style={S.p}>
        Speeding fines in Kenya are tiered under the Traffic (Amendment) Act. Minor excess over the
        posted limit results in a warning. Moderate excess attracts a KES 500 fine. Significant excess
        triggers a KES 3,000 fine. Serious excess results in a KES 10,000 fine. Exceeding the speed
        limit by 21 km/h or more is a court matter — not a roadside fine — and can result in licence
        suspension. Drivers have 7 days to pay before additional penalties apply.
      </p>
      <p style={S.p}>
        Msafiri's NTSA Driver Safety Course inside the app covers the full fine schedule, speed zone
        regulations, and Kenya's Highway Code — free for all users.
      </p>

      {/* CTA */}
      <div style={{ ...S.callout, textAlign: "center", marginTop: "3rem" }}>
        <p style={{ ...S.p, fontWeight: 600, color: "hsl(var(--foreground))", marginBottom: "0.5rem" }}>
          Join the community
        </p>
        <p style={{ ...S.p, marginBottom: "1rem" }}>
          Download Msafiri free on iOS and Android. No account, no sign-up — just safer driving across Kenya.
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: "1rem", flexWrap: "wrap" }}>
          <a
            href="https://apps.apple.com/ke/app/msafiri-kenya/id6789483834"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-block", padding: "0.625rem 1.25rem", background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", borderRadius: "0.5rem", fontWeight: 700, fontSize: "0.875rem", textDecoration: "none" }}
          >
            App Store
          </a>
          <a
            href="https://play.google.com/store/apps/details?id=com.msafirikenya.app"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-block", padding: "0.625rem 1.25rem", background: "hsl(var(--card))", color: "hsl(var(--foreground))", border: "1px solid hsl(var(--border))", borderRadius: "0.5rem", fontWeight: 700, fontSize: "0.875rem", textDecoration: "none" }}
          >
            Google Play
          </a>
        </div>
      </div>
    </PageLayout>
  );
}
