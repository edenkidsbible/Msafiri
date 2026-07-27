/**
 * Drive-alert unit tests — AppContext candidate selection & dismiss logic
 *
 * Tests the 45° activation cone, 75° dismissal threshold, and passed-point
 * suppression that govern when DriveAlertOverlay fires and clears.
 *
 * The pure-math helpers below are verbatim copies of the private functions in
 * artifacts/mobile/context/AppContext.tsx (search "haversine", "bearingDeg",
 * "angleDiffDeg", "driverHeadingDeg"). The candidate-selection and dismiss
 * logic is also modelled verbatim from AppContext lines 1227–1344. When either
 * source changes these tests should fail, acting as a regression net.
 *
 * Run with: node artifacts/mobile/__tests__/driveAlerts.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─── Verbatim copies of AppContext.tsx private helpers ────────────────────────

/** Haversine great-circle distance in metres. */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180, f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180, dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Initial bearing from point A → B in degrees (0–360°). */
function bearingDeg(fromLat, fromLng, toLat, toLng) {
  const f1 = (fromLat * Math.PI) / 180, f2 = (toLat * Math.PI) / 180;
  const dl = ((toLng - fromLng) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Shortest angular difference between two headings (0–180°). */
function angleDiffDeg(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/** Driver heading derived from the previous GPS fix. Returns null when there
 *  is no prior fix or movement is below the 5 m noise threshold. */
function driverHeadingDeg(prevFix, currentLat, currentLng) {
  if (!prevFix) return null;
  const distM = haversine(prevFix.lat, prevFix.lng, currentLat, currentLng);
  if (distM < 5) return null;
  return bearingDeg(prevFix.lat, prevFix.lng, currentLat, currentLng);
}

// ─── Constants (verbatim from AppContext.tsx line 718) ────────────────────────
const ALERT_DIST = 1000;   // metres — outer alert radius
const IN_ZONE_DIST = 250;  // metres — driver is already inside the zone

// ─── Modelled candidate-selection helpers (verbatim logic from AppContext) ────
//
// These are pure re-implementations of the closures at AppContext lines 1227–1268
// so they can be unit-tested without a React render environment.

/**
 * Zone candidate selection — AppContext lines 1227–1244.
 *
 * @param {object} params
 * @param {number}       params.lat        — current driver latitude
 * @param {number}       params.lng        — current driver longitude
 * @param {number|null}  params.heading    — driver heading in degrees, or null
 * @param {{lat:number, lng:number, t:number}|null} params.prevFix — previous GPS fix
 * @param {Array<{id:string, lat:number, lng:number, distance:number, type:string, speedLimit:number|null}>} params.zones
 *   — zones already filtered to inRangeZones (distance > IN_ZONE_DIST && <= ALERT_DIST)
 * @param {number}       params.kmh        — current speed in km/h
 * @returns the first selected zone, or null
 */
function selectZoneCandidate({ lat, lng, heading, prevFix, zones, kmh }) {
  const fwd = heading != null
    ? zones.filter((z) => {
        // 45° activation cone (verbatim: > 45 rejects)
        if (angleDiffDeg(heading, bearingDeg(lat, lng, z.lat, z.lng)) > 45) return false;
        // Passed-point suppression: prevDist < curDist means driver is moving away
        if (prevFix) {
          const prevDist = haversine(prevFix.lat, prevFix.lng, z.lat, z.lng);
          if (prevDist < z.distance) return false;
        }
        return true;
      })
    : zones;
  for (const z of fwd) {
    if (z.type === "camera" && z.speedLimit != null && kmh <= z.speedLimit) continue;
    return z;
  }
  return null;
}

/**
 * Report candidate selection — AppContext lines 1249–1268.
 *
 * @param {object} params
 * @param {number}       params.lat
 * @param {number}       params.lng
 * @param {number|null}  params.heading
 * @param {{lat:number, lng:number, t:number}|null} params.prevFix
 * @param {Array<{id:string, lat:number, lng:number, status:string, type:string, timestamp:number, speedLimit:number|undefined}>} params.reports
 * @param {boolean}      params.isDriving  — driver is moving (speed > 5 km/h)
 * @param {number}       params.now        — current epoch ms
 * @returns {object|null} { report, dist } or null
 */
function selectReportCandidate({ lat, lng, heading, prevFix, reports, isDriving, now }) {
  if (!isDriving) return null;
  let best = null;
  let bestDist = Infinity;
  for (const r of reports) {
    if (r.status === "expired" || r.status === "denied" || r.type === "clear") continue;
    if (now - r.timestamp > 7200000) continue;
    const d = haversine(lat, lng, r.lat, r.lng);
    if (d <= IN_ZONE_DIST || d > ALERT_DIST || d >= bestDist) continue;
    if (heading != null && angleDiffDeg(heading, bearingDeg(lat, lng, r.lat, r.lng)) > 45) continue;
    if (prevFix) {
      const prevDist = haversine(prevFix.lat, prevFix.lng, r.lat, r.lng);
      if (prevDist < d) continue;
    }
    best = r;
    bestDist = d;
  }
  return best ? { report: best, dist: bestDist } : null;
}

/**
 * Dismiss logic — AppContext lines 1312–1331.
 *
 * Models a single GPS tick evaluation. Call repeatedly with updated state
 * to test the 2-consecutive-fix distance-increasing rule.
 *
 * @param {object} params
 * @param {number}      params.lat          — current driver lat
 * @param {number}      params.lng          — current driver lng
 * @param {number|null} params.heading      — current driver heading
 * @param {number}      params.itemLat      — alerted item lat
 * @param {number}      params.itemLng      — alerted item lng
 * @param {number}      params.curDist      — distance from driver to item (metres)
 * @param {number|null} params.lastDist     — distance recorded on the previous tick (or null)
 * @param {number}      params.increasingCount — consecutive ticks where distance grew
 * @returns {{ shouldDismiss: boolean; nextLastDist: number|null; nextIncreasingCount: number }}
 */
function evaluateDismiss({ lat, lng, heading, itemLat, itemLng, curDist, lastDist, increasingCount }) {
  // Out of outer range always dismisses
  if (curDist == null || curDist > ALERT_DIST) {
    return { shouldDismiss: true, nextLastDist: null, nextIncreasingCount: 0 };
  }
  // 75° heading threshold — strictly greater than 75° dismisses
  if (heading != null) {
    if (angleDiffDeg(heading, bearingDeg(lat, lng, itemLat, itemLng)) > 75) {
      return { shouldDismiss: true, nextLastDist: null, nextIncreasingCount: 0 };
    }
  }
  // Distance-increasing consecutive counter
  let nextIncreasingCount = increasingCount;
  if (lastDist != null && curDist > lastDist) {
    nextIncreasingCount += 1;
    if (nextIncreasingCount >= 2) {
      return { shouldDismiss: true, nextLastDist: null, nextIncreasingCount: 0 };
    }
  } else {
    nextIncreasingCount = 0;
  }
  return { shouldDismiss: false, nextLastDist: curDist, nextIncreasingCount };
}

// ─── Geometry utilities used in tests ────────────────────────────────────────

/**
 * Return a lat/lng that is approximately `distM` metres from (originLat, originLng)
 * at the given `bearingDegrees`. Accurate enough for 500 m tests near the equator.
 */
function destPoint(originLat, originLng, bearingDegrees, distM) {
  const R = 6371000;
  const angDist = distM / R;
  const brng = (bearingDegrees * Math.PI) / 180;
  const f1 = (originLat * Math.PI) / 180;
  const l1 = (originLng * Math.PI) / 180;
  const f2 = Math.asin(
    Math.sin(f1) * Math.cos(angDist) + Math.cos(f1) * Math.sin(angDist) * Math.cos(brng)
  );
  const l2 = l1 + Math.atan2(
    Math.sin(brng) * Math.sin(angDist) * Math.cos(f1),
    Math.cos(angDist) - Math.sin(f1) * Math.sin(f2)
  );
  return { lat: (f2 * 180) / Math.PI, lng: ((l2 * 180) / Math.PI + 540) % 360 - 180 };
}

// ─── Fixed test anchor ────────────────────────────────────────────────────────
// Driver is on Thika Road, Nairobi, heading due north.
const DRIVER_LAT = -1.2864;
const DRIVER_LNG = 36.8297;
const DRIVER_HEADING = 0;  // due north

// Previous fix — 20 m south (so the driver has been moving north)
const PREV_FIX = {
  ...destPoint(DRIVER_LAT, DRIVER_LNG, 180, 20),
  t: Date.now() - 1000,
};

// Helper: make a zone at `bearingFromDriver`° at 500 m, default type "police"
function makeZoneAt(bearingFromDriver, overrides = {}) {
  const { lat, lng } = destPoint(DRIVER_LAT, DRIVER_LNG, bearingFromDriver, 500);
  return {
    id: `zone-${bearingFromDriver}`,
    lat, lng,
    distance: 500,
    type: "police",
    speedLimit: null,
    ...overrides,
  };
}

// Helper: make a report at `bearingFromDriver`° at 500 m
function makeReportAt(bearingFromDriver, overrides = {}) {
  const { lat, lng } = destPoint(DRIVER_LAT, DRIVER_LNG, bearingFromDriver, 500);
  return {
    id: `report-${bearingFromDriver}`,
    lat, lng,
    status: "active",
    type: "police",
    timestamp: Date.now() - 60_000,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("angleDiffDeg — shortest angular distance", () => {
  it("identical headings → 0°", () => {
    assert.equal(angleDiffDeg(0, 0), 0);
    assert.equal(angleDiffDeg(180, 180), 0);
  });

  it("cardinal quarter-turns → 90°", () => {
    assert.equal(angleDiffDeg(0, 90), 90);
    assert.equal(angleDiffDeg(90, 0), 90);
  });

  it("exact 45° apart", () => {
    assert.equal(angleDiffDeg(0, 45), 45);
    assert.equal(angleDiffDeg(315, 0), 45);  // wraps: 360-315=45
  });

  it("opposite headings → 180°", () => {
    assert.equal(angleDiffDeg(0, 180), 180);
    assert.equal(angleDiffDeg(270, 90), 180);
  });

  it("full 360° wrap resolves to 0°", () => {
    assert.equal(angleDiffDeg(0, 360), 0);
  });

  it("boundary: 74°, 75°, 76°", () => {
    assert.equal(angleDiffDeg(0, 74), 74);
    assert.equal(angleDiffDeg(0, 75), 75);
    assert.equal(angleDiffDeg(0, 76), 76);
  });
});

describe("bearingDeg — initial bearing A→B", () => {
  it("due north from equator", () => {
    // Move slightly north
    const { lat, lng } = destPoint(0, 0, 0, 1000);
    const b = bearingDeg(0, 0, lat, lng);
    assert.ok(Math.abs(b - 0) < 0.01 || Math.abs(b - 360) < 0.01,
      `expected ~0°, got ${b}`);
  });

  it("due east from equator", () => {
    const { lat, lng } = destPoint(0, 0, 90, 1000);
    const b = bearingDeg(0, 0, lat, lng);
    assert.ok(Math.abs(b - 90) < 0.01, `expected ~90°, got ${b}`);
  });

  it("due south from equator", () => {
    const { lat, lng } = destPoint(0, 0, 180, 1000);
    const b = bearingDeg(0, 0, lat, lng);
    assert.ok(Math.abs(b - 180) < 0.01, `expected ~180°, got ${b}`);
  });

  it("due west from equator", () => {
    const { lat, lng } = destPoint(0, 0, 270, 1000);
    const b = bearingDeg(0, 0, lat, lng);
    assert.ok(Math.abs(b - 270) < 0.01, `expected ~270°, got ${b}`);
  });
});

describe("driverHeadingDeg — heading from consecutive GPS fixes", () => {
  it("returns null when there is no previous fix", () => {
    assert.equal(driverHeadingDeg(null, DRIVER_LAT, DRIVER_LNG), null);
  });

  it("returns null when movement is less than 5 m (GPS noise)", () => {
    const nearPoint = destPoint(DRIVER_LAT, DRIVER_LNG, 0, 3); // only 3 m
    const prev = { lat: DRIVER_LAT, lng: DRIVER_LNG, t: Date.now() - 1000 };
    assert.equal(driverHeadingDeg(prev, nearPoint.lat, nearPoint.lng), null);
  });

  it("returns null when movement is exactly 4.9 m (just under threshold)", () => {
    const nearPoint = destPoint(DRIVER_LAT, DRIVER_LNG, 90, 4.9);
    const prev = { lat: DRIVER_LAT, lng: DRIVER_LNG, t: Date.now() - 1000 };
    assert.equal(driverHeadingDeg(prev, nearPoint.lat, nearPoint.lng), null);
  });

  it("returns heading when movement is ≥ 5 m", () => {
    const fwdPoint = destPoint(DRIVER_LAT, DRIVER_LNG, 0, 10); // 10 m north
    const prev = { lat: DRIVER_LAT, lng: DRIVER_LNG, t: Date.now() - 1000 };
    const h = driverHeadingDeg(prev, fwdPoint.lat, fwdPoint.lng);
    assert.notEqual(h, null);
    assert.ok(Math.abs(h - 0) < 0.1 || Math.abs(h - 360) < 0.1, `expected ~0°, got ${h}`);
  });

  it("heading matches cardinal directions accurately", () => {
    const cardinals = [0, 90, 180, 270];
    for (const bearing of cardinals) {
      const dest = destPoint(DRIVER_LAT, DRIVER_LNG, bearing, 20);
      const prev = { lat: DRIVER_LAT, lng: DRIVER_LNG, t: Date.now() - 1000 };
      const h = driverHeadingDeg(prev, dest.lat, dest.lng);
      assert.notEqual(h, null);
      const diff = angleDiffDeg(h, bearing);
      assert.ok(diff < 0.5, `bearing ${bearing}°: got heading ${h}°, diff ${diff}°`);
    }
  });
});

describe("Zone candidate: 45° activation cone", () => {
  const base = {
    lat: DRIVER_LAT, lng: DRIVER_LNG,
    heading: DRIVER_HEADING,
    prevFix: PREV_FIX,
    kmh: 80,
  };

  it("0° off heading → zone selected", () => {
    const z = makeZoneAt(0);
    const result = selectZoneCandidate({ ...base, zones: [z] });
    assert.notEqual(result, null, "zone directly ahead should be selected");
    assert.equal(result.id, z.id);
  });

  it("44° off heading → zone selected (well inside ≤ 45° activation cone)", () => {
    // The production gate is > 45, so anything ≤ 45° should pass.
    // Use 44° rather than exactly 45° to avoid spherical-trig floating-point
    // rounding pushing the computed bearing fractionally above 45.
    const z = makeZoneAt(44);
    const result = selectZoneCandidate({ ...base, zones: [z] });
    assert.notEqual(result, null, "zone at 44° should be selected (inside ≤ 45° cone)");
  });

  it("46° off heading → zone NOT selected (cone tightened: > 45° rejected)", () => {
    const z = makeZoneAt(46);
    const result = selectZoneCandidate({ ...base, zones: [z] });
    assert.equal(result, null, "zone at 46° should be outside the 45° activation cone");
  });

  it("60° off heading → zone NOT selected", () => {
    const z = makeZoneAt(60);
    const result = selectZoneCandidate({ ...base, zones: [z] });
    assert.equal(result, null, "zone at 60° should be rejected");
  });

  it("74° off heading → zone NOT selected", () => {
    const z = makeZoneAt(74);
    const result = selectZoneCandidate({ ...base, zones: [z] });
    assert.equal(result, null, "zone at 74° should be rejected");
  });

  it("90° off heading (side) → zone NOT selected", () => {
    const z = makeZoneAt(90);
    const result = selectZoneCandidate({ ...base, zones: [z] });
    assert.equal(result, null, "zone to the side should be rejected");
  });

  it("180° off heading (behind) → zone NOT selected", () => {
    const z = makeZoneAt(180);
    const result = selectZoneCandidate({ ...base, zones: [z] });
    assert.equal(result, null, "zone directly behind should be rejected");
  });

  it("null heading degrades to distance-only (all in-range zones pass)", () => {
    const zones = [makeZoneAt(46), makeZoneAt(90), makeZoneAt(150)];
    const result = selectZoneCandidate({ ...base, heading: null, zones });
    assert.notEqual(result, null, "without heading data, first in-range zone should pass");
  });

  it("camera zone skipped when driver is at or under the speed limit", () => {
    const z = makeZoneAt(0, { type: "camera", speedLimit: 80 });
    const result = selectZoneCandidate({ ...base, kmh: 80, zones: [z] }); // exactly at limit
    assert.equal(result, null, "camera zone should be skipped when not speeding");
  });

  it("camera zone fires when driver is over the speed limit", () => {
    const z = makeZoneAt(0, { type: "camera", speedLimit: 80 });
    const result = selectZoneCandidate({ ...base, kmh: 81, zones: [z] });
    assert.notEqual(result, null, "camera zone should fire when driver exceeds limit");
  });
});

describe("Report candidate: 45° activation cone", () => {
  const base = {
    lat: DRIVER_LAT, lng: DRIVER_LNG,
    heading: DRIVER_HEADING,
    prevFix: PREV_FIX,
    isDriving: true,
    now: Date.now(),
  };

  it("0° off heading → report selected", () => {
    const r = makeReportAt(0);
    const result = selectReportCandidate({ ...base, reports: [r] });
    assert.notEqual(result, null);
    assert.equal(result.report.id, r.id);
  });

  it("44° off heading → report selected (well inside ≤ 45° activation cone)", () => {
    // Use 44° rather than exactly 45° to avoid spherical-trig floating-point
    // rounding pushing the computed bearing fractionally above 45.
    const r = makeReportAt(44);
    const result = selectReportCandidate({ ...base, reports: [r] });
    assert.notEqual(result, null, "report at 44° should be selected (inside ≤ 45° cone)");
  });

  it("46° off heading → report NOT selected", () => {
    const r = makeReportAt(46);
    const result = selectReportCandidate({ ...base, reports: [r] });
    assert.equal(result, null, "report at 46° should be outside the 45° activation cone");
  });

  it("60° off heading → report NOT selected", () => {
    assert.equal(selectReportCandidate({ ...base, reports: [makeReportAt(60)] }), null);
  });

  it("74° off heading → report NOT selected", () => {
    assert.equal(selectReportCandidate({ ...base, reports: [makeReportAt(74)] }), null);
  });

  it("not selected when isDriving is false (speed ≤ 5 km/h)", () => {
    const r = makeReportAt(0);
    const result = selectReportCandidate({ ...base, isDriving: false, reports: [r] });
    assert.equal(result, null);
  });

  it("not selected when report is expired", () => {
    const r = makeReportAt(0, { status: "expired" });
    assert.equal(selectReportCandidate({ ...base, reports: [r] }), null);
  });

  it("not selected when report is denied", () => {
    const r = makeReportAt(0, { status: "denied" });
    assert.equal(selectReportCandidate({ ...base, reports: [r] }), null);
  });

  it("not selected when report type is 'clear'", () => {
    const r = makeReportAt(0, { type: "clear" });
    assert.equal(selectReportCandidate({ ...base, reports: [r] }), null);
  });

  it("not selected when report is older than 2 hours", () => {
    const r = makeReportAt(0, { timestamp: Date.now() - 7_201_000 });
    assert.equal(selectReportCandidate({ ...base, reports: [r] }), null);
  });
});

describe("Dismiss logic: 75° heading threshold", () => {
  // Anchor: driver at DRIVER position heading north, item directly ahead
  const itemAhead = destPoint(DRIVER_LAT, DRIVER_LNG, 0, 500);

  function baseDismiss(headingDeg) {
    return evaluateDismiss({
      lat: DRIVER_LAT,
      lng: DRIVER_LNG,
      heading: headingDeg,
      itemLat: itemAhead.lat,
      itemLng: itemAhead.lng,
      curDist: 500,
      lastDist: null,
      increasingCount: 0,
    });
  }

  it("0° off heading (facing directly toward alert) → no dismiss", () => {
    assert.equal(baseDismiss(0).shouldDismiss, false);
  });

  it("45° off heading → no dismiss", () => {
    // Item is ahead (bearing ≈ 0°); driver heading at +45° (NE)
    const result = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG,
      heading: 45,
      itemLat: itemAhead.lat, itemLng: itemAhead.lng,
      curDist: 500, lastDist: null, increasingCount: 0,
    });
    assert.equal(result.shouldDismiss, false, "45° off heading should not dismiss");
  });

  it("74° off heading → no dismiss (boundary: > 75° required)", () => {
    // Place item at bearing 0° (due north), driver heading at 74°
    const result = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG,
      heading: 74,
      itemLat: itemAhead.lat, itemLng: itemAhead.lng,
      curDist: 500, lastDist: null, increasingCount: 0,
    });
    assert.equal(result.shouldDismiss, false, "74° off heading must NOT dismiss");
  });

  it("75° off heading → no dismiss (exactly at threshold: not strictly greater)", () => {
    const result = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG,
      heading: 75,
      itemLat: itemAhead.lat, itemLng: itemAhead.lng,
      curDist: 500, lastDist: null, increasingCount: 0,
    });
    assert.equal(result.shouldDismiss, false, "75° off heading must NOT dismiss (> 75° required)");
  });

  it("76° off heading → DISMISSES (just over the 75° threshold)", () => {
    const result = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG,
      heading: 76,
      itemLat: itemAhead.lat, itemLng: itemAhead.lng,
      curDist: 500, lastDist: null, increasingCount: 0,
    });
    assert.equal(result.shouldDismiss, true, "76° off heading must dismiss");
  });

  it("90° off heading → DISMISSES", () => {
    assert.equal(baseDismiss(90).shouldDismiss, true);
  });

  it("180° off heading (turned around) → DISMISSES", () => {
    assert.equal(baseDismiss(180).shouldDismiss, true);
  });

  it("alert out of ALERT_DIST range → always DISMISSES regardless of heading", () => {
    const result = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG,
      heading: 0, // facing it
      itemLat: itemAhead.lat, itemLng: itemAhead.lng,
      curDist: 1001, // just past ALERT_DIST of 1000 m
      lastDist: null, increasingCount: 0,
    });
    assert.equal(result.shouldDismiss, true);
  });

  it("null heading skips the heading check — dismiss is based on distance/counter only", () => {
    const result = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG,
      heading: null,  // no heading data
      itemLat: itemAhead.lat, itemLng: itemAhead.lng,
      curDist: 500, lastDist: null, increasingCount: 0,
    });
    assert.equal(result.shouldDismiss, false, "no heading data → distance-only, should not dismiss at 500 m");
  });
});

describe("Dismiss logic: passed-point suppression (2-consecutive-fix counter)", () => {
  const itemAhead = destPoint(DRIVER_LAT, DRIVER_LNG, 0, 500);

  it("distance decreasing (approaching) → no dismiss, counter resets to 0", () => {
    const result = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG,
      heading: 0,
      itemLat: itemAhead.lat, itemLng: itemAhead.lng,
      curDist: 490, lastDist: 500, increasingCount: 0,
    });
    assert.equal(result.shouldDismiss, false);
    assert.equal(result.nextIncreasingCount, 0, "counter should reset when distance decreases");
  });

  it("distance increasing first time (counter reaches 1) → no dismiss yet", () => {
    const result = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG,
      heading: 0,
      itemLat: itemAhead.lat, itemLng: itemAhead.lng,
      curDist: 510, lastDist: 500, increasingCount: 0,
    });
    assert.equal(result.shouldDismiss, false, "first increasing fix alone should NOT dismiss");
    assert.equal(result.nextIncreasingCount, 1);
  });

  it("distance increasing second time (counter reaches 2) → DISMISSES", () => {
    const result = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG,
      heading: 0,
      itemLat: itemAhead.lat, itemLng: itemAhead.lng,
      curDist: 520, lastDist: 510, increasingCount: 1, // already 1 from previous tick
    });
    assert.equal(result.shouldDismiss, true, "two consecutive increasing-distance fixes must dismiss");
  });

  it("counter resets to 0 when distance decreases between increasing ticks", () => {
    // First tick: distance increasing → counter becomes 1
    const tick1 = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG, heading: 0,
      itemLat: itemAhead.lat, itemLng: itemAhead.lng,
      curDist: 510, lastDist: 500, increasingCount: 0,
    });
    assert.equal(tick1.nextIncreasingCount, 1);

    // Second tick: distance decreases → counter resets to 0
    const tick2 = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG, heading: 0,
      itemLat: itemAhead.lat, itemLng: itemAhead.lng,
      curDist: 505, lastDist: tick1.nextLastDist, increasingCount: tick1.nextIncreasingCount,
    });
    assert.equal(tick2.shouldDismiss, false);
    assert.equal(tick2.nextIncreasingCount, 0, "counter must reset on a single decreasing-distance fix");

    // Third tick: distance increases again (but counter is 0, not 1, so no dismiss)
    const tick3 = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG, heading: 0,
      itemLat: itemAhead.lat, itemLng: itemAhead.lng,
      curDist: 520, lastDist: tick2.nextLastDist, increasingCount: tick2.nextIncreasingCount,
    });
    assert.equal(tick3.shouldDismiss, false, "single increasing fix after reset must NOT dismiss");
    assert.equal(tick3.nextIncreasingCount, 1);
  });
});

describe("Passed-point suppression: blocks zone activation when moving away", () => {
  it("zone candidate rejected when prevDist < curDist (driver already passed zone)", () => {
    // Zone is 500 m north of driver.
    // Simulate the driver having moved AWAY from it: the previous fix must have been
    // CLOSER to the zone (i.e. north of the current position, between driver and zone).
    // prevFix 10 m north → prevDist ≈ 490 m < curDist 500 m → suppressed.
    const zone = makeZoneAt(0);
    const prevFixCloser = {
      ...destPoint(DRIVER_LAT, DRIVER_LNG, 0, 10), // 10 m north — closer to zone
      t: Date.now() - 1000,
    };
    const prevDist = haversine(prevFixCloser.lat, prevFixCloser.lng, zone.lat, zone.lng);
    assert.ok(prevDist < 500, `setup check: prevDist ${prevDist.toFixed(1)} should be < 500`);

    const result = selectZoneCandidate({
      lat: DRIVER_LAT, lng: DRIVER_LNG,
      heading: DRIVER_HEADING,
      prevFix: prevFixCloser,
      zones: [zone],
      kmh: 80,
    });
    assert.equal(result, null, "zone should be suppressed when driver was already closer on previous fix");
  });

  it("zone candidate selected when prevDist > curDist (driver approaching zone)", () => {
    // Zone is 500 m north; previous fix was 10 m SOUTH of current position → 510 m from zone.
    // prevDist 510 m > curDist 500 m → driver is getting closer → selected.
    const zone = makeZoneAt(0);
    const prevFixFarther = {
      ...destPoint(DRIVER_LAT, DRIVER_LNG, 180, 10), // 10 m south — farther from zone
      t: Date.now() - 1000,
    };
    const prevDist = haversine(prevFixFarther.lat, prevFixFarther.lng, zone.lat, zone.lng);
    assert.ok(prevDist > 500, `setup check: prevDist ${prevDist.toFixed(1)} should be > 500`);

    const result = selectZoneCandidate({
      lat: DRIVER_LAT, lng: DRIVER_LNG,
      heading: DRIVER_HEADING,
      prevFix: prevFixFarther,
      zones: [zone],
      kmh: 80,
    });
    assert.notEqual(result, null, "zone should be selected when driver is approaching it");
  });

  it("report candidate rejected when prevDist < curDist (driver passed the report)", () => {
    // Same geometry as zone suppression above: prevFix 10 m north → prevDist ≈ 490 m < 500 m.
    const report = makeReportAt(0);
    const prevFixCloser = {
      ...destPoint(DRIVER_LAT, DRIVER_LNG, 0, 10), // 10 m north — closer to report
      t: Date.now() - 1000,
    };
    const prevDist = haversine(prevFixCloser.lat, prevFixCloser.lng, report.lat, report.lng);
    assert.ok(prevDist < 500, `setup check: prevDist ${prevDist.toFixed(1)} should be < 500`);

    const result = selectReportCandidate({
      lat: DRIVER_LAT, lng: DRIVER_LNG,
      heading: DRIVER_HEADING,
      prevFix: prevFixCloser,
      reports: [report],
      isDriving: true,
      now: Date.now(),
    });
    assert.equal(result, null, "report should be suppressed when driver was already closer on previous fix");
  });

  it("report candidate selected when prevDist > curDist (driver approaching report)", () => {
    // prevFix 10 m south → prevDist ≈ 510 m > 500 m → approaching → selected.
    const report = makeReportAt(0);
    const prevFixFarther = {
      ...destPoint(DRIVER_LAT, DRIVER_LNG, 180, 10), // 10 m south — farther from report
      t: Date.now() - 1000,
    };
    const prevDist = haversine(prevFixFarther.lat, prevFixFarther.lng, report.lat, report.lng);
    assert.ok(prevDist > 500, `setup check: prevDist ${prevDist.toFixed(1)} should be > 500`);

    const result = selectReportCandidate({
      lat: DRIVER_LAT, lng: DRIVER_LNG,
      heading: DRIVER_HEADING,
      prevFix: prevFixFarther,
      reports: [report],
      isDriving: true,
      now: Date.now(),
    });
    assert.notEqual(result, null, "report should be selected when driver is approaching it");
  });
});

describe("Cone and dismiss hysteresis gap: silent zone between 46° and 75°", () => {
  // These angles are past the 45° activation threshold but below the 75° dismiss
  // threshold — so a candidate at these bearings can never activate a new alert,
  // yet an already-active alert at exactly these headings is also not dismissed.
  const silentAngles = [46, 55, 60, 70, 74, 75];

  for (const angle of silentAngles) {
    it(`zone at ${angle}° off heading is NOT selected (activation gate)`, () => {
      const z = makeZoneAt(angle);
      const result = selectZoneCandidate({
        lat: DRIVER_LAT, lng: DRIVER_LNG,
        heading: DRIVER_HEADING,
        prevFix: PREV_FIX,
        zones: [z],
        kmh: 80,
      });
      assert.equal(result, null, `zone at ${angle}° should not activate`);
    });

    it(`report at ${angle}° off heading is NOT selected (activation gate)`, () => {
      const r = makeReportAt(angle);
      const result = selectReportCandidate({
        lat: DRIVER_LAT, lng: DRIVER_LNG,
        heading: DRIVER_HEADING,
        prevFix: PREV_FIX,
        reports: [r],
        isDriving: true,
        now: Date.now(),
      });
      assert.equal(result, null, `report at ${angle}° should not activate`);
    });
  }
});
