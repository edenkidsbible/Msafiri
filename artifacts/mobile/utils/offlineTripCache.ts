/**
 * offlineTripCache.ts — Offline read-through cache and mutation queue for
 * saved places and planned trips.
 *
 * Storage keys:
 *   msafiri_saved_places_v1              — cached saved places (per device)
 *   msafiri_planned_trips_v1             — cached planned trips (per device)
 *   msafiri_trips_mutation_queue_v1      — offline write queue (global, device-scoped ops)
 *
 * Pattern: stale-while-revalidate, same as garage offline caching.
 * Per-device scoping keeps data isolated if device ID ever changes.
 *
 * Concurrency model
 * ─────────────────
 * • All queue write operations (enqueue, cancel, merge, commit) are serialized
 *   through `withQueueLock` — a module-level promise chain that ensures no two
 *   read-modify-write cycles interleave.
 * • `flushQueue` uses a separate flush mutex to prevent concurrent replay passes.
 *   Within the flush loop, each op is re-read through the write lock immediately
 *   before its network call so that user mutations (edits/cancels) that arrived
 *   while the previous network call was in flight are always honoured.
 * • Network calls are made outside any lock so user mutations are never blocked
 *   by I/O.
 *
 * Dependency-awareness
 * ─────────────────────
 * Create ops carry a `tempId` (the local optimistic ID) so the queue can
 * coalesce correctly:
 *   – Edit of a pending create  → `mergeIntoQueuedCreate` patches the create op
 *   – Delete of a pending create → `cancelQueuedCreate` removes the create op
 *   – Trip create that references a temp place → `_commitPlaceCreate` rewrites the
 *     savedPlaceId to the real server ID *in the queue* the moment the place create
 *     succeeds; this survives across partial-failure retry passes.
 *   – If a place create fails, all dependent trip creates are deferred (left queued)
 *     until the place create succeeds on the next reconnect.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  SavedPlace,
  PlannedTrip,
  createSavedPlace,
  updateSavedPlace,
  deleteSavedPlace,
  createPlannedTrip,
  deletePlannedTrip,
} from "@/utils/tripsApi";

// ── Storage keys ──────────────────────────────────────────────────────────────

const PLACES_KEY = (deviceId: string) => `msafiri_saved_places_v1:${deviceId}`;
const TRIPS_KEY  = (deviceId: string) => `msafiri_planned_trips_v1:${deviceId}`;
const QUEUE_KEY  = "msafiri_trips_mutation_queue_v1";

// ── Cached data ───────────────────────────────────────────────────────────────

export interface TripCache {
  places: SavedPlace[];
  trips: PlannedTrip[];
}

/** Load the cached places and trips for this device. Returns empty arrays on miss or error. */
export async function loadCache(deviceId: string): Promise<TripCache> {
  try {
    const [pRaw, tRaw] = await Promise.all([
      AsyncStorage.getItem(PLACES_KEY(deviceId)),
      AsyncStorage.getItem(TRIPS_KEY(deviceId)),
    ]);
    return {
      places: pRaw ? (JSON.parse(pRaw) as SavedPlace[]) : [],
      trips:  tRaw ? (JSON.parse(tRaw) as PlannedTrip[]) : [],
    };
  } catch {
    return { places: [], trips: [] };
  }
}

/** Persist fresh places and trips to the cache. */
export async function saveCache(
  deviceId: string,
  places: SavedPlace[],
  trips: PlannedTrip[],
): Promise<void> {
  try {
    await Promise.all([
      AsyncStorage.setItem(PLACES_KEY(deviceId), JSON.stringify(places)),
      AsyncStorage.setItem(TRIPS_KEY(deviceId), JSON.stringify(trips)),
    ]);
  } catch {}
}

/** Load only the cached saved places for this device (used by drive/settings). */
export async function loadCachedPlaces(deviceId: string): Promise<SavedPlace[]> {
  try {
    const raw = await AsyncStorage.getItem(PLACES_KEY(deviceId));
    return raw ? (JSON.parse(raw) as SavedPlace[]) : [];
  } catch {
    return [];
  }
}

/** Update only the places slice of the cache (leaves trips untouched). */
export async function cachePlaces(deviceId: string, places: SavedPlace[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PLACES_KEY(deviceId), JSON.stringify(places));
  } catch {}
}

// ── Mutation queue ────────────────────────────────────────────────────────────

export type MutationOp =
  | { id: string; type: "create_place"; deviceId: string; tempId: string; payload: Parameters<typeof createSavedPlace>[1] }
  | { id: string; type: "update_place"; deviceId: string; placeId: string; payload: Parameters<typeof updateSavedPlace>[2] }
  | { id: string; type: "delete_place"; deviceId: string; placeId: string }
  | { id: string; type: "create_trip";  deviceId: string; tempId: string; payload: Parameters<typeof createPlannedTrip>[1] }
  | { id: string; type: "cancel_trip";  deviceId: string; tripId: string };

// ── Write lock ────────────────────────────────────────────────────────────────
// All queue read-modify-write operations are serialized through this lock.
// Network calls (createSavedPlace, etc.) happen OUTSIDE the lock.

let _queueLock: Promise<unknown> = Promise.resolve();

function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = _queueLock.then(fn, fn) as Promise<T>;
  _queueLock = result.catch(() => {});
  return result;
}

// ── Raw queue I/O (always call inside withQueueLock) ─────────────────────────

async function _readQueue(): Promise<MutationOp[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as MutationOp[]) : [];
  } catch {
    return [];
  }
}

async function _writeQueue(queue: MutationOp[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {}
}

// ── Public queue helpers ──────────────────────────────────────────────────────

/** Append an operation to the persistent mutation queue. */
export function enqueueWrite(op: MutationOp): Promise<void> {
  return withQueueLock(async () => {
    const q = await _readQueue();
    q.push(op);
    await _writeQueue(q);
  });
}

/** Load the full mutation queue (used to count pending ops). */
export async function loadQueue(): Promise<MutationOp[]> {
  // Read-only; safe to call without lock (reads are atomic in AsyncStorage)
  return _readQueue();
}

/** Remove a successfully-replayed operation from the queue by its op ID. */
function _clearQueuedOp(id: string): Promise<void> {
  return withQueueLock(async () => {
    const q = await _readQueue();
    await _writeQueue(q.filter((op) => op.id !== id));
  });
}

/**
 * Atomically rewrite dependent `create_trip` ops' `savedPlaceId` from `tempId`
 * to the real `serverId` obtained after a successful place create, then remove
 * the place create op from the queue in the same locked write.
 *
 * This is the critical step that makes the association survive partial-failure
 * retries: even if the trip create fails in this flush pass and remains queued,
 * the next flush finds the real server ID already written into the trip op.
 */
function _commitPlaceCreate(placeOpId: string, tempId: string, serverId: string): Promise<void> {
  return withQueueLock(async () => {
    const q = await _readQueue();
    const updated = q
      .filter((op) => op.id !== placeOpId) // remove the place create op
      .map((op) => {
        if (op.type === "create_trip" && op.payload.savedPlaceId === tempId) {
          return { ...op, payload: { ...op.payload, savedPlaceId: serverId } };
        }
        return op;
      });
    await _writeQueue(updated);
  });
}

/**
 * Cancel the queued create for a temp item that was deleted while offline.
 * Also removes dependent update/trip-create ops that referenced the same tempId.
 *
 * Returns the list of cancelled trip tempIds so the caller can reconcile local
 * state (remove those trips from UI and cache).
 */
export function cancelQueuedCreate(
  tempId: string,
  deviceId: string,
): Promise<{ cancelledTripTempIds: string[] }> {
  return withQueueLock(async () => {
    const q = await _readQueue();
    const cancelledTripTempIds: string[] = [];

    const filtered = q.filter((op) => {
      if ((op.type === "create_place" || op.type === "create_trip") && op.tempId === tempId) return false;
      if (op.type === "update_place" && op.placeId === tempId) return false;
      if (op.type === "create_trip" && op.payload.savedPlaceId === tempId) {
        cancelledTripTempIds.push(op.tempId);
        return false;
      }
      return true;
    });

    await _writeQueue(filtered);
    return { cancelledTripTempIds };
  });
}

/**
 * Merge edits into an existing pending create op (so editing an offline-created
 * item produces one coalesced create — not a create + update with a stale temp ID).
 * Falls back to enqueuing a normal update if no matching create op exists.
 */
export function mergeIntoQueuedCreate(
  tempId: string,
  deviceId: string,
  placeId: string,
  patch: Parameters<typeof updateSavedPlace>[2],
): Promise<void> {
  return withQueueLock(async () => {
    const q = await _readQueue();
    let merged = false;
    const updated = q.map((op) => {
      if (op.type === "create_place" && op.tempId === tempId && op.deviceId === deviceId) {
        merged = true;
        return { ...op, payload: { ...op.payload, ...patch } };
      }
      return op;
    });

    if (merged) {
      await _writeQueue(updated);
    } else {
      // Fallback: create was already flushed — append a normal update
      q.push({
        id: `${Date.now()}-${Math.random()}`,
        type: "update_place",
        deviceId,
        placeId,
        payload: patch,
      });
      await _writeQueue(q);
    }
  });
}

// ── Flush mutex ───────────────────────────────────────────────────────────────
// Prevents concurrent replay passes. A new call to flushQueue while a flush is
// already running will wait for it to finish and then run its own pass.

let _flushMutex: Promise<unknown> = Promise.resolve();

// ── Flush ─────────────────────────────────────────────────────────────────────

/**
 * Replay all queued operations for a given deviceId in order.
 *
 * Concurrency safety:
 *   • Only one flush runs at a time (flush mutex).
 *   • Before each network call, the current op is re-fetched through the write
 *     lock so user edits/cancels that arrived during the previous call are
 *     always picked up. If the op is gone (cancelled), it is skipped.
 *   • Network calls happen outside any lock so user mutations are never blocked.
 *
 * Dependency-awareness:
 *   • When a `create_place` succeeds, `_commitPlaceCreate` atomically rewrites
 *     dependent trip ops' savedPlaceId to the real server ID and removes the
 *     place op — all in one locked write.
 *   • When a `create_place` fails, its tempId is tracked and all dependent
 *     `create_trip` ops are deferred (left queued) for the next reconnect.
 *
 * Returns true if the queue is now fully empty for this device.
 */
export function flushQueue(deviceId: string): Promise<boolean> {
  const result = (_flushMutex.then(
    () => _flushImpl(deviceId),
    () => _flushImpl(deviceId),
  ) as Promise<boolean>);
  _flushMutex = result.catch(() => {});
  return result;
}

async function _flushImpl(deviceId: string): Promise<boolean> {
  // Read the initial snapshot to know which op IDs to iterate over this pass.
  // We use withQueueLock here so we see any writes that were in-flight at call time.
  const snapshot = await withQueueLock(() => _readQueue());
  const mine = snapshot.filter((op) => op.deviceId === deviceId);
  if (mine.length === 0) return true;

  // Temp IDs of place creates that failed this pass — dependent trips are deferred
  const failedPlaceTempIds = new Set<string>();

  for (const snap of mine) {
    // Re-read the op through the write lock immediately before the network call.
    // This picks up any edits (mergeIntoQueuedCreate) or cancels (cancelQueuedCreate)
    // that arrived while the previous operation's network call was in flight.
    const currentOp = await withQueueLock(async () => {
      const q = await _readQueue();
      return q.find((op) => op.id === snap.id) ?? null;
    });

    // Op was cancelled or already processed — skip
    if (!currentOp) continue;

    // Deferred: this trip's place dependency failed this pass
    if (
      currentOp.type === "create_trip" &&
      currentOp.payload.savedPlaceId &&
      failedPlaceTempIds.has(currentOp.payload.savedPlaceId)
    ) continue;

    // Deferred: trip still references an unresolved temp place ID
    // (the place create hasn't run yet in this pass — process in order)
    if (
      currentOp.type === "create_trip" &&
      currentOp.payload.savedPlaceId?.startsWith("offline-")
    ) continue;

    try {
      switch (currentOp.type) {
        case "create_place": {
          // Network call outside the lock
          const created = await createSavedPlace(currentOp.deviceId, currentOp.payload);
          // Atomically rewrite dependent trip ops + remove this op in one locked write
          await _commitPlaceCreate(currentOp.id, currentOp.tempId, created.id);
          continue; // _commitPlaceCreate already removed the op
        }
        case "update_place": {
          await updateSavedPlace(currentOp.deviceId, currentOp.placeId, currentOp.payload);
          break;
        }
        case "delete_place": {
          await deleteSavedPlace(currentOp.deviceId, currentOp.placeId).catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes("404") || msg.includes("not found")) return;
            throw e;
          });
          break;
        }
        case "create_trip": {
          await createPlannedTrip(currentOp.deviceId, currentOp.payload);
          break;
        }
        case "cancel_trip": {
          await deletePlannedTrip(currentOp.deviceId, currentOp.tripId).catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes("404") || msg.includes("not found")) return;
            throw e;
          });
          break;
        }
      }
      // Op succeeded — remove from persistent queue (locked)
      await _clearQueuedOp(currentOp.id);
    } catch {
      // Op failed — track failed place creates so dependent trips are deferred
      if (currentOp.type === "create_place") {
        failedPlaceTempIds.add(currentOp.tempId);
      }
      // Leave failed op in queue for next retry
    }
  }

  const remaining = await withQueueLock(() => _readQueue());
  return remaining.filter((op) => op.deviceId === deviceId).length === 0;
}
