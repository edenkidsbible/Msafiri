---
name: Live Trip mode architecture
description: Replaces the old turn-by-turn nav with a lightweight trip tracker; no AppContext nav machinery involved.
---

## Rule
`startNavigation()` / `navigationActive` are NEVER called from the drive screen. The "Start" button now calls local `startTrip()` which sets `tripActive = true` (local state in index.tsx only).

**Why:** The old nav crashed the app (step-tracking, off-route detection, voice guidance, rerouting, background nav task). Live Trip gives the driver polyline + alerts + stats with none of that complexity.

## How to apply
- `tripActive` — local state in `index.tsx`. NOT in AppContext.
- `stopNavigation("manual")` is still called by `clearDestination` to clear `activeRoute`.
- `navigationActive` stays in AppContext but is never set true from the drive screen (still destructured, some dead effects reference it but they never fire).
- Gate search bar, FABs on `!tripActive` (not `!navigationActive`).
- `isMapMode = hasRoute && !showResults` (no `|| navigationActive`).
- `DriveMapView` receives `tripMode={tripActive}` prop — switches to green/blue split polyline + red dot destination marker; suppresses divergence routes and faster-route preview.
- Live Trip UI: header bar (< | Live Trip | End Trip) + info card (top, absolute) + bottom sheet with Share Link / Trip Details stats / Report Incident + SOS.
- Avg speed tracked via `useEffect` accumulating `currentSpeed` into `avgSpeedSumRef / avgSpeedCountRef` while `tripActive`.
- DriveAlertOverlay and pauseNote bottom now key off `liveTripSheetHeight` instead of `navBarHeight`.
