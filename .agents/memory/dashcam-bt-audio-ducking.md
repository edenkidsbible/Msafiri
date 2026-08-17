---
name: Bluetooth music ducking during dashcam recording
description: During dashcam recording (mixWithOthers mode), alert sounds mix at full volume with BT music causing clipping/distortion. Fix is duckForAlert() which temporarily switches to duckOthers + allowsRecording:true then restores.
---

## The problem
When the dashcam is recording, `dashcamAudioActive = true` makes `ensureAudioMode()` a no-op.
The audio session stays in `PlayAndRecord + MixWithOthers`. Alert chimes and TTS voice play at full
volume simultaneously with BT music → the waveforms add together and clip through car speakers.

## The fix (in sound.ts)
`duckForAlert()` exported function:
- **No dashcam**: delegates to `ensureAudioMode()` — no change.
- **Dashcam active**: temporarily switches to `PlayAndRecord + duckOthers` (same AVAudioSession
  CATEGORY since `allowsRecording: true` is kept — only the option changes, which is safe for the
  active AVCaptureSession). BT music ducks during the alert. A debounced 5-second timer then
  restores `mixWithOthers` so music returns to full volume after the last alert.

All alert call sites use `duckForAlert()` instead of `ensureAudioMode()`:
- `playSound()` in sound.ts (alert chimes)
- `playKey()` in alertTts.ts (pre-bundled TTS voices)
- `speakAlertPhrase()` in alertTts.ts (on-demand TTS)

**Why:** Changing from `MixWithOthers` → `DuckOthers` within the SAME category (`PlayAndRecord`)
is safe. The concern in the original comment was about switching categories (`allowsRecording:true`
→ `allowsRecording:false`), which changes `PlayAndRecord` → `Playback` and interrupts AVCaptureSession.

## How to apply
Any new audio playback during dashcam recording should call `duckForAlert()` not `ensureAudioMode()`.
The 5-second restore timer is debounced — rapid-fire alerts reset it, so mode never flips mid-cue.
