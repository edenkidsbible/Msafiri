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
