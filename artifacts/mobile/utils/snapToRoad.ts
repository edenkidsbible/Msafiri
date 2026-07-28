const MAPBOX_DIRECTIONS =
  "https://api.mapbox.com/directions/v5/mapbox/driving";

/**
 * Snaps a coordinate to the nearest driveable road using the Mapbox
 * Directions API.  Sending the same point as both origin and destination
 * causes Mapbox to return a waypoint that has been snapped to the closest
 * road — equivalent to OSRM's /nearest endpoint.
 *
 * Returns the original coordinate unchanged if the service is unavailable.
 */
export async function snapToRoad(
  lat: number,
  lng: number
): Promise<{ lat: number; lng: number }> {
  const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
  if (!token) return { lat, lng };

  try {
    const coord = `${lng},${lat}`;
    const url = `${MAPBOX_DIRECTIONS}/${coord};${coord}?access_token=${token}&overview=false`;
    const res = await fetch(url);
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
