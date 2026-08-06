---
name: Drive Mode route & auto-start
description: How the overhauled Drive Mode screen is routed and when it auto-starts a trip
---

The full drive experience lives at `app/(tabs)/drive.tsx` as a **hidden tab** (`href: null`), not a Stack route.

**Why:** the mockups show the bottom tab bar visible during Drive Mode; a hidden tab keeps the shared `MsafiriTabBar` on screen and keeps `usePathname()`-gated overlays (RouteIncidentsPanel `DRIVE_TAB_PATH = "/drive"`) working.

**How to apply:**
- Home's Start Driving pushes `/(tabs)/drive`; a mount effect auto-starts the trip **unless** `navDestination` is already set (Map-tab navigation / deep link → route preview + manual Start, preserving alt-route choice) or the route param `noAutoStart=1` is present (used by incident-check push notifications, which need the drive screen's confirmation prompt without starting a trip).
- Stop Drive calls `stopNavigation("manual")` + `stopTrip()` + `router.back()`.
- The Audio Alerts toggle (persisted at AsyncStorage `sdk_audio_alerts_off`) is the only caller of `setAlertVoiceDisabled()` + `setSoundsMuted()` — keep both in sync.
- All five tabs render through `components/MsafiriTabBar.tsx` on every platform (FloatingTabBar is retired); legacy screens (browse/trips/learn/fines/settings) stay registered with `href: null` so nothing 404s.
