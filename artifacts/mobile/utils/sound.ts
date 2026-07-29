import { Platform } from "react-native";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

// Central place for all short in-app notification sounds (not push-notification
// sounds — those are handled by the OS via the `sound: "default"` field on the
// push payload). Players are created lazily and cached so replaying a sound is
// just a seek-to-start + play, with no reload overhead.

// ─── Notification sound effects ──────────────────────────────────────────────

const SOURCES = {
  confirm: require("@/assets/sounds/confirm_chime.mp3"),
  alert:   require("@/assets/sounds/alert_tone.mp3"),
  pop:     require("@/assets/sounds/notify_pop.mp3"),
} as const;

export type SoundKey = keyof typeof SOURCES;

const players: Partial<Record<SoundKey, AudioPlayer>> = {};
let audioModeReady = false;

async function ensureAudioMode() {
  if (audioModeReady || Platform.OS === "web") return;
  audioModeReady = true;
  try {
    // Play alerts even if the phone's ringer is silenced (like nav apps do),
    // and mix with anything else already playing (e.g. music/podcasts).
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "duckOthers",
      allowsRecording: false,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });
  } catch {
    // Non-critical — sounds still work with default audio mode
  }
}

function getPlayer(key: SoundKey): AudioPlayer | null {
  try {
    if (!players[key]) {
      players[key] = createAudioPlayer(SOURCES[key]);
    }
    return players[key]!;
  } catch (e) {
    console.warn(`[sound] Failed to load "${key}":`, e);
    return null;
  }
}

let soundsMuted = false;

/** Globally mute/unmute in-app notification sounds (e.g. from a settings toggle). */
export function setSoundsMuted(muted: boolean) {
  soundsMuted = muted;
}

export function getSoundsMuted(): boolean {
  return soundsMuted;
}

/**
 * Play a short in-app notification sound. Safe to call rapidly — resets to
 * the start each time so overlapping triggers don't get silently dropped.
 */
export async function playSound(key: SoundKey) {
  if (soundsMuted) return;
  await ensureAudioMode();
  const player = getPlayer(key);
  if (!player) return;
  try {
    player.seekTo(0);
    player.play();
  } catch (e) {
    console.warn(`[sound] Failed to play "${key}":`, e);
  }
}

// ─── Navigation voice ─────────────────────────────────────────────────────────
//
// All navigation voice guidance uses device TTS (expo-speech) via tts.ts.
// iOS: Daniel (British English). Android: Google UK English Female.

import { speakPhrase, stopNavVoice } from "@/utils/tts";

/**
 * Stop any in-progress navigation voice utterance immediately.
 */
export function stopVoice() {
  stopNavVoice();
}

/**
 * Announce the arm the driver just swept past inside a roundabout.
 * e.g. exitsPassed=2 → "The 2nd exit."  (plays bundled Keli clip)
 * No-op when muted or on web.
 */
export async function speakRoundaboutExitCue(n: number): Promise<void> {
  if (soundsMuted || Platform.OS === "web") return;
  const cues: Record<number, string> = {
    1: "The 1st exit.", 2: "The 2nd exit.", 3: "The 3rd exit.",
    4: "The 4th exit.", 5: "The 5th exit.", 6: "The 6th exit.",
  };
  const text = cues[n] ?? `The ${n}th exit.`;
  await speakPhrase(text);
}

/**
 * Announce "Take this exit." when the driver's target roundabout exit is next.
 * No-op when muted or on web.
 */
export async function speakTakeThisExit(): Promise<void> {
  if (soundsMuted || Platform.OS === "web") return;
  await speakPhrase("Take this exit.");
}
