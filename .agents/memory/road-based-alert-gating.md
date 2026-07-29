---
name: Road-based alert gating
description: How drive alerts (overlay + voice) decide whether to fire — road-name match replaced heading-degree cones.
---

# Road-based alert gating

## The rule
Fire a drive alert only when the driver is moving (`isDriving`) + within 1 km + on the same road as the incident. `roadsMatch()` returns **true** when either road name is absent → distance-only fallback (never silently drop).

## How road name is resolved
- **During navigation**: `routeRef.current.steps[stepIdxRef.current]?.roadName` — comes from Google Routes API, always fresh, zero extra calls.
- **Outside navigation**: `getRoadName(lat, lng)` (server → Google Geocoding API), throttled to at most once per 500 m **or** 60 s. Result stored in `currentRoadRef.current`.

## `roadsMatch()` normalisation
Strips parenthetical codes `(A2)`, road-type words (road/highway/way/bypass…), punctuation, extra spaces — then checks exact match or substring inclusion. Handles "Thika Superhighway (A2)" ↔ "Thika Road" and "A104 (Eldoret–Nakuru)" ↔ "A104 Highway".

## Dismissal
The old >75° heading check is replaced by: if `currentRoadRef.current` and the incident's road are both known and `roadsMatch()` returns false → dismiss. The existing "2 consecutive increasing distances" passed-it check is kept alongside this.

**Why:** Heading cones produced false alerts on parallel roads and silently dropped genuine alerts on bends where bearing diverged from heading direction.

## Known gap
First 500 m of a non-navigating trip uses distance-only fallback (road not yet resolved). A proposed follow-up tracks warming up road detection immediately on driving start.
