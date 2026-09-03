---
name: Android map styling
description: Provider and visual styling choice for native mobile maps.
---

iOS uses the native Apple Maps provider; Android uses Google Maps with an Apple-inspired light custom style and the existing dark custom style. App-owned routes, markers, and alert overlays remain separate from base-map styling.

**Why:** Apple Maps has no Android SDK, so matching its restrained visual hierarchy through Google Maps gives Android a similar feel without changing providers or losing the existing Android map stack.

**How to apply:** Keep provider selection platform-native, apply the light Apple-inspired style only to Android light mode, preserve the dark style in Android dark mode, and leave iOS custom styles empty.