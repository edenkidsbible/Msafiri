---
name: Drive alert GPS accuracy gate
description: Why alertAccuracyOk was silently blocking all camera/report/HERE alerts on many devices, and how it was fixed.
---

# Drive alert GPS accuracy gate bug

## The rule
`alertAccuracyOk = accuracyM == null || accuracyM <= 100` (AppContext.tsx)

## Why it was a problem
The original threshold was 40 m. The GPS subscription used `Location.Accuracy.Balanced`, which Expo documents as "accurate to within ~100 metres." On any fix using cell-tower/Wi-Fi positioning (very common in Nairobi urban canyons), the reported `accuracyM` was 50–150 m — above 40 m — so ALL three candidate selectors (zone, report, HERE) returned null at lines 1762/1796/1822. No winner → no `isNewAlert` → no audio, no visual overlay. Users passed speed cameras and heard nothing.

**Why:** The three candidate selectors gate on `alertAccuracyOk`. A false value makes every candidate function return null immediately, short-circuiting the entire alert pipeline.

## Fix applied
1. GPS subscription changed from `Location.Accuracy.Balanced` → `Location.Accuracy.High` (GPS satellites, ~10 m accuracy, reliably below any reasonable threshold).
2. `alertAccuracyOk` threshold raised from 40 m → 100 m as a secondary safety net for degraded-signal edge cases.

**How to apply:** If alerts stop firing silently, check (a) the GPS accuracy mode in the subscription and (b) the alertAccuracyOk threshold. They must be compatible — threshold must exceed what the accuracy mode typically reports.

## Related visual bug
The drive overlay was hidden when `activeAlert.alongTrackM < -30`. At 100 km/h the GPS fires every 5 s (~140 m/tick), so a –30 m cutoff collapsed the visible window to sub-tick — the overlay never rendered before the next fix showed the alert as already passed. Fixed to –100 m (drive.tsx).
