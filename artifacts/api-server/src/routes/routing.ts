import { Router } from "express";

const GOOGLE_ROUTES_API =
  "https://routes.googleapis.com/directions/v2:computeRoutes";
const GOOGLE_ROADS_API =
  "https://roads.googleapis.com/v1/nearestRoads";

// ── Polyline decoder (standard Google encoded-polyline algorithm) ────────────

function decodePolyline(
  encoded: string
): Array<{ latitude: number; longitude: number }> {
  const coords: Array<{ latitude: number; longitude: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return coords;
}

// ── Maneuver mapping ─────────────────────────────────────────────────────────

/** Maps Google Routes API maneuver enum → simplified type string used by the
 *  mobile navigation engine (mirrors the old OSRM maneuver type vocabulary). */
function googleManeuverToType(maneuver: string): string {
  if (maneuver.startsWith("TURN_")) return "turn";
  if (maneuver.startsWith("UTURN_")) return "uturn";
  if (maneuver.startsWith("ROUNDABOUT_")) return "roundabout";
  if (maneuver.startsWith("RAMP_")) return "ramp";
  if (maneuver.startsWith("FORK_")) return "fork";
  if (maneuver === "MERGE") return "merge";
  if (maneuver === "FERRY" || maneuver === "FERRY_TRAIN") return "ferry";
  if (maneuver === "DEPART") return "depart";
  if (maneuver === "ARRIVE") return "arrive";
  if (maneuver === "STRAIGHT") return "continue";
  if (maneuver === "NAME_CHANGE") return "new name";
  return "continue";
}

function googleManeuverToModifier(maneuver: string): string {
  if (maneuver.includes("SLIGHT_LEFT")) return "slight left";
  if (maneuver.includes("SLIGHT_RIGHT")) return "slight right";
  if (maneuver.includes("SHARP_LEFT")) return "sharp left";
  if (maneuver.includes("SHARP_RIGHT")) return "sharp right";
  if (maneuver.includes("_LEFT")) return "left";
  if (maneuver.includes("_RIGHT")) return "right";
  return "straight";
}

/** Extracts the road name from a Google instruction string.
 *  e.g. "Turn right onto Thika Road" → "Thika Road" */
function extractRoadName(instruction: string): string {
  const match = instruction.match(/\bonto\s+(.+)$/i);
  return match ? match[1].replace(/\.$/, "").trim() : "";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCoord(v: unknown): number | null {
  const n = Number(v);
  return isFinite(n) ? n : null;
}

// ── Router ───────────────────────────────────────────────────────────────────

const router = Router();

/**
 * GET /routing/route?fromLat=&fromLng=&toLat=&toLng=
 *
 * Proxies a driving route request to the Google Routes API and returns a
 * normalised response the mobile app can consume directly.  The Google API
 * key never leaves the server.
 */
router.get("/routing/route", async (req, res) => {
  const fromLat = parseCoord(req.query.fromLat);
  const fromLng = parseCoord(req.query.fromLng);
  const toLat   = parseCoord(req.query.toLat);
  const toLng   = parseCoord(req.query.toLng);
  if (fromLat === null || fromLng === null || toLat === null || toLng === null) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }

  const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Routing service not configured" });
    return;
  }

  const FIELD_MASK = [
    "routes.distanceMeters",
    "routes.duration",
    "routes.polyline.encodedPolyline",
    "routes.legs.steps.distanceMeters",
    "routes.legs.steps.navigationInstruction",
    "routes.legs.steps.startLocation",
  ].join(",");

  const body = {
    origin:      { location: { latLng: { latitude: fromLat, longitude: fromLng } } },
    destination: { location: { latLng: { latitude: toLat,   longitude: toLng   } } },
    travelMode: "DRIVE",
    computeAlternativeRoutes: true,
    routingPreference: "TRAFFIC_AWARE",
    polylineQuality: "HIGH_QUALITY",
    polylineEncoding: "ENCODED_POLYLINE",
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const gRes = await fetch(GOOGLE_ROUTES_API, {
      method: "POST",
      headers: {
        "Content-Type":    "application/json",
        "X-Goog-Api-Key":  apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!gRes.ok) {
      const text = await gRes.text().catch(() => "");
      req.log.error({ status: gRes.status, text }, "Google Routes API error");
      res.status(502).json({ error: "Routing service error" });
      return;
    }

    const data = (await gRes.json()) as any;

    const routes = (data.routes ?? []).map((r: any, idx: number) => {
      const coords = decodePolyline(r.polyline?.encodedPolyline ?? "");
      const durationS = parseInt((r.duration ?? "0s").replace("s", ""), 10);

      const steps = (r.legs?.[0]?.steps ?? []).map((s: any) => {
        const maneuver    = s.navigationInstruction?.maneuver   ?? "STRAIGHT";
        const instruction = s.navigationInstruction?.instructions ?? "Continue";
        const loc = s.startLocation?.latLng ?? { latitude: toLat, longitude: toLng };
        return {
          instruction,
          distanceM:        s.distanceMeters ?? 0,
          lat:              loc.latitude,
          lng:              loc.longitude,
          maneuverType:     googleManeuverToType(maneuver),
          maneuverModifier: googleManeuverToModifier(maneuver),
          roadName:         extractRoadName(instruction),
        };
      });

      return {
        index:     idx,
        distanceM: r.distanceMeters ?? 0,
        durationS,
        coords,
        steps,
      };
    });

    res.json({ routes });
  } catch (err: any) {
    if (err.name === "AbortError") {
      res.status(504).json({ error: "Routing service timed out" });
      return;
    }
    req.log.error({ err }, "Google Routes API fetch failed");
    res.status(502).json({ error: "Routing service error" });
  } finally {
    clearTimeout(timer);
  }
});

/**
 * GET /routing/snap?lat=&lng=
 *
 * Snaps a coordinate to the nearest driveable road using the Google Roads API.
 * Returns the original coordinate unchanged on any error so callers are safe
 * to use this unconditionally.
 */
router.get("/routing/snap", async (req, res) => {
  const lat = parseCoord(req.query.lat);
  const lng = parseCoord(req.query.lng);
  if (lat === null || lng === null) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }

  const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (!apiKey) {
    // Graceful fallback — return original coordinate when key is absent
    res.json({ lat, lng });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const gRes = await fetch(
      `${GOOGLE_ROADS_API}?points=${lat},${lng}&key=${apiKey}`,
      { signal: controller.signal }
    );
    if (!gRes.ok) {
      res.json({ lat, lng });
      return;
    }
    const data = (await gRes.json()) as any;
    const pt = data.snappedPoints?.[0]?.location;
    res.json({ lat: pt?.latitude ?? lat, lng: pt?.longitude ?? lng });
  } catch {
    res.json({ lat, lng });
  } finally {
    clearTimeout(timer);
  }
});

/**
 * GET /routing/road-name?lat=&lng=
 *
 * Reverse-geocodes a GPS coordinate to the name of the road the driver is on.
 * Uses Google Geocoding API (same key as routing). Returns { road: string|null }
 * and never errors — callers treat a null road as "unknown" and fall back to
 * distance-only alert logic.
 */
router.get("/routing/road-name", async (req, res) => {
  const lat = parseCoord(req.query.lat);
  const lng = parseCoord(req.query.lng);
  if (lat === null || lng === null) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }

  const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (!apiKey) {
    res.json({ road: null });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?latlng=${lat},${lng}&result_type=route&key=${apiKey}`;
    const gRes = await fetch(url, { signal: controller.signal });
    if (!gRes.ok) { res.json({ road: null }); return; }

    const data = (await gRes.json()) as any;
    const result = data.results?.[0];
    const routeComp = result?.address_components?.find(
      (c: any) => Array.isArray(c.types) && c.types.includes("route")
    );
    res.json({ road: routeComp?.long_name ?? null });
  } catch {
    res.json({ road: null });
  } finally {
    clearTimeout(timer);
  }
});

export default router;
