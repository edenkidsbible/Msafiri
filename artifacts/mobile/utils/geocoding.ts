import { fetchWithTimeout } from "@/utils/fetchTimeout";

/** Reverse-geocode a lat/lng to a short human-readable place name.
 *  Uses Photon (komoot) which is open and requires no API key.
 *  Returns an empty string on failure. */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`;
    const res  = await fetchWithTimeout(url, {}, 9000);
    const data = await res.json() as { features?: any[] };
    const feature = data.features?.[0];
    if (!feature) return "";
    const p    = feature.properties ?? {};
    const name = (p.name as string) ?? (p.street as string) ?? "";
    const city = (p.city as string) ?? (p.county as string) ?? (p.district as string) ?? "";
    return [name, city].filter(Boolean).join(", ").substring(0, 60);
  } catch {
    return "";
  }
}

export interface GeoResult {
  display: string;
  short: string;
  lat: number;
  lng: number;
}

/** Google Places Text Search proxied through our API server. Falls back to
 *  Photon (komoot) on error — Photon works from the Replit server environment
 *  unlike Nominatim which returns 403. */
export async function nominatimSearch(q: string): Promise<GeoResult[]> {
  return googlePlacesSearch(q);
}

async function googlePlacesSearch(q: string): Promise<GeoResult[]> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN ?? "";
  const base   = domain ? `https://${domain}/api` : "/api";
  const url    = `${base}/places/search?q=${encodeURIComponent(q)}`;

  try {
    const res  = await fetchWithTimeout(url, {}, 9000);
    const data = await res.json() as { results?: any[]; error?: string };
    if (data.error || !data.results?.length) throw new Error(data.error ?? "empty");
    return data.results.map((r: any) => {
      const name    = (r.name as string) ?? "";
      const address = (r.formatted_address as string) ?? "";
      const parts   = address.split(",");
      const short   = [name, parts[0]?.trim()].filter(Boolean).join(", ").substring(0, 80);
      const display = [name, address].filter(Boolean).join(", ");
      const loc     = r.geometry?.location ?? {};
      return {
        display,
        short,
        lat: Number(loc.lat) || 0,
        lng: Number(loc.lng) || 0,
      };
    }).filter((r: GeoResult) => r.lat !== 0 || r.lng !== 0);
  } catch {
    // Google Places proxy failed — fall back to Photon which is reliably
    // reachable from the Replit server environment (Nominatim blocks our IPs).
    return photonFallback(q);
  }
}

/** Photon geocoder (https://photon.komoot.io) — open, no key required.
 *  Biased to Kenya's bounding box so results stay local. */
async function photonFallback(q: string): Promise<GeoResult[]> {
  // Kenya bounding box: roughly SW (33.9°E, 4.7°S) → NE (41.9°E, 4.7°N)
  const url =
    `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}` +
    `&limit=7&bbox=33.9,-4.7,41.9,4.7`;
  try {
    const res  = await fetchWithTimeout(url, {}, 9000);
    const data = await res.json() as { features?: any[] };
    if (!Array.isArray(data.features)) return [];
    return data.features
      .map((f: any) => {
        const p    = f.properties ?? {};
        const name = (p.name as string) ?? "";
        const city = (p.city as string) ?? (p.county as string) ?? "";
        const country = (p.country as string) ?? "";
        const display = [name, city, country].filter(Boolean).join(", ");
        const short   = [name, city].filter(Boolean).join(", ").substring(0, 80);
        const [lng, lat] = (f.geometry?.coordinates as [number, number]) ?? [0, 0];
        return { display, short, lat: Number(lat) || 0, lng: Number(lng) || 0 };
      })
      .filter((r: GeoResult) => r.lat !== 0 || r.lng !== 0);
  } catch {
    return [];
  }
}
