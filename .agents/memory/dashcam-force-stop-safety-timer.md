---
name: Dashcam force-stop safety timer (issues: clips missing + recording hangs)
description: When stopRecording() returns null (common on short/interrupted clips), onSegmentComplete never fires, setIsRecording(false) is never called, overlay stays forever and clips aren't marked savedForReview.
---

## Root cause
`stopAndSaveDashcam()` deliberately defers `setIsRecording(false)` to `onSegmentComplete` to keep
`CameraView` mounted until the final clip is safely written. But if `stopRecording()` returns null
(clip was too short or interrupted), `onSegmentComplete` never fires → infinite null-stall loop.

The recording loop's null path was also cycling through null-stall → `bumpRecordingEpoch()` →
new loop → null → repeat, because it didn't check `isRecordingRef.current` before retrying.

## The fix (applied)

### DashcamContext.tsx
- Added `pendingTripEndRef = useRef(false)`.
- `stopAndSaveDashcam()` sets `pendingTripEndRef.current = true`, then schedules a 12-second
  safety timer that: marks existing unlocked clips as `savedForReview`, sets `pendingTripReview=true`,
  schedules the review reminder, and calls `setIsRecording(false)`.
- `onSegmentComplete` (both normal-path and catch-path when `tripEnded`) clears
  `pendingTripEndRef.current = false` so the safety timer becomes a no-op.

### DashcamOverlay.tsx
- In the recording loop's null path: checks `!isRecordingRef.current` before incrementing
  `nullRetryCount`. If trip has ended, breaks immediately with `exitReason = "done"` instead of
  cycling through 30 null retries and restarting the loop.

## How to apply
Any place that calls `stopAndSaveDashcam()` can now safely assume the overlay will unmount and
clips will be review-marked within 12 seconds maximum. The `pendingTripEndRef` guard prevents
double-execution if `onSegmentComplete` fires normally first.
