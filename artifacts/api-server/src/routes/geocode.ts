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

/**
 * Call Photon (komoot) reverse geocode and return the most specific area name.
 * Priority: city → town → locality → suburb → village → hamlet → district → county
 * Returns null if the call fails or no result is found.
 */
async function photonReverse(lat: number, lng: number, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(
      `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
    if (!r.ok) return null;
    const data = await r.json() as { features?: any[] };
    const feature = data.features?.[0];
    if (!feature) return null;
    const p = feature.properties ?? {};
    return (
      (p.city as string | undefined) ??
      (p.town as string | undefined) ??
      (p.locality as string | undefined) ??
      (p.suburb as string | undefined) ??
      (p.village as string | undefined) ??
      (p.hamlet as string | undefined) ??
      (p.district as string | undefined) ??
      (p.county as string | undefined) ??
      null
    );
  } catch {
    clearTimeout(timer);
    return null;
  }
}

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
    let area: string | null =
      addr.subdistrict || addr.district || addr.city || addr.county || addr.state || null;

    // Detect when HERE only resolved to county/state level (no sub-county data).
    // In that case, try Photon for a finer-grained area name.
    const hereIsCoarseOnly = !addr.subdistrict && !addr.district && !addr.city;
    if (hereIsCoarseOnly) {
      const photonArea = await photonReverse(lat, lng, 3000);
      if (photonArea) {
        area = photonArea;
      }
    }

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
