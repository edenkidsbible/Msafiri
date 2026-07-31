import { logger } from "../lib/logger.js";

// Region to monitor — defaults to central Nairobi.
// Override via environment variables if needed.
const CENTER_LAT = parseFloat(process.env.HERE_CENTER_LAT ?? "1.2921");
const CENTER_LNG = parseFloat(process.env.HERE_CENTER_LNG ?? "36.8219");
const RADIUS_M   = parseInt(process.env.HERE_RADIUS_M   ?? "50000", 10); // 50 km

// ── HERE → Msafiri type mapping ────────────────────────────────────────────────
function mapHereType(raw: string): string {
  const t = (raw ?? "").toUpperCase();
  if (t.includes("ACCIDENT"))                                          return "accident";
  if (t.includes("CONGESTION") || t.includes("FLOW") || t.includes("SLOW")) return "traffic";
  if (t.includes("CONSTRUCTION") || t.includes("WORKS"))               return "roadworks";
  if (t.includes("ROAD_CLOSURE") || t.includes("CLOSURE") || t.includes("CLOSED")) return "closure";
  if (t.includes("WEATHER"))                                            return "weather";
  if (t.includes("DISABLED") || t.includes("BREAKDOWN"))               return "breakdown";
  if (t.includes("POLICE") || t.includes("CHECKPOINT"))                return "police";
  if (t.includes("HAZARD"))                                             return "hazard";
  return "hazard";
}

// ── Exported types ─────────────────────────────────────────────────────────────
export interface HereIncident {
  id: string;          // "here:{HERE_ID}"
  type: string;        // Msafiri incident type key
  lat: number;
  lng: number;
  description?: string;
  roadName?: string;
  startTime?: number;  // epoch ms
  endTime?: number;    // epoch ms
}

// ── In-memory store ────────────────────────────────────────────────────────────
let store: HereIncident[] = [];

export function getHereIncidents(): HereIncident[] {
  return store;
}

// ── Fetch ──────────────────────────────────────────────────────────────────────
async function fetchAndRefresh(): Promise<void> {
  const apiKey = process.env.HERE_API_KEY;
  if (!apiKey) {
    logger.warn("HERE_API_KEY not set — skipping HERE traffic fetch");
    return;
  }

  const url =
    `https://data.traffic.hereapi.com/v7/incidents` +
    `?in=circle:${CENTER_LAT},${CENTER_LNG};r=${RADIUS_M}` +
    `&locationReferencing=olr` +
    `&apiKey=${apiKey}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

  if (!res.ok) {
    logger.warn(
      { status: res.status },
      "HERE API non-200 — keeping stale incidents"
    );
    return;
  }

  const body = await res.json() as {
    results?: Array<{
      location?: {
        shape?: {
          links?: Array<{ points?: Array<{ lat: number; lng: number }> }>;
        };
        roadName?: string;
      };
      incidentDetails?: {
        id?: string;
        originalId?: string;
        type?: string;
        startTime?: string;
        endTime?: string;
        description?: { value?: string };
        summary?: { value?: string };
      };
    }>;
  };

  const mapped: HereIncident[] = [];

  for (const r of body.results ?? []) {
    const det = r.incidentDetails;
    if (!det) continue;

    const hereId = det.id ?? det.originalId;
    if (!hereId) continue;

    // Use first coordinate on the first link as the pin location.
    const pt = r.location?.shape?.links?.[0]?.points?.[0];
    if (!pt || typeof pt.lat !== "number" || typeof pt.lng !== "number") continue;

    mapped.push({
      id: `here:${hereId}`,
      type: mapHereType(det.type ?? ""),
      lat: pt.lat,
      lng: pt.lng,
      description: det.description?.value ?? det.summary?.value,
      roadName: r.location?.roadName,
      startTime: det.startTime ? new Date(det.startTime).getTime() : undefined,
      endTime:   det.endTime   ? new Date(det.endTime).getTime()   : undefined,
    });
  }

  store = mapped;
  logger.info({ count: store.length }, "HERE traffic incidents refreshed");
}

// ── Background job ─────────────────────────────────────────────────────────────
export function startHereTrafficJob(): void {
  const POLL_MS = 5 * 60 * 1_000; // every 5 minutes

  // Fire-and-forget initial fetch so startup is not blocked.
  fetchAndRefresh().catch((err) =>
    logger.error({ err }, "HERE traffic initial fetch failed")
  );

  setInterval(() => {
    fetchAndRefresh().catch((err) =>
      logger.error({ err }, "HERE traffic poll failed")
    );
  }, POLL_MS);

  logger.info({ intervalMs: POLL_MS }, "HERE traffic job started");
}
