---
name: Drive score formula
description: Rate-normalised driving score (0–100); both client and server use identical logic.
---

# Drive score formula

## The rule
Score = 100 − harshPenalty − speedingPenalty + smoothBonus, clamped [0, 100].

All inputs are **rates** (events/hour, fraction of time), not raw counts, so long trips are
not unfairly penalised vs short ones.

```
effectiveMins  = max(30, movingMinutes)   // 30-min floor → no early-trip craters
effectiveHours = effectiveMins / 60

weightedEvents = harshBrakes × 2 + harshAccels × 1.5 + sharpTurns × 1.5
harshPenalty   = min(50, (weightedEvents / effectiveHours) × 3)

speedingPenalty = (speedingMinutes / effectiveMins) × 50   // 0–50

smoothBonus     = (smoothMinutes / effectiveMins) × 15     // 0–15

score = clamp(0, 100, round(100 − harshPenalty − speedingPenalty + smoothBonus))
```

## Client side (`artifacts/mobile/hooks/useDriveScore.ts`)
- `totalMovingMinutes` (new field in `DriveScoreSnapshot`) = seconds at ≥ 10 km/h ÷ 60.
  Tracked by `totalMovingSecsRef` / `totalMovingMinsRef` in the 1-second tick.
- `recompute()` is called whenever `totalMovingMinsRef` increments (so the score can
  rise even with no new events — the rate denominator just got bigger).
- The old `W` weights constant and old cumulative formula are gone.

## Server side (`artifacts/api-server/src/routes/liveTrips.ts`)
- `computeScore` now takes `durationS` (already sent by the mobile client).
- `effectiveMins = max(30, durationS / 60)`.
- Call site in `POST /drive-sessions/:id/end` passes `durationS` to it.

**Why:** Old formula was `penalty = counts × fixed_weight`, unbounded — a 3-hour driver
with normal behaviour (5 harsh events, 30 speeding minutes) scored 0. New formula gives
that same driver ~82 ("Good"), which is accurate.

**How to apply:** If you ever tune weights, change both `computeLiveScore` (mobile) and
`computeScore` (server) in lockstep. The formulas must stay identical or the live gauge
and the session summary will disagree.
