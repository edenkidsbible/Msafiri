---
name: Road-based alert gating
description: How drive alerts (overlay + voice) decide whether to fire — road-name match replaced heading-degree cones.
---

# Road-based alert gating

## The rule
Fire a road-tagged drive alert only when the driver is moving, approaching the incident, and the resolved current road matches. Unknown road identity must not admit road-tagged alerts; only explicitly untagged legacy entries use distance/direction fallback.

## How road name is resolved
- **During navigation**: `routeRef.current.steps[stepIdxRef.current]?.roadName` — comes from Google Routes API, always fresh, zero extra calls.
- **Outside navigation**: resolve frequently enough to catch turns and suppress road-tagged alerts while a resolution request is pending.
- **Background**: refresh the road from the background GPS fix when cached context is stale or too far from the current position.

## `roadsMatch()` normalisation
Strips parenthetical codes `(A2)`, road-type words (road/highway/way/bypass…), punctuation, extra spaces — then checks exact match or substring inclusion. Handles "Thika Superhighway (A2)" ↔ "Thika Road" and "A104 (Eldoret–Nakuru)" ↔ "A104 Highway".

## Dismissal
The old >75° heading check is replaced by: if `currentRoadRef.current` and the incident's road are both known and `roadsMatch()` returns false → dismiss. The existing "2 consecutive increasing distances" passed-it check is kept alongside this.

**Why:** Heading cones produced false alerts on parallel roads and silently dropped genuine alerts on bends where bearing diverged from heading direction.

## Ownership
Foreground and background alert producers use an explicit ownership handoff. A producer must re-check ownership after asynchronous audio/geocoding work and immediately before playback or notification delivery.

**Why:** App-state transitions and close parallel roads can otherwise produce duplicate audio or an alert carrying the neighbouring road's speed limit.

**How to apply:** Treat transient `inactive` as foreground-owned; transfer only on true background. Keep road metadata on every cached alert and group/infer limits only among compatible roads.
