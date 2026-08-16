---
name: Live odometer architecture
description: How liveOdometerKm in AppContext works; why the garage previously showed stale values; what triggers odoBaseKm updates.
---

## The rule
Never let UI components reload car-care storage themselves to get the odometer — they'll race the async `updateTripOdometer()` write and see stale data. Read `liveOdometerKm` from AppContext instead.

**Why:** `setTripHistory()` is synchronous; it flushes to React state immediately and any `useEffect` that depends on `tripHistory.length` fires before the async `updateTripOdometer()` write completes. The garage was doing exactly this: reloading care storage inside a `tripHistory.length`-dep effect → always seeing the old total.

## Architecture
- `odoBaseKm` (private state in AppContext) = committed total from care storage for the active vehicle.
- `liveOdometerKm` (exposed in context value) = `odoBaseKm + (currentTrip?.distance ?? 0) / 1000`.
  - While driving: ticks up every ~4 s as `currentTrip` updates.
  - Between drives: equals the stored total.

## When odoBaseKm is updated
1. On mount + when `_activeVehicleId` changes: load from care storage for that vehicle.
2. After full-trip completion: inside the `loadVehicles().then(async …)` block, after `updateTripOdometer()` resolves → `setOdoBaseKm(est)`.
3. After short-trip completion: same pattern.
4. After continuous-odometer flush (every 100 m or 60 s while app is open without a trip): after `updateTripOdometer()` resolves → `setOdoBaseKm(est)`.
5. After background-odometer `creditOdometerKm()`: after `updateTripOdometer()` resolves → `setOdoBaseKm(est)`.

## How to apply
- Garage, trip-history, dashcam-videos: destructure `liveOdometerKm` from `useApp()` — no local care-storage load needed.
- manage-vehicles.tsx: loads care data per-vehicle in a list (different vehicle IDs) — must load individually; cannot use the single context value.
- Never add `tripHistory.length` to effect deps as an odometer-reload trigger — the race is back if you do.
- Drivers with no initial odometer: `odoBaseKm` = 0 + accumulated trip km, so `liveOdometerKm` correctly shows just the trip total.
