---
name: expo-audio for short in-app notification sounds
description: How to play one-off UI sound effects (confirmation prompts, alert cues) with expo-audio, and how it differs from push notification sound
---

## Rule
`expo-audio` (not the deprecated `expo-av`) is the correct SDK-54+ package for short in-app sound effects. Use the imperative `createAudioPlayer(source)` API (from `expo-audio`) rather than the `useAudioPlayer` hook when the sound needs to be triggered from module-level utility code or fired-and-forgotten from multiple unrelated components — the hook ties the player's lifecycle to one component's mount/unmount, which doesn't fit a shared "play this chime" utility.

**Why:** Centralizing sound playback in one utility (cache one `AudioPlayer` per sound key, `seekTo(0)` + `play()` to replay) avoids reload overhead and keeps every call site simple (`playSound("confirm")`), including a global mute switch.

**How to apply:** This only covers *in-app* sounds for on-screen UI events (e.g. an incident-confirmation prompt appearing, a proximity alert banner sliding in). It is unrelated to *push notification* sound — that's controlled separately via the OS notification payload/handler (`shouldPlaySound: true` in `Notifications.setNotificationHandler`), which already uses the system default sound with no extra wiring needed.
