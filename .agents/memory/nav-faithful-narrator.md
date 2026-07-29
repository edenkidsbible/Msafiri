---
name: Phase 1 Faithful Narrator — navigation voice overhaul
description: What was built and the durable design rules for the along-road voice cue engine.
---

## What was built (Phase 1 — all OTA-shippable)

### RouteStep / AppRoute shape changes
- `RouteStep` gains `maneuverType: string`, `roadName: string`, `stepAlongRouteM: number`
- `AppRoute` gains `cumDist: number[]`
- All populated in `fetchOSRM` — cumDist built from coords, then each step's location is projected onto the polyline to get `stepAlongRouteM`

### Along-road distance replaces straight-line haversine
`stepAlongRouteM - driverAlongM` (computed fresh each GPS tick in `handleLocation` using route.cumDist + windowed `projectOntoRoute`) is the cue trigger distance.  Falls back to haversine when cumDist absent.  Fixes early/late signals on curves.

**Why:** straight-line from driver GPS to maneuver point reads much shorter on a tight bend than the actual road distance remaining.

### Three-cue gating discipline
- ANNOUNCE: fires freely (far from junction; previous cues are done)
- REMIND: gated on `!isNavVoicePlaying()` — waits for ANNOUNCE clip to finish before firing.  Without this, rapid GPS ticks while ANNOUNCE plays would kill it mid-sentence.
- NOW: always preempts — driver is at the junction and needs the word immediately.

### Compound instructions
When `step.distanceM < 100` (current leg < 100 m before next maneuver):
- ANNOUNCE: "Turn left onto X, then turn right onto Y"
- REMIND: "Turn left onto X, then turn right"
- NOW: just "Turn left" (single junction word, driver is executing it)

### Post-turn confirmation
After each step advances (driver passes maneuver point), speak "Continue on [roadName]" if:
- road is named, next leg ≥ 250 m, next step isn't arrive, and voice isn't currently playing
Gives the driver confirmation they turned correctly, then goes silent until next decision point.

### U-turn detection
`buildInstruction` now handles `maneuver.type === "uturn"` AND `maneuver.type === "turn" + modifier === "uturn"` → "Make a U-turn [onto X]".

### Post-reroute grace period
`rerouteGraceUntilRef` set to `Date.now() + 10_000` when reroute triggers; off-route detection skips while `Date.now() < rerouteGraceUntilRef`.  Prevents reroute loops at complex junctions.

### tts.ts hardening
- `isNavVoicePlaying()` exported — `activePlayer !== null`
- expo-speech fallback removed; road-name segment silently skipped on persistent cache miss (Keli maneuver token still plays without road name)
- `resolveRawClip` retries 3× with 1 s back-off before returning null

## What Phase 2 still needs
- Bundled ~120-clip fixed Keli vocabulary shipped in app
- Route-start pre-fetch of all full-sentence clips ("Preparing voice guidance" spinner)
- Reroute flow using bundled "Rerouting" clip + priority-ordered clip fetch
