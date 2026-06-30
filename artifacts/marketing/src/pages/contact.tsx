import { useState } from "react";
import { PageLayout } from "@/components/page-layout";
import { Mail, MessageSquare, Shield, Clock, ExternalLink } from "lucide-react";

const S = {
  p: { fontSize: "0.9375rem", lineHeight: "1.8", color: "hsl(var(--muted-foreground))", marginBottom: "1rem" } as React.CSSProperties,
  h2: { fontSize: "1.125rem", fontWeight: 700, color: "hsl(var(--foreground))", marginBottom: "0.5rem" } as React.CSSProperties,
  bold: { fontWeight: 600, color: "hsl(var(--foreground))" } as React.CSSProperties,
  card: { background: "hsl(var(--card))", border: "1px solid hsl(var(--border) / 0.5)", borderRadius: "0.75rem", padding: "1.5rem" } as React.CSSProperties,
  label: { display: "block", fontSize: "0.875rem", fontWeight: 600, color: "hsl(var(--foreground))", marginBottom: "0.375rem" } as React.CSSProperties,
  input: {
    width: "100%", padding: "0.625rem 0.875rem", borderRadius: "0.5rem", fontSize: "0.9375rem",
    border: "1px solid hsl(var(--border))", background: "hsl(var(--background))",
    color: "hsl(var(--foreground))", outline: "none", boxSizing: "border-box" as const,
  } as React.CSSProperties,
  textarea: {
    width: "100%", padding: "0.625rem 0.875rem", borderRadius: "0.5rem", fontSize: "0.9375rem",
    border: "1px solid hsl(var(--border))", background: "hsl(var(--background))",
    color: "hsl(var(--foreground))", outline: "none", resize: "vertical" as const,
    minHeight: "7rem", fontFamily: "inherit", boxSizing: "border-box" as const,
  } as React.CSSProperties,
  btn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
    padding: "0.75rem 1.5rem", background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))",
    borderRadius: "0.5rem", fontWeight: 700, fontSize: "0.9375rem", border: "none",
    cursor: "pointer", width: "100%",
  } as React.CSSProperties,
};

const channels = [
  {
    icon: MessageSquare,
    title: "General Support",
    desc: "App questions, bug reports, and how-to help.",
    email: "support@msafirikenya.com",
    time: "Response within 2 business days",
  },
  {
    icon: Shield,
    title: "Privacy & Data",
    desc: "Data deletion requests, privacy concerns, and GDPR/PDPA queries.",
    email: "privacy@msafirikenya.com",
    time: "Response within 14 business days",
  },
  {
    icon: Mail,
    title: "Business & Partnerships",
    desc: "Fleet safety, enterprise enquiries, media, and press.",
    email: "hello@msafirikenya.com",
    time: "Response within 5 business days",
  },
];

type FormStatus = "idle" | "sending" | "sent" | "error";

export default function Contact() {
  const [form, setForm] = useState({ name: "", email: "", subject: "General Support", message: "" });
  const [status, setStatus] = useState<FormStatus>("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    await new Promise((r) => setTimeout(r, 900));
    setStatus("sent");
  };

  return (
    <PageLayout
      badge="Get in Touch"
      title="Contact Us"
      subtitle="We are a small team — we read every message and aim to respond quickly."
    >

      {/* Contact channels */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "3rem" }}>
        {channels.map(({ icon: Icon, title, desc, email, time }) => (
          <div key={email} style={{ ...S.card, display: "flex", gap: "1rem", alignItems: "flex-start" }}>
            <div style={{ padding: "0.625rem", background: "hsl(var(--primary) / 0.1)", borderRadius: "0.5rem", flexShrink: 0 }}>
              <Icon size={18} style={{ color: "hsl(var(--primary))" }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ ...S.h2, marginBottom: "0.25rem" }}>{title}</p>
              <p style={{ ...S.p, marginBottom: "0.5rem", fontSize: "0.875rem" }}>{desc}</p>
              <a
                href={`mailto:${email}`}
                style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", fontSize: "0.875rem", fontWeight: 600, color: "hsl(var(--primary))", textDecoration: "none" }}
              >
                {email}
                <ExternalLink size={12} />
              </a>
              <p style={{ ...S.p, fontSize: "0.8125rem", marginTop: "0.375rem", marginBottom: 0, display: "flex", alignItems: "center", gap: "0.375rem" as any }}>
                <Clock size={12} style={{ flexShrink: 0, display: "inline" }} />
                {" "}{time}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Form */}
      <div style={{ ...S.card }}>
        <p style={{ ...S.p, fontWeight: 700, fontSize: "1.0625rem", color: "hsl(var(--foreground))", marginBottom: "1.25rem" }}>
          Send us a message
        </p>

        {status === "sent" ? (
          <div style={{ textAlign: "center", padding: "2rem 0" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>✅</div>
            <p style={{ ...S.p, fontWeight: 700, color: "hsl(var(--foreground))", fontSize: "1rem", marginBottom: "0.25rem" }}>
              Message received!
            </p>
            <p style={{ ...S.p, marginBottom: 0, fontSize: "0.875rem" }}>
              We'll get back to you at <span style={S.bold}>{form.email}</span> as soon as possible.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div>
                <label style={S.label}>Your name</label>
                <input
                  style={S.input}
                  placeholder="Jane Kamau"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label style={S.label}>Email address</label>
                <input
                  type="email"
                  style={S.input}
                  placeholder="jane@example.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>
            </div>

            <div>
              <label style={S.label}>Subject</label>
              <select
                style={S.input}
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              >
                <option>General Support</option>
                <option>Bug Report</option>
                <option>Privacy & Data Request</option>
                <option>Business & Partnerships</option>
                <option>Feature Request</option>
                <option>Other</option>
              </select>
            </div>

            <div>
              <label style={S.label}>Message</label>
              <textarea
                style={S.textarea}
                placeholder="Tell us what you need help with…"
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                required
              />
            </div>

            <button type="submit" style={{ ...S.btn, opacity: status === "sending" ? 0.7 : 1 }} disabled={status === "sending"}>
              {status === "sending" ? "Sending…" : "Send Message"}
            </button>

            <p style={{ ...S.p, fontSize: "0.8125rem", textAlign: "center", marginBottom: 0 }}>
              For urgent app issues, you can also reach us directly at{" "}
              <a href="mailto:support@msafirikenya.com" style={{ color: "hsl(var(--primary))", fontWeight: 600 }}>
                support@msafirikenya.com
              </a>
            </p>
          </form>
        )}
      </div>
    </PageLayout>
  );
}
