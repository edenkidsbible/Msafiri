---
name: Android map styling
description: Provider and visual styling choice for native mobile maps.
---

iOS uses the native Apple Maps provider; Android uses Google Maps with its default appearance in light mode and the existing custom dark style in dark mode. App-owned routes, markers, and alert overlays remain separate from base-map styling.

**Why:** The Apple-inspired light style was reverted at user request; default Google Maps is preferred.

**How to apply:** Keep provider selection platform-native, apply the dark custom style only to Android dark mode, and leave all other combinations with an empty customMapStyle (default appearance).