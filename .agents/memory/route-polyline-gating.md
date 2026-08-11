---
name: Route polyline gating rule
description: Where and how route polylines are conditionally rendered in the mobile app.
---

## Rule
Route polylines (blue route, alt routes) only appear during an **active trip**. Never in preview/pre-start mode.

## Implementation

### MapViewScreen.native.tsx (home/browse map tab)
- Both `altRoutes.map(...)` and `{activeRoute && <Polyline>}` are gated on `navTripActive` from `useApp()`.
- `navTripActive` is set to `true` by `setNavTripActive(true)` inside `startTrip()` in drive.tsx.
- Result: the browse map never shows a blue route line, even when a destination is set.

### DriveMapView.native.tsx (drive screen map)
- Alt routes: `{!tripMode && altRouteSegs.map(...)}` — hidden immediately when trip starts.
- Active route: converted from ternary to `&&` — `{tripMode && activeRoute && ... && (...)}` — the preview branch was removed entirely.
- `tripMode` prop = local `tripActive` state from drive.tsx.
- Result: before Start, no polyline; after Start, green (covered) + blue (ahead) split only.

## What NOT to do
- Do NOT render a preview polyline in DriveMapView's non-tripMode branch — it caused the blue line to linger on the home map and persist through alt-route selection.
- Do NOT gate polylines on `navDestination` alone — a destination can be set long before the driver taps Start.
- Do NOT use a ternary `? trips-branch : preview-branch` in DriveMapView for the route polyline — just use `&&`.
