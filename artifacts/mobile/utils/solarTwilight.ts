/**
 * On-device civil twilight detection using the NOAA simplified solar position
 * algorithm (low-precision variant). No network call required.
 *
 * Accurate to within ±2 minutes for latitudes between ±66° — more than
 * sufficient for auto-switching the drive-screen night mode.
 *
 * Reference: https://gml.noaa.gov/grad/solcalc/calcdetails.html
 */

const DEG = Math.PI / 180;

/**
 * Returns the solar elevation angle in degrees at the given WGS-84 position
 * and UTC instant. Positive values are above the horizon, negative below.
 */
export function solarElevationDeg(lat: number, lng: number, date: Date): number {
  // Julian day number
  const JD = date.getTime() / 86_400_000 + 2_440_587.5;
  // Days since J2000.0 epoch (1 Jan 2000, 12:00 TT)
  const n = JD - 2_451_545.0;

  // Geometric mean longitude of the Sun (degrees, [0, 360))
  const L = (280.460 + 0.9856474 * n) % 360;
  // Mean anomaly of the Sun (radians)
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG;

  // Ecliptic longitude (radians) — first-order equation of centre
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;

  // Mean obliquity of the ecliptic (radians)
  const eps = (23.439 - 4e-7 * n) * DEG;

  // Geocentric right ascension (radians) and declination (radians)
  const RA   = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));

  // Greenwich Mean Sidereal Time (hours)
  const UT   = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const GMST = (6.697375 + 0.0657098242 * n + UT + 24) % 24;

  // Local Mean Sidereal Time (hours)
  const LMST = (GMST + lng / 15 + 24) % 24;

  // Local Hour Angle (hours → degrees, folded to [−180, 180] → radians)
  const RA_h  = ((RA / DEG / 15) + 24) % 24;       // RA in hours [0, 24)
  let   H_deg = ((LMST - RA_h) * 15 + 360) % 360;  // Hour angle [0, 360)
  if (H_deg > 180) H_deg -= 360;                    // fold to [−180, 180]
  const H = H_deg * DEG;

  // Solar elevation angle (radians → degrees)
  const latRad  = lat * DEG;
  const sinElev = Math.sin(latRad) * Math.sin(decl)
                + Math.cos(latRad) * Math.cos(decl) * Math.cos(H);

  return Math.asin(Math.max(-1, Math.min(1, sinElev))) / DEG;
}

/**
 * Returns `true` when the sun is below −6° (civil twilight or darker) at the
 * given position and time — the conventional threshold for switching to night
 * mode in navigation apps.
 */
export function isCivilTwilight(lat: number, lng: number, date: Date): boolean {
  return solarElevationDeg(lat, lng, date) < -6;
}
