---
name: Drive page theme vs HUD mode
description: Distinguishing app-wide dark/light theme (themeOverride) from the separate HUD/Night-Mode feature toggle in the mobile app.
---

The mobile app (SafeDrive Kenya / Msafiri) has two independent boolean-like settings that are easy to confuse:

- `themeOverride` ("system" | "light" | "dark") — the app-wide Appearance setting (Settings > Display > Appearance). Drives `useColorScheme()` via `Appearance.setColorScheme()`, which `useColors()` reads to pick the light/dark palette from `constants/colors.ts`.
- `hudMode` (boolean) — a distinct high-contrast / keep-screen-on "HUD / Night Mode" feature with its own settings switch. It is NOT the same as dark mode and should not drive color theming.

**Why:** The drive page (`app/(tabs)/index.tsx`) previously used `hudMode` to pick all of its inline hex colors (search bar, speed strip, nav card, zone chips, route sheet), which meant the moon/sun FAB there was completely disconnected from the real Appearance setting — toggling one didn't affect the other, and users saw inconsistent theming between the drive page and the rest of the app.

**How to apply:** For any theme-following UI, use `isDark` derived from `useColors()` (`const isDark = c.isDark`) and call `setThemeOverride(isDark ? "light" : "dark")` to toggle — never gate color choices on `hudMode`. Keep `hudMode`/`setHudMode` only for the unrelated high-contrast/keep-awake settings switch; don't remove it, just don't let it drive palette decisions.
