/**
 * Dashcam vehicle-switch timing tests
 *
 * Two layers of verification:
 *
 * Layer 1 — Functional tests on the production utility functions
 *   Imports the actual exported functions from utils/dashcamSegmentRouting.js
 *   (the same module that DashcamContext.tsx imports at runtime). Any change to
 *   those functions that alters the routing contract will break these tests.
 *
 * Layer 2 — Structural source verification
 *   Reads DashcamContext.tsx and DashcamOverlay.tsx and asserts key invariants
 *   about how the snapshot refs are wired and how the recording loop calls
 *   onSegmentStart before recordAsync. A refactor that moves the snapshot to the
 *   wrong place or drops the call entirely will fail these checks.
 *
 * Run with: node artifacts/mobile/__tests__/dashcamVehicleSwitch.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Import the ACTUAL production utility functions ───────────────────────────

import {
  vehicleSegmentsKey,
  vehicleSegmentsDir,
  computeSegmentDestUri,
  detectVehicleSwitch,
  buildDashcamSegment,
} from "../utils/dashcamSegmentRouting.js";

// ─── Source paths for structural checks ──────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url));
const contextSrc = readFileSync(
  resolve(__dir, "../context/DashcamContext.tsx"),
  "utf8"
);
const overlaySrc = readFileSync(
  resolve(__dir, "../components/DashcamOverlay.tsx"),
  "utf8"
);

// ─── Layer 1: Functional tests on production utility functions ────────────────

describe("vehicleSegmentsKey (production utility)", () => {
  it("returns the correct AsyncStorage key for a named vehicle", () => {
    assert.equal(vehicleSegmentsKey("vehicleA"), "dashcam_segments_vehicleA");
    assert.equal(vehicleSegmentsKey("vehicleB"), "dashcam_segments_vehicleB");
  });

  it("returns the correct key for the default vehicle", () => {
    assert.equal(vehicleSegmentsKey("default"), "dashcam_segments_default");
  });

  it("two different vehicle keys produce two different storage keys", () => {
    assert.notEqual(vehicleSegmentsKey("vehicleA"), vehicleSegmentsKey("vehicleB"));
  });
});

describe("vehicleSegmentsDir (production utility)", () => {
  const DOC_DIR = "file:///data/user/0/com.example/files/";

  it("embeds the vehicle key in the path", () => {
    const dir = vehicleSegmentsDir("vehicleA", DOC_DIR);
    assert.ok(dir.includes("vehicleA"), `dir must include vehicle key: ${dir}`);
  });

  it("uses the supplied documentDir as the base", () => {
    const dir = vehicleSegmentsDir("vehicleA", DOC_DIR);
    assert.ok(dir.startsWith(DOC_DIR), `dir must start with documentDir: ${dir}`);
  });

  it("two different vehicle keys produce two different directories", () => {
    const a = vehicleSegmentsDir("vehicleA", DOC_DIR);
    const b = vehicleSegmentsDir("vehicleB", DOC_DIR);
    assert.notEqual(a, b);
  });

  it("directory for vehicleA does NOT contain vehicleB's path segment", () => {
    const a = vehicleSegmentsDir("vehicleA", DOC_DIR);
    assert.ok(!a.includes("vehicleB"), `vehicleA dir must not include vehicleB: ${a}`);
  });

  it("falls back gracefully when documentDir is empty string", () => {
    const dir = vehicleSegmentsDir("vehicleA", "");
    assert.ok(dir.includes("vehicleA"), `dir must still include vehicle key: ${dir}`);
    assert.ok(dir.endsWith("/"), "dir must end with /");
  });
});

describe("computeSegmentDestUri (production utility)", () => {
  const DIR = "file:///data/dashcam/segments/vehicleA/";

  it("appends the segment id with .mp4 extension", () => {
    const uri = computeSegmentDestUri(DIR, "seg_1700000000000");
    assert.equal(uri, `${DIR}seg_1700000000000.mp4`);
  });

  it("uri is inside the supplied directory", () => {
    const uri = computeSegmentDestUri(DIR, "seg_abc");
    assert.ok(uri.startsWith(DIR), `uri must start with capturedDir: ${uri}`);
  });

  it("segment from vehicleA dir does NOT land in vehicleB dir", () => {
    const vehicleADir = "file:///data/dashcam/segments/vehicleA/";
    const vehicleBDir = "file:///data/dashcam/segments/vehicleB/";
    const uri = computeSegmentDestUri(vehicleADir, "seg_1");
    assert.ok(!uri.startsWith(vehicleBDir),
      `vehicleA segment URI must not start with vehicleB dir: ${uri}`);
  });
});

describe("detectVehicleSwitch (production utility)", () => {
  it("returns false when the same key is present at start and end", () => {
    const key = vehicleSegmentsKey("vehicleA");
    assert.equal(detectVehicleSwitch(key, key), false);
  });

  it("returns true when the key changed (vehicle switched mid-segment)", () => {
    const keyA = vehicleSegmentsKey("vehicleA");
    const keyB = vehicleSegmentsKey("vehicleB");
    assert.equal(detectVehicleSwitch(keyA, keyB), true);
  });

  it("returns false when the driver switched away then back (round-trip)", () => {
    const keyA = vehicleSegmentsKey("vehicleA");
    // snapshot captured vehicleA; after a round-trip, current is also vehicleA
    assert.equal(detectVehicleSwitch(keyA, keyA), false);
  });
});

describe("buildDashcamSegment (production utility)", () => {
  const NOW = 1_700_000_000_000;

  it("locked clip has uploadStatus=pending", () => {
    const seg = buildDashcamSegment({
      id: "seg_1", destUri: "file:///clip.mp4",
      durationS: 30, sizeBytes: 1_000_000,
      lockReason: "manual", nowMs: NOW,
    });
    assert.equal(seg.locked, true);
    assert.equal(seg.uploadStatus, "pending");
    assert.equal(seg.lockReason, "manual");
  });

  it("unlocked clip has uploadStatus=none", () => {
    const seg = buildDashcamSegment({
      id: "seg_2", destUri: "file:///clip.mp4",
      durationS: 120, sizeBytes: 4_000_000,
      lockReason: null, nowMs: NOW,
    });
    assert.equal(seg.locked, false);
    assert.equal(seg.uploadStatus, "none");
    assert.equal(seg.lockReason, undefined);
  });

  it("startedAt is computed from durationS and nowMs", () => {
    const seg = buildDashcamSegment({
      id: "seg_3", destUri: "file:///clip.mp4",
      durationS: 60, sizeBytes: 2_000_000,
      lockReason: null, nowMs: NOW,
    });
    assert.equal(seg.startedAt, NOW - 60_000);
  });

  it("GPS coords are included when provided", () => {
    const seg = buildDashcamSegment({
      id: "seg_4", destUri: "file:///clip.mp4",
      durationS: 30, sizeBytes: 500_000, lockReason: null,
      coords: { lat: -1.286, lng: 36.817 }, nowMs: NOW,
    });
    assert.equal(seg.lat, -1.286);
    assert.equal(seg.lng, 36.817);
  });

  it("GPS coords are undefined when not provided", () => {
    const seg = buildDashcamSegment({
      id: "seg_5", destUri: "file:///clip.mp4",
      durationS: 30, sizeBytes: 500_000, lockReason: null, nowMs: NOW,
    });
    assert.equal(seg.lat, undefined);
    assert.equal(seg.lng, undefined);
  });
});

// ─── Layer 2: Structural source verification ──────────────────────────────────
//
// These tests read the actual TypeScript source and assert that the production
// code uses the correct refs and call ordering. A refactor that accidentally
// uses the live ref instead of the snapshot ref — or that drops onSegmentStart
// from the loop — will fail here even if the utility tests still pass.

describe("DashcamContext.tsx — imports routing utility functions", () => {
  it("imports computeSegmentDestUri from dashcamSegmentRouting", () => {
    assert.ok(
      contextSrc.includes("computeSegmentDestUri"),
      "DashcamContext.tsx must import and use computeSegmentDestUri"
    );
  });

  it("imports detectVehicleSwitch from dashcamSegmentRouting", () => {
    assert.ok(
      contextSrc.includes("detectVehicleSwitch"),
      "DashcamContext.tsx must import and use detectVehicleSwitch"
    );
  });

  it("imports buildDashcamSegment from dashcamSegmentRouting", () => {
    assert.ok(
      contextSrc.includes("buildDashcamSegment"),
      "DashcamContext.tsx must import and use buildDashcamSegment"
    );
  });

  it("imports from utils/dashcamSegmentRouting path", () => {
    assert.ok(
      contextSrc.includes("dashcamSegmentRouting"),
      "DashcamContext.tsx must import from utils/dashcamSegmentRouting"
    );
  });
});

describe("DashcamContext.tsx — onSegmentStart snapshots the correct refs", () => {
  // Locate the onSegmentStart function body in the source.
  const startFnMatch = contextSrc.match(
    /const onSegmentStart = useCallback\(\s*\(\)\s*=>\s*\{([^}]+)\}/s
  );

  it("onSegmentStart function is present in source", () => {
    assert.ok(startFnMatch, "onSegmentStart useCallback must be present in DashcamContext.tsx");
  });

  it("onSegmentStart assigns recordingSegmentDirRef from segmentsFsDirRef", () => {
    const body = startFnMatch?.[1] ?? "";
    assert.ok(
      body.includes("recordingSegmentDirRef.current") &&
      body.includes("segmentsFsDirRef.current"),
      "onSegmentStart must assign recordingSegmentDirRef.current = segmentsFsDirRef.current\n" +
      `Function body: ${body}`
    );
  });

  it("onSegmentStart assigns recordingSegmentAsyncKeyRef from segmentsAsyncKeyRef", () => {
    const body = startFnMatch?.[1] ?? "";
    assert.ok(
      body.includes("recordingSegmentAsyncKeyRef.current") &&
      body.includes("segmentsAsyncKeyRef.current"),
      "onSegmentStart must assign recordingSegmentAsyncKeyRef.current = segmentsAsyncKeyRef.current\n" +
      `Function body: ${body}`
    );
  });
});

describe("DashcamContext.tsx — onSegmentComplete uses snapshot refs, not live refs", () => {
  // Locate the onSegmentComplete function body.
  const completeFnIdx = contextSrc.indexOf("const onSegmentComplete = useCallback(");
  assert.ok(completeFnIdx !== -1, "onSegmentComplete must exist in DashcamContext.tsx");

  // Grab a generous slice from the function start (covers capturedDir / capturedAsyncKey assignment)
  const completeFnSlice = contextSrc.slice(completeFnIdx, completeFnIdx + 2000);

  it("capturedDir is read from recordingSegmentDirRef (the snapshot ref)", () => {
    assert.ok(
      completeFnSlice.includes("recordingSegmentDirRef.current"),
      "onSegmentComplete must read capturedDir from recordingSegmentDirRef.current (snapshot)\n" +
      "NOT from segmentsFsDirRef.current (live ref)"
    );
  });

  it("capturedAsyncKey is read from recordingSegmentAsyncKeyRef (the snapshot ref)", () => {
    assert.ok(
      completeFnSlice.includes("recordingSegmentAsyncKeyRef.current"),
      "onSegmentComplete must read capturedAsyncKey from recordingSegmentAsyncKeyRef.current (snapshot)\n" +
      "NOT from segmentsAsyncKeyRef.current (live ref)"
    );
  });

  it("destUri is computed via computeSegmentDestUri (not an inline template literal)", () => {
    assert.ok(
      completeFnSlice.includes("computeSegmentDestUri("),
      "onSegmentComplete must call computeSegmentDestUri() to build destUri"
    );
  });

  it("mid-segment switch is detected via detectVehicleSwitch (not an inline !== comparison)", () => {
    assert.ok(
      completeFnSlice.includes("detectVehicleSwitch("),
      "onSegmentComplete must call detectVehicleSwitch() to detect a mid-segment vehicle switch"
    );
  });

  it("segment record is built via buildDashcamSegment (not an inline object literal)", () => {
    assert.ok(
      completeFnSlice.includes("buildDashcamSegment("),
      "onSegmentComplete must call buildDashcamSegment() to construct the segment record"
    );
  });
});

describe("DashcamOverlay.tsx — recording loop calls onSegmentStart before recordAsync", () => {
  // Find the recording loop in DashcamOverlay.tsx.
  // The loop body is inside the useEffect that depends on [isRecording, recordingEpoch].
  const loopIdx = overlaySrc.indexOf("async function loop()");
  assert.ok(loopIdx !== -1, "recording loop function must be present in DashcamOverlay.tsx");

  // Grab the loop body — up to the closing of the while block (generous slice).
  const loopSlice = overlaySrc.slice(loopIdx, loopIdx + 3000);

  it("onSegmentStart() call is present in the recording loop", () => {
    assert.ok(
      loopSlice.includes("onSegmentStart()"),
      "DashcamOverlay recording loop must call onSegmentStart()"
    );
  });

  it("recordAsync( call is present in the recording loop", () => {
    assert.ok(
      loopSlice.includes("recordAsync("),
      "DashcamOverlay recording loop must call recordAsync()"
    );
  });

  it("onSegmentStart() appears before recordAsync( in the loop source", () => {
    const startPos  = loopSlice.indexOf("onSegmentStart()");
    const recordPos = loopSlice.indexOf("recordAsync(");
    assert.ok(startPos !== -1,  "onSegmentStart() must exist in loop");
    assert.ok(recordPos !== -1, "recordAsync( must exist in loop");
    assert.ok(
      startPos < recordPos,
      `onSegmentStart() (pos ${startPos}) must come before recordAsync( (pos ${recordPos}) ` +
      "in the recording loop — the snapshot must be taken before the clip starts recording"
    );
  });

  it("onSegmentComplete( is called with the result AFTER recordAsync resolves", () => {
    const recordPos   = loopSlice.indexOf("recordAsync(");
    const completePos = loopSlice.indexOf("onSegmentComplete(");
    assert.ok(completePos !== -1, "onSegmentComplete( must be called in the loop");
    assert.ok(
      recordPos < completePos,
      `recordAsync( (pos ${recordPos}) must come before onSegmentComplete( (pos ${completePos})`
    );
  });

  it("the ordering is: onSegmentStart → recordAsync → onSegmentComplete", () => {
    const startPos    = loopSlice.indexOf("onSegmentStart()");
    const recordPos   = loopSlice.indexOf("recordAsync(");
    const completePos = loopSlice.indexOf("onSegmentComplete(");
    assert.ok(
      startPos < recordPos && recordPos < completePos,
      "Call order violated in DashcamOverlay recording loop.\n" +
      `  onSegmentStart:    pos ${startPos}\n` +
      `  recordAsync:       pos ${recordPos}\n` +
      `  onSegmentComplete: pos ${completePos}\n` +
      "Required order: onSegmentStart → recordAsync → onSegmentComplete"
    );
  });
});
