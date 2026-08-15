---
name: Background odometer ownership
description: Single-owner accounting invariant for background distance tracking
---
Rule: exactly one accumulator may own driving distance at any moment. While backgrounded, the background location task owns it and persist-only (never writes the odometer/care storage directly); on foreground resume the banked distance is credited exactly once, routed by the live trip state at consume time, and foreground accumulators stay gated until the handoff completes. Background/foreground lifecycle side effects must go through a serialized desired-state reconciler — independent start/stop calls racing across AppState flaps can kill a newer task instance.

**Why:** review found double-count paths (task flushing while trip-end also credits; guards keyed on navTripActive missing auto-detected trips) and an AppState race where a stale start's cleanup stopped the freshly started task.

**How to apply:** any future background GPS/distance feature must follow the same single-owner + consume-once + serialized-reconciler pattern.
