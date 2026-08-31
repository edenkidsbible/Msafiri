---
name: Road Channels dashcam microphone handoff
description: Safe ownership rule for switching between CameraView dashcam capture and Road Channels voice recording.
---

Road Channels and the dashcam must never attempt simultaneous microphone ownership. Use a provider-owned lease: save the active dashcam segment, prevent new starts, await CameraView detachment and centralized audio-session release, then permit voice capture.

**Why:** Independent Expo Audio and CameraView recorders race the native audio session, especially on iOS, causing null dashcam segments, recorder crashes, or a stopped dashcam. State updates alone do not prove native release.

**How to apply:** Keep the lease through permission/setup/recording/teardown. Release it only after voice recording stops and canonical navigation audio is restored; then resume deferred dashcam work. Fail closed on save or detach failure, and abort in-flight acquisition on unmount.