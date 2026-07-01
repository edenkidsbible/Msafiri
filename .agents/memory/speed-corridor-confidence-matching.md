---
name: Speed corridor confidence matching
description: How the mobile app decides when it's confident enough to show the driver's current speed limit for a road stretch, and the pitfall that nearly broke that confidence guarantee.
---

## Rule
When a "confident, current location" claim (e.g. "you are on this exact road, limit is X") is derived from a different, tighter check than an existing looser proximity check on the *same underlying data*, make sure the loose check is fully excluded from the confident code path — not just deprioritized.

## Why
A road "stretch" zone (start/end coordinates) has two purposes: (1) a loose point-radius proximity alert near either end (existing ALERT_DIST/IN_ZONE_DIST logic, unchanged, still useful for "camera/zone ahead" heads-up), and (2) a corridor projection (perpendicular offset + fractional position along the segment) used to confidently claim "you are on this road right now" anywhere along its length. Initially both were computed from the *same* flattened endpoint entries, with the point-radius match taking priority (`inZone ?? stretchMatch`). This meant a driver within 250m of a stretch's endpoint — even off on a side road or roundabout — got a confident "current limit" readout from the loose radius check before the tighter 80m corridor check ever ran, silently defeating the confidence guarantee. Caught by an architect review, not by typecheck (both paths type-checked fine).

## How to apply
Tag data that feeds a loose/legacy matching path (here: `isStretchEndpoint: true` on the flattened start/end `SpeedZone` entries) and explicitly exclude it from any stricter/newer confidence computation, rather than relying on priority/fallback ordering (`??`) to "mostly" prefer the stricter path. Fallback ordering only helps when the loose path *fails*, not when it fires early with a wrong-but-plausible answer.
