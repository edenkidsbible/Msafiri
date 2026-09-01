---
name: In-drive alert overlay
description: Shared bottom-sheet presentation and the alert-type rule for speed metrics.
---

All in-drive alert types use the shared original-style bottom-sheet overlay with the same header, distance, dismiss control, and location/road details. Only an alert whose type is `camera` may show the “YOUR SPEED” and “SPEED LIMIT” comparison card or a speed-limit badge.

**Why:** Speed limits may exist on other zone/report records for matching and alert logic, but presenting them as driver metrics makes police, hazards, roadworks, and other alerts look like speed cameras.

**How to apply:** Keep presentation gating based on the alert type (`camera`), not merely on whether a `speedLimit` field is populated. Keep the shared overlay as the single in-drive alert UI.