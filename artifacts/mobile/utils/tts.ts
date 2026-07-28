/**
 * tts.ts — Navigation voice guidance via ElevenLabs (Keli voice)
 *
 * Architecture:
 *  • 74 structural phrases (turn left, in 200m, police ahead, etc.) are
 *    pre-recorded MP3s bundled with the app → zero latency, works offline.
 *  • Road names (e.g. "Ngong Road.") are fetched on-demand from POST /api/tts
 *    → cached to device storage for 90 days so the second play is instant.
 *  • All playback is sequential; stopping mid-phrase is instant via generation
 *    counter cancellation.
 *  • Falls back to expo-speech if a token file is missing or ElevenLabs
 *    is unreachable and the road name isn't cached.
 */

import { Platform } from "react-native";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import * as Speech from "expo-speech";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "@/utils/apiClient";

// ─── Bundled token asset map ──────────────────────────────────────────────────
// Every key maps to a pre-generated MP3 bundled inside the app.
// IMPORTANT: Metro requires every require() to be a static string literal —
// no dynamic paths, no helper functions. All 74 entries must be written out.
/* eslint-disable @typescript-eslint/no-require-imports */
const TOKEN_ASSETS: Record<string, number> = {
  // Distance prefixes
  "in-100m":  require("@/assets/nav-audio/in-100m.mp3"),
  "in-150m":  require("@/assets/nav-audio/in-150m.mp3"),
  "in-200m":  require("@/assets/nav-audio/in-200m.mp3"),
  "in-250m":  require("@/assets/nav-audio/in-250m.mp3"),
  "in-300m":  require("@/assets/nav-audio/in-300m.mp3"),
  "in-350m":  require("@/assets/nav-audio/in-350m.mp3"),
  // Standalone maneuvers
  "turn-left":           require("@/assets/nav-audio/turn-left.mp3"),
  "turn-right":          require("@/assets/nav-audio/turn-right.mp3"),
  "turn-slight-left":    require("@/assets/nav-audio/turn-slight-left.mp3"),
  "turn-slight-right":   require("@/assets/nav-audio/turn-slight-right.mp3"),
  "turn-sharp-left":     require("@/assets/nav-audio/turn-sharp-left.mp3"),
  "turn-sharp-right":    require("@/assets/nav-audio/turn-sharp-right.mp3"),
  "u-turn":              require("@/assets/nav-audio/u-turn.mp3"),
  "continue":            require("@/assets/nav-audio/continue.mp3"),
  "keep-left":           require("@/assets/nav-audio/keep-left.mp3"),
  "keep-right":          require("@/assets/nav-audio/keep-right.mp3"),
  "keep-straight":       require("@/assets/nav-audio/keep-straight.mp3"),
  "end-of-road-left":    require("@/assets/nav-audio/end-of-road-left.mp3"),
  "end-of-road-right":   require("@/assets/nav-audio/end-of-road-right.mp3"),
  "merge-left":          require("@/assets/nav-audio/merge-left.mp3"),
  "merge-right":         require("@/assets/nav-audio/merge-right.mp3"),
  // Maneuvers + "onto" (road name follows)
  "turn-left-onto":          require("@/assets/nav-audio/turn-left-onto.mp3"),
  "turn-right-onto":         require("@/assets/nav-audio/turn-right-onto.mp3"),
  "turn-slight-left-onto":   require("@/assets/nav-audio/turn-slight-left-onto.mp3"),
  "turn-slight-right-onto":  require("@/assets/nav-audio/turn-slight-right-onto.mp3"),
  "turn-sharp-left-onto":    require("@/assets/nav-audio/turn-sharp-left-onto.mp3"),
  "turn-sharp-right-onto":   require("@/assets/nav-audio/turn-sharp-right-onto.mp3"),
  "u-turn-onto":             require("@/assets/nav-audio/u-turn-onto.mp3"),
  "continue-onto":           require("@/assets/nav-audio/continue-onto.mp3"),
  "continue-on":             require("@/assets/nav-audio/continue-on.mp3"),
  "merge-left-onto":         require("@/assets/nav-audio/merge-left-onto.mp3"),
  "merge-right-onto":        require("@/assets/nav-audio/merge-right-onto.mp3"),
  // Roundabout standalone
  "roundabout-1st":  require("@/assets/nav-audio/roundabout-1st.mp3"),
  "roundabout-2nd":  require("@/assets/nav-audio/roundabout-2nd.mp3"),
  "roundabout-3rd":  require("@/assets/nav-audio/roundabout-3rd.mp3"),
  "roundabout-4th":  require("@/assets/nav-audio/roundabout-4th.mp3"),
  "roundabout-5th":  require("@/assets/nav-audio/roundabout-5th.mp3"),
  // Roundabout + "onto"
  "roundabout-1st-onto":  require("@/assets/nav-audio/roundabout-1st-onto.mp3"),
  "roundabout-2nd-onto":  require("@/assets/nav-audio/roundabout-2nd-onto.mp3"),
  "roundabout-3rd-onto":  require("@/assets/nav-audio/roundabout-3rd-onto.mp3"),
  "roundabout-4th-onto":  require("@/assets/nav-audio/roundabout-4th-onto.mp3"),
  "roundabout-5th-onto":  require("@/assets/nav-audio/roundabout-5th-onto.mp3"),
  // Exit counting cues
  "the-1st-exit":   require("@/assets/nav-audio/the-1st-exit.mp3"),
  "the-2nd-exit":   require("@/assets/nav-audio/the-2nd-exit.mp3"),
  "the-3rd-exit":   require("@/assets/nav-audio/the-3rd-exit.mp3"),
  "the-4th-exit":   require("@/assets/nav-audio/the-4th-exit.mp3"),
  "the-5th-exit":   require("@/assets/nav-audio/the-5th-exit.mp3"),
  "the-6th-exit":   require("@/assets/nav-audio/the-6th-exit.mp3"),
  "take-this-exit": require("@/assets/nav-audio/take-this-exit.mp3"),
  // Depart step replacement
  "follow-the-route":        require("@/assets/nav-audio/follow-the-route.mp3"),
  // Depart step — directional variants standalone
  "head-north":          require("@/assets/nav-audio/head-north.mp3"),
  "head-northeast":      require("@/assets/nav-audio/head-northeast.mp3"),
  "head-east":           require("@/assets/nav-audio/head-east.mp3"),
  "head-southeast":      require("@/assets/nav-audio/head-southeast.mp3"),
  "head-south":          require("@/assets/nav-audio/head-south.mp3"),
  "head-southwest":      require("@/assets/nav-audio/head-southwest.mp3"),
  "head-west":           require("@/assets/nav-audio/head-west.mp3"),
  "head-northwest":      require("@/assets/nav-audio/head-northwest.mp3"),
  "head-forward":        require("@/assets/nav-audio/head-forward.mp3"),
  // Depart step — directional variants + "onto"
  "head-north-onto":     require("@/assets/nav-audio/head-north-onto.mp3"),
  "head-northeast-onto": require("@/assets/nav-audio/head-northeast-onto.mp3"),
  "head-east-onto":      require("@/assets/nav-audio/head-east-onto.mp3"),
  "head-southeast-onto": require("@/assets/nav-audio/head-southeast-onto.mp3"),
  "head-south-onto":     require("@/assets/nav-audio/head-south-onto.mp3"),
  "head-southwest-onto": require("@/assets/nav-audio/head-southwest-onto.mp3"),
  "head-west-onto":      require("@/assets/nav-audio/head-west-onto.mp3"),
  "head-northwest-onto": require("@/assets/nav-audio/head-northwest-onto.mp3"),
  "head-forward-onto":   require("@/assets/nav-audio/head-forward-onto.mp3"),
  // Fixed navigation phrases
  "approaching-destination": require("@/assets/nav-audio/approaching-destination.mp3"),
  "arrived":                 require("@/assets/nav-audio/arrived.mp3"),
  "arriving":                require("@/assets/nav-audio/arriving.mp3"),
  "navigation-started":      require("@/assets/nav-audio/navigation-started.mp3"),
  "recalculating":           require("@/assets/nav-audio/recalculating.mp3"),
  "report-submitted":        require("@/assets/nav-audio/report-submitted.mp3"),
  "speed-limit-exceeded":    require("@/assets/nav-audio/speed-limit-exceeded.mp3"),
  // Road alert phrases
  "speed-camera-ahead":       require("@/assets/nav-audio/speed-camera-ahead.mp3"),
  "speed-camera-ahead-slow":  require("@/assets/nav-audio/speed-camera-ahead-slow.mp3"),
  "police-ahead":             require("@/assets/nav-audio/police-ahead.mp3"),
  "police-ahead-slow":        require("@/assets/nav-audio/police-ahead-slow.mp3"),
  "speed-zone-ahead":         require("@/assets/nav-audio/speed-zone-ahead.mp3"),
  "accident-ahead":           require("@/assets/nav-audio/accident-ahead.mp3"),
  "pothole-ahead":            require("@/assets/nav-audio/pothole-ahead.mp3"),
  "roadblock-ahead":          require("@/assets/nav-audio/roadblock-ahead.mp3"),
  "police-reported-ahead":    require("@/assets/nav-audio/police-reported-ahead.mp3"),
  "alcoblow-ahead":           require("@/assets/nav-audio/alcoblow-ahead.mp3"),
  "roadworks-ahead":          require("@/assets/nav-audio/roadworks-ahead.mp3"),
  "camera-reported-ahead":    require("@/assets/nav-audio/camera-reported-ahead.mp3"),
  "traffic-ahead":            require("@/assets/nav-audio/traffic-ahead.mp3"),
  "hazard-ahead":             require("@/assets/nav-audio/hazard-ahead.mp3"),
  "debris-ahead":             require("@/assets/nav-audio/debris-ahead.mp3"),
  "breakdown-ahead":          require("@/assets/nav-audio/breakdown-ahead.mp3"),
  "weather-hazard-ahead":     require("@/assets/nav-audio/weather-hazard-ahead.mp3"),
  "road-closure-ahead":       require("@/assets/nav-audio/road-closure-ahead.mp3"),
};
/* eslint-enable @typescript-eslint/no-require-imports */

// ─── Exact-match lookup (normalised text → token key) ────────────────────────
// Covers complete sentences from speakText / speakGeneralAlert callsites.
const EXACT: Record<string, string> = {
  // Fixed nav phrases
  "navigation started":                    "navigation-started",
  "report submitted":                      "report-submitted",
  "approaching your destination":          "approaching-destination",
  "you have arrived at your destination":  "arrived",
  "arriving at your destination":          "arriving",
  "you are exceeding the speed limit":     "speed-limit-exceeded",
  "recalculating route":                   "recalculating",
  // Alerts
  "speed camera ahead. reduce your speed": "speed-camera-ahead-slow",
  "speed camera ahead":                    "speed-camera-ahead",
  "police checkpoint ahead. reduce your speed": "police-ahead-slow",
  "police checkpoint ahead":               "police-ahead",
  "speed zone ahead":                      "speed-zone-ahead",
  "accident reported ahead":               "accident-ahead",
  "pothole ahead":                         "pothole-ahead",
  "road block ahead":                      "roadblock-ahead",
  "police reported ahead":                 "police-reported-ahead",
  "alcoblow checkpoint ahead":             "alcoblow-ahead",
  "road works ahead":                      "roadworks-ahead",
  "speed camera reported ahead":           "camera-reported-ahead",
  "traffic congestion ahead":              "traffic-ahead",
  "road hazard ahead":                     "hazard-ahead",
  "debris on road ahead":                  "debris-ahead",
  "vehicle breakdown ahead":               "breakdown-ahead",
  "weather hazard ahead":                  "weather-hazard-ahead",
  "road closure ahead":                    "road-closure-ahead",
  // Roundabout standalone
  "at the roundabout, take the 1st exit":  "roundabout-1st",
  "at the roundabout, take the 2nd exit":  "roundabout-2nd",
  "at the roundabout, take the 3rd exit":  "roundabout-3rd",
  "at the roundabout, take the 4th exit":  "roundabout-4th",
  "at the roundabout, take the 5th exit":  "roundabout-5th",
  // Maneuvers standalone
  "turn left":                             "turn-left",
  "turn right":                            "turn-right",
  "turn slightly left":                    "turn-slight-left",
  "turn slightly right":                   "turn-slight-right",
  "turn slight left":                      "turn-slight-left",
  "turn slight right":                     "turn-slight-right",
  "turn sharp left":                       "turn-sharp-left",
  "turn sharp right":                      "turn-sharp-right",
  "make a u-turn":                         "u-turn",
  "turn uturn":                            "u-turn",
  "continue":                              "continue",
  "keep left at the fork":                 "keep-left",
  "keep right at the fork":               "keep-right",
  "keep straight at the fork":            "keep-straight",
  "turn left at the end of the road":     "end-of-road-left",
  "turn right at the end of the road":    "end-of-road-right",
  "merge left":                            "merge-left",
  "merge right":                           "merge-right",
  // Exit cues
  "the 1st exit":  "the-1st-exit",
  "the 2nd exit":  "the-2nd-exit",
  "the 3rd exit":  "the-3rd-exit",
  "the 4th exit":  "the-4th-exit",
  "the 5th exit":  "the-5th-exit",
  "the 6th exit":  "the-6th-exit",
  "take this exit": "take-this-exit",
};

// Maneuver text → *-onto token (road name follows in the next clip)
const ONTO: Record<string, string> = {
  "turn left":          "turn-left-onto",
  "turn right":         "turn-right-onto",
  "turn slightly left": "turn-slight-left-onto",
  "turn slightly right":"turn-slight-right-onto",
  "turn slight left":   "turn-slight-left-onto",
  "turn slight right":  "turn-slight-right-onto",
  "turn sharp left":    "turn-sharp-left-onto",
  "turn sharp right":   "turn-sharp-right-onto",
  "make a u-turn":      "u-turn-onto",
  "turn uturn":         "u-turn-onto",
  "continue":           "continue-onto",
  "merge left":         "merge-left-onto",
  "merge right":        "merge-right-onto",
  "at the roundabout, take the 1st exit": "roundabout-1st-onto",
  "at the roundabout, take the 2nd exit": "roundabout-2nd-onto",
  "at the roundabout, take the 3rd exit": "roundabout-3rd-onto",
  "at the roundabout, take the 4th exit": "roundabout-4th-onto",
  "at the roundabout, take the 5th exit": "roundabout-5th-onto",
  // Depart-step directions
  "head north":     "head-north-onto",
  "head northeast": "head-northeast-onto",
  "head east":      "head-east-onto",
  "head southeast": "head-southeast-onto",
  "head south":     "head-south-onto",
  "head southwest": "head-southwest-onto",
  "head west":      "head-west-onto",
  "head northwest": "head-northwest-onto",
  "head forward":   "head-forward-onto",
};

// ─── Segment types ────────────────────────────────────────────────────────────
type TokenSeg = { kind: "token"; key: string };
type RawSeg   = { kind: "raw";   text: string };
type Segment  = TokenSeg | RawSeg;

function tok(key: string): TokenSeg { return { kind: "token", key }; }
function raw(text: string): RawSeg  { return { kind: "raw", text }; }

// ─── Phrase parser ────────────────────────────────────────────────────────────
// Decomposes an instruction string into playable segments, maximising the
// number of bundled token clips used (zero latency, consistent voice).

function parseToSegments(input: string): Segment[] {
  // Normalise: strip trailing punctuation for matching, preserve for TTS
  const stripped = input.replace(/[.!?]+$/, "").trim();
  const norm     = stripped.toLowerCase();

  // 1. Exact full-phrase match
  if (EXACT[norm] && TOKEN_ASSETS[EXACT[norm]]) {
    return [tok(EXACT[norm])];
  }

  // 1b. Depart-step: "Head {direction}[ onto {road}]"
  //     OSRM depart modifiers are compass words (north/south/east/west/northeast/…)
  //     or "forward".  Use a bundled directional token so the driver hears the
  //     road name with zero latency on the very first instruction.
  if (norm.startsWith("head ")) {
    const afterHead = norm.slice(5); // e.g. "north onto uhuru highway" or "north"
    const ontoInAfter = afterHead.indexOf(" onto ");
    if (ontoInAfter > -1) {
      const dir      = afterHead.slice(0, ontoInAfter);          // "north"
      const roadPart = afterHead.slice(ontoInAfter + 6);         // "uhuru highway"
      const ontoKey  = ONTO[`head ${dir}`];                      // "head-north-onto"
      if (ontoKey && TOKEN_ASSETS[ontoKey]) {
        return [
          tok(ontoKey),
          raw(roadPart.replace(/\b\w/g, c => c.toUpperCase()) + "."),
        ];
      }
    } else {
      // No road name — play standalone directional token
      const dir           = afterHead.split(" ")[0];             // first word
      const standaloneKey = `head-${dir}`;
      if (TOKEN_ASSETS[standaloneKey]) {
        return [tok(standaloneKey)];
      }
    }
    // Unknown direction — fall back to generic "Follow the route."
    if (TOKEN_ASSETS["follow-the-route"]) {
      return [tok("follow-the-route")];
    }
  }

  // 2. "In X metres, {maneuver}" — extract distance prefix
  const distMatch = norm.match(/^in (\d+) metres?,?\s*(.*)/);
  let segs: Segment[] = [];
  let rest = norm;

  if (distMatch) {
    const distKey = `in-${distMatch[1]}m`;
    if (TOKEN_ASSETS[distKey]) segs.push(tok(distKey));
    rest = distMatch[2];
  }

  // 3. "Continue on {road}" special case (on, not onto)
  const contOnMatch = rest.match(/^continue on (.+)$/);
  if (contOnMatch) {
    if (TOKEN_ASSETS["continue-on"]) segs.push(tok("continue-on"));
    else segs.push(raw("Continue on"));
    segs.push(raw(contOnMatch[1].replace(/\b\w/g, c => c.toUpperCase()) + "."));
    return segs;
  }

  // 4. "{maneuver} onto {road}"
  const ontoIdx = rest.indexOf(" onto ");
  if (ontoIdx > -1) {
    const manPart  = rest.slice(0, ontoIdx);
    const roadPart = rest.slice(ontoIdx + 6);
    const ontoKey  = ONTO[manPart];
    if (ontoKey && TOKEN_ASSETS[ontoKey]) {
      segs.push(tok(ontoKey));
      segs.push(raw(roadPart.replace(/\b\w/g, c => c.toUpperCase()) + "."));
      return segs;
    }
  }

  // 5. "{maneuver} on {road}" (for "Continue on" caught above, but also
  //    generic fallback for other edge-cases)
  const onIdx = rest.indexOf(" on ");
  if (onIdx > -1) {
    const manPart = rest.slice(0, onIdx);
    if (EXACT[manPart] && TOKEN_ASSETS[EXACT[manPart]]) {
      segs.push(tok(EXACT[manPart]));
      const roadPart = rest.slice(onIdx + 4);
      segs.push(raw(roadPart.replace(/\b\w/g, c => c.toUpperCase()) + "."));
      return segs;
    }
  }

  // 6. Standalone maneuver match (rest after distance prefix)
  if (EXACT[rest] && TOKEN_ASSETS[EXACT[rest]]) {
    segs.push(tok(EXACT[rest]));
    return segs;
  }

  // 7. Nothing matched — full on-demand TTS
  if (segs.length > 0) {
    // Had a distance prefix but couldn't parse the rest — append raw rest
    segs.push(raw(stripped.slice(stripped.toLowerCase().indexOf(rest)).replace(/\b\w/g, c => c.toUpperCase()) + "."));
    return segs;
  }

  return [raw(input)];
}

// ─── On-demand audio cache ────────────────────────────────────────────────────
const CACHE_DIR    = (FileSystem.cacheDirectory ?? "") + "nav-audio/";
const CACHE_TTL_MS = 90 * 24 * 3600 * 1000; // 90 days
const sessionCache = new Map<string, string>(); // text → file URI

/** djb2 hash — good enough for short road-name strings */
function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = (((h << 5) + h) ^ text.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary  = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function resolveRawClip(text: string): Promise<string | null> {
  if (!API_BASE || Platform.OS === "web") return null;

  // Session cache hit
  if (sessionCache.has(text)) return sessionCache.get(text)!;

  const hash     = hashText(text);
  const filePath = `${CACHE_DIR}${hash}.mp3`;
  const storeKey = `nav_tts_${hash}`;

  try {
    // Disk cache hit
    const meta = await AsyncStorage.getItem(storeKey);
    if (meta) {
      const { expires } = JSON.parse(meta) as { expires: number };
      if (Date.now() < expires) {
        const info = await FileSystem.getInfoAsync(filePath);
        if (info.exists) {
          sessionCache.set(text, filePath);
          return filePath;
        }
      }
    }

    // Fetch from API proxy
    const res = await fetch(`${API_BASE}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null;

    const b64 = arrayBufferToBase64(await res.arrayBuffer());

    // Ensure cache dir exists, then write
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true }).catch(() => {});
    await FileSystem.writeAsStringAsync(filePath, b64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await AsyncStorage.setItem(storeKey, JSON.stringify({ expires: Date.now() + CACHE_TTL_MS }));

    sessionCache.set(text, filePath);
    return filePath;
  } catch (err) {
    console.warn("[tts] resolveRawClip:", err);
    return null;
  }
}

// ─── Audio playback ───────────────────────────────────────────────────────────
let audioBaseReady = false;

/** One-time setup: allow playback in silent mode, route through speaker. */
async function ensureAudioBase() {
  if (audioBaseReady || Platform.OS === "web") return;
  audioBaseReady = true;
  try {
    await setAudioModeAsync({
      playsInSilentMode:          true,
      interruptionMode:           "mixWithOthers", // baseline: don't interfere
      allowsRecording:            false,
      shouldPlayInBackground:     false,
      shouldRouteThroughEarpiece: false,
    });
  } catch { /* non-critical */ }
}

const AUDIO_MODE_BASE = {
  playsInSilentMode:          true,
  allowsRecording:            false,
  shouldPlayInBackground:     false,
  shouldRouteThroughEarpiece: false,
} as const;

/**
 * Lower background music while voice plays.
 * Called immediately before the first clip of each speakPhrase() invocation.
 */
async function duckForVoice() {
  if (Platform.OS === "web") return;
  try {
    await setAudioModeAsync({ ...AUDIO_MODE_BASE, interruptionMode: "duckOthers" });
  } catch { /* ignore */ }
}

/**
 * Restore music to its original volume.
 * Called after all clips finish OR when stopNavVoice() interrupts early.
 */
function restoreAudioMode() {
  if (Platform.OS === "web") return;
  setAudioModeAsync({ ...AUDIO_MODE_BASE, interruptionMode: "mixWithOthers" }).catch(() => {});
}

/** Play a player and resolve when it finishes (or times out at 15 s). */
function playAndWait(player: AudioPlayer): Promise<void> {
  return new Promise<void>((resolve) => {
    let started = false;
    let elapsed = 0;

    player.play();

    const iv = setInterval(() => {
      elapsed += 50;

      // Detect a clip that finished before the first tick (e.g. the audio
      // was already loaded and played through in < 50 ms after .play()).
      // Without this guard, `started` would never become true and the loop
      // would stall until the 15 s safety timeout.
      const alreadyFinished =
        !player.playing &&
        player.duration > 0 &&
        player.currentTime >= player.duration - 0.1;

      if (!started) {
        if (player.playing) {
          started = true;
        } else if (alreadyFinished) {
          // Clip finished before we saw it start — resolve immediately.
          clearInterval(iv);
          resolve();
          return;
        }
      } else {
        // Ended: no longer playing, or reached the end of the track
        if (!player.playing ||
            (player.duration > 0 && player.currentTime >= player.duration - 0.1)) {
          clearInterval(iv);
          resolve();
          return;
        }
      }

      // Safety timeout
      if (elapsed >= 15_000) { clearInterval(iv); resolve(); }
    }, 50);
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Generation counter — incremented on every new speakPhrase / stopNavVoice
 *  call so any in-flight playback loop detects it has been superseded. */
let gen = 0;
let activePlayer: AudioPlayer | null = null;

/** Stop any in-progress navigation voice clip immediately. */
export function stopNavVoice(): void {
  gen++;
  try { activePlayer?.remove(); } catch { /* ignore */ }
  activePlayer = null;
  // Also stop any fallback expo-speech utterance
  try { Speech.stop(); } catch { /* ignore */ }
  // Restore music volume immediately — don't leave it ducked after interruption
  restoreAudioMode();
}

/**
 * Speak a navigation phrase using the Keli (ElevenLabs) voice.
 * Structural phrases play from bundled tokens (zero latency).
 * Road names are fetched once and cached permanently on device.
 * Falls back to expo-speech if audio is unavailable.
 */
export async function speakPhrase(text: string): Promise<void> {
  if (Platform.OS === "web" || !text.trim()) return;

  await ensureAudioBase();

  // Cancel previous playback, then duck music before our clips start.
  stopNavVoice();
  await duckForVoice();
  const myGen = gen; // snapshot after stopNavVoice incremented gen

  const segments = parseToSegments(text);

  try {
    for (const seg of segments) {
      if (gen !== myGen) return; // cancelled

      let source: number | { uri: string } | null = null;

      if (seg.kind === "token") {
        const asset = TOKEN_ASSETS[seg.key];
        if (asset == null) {
          // Token file missing — fall through to speech fallback below
          console.warn(`[tts] missing token asset: ${seg.key}`);
          continue;
        }
        source = asset;
      } else {
        // On-demand road name
        const uri = await resolveRawClip(seg.text);
        if (gen !== myGen) return; // cancelled during fetch
        if (uri) {
          source = { uri };
        } else {
          // Network/cache miss → expo-speech fallback for this segment only.
          // Wait for the actual completion callback (onDone/onStopped/onError)
          // rather than a heuristic sleep, so the next segment starts immediately
          // after the speech finishes and stopNavVoice() (which calls Speech.stop())
          // resolves this promise via onStopped rather than waiting out a timer.
          await new Promise<void>((resolve) => {
            const safety = setTimeout(resolve, 10_000); // hard cap
            Speech.speak(seg.text, {
              language: "en-GB",
              rate: 0.82,
              pitch: 0.93,
              onDone:    () => { clearTimeout(safety); resolve(); },
              onStopped: () => { clearTimeout(safety); resolve(); },
              onError:   () => { clearTimeout(safety); resolve(); },
            });
          });
          continue;
        }
      }

      if (gen !== myGen || source == null) return;

      let player: AudioPlayer | null = null;
      try {
        player = createAudioPlayer(source);
        activePlayer = player;
        await playAndWait(player);
      } catch (err) {
        console.warn("[tts] playback error:", err);
      } finally {
        if (activePlayer === player) activePlayer = null;
        try { player?.remove(); } catch { /* ignore */ }
      }

      if (gen !== myGen) return;
    }
  } finally {
    // Restore music volume whether we finished normally, were cancelled, or threw.
    restoreAudioMode();
  }
}
