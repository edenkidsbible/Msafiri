/**
 * kenyaRoads.ts — Curated Kenyan road names + route-code → common-name mapping.
 *
 * Kenyans do not use route codes ("A1", "B9", "C13") in speech.  Every road
 * name that enters a spoken navigation instruction must be a common /
 * point-to-point name ("Kisumu-Busia Road", "Thika Superhighway").  The
 * routing engine (Google Routes API) frequently returns the bare code, so
 * `mapSpokenRoadName()` translates codes at route-build time.  A code with no
 * mapping is DROPPED (empty string) — a code must never be voiced.
 *
 * `KENYA_ROAD_NAMES` is the curated pre-generation set: the Keli voice clip
 * for each name is pre-generated and served from the API server's pregen
 * cache (see routes/tts.ts), so first-drive navigation on these roads never
 * waits on ElevenLabs.
 */

// ─── Route-code → common-name mapping ────────────────────────────────────────
// One code can span differently-named stretches, so each code maps to one or
// more segments with a rough anchor coordinate; the nearest anchor wins.
// Anchors only need to be closer to their own stretch than to the others.

interface CodeSegment {
  name: string;
  lat: number;
  lng: number;
}

const ROAD_CODE_SEGMENTS: Record<string, CodeSegment[]> = {
  // A1 — western corridor (Isebania → Kisii → Kisumu → Kakamega → Kitale → Lodwar)
  A1: [
    { name: "Isebania-Kisii Road",    lat: -1.05, lng: 34.55 },
    { name: "Kisii-Kisumu Road",      lat: -0.45, lng: 34.85 },
    { name: "Kisumu-Busia Road",      lat:  0.20, lng: 34.35 },
    { name: "Kisumu-Kakamega Road",   lat:  0.15, lng: 34.75 },
    { name: "Kakamega-Webuye Road",   lat:  0.50, lng: 34.77 },
    { name: "Webuye-Kitale Road",     lat:  0.80, lng: 34.95 },
    { name: "Kitale-Lodwar Road",     lat:  2.00, lng: 35.10 },
    { name: "Lodwar-Lokichogio Road", lat:  3.80, lng: 34.75 },
  ],
  // A2 — great north road (Nairobi → Thika → Nanyuki → Isiolo → Moyale)
  A2: [
    { name: "Thika Superhighway",   lat: -1.18, lng: 36.93 },
    { name: "Kenol-Sagana Road",    lat: -0.85, lng: 37.15 },
    { name: "Sagana-Nyeri Road",    lat: -0.55, lng: 37.10 },
    { name: "Nyeri-Nanyuki Road",   lat: -0.20, lng: 36.98 },
    { name: "Nanyuki-Isiolo Road",  lat:  0.20, lng: 37.25 },
    { name: "Isiolo-Marsabit Road", lat:  1.50, lng: 37.80 },
    { name: "Marsabit-Moyale Road", lat:  3.00, lng: 38.60 },
  ],
  // A3 — Thika → Garissa (→ Liboi)
  A3: [
    { name: "Thika-Garissa Road", lat: -0.90, lng: 38.30 },
  ],
  // A5 — Isiolo → Wajir → Mandera
  A5: [
    { name: "Isiolo-Wajir Road",  lat: 0.90, lng: 38.90 },
    { name: "Wajir-Mandera Road", lat: 2.60, lng: 40.40 },
  ],
  // A7 — Mombasa → Lunga Lunga (south coast)
  A7: [
    { name: "Mombasa-Lunga Lunga Road", lat: -4.30, lng: 39.40 },
  ],
  // A8 — Mombasa → Nairobi → Nakuru → Malaba (post-2016 numbering)
  A8: [
    { name: "Nairobi-Mombasa Road",    lat: -2.30, lng: 37.90 },
    { name: "Mombasa Road",            lat: -1.40, lng: 36.90 },
    { name: "Uhuru Highway",           lat: -1.29, lng: 36.82 },
    { name: "Waiyaki Way",             lat: -1.26, lng: 36.75 },
    { name: "Nairobi-Nakuru Highway",  lat: -0.90, lng: 36.40 },
    { name: "Nakuru-Eldoret Highway",  lat:  0.10, lng: 35.60 },
    { name: "Eldoret-Malaba Road",     lat:  0.60, lng: 34.90 },
  ],
  // A8 South / old A104 southern leg — Nairobi → Namanga
  "A8 SOUTH": [
    { name: "Nairobi-Namanga Road", lat: -2.00, lng: 36.85 },
  ],
  // A104 — pre-2016 code still returned by geocoders (Namanga → Nairobi → Malaba)
  A104: [
    { name: "Nairobi-Namanga Road",   lat: -2.00, lng: 36.85 },
    { name: "Uhuru Highway",          lat: -1.29, lng: 36.82 },
    { name: "Waiyaki Way",            lat: -1.26, lng: 36.75 },
    { name: "Nairobi-Nakuru Highway", lat: -0.90, lng: 36.40 },
    { name: "Nakuru-Eldoret Highway", lat:  0.10, lng: 35.60 },
    { name: "Eldoret-Malaba Road",    lat:  0.60, lng: 34.90 },
  ],
  // A109 — pre-2016 code for the Mombasa road
  A109: [
    { name: "Mombasa Road",         lat: -1.40, lng: 36.90 },
    { name: "Nairobi-Mombasa Road", lat: -2.30, lng: 37.90 },
  ],
  // B1 — pre-2016 lake corridor (Busia → Kisumu → Kericho → Nakuru)
  B1: [
    { name: "Kisumu-Busia Road",     lat:  0.20, lng: 34.35 },
    { name: "Kisumu-Kericho Road",   lat: -0.25, lng: 35.10 },
    { name: "Kericho-Nakuru Highway", lat: -0.30, lng: 35.60 },
  ],
  // B3 — Mai Mahiu → Narok → Bomet corridor
  B3: [
    { name: "Mai Mahiu-Narok Road", lat: -1.00, lng: 36.20 },
    { name: "Narok-Bomet Road",     lat: -1.05, lng: 35.55 },
  ],
  // C88 / old C58 — Magadi road out of Nairobi
  C88: [{ name: "Magadi Road", lat: -1.40, lng: 36.70 }],
  C58: [{ name: "Magadi Road", lat: -1.40, lng: 36.70 }],
};

/** Matches a bare route code like "A1", "B9", "C13", "A104", optionally with
 *  a space ("A 104") or a trailing letter. */
const CODE_RE = /^[A-E]\s?\d{1,4}[A-Z]?$/i;

export function isRouteCode(name: string): boolean {
  return CODE_RE.test(name.trim());
}

/** Common name for a route code near (lat, lng), or null when unmapped. */
export function commonNameForCode(
  code: string,
  lat?: number,
  lng?: number
): string | null {
  const key = code.toUpperCase().replace(/\s+/g, "");
  const segments = ROAD_CODE_SEGMENTS[key];
  if (!segments || segments.length === 0) return null;
  if (segments.length === 1 || lat == null || lng == null) return segments[0].name;
  let best = segments[0];
  let bestD = Infinity;
  for (const s of segments) {
    const d = (s.lat - lat) ** 2 + (s.lng - lng) ** 2;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best.name;
}

/**
 * Translates a routing-engine road name into what should be SPOKEN:
 *  - a bare route code  → its common name near (lat, lng), or "" if unmapped
 *    (a code must never be voiced — drop the name entirely instead)
 *  - "Name/A104" or "A104/Name" composites → the non-code part
 *  - "Name (A2)" → "Name" (parenthetical codes stripped)
 *  - anything else → unchanged
 */
/** Expands Google's abbreviations so spoken names are natural AND match the
 *  pre-generated clip set ("Ngong Rd" → "Ngong Road", "Uhuru Hwy" → "Uhuru Highway"). */
function expandAbbreviations(name: string): string {
  return name
    .replace(/\bRd\b\.?/g, "Road")
    .replace(/\bAve\b\.?/g, "Avenue")
    .replace(/\bHwy\b\.?/g, "Highway")
    .replace(/\bSt\b\.?/g, "Street")
    .replace(/\bDr\b\.?/g, "Drive")
    .replace(/\bLn\b\.?/g, "Lane")
    .replace(/\bBlvd\b\.?/g, "Boulevard")
    .replace(/\bJct\b\.?/g, "Junction");
}

export function mapSpokenRoadName(
  rawName: string,
  lat?: number,
  lng?: number
): string {
  const cleaned = expandAbbreviations(rawName ?? "")
    .replace(/\(.*?\)/g, " ")      // strip parenthetical codes "(A2)"
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";

  const parts = cleaned.split("/").map((p) => p.trim()).filter(Boolean);
  const nameParts = parts.filter((p) => !isRouteCode(p));
  // At least one proper name present — use it (whole string if nothing was a
  // code; otherwise the LAST name part, which for Kenyan slash-composites like
  // "Embu - Nairobi Hwy/Meru - Nairobi Hwy/Thika Rd/A2" is the local name).
  if (nameParts.length === parts.length) return cleaned;
  if (nameParts.length > 0) return nameParts[nameParts.length - 1];

  // Only code(s) left — translate the first mappable one, else drop.
  for (const p of parts) {
    const common = commonNameForCode(p, lat, lng);
    if (common) return common;
  }
  return "";
}

// ─── Curated pre-generation set ───────────────────────────────────────────────
// ~280 names: major Nairobi roads & avenues, Kiambu county's main roads, and
// Kenya's national highways as point-to-point names.  Zero route codes.
// Names avoid apostrophes/periods so the mobile title-case transform
// (lowercase → /\b\w/ uppercase) reproduces them exactly.

export const KENYA_ROAD_NAMES: string[] = [
  // ── Nairobi CBD ────────────────────────────────────────────────────────────
  "Uhuru Highway", "Kenyatta Avenue", "Moi Avenue", "Haile Selassie Avenue",
  "Tom Mboya Street", "Ronald Ngala Street", "River Road", "Luthuli Avenue",
  "Kimathi Street", "Muindi Mbingu Street", "Koinange Street", "Wabera Street",
  "Mama Ngina Street", "City Hall Way", "Harambee Avenue", "Parliament Road",
  "Taifa Road", "University Way", "Kijabe Street", "Loita Street",
  "Monrovia Street", "Banda Street", "Standard Street", "Kaunda Street",
  "Accra Road", "Latema Road", "Duruma Road", "Racecourse Road",
  "Landhies Road", "Pumwani Road", "Kirinyaga Road", "Kipande Road",
  "Ngara Road", "Park Road", "Muranga Road", "Desai Road",
  // ── Nairobi arterials & ring roads ─────────────────────────────────────────
  "Waiyaki Way", "Thika Superhighway", "Mombasa Road", "Ngong Road",
  "Langata Road", "Jogoo Road", "Juja Road", "Kiambu Road", "Limuru Road",
  "Kangundo Road", "Outer Ring Road", "Eastern Bypass", "Northern Bypass",
  "Southern Bypass", "Western Bypass", "Nairobi Expressway",
  "Raila Odinga Way", "Mbagathi Way", "Mbagathi Road", "Valley Road",
  "Nyerere Road", "Kenyatta Market Road", "Lower Hill Road", "Bunyala Road",
  "Workshop Road", "Haile Selassie Roundabout",
  // ── Westlands / Parklands / Gigiri ─────────────────────────────────────────
  "Chiromo Road", "Riverside Drive", "Museum Hill Road", "Parklands Road",
  "Ring Road Parklands", "Ring Road Westlands", "Mpaka Road", "Westlands Road",
  "Muthithi Road", "Ojijo Road", "Rhapta Road", "School Lane",
  "Brookside Drive", "General Mathenge Drive", "Peponi Road",
  "Lower Kabete Road", "Spring Valley Road", "Raphta Road", "Church Road",
  "Wangari Maathai Road", "Forest Road", "Limuru Road Gigiri",
  "United Nations Avenue", "Gigiri Road", "Ruaka Road", "Karura Ridge Road",
  "First Parklands Avenue", "Second Parklands Avenue", "Third Parklands Avenue",
  "Ngong Avenue", "Processional Way", "State House Road", "Arboretum Drive",
  // ── Kilimani / Kileleshwa / Lavington / Hurlingham ─────────────────────────
  "Ralph Bunche Road", "Argwings Kodhek Road", "Lenana Road",
  "Dennis Pritt Road", "Milimani Road", "Kindaruma Road", "Kirichwa Road",
  "Elgeyo Marakwet Road", "Riara Road", "Kabarnet Road", "Wood Avenue",
  "Rose Avenue", "Chaka Road", "Ring Road Kilimani", "Ring Road Kileleshwa",
  "Oloitokitok Road", "Gitanga Road", "James Gichuru Road", "Kingara Road",
  "Muthangari Drive", "Muthangari Road", "Amboseli Road", "Mzima Springs Road",
  "Hatheru Road", "Laikipia Road", "Mandera Road", "Othaya Road",
  // ── Karen / Langata / South Nairobi ────────────────────────────────────────
  "Karen Road", "Magadi Road", "Bogani Road", "Ndege Road", "Marula Lane",
  "Langata South Road", "Ole Sangale Road", "Muhoho Avenue", "Popo Road",
  "Mai Mahiu Road", "Kikuyu Road", "Naivasha Road", "Dagoretti Road",
  "Thogoto Road", "Karen Plains Road", "Mukoma Road", "Hardy Road",
  "Kerarapon Drive", "Ngong Town Road",
  // ── Eastlands / Industrial Area ────────────────────────────────────────────
  "Enterprise Road", "Likoni Road", "Lunga Lunga Road", "Lusaka Road",
  "Baba Dogo Road", "Komarock Road", "Spine Road", "Manyanja Road",
  "Rabai Road", "Heshima Road", "First Avenue Eastleigh",
  "General Waruinge Street", "Eastleigh Airbase Road", "Airport North Road",
  "Airport South Road", "Katani Road", "Mombasa Road Mlolongo",
  "Kayole Road", "Umoja Market Road", "Moi Drive", "Kangaru Road",
  "Dandora Road", "Kariobangi Road",
  // ── North Nairobi ──────────────────────────────────────────────────────────
  "Kamiti Road", "Garden Estate Road", "Thome Road", "Marurui Road",
  "Kigwa Road", "Ridgeways Road", "Mirema Drive", "Kasarani Road",
  "Mwiki Road", "Lumumba Drive", "Githurai Road", "Seasons Road",
  // ── Kiambu county ──────────────────────────────────────────────────────────
  "Ruiru-Kiambu Road", "Kiambu-Limuru Road", "Ndumberi Road",
  "Githunguri Road", "Ruiru-Githunguri Road", "Gatundu Road",
  "Kenyatta Road", "Juja Farm Road", "Tigoni Road", "Red Hill Road",
  "Ngecha Road", "Wangige Road", "Kingeero Road", "Gachie Road",
  "Ndenderu Road", "Kihara Road", "Banana Road", "Karuri Road",
  "Thogoto-Mutarakwa Road", "Gitaru Road", "Uthiru Road", "Kinoo Road",
  "Muthiga Road", "Zambezi Road", "Kikuyu Town Road", "Ondiri Road",
  "Thika-Gatanga Road", "Thika-Mangu Road", "Gatukuyu Road",
  "Kamwangi Road", "Kirigiti Road", "Riabai Road", "Limuru-Uplands Road",
  "Kwamaiko Road", "Komothai Road", "Kagwe Road", "Lari Road",
  // ── National highways (point-to-point names, never codes) ─────────────────
  "Nairobi-Mombasa Road", "Nairobi-Nakuru Highway", "Nakuru-Eldoret Highway",
  "Eldoret-Malaba Road", "Eldoret-Kitale Road", "Kisumu-Busia Road",
  "Kisumu-Kakamega Road", "Kakamega-Webuye Road", "Webuye-Kitale Road",
  "Kisumu-Kericho Road", "Kericho-Nakuru Highway", "Nakuru-Nyahururu Road",
  "Nyahururu-Nyeri Road", "Nairobi-Namanga Road", "Emali-Loitokitok Road",
  "Voi-Taveta Road", "Mombasa-Malindi Road", "Malindi-Lamu Road",
  "Mombasa-Lunga Lunga Road", "Thika-Garissa Road", "Kenol-Sagana Road",
  "Sagana-Nyeri Road", "Nyeri-Nanyuki Road", "Nanyuki-Isiolo Road",
  "Isiolo-Marsabit Road", "Marsabit-Moyale Road", "Kenol-Embu Road",
  "Embu-Meru Road", "Meru-Maua Road", "Kibwezi-Kitui Road", "Kitui Road",
  "Machakos Road", "Wote Road", "Isebania-Kisii Road", "Kisii-Kisumu Road",
  "Ahero-Kisii Road", "Kisii-Kilgoris Road", "Kitale-Lodwar Road",
  "Lodwar-Lokichogio Road", "Mai Mahiu-Narok Road", "Narok-Bomet Road",
  "Naivasha-Mai Mahiu Road", "Moi South Lake Road", "Nakuru-Marigat Road",
  "Eldama Ravine Road", "Kapsabet Road", "Nandi Hills Road",
  "Kericho-Kisii Road", "Bomet-Sotik Road", "Kapenguria Road",
  "Isiolo-Wajir Road", "Wajir-Mandera Road", "Garissa Road",
  "Dongo Kundu Bypass", "Nyali Road", "Links Road", "Digo Road",
  "Mama Ngina Drive", "Nyali Bridge", "Jomo Kenyatta Avenue",
  "Oginga Odinga Street", "Uganda Road", "Kisumu-Bondo Road",
  "Kakamega-Kisii Road", "Bungoma Road", "Mumias Road", "Busia Road",
  "Siaya Road", "Homa Bay Road", "Migori Road", "Kilifi Road",
  "Watamu Road", "Diani Beach Road", "Likoni Ferry Road", "Port Reitz Road",
  "Moi International Airport Road", "Jomo Kenyatta International Airport Road",
];
