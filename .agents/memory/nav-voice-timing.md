---
name: Navigation voice timing — speed-adaptive triggers
description: The formula used for nav cue trigger distances; why fixed distances are wrong and how the pre-compensation works.
---

# Navigation voice timing — speed-adaptive triggers

## The Rule
Never use fixed trigger distances for navigation voice cues. Trigger distance must be computed from current speed at every GPS tick.

**Why:** At 30 km/h a 350 m trigger fires 42 seconds early (driver forgets). At 100 km/h it fires only 12.6 seconds before the turn (too late for a highway junction). There is no single fixed distance that works across city and highway driving.

## The Formula (what Google Maps / Bolt use)
```
triggerM = spokenDistanceM + speed_m_s × (clipDurationS + audioStartupS)
```

This pre-compensates for audio playback time so the spoken "In 300 metres" accurately describes where the driver IS when they **hear** that word, not where they were when the clip started.

**Example at 100 km/h (27.8 m/s):**
- Target spoken distance: 250 m (rounded to token grid)
- Clip duration: 4.5 s + 0.5 s startup
- Trigger: 250 + 27.8 × 5.0 = 389 m
- Driver hears "In 250 metres" when ~250 m from the turn ✓

## Three-Cue System
1. **ANNOUNCE** — "In [N] metres, turn left onto Ngong Road" (~8 s of travel time)
2. **REMIND** — "Turn left onto Ngong Road" (~2.5 s of travel time, no distance prefix)
3. **NOW** — "Turn left" (maneuver only, no road name, driver is at the junction)

Keys: `step_${idx}`, `step_${idx}_near`, `step_${idx}_now`.

## Key Constraint
The NOW cue minimum must exceed `STEP_ADVANCE_DIST` (50 m) or the step advances before the cue fires. Current minimum: 60 m (`Math.max(60, 20 + s × 1.7)`).

## Clip Duration Constants (Keli Flash v2.5)
- ANNOUNCE: 4.5 s
- REMIND: 2.5 s
- NOW: 1.2 s
- Audio startup: 0.5 s

## Spoken distance tokens available: 100 / 150 / 200 / 250 / 300 / 350 m (50 m grid, max 350 m)
Spoken distance is snapped to this grid: `Math.round(s × 8 / 50) × 50`, clamped 100–350.
