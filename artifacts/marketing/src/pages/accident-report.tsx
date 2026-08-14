/**
 * Public Accident Report Page
 *
 * Opened via a share link: /accident-report/:shareToken
 * Fetches data from GET /api/public/accident-report/:shareToken (no auth).
 * Follows the same plain-inline-style pattern as live-tracker.tsx.
 */
import { useEffect, useState, useCallback } from "react";
import { useParams } from "wouter";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Photo {
  id: string;
  category: string;
  signedUrl: string | null;
  createdAt: string;
}

interface Witness {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
}

interface TimelineEvent {
  id: string;
  eventType: string;
  description: string | null;
  occurredAt: string;
}

interface ReportRecord {
  id: string;
  detectedAt: string;
  status: string;
  isManual: boolean;
  lat: string | null;
  lng: string | null;
  roadName: string | null;
  county: string | null;
  nearbyLandmark: string | null;
  speedBeforeKmh: string | null;
  speedAtImpactKmh: string | null;
  directionLabel: string | null;
  destinationName: string | null;
  distanceM: string | null;
  durationS: string | null;
  weatherJson: string | null;
  otherDriverJson: string | null;
  policeJson: string | null;
  driverStatement: string | null;
  myVehicleJson: string | null;
}

interface ReportData {
  shareLabel: string | null;
  createdAt: string;
  record: ReportRecord;
  photos: Photo[];
  witnesses: Witness[];
  timeline: TimelineEvent[];
  dashcamClipUrl: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string, style: "full" | "time" = "full") {
  const d = new Date(iso);
  if (style === "time") {
    return d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-KE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

function categoryLabel(cat: string) {
  return cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function parse<T>(json: string | null): T | null {
  if (!json) return null;
  try { return JSON.parse(json) as T; } catch { return null; }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AccidentReport() {
  const { token } = useParams<{ token: string }>();
  const [data, setData]     = useState<ReportData | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/public/accident-report/${token}`);
      if (res.status === 404) {
        const body = await res.json().catch(() => ({})) as { revoked?: boolean };
        if (body.revoked) { setRevoked(true); } else { setError("This report link is invalid or has expired."); }
        return;
      }
      if (!res.ok) { setError("Could not load report. Please try again later."); return; }
      const d = await res.json() as ReportData;
      setData(d);
    } catch {
      setError("Could not load report. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  // ── Render states ──────────────────────────────────────────────────────────

  if (loading) return (
    <div style={styles.page}>
      <div style={styles.centerBox}>
        <div style={styles.spinner} />
        <p style={{ color: "#6B7280", fontFamily: "system-ui,sans-serif", marginTop: 16 }}>Loading report…</p>
      </div>
    </div>
  );

  if (revoked) return (
    <div style={styles.page}>
      <div style={styles.centerBox}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <h2 style={{ ...styles.h2, color: "#111827" }}>Link Revoked</h2>
        <p style={{ color: "#6B7280", fontFamily: "system-ui,sans-serif", maxWidth: 340, textAlign: "center", lineHeight: 1.6 }}>
          The owner has revoked access to this report. Please contact them for a new link.
        </p>
      </div>
    </div>
  );

  if (error || !data) return (
    <div style={styles.page}>
      <div style={styles.centerBox}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <h2 style={{ ...styles.h2, color: "#111827" }}>Report Not Found</h2>
        <p style={{ color: "#6B7280", fontFamily: "system-ui,sans-serif", maxWidth: 340, textAlign: "center", lineHeight: 1.6 }}>
          {error ?? "This link is invalid or has expired."}
        </p>
      </div>
    </div>
  );

  const { record: r, photos, witnesses, timeline, dashcamClipUrl } = data;
  const weather  = parse<{ description?: string; tempC?: number; roadCondition?: string; windspeedKmh?: number }>(r.weatherJson);
  const other    = parse<{ type?: string; vehicleType?: string; vehicleReg?: string; name?: string; phone?: string; insuranceCompany?: string; policyNumber?: string; cause?: string; injuries?: string; notes?: string }>(r.otherDriverJson);
  const police   = parse<{ station?: string; officerName?: string; obNumber?: string; reference?: string }>(r.policeJson);
  const myVehicle = parse<{ make?: string; model?: string; plate?: string; type?: string; fuelType?: string; transmission?: string }>(r.myVehicleJson);

  const incidentId = `MSF-${new Date(r.detectedAt).getFullYear()}-${r.id.slice(-6).toUpperCase()}`;

  // Group photos by category
  const photoMap: Record<string, Photo[]> = {};
  for (const p of photos) { (photoMap[p.category] ??= []).push(p); }

  return (
    <div style={styles.page}>
      {/* Lightbox */}
      {lightbox && (
        <div style={styles.lightboxOverlay} onClick={() => setLightbox(null)}>
          <img src={lightbox} style={styles.lightboxImg} alt="Scene photo" />
          <button style={styles.lightboxClose} onClick={() => setLightbox(null)}>✕</button>
        </div>
      )}

      {/* Header bar */}
      <div style={styles.headerBar}>
        <div style={styles.headerInner}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={styles.logoBox}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.85 7h10.29l1.08 3.11H5.77L6.85 7zM19 17H5v-5h14v5z" />
                <circle cx="7.5" cy="14.5" r="1.5" />
                <circle cx="16.5" cy="14.5" r="1.5" />
              </svg>
            </div>
            <div>
              <div style={{ color: "#fff", fontWeight: 700, fontSize: 15, fontFamily: "system-ui,sans-serif" }}>Msafiri Kenya</div>
              <div style={{ color: "#86efac", fontSize: 11, fontFamily: "system-ui,sans-serif" }}>Official Accident Report</div>
            </div>
          </div>
          <div style={styles.idBadge}>{incidentId}</div>
        </div>
      </div>

      {/* Main content */}
      <div style={styles.container}>

        {/* Share label + date */}
        {data.shareLabel && (
          <div style={styles.shareLabel}>
            <span style={{ marginRight: 6 }}>🔗</span>{data.shareLabel}
          </div>
        )}
        <h1 style={styles.h1}>
          {r.isManual ? "Accident Report" : "Crash Detection Report"}
        </h1>
        <p style={styles.subtitle}>
          {fmt(r.detectedAt)} · {r.roadName ?? "Unknown road"}{r.county ? `, ${r.county}` : ""}
        </p>

        {/* Evidence */}
        <Section title="Evidence" icon="🛡️">
          <Grid>
            {myVehicle?.make && <DataCell label="My Vehicle" value={[myVehicle.make, myVehicle.model].filter(Boolean).join(" ")} />}
            {myVehicle?.plate && <DataCell label="Reg. Plate" value={myVehicle.plate} />}
            {myVehicle?.fuelType && <DataCell label="Fuel Type" value={myVehicle.fuelType} />}
            {r.speedBeforeKmh && <DataCell label="Speed Before" value={`${Number(r.speedBeforeKmh).toFixed(0)} km/h`} highlight />}
            {r.speedAtImpactKmh && <DataCell label="Speed at Impact" value={`${Number(r.speedAtImpactKmh).toFixed(0)} km/h`} highlight />}
            {r.directionLabel && <DataCell label="Direction" value={r.directionLabel} />}
            {r.roadName && <DataCell label="Road" value={r.roadName} />}
            {r.county && <DataCell label="County" value={r.county} />}
            {r.nearbyLandmark && <DataCell label="Landmark" value={r.nearbyLandmark} />}
            {weather?.description && <DataCell label="Weather" value={weather.description} />}
            {weather?.tempC !== undefined && <DataCell label="Temperature" value={`${weather.tempC}°C`} />}
            {weather?.roadCondition && <DataCell label="Road Condition" value={weather.roadCondition} />}
            {r.destinationName && <DataCell label="Destination" value={r.destinationName} />}
          </Grid>
          {r.lat && r.lng && (
            <a
              href={`https://maps.google.com/?q=${r.lat},${r.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.mapLink}
            >
              📍 View crash location on Google Maps
            </a>
          )}
        </Section>

        {/* Photos */}
        {photos.some((p) => p.signedUrl) && (
          <Section title="Scene Photos" icon="📷">
            {Object.entries(photoMap).map(([cat, catPhotos]) => (
              <div key={cat} style={{ marginBottom: 16 }}>
                <div style={styles.photoGroupLabel}>{categoryLabel(cat)}</div>
                <div style={styles.photoGrid}>
                  {catPhotos.filter((p) => p.signedUrl).map((p) => (
                    <img
                      key={p.id}
                      src={p.signedUrl!}
                      alt={categoryLabel(p.category)}
                      style={styles.photo}
                      onClick={() => setLightbox(p.signedUrl!)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </Section>
        )}

        {/* Dashcam footage */}
        {dashcamClipUrl && (
          <Section title="Dashcam Footage" icon="🎥">
            <video
              controls
              style={styles.video}
              src={dashcamClipUrl}
              preload="metadata"
            >
              Your browser does not support video playback.
            </video>
          </Section>
        )}

        {/* Witnesses */}
        {witnesses.length > 0 && (
          <Section title="Witnesses" icon="👥">
            {witnesses.map((w) => (
              <div key={w.id} style={styles.witnessCard}>
                <div style={styles.witnessName}>{w.name}</div>
                {w.phone && <div style={styles.witnessSub}>{w.phone}</div>}
                {w.notes && <div style={styles.witnessNotes}>{w.notes}</div>}
              </div>
            ))}
          </Section>
        )}

        {/* Other party */}
        {other && other.type !== "solo" && (
          <Section title="Other Party" icon="🚗">
            <Grid>
              {other.vehicleType && <DataCell label="Vehicle Type" value={other.vehicleType} />}
              {other.vehicleReg && <DataCell label="Registration" value={other.vehicleReg} highlight />}
              {other.name && <DataCell label="Name" value={other.name} />}
              {other.phone && <DataCell label="Phone" value={other.phone} />}
              {other.insuranceCompany && <DataCell label="Insurance" value={other.insuranceCompany} />}
              {other.policyNumber && <DataCell label="Policy No." value={other.policyNumber} />}
              {other.injuries && <DataCell label="Injuries" value={other.injuries} />}
            </Grid>
            {other.notes && <div style={styles.notesBox}>{other.notes}</div>}
          </Section>
        )}

        {/* Solo incident */}
        {other?.type === "solo" && other.cause && (
          <Section title="Incident Cause" icon="⚠️">
            <div style={styles.notesBox}>{other.cause}</div>
          </Section>
        )}

        {/* Police */}
        {police && (police.obNumber || police.station) && (
          <Section title="Police Report" icon="🛡️">
            <Grid>
              {police.station && <DataCell label="Station" value={police.station} />}
              {police.officerName && <DataCell label="Officer" value={police.officerName} />}
              {police.obNumber && <DataCell label="OB Number" value={police.obNumber} highlight />}
              {police.reference && <DataCell label="Reference" value={police.reference} />}
            </Grid>
          </Section>
        )}

        {/* Driver's statement */}
        {r.driverStatement && (
          <Section title="Driver's Statement" icon="📝">
            <div style={styles.statementBox}>{r.driverStatement}</div>
          </Section>
        )}

        {/* Timeline */}
        {timeline.length > 0 && (
          <Section title="Timeline" icon="🕐">
            <div style={styles.timeline}>
              {timeline.map((evt, i) => (
                <div key={evt.id} style={styles.timelineRow}>
                  <div style={styles.timelineLeft}>
                    <div style={styles.timelineDot} />
                    {i < timeline.length - 1 && <div style={styles.timelineLine} />}
                  </div>
                  <div style={styles.timelineContent}>
                    <div style={styles.timelineTime}>{fmt(evt.occurredAt, "time")}</div>
                    <div style={styles.timelineDesc}>{evt.description ?? evt.eventType}</div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Footer */}
        <div style={styles.footer}>
          <div style={styles.footerLogo}>Msafiri Kenya</div>
          <div style={styles.footerSub}>
            Report ID: {incidentId} · Generated by Msafiri Kenya Driver Safety App
          </div>
          <div style={styles.footerNote}>
            This report was generated from Msafiri Kenya's accident documentation system.
            The data was captured automatically at the time of the incident.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader}>
        <span style={{ marginRight: 8 }}>{icon}</span>
        <span>{title}</span>
      </div>
      <div style={styles.sectionBody}>{children}</div>
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div style={styles.grid}>{children}</div>;
}

function DataCell({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={styles.dataCell}>
      <div style={styles.dataCellLabel}>{label}</div>
      <div style={{ ...styles.dataCellValue, color: highlight ? "#16A34A" : "#111827" }}>{value}</div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    backgroundColor: "#F9FAFB",
    fontFamily: "system-ui,-apple-system,sans-serif",
  },
  centerBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "60vh",
    padding: 32,
  },
  spinner: {
    width: 40,
    height: 40,
    border: "4px solid #E5E7EB",
    borderTopColor: "#16A34A",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  headerBar: {
    background: "linear-gradient(135deg,#052E16 0%,#166534 100%)",
    padding: "0 24px",
  },
  headerInner: {
    maxWidth: 800,
    margin: "0 auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 20,
    paddingBottom: 20,
  },
  logoBox: {
    width: 40,
    height: 40,
    background: "rgba(255,255,255,0.15)",
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  idBadge: {
    background: "rgba(255,255,255,0.15)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 1,
    padding: "4px 12px",
    borderRadius: 20,
    fontFamily: "monospace",
  },
  container: {
    maxWidth: 800,
    margin: "0 auto",
    padding: "32px 24px 64px",
  },
  shareLabel: {
    display: "inline-block",
    background: "#DCFCE7",
    color: "#166534",
    fontSize: 12,
    fontWeight: 600,
    padding: "4px 12px",
    borderRadius: 20,
    marginBottom: 12,
  },
  h1: {
    fontSize: 26,
    fontWeight: 800,
    color: "#111827",
    margin: "0 0 6px",
  },
  h2: {
    fontSize: 22,
    fontWeight: 700,
    margin: "0 0 8px",
  },
  subtitle: {
    fontSize: 14,
    color: "#6B7280",
    marginBottom: 32,
  },
  section: {
    background: "#fff",
    border: "1px solid #E5E7EB",
    borderRadius: 16,
    marginBottom: 20,
    overflow: "hidden",
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    padding: "12px 20px",
    background: "#F9FAFB",
    borderBottom: "1px solid #E5E7EB",
    fontSize: 14,
    fontWeight: 700,
    color: "#374151",
  },
  sectionBody: {
    padding: 20,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))",
    gap: 12,
  },
  dataCell: {
    background: "#F9FAFB",
    borderRadius: 10,
    padding: "10px 14px",
  },
  dataCellLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "#9CA3AF",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  dataCellValue: {
    fontSize: 15,
    fontWeight: 600,
  },
  mapLink: {
    display: "inline-block",
    marginTop: 16,
    color: "#16A34A",
    fontSize: 13,
    fontWeight: 600,
    textDecoration: "none",
  },
  photoGroupLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  photoGrid: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 8,
  },
  photo: {
    width: 140,
    height: 105,
    objectFit: "cover" as const,
    borderRadius: 10,
    cursor: "pointer",
    border: "1px solid #E5E7EB",
    transition: "transform 0.15s",
  },
  video: {
    width: "100%",
    borderRadius: 12,
    background: "#000",
    maxHeight: 400,
  },
  witnessCard: {
    background: "#F9FAFB",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  witnessName: {
    fontSize: 15,
    fontWeight: 700,
    color: "#111827",
    marginBottom: 2,
  },
  witnessSub: {
    fontSize: 13,
    color: "#6B7280",
    marginBottom: 2,
  },
  witnessNotes: {
    fontSize: 13,
    color: "#374151",
    marginTop: 6,
    lineHeight: 1.5,
  },
  notesBox: {
    background: "#F9FAFB",
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: "#374151",
    lineHeight: 1.6,
  },
  statementBox: {
    background: "#F0FDF4",
    border: "1px solid #BBF7D0",
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    color: "#111827",
    lineHeight: 1.7,
    whiteSpace: "pre-wrap" as const,
  },
  timeline: {
    display: "flex",
    flexDirection: "column" as const,
  },
  timelineRow: {
    display: "flex",
    gap: 14,
    marginBottom: 4,
  },
  timelineLeft: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    width: 20,
    paddingTop: 4,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: "#16A34A",
    flexShrink: 0,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    background: "#E5E7EB",
    margin: "4px 0",
    minHeight: 12,
  },
  timelineContent: {
    flex: 1,
    paddingBottom: 14,
  },
  timelineTime: {
    fontSize: 11,
    color: "#9CA3AF",
    marginBottom: 2,
    fontWeight: 600,
  },
  timelineDesc: {
    fontSize: 14,
    color: "#111827",
  },
  footer: {
    marginTop: 48,
    paddingTop: 24,
    borderTop: "1px solid #E5E7EB",
    textAlign: "center" as const,
  },
  footerLogo: {
    fontSize: 16,
    fontWeight: 800,
    color: "#166534",
    marginBottom: 6,
  },
  footerSub: {
    fontSize: 12,
    color: "#6B7280",
    fontFamily: "monospace",
    marginBottom: 8,
  },
  footerNote: {
    fontSize: 12,
    color: "#9CA3AF",
    maxWidth: 500,
    margin: "0 auto",
    lineHeight: 1.6,
  },
  lightboxOverlay: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0,0,0,0.9)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    cursor: "pointer",
  },
  lightboxImg: {
    maxWidth: "90vw",
    maxHeight: "90vh",
    objectFit: "contain" as const,
    borderRadius: 8,
  },
  lightboxClose: {
    position: "absolute" as const,
    top: 16,
    right: 20,
    background: "rgba(255,255,255,0.15)",
    border: "none",
    color: "#fff",
    fontSize: 20,
    width: 36,
    height: 36,
    borderRadius: "50%",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
};
