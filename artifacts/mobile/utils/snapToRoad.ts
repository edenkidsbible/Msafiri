const OSRM = "https://router.project-osrm.org/nearest/v1/driving";

/**
 * Snaps a coordinate to the nearest driveable road using the public OSRM API.
 * Returns the original coordinate unchanged if the service is unavailable.
 */
export async function snapToRoad(
  lat: number,
  lng: number
): Promise<{ lat: number; lng: number }> {
  try {
    const res = await fetch(`${OSRM}/${lng},${lat}?number=1`);
    if (!res.ok) return { lat, lng };
    const j = (await res.json()) as {
      waypoints?: Array<{ location: [number, number] }>;
    };
    const wp = j.waypoints?.[0];
    if (!wp?.location?.length) return { lat, lng };
    return { lat: wp.location[1], lng: wp.location[0] };
  } catch {
    return { lat, lng };
  }
}
