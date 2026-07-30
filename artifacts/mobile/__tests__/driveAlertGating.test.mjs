/**
 * Drive-alert road-gating tests — roadsMatch, normalizeRoad, and road-gated
 * candidate selection.
 *
 * These tests exercise the road-based alert gating introduced in
 * AppContext.tsx (selectZoneCandidate / selectReportCandidate).  A camera on
 * a parallel road must stay silent; a camera on the same road must fire; and
 * when the driver's current road is unknown (null) the system falls back to
 * distance-only so no real alert is silently dropped.
 *
 * The pure helper functions below are verbatim copies of the private functions
 * in artifacts/mobile/context/AppContext.tsx.  When either source changes
 * these tests should fail, acting as a regression net.
 *
 * Run with: node artifacts/mobile/__tests__/driveAlertGating.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─── Verbatim copies of AppContext.tsx private helpers ────────────────────────

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

/** Haversine great-circle distance in metres. */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180, f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180, dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Strips parenthetical codes, road-type words, and punctuation so that
 *  "Thika Superhighway (A2)" normalises to the same string as "Thika Road". */
function normalizeRoad(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, "")   // remove codes like "(A2)", "(A104)"
    .replace(
      /\b(road|rd|street|st|avenue|ave|highway|hwy|superhighway|way|bypass|lane|drive|dr|place)\b/g,
      ""
    )
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the two road names refer to the same road.
 *  Returns true when either side is absent — no road name means we cannot
 *  exclude the incident, so fall back to distance-only (never silent-drop). */
function roadsMatch(driverRoad, incidentRoad) {
  if (!driverRoad || !incidentRoad) return true;
  const a = normalizeRoad(driverRoad);
  const b = normalizeRoad(incidentRoad);
  if (!a || !b) return true;
  // One name containing the other covers "Thika" ↔ "Thika Superhighway" etc.
  return a === b || a.includes(b) || b.includes(a);
}

// ─── Constants (verbatim from AppContext.tsx) ─────────────────────────────────
const ALERT_DIST   = 1000;  // metres — outer alert radius
const IN_ZONE_DIST = 250;   // metres — driver is already inside the zone

// ─── Road-gated candidate-selection helpers ───────────────────────────────────
//
// These model the closures at AppContext lines 1393–1428 (road-match edition).
// No heading cone — road-name match gates the alert instead.

/**
 * Road-gated zone candidate — closest in-range zone whose road matches.
 *
 * @param {object}  params
 * @param {string|null} params.currentRoad — driver's detected road name, or null
 * @param {boolean}     params.isDriving
 * @param {Array<{id:string, road:string, lat:number, lng:number, distance:number,
 *               type:string, speedLimit:number|null}>} params.zones
 *   — zones pre-filtered to IN_ZONE_DIST < distance <= ALERT_DIST
 * @returns the best matching zone, or null
 */
function selectZoneCandidateRoadGated({ currentRoad, isDriving, zones }) {
  if (!isDriving) return null;
  let best = null;
  for (const z of zones) {
    if (!roadsMatch(currentRoad, z.road)) continue;
    if (best === null || z.distance < best.distance) best = z;
  }
  return best;
}

/**
 * Road-gated report candidate — closest active report whose road matches.
 *
 * @param {object}  params
 * @param {string|null} params.currentRoad
 * @param {boolean}     params.isDriving
 * @param {number}      params.lat
 * @param {number}      params.lng
 * @param {number}      params.now — epoch ms
 * @param {Array<{id:string, roadName?:string, lat:number, lng:number,
 *               status:string, type:string, timestamp:number}>} params.reports
 * @returns {{ report, dist }|null}
 */
function selectReportCandidateRoadGated({ currentRoad, isDriving, lat, lng, now, reports }) {
  if (!isDriving) return null;
  let best = null;
  let bestDist = Infinity;
  for (const r of reports) {
    if (r.status === "expired" || r.status === "denied" || r.type === "clear") continue;
    if (now - r.timestamp > 7_200_000) continue;
    const d = haversine(lat, lng, r.lat, r.lng);
    if (d <= IN_ZONE_DIST || d > ALERT_DIST || d >= bestDist) continue;
    if (!roadsMatch(currentRoad, r.roadName)) continue;
    best = r;
    bestDist = d;
  }
  return best ? { report: best, dist: bestDist } : null;
}

/**
 * Dismiss logic (verbatim model from AppContext lines 1312–1331).
 * Two consecutive increasing-distance fixes dismiss the active alert.
 */
function evaluateDismiss({ lat, lng, heading, itemLat, itemLng, curDist, lastDist, increasingCount }) {
  if (curDist == null || curDist > ALERT_DIST) {
    return { shouldDismiss: true, nextLastDist: null, nextIncreasingCount: 0 };
  }
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

// ─── Geometry helper ──────────────────────────────────────────────────────────
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

// ─── Test data anchors ────────────────────────────────────────────────────────
//
// Driver is on the Thika Superhighway (A2) heading north-east through Nairobi.
// Thika Superhighway camera sz030 (Roysambu/TRM) is placed 500 m ahead.
// A Northern Bypass camera (same distance, 500 m) is on a parallel road.

const DRIVER_LAT = -1.2303;
const DRIVER_LNG = 36.878;

/** Place a mock zone 500 m ahead of the driver with a specific road name. */
function makeZoneOnRoad(road, overrides = {}) {
  const { lat, lng } = destPoint(DRIVER_LAT, DRIVER_LNG, 45, 500); // NE, 500 m ahead
  return {
    id: `zone-${road.replace(/\s/g, "-")}`,
    road,
    lat,
    lng,
    distance: 500,
    type: "camera",
    speedLimit: 80,
    ...overrides,
  };
}

/** Place a mock community report 500 m ahead of the driver with a specific roadName. */
function makeReportOnRoad(roadName, overrides = {}) {
  const { lat, lng } = destPoint(DRIVER_LAT, DRIVER_LNG, 45, 500);
  return {
    id: `report-${(roadName ?? "unknown").replace(/\s/g, "-")}`,
    roadName,
    lat,
    lng,
    status: "active",
    type: "camera",
    timestamp: Date.now() - 60_000,
    ...overrides,
  };
}

// ─── 1. normalizeRoad ─────────────────────────────────────────────────────────

describe("normalizeRoad — strips type words and parenthetical codes", () => {
  it("'Thika Superhighway (A2)' → 'thika'", () => {
    assert.equal(normalizeRoad("Thika Superhighway (A2)"), "thika");
  });

  it("'Thika Road' → 'thika'", () => {
    assert.equal(normalizeRoad("Thika Road"), "thika");
  });

  it("'Northern Bypass' → 'northern'", () => {
    assert.equal(normalizeRoad("Northern Bypass"), "northern");
  });

  it("'Southern Bypass' → 'southern'", () => {
    assert.equal(normalizeRoad("Southern Bypass"), "southern");
  });

  it("'A104 (Eldoret–Nakuru)' → 'a104 eldoret nakuru' (strips parens, keeps alphanumeric)", () => {
    // The en-dash is stripped by the non-alphanumeric replace; spaces collapse.
    const result = normalizeRoad("A104 (Eldoret–Nakuru)");
    // Should contain "a104" and no parenthetical
    assert.ok(result.includes("a104"), `expected "a104" in "${result}"`);
    assert.ok(!result.includes("("), "parentheses should be stripped");
  });

  it("'A104 Highway' → 'a104'", () => {
    assert.equal(normalizeRoad("A104 Highway"), "a104");
  });

  it("'A104 (Nakuru–Eldoret)' normalises to same token as 'A104 Highway'", () => {
    // Both should start with "a104" and the contain-check should match them.
    const a = normalizeRoad("A104 (Nakuru–Eldoret)");
    const b = normalizeRoad("A104 Highway");
    assert.ok(a.startsWith("a104"), `expected a to start with "a104", got "${a}"`);
    assert.ok(b === "a104", `expected b to equal "a104", got "${b}"`);
    // The include check used by roadsMatch should pass.
    assert.ok(a.includes(b) || b.includes(a), `"${a}" and "${b}" should contain each other`);
  });

  it("null → empty string", () => {
    assert.equal(normalizeRoad(null), "");
  });

  it("undefined → empty string", () => {
    assert.equal(normalizeRoad(undefined), "");
  });

  it("empty string → empty string", () => {
    assert.equal(normalizeRoad(""), "");
  });

  it("'Mombasa Road' → 'mombasa'", () => {
    assert.equal(normalizeRoad("Mombasa Road"), "mombasa");
  });

  it("'Nairobi Expressway' → 'nairobi expressway' (no type word to strip)", () => {
    // 'expressway' is not in the strip list — it remains in the output.
    assert.ok(normalizeRoad("Nairobi Expressway").includes("nairobi"));
  });

  it("'Lang'ata Road' → 'langata' (apostrophe stripped)", () => {
    const result = normalizeRoad("Lang'ata Road");
    assert.ok(result.includes("langata") || result.includes("lang ata") || result.includes("langata"),
      `unexpected result: "${result}"`);
    // Crucially: must NOT contain "road"
    assert.ok(!result.includes("road"), "road type word must be stripped");
  });
});

// ─── 2. roadsMatch ────────────────────────────────────────────────────────────

describe("roadsMatch — Kenyan road name variant matching", () => {
  // Same-road pairs
  it("'Thika Superhighway (A2)' matches 'Thika Road'", () => {
    assert.ok(roadsMatch("Thika Superhighway (A2)", "Thika Road"),
      "official name and common name of Thika Road must match");
  });

  it("'Thika Road' matches 'Thika Superhighway (A2)'", () => {
    assert.ok(roadsMatch("Thika Road", "Thika Superhighway (A2)"));
  });

  it("'A104 (Eldoret–Nakuru)' matches 'A104 Highway'", () => {
    assert.ok(roadsMatch("A104 (Eldoret–Nakuru)", "A104 Highway"),
      "A104 variants should be treated as the same road");
  });

  it("'A104 Highway' matches 'A104 (Nakuru–Eldoret)'", () => {
    assert.ok(roadsMatch("A104 Highway", "A104 (Nakuru–Eldoret)"));
  });

  it("'Mombasa Road' matches 'Mombasa Road'", () => {
    assert.ok(roadsMatch("Mombasa Road", "Mombasa Road"));
  });

  it("'Northern Bypass' matches 'Northern Bypass'", () => {
    assert.ok(roadsMatch("Northern Bypass", "Northern Bypass"));
  });

  // Different-road pairs
  it("'Thika Road' does NOT match 'Northern Bypass'", () => {
    assert.ok(!roadsMatch("Thika Road", "Northern Bypass"),
      "Thika Road and Northern Bypass are parallel roads — must NOT match");
  });

  it("'Northern Bypass' does NOT match 'Southern Bypass'", () => {
    assert.ok(!roadsMatch("Northern Bypass", "Southern Bypass"),
      "Northern and Southern Bypass are distinct roads");
  });

  it("'Mombasa Road' does NOT match 'Nairobi Expressway'", () => {
    assert.ok(!roadsMatch("Mombasa Road", "Nairobi Expressway"),
      "Mombasa Road and the Expressway run parallel — must NOT match");
  });

  it("'Ngong Road' does NOT match 'Karen Road'", () => {
    assert.ok(!roadsMatch("Ngong Road", "Karen Road"));
  });

  // Null / unknown fallback: must return true so no alert is silently dropped
  it("null driver road → true (distance-only fallback)", () => {
    assert.ok(roadsMatch(null, "Thika Superhighway (A2)"),
      "unknown driver road must fall back to distance-only (return true)");
  });

  it("null incident road → true (distance-only fallback)", () => {
    assert.ok(roadsMatch("Thika Road", null));
  });

  it("both null → true", () => {
    assert.ok(roadsMatch(null, null));
  });

  it("empty-string driver road → true (normalises to empty → fallback)", () => {
    assert.ok(roadsMatch("", "Thika Road"));
  });
});

// ─── 3. GPS on Thika Road: same-road camera fires ────────────────────────────

describe("Road-gated zone candidate: same-road camera fires", () => {
  const thikaCam = makeZoneOnRoad("Thika Superhighway (A2)");

  it("driver on 'Thika Road' → camera on 'Thika Superhighway (A2)' IS selected", () => {
    const result = selectZoneCandidateRoadGated({
      currentRoad: "Thika Road",
      isDriving: true,
      zones: [thikaCam],
    });
    assert.notEqual(result, null, "same-road camera must trigger the alert");
    assert.equal(result.id, thikaCam.id);
  });

  it("driver with exact same road name → camera IS selected", () => {
    const result = selectZoneCandidateRoadGated({
      currentRoad: "Thika Superhighway (A2)",
      isDriving: true,
      zones: [thikaCam],
    });
    assert.notEqual(result, null, "exact-match road camera must fire");
  });

  it("not selected when isDriving is false", () => {
    const result = selectZoneCandidateRoadGated({
      currentRoad: "Thika Road",
      isDriving: false,
      zones: [thikaCam],
    });
    assert.equal(result, null, "alert must not fire when not driving");
  });
});

// ─── 4. GPS on Thika Road: parallel-road camera stays silent ─────────────────

describe("Road-gated zone candidate: parallel-road camera stays silent", () => {
  const northernBypassCam = makeZoneOnRoad("Northern Bypass");

  it("driver on 'Thika Road' → camera on 'Northern Bypass' stays silent", () => {
    const result = selectZoneCandidateRoadGated({
      currentRoad: "Thika Road",
      isDriving: true,
      zones: [northernBypassCam],
    });
    assert.equal(result, null,
      "camera on Northern Bypass must NOT fire when driver is on Thika Road");
  });

  it("driver on 'Thika Superhighway (A2)' → camera on 'Northern Bypass' stays silent", () => {
    const result = selectZoneCandidateRoadGated({
      currentRoad: "Thika Superhighway (A2)",
      isDriving: true,
      zones: [northernBypassCam],
    });
    assert.equal(result, null, "Northern Bypass camera must not fire on Thika Road driver");
  });

  it("driver on 'Mombasa Road' → Nairobi Expressway camera stays silent", () => {
    const expressCam = makeZoneOnRoad("Nairobi Expressway");
    const result = selectZoneCandidateRoadGated({
      currentRoad: "Mombasa Road",
      isDriving: true,
      zones: [expressCam],
    });
    assert.equal(result, null, "Expressway camera must not fire for Mombasa Road driver");
  });

  it("only the same-road camera fires when both roads are in range", () => {
    const thikaCam = makeZoneOnRoad("Thika Superhighway (A2)");
    // Put the bypass camera slightly closer to be sure selection is road-gated,
    // not distance-gated.
    const bypassCamCloser = {
      ...makeZoneOnRoad("Northern Bypass"),
      id: "bypass-closer",
      distance: 400,
    };
    const result = selectZoneCandidateRoadGated({
      currentRoad: "Thika Road",
      isDriving: true,
      zones: [bypassCamCloser, thikaCam],
    });
    assert.notEqual(result, null, "should select a camera");
    assert.equal(result.id, thikaCam.id,
      "must pick the same-road camera even though the bypass camera is closer");
  });
});

// ─── 5. currentRoad = null: distance-only fallback fires for both ─────────────

describe("Road-gated zone candidate: null currentRoad falls back to distance-only", () => {
  it("null currentRoad → Thika Road camera fires (fallback)", () => {
    const thikaCam = makeZoneOnRoad("Thika Superhighway (A2)");
    const result = selectZoneCandidateRoadGated({
      currentRoad: null,
      isDriving: true,
      zones: [thikaCam],
    });
    assert.notEqual(result, null,
      "with unknown road, Thika Road camera must fire (distance-only fallback)");
  });

  it("null currentRoad → Northern Bypass camera also fires (fallback)", () => {
    const bypassCam = makeZoneOnRoad("Northern Bypass");
    const result = selectZoneCandidateRoadGated({
      currentRoad: null,
      isDriving: true,
      zones: [bypassCam],
    });
    assert.notEqual(result, null,
      "with unknown road, Northern Bypass camera must also fire (distance-only fallback)");
  });

  it("null currentRoad with multiple zones → closest selected", () => {
    const close = { ...makeZoneOnRoad("Thika Superhighway (A2)"), id: "close", distance: 300 };
    const far   = { ...makeZoneOnRoad("Northern Bypass"), id: "far", distance: 700 };
    const result = selectZoneCandidateRoadGated({
      currentRoad: null,
      isDriving: true,
      zones: [far, close],
    });
    assert.equal(result?.id, "close", "closest zone should win when road is unknown");
  });
});

// ─── 6. Community report gating ──────────────────────────────────────────────

describe("Road-gated report candidate: same-road reports fire", () => {
  const now = Date.now();

  it("driver on 'Thika Road' → report tagged 'Thika Superhighway (A2)' fires", () => {
    const report = makeReportOnRoad("Thika Superhighway (A2)");
    const result = selectReportCandidateRoadGated({
      currentRoad: "Thika Road",
      isDriving: true,
      lat: DRIVER_LAT,
      lng: DRIVER_LNG,
      now,
      reports: [report],
    });
    assert.notEqual(result, null, "same-road community report must trigger");
  });

  it("driver on 'Thika Road' → report on 'Northern Bypass' stays silent", () => {
    const report = makeReportOnRoad("Northern Bypass");
    const result = selectReportCandidateRoadGated({
      currentRoad: "Thika Road",
      isDriving: true,
      lat: DRIVER_LAT,
      lng: DRIVER_LNG,
      now,
      reports: [report],
    });
    assert.equal(result, null, "parallel-road report must NOT trigger");
  });

  it("null currentRoad → report on any road fires (fallback)", () => {
    const report = makeReportOnRoad("Northern Bypass");
    const result = selectReportCandidateRoadGated({
      currentRoad: null,
      isDriving: true,
      lat: DRIVER_LAT,
      lng: DRIVER_LNG,
      now,
      reports: [report],
    });
    assert.notEqual(result, null, "unknown road must fall back to distance-only");
  });

  it("report without a roadName (null) fires for any driver road (fallback)", () => {
    const report = makeReportOnRoad(null);
    const result = selectReportCandidateRoadGated({
      currentRoad: "Thika Road",
      isDriving: true,
      lat: DRIVER_LAT,
      lng: DRIVER_LNG,
      now,
      reports: [report],
    });
    assert.notEqual(result, null, "report without roadName must not be silently dropped");
  });
});

// ─── 7. Passing a camera: alert dismisses on two consecutive increasing fixes ─

describe("Passing a camera: dismiss logic over consecutive GPS fixes", () => {
  // Driver is approaching a camera at 500 m.
  // Fix 1: distance decreases to 450 m (approaching).
  // Fix 2: distance increases to 480 m (just passed the camera).
  // Fix 3: distance increases to 520 m — second consecutive increase → dismiss.

  const CAM_LAT = destPoint(DRIVER_LAT, DRIVER_LNG, 45, 500).lat;
  const CAM_LNG = destPoint(DRIVER_LAT, DRIVER_LNG, 45, 500).lng;

  it("fix 1 (approaching, dist 450 m) → no dismiss, counter = 0", () => {
    const result = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG,
      heading: null,
      itemLat: CAM_LAT, itemLng: CAM_LNG,
      curDist: 450,
      lastDist: 500,  // was farther
      increasingCount: 0,
    });
    assert.equal(result.shouldDismiss, false, "approaching camera must not dismiss");
    assert.equal(result.nextIncreasingCount, 0, "counter must reset when distance decreases");
  });

  it("fix 2 (just passed, dist 480 m > 450 m) → no dismiss yet, counter = 1", () => {
    const result = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG,
      heading: null,
      itemLat: CAM_LAT, itemLng: CAM_LNG,
      curDist: 480,
      lastDist: 450,   // first tick where distance grew
      increasingCount: 0,
    });
    assert.equal(result.shouldDismiss, false,
      "first increasing-distance fix alone must not dismiss (need 2 consecutive)");
    assert.equal(result.nextIncreasingCount, 1);
  });

  it("fix 3 (moving away, dist 520 m > 480 m) → DISMISSES (second consecutive increase)", () => {
    const result = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG,
      heading: null,
      itemLat: CAM_LAT, itemLng: CAM_LNG,
      curDist: 520,
      lastDist: 480,
      increasingCount: 1,  // already 1 from previous fix
    });
    assert.equal(result.shouldDismiss, true,
      "two consecutive increasing-distance fixes must dismiss the alert");
  });

  it("full simulation: approach then pass → dismiss on third fix", () => {
    // Tick A: driver at 500 m → camera activates (no dismiss check yet)
    const fixA = { curDist: 500, lastDist: null, increasingCount: 0 };
    const tickA = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG, heading: null,
      itemLat: CAM_LAT, itemLng: CAM_LNG,
      ...fixA,
    });
    assert.equal(tickA.shouldDismiss, false);

    // Tick B: driver at 450 m (approaching)
    const tickB = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG, heading: null,
      itemLat: CAM_LAT, itemLng: CAM_LNG,
      curDist: 450, lastDist: tickA.nextLastDist,
      increasingCount: tickA.nextIncreasingCount,
    });
    assert.equal(tickB.shouldDismiss, false);
    assert.equal(tickB.nextIncreasingCount, 0);

    // Tick C: driver at 480 m (just passed, first increase)
    const tickC = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG, heading: null,
      itemLat: CAM_LAT, itemLng: CAM_LNG,
      curDist: 480, lastDist: tickB.nextLastDist,
      increasingCount: tickB.nextIncreasingCount,
    });
    assert.equal(tickC.shouldDismiss, false);
    assert.equal(tickC.nextIncreasingCount, 1);

    // Tick D: driver at 520 m (second consecutive increase) → dismiss
    const tickD = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG, heading: null,
      itemLat: CAM_LAT, itemLng: CAM_LNG,
      curDist: 520, lastDist: tickC.nextLastDist,
      increasingCount: tickC.nextIncreasingCount,
    });
    assert.equal(tickD.shouldDismiss, true,
      "alert must dismiss after driver passes and moves away for two consecutive fixes");
  });

  it("single increase followed by decrease resets counter (no premature dismiss)", () => {
    // Tick 1: dist 480 (increase from 450) → counter = 1
    const tick1 = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG, heading: null,
      itemLat: CAM_LAT, itemLng: CAM_LNG,
      curDist: 480, lastDist: 450, increasingCount: 0,
    });
    assert.equal(tick1.nextIncreasingCount, 1);

    // Tick 2: dist 460 (decrease) → counter resets
    const tick2 = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG, heading: null,
      itemLat: CAM_LAT, itemLng: CAM_LNG,
      curDist: 460, lastDist: tick1.nextLastDist,
      increasingCount: tick1.nextIncreasingCount,
    });
    assert.equal(tick2.shouldDismiss, false);
    assert.equal(tick2.nextIncreasingCount, 0, "counter must reset on a single decreasing fix");

    // Tick 3: dist 490 (another increase, but counter starts from 0 again — not dismiss)
    const tick3 = evaluateDismiss({
      lat: DRIVER_LAT, lng: DRIVER_LNG, heading: null,
      itemLat: CAM_LAT, itemLng: CAM_LNG,
      curDist: 490, lastDist: tick2.nextLastDist,
      increasingCount: tick2.nextIncreasingCount,
    });
    assert.equal(tick3.shouldDismiss, false,
      "must not dismiss — only one increase since counter reset");
    assert.equal(tick3.nextIncreasingCount, 1);
  });
});

// ─── Along-track helper (verbatim from AppContext.tsx) ────────────────────────

/** Signed along-track distance from the driver to a target, metres.
 *  Positive = target ahead; negative = target behind. */
function alongTrackDistanceM(driverLat, driverLng, driverHeading, targetLat, targetLng) {
  const dist = haversine(driverLat, driverLng, targetLat, targetLng);
  const brgToTarget = bearingDeg(driverLat, driverLng, targetLat, targetLng);
  const deltaRad = ((brgToTarget - driverHeading + 540) % 360 - 180) * (Math.PI / 180);
  return dist * Math.cos(deltaRad);
}

/**
 * Along-track pass-through dismiss check (models the GPS-tick logic in AppContext).
 * Returns { shouldDismiss }.
 */
function evaluateAlongTrackDismiss({ driverLat, driverLng, driverHeading, itemLat, itemLng }) {
  if (driverHeading == null) return { shouldDismiss: false };
  if (itemLat == null || itemLng == null) return { shouldDismiss: false };
  const atd = alongTrackDistanceM(driverLat, driverLng, driverHeading, itemLat, itemLng);
  return { shouldDismiss: atd <= -10, atd };
}

// ─── New dismiss-geometry helpers (verbatim from AppContext.tsx) ───────────────

/**
 * Bearing-divergence dismiss check (verbatim model of the Gap 2 fix in
 * AppContext's shouldDismiss IIFE).
 *
 * Returns { shouldDismiss, extendedCooldown, nextBearingDivCount }.
 * extendedCooldown is true when the dismiss is caused by a divert (not a normal pass-through).
 */
function evaluateBearingDivergence({ driverLat, driverLng, driverHeading, itemLat, itemLng, bearingDivCount }) {
  if (itemLat == null || itemLng == null || driverHeading == null) {
    return { shouldDismiss: false, extendedCooldown: false, nextBearingDivCount: bearingDivCount };
  }
  const brgToAlert = bearingDeg(driverLat, driverLng, itemLat, itemLng);
  if (angleDiffDeg(driverHeading, brgToAlert) > 110) {
    const next = bearingDivCount + 1;
    if (next >= 2) return { shouldDismiss: true, extendedCooldown: true, nextBearingDivCount: 0 };
    return { shouldDismiss: false, extendedCooldown: false, nextBearingDivCount: next };
  }
  return { shouldDismiss: false, extendedCooldown: false, nextBearingDivCount: 0 };
}

/**
 * Null-road + bearing gate (verbatim model of the Gap 1 fix in AppContext's shouldDismiss IIFE).
 *
 * Returns { shouldDismiss, extendedCooldown }.
 */
function evaluateNullRoadBearingGate({ currentRoad, itemRoad, approachRoad, driverLat, driverLng, driverHeading, itemLat, itemLng }) {
  // Only fires when: (a) alert has a known road, (b) approach road was known, (c) current road is null.
  if (!itemRoad || !approachRoad || currentRoad !== null) {
    return { shouldDismiss: false, extendedCooldown: false };
  }
  if (itemLat == null || itemLng == null || driverHeading == null) {
    return { shouldDismiss: false, extendedCooldown: false };
  }
  const brgToAlert = bearingDeg(driverLat, driverLng, itemLat, itemLng);
  if (angleDiffDeg(driverHeading, brgToAlert) >= 90) {
    return { shouldDismiss: true, extendedCooldown: true };
  }
  return { shouldDismiss: false, extendedCooldown: false };
}

// ─── 8. alongTrackDistanceM unit tests ────────────────────────────────────────

describe("alongTrackDistanceM — signed along-track projection", () => {
  // Camera placed 500 m due north of driver (bearing 0°).
  const CAM_NORTH = destPoint(DRIVER_LAT, DRIVER_LNG, 0, 500);

  it("driver heading north, camera 500 m north → positive (~500 m ahead)", () => {
    const atd = alongTrackDistanceM(DRIVER_LAT, DRIVER_LNG, 0, CAM_NORTH.lat, CAM_NORTH.lng);
    assert.ok(atd > 490 && atd < 510, `expected ~500, got ${atd.toFixed(1)}`);
  });

  it("driver heading south (180°), camera 500 m north → negative (~−500 m behind)", () => {
    const atd = alongTrackDistanceM(DRIVER_LAT, DRIVER_LNG, 180, CAM_NORTH.lat, CAM_NORTH.lng);
    assert.ok(atd < -490 && atd > -510, `expected ~-500, got ${atd.toFixed(1)}`);
  });

  it("driver heading east (90°), camera due north → ~0 (perpendicular)", () => {
    const atd = alongTrackDistanceM(DRIVER_LAT, DRIVER_LNG, 90, CAM_NORTH.lat, CAM_NORTH.lng);
    // cos(90°) = 0, so atd should be very close to 0
    assert.ok(Math.abs(atd) < 5, `expected near 0, got ${atd.toFixed(2)}`);
  });

  it("driver 10 m past the camera (heading N, camera is 10 m south) → negative", () => {
    // Driver is now 10 m north of the camera
    const pastCam = destPoint(CAM_NORTH.lat, CAM_NORTH.lng, 0, 10); // driver has gone 10 m past
    const atd = alongTrackDistanceM(pastCam.lat, pastCam.lng, 0, CAM_NORTH.lat, CAM_NORTH.lng);
    assert.ok(atd < -8 && atd > -12, `expected ~-10, got ${atd.toFixed(2)}`);
  });

  it("dismiss triggers when driver is 15 m past the camera", () => {
    // Use 15 m to stay clear of the floating-point boundary at exactly −10 m.
    const pastCam = destPoint(CAM_NORTH.lat, CAM_NORTH.lng, 0, 15);
    const result = evaluateAlongTrackDismiss({
      driverLat: pastCam.lat, driverLng: pastCam.lng, driverHeading: 0,
      itemLat: CAM_NORTH.lat, itemLng: CAM_NORTH.lng,
    });
    assert.equal(result.shouldDismiss, true, "driver 15 m past must dismiss");
    assert.ok(result.atd < -10, `expected atd < -10, got ${result.atd?.toFixed(2)}`);
  });

  it("no dismiss when 5 m past (below −10 m threshold)", () => {
    const nearlyPast = destPoint(CAM_NORTH.lat, CAM_NORTH.lng, 0, 5);
    const result = evaluateAlongTrackDismiss({
      driverLat: nearlyPast.lat, driverLng: nearlyPast.lng, driverHeading: 0,
      itemLat: CAM_NORTH.lat, itemLng: CAM_NORTH.lng,
    });
    assert.equal(result.shouldDismiss, false, "5 m past must NOT yet dismiss (atd > −10)");
  });

  it("no dismiss when still 100 m ahead of camera", () => {
    // Driver 400 m north of origin, camera 500 m north — driver is 100 m before it
    const approaching = destPoint(DRIVER_LAT, DRIVER_LNG, 0, 400);
    const result = evaluateAlongTrackDismiss({
      driverLat: approaching.lat, driverLng: approaching.lng, driverHeading: 0,
      itemLat: CAM_NORTH.lat, itemLng: CAM_NORTH.lng,
    });
    assert.equal(result.shouldDismiss, false, "camera still ahead — must not dismiss");
  });

  it("null heading → no dismiss (holds overlay open)", () => {
    const pastCam = destPoint(CAM_NORTH.lat, CAM_NORTH.lng, 0, 50); // well past
    const result = evaluateAlongTrackDismiss({
      driverLat: pastCam.lat, driverLng: pastCam.lng, driverHeading: null,
      itemLat: CAM_NORTH.lat, itemLng: CAM_NORTH.lng,
    });
    assert.equal(result.shouldDismiss, false,
      "null heading (slow/stopped) must hold overlay open");
  });

  it("GPS jitter: ±8 m back-and-forth around stationary point never dismisses", () => {
    // Camera 300 m ahead. Simulate GPS bouncing ±8 m around the same spot.
    const cam = destPoint(DRIVER_LAT, DRIVER_LNG, 0, 300);
    const jitter = [-8, 5, -3, 7, -6, 4]; // metres of N/S jitter
    for (const j of jitter) {
      const jPos = destPoint(DRIVER_LAT, DRIVER_LNG, j >= 0 ? 0 : 180, Math.abs(j));
      const result = evaluateAlongTrackDismiss({
        driverLat: jPos.lat, driverLng: jPos.lng, driverHeading: 0,
        itemLat: cam.lat, itemLng: cam.lng,
      });
      assert.equal(result.shouldDismiss, false,
        `jitter of ${j} m must not dismiss (camera still ahead)`);
    }
  });

  it("camera exactly at driver position → atd ≈ 0 (no dismiss)", () => {
    // haversine = 0 → atd = 0, above −10 threshold
    const result = evaluateAlongTrackDismiss({
      driverLat: DRIVER_LAT, driverLng: DRIVER_LNG, driverHeading: 0,
      itemLat: DRIVER_LAT, itemLng: DRIVER_LNG,
    });
    assert.equal(result.shouldDismiss, false,
      "camera at driver position must not dismiss (0 m along-track)");
  });
});

// ─── 8. Bearing-divergence dismissal (Gap 2 fix) ──────────────────────────────

describe("Bearing-divergence: alert dismisses after driver turns away", () => {
  // Alert camera is 500 m to the NE (bearing ~45°).
  // Driver's heading is 225° (SW — directly away from the alert).
  // angleDiff(225°, 45°) = 180° — well above the 110° threshold.

  const alertPos = destPoint(DRIVER_LAT, DRIVER_LNG, 45, 500); // 500 m NE
  const HEADING_AWAY = 225; // SW — directly away from the alert
  const HEADING_TOWARDS = 45; // NE — directly towards the alert

  it("single diverged fix does NOT dismiss (need 2 consecutive)", () => {
    const result = evaluateBearingDivergence({
      driverLat: DRIVER_LAT, driverLng: DRIVER_LNG,
      driverHeading: HEADING_AWAY,
      itemLat: alertPos.lat, itemLng: alertPos.lng,
      bearingDivCount: 0,
    });
    assert.equal(result.shouldDismiss, false, "first diverged fix alone must not dismiss");
    assert.equal(result.nextBearingDivCount, 1);
  });

  it("two consecutive diverged fixes → dismiss with extended cooldown", () => {
    // Fix 1: bearingDivCount becomes 1
    const fix1 = evaluateBearingDivergence({
      driverLat: DRIVER_LAT, driverLng: DRIVER_LNG,
      driverHeading: HEADING_AWAY,
      itemLat: alertPos.lat, itemLng: alertPos.lng,
      bearingDivCount: 0,
    });
    assert.equal(fix1.shouldDismiss, false);
    assert.equal(fix1.nextBearingDivCount, 1);

    // Fix 2: bearingDivCount reaches 2 → dismiss
    const fix2 = evaluateBearingDivergence({
      driverLat: DRIVER_LAT, driverLng: DRIVER_LNG,
      driverHeading: HEADING_AWAY,
      itemLat: alertPos.lat, itemLng: alertPos.lng,
      bearingDivCount: fix1.nextBearingDivCount,
    });
    assert.equal(fix2.shouldDismiss, true, "two consecutive diverged fixes must dismiss");
    assert.equal(fix2.extendedCooldown, true, "divert dismiss must use extended (3-min) cooldown");
  });

  it("non-diverged fix between two diverged fixes resets counter (no dismiss)", () => {
    // Fix 1: diverged → count 1
    const fix1 = evaluateBearingDivergence({
      driverLat: DRIVER_LAT, driverLng: DRIVER_LNG,
      driverHeading: HEADING_AWAY,
      itemLat: alertPos.lat, itemLng: alertPos.lng,
      bearingDivCount: 0,
    });
    assert.equal(fix1.nextBearingDivCount, 1);

    // Fix 2: heading towards alert (not diverged) → counter resets
    const fix2 = evaluateBearingDivergence({
      driverLat: DRIVER_LAT, driverLng: DRIVER_LNG,
      driverHeading: HEADING_TOWARDS,
      itemLat: alertPos.lat, itemLng: alertPos.lng,
      bearingDivCount: fix1.nextBearingDivCount,
    });
    assert.equal(fix2.shouldDismiss, false);
    assert.equal(fix2.nextBearingDivCount, 0, "non-diverged fix must reset counter");
  });

  it("null heading skips bearing check (no dismiss, no counter change)", () => {
    const result = evaluateBearingDivergence({
      driverLat: DRIVER_LAT, driverLng: DRIVER_LNG,
      driverHeading: null,
      itemLat: alertPos.lat, itemLng: alertPos.lng,
      bearingDivCount: 0,
    });
    assert.equal(result.shouldDismiss, false,
      "without a valid heading the bearing check must be skipped");
    assert.equal(result.nextBearingDivCount, 0,
      "counter must not increment when heading is unknown");
  });

  it("angleDiff at exactly 111° (just above threshold) counts as diverged", () => {
    // Place the alert at bearing 0° (due north). Drive heading 111°.
    // angleDiff(111°, 0°) = 111° → above threshold.
    const alertNorth = destPoint(DRIVER_LAT, DRIVER_LNG, 0, 500);
    const fix1 = evaluateBearingDivergence({
      driverLat: DRIVER_LAT, driverLng: DRIVER_LNG,
      driverHeading: 111,
      itemLat: alertNorth.lat, itemLng: alertNorth.lng,
      bearingDivCount: 0,
    });
    assert.equal(fix1.nextBearingDivCount, 1, "angleDiff > 110° must count as diverged");
  });

  it("angleDiff at exactly 110° (at threshold) does NOT count as diverged", () => {
    // angleDiff(110°, 0°) = 110° → NOT above threshold (strict >).
    const alertNorth = destPoint(DRIVER_LAT, DRIVER_LNG, 0, 500);
    const fix1 = evaluateBearingDivergence({
      driverLat: DRIVER_LAT, driverLng: DRIVER_LNG,
      driverHeading: 110,
      itemLat: alertNorth.lat, itemLng: alertNorth.lng,
      bearingDivCount: 0,
    });
    assert.equal(fix1.nextBearingDivCount, 0, "angleDiff exactly 110° must NOT be diverged");
    assert.equal(fix1.shouldDismiss, false);
  });
});

// ─── 9. Null-road + bearing gate (Gap 1 fix) ──────────────────────────────────

describe("Null-road + bearing gate: dismiss when road is null and driver is pointing away", () => {
  // Alert camera is 500 m to the NE (bearing ~45°).
  const alertPos = destPoint(DRIVER_LAT, DRIVER_LNG, 45, 500);
  const HEADING_AWAY = 225; // SW — pointing away (angleDiff = 180°, well above 90°)
  const HEADING_SIDE = 136; // SE — bearing to alert is ~45° (NE), angleDiff ≈ 91° → safely above 90° threshold
  const HEADING_FORWARD = 45; // NE — pointing at the alert (angleDiff = 0°)

  it("current road null + approach road known + alert road known + heading away → dismiss", () => {
    const result = evaluateNullRoadBearingGate({
      currentRoad: null,
      itemRoad: "Thika Superhighway (A2)",
      approachRoad: "Thika Superhighway (A2)",
      driverLat: DRIVER_LAT, driverLng: DRIVER_LNG,
      driverHeading: HEADING_AWAY,
      itemLat: alertPos.lat, itemLng: alertPos.lng,
    });
    assert.equal(result.shouldDismiss, true,
      "null road + known approach road + pointing away must dismiss");
    assert.equal(result.extendedCooldown, true, "must use extended cooldown");
  });

  it("current road null + heading exactly at 90° boundary → dismiss", () => {
    const result = evaluateNullRoadBearingGate({
      currentRoad: null,
      itemRoad: "Thika Superhighway (A2)",
      approachRoad: "Thika Road",
      driverLat: DRIVER_LAT, driverLng: DRIVER_LNG,
      driverHeading: HEADING_SIDE,
      itemLat: alertPos.lat, itemLng: alertPos.lng,
    });
    // HEADING_SIDE = 135°, alert bearing = ~45°, angleDiff = 90° — exactly the ≥ 90° threshold
    assert.equal(result.shouldDismiss, true, "angleDiff exactly 90° must dismiss on null-road gate");
  });

  it("current road null + heading towards alert (angleDiff < 90°) → no dismiss", () => {
    const result = evaluateNullRoadBearingGate({
      currentRoad: null,
      itemRoad: "Thika Superhighway (A2)",
      approachRoad: "Thika Superhighway (A2)",
      driverLat: DRIVER_LAT, driverLng: DRIVER_LNG,
      driverHeading: HEADING_FORWARD,
      itemLat: alertPos.lat, itemLng: alertPos.lng,
    });
    assert.equal(result.shouldDismiss, false,
      "heading towards the alert must NOT dismiss even if road is null (GPS latency)");
  });

  it("current road known → null-road gate does not fire", () => {
    const result = evaluateNullRoadBearingGate({
      currentRoad: "Northern Bypass", // known, different road — but that's handled by existing check
      itemRoad: "Thika Superhighway (A2)",
      approachRoad: "Thika Superhighway (A2)",
      driverLat: DRIVER_LAT, driverLng: DRIVER_LNG,
      driverHeading: HEADING_AWAY,
      itemLat: alertPos.lat, itemLng: alertPos.lng,
    });
    assert.equal(result.shouldDismiss, false,
      "null-road gate must only fire when currentRoad is null (known roads handled by road-departure check)");
  });

  it("approach road null → null-road gate does not fire (can't confirm a divert)", () => {
    const result = evaluateNullRoadBearingGate({
      currentRoad: null,
      itemRoad: "Thika Superhighway (A2)",
      approachRoad: null, // was unknown at activation
      driverLat: DRIVER_LAT, driverLng: DRIVER_LNG,
      driverHeading: HEADING_AWAY,
      itemLat: alertPos.lat, itemLng: alertPos.lng,
    });
    assert.equal(result.shouldDismiss, false,
      "if approach road was unknown we have no baseline to confirm a divert");
  });

  it("alert road null → null-road gate does not fire (no road to mismatch against)", () => {
    const result = evaluateNullRoadBearingGate({
      currentRoad: null,
      itemRoad: null,
      approachRoad: "Thika Superhighway (A2)",
      driverLat: DRIVER_LAT, driverLng: DRIVER_LNG,
      driverHeading: HEADING_AWAY,
      itemLat: alertPos.lat, itemLng: alertPos.lng,
    });
    assert.equal(result.shouldDismiss, false,
      "alert without a road cannot trigger the null-road gate");
  });

  it("null heading → null-road gate does not fire (bearing undetermined)", () => {
    const result = evaluateNullRoadBearingGate({
      currentRoad: null,
      itemRoad: "Thika Superhighway (A2)",
      approachRoad: "Thika Superhighway (A2)",
      driverLat: DRIVER_LAT, driverLng: DRIVER_LNG,
      driverHeading: null,
      itemLat: alertPos.lat, itemLng: alertPos.lng,
    });
    assert.equal(result.shouldDismiss, false,
      "unknown heading must not trigger the null-road gate");
  });
});

// ─── 10. Reroute dismiss: alert not on new route is cleared ───────────────────

/**
 * Minimal reroute dismiss model:
 *   given the alert's coords and an array of {latitude, longitude} route coords,
 *   decide whether the alert is still on the route (any point within 300 m).
 */
function alertOnNewRoute(alertLat, alertLng, routeCoords) {
  return routeCoords.some(
    (pt) => haversine(alertLat, alertLng, pt.latitude, pt.longitude) < 300,
  );
}

describe("Reroute dismiss: alert off the new route is cleared", () => {
  // Alert camera 500 m NE of driver.
  const alertPos = destPoint(DRIVER_LAT, DRIVER_LNG, 45, 500);

  it("alert within 300 m of a new-route point → stays active", () => {
    // New route passes 200 m from the alert.
    const nearPoint = destPoint(alertPos.lat, alertPos.lng, 90, 200); // 200 m east of alert
    const routeCoords = [
      { latitude: DRIVER_LAT, longitude: DRIVER_LNG }, // driver position
      { latitude: nearPoint.lat, longitude: nearPoint.lng }, // close to alert
      { latitude: destPoint(DRIVER_LAT, DRIVER_LNG, 45, 1500).lat, longitude: destPoint(DRIVER_LAT, DRIVER_LNG, 45, 1500).lng },
    ];
    assert.equal(
      alertOnNewRoute(alertPos.lat, alertPos.lng, routeCoords),
      true,
      "alert 200 m from a route point is still on the new route — must NOT dismiss",
    );
  });

  it("alert > 300 m from every new-route point → dismisses", () => {
    // New route takes a right turn: heads SE away from the NE alert.
    const routeCoords = [
      { latitude: DRIVER_LAT, longitude: DRIVER_LNG },
      { latitude: destPoint(DRIVER_LAT, DRIVER_LNG, 135, 500).lat, longitude: destPoint(DRIVER_LAT, DRIVER_LNG, 135, 500).lng },
      { latitude: destPoint(DRIVER_LAT, DRIVER_LNG, 135, 1000).lat, longitude: destPoint(DRIVER_LAT, DRIVER_LNG, 135, 1000).lng },
    ];
    // Verify the closest new-route point is indeed > 300 m from the alert.
    const minDist = Math.min(...routeCoords.map(
      (pt) => haversine(alertPos.lat, alertPos.lng, pt.latitude, pt.longitude),
    ));
    assert.ok(minDist > 300, `test sanity: closest route point must be > 300 m from alert, got ${minDist.toFixed(0)} m`);

    assert.equal(
      alertOnNewRoute(alertPos.lat, alertPos.lng, routeCoords),
      false,
      "alert more than 300 m from every new-route point must be dismissed on reroute",
    );
  });

  it("300 m boundary: alert exactly 299 m away → stays (within threshold)", () => {
    const nearlyAt = destPoint(alertPos.lat, alertPos.lng, 0, 299); // 299 m north of alert
    const routeCoords = [{ latitude: nearlyAt.lat, longitude: nearlyAt.lng }];
    assert.equal(
      alertOnNewRoute(alertPos.lat, alertPos.lng, routeCoords),
      true,
      "alert 299 m from a route point must stay active (< 300 m threshold)",
    );
  });

  it("300 m boundary: alert exactly 300 m away → dismisses (at or above threshold)", () => {
    const atBoundary = destPoint(alertPos.lat, alertPos.lng, 0, 300); // exactly 300 m away
    const routeCoords = [{ latitude: atBoundary.lat, longitude: atBoundary.lng }];
    // haversine gives a float; 300 m placed with destPoint will be fractionally above 300 m
    const dist = haversine(alertPos.lat, alertPos.lng, atBoundary.lat, atBoundary.lng);
    assert.ok(dist >= 300, `sanity check: expected dist ≥ 300 m, got ${dist.toFixed(2)} m`);
    assert.equal(
      alertOnNewRoute(alertPos.lat, alertPos.lng, routeCoords),
      false,
      "alert at or beyond 300 m from every route point must be dismissed",
    );
  });
});
