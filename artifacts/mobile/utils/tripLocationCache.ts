/**
 * tripLocationCache.ts — AsyncStorage cache for reverse-geocoded trip endpoint names.
 *
 * Key: "msafiri_trip_locations_v1"
 * Value: JSON map of { [sessionId]: { from: string; to: string } }
 *
 * The trip-detail screen populates entries when a session first loads.
 * Trip history and garage screens read from this cache to display real
 * place names (e.g. "Westlands → CBD") instead of generic labels.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const CACHE_KEY = "msafiri_trip_locations_v1";

export interface TripLocation {
  from: string;
  to: string;
}

export type TripLocationMap = Record<string, TripLocation>;

/** Load the entire cache from AsyncStorage. Returns an empty object on error. */
export async function loadTripLocationCache(): Promise<TripLocationMap> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as TripLocationMap) : {};
  } catch {
    return {};
  }
}

/** Persist a single session's location names into the cache. */
export async function saveTripLocation(
  sessionId: string,
  loc: TripLocation,
): Promise<void> {
  try {
    const cache = await loadTripLocationCache();
    cache[sessionId] = loc;
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

/** Look up a single session's cached location names. Returns null if not cached. */
export async function getTripLocation(
  sessionId: string,
): Promise<TripLocation | null> {
  const cache = await loadTripLocationCache();
  return cache[sessionId] ?? null;
}
