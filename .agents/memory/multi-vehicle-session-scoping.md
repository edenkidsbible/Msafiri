---
name: Multi-vehicle session scoping
description: How per-vehicle garage stats are derived when DriveSession has no vehicleId server-side
---

## Rule
Drive sessions (`/drive-sessions`) carry only `deviceId` — no `vehicleId` column exists on the server. Per-vehicle garage stats are bridged locally via `utils/vehicleSessionMap.ts`, which stores `vehicleId → sessionId[]` in AsyncStorage.

**Why:** Adding a `vehicleId` column to the server DB would require a migration and API change. The local map is a zero-migration solution that degrades gracefully — if a session was created before this feature existed, it has no map entry and falls through to the default-vehicle catch-all.

## How to apply
- `recordSession(vehicleId, sessionId)` — call fire-and-forget after `startDriveSession()` resolves in drive.tsx.
- `getSessionsForVehicle(vehicleId, defaultVehicleId, allSessions)` — call in garage.tsx useEffect when `sessions`, `vehicles`, or `slideIndex` changes.
- Default vehicle (isDefault: true) acts as catch-all: receives all sessions not explicitly assigned to another vehicle.
- If a session map entry is missing (old sessions, API failure, offline), the default vehicle absorbs it — stats never silently disappear.

## Vehicle picker in drive.tsx
- Vehicles loaded in a `useEffect` on mount; stored in both state (`driveVehicles`) and a stable ref (`driveVehiclesRef`) for the `useFocusEffect` closure.
- Auto-start intercept: if `driveVehiclesRef.current.length > 1`, set `showVehiclePicker = true` instead of calling `startTrip()`.
- Picker modal calls `startTrip()` after setting `driveVehicleRef.current` to the chosen vehicle.
- `driveVehicleRef` is reset to the default vehicle when `tripActive` goes false (trip ends) so the next trip gets a fresh pick.
