/**
 * tts.ts — Navigation voice guidance via device TTS (expo-speech)
 *
 * Replaces the previous ElevenLabs / Keli implementation.
 *
 *  • Zero latency  — on-device synthesis, no network round-trip
 *  • No cached MP3s — nothing to download, prewarm, or stitch
 *  • Clean interruption — Speech.stop() before every new utterance
 *  • iOS voice  : Daniel (British English, Enhanced quality if installed)
 *  • Android    : Google UK English Female, fallback to any en-GB, then en-US
 */

import { Platform } from "react-native";
import * as Speech from "expo-speech";

// ─── Voice resolution ─────────────────────────────────────────────────────────
//
// Resolved once at startup and cached for the session.
// undefined = not yet resolved   null = no suitable voice found

let cachedVoiceId: string | undefined | null = undefined;

async function resolveBestVoiceId(): Promise<string | undefined> {
  if (Platform.OS === "web") return undefined;
  if (cachedVoiceId !== undefined) return cachedVoiceId ?? undefined;

  try {
    const voices = await Speech.getAvailableVoicesAsync();
    let found: Speech.Voice | undefined;

    if (Platform.OS === "ios") {
      // 1. Daniel Enhanced (highest quality)
      found = voices.find(
        (v) =>
          v.name.toLowerCase().includes("daniel") &&
          v.quality === "Enhanced" &&
          v.language.startsWith("en-GB"),
      );
      // 2. Daniel any quality
      if (!found) {
        found = voices.find(
          (v) =>
            v.name.toLowerCase().includes("daniel") &&
            v.language.startsWith("en-GB"),
        );
      }
      // 3. Any en-GB voice
      if (!found) {
        found = voices.find((v) => v.language.startsWith("en-GB"));
      }
    } else {
      // Android — Google UK English Female
      if (!found) {
        found = voices.find((v) =>
          v.name.toLowerCase().includes("google uk english female"),
        );
      }
      // Fallback: en-GB with "female" in the name
      if (!found) {
        found = voices.find(
          (v) =>
            v.language.startsWith("en-GB") &&
            v.name.toLowerCase().includes("female"),
        );
      }
      // Fallback: any en-GB
      if (!found) {
        found = voices.find((v) => v.language.startsWith("en-GB"));
      }
      // Last resort: any en-US
      if (!found) {
        found = voices.find((v) => v.language.startsWith("en-US"));
      }
    }

    cachedVoiceId = found?.identifier ?? null;
    return found?.identifier;
  } catch {
    cachedVoiceId = null;
    return undefined;
  }
}

// Kick off resolution eagerly so the first spoken phrase has no voice-lookup delay
void resolveBestVoiceId();

// ─── Playback state ───────────────────────────────────────────────────────────

/** Incremented on every stopNavVoice() / speakPhrase() call.
 *  Stale onDone callbacks check gen === myGen before touching isPlaying. */
let gen = 0;
let isPlaying = false;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * True while a navigation voice utterance is in progress.
 * Synchronous — safe to call from GPS tick handlers.
 */
export function isNavVoicePlaying(): boolean {
  return isPlaying;
}

/** Stop any in-progress utterance immediately. */
export function stopNavVoice(): void {
  gen++;
  isPlaying = false;
  if (Platform.OS !== "web") {
    try { Speech.stop(); } catch { /* ignore */ }
  }
}

/**
 * Speak a navigation phrase using the device TTS engine.
 * Interrupts any currently-playing utterance before starting.
 */
export async function speakPhrase(text: string): Promise<void> {
  if (Platform.OS === "web" || !text.trim()) return;

  // Cancel previous utterance and claim generation ownership
  stopNavVoice();
  const myGen = gen;
  isPlaying = true;

  try {
    const voiceId = await resolveBestVoiceId();
    if (gen !== myGen) return; // cancelled during async voice lookup

    await new Promise<void>((resolve) => {
      const done = () => {
        if (gen === myGen) isPlaying = false;
        resolve();
      };
      try {
        Speech.speak(text, {
          voice: voiceId,
          language: "en-GB",
          rate: 0.9,
          pitch: 1.0,
          onDone: done,
          onStopped: done,
          onError: done,
        });
      } catch {
        done();
      }
    });
  } finally {
    if (gen === myGen) isPlaying = false;
  }
}

