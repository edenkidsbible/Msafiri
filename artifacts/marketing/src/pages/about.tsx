import { PageLayout } from "@/components/page-layout";
import { Shield, MapPin, Users, Zap, Heart, Lock } from "lucide-react";

const S = {
  p: { fontSize: "0.9375rem", lineHeight: "1.8", color: "hsl(var(--muted-foreground))", marginBottom: "1rem" } as React.CSSProperties,
  h2: { fontSize: "1.25rem", fontWeight: 700, color: "hsl(var(--primary))", marginTop: "3rem", marginBottom: "0.75rem", paddingBottom: "0.5rem", borderBottom: "1px solid hsl(var(--border) / 0.4)" } as React.CSSProperties,
  bold: { fontWeight: 600, color: "hsl(var(--foreground))" } as React.CSSProperties,
  callout: { background: "hsl(var(--card))", border: "1px solid hsl(var(--border) / 0.5)", borderRadius: "0.75rem", padding: "1.25rem 1.5rem", marginBottom: "1.5rem" } as React.CSSProperties,
  stat: { textAlign: "center" as const, padding: "1.5rem", background: "hsl(var(--card))", borderRadius: "0.75rem", border: "1px solid hsl(var(--border) / 0.4)" },
  statNum: { fontSize: "2rem", fontWeight: 800, color: "hsl(var(--primary))", lineHeight: 1, display: "block", marginBottom: "0.35rem" } as React.CSSProperties,
  statLabel: { fontSize: "0.8125rem", color: "hsl(var(--muted-foreground))", fontWeight: 500 } as React.CSSProperties,
};

const values = [
  { icon: Lock,    title: "Privacy-first",       desc: "No account required. Your data stays on your device." },
  { icon: Users,   title: "Community-powered",   desc: "Real road conditions shared by drivers, for drivers." },
  { icon: Zap,     title: "Real-time",            desc: "Speed alerts and hazard warnings in the moment they matter." },
  { icon: Heart,   title: "Built for Kenya",      desc: "Road networks, driving culture, and local conditions understood." },
  { icon: Shield,  title: "Safety over profit",   desc: "We will never sell your data or compromise your privacy." },
  { icon: MapPin,  title: "Always improving",     desc: "Every report makes the map more accurate for everyone." },
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
        with better information — knowing where a speed trap is, where the road is flooded, where a
        breakdown has caused a dangerous obstruction. That information exists. Drivers know it. But until
        now there has been no easy, privacy-respecting way to share it.
      </p>
      <p style={S.p}>
        <span style={S.bold}>Msafiri</span> (Swahili for "traveller") is our answer. A mobile app that
        gives every Kenyan driver real-time speed awareness and a community map powered by the people
        who know these roads best — the drivers themselves.
      </p>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", margin: "2rem 0" }}>
        <div style={S.stat}>
          <span style={S.statNum}>47+</span>
          <span style={S.statLabel}>Counties covered</span>
        </div>
        <div style={S.stat}>
          <span style={S.statNum}>13</span>
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
        Kenya's roads are some of the most dynamic in Africa. Speed zones change. Police checkpoints
        move. Potholes appear overnight. Matatu breakdowns block entire carriageways. Yet most
        navigation apps treat Kenyan roads as a static map with a speed limit overlay from a decade ago.
      </p>
      <p style={S.p}>
        Drivers are forced to rely on word of mouth, WhatsApp groups, and instinct. Msafiri turns that
        informal network into a real-time, structured, crowd-verified safety layer available to every
        driver — without needing a social account, a data plan subscription, or a compatible car.
      </p>

      {/* How it works callout */}
      <div style={S.callout}>
        <p style={{ ...S.p, marginBottom: "0.5rem", fontWeight: 600, color: "hsl(var(--foreground))" }}>
          How Msafiri works
        </p>
        <p style={{ ...S.p, marginBottom: 0 }}>
          The app uses your device's GPS to calculate your real-time speed and compare it against known
          speed zones. At the same time, other drivers submit road conditions — speed cameras, checkpoints,
          potholes, debris, weather hazards — which appear on your map within seconds. All of this happens
          without requiring you to create an account or share any personal information.
        </p>
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
        who drive these roads every day. Every design decision is made with Kenyan infrastructure, data
        costs, device availability, and driving culture in mind.
      </p>
      <p style={S.p}>
        We are not a Silicon Valley product retrofitted to Africa. We are African-built from day one —
        using local knowledge, listening to Kenyan drivers, and iterating fast based on what actually
        helps people stay safe on the road.
      </p>

      {/* CTA */}
      <div style={{ ...S.callout, textAlign: "center", marginTop: "3rem" }}>
        <p style={{ ...S.p, fontWeight: 600, color: "hsl(var(--foreground))", marginBottom: "0.5rem" }}>
          Join the community
        </p>
        <p style={{ ...S.p, marginBottom: "1rem" }}>
          Download Msafiri free on iOS and Android. No account, no sign-up — just safer driving.
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
