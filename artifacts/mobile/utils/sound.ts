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

  // Turn maneuvers
  turn_left:         require("@/assets/sounds/keli/turn_left.mp3"),
  turn_right:        require("@/assets/sounds/keli/turn_right.mp3"),
  turn_slight_left:  require("@/assets/sounds/keli/turn_slight_left.mp3"),
  turn_slight_right: require("@/assets/sounds/keli/turn_slight_right.mp3"),
  turn_sharp_left:   require("@/assets/sounds/keli/turn_sharp_left.mp3"),
  turn_sharp_right:  require("@/assets/sounds/keli/turn_sharp_right.mp3"),
  uturn:             require("@/assets/sounds/keli/uturn.mp3"),

  // Head / depart
  head_left:       require("@/assets/sounds/keli/head_left.mp3"),
  head_right:      require("@/assets/sounds/keli/head_right.mp3"),
  head_straight:   require("@/assets/sounds/keli/head_straight.mp3"),
  head_forward:    require("@/assets/sounds/keli/head_forward.mp3"),
  head_north:      require("@/assets/sounds/keli/head_north.mp3"),
  head_south:      require("@/assets/sounds/keli/head_south.mp3"),
  head_east:       require("@/assets/sounds/keli/head_east.mp3"),
  head_west:       require("@/assets/sounds/keli/head_west.mp3"),
  head_northeast:  require("@/assets/sounds/keli/head_northeast.mp3"),
  head_northwest:  require("@/assets/sounds/keli/head_northwest.mp3"),
  head_southeast:  require("@/assets/sounds/keli/head_southeast.mp3"),
  head_southwest:  require("@/assets/sounds/keli/head_southwest.mp3"),

  // Fork
  fork_left:     require("@/assets/sounds/keli/fork_left.mp3"),
  fork_right:    require("@/assets/sounds/keli/fork_right.mp3"),
  fork_straight: require("@/assets/sounds/keli/fork_straight.mp3"),

  // End of road
  end_road_left:  require("@/assets/sounds/keli/end_road_left.mp3"),
  end_road_right: require("@/assets/sounds/keli/end_road_right.mp3"),

  // Merge
  merge_left:  require("@/assets/sounds/keli/merge_left.mp3"),
  merge_right: require("@/assets/sounds/keli/merge_right.mp3"),

  // Roundabout / continue
  roundabout_exit: require("@/assets/sounds/keli/roundabout_exit.mp3"),
  nav_continue:    require("@/assets/sounds/keli/nav_continue.mp3"),
  continue_on:     require("@/assets/sounds/keli/continue_on.mp3"),

  // Distance prefix clips for turn-by-turn announcements
  // ("In X metres," → clip, then Keli maneuver clip, then TTS road name if any)
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
 * Maps the maneuver portion of a turn instruction (lower-cased, without road
 * name) to the Keli clip that should play for it.  Entries are checked in
 * order; list more-specific prefixes before shorter ones.
 *
 * How it works inside speakTurnAnnouncement:
 *   full text  = "[distance prefix, ]<maneuver>[road suffix]"
 *   After stripping the distance prefix we have:
 *     "turn left onto ngong road" → key=turn_left, roadSuffix=" onto Ngong Road"
 *     "head right"                → key=head_right, roadSuffix=""
 *   The road suffix (dynamic) is TTS'd after the maneuver clip plays.
 */
export const MANEUVER_PREFIX_MAP: Array<{ prefix: string; key: PhraseKey; delayMs: number }> = [
  // More-specific modifiers before shorter ones
  { prefix: "turn slight left",             key: "turn_slight_left",  delayMs: 1300 },
  { prefix: "turn slight right",            key: "turn_slight_right", delayMs: 1300 },
  { prefix: "turn sharp left",              key: "turn_sharp_left",   delayMs: 1300 },
  { prefix: "turn sharp right",            key: "turn_sharp_right",  delayMs: 1300 },
  { prefix: "turn left",                    key: "turn_left",         delayMs: 1100 },
  { prefix: "turn right",                   key: "turn_right",        delayMs: 1100 },
  { prefix: "make a u-turn",                key: "uturn",             delayMs: 1400 },
  { prefix: "head northeast",               key: "head_northeast",    delayMs: 1300 },
  { prefix: "head northwest",               key: "head_northwest",    delayMs: 1300 },
  { prefix: "head southeast",               key: "head_southeast",    delayMs: 1300 },
  { prefix: "head southwest",               key: "head_southwest",    delayMs: 1300 },
  { prefix: "head north",                   key: "head_north",        delayMs: 1100 },
  { prefix: "head south",                   key: "head_south",        delayMs: 1100 },
  { prefix: "head east",                    key: "head_east",         delayMs: 1100 },
  { prefix: "head west",                    key: "head_west",         delayMs: 1100 },
  { prefix: "head left",                    key: "head_left",         delayMs: 1100 },
  { prefix: "head right",                   key: "head_right",        delayMs: 1100 },
  { prefix: "head straight",                key: "head_straight",     delayMs: 1200 },
  { prefix: "head forward",                 key: "head_forward",      delayMs: 1200 },
  { prefix: "keep left at the fork",        key: "fork_left",         delayMs: 1800 },
  { prefix: "keep right at the fork",       key: "fork_right",        delayMs: 1800 },
  { prefix: "keep straight at the fork",    key: "fork_straight",     delayMs: 1900 },
  { prefix: "turn left at the end of the road",  key: "end_road_left",  delayMs: 2200 },
  { prefix: "turn right at the end of the road", key: "end_road_right", delayMs: 2200 },
  { prefix: "merge left",                   key: "merge_left",        delayMs: 1200 },
  { prefix: "merge right",                  key: "merge_right",       delayMs: 1200 },
  { prefix: "at the roundabout, take the exit", key: "roundabout_exit", delayMs: 2000 },
  { prefix: "continue on",                  key: "continue_on",       delayMs: 1300 },
  { prefix: "continue",                     key: "nav_continue",      delayMs: 1100 },
];

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
