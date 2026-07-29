/**
 * tts.ts — Navigation voice guidance via ElevenLabs (Keli voice)
 *
 * Architecture:
 *  • ~120 structural phrases (turn left, in 200m, police ahead, cleared alerts, etc.)
 *    are pre-recorded Keli MP3s bundled with the app → zero latency, works offline.
 *  • Road names (e.g. "Ngong Road.") are fetched on-demand from POST /api/tts
 *    → cached to device storage for 1 year so the second play is instant.
 *  • Before navigation starts, prebuildRouteAudio() downloads each full-sentence
 *    instruction as a single MP3, eliminating mid-phrase gaps during the drive.
 *  • All playback is sequential; stopping mid-phrase is instant via generation
 *    counter cancellation.
 *  • No device-TTS fallback — every utterance is Keli's voice.
 */

import { Platform } from "react-native";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
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

  // ── Alert cleared phrases ────────────────────────────────────────────────────
  // These are the exact strings emitted by AppContext's CLEARED_TEXT map.
  // New clips (camera-cleared, traffic-cleared, incident-cleared,
  // road-closure-cleared, checkpoint-cleared, incident-ahead-cleared) are listed
  // in generateNavTokens.mjs — add require() entries here after running the
  // script with a creator-tier ElevenLabs API key.
  "police-cleared":      require("@/assets/nav-audio/police-cleared.mp3"),
  "accident-cleared":    require("@/assets/nav-audio/accident-cleared.mp3"),
  "roadblock-cleared":   require("@/assets/nav-audio/roadblock-cleared.mp3"),
  "roadworks-cleared":   require("@/assets/nav-audio/roadworks-cleared.mp3"),
  "hazard-cleared":      require("@/assets/nav-audio/hazard-cleared.mp3"),
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
  // Cleared alerts (exact strings from AppContext CLEARED_TEXT map)
  "police checkpoint cleared":             "police-cleared",
  "accident cleared":                      "accident-cleared",
  "road block cleared":                    "roadblock-cleared",
  "road works cleared":                    "roadworks-cleared",
  "hazard cleared":                        "hazard-cleared",
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
// ── Cache versioning ─────────────────────────────────────────────────────────
// Bump CACHE_VERSION whenever the server voice changes.  Old clips stored under
// previous versions are deleted on first launch by purgeStaleTtsCache().
//
//   v1  (unversioned, no suffix) — Alice voice era; keys: nav_tts_<hash>
//   v2  — Keli (hzuja6LJVafBxphAzQRB / eleven_flash_v2_5)
const CACHE_VERSION = "v2";
const CACHE_DIR     = (FileSystem.cacheDirectory ?? "") + `nav-audio-${CACHE_VERSION}/`;
const CACHE_TTL_MS  = 365 * 24 * 3600 * 1000; // 1 year — road names & Keli voice are stable
const sessionCache  = new Map<string, string>(); // text → file URI

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
  const storeKey = `nav_tts_${CACHE_VERSION}_${hash}`;

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

    // Fetch from API proxy — up to 3 attempts with 1 s back-off.
    // Retrying here (rather than at the call-site) keeps the caller simple and
    // means route-prewarm + playback-time fetches both benefit automatically.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * attempt));
        const res = await fetch(`${API_BASE}/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }

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
        lastErr = err;
      }
    }
    console.warn("[tts] resolveRawClip failed after 3 attempts:", lastErr);
    return null;
  } catch (err) {
    console.warn("[tts] resolveRawClip:", err);
    return null;
  }
}

// ─── Stale-cache purge ────────────────────────────────────────────────────────

const OLD_CACHE_DIR = (FileSystem.cacheDirectory ?? "") + "nav-audio/";  // v1 (Alice era)
const PURGE_FLAG    = `nav_tts_purged_${CACHE_VERSION}`;

/**
 * One-time startup sweep: deletes un-versioned (Alice-era) cached clips and
 * their AsyncStorage metadata so stale-voice audio cannot be played back.
 * Safe to call at every launch — the PURGE_FLAG prevents redundant work.
 * Non-throwing: any filesystem errors are silently swallowed.
 */
export async function purgeStaleTtsCache(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const done = await AsyncStorage.getItem(PURGE_FLAG);
    if (done) return;

    // Delete the old un-versioned cache directory (contains Alice MP3s).
    try {
      const info = await FileSystem.getInfoAsync(OLD_CACHE_DIR);
      if (info.exists) {
        await FileSystem.deleteAsync(OLD_CACHE_DIR, { idempotent: true });
      }
    } catch { /* filesystem error — not fatal */ }

    // Remove all old un-versioned AsyncStorage metadata keys.
    // Old keys look like "nav_tts_<hash>" — no version segment after "nav_tts_".
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const oldKeys = allKeys.filter(
        (k) => k.startsWith("nav_tts_") && !/^nav_tts_v\d+_/.test(k)
      );
      if (oldKeys.length > 0) await AsyncStorage.multiRemove(oldKeys);
    } catch { /* storage error — not fatal */ }

    // Clear the in-memory session cache so no v1 URI can be returned this session.
    sessionCache.clear();

    await AsyncStorage.setItem(PURGE_FLAG, "1");
  } catch { /* non-fatal — stale clips will expire via normal TTL */ }
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

    // Guard player.play() — if the player was already removed by a concurrent
    // stopNavVoice() call, play() throws synchronously inside the Promise
    // executor which would otherwise become an unhandled rejection.
    try { player.play(); } catch { resolve(); return; }

    const iv = setInterval(() => {
      elapsed += 50;
      try {
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
      } catch {
        // stopNavVoice() called player.remove() while the polling interval was
        // still running.  Accessing native properties on a freed AudioPlayer
        // throws in expo-audio, and an unhandled throw inside setInterval
        // crashes the JS runtime in Expo Go / Hermes.  Resolve immediately so
        // the parent speakPhrase() can clean up and the app keeps running.
        clearInterval(iv);
        resolve();
        return;
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

/** Separate generation counter for background pre-warm fetches.
 *  Incremented by cancelPrewarm() so any in-flight prewarm loop
 *  abandons remaining fetches without interfering with playback. */
let prewarmGen = 0;

/** True while a navigation voice clip is actively playing.
 *  Use this in AppContext to gate REMIND/NOW cues so they do not fire
 *  mid-sentence and kill the in-progress clip. */
export function isNavVoicePlaying(): boolean {
  return activePlayer !== null;
}

export function stopNavVoice(): void {
  gen++;
  try { activePlayer?.remove(); } catch { /* ignore */ }
  activePlayer = null;
  // (No expo-speech fallback — all voice is Keli via ElevenLabs)
  // Restore music volume immediately — don't leave it ducked after interruption
  restoreAudioMode();
}

/** Abandon any in-flight prewarm fetches (call when navigation stops). */
export function cancelPrewarm(): void {
  prewarmGen++;
}

/**
 * Pre-warm the on-device audio cache for every road name that appears in the
 * given route steps.  Runs entirely in the background — the caller must NOT
 * await this function.  If `cancelPrewarm()` is called (e.g. because the
 * driver stopped navigation) any pending network fetches are abandoned.
 *
 * Only `raw` segments need fetching; bundled token clips are always instant.
 */
export async function prewarmRouteAudio(
  steps: { instruction: string }[]
): Promise<void> {
  if (Platform.OS === "web") return;

  // Snapshot the current generation so we can detect cancellation.
  const myGen = ++prewarmGen;

  // Collect the unique raw texts across all steps.
  const seen = new Set<string>();
  for (const step of steps) {
    for (const seg of parseToSegments(step.instruction)) {
      if (seg.kind === "raw") seen.add(seg.text);
    }
  }

  // Fetch + cache each one, bailing out if cancelled between fetches.
  for (const text of seen) {
    if (prewarmGen !== myGen) return;
    try {
      await resolveRawClip(text);
    } catch {
      // Non-critical — if the cache miss persists at instruction time the
      // segment is silently skipped (Keli maneuver token still plays).
    }
  }
}

/**
 * Pre-build full-sentence Keli clips for every step instruction before
 * navigation starts.  Each instruction is fetched as ONE complete MP3
 * (not split into token + road-name segments), eliminating the micro-gaps
 * heard when two clips are stitched end-to-end.
 *
 * Called from startNavigation() with an 8 s timeout guard.  Any clips
 * already in the 1-year disk cache are a no-op.  On cancellation
 * (stopNavigation → cancelPrewarm), remaining fetches are abandoned.
 *
 * @param steps  The active route's step array.
 * @returns      Resolves when all clips are fetched (or as many as time allows).
 */
export async function prebuildRouteAudio(
  steps: { instruction: string }[]
): Promise<void> {
  if (Platform.OS === "web") return;

  const myGen = ++prewarmGen;

  // Deduplicate instructions — identical steps on loop routes only need one fetch.
  const seen = new Set<string>();
  for (const step of steps) {
    if (step.instruction) seen.add(step.instruction);
  }

  for (const instruction of seen) {
    if (prewarmGen !== myGen) return;  // cancelled by stopNavigation
    try {
      await resolveRawClip(instruction);
    } catch {
      // Non-critical — will fall back to token+segment playback at drive time.
    }
  }
}

/**
 * Speak a navigation phrase using the Keli (ElevenLabs) voice.
 *
 * Fast path — pre-built single-clip playback:
 *   prebuildRouteAudio() fetches each step's instruction as ONE complete Keli
 *   MP3 before navigation starts.  speakPhrase checks the session cache first:
 *
 *   1. Full match  — "Turn left onto Ngong Road" (REMIND cue): play that clip
 *      directly, no segment stitching, no micro-gaps.
 *   2. Prefix match — "In 300 metres, Turn left onto Ngong Road" (ANNOUNCE cue):
 *      play the distance tokens, then the pre-built instruction clip.  The only
 *      gap is the natural pause between the distance and the instruction, which
 *      actually sounds correct to the ear.
 *
 * Slow path — token + on-demand segments (fallback for reroutes, first drive, etc.)
 */
export async function speakPhrase(text: string): Promise<void> {
  if (Platform.OS === "web" || !text.trim()) return;

  await ensureAudioBase();

  // Cancel previous playback, then duck music before our clips start.
  stopNavVoice();
  await duckForVoice();
  const myGen = gen; // snapshot after stopNavVoice incremented gen

  try {
    // ── Pre-built single-clip fast path ──────────────────────────────────────
    // 1. Full-text match (REMIND, NOW, arrival phrases)
    const fullUri = sessionCache.get(text);
    if (fullUri) {
      let player: AudioPlayer | null = null;
      try {
        player = createAudioPlayer({ uri: fullUri });
        activePlayer = player;
        await playAndWait(player);
      } catch (err) {
        console.warn("[tts] prebuilt playback error:", err);
      } finally {
        if (activePlayer === player) activePlayer = null;
        try { player?.remove(); } catch { /* ignore */ }
      }
      return;
    }

    // 2. Prefix match — "In X metres, {instruction}" (ANNOUNCE cue)
    //    Play distance token(s) from bundled, then the pre-built instruction clip.
    const prefixMatch = text.match(/^(in \d+ metres?,?\s*)/i);
    if (prefixMatch) {
      const remainder = text.slice(prefixMatch[0].length);
      const remainderUri = sessionCache.get(remainder);
      if (remainderUri) {
        // Play distance prefix as bundled tokens
        for (const seg of parseToSegments(prefixMatch[0])) {
          if (gen !== myGen) return;
          if (seg.kind === "token") {
            const asset = TOKEN_ASSETS[seg.key];
            if (asset != null) {
              let player: AudioPlayer | null = null;
              try {
                player = createAudioPlayer(asset);
                activePlayer = player;
                await playAndWait(player);
              } catch { /* ignore */ } finally {
                if (activePlayer === player) activePlayer = null;
                try { player?.remove(); } catch { /* ignore */ }
              }
            }
          }
        }
        if (gen !== myGen) return;
        // Play pre-built instruction clip
        let player: AudioPlayer | null = null;
        try {
          player = createAudioPlayer({ uri: remainderUri });
          activePlayer = player;
          await playAndWait(player);
        } catch (err) {
          console.warn("[tts] prebuilt remainder playback error:", err);
        } finally {
          if (activePlayer === player) activePlayer = null;
          try { player?.remove(); } catch { /* ignore */ }
        }
        return;
      }
    }

    // ── Standard segment path (fallback) ─────────────────────────────────────
    const segments = parseToSegments(text);

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
        // On-demand road name — Keli only, no device-TTS fallback.
        // resolveRawClip already retries internally; if it still returns null
        // (persistent network failure) we silently skip this segment rather
        // than switching to a different voice mid-instruction.
        const uri = await resolveRawClip(seg.text);
        if (gen !== myGen) return; // cancelled during fetch
        if (uri) {
          source = { uri };
        } else {
          // Cache miss persists after retries — skip this segment silently.
          // The maneuver token that preceded it still played so the driver
          // hears "Turn left" without a road name rather than a different voice.
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
