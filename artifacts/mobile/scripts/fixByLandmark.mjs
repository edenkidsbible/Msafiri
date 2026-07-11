#!/usr/bin/env node
/**
 * Landmark-grounded fixer for speedZones.ts
 *
 * Corrects BOTH failure modes the old validator missed:
 *   - cross-road offset (camera on the wrong road)      -> snap to road centreline
 *   - along-road offset (right road, km too far along)   -> project the REAL named
 *                                                           landmark onto the road
 *
 * Pipeline per zone:
 *   1. Extract landmark term(s) from the name (two-point "X / Y" => a segment).
 *   2. Geocode each via Photon, biased to the stored coord, hard-capped at 45km
 *      (region is trusted; the exact spot is not).
 *   3. Build the road centreline by OSRM-routing the road's verified anchors.
 *   4. TRUST a geocoded landmark only if it lies within TRUST_OFFSET of that
 *      centreline. Off-road matches (wrong town, wrong city) are discarded.
 *   5. Project trusted landmark(s) onto the centreline. Two trusted points =>
 *      the on-road midpoint between them (the segment the name describes).
 *   6. Propose that on-road point. If nothing is trusted, mark REVIEW (never
 *      auto-move a camera from a bad geocode).
 *
 * Usage:
 *   node scripts/fixByLandmark.mjs             # report proposals
 *   node scripts/fixByLandmark.mjs --fix       # apply trusted fixes >THRESHOLD
 *   node scripts/fixByLandmark.mjs --threshold=350
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ZONES_FILE = path.resolve(__dir, '../data/speedZones.ts');
const PHOTON = 'https://photon.komoot.io/api/';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const KENYA_BBOX = '33.9,-4.9,41.9,5.5';
const CAP = 12000;         // real landmark is always near the (region-trusted) stored coord
const PAIR_MAX = 12000;    // two ends of a named "section" shouldn't be farther apart than this
const THRESHOLD = parseInt(process.argv.find(a => a.startsWith('--threshold='))?.split('=')[1] ?? '350', 10);
const FIX = process.argv.includes('--fix');

// ── Road anchors (verified ON each road; NEVER at a camera coord) ───────────────
const ROAD_ANCHORS = {
  A109:       [[36.8280,-1.3088],[36.9430,-1.3947],[37.0170,-1.4827],[37.3739,-2.0162],[37.8340,-2.5470],[38.5587,-3.3964],[39.4540,-3.8640],[39.6682,-4.0435]],
  A2:         [[36.8380,-1.2660],[36.8643,-1.2447],[36.8854,-1.2189],[36.9134,-1.1903],[37.0870,-1.0396],[37.0708,-0.9136],[37.0989,-0.8803],[37.2103,-0.6711],[37.1247,-0.4808]],
  EXPR:       [[36.8219,-1.2706],[36.8248,-1.3064],[36.8921,-1.3351],[36.9285,-1.3777]],
  WAIYAKI:    [[36.7138,-1.2583],[36.7447,-1.2664],[36.7985,-1.2588],[36.8109,-1.2661]],
  NGONG:      [[36.7951,-1.2918],[36.7700,-1.3000],[36.6536,-1.3654]],
  LANGATA:    [[36.8169,-1.3122],[36.7993,-1.3259],[36.7820,-1.3319],[36.7532,-1.3253],[36.7568,-1.3593]],
  SOUTH_BP:   [[36.6645,-1.2465],[36.7228,-1.3194],[36.7375,-1.3633]],
  NORTH_BP:   [[36.7508,-1.2175],[36.7806,-1.2039],[36.8800,-1.1900],[36.8875,-1.2033]],
  EAST_BP:    [[36.9350,-1.3020],[36.9659,-1.2792]],
  A104:       [[36.6333,-1.1167],[36.4311,-0.7167],[36.0800,-0.3031],[35.7300,-0.2500],[35.6300,0.0900],[35.4500,0.3500],[35.2698,0.5143]],
  A104E:      [[35.2698,0.5143],[35.2998,0.4729],[35.2438,0.4504],[35.4698,0.1546]],
  OUTER_RING: [[36.8450,-1.2740],[36.8600,-1.2800],[36.8800,-1.2950],[36.8950,-1.3180]],
  A7:         [[39.6724,-4.0429],[39.7415,-3.9554],[39.8485,-3.6362],[40.1191,-3.2175],[40.1580,-3.1145]],
  A7S:        [[39.6682,-4.0435],[39.5670,-4.2829],[39.1550,-4.5395]],
  A8:         [[36.0800,-0.3031],[35.4169,0.2433],[35.3069,0.4518],[35.2698,0.5143],[34.2694,0.6327]],
  A12:        [[34.7617,-0.1022],[34.2608,0.2141],[35.2874,-0.3676],[35.4614,-0.2645]],
  A3:         [[37.0870,-1.0396],[37.6690,-1.0980]],
  B1:         [[34.7617,-0.1022],[34.4666,-1.0666]],
  A9:         [[37.5470,-0.5590],[37.6128,0.2336]],
  B3:         [[36.0800,-0.3031],[35.8667,-1.0833]],
  B17:        [[36.0800,-0.3031],[35.9644,-0.0126]],
  B18:        [[35.8667,-1.0833],[35.8958,-0.7726]],
  MOM_N:      [[39.6682,-4.0435],[39.6931,-4.0523],[39.7276,-3.9994]],
  AIRPORT_N:  [[36.9210,-1.3185],[36.9245,-1.3192]],
  ENTERPRISE: [[36.8388,-1.3063],[36.8490,-1.3110]],
  CHIROMO:    [[36.8166,-1.2809],[36.8188,-1.2898]],
  KAREN:      [[36.7061,-1.3218],[36.7100,-1.3600]],
  MAGADI:     [[36.7375,-1.3633],[36.7569,-1.3971]],
  GITARU:     [[36.6923,-1.2364],[36.7508,-1.2175]],
  RED_HILL:   [[36.6333,-1.1167],[36.7067,-1.1688]],
  WEST_BP:    [[36.7806,-1.2039],[36.7871,-1.2047]],
  EMBU_HWY:   [[37.0708,-0.9136],[37.0870,-1.0396],[37.1077,-0.9530]],
  KISII:      [[34.4666,-1.0666],[34.6653,-0.6651]],
  KSM_VIG:    [[34.7617,-0.1022],[34.7799,-0.0926]],
  KAPSABET:   [[35.2698,0.5143],[35.1012,0.2005]],
  LIMURU_RD:  [[36.8120,-1.2700],[36.8175,-1.2500],[36.6333,-1.1168]],
  KIAMBU_RD:  [[36.8430,-1.2650],[36.8450,-1.2150],[36.8330,-1.1800]],
};
const CAM_ROAD_MAP = {
  sz001:'A109', sz002:'A109', sz003:'A109', sz004:'A109', sz005:'A109',
  sz006:'A109', sz007:'A109', sz008:'A109', sz035:'A109', sz035b:'A109', sz036:'A109',
  sz095:'A109', sz096:'A109', sz097:'A109',
  sz009:'A2', sz010:'A2', sz011:'A2', sz028:'A2', sz029:'A2', sz030:'A2', sz031:'A2',
  sz032:'A2', sz038:'A2', sz039:'A2', sz040:'A2', sz041:'A2', sz068:'A2',
  sz026:'EXPR', sz027:'EXPR', sz079:'EXPR', sz080:'EXPR', sz099:'EXPR', sz100:'EXPR',
  sz012:'WAIYAKI', sz013:'WAIYAKI', sz037:'WAIYAKI', sz037b:'WAIYAKI', sz101:'WAIYAKI', sz102:'WAIYAKI',
  sz014:'NGONG', sz065:'NGONG', sz066:'NGONG', sz103:'NGONG', sz104:'NGONG',
  sz016:'LANGATA', sz045:'LANGATA', sz063:'LANGATA', sz082:'LANGATA', sz083:'LANGATA', sz098:'LANGATA',
  sz033:'SOUTH_BP', sz074:'SOUTH_BP', sz084:'SOUTH_BP',
  sz034:'NORTH_BP', sz075:'NORTH_BP', sz086:'NORTH_BP', sz087:'NORTH_BP',
  sz015:'OUTER_RING', sz105:'OUTER_RING', sz106:'OUTER_RING',
  sz076:'EAST_BP', sz077:'EAST_BP',
  sz107:'LIMURU_RD', sz108:'KIAMBU_RD',
  sz017:'A104', sz018:'A104', sz019:'A104', sz020:'A104', sz021:'A104', sz073:'A104',
  sz092:'A104E', sz093:'A104E', sz094:'A104E',
  sz046:'A7', sz047:'A7', sz048:'A7', sz049:'A7', sz050:'A7',
  sz051:'A7S', sz070:'A7S',
  sz069:'MOM_N', sz071:'MOM_N',
  sz060:'A8', sz061:'A8', sz062:'A8',
  sz022:'A12', sz052:'A12', sz053:'A12', sz072:'A12',
  sz042:'A3', sz054:'B1', sz057:'A9', sz058:'A9', sz023:'B3', sz055:'B17', sz056:'B18',
  sz059:'AIRPORT_N', sz024:'ENTERPRISE', sz043:'CHIROMO', sz091:'CHIROMO',
  sz025:'KAREN', sz064:'KAREN', sz067:'MAGADI', sz078:'GITARU', sz081:'RED_HILL',
  sz085:'WEST_BP', sz088:'EMBU_HWY', sz089:'KISII', sz090:'KSM_VIG', sz044:'KAPSABET',
};

// Curated landmark queries where the auto term is a proper noun that geocodes
// better with extra context (or the stored name is ambiguous). id -> [terms].
const OVERRIDES = {
  sz014: ['Junction Mall Ngong Road Nairobi', 'Adams Arcade Nairobi'],
  sz016: ['Carnivore Restaurant Langata Nairobi'],
  sz096: ['Bellevue Mombasa Road Nairobi'],
  sz032: ['Juja Road Interchange Thika Road Nairobi'],
  sz012: ['ABC Place Waiyaki Way Nairobi'],
  sz013: ['ABC Place Waiyaki Way Nairobi'],
  sz029: ['Allsops Thika Road Nairobi'],
  sz085: ['Ruaka Western Bypass'],
  sz075: ['Ruaka Northern Bypass'],
  sz099: ['James Gichuru Road Nairobi'],
};

// ── geometry ────────────────────────────────────────────────────────────────
function haversine(a, b) {
  const R = 6371000, r = d => d * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function nearestOnSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { lat: ay, lng: ax, t: 0 };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return { lat: ay + t * dy, lng: ax + t * dx, t };
}
// Project a point onto centreline; return snapped point, offset(m), cumulative(m).
function project(lat, lng, coords) {
  let best = { off: Infinity }; let cum = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = coords[i], [bx, by] = coords[i + 1];
    const p = nearestOnSeg(lng, lat, ax, ay, bx, by);
    const off = haversine({ lat, lng }, { lat: p.lat, lng: p.lng });
    const segLen = haversine({ lat: ay, lng: ax }, { lat: by, lng: bx });
    if (off < best.off) best = { off, lat: p.lat, lng: p.lng, cum: cum + p.t * segLen };
    cum += segLen;
  }
  return best;
}
// Point at a given cumulative distance along centreline.
function pointAtCum(coords, target) {
  let cum = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = coords[i], [bx, by] = coords[i + 1];
    const segLen = haversine({ lat: ay, lng: ax }, { lat: by, lng: bx });
    if (cum + segLen >= target) {
      const t = segLen === 0 ? 0 : (target - cum) / segLen;
      return { lat: ay + t * (by - ay), lng: ax + t * (bx - ax) };
    }
    cum += segLen;
  }
  const last = coords[coords.length - 1];
  return { lat: last[1], lng: last[0] };
}

const STOP = /\b(speed|camera|police|check(point)?|radar|fixed|anpr|post|mobile|enforcement|virtual|weighbridge|zone|section|approach|entry|open|stretch|corridor|gantry|pole|overhead|station|divisional|residential|controlled|built-?up|area|the|near|end)\b/gi;
function cleanToken(t) { return t.replace(STOP, ' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim(); }
function extractLandmarks(z) {
  if (OVERRIDES[z.id]) return OVERRIDES[z.id];
  let base = z.name;
  const dash = base.split(/\s[–—-]\s/);
  if (dash.length > 1) base = dash.slice(1).join(' / ');
  const parts = base.split(/\s*\/\s*|\s+to\s+|\s[–—]\s/i).map(cleanToken).filter(t => t.length >= 3);
  const uniq = [...new Set(parts)];
  if (uniq.length) return uniq.slice(0, 2);
  const c = cleanToken(z.name);
  return c ? [c] : [];
}

// Significant lowercase word tokens for name-match verification. Keep short
// proper nouns (taj, abc) but drop generic geography/infrastructure words.
const GENERIC = new Set(['road','way','junction','interchange','camera','police','check','checkpoint',
  'speed','zone','section','highway','avenue','street','estate','nairobi','kenya','town','stage','post',
  'radar','area','open','mid','stretch','the','near','end','city','flyover','roundabout','bridge']);
function tokens(s) {
  return (s.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(w => !GENERIC.has(w));
}
async function geocode(term, stored) {
  const url = `${PHOTON}?q=${encodeURIComponent(term + ', Kenya')}&limit=8&bbox=${KENYA_BBOX}&lat=${stored.lat}&lon=${stored.lng}`;
  const r = await fetch(url); if (!r.ok) return null;
  const j = await r.json();
  const want = tokens(term);
  const feats = (j.features || []).filter(f => f.geometry?.type === 'Point')
    .map(f => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
      name: f.properties.name || '', type: f.properties.osm_value || '',
      label: [f.properties.name, f.properties.city || f.properties.county, f.properties.osm_value].filter(Boolean).join(' · ') }))
    .filter(f => haversine(stored, f) <= CAP)
    // require the returned feature to actually match the landmark name (guards
    // generic drift like "Fedha"->some random shop). Skip check if term had no
    // significant tokens (e.g. pure road codes -> handled as corridor upstream).
    .filter(f => want.length === 0 || tokens(`${f.name} ${f.label}`).some(t => want.includes(t)))
    .sort((a, b) => haversine(stored, a) - haversine(stored, b));
  return feats;   // nearest-to-stored first, within CAP, name-matched
}
async function osrmMid(a, b) {
  const res = await fetch(`${OSRM}/${a.lng},${a.lat};${b.lng},${b.lat}?geometries=geojson&overview=full`);
  if (res.ok) {
    const c = (await res.json()).routes?.[0]?.geometry?.coordinates ?? [];
    if (c.length > 1) {
      // midpoint by cumulative distance along the real route
      const cc = c.map(([lng, lat]) => ({ lat, lng }));
      let tot = 0; for (let i = 0; i < cc.length - 1; i++) tot += haversine(cc[i], cc[i + 1]);
      let acc = 0; for (let i = 0; i < cc.length - 1; i++) { const d = haversine(cc[i], cc[i + 1]); if (acc + d >= tot / 2) { const t = d ? (tot / 2 - acc) / d : 0; return { lat: cc[i].lat + t * (cc[i + 1].lat - cc[i].lat), lng: cc[i].lng + t * (cc[i + 1].lng - cc[i].lng) }; } acc += d; }
    }
  }
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }; // geodesic fallback
}
// A term with no significant tokens (pure road code / range) => corridor marker.
function isCorridorTerm(t) { return tokens(t).length === 0 || /^[a-d]\d/i.test(t.trim()); }
async function roadGeom(key) {
  const wps = ROAD_ANCHORS[key]; if (!wps) return [];
  const c = wps.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const res = await fetch(`${OSRM}/${c}?geometries=geojson&overview=full`);
  if (!res.ok) return [];
  return (await res.json()).routes?.[0]?.geometry?.coordinates ?? [];
}

function parseZones(src) {
  const out = [];
  const re = /\{\s*id:\s*"(sz\w+)",\s*name:\s*"([^"]+)",\s*road:\s*"([^"]+)",\s*lat:\s*(-?[\d.]+),\s*lng:\s*(-?[\d.]+),\s*speedLimit:\s*(\d+),\s*type:\s*"(\w+)"/g;
  for (const m of src.matchAll(re))
    out.push({ id: m[1], name: m[2], road: m[3], lat: +m[4], lng: +m[5], type: m[7] });
  return out;
}

async function main() {
  const src = fs.readFileSync(ZONES_FILE, 'utf8');
  const zones = parseZones(src);
  const geomCache = {};
  const VERIFY_OFF = 1500;   // a real fix must land within this of its named road
  const proposals = [], review = [], good = [];

  for (const z of zones) {
    const terms = extractLandmarks(z);
    // Corridor markers (road codes / ranges, no real landmark) are stretches, not
    // point cameras — never auto-move them.
    if (terms.every(isCorridorTerm)) { review.push({ ...z, note: 'corridor marker (no point landmark)', seen: terms }); continue; }

    const found = [];   // geocoded landmark points, nearest-to-stored, name-matched
    const seen = [];
    const roadTok = new Set(tokens(z.road));
    for (const t of terms) {
      // a term that is just the road name (no distinct landmark) is a corridor marker
      const tt = tokens(t);
      if (isCorridorTerm(t) || (tt.length && tt.every(w => roadTok.has(w)))) { seen.push(`${t}=corridor`); continue; }
      const cands = await geocode(t, z);
      await new Promise(r => setTimeout(r, 180));
      if (!cands?.length) { seen.push(`${t}=NOMATCH<${CAP / 1000}km`); continue; }
      const c = cands[0];
      found.push({ term: t, lat: c.lat, lng: c.lng, type: c.type, dist: Math.round(haversine(z, c)) });
      seen.push(`${t}✓${Math.round(haversine(z, c))}m ${c.type}`);
    }

    if (!found.length) { review.push({ ...z, note: 'no name-matched landmark within cap', seen }); continue; }

    let target, kind;
    if (found.length === 2) {
      const apart = haversine(found[0], found[1]);
      if (apart > PAIR_MAX) { review.push({ ...z, note: `pair too far apart (${Math.round(apart)}m)`, seen }); continue; }
      target = await osrmMid(found[0], found[1]); kind = 'pair-mid';
      await new Promise(r => setTimeout(r, 150));
    } else { target = { lat: found[0].lat, lng: found[0].lng }; kind = 'single'; }

    const delta = Math.round(haversine(z, target));
    // Verification gate: a real fix must land near its named road. A bad geocode
    // (same-named place elsewhere) lands far off-road -> send to review, never move.
    const roadKey = CAM_ROAD_MAP[z.id];
    if (roadKey && !geomCache[roadKey]) { geomCache[roadKey] = await roadGeom(roadKey); await new Promise(r => setTimeout(r, 150)); }
    const geom = roadKey ? geomCache[roadKey] : null;
    let offRoad = null;
    if (geom?.length) {
      offRoad = Math.round(project(target.lat, target.lng, geom).off);
      if (delta > THRESHOLD && offRoad > VERIFY_OFF) {
        review.push({ ...z, note: `proposed pt ${offRoad}m off ${roadKey} — bad geocode?`, seen });
        continue;
      }
    }
    const row = { ...z, target, delta, seen, kind, offRoad, found };
    if (delta > THRESHOLD) proposals.push(row); else good.push(row);
  }

  // Confidence classifier: only auto-apply fixes that land on the named road
  // via a trustworthy landmark. Business types named after an area, and pairs
  // with a far outlier endpoint, are held for manual review (never auto-moved).
  const JUNK = new Set(['supermarket','residential','unclassified','boundary_stone','boatyard',
    'horse_riding','pitch','mobile_phone','quarter','yes','building','path','school','bank']);
  function accept(p) {
    if (p.offRoad == null || p.offRoad > 500) return false;   // must land on the road
    if (p.kind === 'pair') return p.found.length === 2 && p.found.every(f => f.dist <= 4500);
    return p.delta <= 8000 && !JUNK.has(p.found[0].type);      // single: real landmark type
  }
  for (const p of proposals) p.ok = accept(p);
  const accepted = proposals.filter(p => p.ok);
  const held = proposals.filter(p => !p.ok);

  proposals.sort((a, b) => b.delta - a.delta);
  console.log(`\n=== ACCEPTED FIXES (auto-apply) — threshold ${THRESHOLD}m ===\n`);
  for (const p of accepted.sort((a, b) => b.delta - a.delta)) {
    console.log(`${String(p.delta).padStart(6)}m  ${p.id}  [${p.kind}]  ${p.name}`);
    console.log(`         stored [${p.lat}, ${p.lng}]`);
    console.log(`         new    [${p.target.lat.toFixed(6)}, ${p.target.lng.toFixed(6)}]  off-road:${p.offRoad ?? '?'}m  (${p.seen.join(' | ')})`);
  }
  console.log(`\n=== HELD (flagged but low-confidence — manual review) ===\n`);
  for (const p of held.sort((a, b) => b.delta - a.delta))
    console.log(`  ${String(p.delta).padStart(6)}m ${p.id} [${p.kind}] ${p.name}  off:${p.offRoad}m  [${p.seen.join(' | ')}]`);
  console.log(`\n=== NEEDS MANUAL REVIEW (${review.length}) ===\n`);
  for (const r of review) console.log(`  ${r.id}  ${r.name}  — ${r.note}  [${r.seen.join(' | ')}]`);
  console.log(`\nAccepted: ${accepted.length} | Held: ${held.length} | Good(<=${THRESHOLD}m): ${good.length} | Review: ${review.length}\n`);

  if (FIX && accepted.length) {
    let out = src, n = 0;
    for (const p of accepted) {
      const re = new RegExp(`(id:\\s*"${p.id}",[^}]*?lat:\\s*)-?[\\d.]+(,\\s*lng:\\s*)-?[\\d.]+`, 's');
      const nl = p.target.lat.toFixed(6), ng = p.target.lng.toFixed(6);
      const before = out; out = out.replace(re, `$1${nl}$2${ng}`);
      if (out !== before) n++;
    }
    fs.writeFileSync(ZONES_FILE, out, 'utf8');
    console.log(`✅ Applied ${n} accepted fix(es) to speedZones.ts\n`);
  } else if (accepted.length) {
    console.log('Run with --fix to apply accepted fixes.\n');
  }
}
main().catch(e => { console.error(e); process.exit(1); });
