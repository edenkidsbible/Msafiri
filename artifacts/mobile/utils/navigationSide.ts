/**
 * navigationSide.ts — Destination side-of-road helper
 *
 * Determines whether the destination is on the driver's left or right
 * based on the driver's heading and the bearing from the driver to the
 * destination. Used to append "Your destination is on the left/right"
 * to the arrival announcement.
 */

// ─── Geometry helpers (self-contained, no external deps) ─────────────────────

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180;
  const f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Initial bearing (0–360°) from point A to point B. */
function initialBearing(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const f1 = (fromLat * Math.PI) / 180;
  const f2 = (toLat * Math.PI) / 180;
  const dl = ((toLng - fromLng) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns which side of the road the destination falls on relative to the
 * driver's direction of travel.
 *
 * @param driverHeading  Current heading in degrees (0–360°). Pass `null` when
 *                       unavailable — the function will return `null` safely.
 * @param driverLat      Driver's current latitude.
 * @param driverLng      Driver's current longitude.
 * @param destLat        Destination latitude.
 * @param destLng        Destination longitude.
 *
 * @returns `"left"` | `"right"` | `null`
 *   - `null` is returned when the heading is unavailable, when the driver is
 *     already at the destination (< 5 m — bearing is meaningless at this range),
 *     or when the bearing is within ±10° of the heading (straight ahead / behind,
 *     so neither "left" nor "right" is reliable).
 */
export function getDestinationSide(
  driverHeading: number | null,
  driverLat: number,
  driverLng: number,
  destLat: number,
  destLng: number,
): "left" | "right" | null {
  if (driverHeading == null) return null;

  // Destination too close — GPS jitter makes bearing unreliable.
  const distM = haversineM(driverLat, driverLng, destLat, destLng);
  if (distM < 5) return null;

  const bearing = initialBearing(driverLat, driverLng, destLat, destLng);

  // Signed angular difference: positive → right of heading, negative → left.
  // Formula: wrap to (−180, +180] range.
  const signed = ((bearing - driverHeading + 540) % 360) - 180;

  // Within ±10° of straight-ahead or straight-behind — don't call a side.
  if (Math.abs(signed) < 10 || Math.abs(signed) > 170) return null;

  return signed > 0 ? "right" : "left";
}
