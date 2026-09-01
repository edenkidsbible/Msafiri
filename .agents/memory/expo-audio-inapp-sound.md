---
name: expo-audio for short in-app notification sounds
description: How to play one-off UI sound effects (confirmation prompts, alert cues) with expo-audio, and how it differs from push notification sound
---

## Rule
`expo-audio` (not the deprecated `expo-av`) is the correct SDK-54+ package for short in-app sound effects. Use the imperative `createAudioPlayer(source)` API (from `expo-audio`) rather than the `useAudioPlayer` hook when the sound needs to be triggered from module-level utility code or fired-and-forgotten from multiple unrelated components — the hook ties the player's lifecycle to one component's mount/unmount, which doesn't fit a shared "play this chime" utility.

For a large sound library, do not pre-create one native player per asset. Load on demand, keep a small bounded LRU cache, release evicted players, and await `seekTo(0)` before `play()`.

**Why:** Centralizing playback keeps call sites and mute handling consistent, but eagerly allocating dozens of `AudioPlayer` instances can exhaust or destabilize native decoder/player resources and make every later playback silently fail.

**How to apply:** Cache a few recently used players for in-app sounds and explicitly remove stale/evicted ones. This is separate from push-notification audio, which is controlled by the OS notification sound/channel configuration.
