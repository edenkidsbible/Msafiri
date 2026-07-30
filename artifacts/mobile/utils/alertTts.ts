/**
 * alertTts.ts — on-demand Yna Agalo voice for road alerts and incident reports.
 *
 * Fetches audio from the /api/tts proxy (which caches each phrase 90 days in
 * object storage so ElevenLabs is only billed once per unique phrase).
 * Uses expo-audio in duckOthers mode so music/podcasts fade briefly while the
 * alert plays, then recover.
 *
 * Silent-fails on any network/playback error so the visual alert still shows.
 */
import { Platform } from "react-native";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { API_BASE } from "@/utils/apiClient";

// ─── Audio mode ───────────────────────────────────────────────────────────────

let audioModeReady = false;

async function ensureAlertAudioMode() {
  if (audioModeReady || Platform.OS === "web") return;
  audioModeReady = true;
  try {
    await setAudioModeAsync({
      playsInSilentMode:          true,   // play even when ringer is silenced
      interruptionMode:           "duckOthers", // lower music, don't pause it
      allowsRecording:            false,
      shouldPlayInBackground:     true,
      shouldRouteThroughEarpiece: false,
    });
  } catch {
    // Non-critical — audio still works with system defaults
  }
}

// ─── State ────────────────────────────────────────────────────────────────────

let currentPlayer: AudioPlayer | null = null;
let voiceDisabled = false;

/** Globally enable/disable alert voice (e.g. from a settings toggle). */
export function setAlertVoiceDisabled(disabled: boolean) {
  voiceDisabled = disabled;
  if (disabled) stopAlertVoice();
}

export function getAlertVoiceDisabled(): boolean {
  return voiceDisabled;
}

/** Immediately stop any currently-playing alert voice. */
export function stopAlertVoice() {
  try {
    currentPlayer?.pause();
    // expo-audio players don't need an explicit destroy but release the ref
  } catch {}
  currentPlayer = null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Speak an alert phrase using the Yna Agalo voice.
 *
 * - Stops any currently-playing alert to avoid overlap.
 * - Fetches audio from /api/tts (cached server-side, so repeated calls are fast).
 * - No-ops on web or when the voice is disabled.
 */
export async function speakAlertPhrase(text: string): Promise<void> {
  if (voiceDisabled || Platform.OS === "web") return;
  if (!API_BASE) return; // API not configured (dev without domain)

  stopAlertVoice();
  await ensureAlertAudioMode();

  try {
    const url = `${API_BASE}/tts?text=${encodeURIComponent(text)}`;
    const player = createAudioPlayer({ uri: url });
    currentPlayer = player;
    player.play();
  } catch (err) {
    console.warn("[alertTts] playback failed:", err);
  }
}
