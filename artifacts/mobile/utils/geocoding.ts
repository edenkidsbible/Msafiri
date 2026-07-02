import { fetchWithTimeout } from "@/utils/fetchTimeout";

export interface GeoResult {
  display: string;
  short: string;
  lat: number;
  lng: number;
}

export async function nominatimSearch(q: string): Promise<GeoResult[]> {
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&limit=7&countrycodes=ke` +
    `&q=${encodeURIComponent(q)}`;
  const res = await fetchWithTimeout(
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
}
