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

export default router;
