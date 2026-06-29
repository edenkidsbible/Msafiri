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
