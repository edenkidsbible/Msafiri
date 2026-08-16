---
name: Dashcam stops mid-drive root causes
description: All confirmed root causes for the dashcam stopping on its own during a trip, and what was done to fix each one.
---

# Dashcam stops mid-drive — root causes and fixes

**Why:** The dashcam stopping mid-drive is a critical reliability issue that accumulated multiple separate bugs.

## Root causes (all fixed)

### 1. AppState "inactive" triggering stop (fixed early)
AppState fires "inactive" on every notification banner, incoming call alert, control-centre swipe, etc. — not just true background.
**Fix:** Only gate the background-save logic on `nextState === "background"`, ignore "inactive".

### 2. Single recordAsync failure breaking loop (fixed early)
One failure would break the while-loop.
**Fix:** `consecutiveFailures` counter with MAX_FAILURES=20; separate `nullRetryCount` for null results (null_stall after 30, no restart slot consumed).

### 3. Cross-trip restartCountRef leak (fixed session 2)
A clean `stopAndSaveDashcam()` trip-end returned `"done"` from the loop, but the `.then()` handler fell through to the `"failure"` branch, incrementing `restartCountRef`. After 3 normal trips, the 4th had no restart budget left.
**Fix:** Explicit `"done"` case in `.then()` that resets `restartCountRef = 0`.

### 4. Audio session race condition — ~80s stops (fixed session 3) ← KEY
`setDashcamAudioMode(true)` was called as a fire-and-forget side-effect (not awaited). `recordAsync()` could start while `setAudioModeAsync` was still running. iOS sees two simultaneous `AVAudioSession` reconfigurations — one from expo-audio, one from the camera pipeline — and interrupts the capture session, causing null results or exceptions.

Additionally: if `setDashcamAudioMode(true)` threw, it reset `dashcamAudioActive = false`, which allowed every subsequent alert sound's `ensureAudioMode()` call to reconfigure the session to `DuckOthers` mid-recording — each reconfiguration could interrupt `recordAsync()`.

**Fix 1:** Moved `await setDashcamAudioMode(true)` to the TOP of the recording loop function (before the 900ms warmup), so audio session is fully settled before any `recordAsync()` call.
**Fix 2:** In `sound.ts` catch block, only reset `dashcamAudioActive = false` when `recording = false`. If setting up for recording fails, keep `dashcamAudioActive = true` so `ensureAudioMode()` stays a no-op.

## How to apply
- Never add any `setAudioModeAsync` call (or any code that touches `AVAudioSession`) that runs concurrently with `recordAsync()`.
- The audio session must be fully configured BEFORE `recordAsync()` starts.
- `dashcamAudioActive` must stay `true` for the entire duration of recording, regardless of whether the initial `setAudioModeAsync(PlayAndRecord)` succeeded — failure to do so allows alert sounds to fight with the camera session.
