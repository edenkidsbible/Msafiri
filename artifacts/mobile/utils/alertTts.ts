/**
 * alertTts.ts — Yna Agalo voice for road alerts and incident reports.
 *
 * All 15 alert phrases are pre-generated and bundled as MP3 assets so they
 * play instantly with zero network dependency. The server /api/tts route
 * acts as fallback for any type not covered here.
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

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Play the Yna Agalo advisory phrase for the given incident/zone type.
 *
 * Uses the pre-generated bundled MP3 when available; falls back to the
 * /api/tts server proxy for unknown types so nothing ever plays silently.
 * Stops any currently-playing alert to avoid overlap.
 */
export async function speakAlert(type: string): Promise<void> {
  if (!type || voiceDisabled || Platform.OS === "web") return;
  stopAlertVoice();
  await ensureAudioMode(); // shared with sound.ts — fires setAudioModeAsync only once

  const bundled = ALERT_AUDIO[type];
  try {
    const source = bundled
      ? bundled
      : API_BASE
        ? { uri: `${API_BASE}/tts?text=${encodeURIComponent(type + " ahead")}` }
        : null;

    if (!source) return;
    const player = createAudioPlayer(source as Parameters<typeof createAudioPlayer>[0]);
    currentPlayer = player;
    player.play();
  } catch (err) {
    console.warn("[alertTts] playback failed:", err);
  }
}
