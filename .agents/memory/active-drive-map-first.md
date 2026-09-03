---
name: Active-drive map-first layout
description: Interaction rule for the active driving screen and its persistent controls.
---

During an active drive, the map is the primary surface. Keep the existing control dock unchanged when visible, with live time/distance, SOS, End Trip, dashcam, audio, and secondary details available. Let drivers hide the entire dock to reveal the map and bottom navigation, with a recoverable Show Controls affordance.

**Why:** Drivers asked for a full maps page and found the previous Drive Safely menu too dominant. A reversible dock toggle gives them a clean map while preserving every action and the existing alert overlay behavior.

**How to apply:** Start every new drive with the dock shown, preserve the existing shown layout, place Show Controls above the tab bar when hidden, preserve large touch targets, and ensure visibility changes never alter navigation, trip, or alert state.