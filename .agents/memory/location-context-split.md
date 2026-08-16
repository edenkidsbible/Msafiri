---
name: LocationContext split & memoized AppContext value
description: How GPS state was isolated from the monolithic AppContext to stop app-wide re-renders on GPS ticks
---

**Rule:** currentLat/currentLng/currentSpeed/driverHeading live in the narrow `LocationContext` (`useLiveLocation()`), NOT in `useApp()`. The main AppContext value is a `useMemo` with an explicit dependency list.

**Why:** GPS setState re-renders AppProvider; without memoization the rebuilt value object re-rendered all 60+ `useApp()` consumers every fix — the primary CPU heat source.

**How to apply:** When adding a new field to the AppContext value, you MUST also add its state/value to the useMemo dependency array at the bottom of AppContext.tsx, or the field silently goes stale for consumers. High-frequency values (per-GPS-tick) belong in LocationContext (or a ref like gpsLastFixAtRef), never in the memoized app value.
