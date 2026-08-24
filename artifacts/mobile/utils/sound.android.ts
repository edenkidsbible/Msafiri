import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

const SOURCES = {
  confirm: require("@/assets/sounds/confirm_chime.mp3"),
  alert: require("@/assets/sounds/alert_tone.mp3"),
  pop: require("@/assets/sounds/notify_pop.mp3"),
} as const;

export type SoundKey = keyof typeof SOURCES;

const players: Partial<Record<SoundKey, AudioPlayer>> = {};
let soundsMuted = false;
let audioModePromise: Promise<void> | null = null;

/**
 * Android's alert path deliberately avoids the dashcam's recording audio-mode
 * changes. Android handles camera recording and playback audio focus separately;
 * changing the process audio mode mid-drive can leave short alert players silent.
 */
export async function ensureAudioMode(): Promise<void> {
  if (!audioModePromise) {
    audioModePromise = setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "duckOthers",
      allowsRecording: false,
      shouldPlayInBackground: true,
      shouldRouteThroughEarpiece: false,
    }).catch((error) => {
      audioModePromise = null;
      throw error;
    });
  }
  await audioModePromise;
}

export async function duckForAlert(): Promise<void> {
  await ensureAudioMode();
}

export async function setDashcamAudioMode(_recording: boolean): Promise<void> {
  // Android's camera module owns recording audio focus. Keeping alert audio
  // separate prevents a dashcam state change from muting road alerts.
}

export function resetAudioMode(): void {
  audioModePromise = null;
  for (const key of Object.keys(players) as SoundKey[]) {
    try {
      players[key]?.pause();
      players[key]?.remove();
    } catch {
      // The next alert recreates the player even if native cleanup was interrupted.
    }
    delete players[key];
  }
}

function getPlayer(key: SoundKey): AudioPlayer | null {
  try {
    if (!players[key]) {
      players[key] = createAudioPlayer(SOURCES[key], { downloadFirst: true });
    }
    return players[key]!;
  } catch (error) {
    console.warn(`[androidSound] Failed to create ${key} player:`, error);
    return null;
  }
}

export function setSoundsMuted(muted: boolean): void {
  soundsMuted = muted;
}

export function getSoundsMuted(): boolean {
  return soundsMuted;
}

export async function playSound(key: SoundKey): Promise<void> {
  if (soundsMuted) return;
  try {
    await ensureAudioMode();
    const player = getPlayer(key);
    if (!player) return;
    player.volume = 1;
    await player.seekTo(0);
    player.play();
  } catch (error) {
    // Native failures stay observable in Android logs and the next alert retries
    // setup instead of reusing a failed audio session.
    console.warn(`[androidSound] Failed to play ${key}:`, error);
    audioModePromise = null;
  }
}