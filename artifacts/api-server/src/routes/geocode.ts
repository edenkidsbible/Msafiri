/**
 * Reverse-geocoding proxy
 *
 * GET /geocode/reverse?lat=&lng=
 *
 * Calls the HERE Reverse Geocoding API (server-side key) and returns a
 * human-readable place name.  No authentication is required on this endpoint —
 * the worst a caller can do is consume geocoding quota.
 *
 * Returns: { name: string | null }
 */

import { Router } from "express";

const router = Router();

router.get("/geocode/reverse", async (req, res) => {
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);

  if (!isFinite(lat) || !isFinite(lng)) {
    return res.status(400).json({ error: "Invalid coordinates" });
  }

  const apiKey = process.env.HERE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "Geocoding not configured" });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const r = await fetch(
      `https://revgeocode.search.hereapi.com/v1/revgeocode?at=${lat},${lng}&lang=en&limit=1&apiKey=${encodeURIComponent(apiKey)}`,
      { signal: controller.signal },
    );
    clearTimeout(timer);

    if (!r.ok) {
      return res.status(502).json({ error: "HERE geocoding failed", name: null });
    }

    const data = (await r.json()) as any;
    const item = data?.items?.[0];
    if (!item) {
      return res.json({ name: null });
    }

    // Build a constituency-style name: "Road - Area" or just "Area".
    // We intentionally avoid POI/business names (item.title) — instead we use
    // administrative boundaries at the sub-district / district level which map
    // closely to Kenyan constituencies (e.g. "Utawala", "Embakasi East").
    const addr = item.address ?? {};

    // Area: sub-district first (constituency-level in Kenya), then district,
    // then city, then county — whichever is most specific.
    const area: string | null =
      addr.subdistrict || addr.district || addr.city || addr.county || addr.state || null;

    // Road: use the street name if present.  Skip it when it equals the area
    // (some HERE responses repeat the district as the street).
    const road: string | null =
      addr.street && addr.street !== area ? addr.street : null;

    // Format: "Road - Area" when both present, otherwise just area or just road.
    let name: string | null;
    if (road && area) {
      name = `${road} - ${area}`;
    } else {
      name = area || road || null;
    }

    return res.json({ name });
  } catch {
    return res.status(502).json({ error: "Geocoding request failed", name: null });
  }
});

export default router;
