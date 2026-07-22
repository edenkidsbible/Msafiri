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
      interruptionMode: "mixWithOthers",
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

// ─── Keli voice phrase clips ──────────────────────────────────────────────────
//
// Pre-generated MP3s using ElevenLabs "Keli – Calm & Natural African" voice
// (hzuja6LJVafBxphAzQRB) with the eleven_multilingual_v2 model. Generated
// once as a batch and bundled as app assets — no API calls at runtime.
// Dynamic text (road names, POI names) continues to use expo-speech TTS.

// NOTE: React Native's metro bundler requires static string literals in
// require() calls, so each asset is listed explicitly.
const KELI_SOURCES = {
  // Navigation lifecycle
  nav_started:        require("@/assets/sounds/keli/nav_started.mp3"),
  arrived:            require("@/assets/sounds/keli/arrived.mp3"),

  // Speed warnings
  speeding:           require("@/assets/sounds/keli/speeding.mp3"),

  // Static zone alerts (speed cameras / police checkpoints / zones)
  camera_ahead:       require("@/assets/sounds/keli/camera_ahead.mp3"),
  camera_ahead_close: require("@/assets/sounds/keli/camera_ahead_close.mp3"),
  police_ahead:       require("@/assets/sounds/keli/police_ahead.mp3"),
  police_ahead_close: require("@/assets/sounds/keli/police_ahead_close.mp3"),
  zone_ahead:         require("@/assets/sounds/keli/zone_ahead.mp3"),

  // Community report alerts
  report_accident:    require("@/assets/sounds/keli/report_accident.mp3"),
  report_pothole:     require("@/assets/sounds/keli/report_pothole.mp3"),
  report_roadblock:   require("@/assets/sounds/keli/report_roadblock.mp3"),
  report_police:      require("@/assets/sounds/keli/report_police.mp3"),
  report_alcoblow:    require("@/assets/sounds/keli/report_alcoblow.mp3"),
  report_roadworks:   require("@/assets/sounds/keli/report_roadworks.mp3"),
  report_camera:      require("@/assets/sounds/keli/report_camera.mp3"),
  report_traffic:     require("@/assets/sounds/keli/report_traffic.mp3"),
  report_hazard:      require("@/assets/sounds/keli/report_hazard.mp3"),
  report_debris:      require("@/assets/sounds/keli/report_debris.mp3"),
  report_breakdown:   require("@/assets/sounds/keli/report_breakdown.mp3"),
  report_weather:     require("@/assets/sounds/keli/report_weather.mp3"),
  report_closure:     require("@/assets/sounds/keli/report_closure.mp3"),

  // Report submission confirmation
  report_submitted:   require("@/assets/sounds/keli/report_submitted.mp3"),

  // Distance prefix clips for turn-by-turn announcements
  // ("In X metres," → clip, then TTS the turn instruction)
  in_50m:  require("@/assets/sounds/keli/in_50m.mp3"),
  in_100m: require("@/assets/sounds/keli/in_100m.mp3"),
  in_150m: require("@/assets/sounds/keli/in_150m.mp3"),
  in_200m: require("@/assets/sounds/keli/in_200m.mp3"),
  in_300m: require("@/assets/sounds/keli/in_300m.mp3"),
  in_400m: require("@/assets/sounds/keli/in_400m.mp3"),
  in_500m: require("@/assets/sounds/keli/in_500m.mp3"),
  in_600m: require("@/assets/sounds/keli/in_600m.mp3"),
  in_700m: require("@/assets/sounds/keli/in_700m.mp3"),
  in_800m: require("@/assets/sounds/keli/in_800m.mp3"),
  in_900m: require("@/assets/sounds/keli/in_900m.mp3"),
  in_1km:  require("@/assets/sounds/keli/in_1km.mp3"),
} as const;

export type PhraseKey = keyof typeof KELI_SOURCES;

const keliPlayers: Partial<Record<PhraseKey, AudioPlayer>> = {};

/** Pending callback scheduled to fire after a clip finishes. */
let voiceQueueTimer: ReturnType<typeof setTimeout> | null = null;

function getKeliPlayer(key: PhraseKey): AudioPlayer | null {
  try {
    if (!keliPlayers[key]) {
      keliPlayers[key] = createAudioPlayer(KELI_SOURCES[key]);
    }
    return keliPlayers[key]!;
  } catch (e) {
    console.warn(`[sound] Failed to load keli clip "${key}":`, e);
    return null;
  }
}

/**
 * Stop any currently playing Keli clip and cancel any pending queued callback.
 * Call this whenever a new announcement pre-empts a previous one.
 */
export function stopVoice() {
  if (voiceQueueTimer) {
    clearTimeout(voiceQueueTimer);
    voiceQueueTimer = null;
  }
  for (const key of Object.keys(keliPlayers) as PhraseKey[]) {
    const p = keliPlayers[key];
    if (p) {
      try { p.pause(); p.seekTo(0); } catch { /* ignore */ }
    }
  }
}

/**
 * Play a pre-generated Keli voice clip for a fixed navigation phrase.
 * Cancels any currently playing clip first. No-op when muted or on web.
 */
export async function speakPhrase(key: PhraseKey) {
  if (soundsMuted || Platform.OS === "web") return;
  await ensureAudioMode();
  stopVoice();
  const player = getKeliPlayer(key);
  if (!player) return;
  try {
    player.seekTo(0);
    player.play();
  } catch (e) {
    console.warn(`[sound] Failed to play keli clip "${key}":`, e);
  }
}

/**
 * Schedule `callback` to run `afterMs` milliseconds after the current clip
 * started playing. Used to sequence a distance-prefix clip ("In 200 metres,")
 * immediately before a TTS turn instruction containing a dynamic road name.
 * Replaces any previously scheduled callback.
 */
export function scheduleAfterClip(afterMs: number, callback: () => void) {
  if (voiceQueueTimer) clearTimeout(voiceQueueTimer);
  voiceQueueTimer = setTimeout(() => {
    voiceQueueTimer = null;
    callback();
  }, afterMs);
}

/**
 * Maps "In X metres, " text prefixes to their PhraseKey so the speak layer
 * can split a compound announcement (distance + turn) into clip + TTS.
 */
export const DIST_PREFIX_MAP: Array<{ prefix: string; key: PhraseKey; delayMs: number }> = [
  { prefix: "In 50 metres, ",   key: "in_50m",  delayMs: 1100 },
  { prefix: "In 100 metres, ",  key: "in_100m", delayMs: 1200 },
  { prefix: "In 150 metres, ",  key: "in_150m", delayMs: 1200 },
  { prefix: "In 200 metres, ",  key: "in_200m", delayMs: 1200 },
  { prefix: "In 300 metres, ",  key: "in_300m", delayMs: 1200 },
  { prefix: "In 400 metres, ",  key: "in_400m", delayMs: 1200 },
  { prefix: "In 500 metres, ",  key: "in_500m", delayMs: 1200 },
  { prefix: "In 600 metres, ",  key: "in_600m", delayMs: 1200 },
  { prefix: "In 700 metres, ",  key: "in_700m", delayMs: 1200 },
  { prefix: "In 800 metres, ",  key: "in_800m", delayMs: 1200 },
  { prefix: "In 900 metres, ",  key: "in_900m", delayMs: 1200 },
  { prefix: "In 1000 metres, ", key: "in_1km",  delayMs: 1300 },
];
