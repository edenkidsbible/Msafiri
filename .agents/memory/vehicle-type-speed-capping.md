---
name: Vehicle-type speed limit capping
description: Which speedLimit values get capped by vehicle class vs shown raw
---

The app lets a user pick a vehicle type (car/psv/bus/truck/motorcycle/tractor) with town/highway limit caps. `capSpeedLimit(postedLimit, vehicleDef)` applies `min(posted, vehicleDef.townLimit or highwayLimit)` based on whether postedLimit <= 50.

**Rule:** Cap a speedLimit value whenever it's being *displayed back to the user as "the limit that applies to you"* — route panels, map zone markers, current-speed display, voice/visual alerts. Do NOT cap a community report's own `speedLimit` field when it represents the actual posted/reported limit being submitted or corrected by a user (e.g. "My Reports" list, report creation form) — that's raw ground truth, not a personalized view.

**Why:** Conflating the two would let a heavy-vehicle cap silently alter what a user reported as the real posted limit, corrupting community data.

**How to apply:** Any new screen/component that reads `SpeedZone.speedLimit` or a community report's camera-type `speedLimit` for *display* should pull `vehicleType` from `useApp()`, compute `getVehicleTypeDef(vehicleType)`, and run it through `capSpeedLimit`. Search for all importers of `@/data/speedZones` (`SPEED_ZONES`) when auditing — each consumer needs its own capping applied, it does not propagate automatically.
