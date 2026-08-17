---
name: Dashcam angle-preview camera session handoff
description: The iOS camera session handoff from the pre-trip checklist's CameraView to DashcamOverlay's CameraView can take 5–8 s, causing the 4-second angle-preview timer to fire before onCameraReady — the driver never sees the live orientation card.
---

## The problem
Pre-trip checklist renders its own `CameraView` for the angle-preview card inside the scrollable checklist. When the user taps "Start Driving":
1. `router.replace("/(tabs)/drive")` navigates away — the checklist unmounts and its `CameraView` releases the iOS AVCaptureSession.
2. Drive screen calls `startBackgroundRecording()` → `setBackgroundRecordPending(true)`.
3. DashcamOverlay mounts; Effect #2 fires and shows the angle-preview card AND starts the 4-second auto-dismiss timer simultaneously.
4. DashcamOverlay's `CameraView` tries to re-acquire the session, but iOS can take 5–8 s to hand it over.
5. The 4-second timer fires → preview dismissed → driver never sees a live frame.
6. Camera finally ready (`onCameraReady`) but preview is gone → driver can't confirm mount angle.

## The fix (applied)
Three refs added to DashcamOverlay: `angleTimerDoneRef`, `showAnglePreviewRef`, `angleSafetyTimerRef`.

Effect #2's 4-second timer now:
- If `cameraReadyRef.current === true`: dismiss normally (camera was fast, normal path).
- If `cameraReadyRef.current === false`: set `angleTimerDoneRef.current = true` but **do NOT hide** the card.

`onCameraReady` (JSX prop) now:
- Checks `angleTimerDoneRef.current && showAnglePreviewRef.current`.
- If both true: clears the flag, then waits 1.5 s for the driver to see the live frame, then dismisses.

A 12-second safety timer always dismisses regardless (prevents card from hanging if camera stalls completely).

**Why:** Changing only options (MixWithOthers ↔ DuckOthers) within the same `PlayAndRecord` category is safe; changing `allowsRecording` (true → false) changes the category and DOES interrupt AVCaptureSession. Never switch categories mid-recording.

## How to apply
Any time both a pre-trip or setup screen AND DashcamOverlay use CameraView concurrently: expect a multi-second session handoff on iOS. Always gate overlay-level auto-dismiss on `cameraReadyRef`, not just on elapsed time.
