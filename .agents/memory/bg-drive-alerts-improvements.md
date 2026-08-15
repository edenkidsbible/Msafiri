---
name: Background drive alerts — accuracy, sound, and foreground recovery
description: Key constraints and fixes for the background GPS alert task and foreground-return position injection.
---

## iOS local notification sound format
- `.mp3` is NOT supported by `UNUserNotificationCenter` for local notification sounds.
- Must use `.wav`, `.aiff`, or `.caf` — or `sound: true` for the default system sound.
- `sound: "alert_tone.mp3"` fires the notification but plays NO sound on iOS; the bug is completely silent.
- Fix: `sound: Platform.OS === "ios" ? true : undefined` — Android uses the notification channel (`msafiri_alerts`) and ignores content-level sound on API 26+.

## Background drive alert task — accuracy & frequency
- Task is defined in `utils/backgroundDriveAlerts.ts`, lifecycle managed in `app/_layout.tsx` AppState handler.
- Previous config was `Balanced + 50 m` — at 100 km/h you only get ~1-2 wakeups across the 600 m alert window.
- Fixed config: `High accuracy + 10 m distanceInterval + 5000 ms timeInterval`.
- `showsBackgroundLocationIndicator: true` signals to iOS that this is navigation-critical → higher wakeup fidelity.
- Android: requires `foregroundService` config in `startLocationUpdatesAsync` options to survive Doze mode.

## GPS fix staleness guard in background task
- The OS can batch and deliver stale cached fixes alongside fresh ones.
- Sort batch descending by timestamp, pick the first fix within `FIX_MAX_AGE_MS = 20 s`.
- Skip invocation entirely if the best fix is > 60 s old (device was parked).

## Foreground-return position injection (AppContext)
- Pattern: `AppState.addEventListener("change", …)` in `AppContext.tsx` after the GPS watch effect.
- On `→ active`: read `BG_LAST_FIX_KEY` from AsyncStorage (written by BG task on every fix) + call `Location.getLastKnownPositionAsync({ maxAge: 30_000, requiredAccuracy: 200 })`.
- Feed both through `handleLocation()` immediately, then reset `lastLocationAtRef.current = Date.now()` to prevent watchdog from firing on top.
- Clear `BG_LAST_FIX_KEY` after consuming so stale fix isn't re-injected on the next foreground return.
- `BG_LAST_FIX_KEY = "@msafiri/bgLastFix"` — exported from `backgroundDriveAlerts.ts`.

## Background mode config (app.config.js)
- `UIBackgroundModes: ["location", "remote-notification", "audio"]` — all present.
- `isIosBackgroundLocationEnabled: true` in expo-location plugin config.
- Notification sounds listed in expo-notifications plugin `sounds` array but iOS ignores .mp3 at runtime.

**Why:** Without these fixes, drivers miss every background alert on iOS (silent notifications), and see their map position jump 200–800 m ahead after unlocking their screen.
