import { Platform } from "react-native";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import * as Speech from "expo-speech";

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

// ─── Navigation voice (TTS only) ─────────────────────────────────────────────
//
// All navigation voice guidance uses the device's built-in TTS engine
// (expo-speech) — one consistent voice throughout, no pre-generated clips.

/**
 * Stop any in-progress TTS utterance. Call whenever a new announcement
 * pre-empts a previous one, or when navigation stops.
 */
export function stopVoice() {
  try { Speech.stop(); } catch { /* ignore */ }
}

/** Returns "1st", "2nd", "3rd", "4th", … for roundabout exit counting. */
function toOrdinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/**
 * Announce the arm the driver just swept past inside a roundabout.
 * e.g. exitsPassed=2 → "The 2nd exit."
 * No-op when muted or on web.
 */
export async function speakRoundaboutExitCue(n: number): Promise<void> {
  if (soundsMuted || Platform.OS === "web") return;
  await ensureAudioMode();
  stopVoice();
  Speech.speak(`The ${toOrdinalSuffix(n)} exit.`, {
    language: "en-GB",
    rate: 0.85,
    pitch: 0.93,
  });
}

/**
 * Announce "Take this exit." when the driver's target roundabout exit is next.
 * No-op when muted or on web.
 */
export async function speakTakeThisExit(): Promise<void> {
  if (soundsMuted || Platform.OS === "web") return;
  await ensureAudioMode();
  stopVoice();
  Speech.speak("Take this exit.", {
    language: "en-GB",
    rate: 0.85,
    pitch: 0.93,
  });
}
