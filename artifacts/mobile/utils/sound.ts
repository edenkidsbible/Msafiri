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

/** Set the global audio session mode once. Exported so alertTts.ts shares the
 *  same flag — ensures setAudioModeAsync is only ever called once, preventing
 *  the rapid double-call that briefly resets the session and stops background music. */
export async function ensureAudioMode() {
  if (audioModeReady || Platform.OS === "web") return;
  audioModeReady = true;
  try {
    // Play alerts even if the phone's ringer is silenced (like nav apps do),
    // and mix with anything else already playing (e.g. music/podcasts).
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "duckOthers",
      allowsRecording: false,
      shouldPlayInBackground: true,
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

