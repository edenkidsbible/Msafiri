---
name: Per-vehicle data isolation architecture
description: How all driving data domains (sessions, dashcam, accidents) are scoped to the active vehicle
---

# Per-Vehicle Data Isolation

## Rule
All app data domains are scoped to the active vehicle. Switching vehicles in the garage swipe changes what every screen shows.

**Why:** User explicitly asked for complete data isolation between vehicles — "a whole new dataset and stats for that app, completely."

## How to apply

### VehicleContext (`artifacts/mobile/context/VehicleContext.tsx`)
- The single source of truth for `activeVehicleId` and `vehicles` list
- Wrapped above AppProvider and DashcamProvider in `_layout.tsx`
- `setActiveVehicle(id)` → persists to AsyncStorage (`msafiri_active_vehicle_id_v1`)
- `refreshVehicles()` → call after any add/remove/edit in garage

### Garage swipe drives VehicleContext
- `garage.tsx` calls `setActiveVehicle` on every swipe AND dot-tap
- Also calls `refreshVehicles()` after add/remove/set-default operations

### Dashcam clips — per-vehicle AsyncStorage + filesystem
- Keys: `dashcam_segments_${vehicleKey}` and `dashcam/segments/${vehicleKey}/`
- `vehicleKey = activeVehicleId ?? "default"`
- DashcamContext calls `useVehicle()` directly (VehicleProvider is an ancestor)
- On vehicle switch: ref-based reload effect re-runs; segments reset and reload
- **Migration**: on first load with empty vehicle key, falls back to `dashcam_segments_v1` (old key) and migrates it — clears legacy key after

### Drive sessions — server-side vehicleId
- `live_trips` table has nullable `vehicle_id` column (added via ALTER TABLE in migrateSchema.ts)
- `startDriveSession()` accepts optional `vehicleId`; drive.tsx passes `driveVehicleRef.current?.id`
- Local `vehicleSessionMap` still used for backward-compat filtering (existing sessions have NULL vehicle_id)
- Default vehicle gets all NULL sessions as catch-all via vehicleSessionMap

### Accident reports — server-side vehicleId
- `accident_records` table has nullable `vehicle_id` column
- API POST /accidents accepts `vehicleId`; set from AppContext crash detection (`activeVehicleIdRef`) and manual creation in accident-reports screen
- API GET /accidents: optional `vehicleId` filter + `includeUnattributed=true` for default vehicle (shows NULL rows too)
- `accident-reports.tsx` uses VehicleContext for initial vehicle selection; passes vehicleId in load URL

### Backward compatibility
- All vehicle_id columns are nullable — existing rows are unattributed (treated as default vehicle)
- Default vehicle uses `includeUnattributed=true` to show legacy records
- First vehicle always has id `"v0"` (seeded from AppContext); dashcam migration targets this

## Key files
- `artifacts/mobile/context/VehicleContext.tsx` — new shared context
- `artifacts/mobile/context/DashcamContext.tsx` — vehicle-scoped keys
- `artifacts/mobile/context/AppContext.tsx` — activeVehicleIdRef for accident creation
- `artifacts/mobile/app/(tabs)/garage.tsx` — setActiveVehicle on swipe
- `artifacts/mobile/app/accident-reports.tsx` — VehicleContext for vehicle selection
- `artifacts/mobile/utils/driveSessionApi.ts` — vehicleId param on startDriveSession
- `artifacts/api-server/src/routes/liveTrips.ts` — vehicle_id in INSERT
- `artifacts/api-server/src/routes/accidents.ts` — vehicleId in POST + GET filter
- `artifacts/api-server/src/startup/migrateSchema.ts` — ALTER TABLE for both tables
- `lib/db/src/schema/accidents.ts` — vehicleId field in Drizzle schema
