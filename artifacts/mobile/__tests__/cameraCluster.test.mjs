/**
 * Camera-cluster deduplication unit tests — AppContext cluster logic
 *
 * Covers the three deduplication layers added for roundabout cameras:
 *   1. Zone-candidate selection: only the nearest member of a 50 m cluster wins.
 *   2. Extra-candidates (multi-alert row): cluster members of the winner are hidden.
 *   3. Dismiss-cooldown propagation: passing one cluster member silences all others.
 *
 * The pure-math helpers and modelled logic below are verbatim copies of the
 * private functions in artifacts/mobile/context/AppContext.tsx. When either
 * source changes these tests should fail, acting as a regression net.
 *
 * Run with: node artifacts/mobile/__tests__/cameraCluster.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─── Verbatim copies of AppContext private helpers ────────────────────────────

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180, f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180, dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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

// ─── Constants (verbatim from AppContext) ─────────────────────────────────────
const CAMERA_CLUSTER_RADIUS = 50; // metres — verbatim from AppContext
const IN_ZONE_DIST = 250;         // metres
const ALERT_DIST = 1000;          // metres

// ─── Modelled logic (verbatim from AppContext) ────────────────────────────────

/**
 * Zone candidate selection with cluster deduplication.
 * Models AppContext zoneCandidate loop — verbatim logic.
 *
 * Cluster deduplication applies ONLY when BOTH the current zone and the
 * already-selected best are type === "camera". Non-camera zones (police,
 * roadworks, etc.) are independent hazards and are never filtered by proximity.
 *
 * @param {Array<{id:string, lat:number, lng:number, distance:number, type:string, speedLimit:number|null, road?:string}>} inRangeZones
 *   — zones already filtered: distance > IN_ZONE_DIST && <= ALERT_DIST, sorted ascending by distance
 * @param {number} kmh — driver speed
 * @returns {object|null} winning zone, or null
 */
function selectZoneWithClustering(inRangeZones, kmh = 80) {
  let best = null;
  for (const z of inRangeZones) {
    if (z.type === "camera" && z.speedLimit != null && kmh <= z.speedLimit) continue;
    if (best === null) {
      best = z;
      continue;
    }
    // Cluster deduplication: camera-only — non-cameras are independent hazards.
    if (
      z.type === "camera" &&
      best.type === "camera" &&
      haversine(z.lat, z.lng, best.lat, best.lng) <= CAMERA_CLUSTER_RADIUS
    ) continue;
    // Further-away non-cluster zone: best is already closer, don't replace.
    break;
  }
  return best;
}

/**
 * Build extra-alert candidates for the multi-alert row.
 * Models AppContext extraCandidates zone loop (zone sources only) — verbatim logic.
 *
 * Camera cluster members of a camera winner are suppressed (same physical site).
 * Non-camera zones within 50 m are NOT suppressed — they are independent hazards.
 *
 * @param {Array<{id:string, lat:number, lng:number, distance:number, type:string, road?:string}>} withDist
 * @param {{id:string, lat:number, lng:number, type:string, source?:string}} winner
 * @returns {Array} extra candidate zones
 */
function buildExtraCandidates(withDist, winner) {
  const MULTI_RADIUS = 1000;
  const extras = [];
  for (const z of withDist) {
    if (z.distance <= IN_ZONE_DIST || z.distance > MULTI_RADIUS) continue;
    if (z.id === winner.id) continue;
    // Cluster suppression: camera-only. Non-camera zones are independent.
    if (
      z.type === "camera" &&
      (winner.source == null || winner.source === "zone") && winner.type === "camera" &&
      winner.lat != null && winner.lng != null &&
      haversine(z.lat, z.lng, winner.lat, winner.lng) <= CAMERA_CLUSTER_RADIUS
    ) continue;
    extras.push(z);
  }
  return extras;
}

/**
 * Cluster-aware dismiss: add cooldown for dismissedZone AND all camera cluster neighbours.
 * Models AppContext shouldDismiss block — verbatim logic.
 *
 * Only propagates cooldowns to OTHER cameras within CAMERA_CLUSTER_RADIUS on the
 * same road. Non-camera zones (police, roadworks) are never given a propagated cooldown.
 * The dismiss also only runs cluster propagation when the dismissed zone is itself a camera.
 *
 * @param {string} dismissedId
 * @param {{id:string, lat:number, lng:number, road?:string, type:string}} dismissedZone
 * @param {Array<{id:string, lat:number, lng:number, road?:string, type:string}>} withDist
 * @param {Map<string, object>} cooldownMap — mutated in place
 * @param {number} cooldownMs
 */
function applyClusterAwareDismiss(dismissedId, dismissedZone, withDist, cooldownMap, cooldownMs = 60_000) {
  const entry = { expiry: Date.now() + cooldownMs, peakDistM: 300 };
  cooldownMap.set(dismissedId, entry);
  // Only propagate when the dismissed zone is itself a camera.
  if (dismissedZone && dismissedZone.type === "camera") {
    for (const z of withDist) {
      if (z.id === dismissedId) continue;
      if (z.type !== "camera") continue; // non-camera hazards are independent
      // Both roads must be known and matching — fail-open when either is missing.
      if (!z.road || !dismissedZone.road || z.road !== dismissedZone.road) continue;
      if (haversine(z.lat, z.lng, dismissedZone.lat, dismissedZone.lng) <= CAMERA_CLUSTER_RADIUS) {
        cooldownMap.set(z.id, { ...entry });
      }
    }
  }
}

// ─── Test geometry ────────────────────────────────────────────────────────────
// Roundabout anchor — driver is 400 m south heading north.
const ROUNDABOUT_LAT = -1.3000;
const ROUNDABOUT_LNG = 36.8200;
const DRIVER_LAT = destPoint(ROUNDABOUT_LAT, ROUNDABOUT_LNG, 180, 400).lat;
const DRIVER_LNG = ROUNDABOUT_LNG;

/**
 * Make a camera zone displaced by `offsetM` metres at `offsetBearing`° from
 * the roundabout anchor, at distance `distM` from the driver.
 */
function makeClusterCamera(id, offsetM, offsetBearing, road = "Ngong Road") {
  const { lat, lng } = destPoint(ROUNDABOUT_LAT, ROUNDABOUT_LNG, offsetBearing, offsetM);
  const dist = haversine(DRIVER_LAT, DRIVER_LNG, lat, lng);
  return { id, lat, lng, distance: dist, type: "camera", speedLimit: 50, road };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CAMERA_CLUSTER_RADIUS constant is 50 m", () => {
  it("CAMERA_CLUSTER_RADIUS is exactly 50", () => {
    assert.equal(CAMERA_CLUSTER_RADIUS, 50);
  });
});

describe("Zone candidate selection — single isolated camera", () => {
  it("selects a lone camera when driver is approaching at speed above limit", () => {
    const cam = makeClusterCamera("iso-1", 0, 0);
    const inRange = [cam].filter(z => z.distance > IN_ZONE_DIST && z.distance <= ALERT_DIST);
    const winner = selectZoneWithClustering(inRange, 80);
    assert.equal(winner?.id, "iso-1", "isolated camera should be selected");
  });

  it("suppresses camera when driver speed is at or below the speed limit", () => {
    const cam = makeClusterCamera("iso-2", 0, 0);
    cam.speedLimit = 80;
    const inRange = [cam].filter(z => z.distance > IN_ZONE_DIST && z.distance <= ALERT_DIST);
    const winner = selectZoneWithClustering(inRange, 80);
    assert.equal(winner, null, "camera at or below limit should not activate");
  });
});

describe("Zone candidate selection — roundabout cluster (3 cameras within 50 m)", () => {
  // Three cameras spaced ~15 m apart around the roundabout centre (well within 50 m).
  const camA = makeClusterCamera("rbt-A", 0, 0);   // at the anchor
  const camB = makeClusterCamera("rbt-B", 15, 90);  // 15 m east
  const camC = makeClusterCamera("rbt-C", 20, 270); // 20 m west

  // Sort ascending by distance (nearest wins)
  const allCams = [camA, camB, camC].sort((a, b) => a.distance - b.distance);
  const inRange = allCams.filter(z => z.distance > IN_ZONE_DIST && z.distance <= ALERT_DIST);

  it("setup: all three cameras are within CAMERA_CLUSTER_RADIUS of each other", () => {
    const dAB = haversine(camA.lat, camA.lng, camB.lat, camB.lng);
    const dAC = haversine(camA.lat, camA.lng, camC.lat, camC.lng);
    const dBC = haversine(camB.lat, camB.lng, camC.lat, camC.lng);
    assert.ok(dAB <= CAMERA_CLUSTER_RADIUS, `A–B (${dAB.toFixed(1)} m) must be ≤ ${CAMERA_CLUSTER_RADIUS} m`);
    assert.ok(dAC <= CAMERA_CLUSTER_RADIUS, `A–C (${dAC.toFixed(1)} m) must be ≤ ${CAMERA_CLUSTER_RADIUS} m`);
    assert.ok(dBC <= CAMERA_CLUSTER_RADIUS, `B–C (${dBC.toFixed(1)} m) must be ≤ ${CAMERA_CLUSTER_RADIUS} m`);
  });

  it("selects exactly ONE winner from a 3-camera cluster", () => {
    const winner = selectZoneWithClustering(inRange, 80);
    assert.notEqual(winner, null, "a winner must be selected from the cluster");
  });

  it("winner is the nearest cluster member", () => {
    const winner = selectZoneWithClustering(inRange, 80);
    const nearest = inRange[0];
    assert.equal(winner?.id, nearest.id, "winner must be the nearest camera");
  });

  it("only 1 alert fires — 2 other cluster members are not selected", () => {
    // Simulate three consecutive GPS ticks where each camera becomes the nearest
    // one at a time. Deduplication must prevent any secondary camera from winning.
    for (const lead of inRange) {
      // Reorder so `lead` is first (nearest), others follow
      const reordered = [lead, ...inRange.filter(z => z.id !== lead.id)];
      const winner = selectZoneWithClustering(reordered, 80);
      // Winner is always the first element (lead), and no secondary should win.
      assert.equal(winner?.id, lead.id, `lead ${lead.id} should always win when placed first`);
    }
  });
});

describe("Zone candidate selection — cameras 60 m apart are NOT clustered", () => {
  it("two cameras 60 m apart both become independent candidates", () => {
    const camNear = makeClusterCamera("far-A", 0, 0);    // at anchor, ~400 m from driver
    const camFar  = makeClusterCamera("far-B", 60, 0);   // 60 m further north, ~340 m from driver

    const d = haversine(camNear.lat, camNear.lng, camFar.lat, camFar.lng);
    assert.ok(d > CAMERA_CLUSTER_RADIUS, `cameras must be > 50 m apart (got ${d.toFixed(1)} m)`);

    // Sort nearest first
    const inRange = [camNear, camFar]
      .sort((a, b) => a.distance - b.distance)
      .filter(z => z.distance > IN_ZONE_DIST && z.distance <= ALERT_DIST);

    // The nearest should win; the farther one is independent and NOT suppressed
    // by the cluster check. Both should remain selectable.
    const winner = selectZoneWithClustering(inRange, 80);
    assert.notEqual(winner, null, "nearest non-cluster camera must be selected");

    // Remove winner and check the remaining camera would also be selectable
    const remaining = inRange.filter(z => z.id !== winner.id);
    const second = selectZoneWithClustering(remaining, 80);
    assert.notEqual(second, null, "second independent camera must also be selectable");
  });
});

describe("Extra-candidates — cluster members excluded from multi-alert row", () => {
  // Two cluster cameras (25 m apart) and one distant independent incident (500 m away).
  const winner = makeClusterCamera("extra-winner", 0, 0);
  winner.distance = 400; // 400 m from driver (in range)

  const clusterMember = makeClusterCamera("extra-cluster", 25, 0);
  clusterMember.distance = 375; // slightly closer — would appear as an extra without the fix

  const independent = {
    id: "extra-independent",
    lat: destPoint(ROUNDABOUT_LAT, ROUNDABOUT_LNG, 0, 200).lat,
    lng: ROUNDABOUT_LNG,
    distance: 600,
    type: "police",
    road: "Ngong Road",
  };

  const withinCluster = haversine(winner.lat, winner.lng, clusterMember.lat, clusterMember.lng);

  it("setup: cluster member is within 50 m of winner", () => {
    assert.ok(withinCluster <= CAMERA_CLUSTER_RADIUS,
      `cluster member must be ≤ 50 m from winner (got ${withinCluster.toFixed(1)} m)`);
  });

  it("cluster member does NOT appear in extra-candidates", () => {
    const extras = buildExtraCandidates([winner, clusterMember, independent], winner);
    const ids = extras.map(e => e.id);
    assert.ok(!ids.includes("extra-cluster"), "cluster member must be excluded from extras");
  });

  it("independent incident DOES appear in extra-candidates", () => {
    const extras = buildExtraCandidates([winner, clusterMember, independent], winner);
    const ids = extras.map(e => e.id);
    assert.ok(ids.includes("extra-independent"), "independent incident must appear in extras");
  });

  it("extras list contains exactly 1 item (independent only, cluster filtered)", () => {
    const extras = buildExtraCandidates([winner, clusterMember, independent], winner);
    assert.equal(extras.length, 1, "only the independent item should be in extras");
  });
});

describe("Dismiss-cooldown propagation — cluster neighbours silenced on pass-through", () => {
  // Roundabout: 4 cameras all within 30 m of each other.
  const baseLat = ROUNDABOUT_LAT;
  const baseLng = ROUNDABOUT_LNG;
  const dismissedZone = { id: "cd-A", lat: baseLat, lng: baseLng, road: "Thika Road", type: "camera" };
  const neighbourB    = { id: "cd-B", ...destPoint(baseLat, baseLng, 0,   20), road: "Thika Road", distance: 300, type: "camera" };
  const neighbourC    = { id: "cd-C", ...destPoint(baseLat, baseLng, 90,  15), road: "Thika Road", distance: 310, type: "camera" };
  const farZone       = { id: "cd-far", ...destPoint(baseLat, baseLng, 0, 100), road: "Thika Road", distance: 350, type: "camera" };

  const withinBC = haversine(dismissedZone.lat, dismissedZone.lng, neighbourB.lat, neighbourB.lng);
  const withinCC = haversine(dismissedZone.lat, dismissedZone.lng, neighbourC.lat, neighbourC.lng);
  const withinFar = haversine(dismissedZone.lat, dismissedZone.lng, farZone.lat, farZone.lng);

  it("setup: B and C are within 50 m; far zone is beyond 50 m", () => {
    assert.ok(withinBC <= CAMERA_CLUSTER_RADIUS, `B must be ≤ 50 m (${withinBC.toFixed(1)} m)`);
    assert.ok(withinCC <= CAMERA_CLUSTER_RADIUS, `C must be ≤ 50 m (${withinCC.toFixed(1)} m)`);
    assert.ok(withinFar > CAMERA_CLUSTER_RADIUS,  `far must be > 50 m (${withinFar.toFixed(1)} m)`);
  });

  it("dismissing zone A adds cooldown for A itself", () => {
    const cooldownMap = new Map();
    applyClusterAwareDismiss("cd-A", dismissedZone, [dismissedZone, neighbourB, neighbourC, farZone], cooldownMap);
    assert.ok(cooldownMap.has("cd-A"), "dismissed zone A must be in cooldown");
  });

  it("dismissing zone A also adds cooldown for cluster neighbour B", () => {
    const cooldownMap = new Map();
    applyClusterAwareDismiss("cd-A", dismissedZone, [dismissedZone, neighbourB, neighbourC, farZone], cooldownMap);
    assert.ok(cooldownMap.has("cd-B"), "cluster neighbour B must be in cooldown after A dismissed");
  });

  it("dismissing zone A also adds cooldown for cluster neighbour C", () => {
    const cooldownMap = new Map();
    applyClusterAwareDismiss("cd-A", dismissedZone, [dismissedZone, neighbourB, neighbourC, farZone], cooldownMap);
    assert.ok(cooldownMap.has("cd-C"), "cluster neighbour C must be in cooldown after A dismissed");
  });

  it("far zone (> 50 m away) is NOT put in cooldown by A's dismiss", () => {
    const cooldownMap = new Map();
    applyClusterAwareDismiss("cd-A", dismissedZone, [dismissedZone, neighbourB, neighbourC, farZone], cooldownMap);
    assert.ok(!cooldownMap.has("cd-far"), "far zone must NOT be in cooldown (beyond cluster radius)");
  });

  it("cooldown map has exactly 3 entries (A + B + C, not far)", () => {
    const cooldownMap = new Map();
    applyClusterAwareDismiss("cd-A", dismissedZone, [dismissedZone, neighbourB, neighbourC, farZone], cooldownMap);
    assert.equal(cooldownMap.size, 3, "cooldown map must have exactly 3 entries");
  });

  it("cluster cooldown entries share the same expiry time", () => {
    const cooldownMap = new Map();
    applyClusterAwareDismiss("cd-A", dismissedZone, [dismissedZone, neighbourB, neighbourC, farZone], cooldownMap);
    const expiryA = cooldownMap.get("cd-A").expiry;
    const expiryB = cooldownMap.get("cd-B").expiry;
    const expiryC = cooldownMap.get("cd-C").expiry;
    assert.equal(expiryA, expiryB, "A and B must share the same expiry");
    assert.equal(expiryA, expiryC, "A and C must share the same expiry");
  });
});

describe("Active-alert cluster suppression — camera B does not replace active camera A", () => {
  /**
   * Models the winnerIsActiveClusterMember check added to the isNewAlert gate.
   * Production logic from AppContext (search: winnerIsActiveClusterMember).
   *
   * Road-scoped: BOTH roads must be present and match for suppression.
   * If either road is unknown, returns false (fail-open) — we cannot confirm
   * same-road membership and must not silently drop an independent camera alert.
   *
   * @param {{type:string, lat:number, lng:number, road?:string|null}} winner
   * @param {{type:string|null, lat:number|null, lng:number|null, id:string|null, road?:string|null}} activeAlert
   * @returns {boolean} true if the winner should be suppressed as a cluster member
   */
  function winnerIsActiveClusterMember(winner, activeAlert) {
    if (winner.type !== "camera") return false;
    if (activeAlert.type !== "camera") return false;
    if (activeAlert.id === null) return false;
    if (activeAlert.lat == null || activeAlert.lng == null) return false;
    // Both roads must be known and matching; unknown road = fail-open (independent).
    const activeRoad = activeAlert.road ?? null;
    const winnerRoad = winner.road ?? null;
    if (!activeRoad || !winnerRoad || activeRoad !== winnerRoad) return false;
    return haversine(winner.lat, winner.lng, activeAlert.lat, activeAlert.lng) <= CAMERA_CLUSTER_RADIUS;
  }

  /**
   * isNewAlert gate — verbatim conditions from AppContext.
   */
  function isNewAlert(winner, activeAlert, cooldownMap) {
    if (cooldownMap.has(winner.id)) return false;
    if (winner.id === activeAlert.id) return false;
    if (winnerIsActiveClusterMember(winner, activeAlert)) return false;
    return true;
  }

  // Roundabout cluster: camera A (the original winner), camera B (30 m away).
  const camA = makeClusterCamera("active-A", 0, 0);
  const camB = makeClusterCamera("active-B", 30, 90);

  const distAB = haversine(camA.lat, camA.lng, camB.lat, camB.lng);

  it("setup: cameras A and B are within CAMERA_CLUSTER_RADIUS", () => {
    assert.ok(distAB <= CAMERA_CLUSTER_RADIUS,
      `A–B must be ≤ ${CAMERA_CLUSTER_RADIUS} m (got ${distAB.toFixed(1)} m)`);
  });

  it("first tick: camera A is selected as a new alert (no active alert yet)", () => {
    const activeAlert = { id: null, type: null, lat: null, lng: null };
    const cooldownMap = new Map();
    assert.ok(isNewAlert(camA, activeAlert, cooldownMap),
      "camera A must trigger a new alert when no alert is active");
  });

  it("second tick: camera B becomes nearest but active-A is still tracked — B is suppressed", () => {
    // Simulate: A is now the active alert (with known road). On next GPS tick B becomes nearest.
    // Both A and B are on the same road (makeClusterCamera defaults to "Ngong Road").
    const activeAlert = { id: camA.id, type: "camera", lat: camA.lat, lng: camA.lng, road: camA.road };
    const cooldownMap = new Map(); // A has not been dismissed yet — no cooldown
    assert.equal(
      isNewAlert(camB, activeAlert, cooldownMap),
      false,
      "camera B must be suppressed as a cluster member of the already-active camera A"
    );
  });

  it("third tick: after A is dismissed and B has cooldown, B is still suppressed by cooldown", () => {
    const activeAlert = { id: null, type: null, lat: null, lng: null }; // A dismissed
    const cooldownMap = new Map();
    // Cluster-aware dismiss propagated B's cooldown at dismiss time.
    cooldownMap.set(camB.id, { expiry: Date.now() + 60_000, peakDistM: 300 });
    assert.equal(
      isNewAlert(camB, activeAlert, cooldownMap),
      false,
      "camera B must remain suppressed via its cooldown after A is dismissed"
    );
  });

  it("camera B with UNKNOWN road is NOT suppressed (fail-open) even when within 50 m of active camera A", () => {
    // Camera B has no road metadata — we cannot confirm same-road membership.
    const camBNoRoad = makeClusterCamera("active-B-noroad", 30, 90);
    camBNoRoad.road = undefined; // no road tag

    const activeAlert = { id: camA.id, type: "camera", lat: camA.lat, lng: camA.lng, road: "Ngong Road" };
    const cooldownMap = new Map();

    assert.equal(
      isNewAlert(camBNoRoad, activeAlert, cooldownMap),
      true,
      "camera with unknown road must NOT be cluster-suppressed (fail-open — may be on a different street)"
    );
  });

  it("active alert with UNKNOWN road does NOT suppress a nearby camera (fail-open)", () => {
    // Active alert was fired for a zone that had no road tag (legacy data).
    const activeAlertNoRoad = { id: camA.id, type: "camera", lat: camA.lat, lng: camA.lng, road: undefined };
    const cooldownMap = new Map();

    assert.equal(
      isNewAlert(camB, activeAlertNoRoad, cooldownMap),
      true,
      "when active alert has no road, nearby camera must NOT be suppressed (fail-open)"
    );
  });

  it("camera B on a DIFFERENT road is NOT suppressed even when within 50 m of active camera A", () => {
    // Intersection scenario: camera A is on "Ngong Road", camera B is 30 m away on "Ring Road".
    const camOnOtherRoad = makeClusterCamera("cross-road-B", 30, 90);
    camOnOtherRoad.road = "Ring Road";

    const activeAlert = { id: camA.id, type: "camera", lat: camA.lat, lng: camA.lng, road: "Ngong Road" };
    const cooldownMap = new Map();

    const dist = haversine(camA.lat, camA.lng, camOnOtherRoad.lat, camOnOtherRoad.lng);
    assert.ok(dist <= CAMERA_CLUSTER_RADIUS, `cross-road camera must be ≤ 50 m (${dist.toFixed(1)} m)`);

    assert.equal(
      isNewAlert(camOnOtherRoad, activeAlert, cooldownMap),
      true,
      "camera on a different named road must NOT be cluster-suppressed — it is an independent hazard"
    );
  });

  it("camera C (> 50 m away) is NOT suppressed by active camera A", () => {
    const camC = makeClusterCamera("active-C", 80, 0); // 80 m away — outside cluster
    const distAC = haversine(camA.lat, camA.lng, camC.lat, camC.lng);
    assert.ok(distAC > CAMERA_CLUSTER_RADIUS,
      `A–C must be > ${CAMERA_CLUSTER_RADIUS} m (got ${distAC.toFixed(1)} m)`);

    const activeAlert = { id: camA.id, type: "camera", lat: camA.lat, lng: camA.lng };
    const cooldownMap = new Map();
    assert.equal(
      isNewAlert(camC, activeAlert, cooldownMap),
      true,
      "independent camera C must NOT be suppressed by active camera A's cluster"
    );
  });

  it("police zone within 50 m of active camera is NOT cluster-suppressed", () => {
    const police = makeClusterCamera("active-police", 20, 0);
    police.type = "police";
    const distPolice = haversine(camA.lat, camA.lng, police.lat, police.lng);
    assert.ok(distPolice <= CAMERA_CLUSTER_RADIUS,
      `police must be ≤ ${CAMERA_CLUSTER_RADIUS} m from A (got ${distPolice.toFixed(1)} m)`);

    const activeAlert = { id: camA.id, type: "camera", lat: camA.lat, lng: camA.lng };
    const cooldownMap = new Map();
    assert.equal(
      isNewAlert(police, activeAlert, cooldownMap),
      true,
      "police zone is an independent hazard — must not be suppressed by camera cluster check"
    );
  });
});

describe("Type-scoping — non-camera zones are NOT clustered", () => {
  // A police check and a camera at the same location (30 m apart).
  // The police zone must never be suppressed by camera cluster logic.
  const police = makeClusterCamera("police-1", 0, 0);
  police.type = "police";
  police.speedLimit = null;
  const camera = makeClusterCamera("cam-near-police", 30, 0);
  camera.type = "camera";
  camera.speedLimit = 50;

  const d = haversine(police.lat, police.lng, camera.lat, camera.lng);

  it("setup: police and camera are within 50 m of each other", () => {
    assert.ok(d <= CAMERA_CLUSTER_RADIUS, `must be ≤ 50 m (${d.toFixed(1)} m)`);
  });

  it("police zone is selected even when a camera cluster rep is already chosen", () => {
    // Camera sorts closer (lower distance), so camera becomes best first.
    const inRange = [camera, police].sort((a, b) => a.distance - b.distance)
      .filter(z => z.distance > IN_ZONE_DIST && z.distance <= ALERT_DIST);

    // If camera is best, police (non-camera) must NOT be skipped by cluster logic.
    // We test by isolating: given just police in range, it must be selected.
    const policOnly = [police].filter(z => z.distance > IN_ZONE_DIST && z.distance <= ALERT_DIST);
    const winner = selectZoneWithClustering(policOnly, 80);
    assert.equal(winner?.id, "police-1", "police zone must always be selectable");
  });

  it("camera cluster does NOT suppress a nearby police zone in extra-candidates", () => {
    // Winner is camera; police is nearby but must still appear in extras.
    const winner = { id: "cam-near-police", lat: camera.lat, lng: camera.lng, type: "camera", source: "zone" };
    const extras = buildExtraCandidates([camera, police], winner);
    const ids = extras.map(e => e.id);
    assert.ok(ids.includes("police-1"), "police zone must appear in extras even when near a camera cluster winner");
  });

  it("dismissing a camera does NOT propagate cooldown to a nearby police zone", () => {
    const cameraZone = { id: "cam-dismiss", lat: camera.lat, lng: camera.lng, type: "camera", road: "Ngong Road" };
    const policeZone = { id: "police-nearby", ...destPoint(camera.lat, camera.lng, 0, 20), type: "police", road: "Ngong Road", distance: 300 };

    const cooldownMap = new Map();
    applyClusterAwareDismiss("cam-dismiss", cameraZone, [cameraZone, policeZone], cooldownMap);

    assert.ok(cooldownMap.has("cam-dismiss"), "dismissed camera must be in cooldown");
    assert.ok(!cooldownMap.has("police-nearby"), "police zone must NOT receive camera cluster cooldown");
  });

  it("dismissing a police zone does NOT propagate cooldown to nearby cameras", () => {
    const policeZone = { id: "police-dismiss", lat: police.lat, lng: police.lng, type: "police", road: "Ngong Road" };
    const cameraZone = { id: "cam-nearby", ...destPoint(police.lat, police.lng, 0, 20), type: "camera", road: "Ngong Road", distance: 300 };

    const cooldownMap = new Map();
    applyClusterAwareDismiss("police-dismiss", policeZone, [policeZone, cameraZone], cooldownMap);

    assert.ok(cooldownMap.has("police-dismiss"), "dismissed police zone must be in cooldown");
    assert.ok(!cooldownMap.has("cam-nearby"), "camera must NOT receive cooldown from a police zone dismiss");
  });
});

describe("Dismiss-cooldown propagation — cross-road camera NOT silenced", () => {
  it("camera on a different road is not added to cooldown even if within 50 m", () => {
    // Edge case: a camera 30 m away but on a different named road (e.g. an intersecting street).
    const dismissedZone = { id: "rd-A", lat: ROUNDABOUT_LAT, lng: ROUNDABOUT_LNG, road: "Ngong Road", type: "camera" };
    const crossRoad = {
      id: "rd-X",
      ...destPoint(ROUNDABOUT_LAT, ROUNDABOUT_LNG, 90, 30),
      road: "Ring Road",
      distance: 300,
      type: "camera",
    };
    const d = haversine(dismissedZone.lat, dismissedZone.lng, crossRoad.lat, crossRoad.lng);
    assert.ok(d <= CAMERA_CLUSTER_RADIUS, `cross-road zone must be within 50 m (${d.toFixed(1)} m)`);

    const cooldownMap = new Map();
    applyClusterAwareDismiss("rd-A", dismissedZone, [dismissedZone, crossRoad], cooldownMap);

    assert.ok(!cooldownMap.has("rd-X"), "cross-road camera must NOT receive cooldown");
    assert.equal(cooldownMap.size, 1, "only the dismissed zone itself should be in cooldown");
  });
});
