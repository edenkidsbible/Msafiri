---
name: usePathname() for tab detection across dual tab layouts
description: How to reliably detect "the user is on the Drive/index tab" when the app ships two different tab-bar implementations (Classic Tabs vs iOS NativeTabs).
---

This mobile app renders tabs via two different layouts depending on platform/capability: `ClassicTabLayout` (expo-router `Tabs`, used on Android/web and as iOS fallback) and `NativeTabLayout` (expo-router `unstable-native-tabs`, iOS Liquid Glass only). Both are defined in the same `(tabs)/_layout.tsx` and both register the same file-based routes (`index`, `map`, `browse`, `fines`, `settings`).

**Rule:** `usePathname()` from `expo-router` resolves to `"/"` for the `(tabs)/index.tsx` screen regardless of which of the two tab layouts is active, because pathname resolution happens at the router/file-route level, not the tab-bar UI level. Route group segments like `(tabs)` are never included in the resolved pathname.

**Why:** A global component mounted above the tab navigator (e.g. in root `_layout.tsx`) needs to know "is the current screen the Drive/index tab" to suppress duplicate UI that the Drive screen already renders inline. Checking `pathname === "/"` is safe and doesn't need separate handling for NativeTabs vs Tabs.

**How to apply:** For any future global overlay/FAB that needs to vary by active tab, compare `usePathname()` against `"/"`, `"/map"`, `"/browse"`, etc. — these path strings are stable across both tab layout implementations.
