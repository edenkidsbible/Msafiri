import { API_BASE } from "./apiClient";

/**
 * Snaps a coordinate to the nearest driveable road using the Google Roads API
 * (proxied through the API server so the key stays server-side).
 * Returns the original coordinate unchanged if the service is unavailable.
 */
export async function snapToRoad(
  lat: number,
  lng: number
): Promise<{ lat: number; lng: number }> {
  try {
    if (!API_BASE) return { lat, lng };
    const res = await fetch(
      `${API_BASE}/routing/snap?lat=${lat}&lng=${lng}`
    );
    if (!res.ok) return { lat, lng };
    return (await res.json()) as { lat: number; lng: number };
  } catch {
    return { lat, lng };
  }
}

/**
 * Reverse-geocodes a GPS coordinate to the name of the road the driver is on.
 * Returns null when the road cannot be determined (offline, API error, no key).
 * Callers should treat null as "unknown" and fall back to distance-only logic.
 */
export async function getRoadName(
  lat: number,
  lng: number
): Promise<string | null> {
  try {
    if (!API_BASE) return null;
    const res = await fetch(
      `${API_BASE}/routing/road-name?lat=${lat}&lng=${lng}`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { road: string | null };
    return data.road ?? null;
  } catch {
    return null;
  }
}
