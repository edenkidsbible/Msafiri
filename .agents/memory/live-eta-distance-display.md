---
name: Live ETA/distance-remaining display locations
description: Where "distance & time remaining to destination" must be wired up when adding/changing live navigation stats in the mobile app.
---

`distanceRemainingM`/`durationRemainingS` (derived from `currentRouteDistanceM`, a route-projection memo keyed off `currentLat/currentLng`) live in `AppContext.tsx` and are exposed via `useApp()`. They recompute on every GPS fix, unlike `activeRoute.distanceM/durationS` which are static from the routing API call.

Two separate UI surfaces render route ETA/distance and both must be updated together, or one drifts back to a static, non-live value:
- `app/(tabs)/index.tsx` — the Drive-tab nav bar (used during active navigation, and reached by Browse-tab's POICard "Go" button via `router.push("/")`).
- `components/MapViewScreen.web.tsx` — the web-platform route panel (shown on the Map/Browse tab).

`components/MapViewScreen.native.tsx` (the on-device Map tab) currently has no route/ETA panel at all — "Go" everywhere routes through `index.tsx`, so that's the only native surface that needs this.

**Why:** distance/duration-remaining was silently missing from `MapViewScreen.web.tsx`'s route panel even after being added to the Drive-tab nav bar; found only by grepping for `durationS`/`distanceM` usages across `components/`.

**How to apply:** when changing how remaining distance/ETA is computed or displayed, grep for `durationS|distanceM|distToNextM|distanceRemainingM` across `artifacts/mobile` to find all render sites before considering the change complete.
