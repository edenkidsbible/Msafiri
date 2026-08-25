---
name: Expo Android manifest plugin ordering
description: How image-picker permission opt-outs can remove dashcam permissions globally, and how to order a restoring config plugin.
---

Expo Android manifest mods execute in reverse config-plugin registration order. `expo-image-picker` options that disable camera or microphone permissions emit global `tools:node="remove"` entries; they also remove permissions required by unrelated `expo-camera` features.

**Why:** The normal app config and the `expo-camera` plugin can both declare `CAMERA` and `RECORD_AUDIO`, yet the generated manifest can still contain only removal markers, producing a standalone Android app that cannot prompt for or access the camera.

**How to apply:** Keep the image-picker opt-out if iOS behavior must remain frozen, but register an Android-only restoration plugin *before* `expo-image-picker` so it runs after the opt-out during native manifest generation. Always inspect a temporary prebuilt manifest before queuing an APK.