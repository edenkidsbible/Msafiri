---
name: Expo watchPositionAsync silent stall
description: Turn-by-turn nav froze (position/speed/instructions/TTS all stuck after first fix) — root cause and the resilience pattern used to fix it.
---

## Symptom
During active navigation, position/speed/turn instructions all froze at the exact spot navigation started, and TTS only spoke the initial "Navigation started..." line and never again. All three symptoms trace back to a *single* shared root cause because they all derive from the same GPS callback in one shared location-tracking context (not three separate bugs).

## Root cause
`Location.watchPositionAsync` (expo-location) can silently stop delivering callbacks after the very first fix — no error, no rejection, subscription just goes quiet. Contributing factors seen here: `accuracy: Location.Accuracy.BestForNavigation` without the corresponding iOS background-location entitlements (`UIBackgroundModes: ["location"]`, `isIosBackgroundLocationEnabled`), plus no keep-awake during nav so the screen dims and throttles GPS callbacks.

**Why:** This is a known Expo/iOS footgun — `BestForNavigation` implies stricter OS-level location session behavior than plain `Highest` accuracy, and without background entitlements configured, CoreLocation can pause delivery under real-world conditions (screen lock/dim, backgrounding) that don't reproduce in a simulator/stationary test.

## Fix pattern (resilient regardless of exact platform cause)
1. Prefer `Location.Accuracy.Highest` over `BestForNavigation` unless you've fully configured background location entitlements.
2. Add a **watchdog**: track `lastLocationAtRef` (timestamp), reset it on every (re)subscribe attempt AND on every callback; a `setInterval` checks staleness (e.g. >8s) and tears down + resubscribes if stale. This recovers regardless of *why* the OS paused delivery.
3. Wrap the subscribe call in try/catch with a retry timer — a rejected `watchPositionAsync` promise should not permanently kill location tracking.
4. Use `expo-keep-awake` (`activateKeepAwakeAsync`/`deactivateKeepAwake`) while navigation is active so the screen doesn't dim/lock and throttle callbacks. Note: `deactivateKeepAwake` returns `Promise<void>`, not `void` — don't return it directly from a `useEffect` cleanup, wrap it.

**How to apply:** Any time you build/debug continuous GPS tracking (nav, live-location sharing) in Expo, assume the OS *will* pause `watchPositionAsync` under real conditions and always pair it with a watchdog + keep-awake, not just a bare subscription.
