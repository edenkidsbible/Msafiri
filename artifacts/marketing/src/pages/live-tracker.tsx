import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "wouter";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
// Fix Leaflet's default marker icons broken by Vite asset hashing
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// Patch Leaflet default icon so Vite doesn't hash the URLs away
const DefaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

// ── Types ─────────────────────────────────────────────────────────────────────
interface SessionState {
  lat: number | null;
  lng: number | null;
  speedKmh: number | null;
  durationRemainingS: number | null;
  distanceRemainingM: number | null;
  driverName: string | null;
  destinationName: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
  lastPingAt: string | null;
  endedAt: string | null;
  ended: boolean;
  createdAt: string;
}

// ── Formatting helpers ────────────────────────────────────────────────────────
function distStr(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function durationStr(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

function timeSince(isoStr: string): string {
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 5)  return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ── Custom map icons ──────────────────────────────────────────────────────────
function makeCarIcon(speedKmh: number | null, isStale = false, lastPingAt: string | null = null) {
  const speed = speedKmh != null ? Math.round(speedKmh) : null;
  // When signal is lost, show "Last seen X ago" label; otherwise show speed
  const label = isStale
    ? (lastPingAt ? `<span style="color:#fff;font-size:8px;font-weight:700;line-height:1;margin-top:1px;text-align:center;">${timeSince(lastPingAt)}</span>` : "")
    : (speed != null ? `<span style="color:#fff;font-size:9px;font-weight:700;line-height:1;margin-top:1px;">${speed}</span>` : "");
  return L.divIcon({
    html: `
      <div style="
        background:${isStale ? "#90A4AE" : "#1A73E8"};
        border:3px solid #fff;
        border-radius:50%;
        width:46px;height:46px;
        display:flex;flex-direction:column;
        align-items:center;justify-content:center;
        box-shadow:0 3px 10px rgba(0,0,0,0.4);
        font-family:system-ui,sans-serif;
        opacity:${isStale ? "0.55" : "1"};
      ">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
          <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.85 7h10.29l1.08 3.11H5.77L6.85 7zM19 17H5v-5h14v5z"/>
          <circle cx="7.5" cy="14.5" r="1.5"/>
          <circle cx="16.5" cy="14.5" r="1.5"/>
        </svg>
        ${label}
      </div>`,
    className: "",
    iconSize:   [46, 46],
    iconAnchor: [23, 23],
  });
}

function makeDestIcon(label: string | null) {
  const safeName = label ? label.split(",")[0].substring(0, 24) : "Destination";
  return L.divIcon({
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div style="
          background:#E53935;
          border:3px solid #fff;
          border-radius:50% 50% 50% 0;
          width:30px;height:30px;
          transform:rotate(-45deg);
          box-shadow:0 2px 8px rgba(0,0,0,0.35);
        "></div>
        <div style="
          background:rgba(0,0,0,0.72);
          color:#fff;
          font-size:11px;
          font-weight:600;
          font-family:system-ui,sans-serif;
          padding:2px 7px;
          border-radius:8px;
          margin-top:4px;
          white-space:nowrap;
          max-width:140px;
          overflow:hidden;
          text-overflow:ellipsis;
        ">${safeName}</div>
      </div>`,
    className: "",
    iconSize:   [30, 60],
    iconAnchor: [15, 33],
  });
}

const POLL_MS = 5000;
// Same-origin API call — Replit proxy routes /api/* to the API server
const API_BASE = "/api";
// How long with no ping before we show the "Signal lost" banner (ms)
const STALE_THRESHOLD_MS = 30_000;

// ── Component ─────────────────────────────────────────────────────────────────
export default function LiveTracker() {
  const { token } = useParams<{ token: string }>();
  const [session, setSession]     = useState<SessionState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [, forceRender]           = useState(0); // for timeSince updates

  const mapDivRef        = useRef<HTMLDivElement>(null);
  const mapRef           = useRef<L.Map | null>(null);
  const driverMarkerRef  = useRef<L.Marker | null>(null);
  const destMarkerRef    = useRef<L.Marker | null>(null);
  const hasInitialFit    = useRef(false);
  const sessionRef       = useRef<SessionState | null>(null);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchSession = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/share/${token}`);
      if (res.status === 404) {
        setLoadError("This tracking link is invalid or has expired.");
        return;
      }
      if (!res.ok) {
        setLoadError("Unable to load tracking data. Please try again.");
        return;
      }
      const data: SessionState = await res.json();
      sessionRef.current = data;
      setSession(data);
      setLoadError(null);
    } catch {
      // Network blip — keep existing session data visible, show soft error
      setLoadError("Network issue — retrying…");
    }
  }, [token]);

  // ── Signal-lost: computed early so effects can depend on it ──────────────
  // lastPingAt exists, session is active, and ping is stale
  const lastPingMs = session?.lastPingAt ? new Date(session.lastPingAt).getTime() : null;
  const isSignalLost =
    !session?.ended &&
    lastPingMs != null &&
    Date.now() - lastPingMs > STALE_THRESHOLD_MS;

  // ── Init map ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    const map = L.map(mapDivRef.current, {
      center: [-1.2921, 36.8219], // Nairobi default
      zoom: 13,
      zoomControl: true,
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 20,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Sync markers ──────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !session) return;

    // Driver marker — show at reduced opacity with "Last seen" label when stale
    if (session.lat != null && session.lng != null) {
      const pos: L.LatLngExpression = [session.lat, session.lng];
      const icon = makeCarIcon(session.speedKmh, isSignalLost, session.lastPingAt);
      if (!driverMarkerRef.current) {
        driverMarkerRef.current = L.marker(pos, {
          icon,
          zIndexOffset: 1000,
        }).addTo(map);
      } else {
        driverMarkerRef.current.setLatLng(pos);
        driverMarkerRef.current.setIcon(icon);
      }

      // First time we get a real position: fit the map nicely
      if (!hasInitialFit.current) {
        hasInitialFit.current = true;
        if (session.destinationLat != null && session.destinationLng != null) {
          map.fitBounds(
            L.latLngBounds(pos, [session.destinationLat, session.destinationLng]),
            { padding: [60, 60] }
          );
        } else {
          map.setView(pos, 14);
        }
      }
    }

    // Destination marker
    if (session.destinationLat != null && session.destinationLng != null && !destMarkerRef.current) {
      const dPos: L.LatLngExpression = [session.destinationLat, session.destinationLng];
      destMarkerRef.current = L.marker(dPos, { icon: makeDestIcon(session.destinationName) }).addTo(map);
    }
  // isSignalLost is time-driven (updates every 10s via forceRender tick), so include it
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, isSignalLost]);

  // ── Poll loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchSession();
    const pollId = setInterval(() => {
      if (!sessionRef.current?.ended) fetchSession();
    }, POLL_MS);
    // Re-render the "X ago" labels every 10 s without re-fetching
    const tickId = setInterval(() => forceRender(n => n + 1), 10_000);
    return () => { clearInterval(pollId); clearInterval(tickId); };
  }, [fetchSession]);

  // ── Render ────────────────────────────────────────────────────────────────
  const ended = session?.ended;
  const hasPos = session && session.lat != null && session.lng != null;

  return (
    <div style={{
      minHeight: "100dvh",
      display: "flex",
      flexDirection: "column",
      fontFamily: "system-ui, -apple-system, sans-serif",
      background: "#f0f4f8",
    }}>
      {/* ── Header ── */}
      <div style={{
        background: ended ? "#616161" : "#1A73E8",
        color: "#fff",
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
      }}>
        {/* Logo / icon */}
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: "rgba(255,255,255,0.2)",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z"/>
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {ended
              ? "Trip Ended"
              : session?.driverName
                ? `${session.driverName} is sharing their location`
                : "Live Tracking"}
          </div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }}>
            {ended
              ? "The driver has arrived or stopped sharing."
              : "Updates every 5 seconds · Msafiri Kenya"}
          </div>
        </div>
        {/* Live indicator */}
        {!ended && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
            <div style={{
              width: 9, height: 9, borderRadius: "50%",
              background: isSignalLost ? "#FFD740" : hasPos ? "#69F0AE" : "#FFD740",
              boxShadow: !isSignalLost && hasPos ? "0 0 0 3px rgba(105,240,174,0.3)" : "none",
              animation: !isSignalLost && hasPos ? "livepulse 2s ease-in-out infinite" : "none",
            }} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>
              {isSignalLost ? "Signal lost" : hasPos ? "LIVE" : "Waiting…"}
            </span>
          </div>
        )}
        <style>{`
          @keyframes livepulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(105,240,174,0.5); }
            50%       { box-shadow: 0 0 0 6px rgba(105,240,174,0); }
          }
        `}</style>
      </div>

      {/* ── Error (no session) ── */}
      {loadError && !session && (
        <div style={{
          flex: 1, display: "flex", alignItems: "center",
          justifyContent: "center", padding: 32,
        }}>
          <div style={{
            background: "#fff", borderRadius: 16,
            padding: "36px 28px", maxWidth: 360, width: "100%",
            textAlign: "center",
            boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8, color: "#212121" }}>
              Link not found
            </div>
            <div style={{ color: "#757575", fontSize: 14, lineHeight: 1.5 }}>
              {loadError}
            </div>
          </div>
        </div>
      )}

      {/* ── Map ── */}
      <div ref={mapDivRef} style={{ flex: 1, minHeight: 300 }} />

      {/* ── Signal-lost banner ── */}
      {isSignalLost && session?.lastPingAt && (
        <div style={{
          background: "#FFF8E1",
          borderTop: "2px solid #FFD740",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 13,
          color: "#5D4037",
        }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>⚠️</span>
          <span>
            <strong>Signal lost</strong> — last seen {timeSince(session.lastPingAt)}. The map will
            update automatically when the driver regains signal.
          </span>
        </div>
      )}

      {/* ── Stats card ── */}
      {session && (
        <div style={{
          background: "#fff",
          borderTop: "1px solid #e0e0e0",
          padding: "16px 16px 20px",
        }}>
          {/* Destination */}
          {session.destinationName && (
            <div style={{
              fontWeight: 600, fontSize: 15, color: "#212121",
              display: "flex", alignItems: "center", gap: 6,
              marginBottom: 12,
            }}>
              <span>📍</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {session.destinationName.split(",")[0]}
              </span>
            </div>
          )}

          {/* Stat pills */}
          {!ended && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              {session.durationRemainingS != null && (
                <StatPill icon="⏱" label="ETA" value={durationStr(session.durationRemainingS)} />
              )}
              {session.distanceRemainingM != null && (
                <StatPill icon="📏" label="Left" value={distStr(session.distanceRemainingM)} />
              )}
              {session.speedKmh != null && (
                <StatPill icon="🚗" label="Speed" value={`${Math.round(session.speedKmh)} km/h`} />
              )}
            </div>
          )}

          {/* Last update */}
          {session.lastPingAt && !ended && (
            <div style={{ fontSize: 12, color: "#9e9e9e", marginBottom: 8 }}>
              Last updated {timeSince(session.lastPingAt)}
              {loadError && <span style={{ color: "#EF9A9A" }}> · {loadError}</span>}
            </div>
          )}

          {ended && (
            <div style={{
              fontSize: 13, color: "#757575",
              background: "#f5f5f5", borderRadius: 8,
              padding: "10px 14px", marginBottom: 8,
            }}>
              The driver has stopped sharing their location.
            </div>
          )}

          {/* Branding */}
          <div style={{ fontSize: 11, color: "#bdbdbd", marginTop: 6 }}>
            Powered by{" "}
            <strong style={{ color: "#9e9e9e" }}>Msafiri Kenya</strong>
            {" "}· Real-time road alerts for Kenyan drivers
          </div>
        </div>
      )}
    </div>
  );
}

function StatPill({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{
      background: "#f5f5f5",
      borderRadius: 10,
      padding: "8px 14px",
      display: "flex",
      flexDirection: "column",
      minWidth: 80,
    }}>
      <div style={{ fontSize: 11, color: "#9e9e9e", marginBottom: 2 }}>
        {icon} {label}
      </div>
      <div style={{ fontWeight: 700, fontSize: 17, color: "#212121" }}>{value}</div>
    </div>
  );
}
