#!/usr/bin/env node
/**
 * Camera coordinate validator & road-snapper for speedZones.ts
 *
 * Usage:
 *   node artifacts/mobile/scripts/validateCameras.mjs           # report only
 *   node artifacts/mobile/scripts/validateCameras.mjs --fix     # report + write corrections
 *   node artifacts/mobile/scripts/validateCameras.mjs --threshold=100   # flag >100m (default 50m)
 *
 * How it works:
 *   1. Reads speedZones.ts and extracts all camera coordinates.
 *   2. For each camera's road, routes OSRM between known anchor points ON that road
 *      to get the exact road polyline (NOT nearest-road which can snap to wrong roads).
 *   3. Projects each camera onto its road polyline and reports the offset.
 *   4. With --fix, writes corrected lat/lng back into speedZones.ts.
 *
 * Add new roads by adding an entry to ROAD_ANCHORS and mapping camera IDs in CAM_ROAD_MAP.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ZONES_FILE = path.resolve(__dir, '../data/speedZones.ts');
const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const THRESHOLD = parseInt(process.argv.find(a => a.startsWith('--threshold='))?.split('=')[1] ?? '50', 10);
const FIX = process.argv.includes('--fix');

// ── Road anchor points ─────────────────────────────────────────────────────────
// Each entry is an ordered list of [lng, lat] waypoints that lie ON the road.
// OSRM routes between them to extract the real road polyline.
// When adding a new road: add anchor waypoints from Google Maps (copy coord → long-press on road).
const ROAD_ANCHORS = {
  A109:       [[36.8195,-1.3084],[36.8512,-1.3163],[36.8895,-1.3215],[36.9245,-1.3192],[36.9430,-1.3947],[36.9878,-1.4562],[37.0170,-1.4827],[38.5587,-3.3964],[39.4540,-3.8640],[39.6682,-4.0435]],
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
};

// ── Camera → road mapping ──────────────────────────────────────────────────────
// When adding a new camera: add its id here with the matching road key above.
const CAM_ROAD_MAP = {
  sz001:'A109', sz002:'A109', sz003:'A109', sz004:'A109', sz005:'A109',
  sz006:'A109', sz007:'A109', sz008:'A109', sz035:'A109', sz035b:'A109', sz036:'A109',
  sz009:'A2',   sz010:'A2',   sz011:'A2',   sz028:'A2',   sz029:'A2',
  sz030:'A2',   sz031:'A2',   sz032:'A2',   sz038:'A2',   sz039:'A2',
  sz040:'A2',   sz041:'A2',
  sz026:'EXPR', sz027:'EXPR', sz079:'EXPR', sz080:'EXPR',
  sz012:'WAIYAKI', sz013:'WAIYAKI', sz037:'WAIYAKI', sz037b:'WAIYAKI',
  sz014:'NGONG', sz065:'NGONG', sz066:'NGONG',
  sz016:'LANGATA', sz045:'LANGATA', sz063:'LANGATA', sz082:'LANGATA', sz083:'LANGATA',
  sz033:'SOUTH_BP', sz074:'SOUTH_BP', sz084:'SOUTH_BP',
  sz034:'NORTH_BP', sz075:'NORTH_BP', sz086:'NORTH_BP', sz087:'NORTH_BP',
  sz015:'OUTER_RING', sz076:'EAST_BP', sz077:'EAST_BP',
  sz068:'A2',
  sz017:'A104', sz018:'A104', sz019:'A104', sz020:'A104', sz021:'A104', sz073:'A104',
  sz092:'A104E', sz093:'A104E', sz094:'A104E',
  sz046:'A7',   sz047:'A7',   sz048:'A7',   sz049:'A7',   sz050:'A7',
  sz051:'A7S',  sz070:'A7S',
  sz069:'MOM_N', sz071:'MOM_N',
  sz060:'A8',   sz061:'A8',   sz062:'A8',
  sz022:'A12',  sz052:'A12',  sz053:'A12',  sz072:'A12',
  sz042:'A3',
  sz054:'B1',
  sz057:'A9',   sz058:'A9',
  sz023:'B3',
  sz055:'B17',  sz056:'B18',
  sz059:'AIRPORT_N',
  sz024:'ENTERPRISE',
  sz043:'CHIROMO', sz091:'CHIROMO',
  sz025:'KAREN', sz064:'KAREN',
  sz067:'MAGADI',
  sz078:'GITARU',
  sz081:'RED_HILL',
  sz085:'WEST_BP',
  sz088:'EMBU_HWY',
  sz089:'KISII',
  sz090:'KSM_VIG',
  sz044:'KAPSABET',
};

// ── Geometry utilities ─────────────────────────────────────────────────────────
function nearestOnSeg(px, py, ax, ay, bx, by) {
  const dx=bx-ax, dy=by-ay, lenSq=dx*dx+dy*dy;
  if(lenSq===0) return {lat:ay,lng:ax};
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/lenSq));
  return {lat:ay+t*dy, lng:ax+t*dx};
}
function snapToPolyline(lat, lng, coords) {
  let best={dist:Infinity,lat,lng};
  for(let i=0;i<coords.length-1;i++){
    const [ax,ay]=[coords[i][0],coords[i][1]], [bx,by]=[coords[i+1][0],coords[i+1][1]];
    const pt=nearestOnSeg(lng,lat,ax,ay,bx,by);
    const dlat=pt.lat-lat, dlng=pt.lng-lng;
    const d=Math.sqrt((dlat*111000)**2+(dlng*111000*Math.cos(lat*Math.PI/180))**2);
    if(d<best.dist) best={dist:d,lat:pt.lat,lng:pt.lng};
  }
  return best;
}

async function getRoadGeometry(roadKey) {
  const wps = ROAD_ANCHORS[roadKey];
  if (!wps) return [];
  const coords = wps.map(([lng,lat])=>`${lng},${lat}`).join(';');
  const res = await fetch(`${OSRM}/${coords}?geometries=geojson&overview=full`);
  if (!res.ok) return [];
  const j = await res.json();
  return j.routes?.[0]?.geometry?.coordinates ?? [];
}

// ── Parse speedZones.ts ────────────────────────────────────────────────────────
function parseCameras(src) {
  const out = [];
  const re = /id:\s*"(sz\w+)"[^}]*?lat:\s*(-?[\d.]+)[^}]*?lng:\s*(-?[\d.]+)/gs;
  for (const [, id, latStr, lngStr] of src.matchAll(re)) {
    out.push({ id, lat: parseFloat(latStr), lng: parseFloat(lngStr) });
  }
  return out;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🗺  Camera validator  |  threshold: ${THRESHOLD}m  |  mode: ${FIX ? 'FIX' : 'report'}\n`);

  const src = fs.readFileSync(ZONES_FILE, 'utf8');
  const cameras = parseCameras(src);
  console.log(`Loaded ${cameras.length} cameras from speedZones.ts\n`);

  // Fetch road geometries (deduplicated)
  const neededRoads = [...new Set(cameras.map(c => CAM_ROAD_MAP[c.id]).filter(Boolean))];
  const geomCache = {};
  for (const road of neededRoads) {
    process.stdout.write(`  Fetching ${road}... `);
    geomCache[road] = await getRoadGeometry(road);
    console.log(`${geomCache[road].length} pts`);
    await new Promise(r => setTimeout(r, 250));
  }

  console.log('\nResults:\n');
  const corrections = [];
  let unmapped = 0;

  for (const cam of cameras) {
    const road = CAM_ROAD_MAP[cam.id];
    if (!road) { unmapped++; continue; }
    const geom = geomCache[road];
    if (!geom?.length) continue;

    const snap = snapToPolyline(cam.lat, cam.lng, geom);
    const dist = Math.round(snap.dist);
    const newLat = parseFloat(snap.lat.toFixed(6));
    const newLng = parseFloat(snap.lng.toFixed(6));

    if (dist > THRESHOLD) {
      const flag = dist > 300 ? '🔴' : '🟡';
      console.log(`${flag}  ${cam.id}  ${dist}m off ${road}`);
      console.log(`      was  [${cam.lat}, ${cam.lng}]`);
      console.log(`      snap [${newLat}, ${newLng}]\n`);
      corrections.push({ id: cam.id, newLat, newLng });
    }
  }

  if (corrections.length === 0) {
    console.log(`✅  All cameras are within ${THRESHOLD}m of their road. Nothing to fix.\n`);
    return;
  }

  console.log(`Found ${corrections.length} camera(s) off by >${THRESHOLD}m.`);
  if (unmapped > 0) console.log(`(${unmapped} cameras have no road mapping — add them to CAM_ROAD_MAP to validate.)`);

  if (!FIX) {
    console.log('\nRun with --fix to apply corrections.\n');
    return;
  }

  let fixed = 0;
  let out = src;
  for (const { id, newLat, newLng } of corrections) {
    const re = new RegExp(
      `(id:\\s*"${id}"[^}]*?lat:\\s*)-?[\\d.]+([^}]*?lng:\\s*)-?[\\d.]+`,
      's'
    );
    const before = out;
    out = out.replace(re, `$1${newLat}$2${newLng}`);
    if (out !== before) fixed++;
  }
  fs.writeFileSync(ZONES_FILE, out, 'utf8');
  console.log(`\n✅  Fixed ${fixed} camera(s) in speedZones.ts\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
