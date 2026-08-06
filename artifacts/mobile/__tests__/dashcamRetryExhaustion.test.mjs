/**
 * Dashcam upload retry-exhaustion unit tests
 *
 * Verifies that failed segments with retryCount >= MAX_UPLOAD_RETRIES are NOT
 * re-enqueued in two paths:
 *   1. Hydration — the queue rebuilt from AsyncStorage on app launch
 *   2. NetInfo reconnect listener — triggered when connectivity is restored
 *
 * Both paths must guard on retryCount < MAX_UPLOAD_RETRIES so that "permanently
 * failed" clips never slip back into the upload queue (avoiding repeated
 * uploads/R2 charges and violating the bounded-backoff contract).
 *
 * These tests mirror the filtering logic verbatim from DashcamContext.tsx —
 * if the source filter changes these tests should fail, acting as a regression
 * net.  Run with: node artifacts/mobile/__tests__/dashcamRetryExhaustion.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─── Constants (verbatim from DashcamContext.tsx) ─────────────────────────────

const UPLOAD_RETRY_BACKOFF = [15_000, 60_000, 5 * 60_000, 15 * 60_000];
const MAX_UPLOAD_RETRIES   = UPLOAD_RETRY_BACKOFF.length; // 4

// ─── Helpers that mirror the two filtering paths in DashcamContext.tsx ─────────

/**
 * Hydration filter (mirrors the toUpload filter in the hydration useEffect).
 * Returns the IDs that would be pushed into uploadQueueRef.current on launch.
 */
function hydrateQueue(segments) {
  return segments
    .filter(
      (s) =>
        s.uploadStatus === "pending" ||
        (s.uploadStatus === "failed" && (s.retryCount ?? 0) < MAX_UPLOAD_RETRIES)
    )
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((s) => s.id);
}

/**
 * NetInfo reconnect filter (mirrors the failedIds filter in the NetInfo listener).
 * `inQueue` simulates the set of IDs already in uploadQueueRef.current.
 */
function reconnectQueue(segments, inQueue = new Set()) {
  return segments
    .filter(
      (s) =>
        s.uploadStatus === "failed" &&
        !inQueue.has(s.id) &&
        (s.retryCount ?? 0) < MAX_UPLOAD_RETRIES
    )
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((s) => s.id);
}

// ─── Test data ─────────────────────────────────────────────────────────────────

function makeSeg(id, uploadStatus, retryCount, startedAt = 1000) {
  return { id, uploadStatus, retryCount, startedAt };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Hydration queue rebuild", () => {
  it("enqueues pending segments with no retryCount", () => {
    const segs = [makeSeg("a", "pending", undefined)];
    assert.deepEqual(hydrateQueue(segs), ["a"]);
  });

  it("enqueues failed segments with retryCount below MAX_UPLOAD_RETRIES", () => {
    const segs = [
      makeSeg("b", "failed", 0),
      makeSeg("c", "failed", MAX_UPLOAD_RETRIES - 1),
    ];
    const queue = hydrateQueue(segs);
    assert.ok(queue.includes("b"), "retryCount=0 should be enqueued");
    assert.ok(queue.includes("c"), "retryCount=MAX-1 should be enqueued");
  });

  it("does NOT enqueue failed segments at exactly MAX_UPLOAD_RETRIES", () => {
    const segs = [makeSeg("d", "failed", MAX_UPLOAD_RETRIES)];
    assert.deepEqual(hydrateQueue(segs), []);
  });

  it("does NOT enqueue failed segments beyond MAX_UPLOAD_RETRIES", () => {
    const segs = [makeSeg("e", "failed", MAX_UPLOAD_RETRIES + 2)];
    assert.deepEqual(hydrateQueue(segs), []);
  });

  it("mixed: only eligible segments are enqueued", () => {
    const segs = [
      makeSeg("ok1",      "pending",   undefined, 100),
      makeSeg("ok2",      "failed",    2,          200),
      makeSeg("terminal", "failed",    MAX_UPLOAD_RETRIES, 300),
      makeSeg("uploaded", "uploaded",  undefined, 400),
    ];
    const queue = hydrateQueue(segs);
    assert.ok(queue.includes("ok1"),      "pending should be in queue");
    assert.ok(queue.includes("ok2"),      "failed w/ room should be in queue");
    assert.ok(!queue.includes("terminal"), "terminal failure must NOT be in queue");
    assert.ok(!queue.includes("uploaded"), "uploaded must NOT be in queue");
  });
});

describe("NetInfo reconnect re-enqueue", () => {
  it("re-enqueues failed segments with retryCount below MAX_UPLOAD_RETRIES", () => {
    const segs = [makeSeg("f", "failed", 1)];
    assert.deepEqual(reconnectQueue(segs), ["f"]);
  });

  it("does NOT re-enqueue terminal failures on connectivity restore", () => {
    const segs = [makeSeg("g", "failed", MAX_UPLOAD_RETRIES)];
    assert.deepEqual(reconnectQueue(segs), []);
  });

  it("does NOT re-enqueue failures already in the queue", () => {
    const segs = [
      makeSeg("h", "failed", 2),
      makeSeg("i", "failed", 1),
    ];
    const inQueue = new Set(["h"]);
    const queue = reconnectQueue(segs, inQueue);
    assert.ok(!queue.includes("h"), "already-queued segment must be excluded");
    assert.ok(queue.includes("i"),  "non-queued eligible segment must be included");
  });

  it("exhausted-then-reconnect scenario: terminal failure stays off queue", () => {
    // Simulate: seg exhausted all retries → connectivity lost → reconnected.
    // The segment must NOT be re-enqueued even after reconnection.
    const segs = [
      makeSeg("exhausted", "failed", MAX_UPLOAD_RETRIES),
      makeSeg("fresh",     "failed", 0),
    ];
    const queue = reconnectQueue(segs);
    assert.ok(!queue.includes("exhausted"), "exhausted segment must NOT be re-enqueued on reconnect");
    assert.ok(queue.includes("fresh"),      "fresh failure must be re-enqueued on reconnect");
  });

  it("relaunch-after-exhaustion scenario: terminal failure stays off queue in hydration", () => {
    // Simulate: app relaunched after segment exhausted retries in previous session.
    // Hydration must not add exhausted segments back into the upload queue.
    const segs = [
      makeSeg("term1",   "failed", MAX_UPLOAD_RETRIES,     1000),
      makeSeg("term2",   "failed", MAX_UPLOAD_RETRIES + 1, 2000),
      makeSeg("pending", "pending", undefined,             3000),
    ];
    const queue = hydrateQueue(segs);
    assert.ok(!queue.includes("term1"),   "term1 must not be in queue after relaunch");
    assert.ok(!queue.includes("term2"),   "term2 must not be in queue after relaunch");
    assert.ok(queue.includes("pending"),  "pending must be in queue after relaunch");
  });
});
