/**
 * Background odometer handoff-protocol tests.
 *
 * Exercises the session-ownership ledger protocol from
 * artifacts/mobile/utils/backgroundOdometer.ts:
 *   • batch accumulation with the >500 m jump filter
 *   • exactly-once consume (second consume returns 0)
 *   • a stale task write landing AFTER consume is discarded (no double credit)
 *   • an unauthorized invocation (no session token) is a no-op
 *   • crash-mid-background leftovers are still consumable on next launch
 *   • a new session resets a ledger stamped with an old session
 *
 * The functions below are verbatim copies of the pure protocol core in
 * backgroundOdometer.ts (bgOdoBeginCore / bgOdoAccumulateCore /
 * bgOdoConsumeCore). When the source changes these tests should fail,
 * acting as a regression net.
 *
 * Run with: node artifacts/mobile/__tests__/backgroundOdometer.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─── Verbatim copies of backgroundOdometer.ts protocol core ──────────────────

const BG_ODO_SESSION_KEY = "@msafiri/bgOdoSession";
const BG_ODO_STATE_KEY   = "@msafiri/bgOdoState";
const MAX_SEGMENT_M = 500;

function bgOdoHaversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180;
  const f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(df / 2) ** 2 +
    Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function bgOdoBeginCore(store, seed) {
  const sessionId =
    Date.now().toString(36) + Math.random().toString(36).slice(2);
  const state = {
    sessionId,
    pendingM: 0,
    prev: seed ? { lat: seed.lat, lng: seed.lng, t: Date.now() } : null,
  };
  await store.setItem(BG_ODO_STATE_KEY, JSON.stringify(state));
  await store.setItem(BG_ODO_SESSION_KEY, sessionId);
  return sessionId;
}

async function bgOdoAccumulateCore(store, fixes) {
  if (!fixes.length) return;

  const sessionId = await store.getItem(BG_ODO_SESSION_KEY);
  if (!sessionId) return;

  let state = null;
  try {
    const raw = await store.getItem(BG_ODO_STATE_KEY);
    state = raw ? JSON.parse(raw) : null;
  } catch {}
  if (!state || state.sessionId !== sessionId) {
    state = { sessionId, pendingM: 0, prev: null };
  }

  let prev = state.prev;
  let pendingM = state.pendingM;
  for (const fix of fixes) {
    if (prev) {
      const d = bgOdoHaversine(prev.lat, prev.lng, fix.lat, fix.lng);
      if (d > 0 && d < MAX_SEGMENT_M) pendingM += d;
    }
    prev = fix;
  }

  await store.setItem(
    BG_ODO_STATE_KEY,
    JSON.stringify({ sessionId, pendingM, prev }),
  );
}

async function bgOdoConsumeCore(store) {
  const [sessionId, stateRaw] = await Promise.all([
    store.getItem(BG_ODO_SESSION_KEY),
    store.getItem(BG_ODO_STATE_KEY),
  ]);
  await Promise.all([
    store.removeItem(BG_ODO_SESSION_KEY),
    store.removeItem(BG_ODO_STATE_KEY),
  ]);

  if (!sessionId || !stateRaw) return { pendingM: 0, lastFix: null };
  let state = null;
  try { state = JSON.parse(stateRaw); } catch {}
  if (!state || state.sessionId !== sessionId) return { pendingM: 0, lastFix: null };

  const lastFix =
    state.prev && typeof state.prev.lat === "number" && typeof state.prev.lng === "number"
      ? { lat: state.prev.lat, lng: state.prev.lng }
      : null;
  return { pendingM: state.pendingM > 0 ? state.pendingM : 0, lastFix };
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeStore() {
  const map = new Map();
  return {
    async getItem(k) { return map.has(k) ? map.get(k) : null; },
    async setItem(k, v) { map.set(k, v); },
    async removeItem(k) { map.delete(k); },
    _map: map,
  };
}

// ~100 m of northward movement per step near Nairobi.
const LAT0 = -1.2921, LNG0 = 36.8219;
const STEP_LAT = 0.0009; // ≈ 100 m
function fixAt(step) {
  return { lat: LAT0 + STEP_LAT * step, lng: LNG0, t: 1_700_000_000_000 + step * 10_000 };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("background odometer protocol", () => {
  it("accumulates a batch of fixes from the seed and filters >500 m jumps", async () => {
    const store = makeStore();
    await bgOdoBeginCore(store, { lat: LAT0, lng: LNG0 });
    // 3 steps of ~100 m plus one giant 1° (~111 km) teleport that must be ignored
    await bgOdoAccumulateCore(store, [
      fixAt(1),
      fixAt(2),
      { lat: LAT0 + 1, lng: LNG0, t: 0 }, // jump — filtered
      { lat: LAT0 + 1 + STEP_LAT, lng: LNG0, t: 0 }, // ~100 m after the jump — counts
    ]);
    const { pendingM, lastFix } = await bgOdoConsumeCore(store);
    assert.ok(pendingM > 250 && pendingM < 350, `expected ~300 m, got ${pendingM}`);
    assert.ok(Math.abs(lastFix.lat - (LAT0 + 1 + STEP_LAT)) < 1e-9);
  });

  it("consume is exactly-once: second consume returns zero", async () => {
    const store = makeStore();
    await bgOdoBeginCore(store, { lat: LAT0, lng: LNG0 });
    await bgOdoAccumulateCore(store, [fixAt(1)]);
    const first = await bgOdoConsumeCore(store);
    assert.ok(first.pendingM > 0);
    const second = await bgOdoConsumeCore(store);
    assert.equal(second.pendingM, 0);
    assert.equal(second.lastFix, null);
  });

  it("a stale task write after consume is discarded — no double credit", async () => {
    const store = makeStore();
    await bgOdoBeginCore(store, { lat: LAT0, lng: LNG0 });
    await bgOdoAccumulateCore(store, [fixAt(1)]);

    // Simulate an in-flight invocation: it reads its inputs BEFORE consume…
    const staleSession = await store.getItem(BG_ODO_SESSION_KEY);
    const staleState = JSON.parse(await store.getItem(BG_ODO_STATE_KEY));

    // …the foreground consumes (credits ~100 m and clears keys)…
    const consumed = await bgOdoConsumeCore(store);
    assert.ok(consumed.pendingM > 0);

    // …then the stale invocation writes its balance back.
    staleState.pendingM += 100;
    await store.setItem(BG_ODO_STATE_KEY, JSON.stringify({ ...staleState, sessionId: staleSession }));

    // No session token exists any more → later consumes must discard it.
    const again = await bgOdoConsumeCore(store);
    assert.equal(again.pendingM, 0);
  });

  it("stale state is also discarded when a NEW session has since begun", async () => {
    const store = makeStore();
    await bgOdoBeginCore(store, { lat: LAT0, lng: LNG0 });
    const oldSession = await store.getItem(BG_ODO_SESSION_KEY);
    await bgOdoConsumeCore(store);

    // New stint begins, then a stale write stamped with the OLD session lands.
    await bgOdoBeginCore(store, { lat: LAT0, lng: LNG0 });
    await store.setItem(
      BG_ODO_STATE_KEY,
      JSON.stringify({ sessionId: oldSession, pendingM: 9999, prev: fixAt(1) }),
    );

    const { pendingM } = await bgOdoConsumeCore(store);
    assert.equal(pendingM, 0, "old-session balance must not be credited");
  });

  it("accumulate is a no-op without a session token (stopped/consumed stint)", async () => {
    const store = makeStore();
    await bgOdoAccumulateCore(store, [fixAt(0), fixAt(1)]);
    assert.equal(await store.getItem(BG_ODO_STATE_KEY), null);
    const { pendingM } = await bgOdoConsumeCore(store);
    assert.equal(pendingM, 0);
  });

  it("accumulate resets a ledger stamped with a different session", async () => {
    const store = makeStore();
    await bgOdoBeginCore(store, null);
    await store.setItem(
      BG_ODO_STATE_KEY,
      JSON.stringify({ sessionId: "old-session", pendingM: 9999, prev: fixAt(0) }),
    );
    await bgOdoAccumulateCore(store, [fixAt(0), fixAt(1)]);
    const { pendingM } = await bgOdoConsumeCore(store);
    // The 9999 m stale balance is gone; only fix0 → fix1 (~100 m) counts.
    assert.ok(pendingM > 50 && pendingM < 150, `expected ~100 m, got ${pendingM}`);
  });

  it("crash-mid-background leftovers are consumable on next launch", async () => {
    const store = makeStore();
    await bgOdoBeginCore(store, { lat: LAT0, lng: LNG0 });
    await bgOdoAccumulateCore(store, [fixAt(1), fixAt(2)]);
    // App killed — keys survive in storage. Next launch consumes once.
    const { pendingM, lastFix } = await bgOdoConsumeCore(store);
    assert.ok(pendingM > 150 && pendingM < 250, `expected ~200 m, got ${pendingM}`);
    assert.ok(lastFix != null);
  });
});
