---
name: Android map styling
description: Provider and visual styling choice for native mobile maps.
---

iOS uses the native Apple Maps provider; Android uses Google Maps with its default appearance. Both light and dark modes are handled by passing `userInterfaceStyle` (`"light"` / `"dark"`) so Google Maps applies its own built-in theme — no `customMapStyle` is used on either platform.

**Why:** Both the Apple-inspired light style and the custom dark style were reverted at user request; native Google Maps styling is preferred on Android.

**How to apply:** Set `userInterfaceStyle` on `MapView` matching the app's `isDark` flag; keep `provider={PROVIDER_GOOGLE}` on Android and `undefined` on iOS; do not set `customMapStyle`.