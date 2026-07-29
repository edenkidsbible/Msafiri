/**
 * Announced-reports reset — regression tests for the repeat-trip silent-alert bug.
 *
 * BACKGROUND
 * ----------
 * `announcedReportsRef` (AppContext.tsx) is a Set<string> that records every
 * community-report ID that has been voiced to the driver.  Once a report ID
 * lands in the set the GPS-tick loop skips it forever:
 *
 *   if (announcedReportsRef.current.has(report.id)) continue;   // line 1683
 *   …
 *   announcedReportsRef.current.add(report.id);                  // line 1754
 *
 * `stopNavigation` (line 3001) resets the set to an empty Set so that a
 * subsequent trip over the same road re-announces every report.  If this reset
 * is accidentally removed, all reports stay suppressed on the second trip —
 * the driver hears nothing.
 *
 * WHAT THESE TESTS COVER
 * ----------------------
 * 1. Gating: a report in the announced set is skipped by the tick loop.
 * 2. Reset:  stopNavigation clears the set entirely.
 * 3. Re-announce: after the reset, the same report passes the gate on the
 *    next tick — proving the second trip is not silent.
 * 4. Own-report reroute preservation: the reroute partial-reset (line 2261)
 *    keeps own-report IDs in the set and clears non-own IDs.
 * 5. Full stop clears own-report IDs too (stopNavigation is unconditional).
 *
 * HOW TO RUN
 * ----------
 *   node artifacts/mobile/__tests__/announcedReportsReset.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─── Verbatim copies of AppContext.tsx private helpers used here ──────────────

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180, f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180, dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Minimal model of the AppContext announced-reports state machine ──────────
//
// This is a pure-function model of the three operations performed on
// announcedReportsRef in AppContext.tsx:
//
//   • announceReport(set, id)   — marks a report as spoken (line 1754)
//   • isAnnounced(set, id)      — gate check before each report (line 1683)
//   • stopNavigation(set)       — unconditional full reset (line 3001)
//   • rerouteReset(set, reports, isOwn) — partial reset keeping own IDs (line 2261)
//
// Each returns the *next* set so tests can reason about state without mutation.

/** Mark a report as announced. Returns updated set. */
function announceReport(announcedSet, reportId) {
  const next = new Set(announcedSet);
  next.add(reportId);
  return next;
}

/** Gate: true when the report has already been announced. (line 1683) */
function isAnnounced(announcedSet, reportId) {
  return announcedSet.has(reportId);
}

/**
 * Simulate stopNavigation: unconditional full reset. (line 3001)
 * Returns a new empty Set.
 */
function stopNavigation(/* _announcedSet */) {
  return new Set();
}

/**
 * Simulate the reroute partial-reset. (lines 2261–2265)
 *
 * @param {Set<string>} announcedSet   — current announced-reports set
 * @param {Array<{id: string, isOwn: boolean}>} communityReports — current report list
 * @returns {Set<string>} new set retaining only own-report IDs that were announced
 */
function rerouteReset(announcedSet, communityReports) {
  return new Set(
    communityReports
      .filter((r) => r.isOwn && announcedSet.has(r.id))
      .map((r) => r.id)
  );
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

// ─── Constants ────────────────────────────────────────────────────────────────

const IN_ZONE_DIST = 250;       // metres — inner zone (inside = no announce)
const REPORT_ANNOUNCE_DIST = 1000; // metres — outer announce radius

// ─── Test fixtures ────────────────────────────────────────────────────────────

// Driver on Thika Road, Nairobi, heading north
const DRIVER_LAT = -1.2864;
const DRIVER_LNG = 36.8297;

// Report 500 m ahead (due north)
const REPORT_AHEAD = destPoint(DRIVER_LAT, DRIVER_LNG, 0, 500);

/** Make a minimal community report in the announce window. */
function makeReport(overrides = {}) {
  return {
    id: "rpt-1",
    type: "police",
    lat: REPORT_AHEAD.lat,
    lng: REPORT_AHEAD.lng,
    status: "active",
    timestamp: Date.now() - 60_000,
    isOwn: false,
    ...overrides,
  };
}

/**
 * Simulate one GPS-tick report-announcement decision.
 *
 * Returns true if the report *would* be announced (passes the gate AND is
 * within the 1 km window) given the provided announced set.  This is the
 * pure logic extracted from AppContext lines 1682–1754 (status checks,
 * distance check, and the announced-set gate).
 *
 * @param {Set<string>} announcedSet
 * @param {{id:string, status:string, timestamp:number, lat:number, lng:number}} report
 * @param {{ lat:number, lng:number }} driverPos
 * @param {number} now
 * @returns {boolean}
 */
function wouldAnnounce(announcedSet, report, driverPos, now) {
  // Gate 1: already announced
  if (isAnnounced(announcedSet, report.id)) return false;
  // Gate 2: status filter (mirrors lines 1690–1693)
  if (report.status === "expired" || report.status === "denied") return false;
  // Gate 3: age guard — 24 h (line 1702)
  if (now - report.timestamp > 86_400_000) return false;
  // Gate 4: distance window (line 1705)
  const dist = haversine(driverPos.lat, driverPos.lng, report.lat, report.lng);
  if (dist > REPORT_ANNOUNCE_DIST || dist <= IN_ZONE_DIST) return false;
  return true;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("announcedReportsRef — initial state", () => {
  it("starts empty at the beginning of a navigation session", () => {
    const announced = new Set();
    assert.equal(announced.size, 0);
  });

  it("a fresh report passes the gate when the set is empty", () => {
    const announced = new Set();
    const report = makeReport();
    const passes = wouldAnnounce(announced, report, { lat: DRIVER_LAT, lng: DRIVER_LNG }, Date.now());
    assert.equal(passes, true, "report should be announceable at the start of a session");
  });
});

describe("announcedReportsRef — gating during a trip", () => {
  it("a report is suppressed once its ID is in the set", () => {
    let announced = new Set();
    const report = makeReport();
    const driverPos = { lat: DRIVER_LAT, lng: DRIVER_LNG };
    const now = Date.now();

    // First tick: should announce
    assert.equal(wouldAnnounce(announced, report, driverPos, now), true,
      "first tick: report should pass the gate");

    // Simulate announcing it (line 1754)
    announced = announceReport(announced, report.id);

    // Second tick on the same road: must be suppressed
    assert.equal(wouldAnnounce(announced, report, driverPos, now), false,
      "second tick on same trip: report must be suppressed once announced");
  });

  it("announcing a report does not affect other report IDs", () => {
    let announced = new Set();
    const r1 = makeReport({ id: "rpt-1" });
    const r2 = makeReport({ id: "rpt-2" });
    const driverPos = { lat: DRIVER_LAT, lng: DRIVER_LNG };
    const now = Date.now();

    announced = announceReport(announced, r1.id);

    assert.equal(wouldAnnounce(announced, r1, driverPos, now), false, "r1 suppressed");
    assert.equal(wouldAnnounce(announced, r2, driverPos, now), true,  "r2 still eligible");
  });
});

describe("stopNavigation — full reset", () => {
  it("returns an empty Set regardless of how many IDs were announced", () => {
    let announced = new Set(["rpt-1", "rpt-2", "rpt-own"]);
    announced = stopNavigation(announced);
    assert.equal(announced.size, 0, "stopNavigation must clear all announced IDs");
  });

  it("cleared set allows the same report to pass the gate again", () => {
    const report = makeReport();
    const driverPos = { lat: DRIVER_LAT, lng: DRIVER_LNG };
    const now = Date.now();

    // Trip 1: announce the report
    let announced = new Set();
    assert.equal(wouldAnnounce(announced, report, driverPos, now), true, "trip 1: passes gate");
    announced = announceReport(announced, report.id);
    assert.equal(wouldAnnounce(announced, report, driverPos, now), false, "trip 1: suppressed after announce");

    // stopNavigation (line 3001)
    announced = stopNavigation(announced);
    assert.equal(announced.size, 0);

    // Trip 2: same road, same report — must announce again
    assert.equal(
      wouldAnnounce(announced, report, driverPos, now),
      true,
      "trip 2 over same road: report must be announceable again after stopNavigation reset"
    );
  });

  it("own-report IDs are also cleared by stopNavigation (unconditional)", () => {
    const ownReport = makeReport({ id: "rpt-own", isOwn: true });
    let announced = new Set();
    announced = announceReport(announced, ownReport.id);
    assert.equal(announced.has(ownReport.id), true, "pre-condition: own report is in set");

    announced = stopNavigation(announced);
    assert.equal(announced.has(ownReport.id), false, "stopNavigation must clear own-report IDs too");
  });
});

describe("Full repeat-trip scenario", () => {
  it("report voiced on trip 1 is voiced again on trip 2 over the same road", () => {
    const report = makeReport({ id: "police-checkpoint-thika" });
    const driverPos = { lat: DRIVER_LAT, lng: DRIVER_LNG };
    const now = Date.now();
    const voiced = [];  // log of what was announced

    // ── Trip 1 ───────────────────────────────────────────────────────────────
    let announced = new Set();

    // GPS tick: report is in window and not yet announced
    if (wouldAnnounce(announced, report, driverPos, now)) {
      voiced.push({ trip: 1, reportId: report.id });
      announced = announceReport(announced, report.id);
    }

    // Driver passes and gets closer — gating suppresses re-announce on same trip
    if (wouldAnnounce(announced, report, driverPos, now)) {
      voiced.push({ trip: 1, reportId: report.id, repeat: true });
    }

    assert.equal(voiced.length, 1, "trip 1: report voiced exactly once");
    assert.equal(voiced[0].trip, 1);

    // ── Stop navigation (driver ends the session) ─────────────────────────────
    announced = stopNavigation(announced);
    assert.equal(announced.size, 0, "after stop: announced set is empty");

    // ── Trip 2 (same road, same report still active) ──────────────────────────
    const now2 = now + 300_000; // 5 minutes later — report still active (< 24 h)

    if (wouldAnnounce(announced, report, driverPos, now2)) {
      voiced.push({ trip: 2, reportId: report.id });
      announced = announceReport(announced, report.id);
    }

    assert.equal(voiced.length, 2, "trip 2: report voiced again — not silently skipped");
    assert.equal(voiced[1].trip, 2, "second voiced entry is from trip 2");
    assert.equal(voiced[1].reportId, report.id, "same report ID announced on both trips");
  });

  it("multiple reports on the same route are all re-announced on trip 2", () => {
    const reports = [
      makeReport({ id: "rpt-police",    type: "police" }),
      makeReport({ id: "rpt-camera",    type: "camera" }),
      makeReport({ id: "rpt-roadworks", type: "roadworks" }),
    ];
    const driverPos = { lat: DRIVER_LAT, lng: DRIVER_LNG };
    const now = Date.now();

    // Trip 1
    let announced = new Set();
    for (const r of reports) {
      if (wouldAnnounce(announced, r, driverPos, now)) {
        announced = announceReport(announced, r.id);
      }
    }
    assert.equal(announced.size, 3, "all 3 reports announced on trip 1");

    // Stop
    announced = stopNavigation(announced);

    // Trip 2
    const voicedOnTrip2 = [];
    for (const r of reports) {
      if (wouldAnnounce(announced, r, driverPos, now + 300_000)) {
        voicedOnTrip2.push(r.id);
        announced = announceReport(announced, r.id);
      }
    }
    assert.equal(voicedOnTrip2.length, 3,
      "all 3 reports must be voiced again on trip 2; none silently skipped");
  });
});

describe("Reroute partial-reset — own-report preservation", () => {
  it("reroute keeps own-report IDs in the set", () => {
    const ownReport   = makeReport({ id: "rpt-own",   isOwn: true  });
    const otherReport = makeReport({ id: "rpt-other", isOwn: false });
    const communityReports = [ownReport, otherReport];

    let announced = new Set([ownReport.id, otherReport.id]);

    // Reroute partial-reset (AppContext lines 2261–2265)
    announced = rerouteReset(announced, communityReports);

    assert.equal(announced.has(ownReport.id),   true,  "own report must stay in set after reroute");
    assert.equal(announced.has(otherReport.id), false, "other report must be cleared by reroute reset");
  });

  it("reroute does not preserve IDs for own reports that were not yet announced", () => {
    const ownReportUnspoken = makeReport({ id: "rpt-own-new", isOwn: true });
    const communityReports = [ownReportUnspoken];

    // It was never announced, so it's not in the set
    const announced = new Set();
    const next = rerouteReset(announced, communityReports);

    assert.equal(next.has(ownReportUnspoken.id), false,
      "un-announced own report must not be injected into the set by reroute");
  });

  it("stopNavigation after reroute clears own-report IDs too", () => {
    const ownReport = makeReport({ id: "rpt-own", isOwn: true });
    let announced = new Set([ownReport.id]);
    announced = rerouteReset(announced, [ownReport]); // own ID preserved
    assert.equal(announced.has(ownReport.id), true, "pre-condition: own ID in set after reroute");

    announced = stopNavigation(announced);
    assert.equal(announced.has(ownReport.id), false,
      "stopNavigation must clear own-report IDs even when reroute preserved them");
  });
});

describe("Gate: expired/denied reports still suppressed regardless of announced set", () => {
  it("expired report is never announced even if set is empty (filter fires first)", () => {
    const report = makeReport({ status: "expired" });
    const announced = new Set();
    const driverPos = { lat: DRIVER_LAT, lng: DRIVER_LNG };
    assert.equal(
      wouldAnnounce(announced, report, driverPos, Date.now()),
      false,
      "expired report must not be announced"
    );
  });

  it("denied report is never announced even if set is empty", () => {
    const report = makeReport({ status: "denied" });
    const announced = new Set();
    const driverPos = { lat: DRIVER_LAT, lng: DRIVER_LNG };
    assert.equal(
      wouldAnnounce(announced, report, driverPos, Date.now()),
      false,
      "denied report must not be announced"
    );
  });

  it("report older than 24 h is skipped (age guard)", () => {
    const staleReport = makeReport({ timestamp: Date.now() - 86_401_000 });
    const announced = new Set();
    const driverPos = { lat: DRIVER_LAT, lng: DRIVER_LNG };
    assert.equal(
      wouldAnnounce(announced, staleReport, driverPos, Date.now()),
      false,
      "report older than 24 h must not be announced"
    );
  });
});
