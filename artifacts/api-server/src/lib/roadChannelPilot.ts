export type RoadChannelDirection = "inbound" | "outbound" | "unknown";

export interface PilotCorridor {
  id: string;
  name: string;
  aliases: string[];
  /** Approximate bearing away from Nairobi/city centre for direction labels. */
  outboundBearing: number;
}

export const PILOT_CORRIDORS: PilotCorridor[] = [
  { id: "thika-superhighway", name: "Thika Superhighway", aliases: ["thika road", "a2"], outboundBearing: 25 },
  { id: "mombasa-road", name: "Mombasa Road", aliases: ["nairobi mombasa road", "a8", "a109"], outboundBearing: 130 },
  { id: "nairobi-expressway", name: "Nairobi Expressway", aliases: ["expressway"], outboundBearing: 125 },
  { id: "waiyaki-way", name: "Waiyaki Way", aliases: ["a104"], outboundBearing: 300 },
  { id: "ngong-road", name: "Ngong Road", aliases: [], outboundBearing: 235 },
  { id: "langata-road", name: "Lang'ata Road", aliases: ["langata road"], outboundBearing: 225 },
  { id: "kiambu-road", name: "Kiambu Road", aliases: [], outboundBearing: 5 },
  { id: "limuru-road", name: "Limuru Road", aliases: [], outboundBearing: 325 },
  { id: "eastern-bypass", name: "Eastern Bypass", aliases: [], outboundBearing: 25 },
  { id: "northern-bypass", name: "Northern Bypass", aliases: [], outboundBearing: 285 },
  { id: "southern-bypass", name: "Southern Bypass", aliases: [], outboundBearing: 290 },
  { id: "kangundo-road", name: "Kangundo Road", aliases: [], outboundBearing: 75 },
];

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[–—-]/g, " ").replace(/[()]/g, " ").replace(/\s+/g, " ");
}

const BY_ALIAS = new Map<string, PilotCorridor>();
for (const corridor of PILOT_CORRIDORS) {
  for (const alias of [corridor.id.replace(/-/g, " "), corridor.name, ...corridor.aliases]) {
    BY_ALIAS.set(normalize(alias), corridor);
  }
}

export function resolvePilotCorridor(value: unknown): PilotCorridor | null {
  if (typeof value !== "string") return null;
  return BY_ALIAS.get(normalize(value)) ?? null;
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