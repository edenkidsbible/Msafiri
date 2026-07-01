---
name: Speed zone pairing rule
description: How to correctly model stretch zones (X→Y roads) vs point cameras in speedZones.ts
---

## Rule
Any **stretch zone** (a named road section like "Kangemi to Uthiru") MUST have **two entries** — one at each geographic end — so drivers travelling in *either* direction receive a 1 km advance warning as they enter the zone.

**Point cameras** (ANPR, fixed speed cameras) remain **single entries** — the camera is physically at one location and the 1 km trigger radius covers approach from any direction.

## Why
The app detects proximity via a haversine distance check (≤ 1 km) to each zone's single lat/lng coordinate. If a stretch zone has only one coordinate (e.g. the Nyayo Stadium end), a driver approaching from the other end (e.g. from Sameer Business Park / JKIA side) will drive *through* the entire zone without any warning until they are 1 km from the single pin — which may already be behind them.

## How to apply
When adding any zone described as "X to Y" or covering a named stretch:
1. Add entry `szNNN` at one geographic end (the Nairobi/city side, or whichever is mentioned first)
2. Add entry `szNNNb` at the other geographic end, same speedLimit and type
3. Both descriptions should state the direction they warn: "Approaching from [side]"

## Existing paired zones
- sz035 / sz035b — Mombasa Rd: Nyayo Stadium end ↔ Sameer Business Park end
- sz037 / sz037b — Waiyaki Way: Kangemi end ↔ Uthiru end

## Relation to DB-managed "stretch" zones
Admin-created DB stretch zones (mode="stretch", start/end coords) use this same start/end pairing for their ALERT_DIST proximity warning and map markers, but the driver's *confident current limit* along the corridor's middle is decided by a separate, tighter mechanism — see [Speed corridor confidence matching](speed-corridor-confidence-matching.md). Don't assume the point-pairing distance logic here is sufficient for "what's my limit right now" claims on long stretches.

## Seeding DB stretch rows: reuse verified point coordinates as endpoints
When seeding example/demo `speed_zones` "stretch" rows (mode='stretch'), don't fabricate new coordinates — reuse lat/lng from existing already-verified `SPEED_ZONES` point entries (town/interchange cameras) as the start/end of the stretch. This keeps every stretch endpoint independently verifiable and avoids introducing new unverified geo data.

**Why:** the corridor-matching confidence gate (80m) assumes a straight chord between start/end approximates the real road. Long or curvy real-world segments (e.g. an escarpment road) break that assumption — the chord can run through terrain the road doesn't, causing false negatives (safe) or, on roads that cross the chord, false positives (unsafe). Straight, well-known highway sections (flat plains, dual carriageways) are safe stretch candidates; winding sections (e.g. Limuru–Naivasha via the old escarpment road) are not, even if verified endpoints exist for the towns at either end.

**How to apply:** before adding a stretch row, sanity-check the real road's straightness between the two points (known flat/dual-carriageway sections are good; famous winding/escarpment sections are not), and note in the `description` that it's a straight-line approximation so a future admin knows to refine it with waypoints/polylines if needed.
