/**
 * tts.ts — Navigation voice guidance via expo-speech (device TTS)
 *
 * Replaces the previous ElevenLabs/token system. expo-speech uses the
 * device's built-in TTS engine (enhanced Siri voice on iOS, Google TTS on
 * Android), which is always available offline, handles all road names
 * natively, and eliminates the two-speaker / cut-off issues caused by
 * mixing ElevenLabs audio clips with expo-speech fallbacks on a single
 * audio session.
 *
 * The public API is intentionally identical to the old file so every
 * call-site (AppContext, sound.ts) works without changes.
 */

import { Platform } from "react-native";
import * as Speech from "expo-speech";
import { setAudioModeAsync } from "expo-audio";

// ─── Audio session helpers ────────────────────────────────────────────────────
// Duck background music while speaking and restore afterwards. Mirroring the
// behaviour of the old ElevenLabs system keeps the UX consistent.

const AUDIO_BASE = {
  playsInSilentMode:          true,  // speak even when ringer is silenced
  allowsRecording:            false,
  shouldPlayInBackground:     false,
  shouldRouteThroughEarpiece: false,
} as const;

async function duckAudio(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await setAudioModeAsync({ ...AUDIO_BASE, interruptionMode: "duckOthers" });
  } catch { /* non-critical */ }
}

function restoreAudio(): void {
  if (Platform.OS === "web") return;
  setAudioModeAsync({ ...AUDIO_BASE, interruptionMode: "mixWithOthers" }).catch(() => {});
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Stop any in-progress navigation voice clip immediately.
 * Also restores the audio session so music resumes at full volume.
 */
export function stopNavVoice(): void {
  try { Speech.stop(); } catch { /* ignore */ }
  restoreAudio();
}

/**
 * No-op — kept for API compatibility with call-sites that cancel prewarm
 * when navigation ends. There is no prewarm step with device TTS.
 */
export function cancelPrewarm(): void {}

/**
 * No-op — kept for API compatibility. Device TTS requires no pre-warming.
 */
export async function prewarmRouteAudio(
  _steps: { instruction: string }[]
): Promise<void> {}

/**
 * Speak a navigation phrase using the device's native TTS engine.
 * Interrupts any in-progress utterance before starting the new one.
 *
 * @param text  Plain-text instruction, e.g. "In 300 metres, turn left onto Ngong Road."
 */
export async function speakPhrase(text: string): Promise<void> {
  if (Platform.OS === "web" || !text.trim()) return;

  // Cancel any in-flight utterance first, then duck music.
  Speech.stop();
  await duckAudio();

  return new Promise<void>((resolve) => {
    // Hard cap: if TTS hangs (e.g. on a device with a broken TTS engine),
    // resolve after 15 s so callers are never stuck awaiting indefinitely.
    const safety = setTimeout(() => { restoreAudio(); resolve(); }, 15_000);

    Speech.speak(text, {
      language: "en-GB",
      rate:     0.90,   // slightly slower than default for in-car clarity
      pitch:    1.00,
      onDone:    () => { clearTimeout(safety); restoreAudio(); resolve(); },
      onStopped: () => { clearTimeout(safety); restoreAudio(); resolve(); },
      onError:   () => { clearTimeout(safety); restoreAudio(); resolve(); },
    });
  });
}
