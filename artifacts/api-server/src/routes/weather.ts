/**
 * weather.ts — Current weather for the mobile home screen / map chip.
 *
 * GET /weather?lat=&lng=
 *   → { tempC, description, weatherCode, locality }
 *
 * Weather comes from Open-Meteo (same integration pattern as the Crash
 * Assistant's weather snapshot); locality is a best-effort reverse geocode
 * via the Google Geocoding API (same key as routing). Either half can fail
 * independently — the endpoint always answers 200 with nulls rather than
 * erroring, so the client can fall back gracefully.
 */

import { Router, type IRouter } from "express";

const router: IRouter = Router();

function wmoCodeToDescription(code: number): string {
  if (code === 0) return "Clear sky";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Foggy";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Rain showers";
  if (code <= 86) return "Snow showers";
  if (code >= 95) return "Thunderstorm";
  return "Overcast";
}

function parseCoord(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

async function fetchCurrentWeather(lat: number, lng: number): Promise<{
  tempC: number; weatherCode: number; description: string;
} | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&forecast_days=1`;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const data = await r.json() as { current_weather?: { temperature: number; weathercode: number } };
    const cw = data.current_weather;
    if (!cw) return null;
    return {
      tempC: Math.round(cw.temperature),
      weatherCode: cw.weathercode,
      description: wmoCodeToDescription(cw.weathercode),
    };
  } catch {
    return null;
  }
}

/** Fallback locality lookup via Photon (OSM) when Google is unavailable. */
async function fetchLocalityPhoton(lat: number, lng: number): Promise<string | null> {
  try {
    const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const data = await r.json() as any;
    const props = data.features?.[0]?.properties;
    return (props?.city ?? props?.district ?? props?.county ?? props?.name ?? null) as string | null;
  } catch {
    return null;
  }
}

async function fetchLocalityGoogle(lat: number, lng: number): Promise<string | null> {
  const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (!apiKey) return null;
  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?latlng=${lat},${lng}&result_type=locality|sublocality|administrative_area_level_2&key=${apiKey}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const data = await r.json() as any;
    for (const result of data.results ?? []) {
      const comp = result.address_components?.find(
        (c: any) => Array.isArray(c.types) &&
          (c.types.includes("locality") || c.types.includes("sublocality") || c.types.includes("administrative_area_level_2"))
      );
      if (comp?.long_name) return comp.long_name as string;
    }
    return null;
  } catch {
    return null;
  }
}

router.get("/weather", async (req, res) => {
  const lat = parseCoord(req.query.lat);
  const lng = parseCoord(req.query.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: "Invalid lat/lng" });
  }

  const [weather, googleLocality] = await Promise.all([
    fetchCurrentWeather(lat, lng),
    fetchLocalityGoogle(lat, lng),
  ]);
  const locality = googleLocality ?? await fetchLocalityPhoton(lat, lng);

  return res.json({
    tempC:       weather?.tempC ?? null,
    description: weather?.description ?? null,
    weatherCode: weather?.weatherCode ?? null,
    locality,
  });
});

export default router;
