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
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";

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

// ─── No-op stubs ──────────────────────────────────────────────────────────────
// These functions existed for ElevenLabs pre-warming / clip pre-building.
// They are retained as stubs so AppContext call sites compile without changes.

/** No-op — pre-warming is not needed with device TTS. */
export function cancelPrewarm(): void {}

/** No-op — road-name audio is synthesised on the fly. */
export async function prewarmRouteAudio(
  _steps: { instruction: string }[],
): Promise<void> {}

/** No-op — there are no clips to pre-build. */
export async function prebuildRouteAudio(
  _steps: { instruction: string }[],
): Promise<void> {}

/** No-op — there are no cached clips to retry fetching. */
export function retryMissingClipsForStep(_instruction: string): void {}

// ─── Stale-cache purge ────────────────────────────────────────────────────────
//
// Existing installs may have old ElevenLabs MP3s on-device from the Keli era.
// This runs once at startup (via AppContext) and cleans them up.

const OLD_CACHE_DIRS = [
  "nav-audio/",    // v1 — Alice era
  "nav-audio-v2/", // v2 — Keli era
];
const PURGE_FLAG = "nav_tts_purged_v3";

/**
 * One-time sweep: deletes old ElevenLabs-cached MP3 directories and their
 * AsyncStorage metadata so stale audio cannot be replayed on upgrade.
 * Non-throwing — any filesystem errors are silently swallowed.
 */
export async function purgeStaleTtsCache(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const done = await AsyncStorage.getItem(PURGE_FLAG);
    if (done) return;

    const base = FileSystem.cacheDirectory ?? "";

    for (const dir of OLD_CACHE_DIRS) {
      try {
        const info = await FileSystem.getInfoAsync(base + dir);
        if (info.exists) {
          await FileSystem.deleteAsync(base + dir, { idempotent: true });
        }
      } catch { /* non-fatal */ }
    }

    // Remove all old nav_tts_* AsyncStorage metadata keys
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const oldKeys = allKeys.filter((k) => k.startsWith("nav_tts_"));
      if (oldKeys.length > 0) await AsyncStorage.multiRemove(oldKeys);
    } catch { /* non-fatal */ }

    await AsyncStorage.setItem(PURGE_FLAG, "1");
  } catch { /* non-fatal */ }
}
