import { Router } from "express";
import { mapSpokenRoadName, isRouteCode } from "../data/kenyaRoads.js";

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

/**
 * Rewrites a Google instruction into what should be SPOKEN and returns the
 * (mapped) road name.  Handles the real Google Routes format:
 *   "Head north on Uhuru Hwy/A104\nPass by Kithaku (on the right)"
 *  - keeps only the first line (the "Pass by …" hint is never spoken)
 *  - finds the road after "onto"/"on"/"toward(s)"
 *  - translates route codes to common Kenyan names via mapSpokenRoadName();
 *    an unmapped bare code drops the road name — a code is never voiced.
 */
/** Final safety pass: strip any route code that survived the main rewrite —
 *  slash-composites ("Ruiru/C65", "Thika/G3203/Garissa") lose their code
 *  parts, and a remaining standalone code is replaced by its common name or
 *  removed outright.  A code must never reach the driver's ears. */
function scrubCodes(line: string, lat: number, lng: number): string {
  return line
    // "/A2" or "/G3203" inside a slash group
    .replace(/\/[A-E]\d{1,4}[A-Z]?(?=[/\s,.]|$)/gi, "")
    // "A2/" at the start of a slash group
    .replace(/\b[A-E]\d{1,4}[A-Z]?\//gi, "")
    // standalone code → common name, or drop the word
    .replace(/\b[A-E]\d{1,4}[A-Z]?\b/gi, (code) => mapSpokenRoadName(code, lat, lng))
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
}

function rewriteSpokenInstruction(
  instruction: string,
  lat: number,
  lng: number
): { instruction: string; roadName: string } {
  const firstLine = instruction.split("\n")[0].trim();
  const m = firstLine.match(/\b(onto|on|towards?)\b\s+(.+)$/i);
  if (!m) return { instruction: firstLine, roadName: "" };

  const keyword = m[1].toLowerCase();
  // Split a trailing "… toward Thika" destination hint off the road part
  const tail       = m[2].replace(/\.$/, "").trim();
  const towardIdx  = keyword.startsWith("toward") ? -1 : tail.search(/\btowards?\b/i);
  const rawRoad    = (towardIdx > -1 ? tail.slice(0, towardIdx) : tail).trim();

  // Non-road tails like "…exit on the left"; "toward <place>" names a
  // destination, not a road — leave it alone unless it is a bare code.
  if (/^the (left|right)$/i.test(rawRoad)) {
    return { instruction: firstLine, roadName: "" };
  }
  if (keyword.startsWith("toward")) {
    if (!isRouteCode(rawRoad)) return { instruction: firstLine, roadName: "" };
    const common = mapSpokenRoadName(rawRoad, lat, lng);
    return {
      instruction: common
        ? `${firstLine.slice(0, (m.index ?? 0) + m[1].length)} ${common}`
        : firstLine.slice(0, m.index ?? 0).trim() || "Continue",
      roadName: "",
    };
  }

  const spoken = mapSpokenRoadName(rawRoad, lat, lng);
  const prefix = firstLine.slice(0, (m.index ?? 0) + m[1].length);
  if (spoken === rawRoad && towardIdx === -1) {
    return { instruction: firstLine, roadName: spoken };
  }
  if (spoken) return { instruction: `${prefix} ${spoken}`, roadName: spoken };
  // Unmapped code — drop the road phrase entirely
  return {
    instruction: firstLine.slice(0, m.index ?? 0).replace(/\s+(and stay|and continue)?\s*$/i, "").trim() || "Continue",
    roadName: "",
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCoord(v: unknown): number | null {
  const n = Number(v);
  return isFinite(n) ? n : null;
}

// ── Router ───────────────────────────────────────────────────────────────────

const router = Router();

/**
 * GET /routing/route?fromLat=&fromLng=&toLat=&toLng=[&heading=]
 *
 * Proxies a driving route request to the Google Routes API and returns a
 * normalised response the mobile app can consume directly.  The Google API
 * key never leaves the server.
 *
 * Dual-carriageway snapping (Kenya drives on the left):
 *  • `heading` (optional, 0–359°) — added to the origin so Google snaps the
 *    start point to the correct carriageway and avoids routing backward against
 *    the direction of travel.  Omit for cold-start / GPS-unavailable cases.
 *  • `sideOfRoad: true` on the destination — asks Google to snap the arrival
 *    point to the carriageway the driver approaches from, preventing "turn
 *    around and enter from the other side" instructions on divided roads such
 *    as the Eastern Bypass or Thika Superhighway.
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

  // Optional driver heading — used to snap to the correct carriageway.
  const rawHeading = Number(req.query.heading);
  const heading    = isFinite(rawHeading) && req.query.heading !== undefined
    ? Math.round(rawHeading) % 360
    : null;

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
    // Per-step polyline so step boundaries are measured along the actual road
    // geometry, not straight lines between start points.
    "routes.legs.steps.polyline",
  ].join(",");

  // Build origin — include heading when available so Google snaps to the
  // correct carriageway on divided roads instead of assuming the driver could
  // be on either side.
  const origin: Record<string, unknown> = {
    location: { latLng: { latitude: fromLat, longitude: fromLng } },
  };
  if (heading !== null) origin.heading = heading;

  const body = {
    origin,
    // sideOfRoad: true snaps the destination to the same-side carriageway the
    // driver approaches from, preventing "U-turn and enter from the other side"
    // arrival instructions on divided roads.
    destination: { location: { latLng: { latitude: toLat, longitude: toLng } }, sideOfRoad: true },
    travelMode: "DRIVE",
    computeAlternativeRoutes: true,
    routingPreference: "TRAFFIC_AWARE",
    polylineQuality: "HIGH_QUALITY",
    polylineEncoding: "ENCODED_POLYLINE",
    // Explicitly allow U-turns so that a forward-direction U-turn on a divided
    // road is treated as a valid maneuver rather than a routing blocker.
    routeModifiers: { avoidUTurns: false },
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

    // Log route count so we can confirm whether Google returns alternatives for
    // specific corridors (e.g. Eastern Bypass) without verbose payload logging.
    req.log.info({ routeCount: data.routes?.length ?? 0 }, "Google Routes API returned routes");

    const routes = (data.routes ?? []).map((r: any, idx: number) => {
      const coords = decodePolyline(r.polyline?.encodedPolyline ?? "");
      const durationS = parseInt((r.duration ?? "0s").replace("s", ""), 10);

      const steps = (r.legs?.[0]?.steps ?? []).map((s: any) => {
        const maneuver = s.navigationInstruction?.maneuver ?? "STRAIGHT";
        const loc = s.startLocation?.latLng ?? { latitude: toLat, longitude: toLng };

        // Kenyans never use route codes in speech — translate "A104"-style
        // names to their common point-to-point names; drop unmapped codes so
        // no code is ever voiced.
        const rewritten = rewriteSpokenInstruction(
          s.navigationInstruction?.instructions ?? "Continue",
          loc.latitude,
          loc.longitude
        );
        const instruction = scrubCodes(rewritten.instruction, loc.latitude, loc.longitude) || "Continue";
        const spokenRoad  = scrubCodes(rewritten.roadName,    loc.latitude, loc.longitude);

        // Decode the per-step polyline so the mobile client can measure
        // remaining distance along the actual road geometry, not a straight
        // line between the step's start and end coordinates.
        const stepCoords = s.polyline?.encodedPolyline
          ? decodePolyline(s.polyline.encodedPolyline)
          : undefined;

        return {
          instruction,
          distanceM:        s.distanceMeters ?? 0,
          lat:              loc.latitude,
          lng:              loc.longitude,
          maneuverType:     googleManeuverToType(maneuver),
          maneuverModifier: googleManeuverToModifier(maneuver),
          roadName:         spokenRoad,
          stepCoords,
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
