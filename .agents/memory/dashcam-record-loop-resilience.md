---
name: Dashcam recordAsync loop resilience
description: Why dashcam clips silently failed to save and the rules the recording loop must follow.
---

The dashcam recording loop (DashcamOverlay) calls `recordAsync` in a while-loop.

**Rules:**
- Never `break` the loop on a single `recordAsync` rejection or a null camera ref — back off (~700 ms) and retry; only give up after several *consecutive* failures (counter resets on each successful segment). A single early failure (camera not fully ready right after `onCameraReady`, common when auto-started from the drive screen) used to kill the loop while the REC indicator stayed on → zero clips saved.
- `recordAsync` with audio requires the **microphone** permission (separate from camera). Without it the call throws. Mic permission is requested up front in `startBackgroundRecording` and before manual record; if denied, record **muted** (via `recordMutedRef`, read at record time so the loop effect never restarts mid-segment).
- Camera permission gates the whole dashcam UI: without it the overlay renders a dedicated permission screen (request button, `Linking.openSettings()` when `canAskAgain === false`) — never the controls + dead preview.

**How to apply:** any change to the dashcam recording loop or permissions flow must preserve retry-with-backoff, muted fallback, and the permission gate.
