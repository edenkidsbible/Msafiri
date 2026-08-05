import { Router } from "express";

const router = Router();

/**
 * GET /places/search?q=<query>
 * Proxies Google Places Text Search API so the API key stays server-side.
 * Restricted to Kenya (region=ke) for relevant results.
 */
router.get("/places/search", async (req, res) => {
  try {
    const q = (req.query.q as string | undefined)?.trim();
    if (!q || q.length < 2) {
      res.json({ results: [] });
      return;
    }

    // GOOGLE_MAPS_ANDROID_API_KEY is device-restricted; GOOGLE_MAPS_API_KEY is
    // the server-unrestricted key. Accept either so ops can configure the right
    // one without changing code.
    const apiKey =
      process.env.GOOGLE_MAPS_ANDROID_API_KEY ??
      process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "Places API not configured" });
      return;
    }

    const url =
      `https://maps.googleapis.com/maps/api/place/textsearch/json` +
      `?query=${encodeURIComponent(q + " Kenya")}` +
      `&region=ke` +
      `&language=en` +
      `&key=${apiKey}`;

    const upstream = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await upstream.json();

    // Forward only what the client needs (trim for bandwidth)
    const results = ((data as any).results ?? []).slice(0, 8).map((r: any) => ({
      name: r.name,
      formatted_address: r.formatted_address,
      geometry: { location: r.geometry?.location },
    }));

    res.json({ results });
  } catch (err) {
    console.error("[places] proxy error:", err);
    res.status(502).json({ error: "Places API unavailable" });
  }
});

// ── Category → Google Places type/keyword map ─────────────────────────────────
// Maps every RouteSearchSheet QueryCategory to the best legacy Places API type
// and an optional keyword to narrow results.

type QueryCategory =
  | "fuel" | "food" | "hospital" | "pharmacy" | "shopping"
  | "bank_atm" | "police" | "parking" | "hotel" | "toilets"
  | "nightlife" | "gym";

interface GooglePlacesParams {
  type: string;
  keyword?: string;
}

const CATEGORY_MAP: Record<QueryCategory, GooglePlacesParams> = {
  fuel:      { type: "gas_station" },
  food:      { type: "restaurant" },
  hospital:  { type: "hospital" },
  pharmacy:  { type: "pharmacy" },
  shopping:  { type: "supermarket" },
  bank_atm:  { type: "bank" },
  police:    { type: "police" },
  parking:   { type: "parking" },
  hotel:     { type: "lodging" },
  toilets:   { type: "point_of_interest", keyword: "toilets" },
  nightlife: { type: "night_club" },
  gym:       { type: "gym" },
};

const VALID_CATEGORIES = new Set<string>(Object.keys(CATEGORY_MAP));

/**
 * GET /places/nearby?lat=&lng=&radius=&category=
 *
 * Proxies Google Places Nearby Search (legacy API) for a given category around
 * a driver location.  Returns the same normalized shape as /places/search so
 * mobile can reuse its normalization logic.
 *
 * Query params:
 *   lat      – latitude (required)
 *   lng      – longitude (required)
 *   radius   – search radius in metres (required, capped at 50 000 server-side)
 *   category – one of the 12 RouteSearchSheet QueryCategory strings (required)
 */
router.get("/places/nearby", async (req, res) => {
  try {
    const lat      = parseFloat(req.query.lat as string);
    const lng      = parseFloat(req.query.lng as string);
    const radius   = Math.min(parseFloat(req.query.radius as string), 50_000);
    const category = (req.query.category as string | undefined)?.trim();

    if (isNaN(lat) || isNaN(lng) || isNaN(radius) || radius <= 0) {
      res.status(400).json({ error: "lat, lng and radius (>0) are required" });
      return;
    }
    if (!category || !VALID_CATEGORIES.has(category)) {
      res.status(400).json({
        error: `category must be one of: ${[...VALID_CATEGORIES].join(", ")}`,
      });
      return;
    }

    const apiKey =
      process.env.GOOGLE_MAPS_ANDROID_API_KEY ??
      process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "Places API not configured" });
      return;
    }

    const { type, keyword } = CATEGORY_MAP[category as QueryCategory];

    let url =
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
      `?location=${lat},${lng}` +
      `&radius=${Math.round(radius)}` +
      `&type=${encodeURIComponent(type)}` +
      `&language=en` +
      `&key=${apiKey}`;

    if (keyword) {
      url += `&keyword=${encodeURIComponent(keyword)}`;
    }

    const upstream = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await upstream.json() as any;

    if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.error("[places/nearby] Google API error status:", data.status, data.error_message ?? "");
      res.status(502).json({ error: `Google Places error: ${data.status}` });
      return;
    }

    // Normalize to same shape as /places/search — legacy nearbysearch returns
    // `vicinity` instead of `formatted_address`; expose both for compatibility.
    const results = ((data.results ?? []) as any[]).slice(0, 20).map((r: any) => ({
      place_id: r.place_id as string,
      name: r.name as string,
      // nearbysearch returns `vicinity`; formatted_address is absent — use vicinity
      // in its place so the mobile normalizer can treat it the same way.
      formatted_address: (r.vicinity ?? "") as string,
      geometry: { location: r.geometry?.location as { lat: number; lng: number } },
    }));

    res.json({ results });
  } catch (err) {
    console.error("[places/nearby] proxy error:", err);
    res.status(502).json({ error: "Places API unavailable" });
  }
});

export default router;
