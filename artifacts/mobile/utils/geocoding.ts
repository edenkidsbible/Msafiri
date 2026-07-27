import { fetchWithTimeout } from "@/utils/fetchTimeout";

export interface GeoResult {
  display: string;
  short: string;
  lat: number;
  lng: number;
}

/** Google Places Text Search proxied through our API server. Falls back to
 *  Nominatim on error so the search box never goes entirely dark. */
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
    // Fallback to Nominatim when the proxy is unreachable (e.g. dev without network)
    return nominatimFallback(q);
  }
}

async function nominatimFallback(q: string): Promise<GeoResult[]> {
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&limit=7&countrycodes=ke` +
    `&q=${encodeURIComponent(q)}`;
  try {
    const res  = await fetchWithTimeout(
      url,
      { headers: { "User-Agent": "MsafiriKenya/1.0", "Accept-Language": "en" } },
      9000
    );
    const data = await res.json();
    return (data as any[]).map((r) => {
      const parts = (r.display_name as string).split(",");
      const short = parts.slice(0, 2).join(",").trim();
      return { display: r.display_name as string, short, lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
    });
  } catch {
    return [];
  }
}
