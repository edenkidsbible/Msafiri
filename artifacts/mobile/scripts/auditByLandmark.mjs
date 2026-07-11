#!/usr/bin/env node
/**
 * Landmark-grounded camera auditor for speedZones.ts
 *
 * The old validateCameras.mjs only snapped a camera to the NEAREST point on its
 * road centreline. That silently accepts a camera that is on the right road but
 * kilometres too far ALONG it (or when the hand-placed anchors themselves are
 * wrong). This auditor instead grounds every zone against the REAL named
 * landmark(s) in its name/description, geocoded via Photon (works from sandbox;
 * Nominatim 403s). Two-point names ("Taj Mall / Fedha Section") define a segment
 * -> the true location is somewhere between the two geocoded landmarks.
 *
 * Usage:
 *   node scripts/auditByLandmark.mjs                 # full report
 *   node scripts/auditByLandmark.mjs --json          # machine-readable
 *   node scripts/auditByLandmark.mjs --min=1500      # only show >1500m deltas
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ZONES_FILE = path.resolve(__dir, '../data/speedZones.ts');
const PHOTON = 'https://photon.komoot.io/api/';
const KENYA_BBOX = '33.9,-4.9,41.9,5.5';
const MIN = parseInt(process.argv.find(a => a.startsWith('--min='))?.split('=')[1] ?? '0', 10);
const AS_JSON = process.argv.includes('--json');

// Region bias: geocode biased toward each zone's OWN stored coordinate. The
// stored region (which metro/town) is almost always right even when the exact
// spot is km-off; biasing here keeps Photon from matching a same-named place in
// another city while letting the distinctive landmark name pin the exact point.
function regionFor(z) {
  return { ll: [z.lng, z.lat], label: 'Kenya' };
}

// Generic words that are never landmarks.
const STOP = /\b(speed|camera|police|check(point)?|zone|section|radar|fixed|anpr|post|mobile|enforcement|virtual|weighbridge|highway|road|rd|junction|interchange|flyover|ramp|approach|entry|open|stretch|mid-?section|controlled|toll plaza|built-?up|area|the|near|end|corridor|underpass|gantry|pole|overhead|stage|residential|station|divisional)\b/gi;

// Per-id landmark overrides where auto-extraction is unreliable. Fill from report.
const OVERRIDES = {};

function cleanToken(t) {
  return t.replace(STOP, ' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Extract up to 2 landmark strings from a zone's name (+description fallback).
function extractLandmarks(z) {
  if (OVERRIDES[z.id]) return OVERRIDES[z.id];
  let base = z.name;
  // Drop the road prefix before the first dash variant.
  const dashSplit = base.split(/\s[–—-]\s/);
  if (dashSplit.length > 1) base = dashSplit.slice(1).join(' / ');
  // Split into up to 2 landmark candidates on slash / "to" / dash.
  const parts = base.split(/\s*\/\s*|\s+to\s+|\s[–—]\s/i).map(cleanToken).filter(Boolean);
  const uniq = [...new Set(parts)].filter(p => p.length >= 3);
  if (uniq.length) return uniq.slice(0, 2);
  // Fallback: whole cleaned name.
  const c = cleanToken(z.name);
  return c ? [c] : [];
}

function haversine(a, b) {
  const R = 6371000, toR = d => d * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function geocode(term, region) {
  const q = `${term}, ${region.label}, Kenya`;
  const url = `${PHOTON}?q=${encodeURIComponent(q)}&limit=5&bbox=${KENYA_BBOX}` +
    `&lat=${region.ll[1]}&lon=${region.ll[0]}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  const feats = (j.features || []).filter(f => f.geometry?.type === 'Point');
  if (!feats.length) return null;
  // Prefer the candidate nearest the region bias (keeps us in the right city).
  feats.sort((a, b) => {
    const da = haversine({ lat: region.ll[1], lng: region.ll[0] },
      { lat: a.geometry.coordinates[1], lng: a.geometry.coordinates[0] });
    const db = haversine({ lat: region.ll[1], lng: region.ll[0] },
      { lat: b.geometry.coordinates[1], lng: b.geometry.coordinates[0] });
    return da - db;
  });
  const f = feats[0];
  return {
    lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
    label: [f.properties.name, f.properties.city || f.properties.county, f.properties.osm_value]
      .filter(Boolean).join(' · '),
  };
}

function parseZones(src) {
  const out = [];
  const re = /\{\s*id:\s*"(sz\w+)",\s*name:\s*"([^"]+)",\s*road:\s*"([^"]+)",\s*lat:\s*(-?[\d.]+),\s*lng:\s*(-?[\d.]+),\s*speedLimit:\s*(\d+),\s*type:\s*"(\w+)",\s*description:\s*"([^"]*)"/g;
  for (const m of src.matchAll(re)) {
    out.push({
      id: m[1], name: m[2], road: m[3],
      lat: parseFloat(m[4]), lng: parseFloat(m[5]),
      speedLimit: +m[6], type: m[7], description: m[8],
    });
  }
  return out;
}

async function main() {
  const src = fs.readFileSync(ZONES_FILE, 'utf8');
  const zones = parseZones(src);
  const rows = [];

  for (const z of zones) {
    const region = regionFor(z);
    const terms = extractLandmarks(z);
    const geos = [];
    for (const t of terms) {
      const g = await geocode(t, region);
      geos.push({ term: t, ...(g || { failed: true }) });
      await new Promise(r => setTimeout(r, 200));
    }
    const ok = geos.filter(g => !g.failed);
    let target = null, kind = 'none';
    if (ok.length === 2) { target = { lat: (ok[0].lat + ok[1].lat) / 2, lng: (ok[0].lng + ok[1].lng) / 2 }; kind = 'midpoint'; }
    else if (ok.length === 1) { target = { lat: ok[0].lat, lng: ok[0].lng }; kind = 'point'; }
    const dist = target ? Math.round(haversine(z, target)) : null;
    rows.push({ ...z, region: region.label, terms, geos, kind, target, dist });
    if (!AS_JSON) process.stderr.write('.');
  }

  rows.sort((a, b) => (b.dist ?? -1) - (a.dist ?? -1));

  if (AS_JSON) { console.log(JSON.stringify(rows, null, 2)); return; }

  console.log('\n\n=== LANDMARK AUDIT (sorted worst-first) ===\n');
  let flagged = 0, nogeo = 0;
  for (const r of rows) {
    if (r.dist === null) { nogeo++; continue; }
    if (r.dist < MIN) continue;
    const flag = r.dist > 3000 ? '🔴' : r.dist > 1200 ? '🟠' : r.dist > 500 ? '🟡' : '✅';
    if (r.dist > 500) flagged++;
    console.log(`${flag} ${r.id} ${r.dist}m  ${r.name}`);
    console.log(`    stored  [${r.lat}, ${r.lng}]  (${r.road})`);
    console.log(`    ${r.kind} [${r.target.lat.toFixed(6)}, ${r.target.lng.toFixed(6)}]`);
    for (const g of r.geos) {
      console.log(`      · "${g.term}" -> ${g.failed ? 'NO MATCH' : `[${g.lat.toFixed(5)},${g.lng.toFixed(5)}] ${g.label}`}`);
    }
    console.log('');
  }
  console.log(`\nSummary: ${rows.length} zones | ${flagged} off by >500m | ${nogeo} could not geocode\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
