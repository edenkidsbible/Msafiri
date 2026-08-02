---
name: Navigation crash root causes and fixes
description: Three compounding reasons active navigation crashed/exited the app, and the fixes applied.
---

# Navigation crash root causes and fixes

## The three crash paths

### 1. O(N) haversine scan in the render body (PRIMARY)
`DriveMapView.native.tsx` computed `navAheadStartIdx` in the **render function body** (not a useMemo). During navigation `setCurrentLat/setCurrentLng` fires at 1 Hz, triggering a re-render → a full loop over all route coords → haversine on every point. For a 50 km urban route ≈ 600 points; with 3–5 renders/s from other setState calls in the tick = 1,800–3,000 haversine calls/s blocking the JS thread → iOS watchdog / Android ANR hard kill.

**Fix**: moved to a `useMemo([navigationActive, activeRoute, currentLat, currentLng])` with a windowed O(40) search. A `navProjIdxRef` (useRef) tracks the cursor; full O(N) scan only runs on route start or when windowed result is >200 m away (reroute/GPS teleport). `lastRouteIdRef` resets the cursor on route change.

### 2. `setNearbyZones` on every GPS tick (SECONDARY)
`handleLocation` called `.map()` on all 111+ zones every second and called `setNearbyZones` unconditionally, creating 111+ new objects/s and flooding the React render queue.

**Fix**: added `lastNearbyZonesKeyRef` (ID + 50 m bucket fingerprint); only calls `setNearbyZones` when the set actually changes.

### 3. `routeIncidents` useMemo doing O(zones × routeLen) on every report poll (TERTIARY)
The single `routeIncidents` useMemo depended on `communityReports` (polled every 20 s during nav). Each poll triggered `projectOntoRoute` for all 111 static zones × full route scan = ~66,000 haversine calls in one synchronous block → freezes JS thread for 100–200 ms on slow phones.

**Fix**: split into two memos:
- `projectedZonesOnRoute` — depends on `[activeRoute, routeCumDist, allZones]` only → runs once per route start, not every 20 s.
- `routeIncidents` — depends on `[projectedZonesOnRoute, communityReports, hereIncidents, vehicleType, ...]` → community reports still trigger a scan but zone projections are pre-cached.

## Smaller fixes applied simultaneously
- `setDistToNextM` guarded with value equality (`roundedDist !== distToNextMRef.current`) — avoids re-render when the driver is stationary.
- `setCurrentTrip` throttled to once every 4 s — the `tripRef` always holds live data for the final summary; state updates were unnecessary at 1 Hz.

## How to apply
Any new O(N) loop added to the render body or to a useMemo that depends on `currentLat/currentLng` will reintroduce the crash. Rule: **never put haversine loops in the render body; always useMemo with dep arrays that don't include continuously-updating values unless the computation is O(1) or O(window)**.

`routeCumDist` + `projectOntoRoute` for static datasets (cameras, zones) must be cached by route ID and never re-projected just because live data (reports, HERE incidents) changed.
