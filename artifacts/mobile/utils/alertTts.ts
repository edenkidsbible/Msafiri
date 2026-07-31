/**
 * alertTts.ts — Yna Agalo voice for road alerts and incident reports.
 *
 * All alert phrases are pre-generated and bundled as MP3 assets so they
 * play instantly with zero network dependency and zero runtime API calls.
 *
 * Audio mode is owned by sound.ts (shared flag) so setAudioModeAsync only
 * ever fires once across the whole app, preventing the brief session reset
 * that would stop background music instead of just ducking it.
 */
import { Platform } from "react-native";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { ensureAudioMode } from "@/utils/sound";
import { API_BASE } from "@/utils/apiClient";

// ─── Bundled assets (pre-generated via ElevenLabs Multilingual v2, Yna Agalo) ─

const ALERT_AUDIO: Record<string, unknown> = {
  // Single-alert variants
  camera:    require("@/assets/sounds/alerts/camera.mp3"),
  police:    require("@/assets/sounds/alerts/police.mp3"),
  zone:      require("@/assets/sounds/alerts/zone.mp3"),
  alcoblow:  require("@/assets/sounds/alerts/alcoblow.mp3"),
  accident:  require("@/assets/sounds/alerts/accident.mp3"),
  traffic:   require("@/assets/sounds/alerts/traffic.mp3"),
  roadblock: require("@/assets/sounds/alerts/roadblock.mp3"),
  roadworks: require("@/assets/sounds/alerts/roadworks.mp3"),
  hazard:    require("@/assets/sounds/alerts/hazard.mp3"),
  pothole:   require("@/assets/sounds/alerts/pothole.mp3"),
  debris:    require("@/assets/sounds/alerts/debris.mp3"),
  breakdown: require("@/assets/sounds/alerts/breakdown.mp3"),
  weather:   require("@/assets/sounds/alerts/weather.mp3"),
  closure:   require("@/assets/sounds/alerts/closure.mp3"),
  clear:     require("@/assets/sounds/alerts/clear.mp3"),

  // Multi-alert variants — lead type + extras present nearby
  camera_multi:    require("@/assets/sounds/alerts/camera_multi.mp3"),
  police_multi:    require("@/assets/sounds/alerts/police_multi.mp3"),
  zone_multi:      require("@/assets/sounds/alerts/zone_multi.mp3"),
  alcoblow_multi:  require("@/assets/sounds/alerts/alcoblow_multi.mp3"),
  accident_multi:  require("@/assets/sounds/alerts/accident_multi.mp3"),
  traffic_multi:   require("@/assets/sounds/alerts/traffic_multi.mp3"),
  roadblock_multi: require("@/assets/sounds/alerts/roadblock_multi.mp3"),
  roadworks_multi: require("@/assets/sounds/alerts/roadworks_multi.mp3"),
  hazard_multi:    require("@/assets/sounds/alerts/hazard_multi.mp3"),
  pothole_multi:   require("@/assets/sounds/alerts/pothole_multi.mp3"),
  debris_multi:    require("@/assets/sounds/alerts/debris_multi.mp3"),
  breakdown_multi: require("@/assets/sounds/alerts/breakdown_multi.mp3"),
  weather_multi:   require("@/assets/sounds/alerts/weather_multi.mp3"),
  closure_multi:   require("@/assets/sounds/alerts/closure_multi.mp3"),
  clear_multi:     require("@/assets/sounds/alerts/clear_multi.mp3"),

  // Report confirmation
  report_submitted: require("@/assets/sounds/alerts/report_submitted.mp3"),
};

// ─── State ────────────────────────────────────────────────────────────────────

let currentPlayer: AudioPlayer | null = null;
let voiceDisabled = false;

export function setAlertVoiceDisabled(disabled: boolean) {
  voiceDisabled = disabled;
  if (disabled) stopAlertVoice();
}

export function getAlertVoiceDisabled(): boolean {
  return voiceDisabled;
}

export function stopAlertVoice() {
  try { currentPlayer?.pause(); } catch {}
  currentPlayer = null;
}

/** True while an alert or phrase is actively playing. Used by callers that
 *  want to avoid interrupting a turn instruction or other in-progress cue. */
export function isAlertVoicePlaying(): boolean {
  try { return currentPlayer?.playing ?? false; } catch { return false; }
}

// ─── Internal playback helper ─────────────────────────────────────────────────

async function playKey(key: string): Promise<void> {
  if (!key || voiceDisabled || Platform.OS === "web") return;
  stopAlertVoice();
  await ensureAudioMode(); // shared with sound.ts — fires setAudioModeAsync only once

  const bundled = ALERT_AUDIO[key];
  try {
    const source = bundled
      ? bundled
      : API_BASE
        ? { uri: `${API_BASE}/tts?text=${encodeURIComponent(key + " ahead")}` }
        : null;

    if (!source) return;
    const player = createAudioPlayer(source as Parameters<typeof createAudioPlayer>[0]);
    currentPlayer = player;
    player.play();
  } catch (err) {
    console.warn("[alertTts] playback failed:", err);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Play the Yna Agalo advisory phrase for the given incident/zone type.
 *
 * Uses the pre-generated bundled MP3 when available; falls back to the
 * /api/tts server proxy for unknown types so nothing ever plays silently.
 * Stops any currently-playing alert to avoid overlap.
 *
 * Pass `"report_submitted"` to play the bundled post-report confirmation phrase.
 */
export async function speakAlert(type: string): Promise<void> {
  await playKey(type);
}

/**
 * Play the multi-alert variant phrase for the given lead incident type.
 * Falls back to the single-alert phrase if the _multi bundle is missing.
 */
export async function speakAlertMulti(type: string): Promise<void> {
  const multiKey = `${type}_multi`;
  await playKey(ALERT_AUDIO[multiKey] ? multiKey : type);
}

// ─── Navigation lifecycle phrases ────────────────────────────────────────────
// Spoken by Yna Agalo at the start and end of every trip. On-demand via
// /api/tts (responses cached 90 days in object storage so the first playback
// hits ElevenLabs once; every subsequent trip is instant and free).

const NAV_START_TEXT =
  "Navigation started! Your route is ready — follow along as I guide you. " +
  "If you spot anything on the road, tap to report it. " +
  "Watch out for incidents flagged by other drivers — " +
  "I'll sound an alert before you reach them. " +
  "Stay focused on the road, and have a safe journey!";

const NAV_END_TEXT =
  "You've arrived! If any of the incidents you passed are now clear, " +
  "please update them so other drivers know. " +
  "Have a lovely time ahead, and remember to come back!";

/** Play the friendly navigation-start briefing (Yna Agalo via /api/tts). */
export async function speakNavStart(): Promise<void> {
  await speakAlertPhrase(NAV_START_TEXT);
}

/** Play the arrival / trip-end sign-off (Yna Agalo via /api/tts). */
export async function speakNavEnd(): Promise<void> {
  await speakAlertPhrase(NAV_END_TEXT);
}

/**
 * Speak an arbitrary phrase via the /api/tts server proxy (Yna Agalo voice).
 * Used for ad-hoc alerts that don't have a pre-generated bundled file.
 */
export async function speakAlertPhrase(text: string): Promise<void> {
  if (voiceDisabled || Platform.OS === "web" || !API_BASE) return;
  stopAlertVoice();
  await ensureAudioMode();
  try {
    const player = createAudioPlayer({ uri: `${API_BASE}/tts?text=${encodeURIComponent(text)}` });
    currentPlayer = player;
    player.play();
  } catch (err) {
    console.warn("[alertTts] speakAlertPhrase failed:", err);
  }
}
