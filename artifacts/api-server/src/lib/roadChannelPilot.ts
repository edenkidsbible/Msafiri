export type RoadChannelDirection = "inbound" | "outbound" | "unknown";

export interface PilotCorridor {
  id: string;
  name: string;
  aliases: string[];
  /** Approximate bearing away from Nairobi/city centre for direction labels. */
  outboundBearing: number;
  /** Centre-line samples used for privacy-safe nearby discovery. */
  path: Array<{ lat: number; lng: number }>;
}

export const PILOT_CORRIDORS: PilotCorridor[] = [
  { id: "thika-superhighway", name: "Thika Superhighway", aliases: ["thika road", "a2"], outboundBearing: 25, path: [
    { lat: -1.270, lng: 36.842 }, { lat: -1.220, lng: 36.886 }, { lat: -1.151, lng: 36.958 }, { lat: -1.102, lng: 37.014 }, { lat: -1.039, lng: 37.083 },
  ] },
  { id: "mombasa-road", name: "Mombasa Road", aliases: ["nairobi mombasa road", "a8", "a109"], outboundBearing: 130, path: [
    { lat: -1.292, lng: 36.822 }, { lat: -1.326, lng: 36.843 }, { lat: -1.331, lng: 36.900 }, { lat: -1.368, lng: 36.937 }, { lat: -1.456, lng: 36.982 },
  ] },
  { id: "nairobi-expressway", name: "Nairobi Expressway", aliases: ["expressway"], outboundBearing: 125, path: [
    { lat: -1.267, lng: 36.803 }, { lat: -1.292, lng: 36.822 }, { lat: -1.326, lng: 36.843 }, { lat: -1.331, lng: 36.900 }, { lat: -1.368, lng: 36.937 },
  ] },
  { id: "waiyaki-way", name: "Waiyaki Way", aliases: ["a104"], outboundBearing: 300, path: [
    { lat: -1.283, lng: 36.821 }, { lat: -1.267, lng: 36.802 }, { lat: -1.265, lng: 36.750 }, { lat: -1.246, lng: 36.664 },
  ] },
  { id: "ngong-road", name: "Ngong Road", aliases: [], outboundBearing: 235, path: [
    { lat: -1.292, lng: 36.823 }, { lat: -1.300, lng: 36.787 }, { lat: -1.302, lng: 36.741 }, { lat: -1.322, lng: 36.705 },
  ] },
  { id: "langata-road", name: "Lang'ata Road", aliases: ["langata road"], outboundBearing: 225, path: [
    { lat: -1.292, lng: 36.822 }, { lat: -1.314, lng: 36.817 }, { lat: -1.333, lng: 36.779 }, { lat: -1.364, lng: 36.735 },
  ] },
  { id: "kiambu-road", name: "Kiambu Road", aliases: [], outboundBearing: 5, path: [
    { lat: -1.250, lng: 36.811 }, { lat: -1.222, lng: 36.824 }, { lat: -1.176, lng: 36.835 }, { lat: -1.124, lng: 36.830 },
  ] },
  { id: "limuru-road", name: "Limuru Road", aliases: [], outboundBearing: 325, path: [
    { lat: -1.257, lng: 36.815 }, { lat: -1.235, lng: 36.791 }, { lat: -1.205, lng: 36.768 }, { lat: -1.155, lng: 36.735 }, { lat: -1.110, lng: 36.641 },
  ] },
  { id: "eastern-bypass", name: "Eastern Bypass", aliases: ["eastern bypass road", "c100"], outboundBearing: 25, path: [
    { lat: -1.151, lng: 36.958 }, { lat: -1.184, lng: 36.966 }, { lat: -1.221, lng: 36.981 }, { lat: -1.278, lng: 36.965 }, { lat: -1.335, lng: 36.925 },
  ] },
  { id: "northern-bypass", name: "Northern Bypass", aliases: [], outboundBearing: 285, path: [
    { lat: -1.206, lng: 36.776 }, { lat: -1.218, lng: 36.806 }, { lat: -1.201, lng: 36.842 }, { lat: -1.184, lng: 36.900 }, { lat: -1.151, lng: 36.958 },
  ] },
  { id: "southern-bypass", name: "Southern Bypass", aliases: [], outboundBearing: 290, path: [
    { lat: -1.254, lng: 36.677 }, { lat: -1.309, lng: 36.734 }, { lat: -1.337, lng: 36.776 }, { lat: -1.325, lng: 36.844 },
  ] },
  { id: "kangundo-road", name: "Kangundo Road", aliases: [], outboundBearing: 75, path: [
    { lat: -1.286, lng: 36.875 }, { lat: -1.268, lng: 36.912 }, { lat: -1.257, lng: 37.014 }, { lat: -1.278, lng: 37.115 },
  ] },
];

function distanceToSegmentM(
  lat: number,
  lng: number,
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
): number {
  const metresPerLat = 111_320;
  const metresPerLng = metresPerLat * Math.cos((lat * Math.PI) / 180);
  const px = (lng - start.lng) * metresPerLng;
  const py = (lat - start.lat) * metresPerLat;
  const vx = (end.lng - start.lng) * metresPerLng;
  const vy = (end.lat - start.lat) * metresPerLat;
  const lengthSquared = vx * vx + vy * vy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (px * vx + py * vy) / lengthSquared));
  return Math.hypot(px - t * vx, py - t * vy);
}

export function nearbyPilotCorridors(
  lat: number,
  lng: number,
  radiusM = 5_000,
): Array<{ corridor: PilotCorridor; distanceM: number }> {
  return PILOT_CORRIDORS
    .map((corridor) => ({
      corridor,
      distanceM: corridor.path.length < 2
        ? Number.POSITIVE_INFINITY
        : Math.min(...corridor.path.slice(1).map((point, index) =>
            distanceToSegmentM(lat, lng, corridor.path[index]!, point))),
    }))
    .filter(({ distanceM }) => distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM);
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
    .replace(/[–—-]/g, " ")
    .replace(/[()]/g, " ")
    .replace(/\b(highway|road|rd|route)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const BY_ALIAS = new Map<string, PilotCorridor>();
for (const corridor of PILOT_CORRIDORS) {
  for (const alias of [corridor.id.replace(/-/g, " "), corridor.name, ...corridor.aliases]) {
    BY_ALIAS.set(normalize(alias), corridor);
  }
}

export function resolvePilotCorridor(value: unknown): PilotCorridor | null {
  if (typeof value !== "string") return null;
  const normalized = normalize(value);
  const exact = BY_ALIAS.get(normalized);
  if (exact) return exact;

  // Reverse geocoders commonly decorate a road with a route code or locality,
  // e.g. "Eastern Bypass Road (C100)" or "A2 Thika Superhighway".
  // Accept a catalog alias as a complete word sequence, never as a substring
  // inside another word.
  for (const [alias, corridor] of BY_ALIAS) {
    if (alias.length >= 3 && (` ${normalized} `).includes(` ${alias} `)) return corridor;
  }
  return null;
}

export function pilotDirection(corridor: PilotCorridor, heading: unknown): RoadChannelDirection {
  if (typeof heading !== "number" || !Number.isFinite(heading)) return "unknown";
  const delta = Math.abs((((heading - corridor.outboundBearing) % 360) + 540) % 360 - 180);
  if (delta <= 65) return "outbound";
  if (delta >= 115) return "inbound";
  return "unknown";
}

export function shouldHandoff(currentId: string | null, candidateIds: string[], requiredStableFixes = 2): boolean {
  if (!currentId || candidateIds.length < requiredStableFixes) return false;
  const recent = candidateIds.slice(-requiredStableFixes);
  return recent.every((id) => id === recent[0] && id !== currentId);
}