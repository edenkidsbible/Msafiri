---
name: Garage offline caching pattern
description: How drive sessions and shared vehicle stats are cached for offline use in the Garage screen.
---

## Cache keys
- Sessions per vehicle: `msafiri_sessions_v1_${vehicleId}` (JSON array of DriveSession)
- Shared vehicle stats: `msafiri_shared_stats_v1_${sharedId}` (JSON object with totalDistM, totalDurS, totalTrips)

## Pattern: stale-while-revalidate
1. On vehicle slide change, load cache immediately → display stale data right away (no flash of zeros).
2. If `isOffline`, skip the network fetch; cached data is all we have.
3. If online, fetch fresh data → update state AND write back to cache.
4. `isOffline` is in the `useEffect` deps array → when it flips false (back online), the effect re-runs and immediately fetches fresh data. No separate reconnect handler needed.

## Offline UI indicator
`isOffline && <View style={styles.offlineBanner}>...</View>` shown between the header and the vehicle carousel.

## What's already offline-capable (no additional work needed)
- Vehicles list: VehicleContext reads from AsyncStorage (savedVehicles.ts).
- Community reports: AppContext persists them to KEYS.REPORTS on every update.
- Speed zones: AppContext caches dbZones + suppressedStaticIds in sdk_zone_overrides_v2.
- Trip history (local AppContext trips): AppContext persists to KEYS.TRIPS after each trip ends.
- Vehicle care data: loadVehicleCareData / getCareStorageKey reads from AsyncStorage.

## What remains NOT cached (acceptable trade-offs)
- Planned trips — low priority, planning rarely done offline.
- HERE traffic incidents — transient data, stale incidents are misleading.
- Join requests — auth-gated; showing stale pending requests could confuse the UX.
