/**
 * dashcamLocationCache.ts — AsyncStorage cache for reverse-geocoded dashcam clip location names.
 *
 * Key: "msafiri_dashcam_locations_v1"
 * Value: JSON map of { [clipId]: { name: string; resolvedAt: number } }
 *
 * Limits:
 *  - Max 500 entries (oldest by resolvedAt are evicted when the cap is hit)
 *  - 90-day TTL (stale entries are dropped on every load)
 *
 * This mirrors the pattern in utils/tripLocationCache.ts, but uses a single
 * consolidated key rather than one key per clip to minimise AsyncStorage I/O.
 *
 * Write serialization:
 *  All mutations run through a serial promise chain (_writeChain) so concurrent
 *  calls never clobber each other on the single shared AsyncStorage document.
 *  An in-memory singleton (_mem) avoids redundant AsyncStorage reads once the
 *  cache is warm.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const CACHE_KEY  = "msafiri_dashcam_locations_v1";
const MAX_ENTRIES = 500;
const TTL_MS      = 90 * 24 * 60 * 60 * 1000; // 90 days

interface CacheEntry {
  name: string;
  resolvedAt: number;
}

type RawCache = Record<string, CacheEntry>;

// ── In-memory singleton ──────────────────────────────────────────────────────
// Populated on first load; kept in sync by every write so future reads can
// skip AsyncStorage entirely.
let _mem: RawCache | null = null;

// Serial write queue — all mutations enqueue here to prevent read-modify-write races.
let _writeChain: Promise<void> = Promise.resolve();

// ── Internal helpers ─────────────────────────────────────────────────────────

function pruneExpired(cache: RawCache): RawCache {
  const cutoff = Date.now() - TTL_MS;
  const out: RawCache = {};
  for (const [id, entry] of Object.entries(cache)) {
    if (entry.resolvedAt >= cutoff) out[id] = entry;
  }
  return out;
}

function evictOldest(cache: RawCache): RawCache {
  const entries = Object.entries(cache);
  if (entries.length <= MAX_ENTRIES) return cache;
  entries.sort((a, b) => a[1].resolvedAt - b[1].resolvedAt);
  const keep = entries.slice(entries.length - MAX_ENTRIES);
  const out: RawCache = {};
  for (const [id, entry] of keep) out[id] = entry;
  return out;
}

/** Load from AsyncStorage (once) and warm the in-memory singleton. */
async function ensureLoaded(): Promise<RawCache> {
  if (_mem !== null) return _mem;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    _mem = raw ? pruneExpired(JSON.parse(raw) as RawCache) : {};
  } catch {
    _mem = {};
  }
  return _mem;
}

/** Persist the in-memory singleton to AsyncStorage. */
async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(_mem ?? {}));
  } catch {}
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load the full cache and return it as a simple id→name map.
 * Safe to call from any context — uses the in-memory singleton after the first load.
 */
export async function loadDashcamLocationCache(): Promise<Record<string, string>> {
  const raw = await ensureLoaded();
  const out: Record<string, string> = {};
  for (const [id, entry] of Object.entries(raw)) {
    out[id] = entry.name;
  }
  return out;
}

/**
 * Save a single clip's resolved location name.
 * Writes are serialized through _writeChain so concurrent callers never race.
 */
export function saveDashcamLocationName(clipId: string, name: string): Promise<void> {
  _writeChain = _writeChain.then(async () => {
    const cache = await ensureLoaded();
    cache[clipId] = { name, resolvedAt: Date.now() };
    _mem = evictOldest(cache);
    await persist();
  });
  return _writeChain;
}

/**
 * Remove entries for clip IDs that no longer exist on this device.
 *
 * IMPORTANT: only call this after receiving an authoritative, complete clip
 * list from the server (i.e. after a successful fetchServerClips).  Never
 * pass an empty or partial list — doing so would purge valid cached names
 * for clips that simply haven't loaded yet.
 *
 * Writes are serialized through _writeChain so this cannot race with saves.
 */
export function purgeDashcamLocationCache(activeClipIds: string[]): Promise<void> {
  if (activeClipIds.length === 0) return Promise.resolve(); // safety guard
  _writeChain = _writeChain.then(async () => {
    const cache = await ensureLoaded();
    const activeSet = new Set(activeClipIds);
    let changed = false;
    for (const id of Object.keys(cache)) {
      if (!activeSet.has(id)) {
        delete cache[id];
        changed = true;
      }
    }
    if (changed) {
      _mem = cache;
      await persist();
    }
  });
  return _writeChain;
}
