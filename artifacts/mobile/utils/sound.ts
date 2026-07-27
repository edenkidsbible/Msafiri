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

  // Roundabout exit ordinals ("the 1st exit", …, "the 10th exit")
  // Chained after roundabout_exit when OSRM provides an exit number.
  exit_1st:  require("@/assets/sounds/keli/exit_1st.mp3"),
  exit_2nd:  require("@/assets/sounds/keli/exit_2nd.mp3"),
  exit_3rd:  require("@/assets/sounds/keli/exit_3rd.mp3"),
  exit_4th:  require("@/assets/sounds/keli/exit_4th.mp3"),
  exit_5th:  require("@/assets/sounds/keli/exit_5th.mp3"),
  exit_6th:  require("@/assets/sounds/keli/exit_6th.mp3"),
  exit_7th:  require("@/assets/sounds/keli/exit_7th.mp3"),
  exit_8th:  require("@/assets/sounds/keli/exit_8th.mp3"),
  exit_9th:  require("@/assets/sounds/keli/exit_9th.mp3"),
  exit_10th: require("@/assets/sounds/keli/exit_10th.mp3"),

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
 * Stop any currently playing Keli clip (phrase or road-name) and cancel any
 * pending queued callback. Call whenever a new announcement pre-empts a
 * previous one.
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
  // Also stop any road-name clip that may be playing
  for (const key of Object.keys(roadPlayers) as RoadClipKey[]) {
    const p = roadPlayers[key];
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
  // Ordinal-specific roundabout entries come first (more specific wins)
  { prefix: "at the roundabout, take the 1st exit", key: "roundabout_exit", delayMs: 2000 },
  { prefix: "at the roundabout, take the 2nd exit", key: "roundabout_exit", delayMs: 2000 },
  { prefix: "at the roundabout, take the 3rd exit", key: "roundabout_exit", delayMs: 2000 },
  { prefix: "at the roundabout, take the 4th exit", key: "roundabout_exit", delayMs: 2000 },
  { prefix: "at the roundabout, take the 5th exit", key: "roundabout_exit", delayMs: 2000 },
  { prefix: "at the roundabout, take the 6th exit", key: "roundabout_exit", delayMs: 2000 },
  // Generic fallback (no exit number in instruction)
  { prefix: "at the roundabout, take the exit", key: "roundabout_exit", delayMs: 2000 },
  { prefix: "continue on",                  key: "continue_on",       delayMs: 1300 },
  { prefix: "continue",                     key: "nav_continue",      delayMs: 1100 },
];

/**
 * Maps roundabout exit number (1–6) to the Keli ordinal clip that is chained
 * after the `roundabout_exit` clip.  Exit counts > 6 have no pre-generated
 * clip and fall back to TTS inside speakTurnAnnouncement.
 */
export const ROUNDABOUT_EXIT_CLIP_MAP: Readonly<Record<number, PhraseKey>> = {
  1:  "exit_1st",
  2:  "exit_2nd",
  3:  "exit_3rd",
  4:  "exit_4th",
  5:  "exit_5th",
  6:  "exit_6th",
  7:  "exit_7th",
  8:  "exit_8th",
  9:  "exit_9th",
  10: "exit_10th",
};

/** Duration (ms) of each exit-ordinal clip ("the 3rd exit" ≈ 0.9 s). */
export const EXIT_ORDINAL_DELAY_MS = 950;

// ─── Roundabout arm-counting voice cues ───────────────────────────────────────

/** Returns "1st", "2nd", "3rd", "4th", … for TTS fallback in exit counting. */
function toOrdinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/**
 * Announce the arm that the driver just swept past while inside a roundabout.
 *
 * For exit counts 1–6 the pre-generated ordinal clip is played
 * ("the 1st exit", "the 2nd exit", …).  For counts above 6 a brief TTS
 * phrase is used as a fallback ("the 7th exit", …).
 * No-op when muted or on web.
 */
export async function speakRoundaboutExitCue(n: number): Promise<void> {
  const clipKey = ROUNDABOUT_EXIT_CLIP_MAP[n] as PhraseKey | undefined;
  if (clipKey) {
    await speakPhrase(clipKey);
  } else {
    // TTS fallback for counts beyond the pre-generated set
    if (soundsMuted || Platform.OS === "web") return;
    await ensureAudioMode();
    stopVoice();
    Speech.stop();
    Speech.speak(`the ${toOrdinalSuffix(n)} exit`, {
      language: "en-GB",
      rate: 0.82,
      pitch: 0.93,
    });
  }
}

/**
 * Play the "take this exit" cue — reuses the `roundabout_exit` clip which
 * Keli already uses for approach announcements.
 * No-op when muted or on web.
 */
export async function speakTakeThisExit(): Promise<void> {
  return speakPhrase("roundabout_exit");
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

// ─── Keli road-name clips ─────────────────────────────────────────────────────
//
// Pre-generated "onto <Road Name>" clips covering:
//   (a) every road in the speed-zone / camera database
//   (b) major Nairobi streets commonly named by OSRM
//   (c) Kenya's national highway route numbers (for rural OSRM segments)
//
// Metro bundler requires static string literals in require() — every asset is
// listed explicitly.  Unknown roads fall back to TTS as before.

const ROAD_SOURCES = {
  // ── Speed-zone database roads ──────────────────────────────────────────────
  mombasa_road:        require("@/assets/sounds/keli/roads/mombasa_road.mp3"),
  thika_superhighway:  require("@/assets/sounds/keli/roads/thika_superhighway.mp3"),
  waiyaki_way:         require("@/assets/sounds/keli/roads/waiyaki_way.mp3"),
  ngong_road:          require("@/assets/sounds/keli/roads/ngong_road.mp3"),
  outer_ring_road:     require("@/assets/sounds/keli/roads/outer_ring_road.mp3"),
  langata_road:        require("@/assets/sounds/keli/roads/langata_road.mp3"),
  nakuru_road:         require("@/assets/sounds/keli/roads/nakuru_road.mp3"),
  kisumu_road:         require("@/assets/sounds/keli/roads/kisumu_road.mp3"),
  nairobi_expressway:  require("@/assets/sounds/keli/roads/nairobi_expressway.mp3"),
  southern_bypass:     require("@/assets/sounds/keli/roads/southern_bypass.mp3"),
  northern_bypass:     require("@/assets/sounds/keli/roads/northern_bypass.mp3"),
  eastern_bypass:      require("@/assets/sounds/keli/roads/eastern_bypass.mp3"),
  western_bypass:      require("@/assets/sounds/keli/roads/western_bypass.mp3"),
  enterprise_road:     require("@/assets/sounds/keli/roads/enterprise_road.mp3"),
  karen_road:          require("@/assets/sounds/keli/roads/karen_road.mp3"),
  chiromo_road:        require("@/assets/sounds/keli/roads/chiromo_road.mp3"),
  garissa_road:        require("@/assets/sounds/keli/roads/garissa_road.mp3"),
  airport_north_road:  require("@/assets/sounds/keli/roads/airport_north_road.mp3"),
  eldoret_nakuru_hwy:  require("@/assets/sounds/keli/roads/eldoret_nakuru_hwy.mp3"),
  eldoret_malaba_hwy:  require("@/assets/sounds/keli/roads/eldoret_malaba_hwy.mp3"),
  magadi_road:         require("@/assets/sounds/keli/roads/magadi_road.mp3"),
  malindi_road:        require("@/assets/sounds/keli/roads/malindi_road.mp3"),
  diani_beach_road:    require("@/assets/sounds/keli/roads/diani_beach_road.mp3"),
  gitaru_road:         require("@/assets/sounds/keli/roads/gitaru_road.mp3"),
  red_hill_road:       require("@/assets/sounds/keli/roads/red_hill_road.mp3"),
  limuru_road:         require("@/assets/sounds/keli/roads/limuru_road.mp3"),
  kiambu_road:         require("@/assets/sounds/keli/roads/kiambu_road.mp3"),
  university_way:      require("@/assets/sounds/keli/roads/university_way.mp3"),
  kisii_rongo_road:    require("@/assets/sounds/keli/roads/kisii_rongo_road.mp3"),
  kisumu_vihiga_road:  require("@/assets/sounds/keli/roads/kisumu_vihiga_road.mp3"),
  // ── Major Nairobi roads (OSRM commonly names these) ───────────────────────
  uhuru_highway:       require("@/assets/sounds/keli/roads/uhuru_highway.mp3"),
  jogoo_road:          require("@/assets/sounds/keli/roads/jogoo_road.mp3"),
  juja_road:           require("@/assets/sounds/keli/roads/juja_road.mp3"),
  haile_selassie_ave:  require("@/assets/sounds/keli/roads/haile_selassie_ave.mp3"),
  kenyatta_avenue:     require("@/assets/sounds/keli/roads/kenyatta_avenue.mp3"),
  moi_avenue:          require("@/assets/sounds/keli/roads/moi_avenue.mp3"),
  valley_road:         require("@/assets/sounds/keli/roads/valley_road.mp3"),
  argwings_kodhek:     require("@/assets/sounds/keli/roads/argwings_kodhek.mp3"),
  dennis_pritt:        require("@/assets/sounds/keli/roads/dennis_pritt.mp3"),
  james_gichuru:       require("@/assets/sounds/keli/roads/james_gichuru.mp3"),
  ring_road_westlands: require("@/assets/sounds/keli/roads/ring_road_westlands.mp3"),
  ring_road_kilimani:  require("@/assets/sounds/keli/roads/ring_road_kilimani.mp3"),
  riverside_drive:     require("@/assets/sounds/keli/roads/riverside_drive.mp3"),
  peponi_road:         require("@/assets/sounds/keli/roads/peponi_road.mp3"),
  lower_kabete_road:   require("@/assets/sounds/keli/roads/lower_kabete_road.mp3"),
  upper_kabete_road:   require("@/assets/sounds/keli/roads/upper_kabete_road.mp3"),
  gitanga_road:        require("@/assets/sounds/keli/roads/gitanga_road.mp3"),
  muranga_road:        require("@/assets/sounds/keli/roads/muranga_road.mp3"),
  museum_hill:         require("@/assets/sounds/keli/roads/museum_hill.mp3"),
  mbagathi_way:        require("@/assets/sounds/keli/roads/mbagathi_way.mp3"),
  lusaka_road:         require("@/assets/sounds/keli/roads/lusaka_road.mp3"),
  bunyala_road:        require("@/assets/sounds/keli/roads/bunyala_road.mp3"),
  raphta_road:         require("@/assets/sounds/keli/roads/raphta_road.mp3"),
  riara_road:          require("@/assets/sounds/keli/roads/riara_road.mp3"),
  // ── Generic road-suffix phrase (no specific name) ─────────────────────────
  the_road: require("@/assets/sounds/keli/the_road.mp3"),
  // ── Inter-city highways (named by the cities they connect) ───────────────
  nakuru_kisumu_highway: require("@/assets/sounds/keli/roads/nakuru_kisumu_highway.mp3"),
  nairobi_embu_highway:  require("@/assets/sounds/keli/roads/nairobi_embu_highway.mp3"),
  kisumu_busia_road:     require("@/assets/sounds/keli/roads/kisumu_busia_road.mp3"),
  kisii_migori_road:     require("@/assets/sounds/keli/roads/kisii_migori_road.mp3"),
  nakuru_marigat_road:   require("@/assets/sounds/keli/roads/nakuru_marigat_road.mp3"),
  nakuru_narok_road:     require("@/assets/sounds/keli/roads/nakuru_narok_road.mp3"),
  mombasa_lamu_road:     require("@/assets/sounds/keli/roads/mombasa_lamu_road.mp3"),
} as const;

export type RoadClipKey = keyof typeof ROAD_SOURCES;

const roadPlayers: Partial<Record<RoadClipKey, AudioPlayer>> = {};

function getRoadPlayer(key: RoadClipKey): AudioPlayer | null {
  try {
    if (!roadPlayers[key]) {
      roadPlayers[key] = createAudioPlayer(ROAD_SOURCES[key]);
    }
    return roadPlayers[key]!;
  } catch (e) {
    console.warn(`[sound] Failed to load road clip "${key}":`, e);
    return null;
  }
}

/**
 * Play a Keli road-name clip ("onto <Road>") immediately.
 * Caller is responsible for sequencing via scheduleAfterClip.
 * No-op when muted or on web.
 */
export async function speakRoadClip(key: RoadClipKey) {
  if (soundsMuted || Platform.OS === "web") return;
  await ensureAudioMode();
  const player = getRoadPlayer(key);
  if (!player) return;
  try {
    player.seekTo(0);
    player.play();
  } catch (e) {
    console.warn(`[sound] Failed to play road clip "${key}":`, e);
  }
}

/**
 * Normalise a raw road-name string for lookup in ROAD_NORM_MAP:
 *   1. Strip leading "onto " / "on to "
 *   2. Remove parenthetical "(…)" blocks (route-number suffixes etc.)
 *   3. Lowercase, remove apostrophes/commas
 *   4. Replace en-dashes and hyphens with spaces
 *   5. Collapse whitespace and trim
 *
 * Examples:
 *   "onto Thika Superhighway (A2)" → "thika superhighway"
 *   "onto Lang'ata Road"           → "langata road"
 *   "onto A104 (Nakuru–Eldoret)"   → "a104"
 */
export function normalizeRoadName(raw: string): string {
  return raw
    .replace(/^on\s?to\s+/i, "")
    .replace(/\([^)]*\)/g, "")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[\u2013\u2014-]/g, " ")
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Maps normalised road-name strings → RoadClipKey.
 * Listed in priority order; more-specific entries first.
 * Route-number-only entries (a104, a7 …) sit last so a named road
 * like "Nakuru Road" always wins over the bare route number "A104".
 */
export const ROAD_NORM_MAP: Array<{ norms: string[]; key: RoadClipKey }> = [
  // ── Generic road-suffix phrase ─────────────────────────────────────────────
  { key: "the_road",            norms: ["the road"] },
  // ── Speed-zone database roads ──────────────────────────────────────────────
  { key: "mombasa_road",        norms: ["mombasa road", "nairobi mombasa highway", "a109 highway", "a109", "mombasa road (a109)"] },
  { key: "thika_superhighway",  norms: ["thika superhighway", "thika road"] },
  { key: "waiyaki_way",         norms: ["waiyaki way"] },
  { key: "ngong_road",          norms: ["ngong road"] },
  { key: "outer_ring_road",     norms: ["outer ring road", "outer ring"] },
  { key: "langata_road",        norms: ["langata road", "lang ata road"] },
  { key: "nakuru_road",         norms: ["nakuru road", "a104 highway", "a104", "nakuru road (a104)"] },
  { key: "kisumu_road",         norms: ["kisumu road"] },
  { key: "nairobi_expressway",  norms: ["nairobi expressway", "expressway"] },
  { key: "southern_bypass",     norms: ["southern bypass"] },
  { key: "northern_bypass",     norms: ["northern bypass"] },
  { key: "eastern_bypass",      norms: ["eastern bypass"] },
  { key: "western_bypass",      norms: ["western bypass"] },
  { key: "enterprise_road",     norms: ["enterprise road"] },
  { key: "karen_road",          norms: ["karen road"] },
  { key: "chiromo_road",        norms: ["chiromo road"] },
  { key: "garissa_road",        norms: ["garissa road", "thika garissa road", "a3 highway", "a3"] },
  { key: "airport_north_road",  norms: ["airport north road"] },
  { key: "eldoret_nakuru_hwy",  norms: ["eldoret nakuru highway", "eldoret nakuru"] },
  { key: "eldoret_malaba_hwy",  norms: ["eldoret malaba highway", "eldoret malaba"] },
  { key: "magadi_road",         norms: ["magadi road"] },
  { key: "malindi_road",        norms: ["malindi road", "a7 malindi road", "mombasa malindi road", "a7 highway", "a7"] },
  { key: "diani_beach_road",    norms: ["diani beach road"] },
  { key: "gitaru_road",         norms: ["gitaru road"] },
  { key: "red_hill_road",       norms: ["red hill road"] },
  { key: "limuru_road",         norms: ["limuru road"] },
  { key: "kiambu_road",         norms: ["kiambu road"] },
  { key: "university_way",      norms: ["university way"] },
  { key: "kisii_rongo_road",    norms: ["kisii rongo road", "kisii rongo"] },
  { key: "kisumu_vihiga_road",  norms: ["kisumu vihiga road", "kisumu vihiga"] },
  // ── Major Nairobi roads ────────────────────────────────────────────────────
  { key: "uhuru_highway",       norms: ["uhuru highway"] },
  { key: "jogoo_road",          norms: ["jogoo road"] },
  { key: "juja_road",           norms: ["juja road"] },
  { key: "haile_selassie_ave",  norms: ["haile selassie avenue", "haile selassie"] },
  { key: "kenyatta_avenue",     norms: ["kenyatta avenue"] },
  { key: "moi_avenue",          norms: ["moi avenue"] },
  { key: "valley_road",         norms: ["valley road"] },
  { key: "argwings_kodhek",     norms: ["argwings kodhek road", "argwings kodhek"] },
  { key: "dennis_pritt",        norms: ["dennis pritt road", "dennis pritt"] },
  { key: "james_gichuru",       norms: ["james gichuru road", "james gichuru"] },
  { key: "ring_road_westlands", norms: ["ring road westlands"] },
  { key: "ring_road_kilimani",  norms: ["ring road kilimani"] },
  { key: "riverside_drive",     norms: ["riverside drive"] },
  { key: "peponi_road",         norms: ["peponi road"] },
  { key: "lower_kabete_road",   norms: ["lower kabete road", "lower kabete"] },
  { key: "upper_kabete_road",   norms: ["upper kabete road", "upper kabete"] },
  { key: "gitanga_road",        norms: ["gitanga road"] },
  { key: "muranga_road",        norms: ["muranga road", "murangas road"] },
  { key: "museum_hill",         norms: ["museum hill"] },
  { key: "mbagathi_way",        norms: ["mbagathi way", "mbagathi road"] },
  { key: "lusaka_road",         norms: ["lusaka road"] },
  { key: "bunyala_road",        norms: ["bunyala road"] },
  { key: "raphta_road",         norms: ["raphta road"] },
  { key: "riara_road",          norms: ["riara road"] },
  // ── Inter-city highways (named by cities) ─────────────────────────────────
  { key: "nakuru_kisumu_highway", norms: ["nakuru kisumu highway", "b3 highway", "b3", "b3 kisumu highway"] },
  { key: "nairobi_embu_highway",  norms: ["nairobi embu highway", "a9 highway", "a9", "a9 embu siakago", "embu siakago highway"] },
  { key: "kisumu_busia_road",     norms: ["kisumu busia road", "a12 highway", "a12", "a12 kisumu busia", "a12 kericho kisumu"] },
  { key: "kisii_migori_road",     norms: ["kisii migori road", "b1 highway", "b1", "b1 kisii migori"] },
  { key: "nakuru_marigat_road",   norms: ["nakuru marigat road", "b17 highway", "b17", "b17 nakuru marigat"] },
  { key: "nakuru_narok_road",     norms: ["nakuru narok road", "b18 highway", "b18", "b18 narok njoro"] },
  { key: "mombasa_lamu_road",     norms: ["mombasa lamu road", "a1 highway", "a1"] },
];

/**
 * Resolve a raw road-suffix string (e.g. "onto Thika Superhighway (A2)") to a
 * RoadClipKey, or null if no clip exists for this road.
 */
export function resolveRoadClipKey(rawSuffix: string): RoadClipKey | null {
  const norm = normalizeRoadName(rawSuffix);
  for (const entry of ROAD_NORM_MAP) {
    if (entry.norms.some((n) => norm === n || norm.startsWith(n + " ") || norm.endsWith(" " + n))) {
      return entry.key;
    }
  }
  return null;
}
