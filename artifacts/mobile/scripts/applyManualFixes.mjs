// Curated manual corrections for cameras whose stored coords were verified wrong
// (landmark cross-checked via Photon + junction geocoding). Each entry cites why.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const __dir = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dir, '../data/speedZones.ts');
let src = fs.readFileSync(FILE, 'utf8');
const H = (a, b) => { const R = 6371000, r = d => d * Math.PI / 180; const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng); const s = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };

const FIXES = {
  sz012: { lat: -1.2620, lng: 36.7810, why: 'ABC Place cluster is at 36.777 (Waiyaki Way), not stored 36.81' },
  sz013: { lat: -1.2596, lng: 36.7771, why: 'ABC Place commercial complex, verified feature cluster' },
  sz036: { lat: -1.3356, lng: 36.8932, why: 'Cabanas bus stop / Eastern Bypass toll on Mombasa Rd' },
  sz045: { lat: -1.3122, lng: 36.8150, why: 'Mbagathi Way / Lang\'ata Rd junction (T-Mall); stored was 5.9km SW in Karen' },
  sz074: { lat: -1.3215, lng: 36.7664, why: 'On Southern Bypass carriageway nearest Karen/Bomas interchange (OSRM polyline vertex); old anchor was circular, prior 36.769 sat ~870m off-carriageway' },
  sz076: { lat: -1.2720, lng: 36.9758, why: 'Eastern Bypass at Ruai/Kangundo Rd junction; stored 4.9km SW' },
  sz081: { lat: -1.2280, lng: 36.7825, why: 'Red Hill Road (Westlands link); stored was 10.7km NW near Tigoni' },
  sz099: { lat: -1.2674, lng: 36.7744, why: 'James Gichuru / Waiyaki Way interchange (Expressway W terminus)' },
};

let n = 0;
for (const [id, f] of Object.entries(FIXES)) {
  const re = new RegExp(`(id:\\s*"${id}",[\\s\\S]*?lat:\\s*)(-?[\\d.]+)(,\\s*lng:\\s*)(-?[\\d.]+)`);
  const m = src.match(re);
  if (!m) { console.log(`❌ ${id} not found`); continue; }
  const old = { lat: +m[2], lng: +m[4] };
  const d = Math.round(H(old, f));
  src = src.replace(re, `$1${f.lat}$3${f.lng}`);
  n++;
  console.log(`✔ ${id}  moved ${d}m  [${old.lat},${old.lng}] -> [${f.lat},${f.lng}]  (${f.why})`);
}
if (process.argv.includes('--fix')) { fs.writeFileSync(FILE, src, 'utf8'); console.log(`\n✅ Wrote ${n} corrections.`); }
else console.log(`\n(dry run) ${n} corrections ready. Add --fix to write.`);
