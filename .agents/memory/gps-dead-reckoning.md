---
name: GPS dead reckoning pattern
description: How signal-loss detection and dead reckoning work in AppContext during navigation
---

## The rule
When navigation is active and GPS fixes stop arriving for >5 s, set `gpsLost`/`gpsLostRef` and start projecting position forward using last known speed + heading, for up to 15 s. After 15 s, freeze (don't keep projecting — error compounds too fast).

## State/refs involved
- `gpsLost` (React state) — drives the UI indicator in the drive HUD
- `gpsLostRef` (ref) — read inside interval callbacks; must always mirror `gpsLost`
- `gpsLostSinceRef` — timestamp when loss started; used for the 15 s cap
- `lastNavFixAtRef` — updated on each real fix while `navActiveRef.current`; gap detection uses `Date.now() - lastNavFixAtRef.current > 5000`
- `lastHeadingRef` — last real heading from `driverHeadingDeg()`
- `drStateRef` — `{ lat, lng, speedMps, heading }` from the last real fix

## Integration points
1. **`handleLocation` top**: stamp `lastNavFixAtRef`, clear `gpsLostRef`/`setGpsLost(false)` on real fix arrival
2. **`handleLocation` after heading**: update `drStateRef` and `lastHeadingRef`
3. **Off-route detection**: gate with `&& !gpsLostRef.current` — projected position never counts as off-route
4. **Dead reckoning interval** (`useEffect`, 1 s tick): detects loss, advances `setCurrentLat`/`setCurrentLng` from drStateRef — `currentRouteDistanceM` useMemo then naturally updates `distanceRemainingM`/`durationRemainingS`

## Why calling setCurrentLat/setCurrentLng from interval works
`currentRouteDistanceM` is a `useMemo` that depends on `currentLat`/`currentLng`. Pushing dead reckoned coords into state naturally propagates through the existing pipeline: `distanceRemainingM → durationRemainingS → ETA display`. No additional state needed.

**Why:** The alternative (a separate `deadReckonedDistanceM` state) would require duplicating all the downstream useMemos and display logic.
