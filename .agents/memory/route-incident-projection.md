---
name: Route incident "ahead" projection approach
description: How the mobile app computes which incidents/reports are "ahead" of the driver along an active route, and why nearest-point projection was chosen over step-index tracking.
---

For features that need a unified, sorted "what's ahead on this route" list (merging static hazards like speed cameras/police zones with live community reports), this app projects each incident onto the route polyline via nearest-point-on-polyline + cumulative distance, rather than reusing the turn-by-turn `currentStepIdx`/`distToNextM` step tracking already used for nav instructions.

**Why:** Step-index tracking only tells you progress relative to discrete maneuver points, which is too coarse to rank/filter an arbitrary set of off-route hazards by "distance ahead." Cumulative-distance-along-polyline gives a continuous progress value usable for both the driver's position and every incident, so filtering to "incidents ahead" is a simple comparison.

**Known limitation:** Nearest-point projection assumes the route polyline doesn't loop back near itself. On routes with tight loops/roundabouts/complex interchanges, an incident or the driver's own position could project onto the wrong (closer in straight-line distance, but wrong in route order) segment, making distance-ahead math briefly inaccurate. This was a deliberate, accepted trade-off (confirmed via architect review) rather than an oversight — full route-aware (Fréchet/arc-length-with-direction) projection was judged not worth the complexity for this use case.

**How to apply:** If extending "ahead of driver" logic elsewhere in this app, reuse this same cumulative-distance projection helper pattern rather than inventing a second approach — but be aware of the looping-route caveat above if accuracy issues are reported on complex interchanges.
