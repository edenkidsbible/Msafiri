import AsyncStorage from "@react-native-async-storage/async-storage";
import { GeoResult } from "@/utils/geocoding";

const STORAGE_KEY = "recent_destinations";
const MAX_RECENTS = 10;

export async function loadRecentSearches(): Promise<GeoResult[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as GeoResult[];
  } catch {
    return [];
  }
}

export async function saveRecentSearch(item: GeoResult): Promise<GeoResult[]> {
  try {
    const existing = await loadRecentSearches();
    // Deduplicate by display name (case-insensitive) — drop any prior entry for same place
    const deduped = existing.filter(
      (r) => r.display.toLowerCase() !== item.display.toLowerCase()
    );
    // Prepend newest, cap at MAX_RECENTS
    const updated = [item, ...deduped].slice(0, MAX_RECENTS);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export async function removeRecentSearch(item: GeoResult): Promise<GeoResult[]> {
  try {
    const existing = await loadRecentSearches();
    const updated = existing.filter(
      (r) => r.display.toLowerCase() !== item.display.toLowerCase()
    );
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export async function clearRecentSearches(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
