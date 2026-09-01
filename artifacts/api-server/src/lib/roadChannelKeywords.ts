export interface VoiceKeywordMatch {
  type: string;
  keyword: string;
}

const KEYWORDS_BY_TYPE: Array<{ type: string; keywords: string[] }> = [
  // Keep more specific enforcement terms before broad road-condition terms.
  { type: "camera", keywords: ["speed camera", "speed trap", "camera", "cameras", "radar", "kamera"] },
  { type: "accident", keywords: ["road accident", "traffic accident", "accident", "crash", "collision", "crashed", "ajali", "mgongano"] },
  { type: "police", keywords: ["police checkpoint", "police roadblock", "checkpoint", "roadblock", "police", "polisi", "askari"] },
  { type: "roadworks", keywords: ["roadworks", "road work", "road construction", "road repair", "construction", "repairs", "ujenzi", "matengenezo"] },
  { type: "breakdown", keywords: ["broken down", "breakdown", "stalled", "vehicle stopped", "gari imeharibika", "imeharibika", "imekwama"] },
  { type: "weather", keywords: ["flooding", "flooded", "flood", "water on road", "heavy rain", "rain", "mafuriko", "mvua"] },
  { type: "hazard", keywords: ["pothole", "potholes", "debris", "obstacle", "hazard", "danger", "shimo", "mashimo", "kifusi", "kizuizi"] },
  { type: "traffic", keywords: ["traffic jam", "traffic", "congestion", "foleni", "msongamano"] },
];

function normalizeTranscript(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function detectVoiceReportType(transcript: string): VoiceKeywordMatch | null {
  const normalized = normalizeTranscript(transcript);
  if (!normalized) return null;
  const padded = ` ${normalized} `;

  for (const entry of KEYWORDS_BY_TYPE) {
    for (const keyword of entry.keywords) {
      const normalizedKeyword = normalizeTranscript(keyword);
      if (padded.includes(` ${normalizedKeyword} `)) {
        return { type: entry.type, keyword };
      }
    }
  }
  return null;
}