import { Platform } from "react-native";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { duckForAlert, releaseAlertAudioFocus } from "@/utils/sound";
import { API_BASE } from "@/utils/apiClient";
import {
  canDeliverForegroundAlert,
  getAlertOwnershipGeneration,
  isCurrentAlertGeneration,
} from "@/utils/alertOwnership";

const ALERT_AUDIO: Record<string, unknown> = {
  camera: require("@/assets/sounds/alerts/camera.mp3"),
  police: require("@/assets/sounds/alerts/police.mp3"),
  zone: require("@/assets/sounds/alerts/zone.mp3"),
  alcoblow: require("@/assets/sounds/alerts/alcoblow.mp3"),
  accident: require("@/assets/sounds/alerts/accident.mp3"),
  traffic: require("@/assets/sounds/alerts/traffic.mp3"),
  roadblock: require("@/assets/sounds/alerts/roadblock.mp3"),
  roadworks: require("@/assets/sounds/alerts/roadworks.mp3"),
  hazard: require("@/assets/sounds/alerts/hazard.mp3"),
  pothole: require("@/assets/sounds/alerts/pothole.mp3"),
  debris: require("@/assets/sounds/alerts/debris.mp3"),
  breakdown: require("@/assets/sounds/alerts/breakdown.mp3"),
  weather: require("@/assets/sounds/alerts/weather.mp3"),
  closure: require("@/assets/sounds/alerts/closure.mp3"),
  clear: require("@/assets/sounds/alerts/clear.mp3"),
  speed_bump: require("@/assets/sounds/alerts/speed_bump.mp3"),
  // Speed-limit-specific camera alerts
  camera_30: require("@/assets/sounds/alerts/camera_30.mp3"),
  camera_50: require("@/assets/sounds/alerts/camera_50.mp3"),
  camera_60: require("@/assets/sounds/alerts/camera_60.mp3"),
  camera_80: require("@/assets/sounds/alerts/camera_80.mp3"),
  camera_100: require("@/assets/sounds/alerts/camera_100.mp3"),
  camera_110: require("@/assets/sounds/alerts/camera_110.mp3"),
  // Speed-limit-specific zone alerts
  zone_30: require("@/assets/sounds/alerts/zone_30.mp3"),
  zone_50: require("@/assets/sounds/alerts/zone_50.mp3"),
  zone_60: require("@/assets/sounds/alerts/zone_60.mp3"),
  zone_80: require("@/assets/sounds/alerts/zone_80.mp3"),
  zone_100: require("@/assets/sounds/alerts/zone_100.mp3"),
  zone_110: require("@/assets/sounds/alerts/zone_110.mp3"),
  camera_multi: require("@/assets/sounds/alerts/camera_multi.mp3"),
  police_multi: require("@/assets/sounds/alerts/police_multi.mp3"),
  zone_multi: require("@/assets/sounds/alerts/zone_multi.mp3"),
  alcoblow_multi: require("@/assets/sounds/alerts/alcoblow_multi.mp3"),
  accident_multi: require("@/assets/sounds/alerts/accident_multi.mp3"),
  traffic_multi: require("@/assets/sounds/alerts/traffic_multi.mp3"),
  roadblock_multi: require("@/assets/sounds/alerts/roadblock_multi.mp3"),
  roadworks_multi: require("@/assets/sounds/alerts/roadworks_multi.mp3"),
  hazard_multi: require("@/assets/sounds/alerts/hazard_multi.mp3"),
  pothole_multi: require("@/assets/sounds/alerts/pothole_multi.mp3"),
  debris_multi: require("@/assets/sounds/alerts/debris_multi.mp3"),
  breakdown_multi: require("@/assets/sounds/alerts/breakdown_multi.mp3"),
  weather_multi: require("@/assets/sounds/alerts/weather_multi.mp3"),
  closure_multi: require("@/assets/sounds/alerts/closure_multi.mp3"),
  clear_multi: require("@/assets/sounds/alerts/clear_multi.mp3"),
  speed_bump_multi: require("@/assets/sounds/alerts/speed_bump_multi.mp3"),
  report_submitted: require("@/assets/sounds/alerts/report_submitted.mp3"),
  nav_start: require("@/assets/sounds/alerts/nav_start.mp3"),
  nav_end: require("@/assets/sounds/alerts/nav_end.mp3"),
  nav_cancel: require("@/assets/sounds/alerts/nav_cancel.mp3"),
};

const playerCache = new Map<string, AudioPlayer>();
const MAX_CACHED_PLAYERS = 4;
let currentPlayer: AudioPlayer | null = null;
let currentPlaybackSubscription: { remove(): void } | null = null;
let playbackRequestGeneration = 0;
let focusReleaseTimer: ReturnType<typeof setTimeout> | null = null;
let voiceDisabled = false;
const BLUETOOTH_DRAIN_MS = 1_000;

function cancelPendingFocusRelease(): void {
  if (focusReleaseTimer === null) return;
  clearTimeout(focusReleaseTimer);
  focusReleaseTimer = null;
}

function isCachedPlayer(player: AudioPlayer): boolean {
  for (const cached of playerCache.values()) {
    if (cached === player) return true;
  }
  return false;
}

function stopCurrentPlayer(): void {
  const player = currentPlayer;
  currentPlaybackSubscription?.remove();
  currentPlaybackSubscription = null;
  currentPlayer = null;
  if (!player) return;
  try {
    player.pause();
    if (!isCachedPlayer(player)) player.remove();
  } catch {
    // Native resources may already have been released by an interruption.
  }
}

function watchPlaybackCompletion(player: AudioPlayer): void {
  currentPlaybackSubscription?.remove();
  currentPlaybackSubscription = player.addListener("playbackStatusUpdate", (status) => {
    if (!status.didJustFinish) return;
    // A stale native completion event must never restore audio mode while a
    // newer Yna clip is using Bluetooth audio focus.
    if (currentPlayer !== player) return;
    currentPlaybackSubscription?.remove();
    currentPlaybackSubscription = null;
    currentPlayer = null;
    if (!isCachedPlayer(player)) {
      try {
        player.remove();
      } catch {
        // The native player may already have been released.
      }
    }
    cancelPendingFocusRelease();
    // Car head units can retain close to a second of decoded A2DP audio. Keep
    // exclusive focus until that tail drains, then restore music only if no
    // newer alert has started.
    focusReleaseTimer = setTimeout(() => {
      focusReleaseTimer = null;
      if (currentPlayer !== null) return;
      void releaseAlertAudioFocus();
    }, BLUETOOTH_DRAIN_MS);
  });
}

function getCachedPlayer(key: string): AudioPlayer | null {
  const source = ALERT_AUDIO[key];
  if (!source) return null;
  let player = playerCache.get(key);
  if (player) {
    playerCache.delete(key);
    playerCache.set(key, player);
  }
  if (!player) {
    try {
      player = createAudioPlayer(
        source as Parameters<typeof createAudioPlayer>[0],
        { downloadFirst: true },
      );
      playerCache.set(key, player);
      if (playerCache.size > MAX_CACHED_PLAYERS) {
        const oldestKey = playerCache.keys().next().value as string | undefined;
        if (oldestKey) {
          const oldest = playerCache.get(oldestKey);
          playerCache.delete(oldestKey);
          try {
            oldest?.pause();
            oldest?.remove();
          } catch {}
        }
      }
    } catch (error) {
      console.warn(`[androidAlertTts] Failed to create ${key} player:`, error);
      return null;
    }
  }
  return player;
}

export function resetAlertPlayerCache(): void {
  playbackRequestGeneration += 1;
  cancelPendingFocusRelease();
  stopCurrentPlayer();
  for (const player of playerCache.values()) {
    try {
      player.pause();
      player.remove();
    } catch {
      // Recreating a player is still safe after an interrupted native cleanup.
    }
  }
  playerCache.clear();
}

export function setAlertVoiceDisabled(disabled: boolean): void {
  voiceDisabled = disabled;
  if (disabled) stopAlertVoice();
}

export function getAlertVoiceDisabled(): boolean {
  return voiceDisabled;
}

export function stopAlertVoice(): void {
  playbackRequestGeneration += 1;
  cancelPendingFocusRelease();
  stopCurrentPlayer();
}

export function isAlertVoicePlaying(): boolean {
  try {
    return currentPlayer?.playing ?? false;
  } catch {
    return false;
  }
}

async function playKey(key: string, expectedGeneration?: number): Promise<void> {
  if (!key || voiceDisabled || Platform.OS !== "android") return;
  if (
    expectedGeneration != null &&
    (!canDeliverForegroundAlert() || !isCurrentAlertGeneration(expectedGeneration))
  ) return;
  const requestGeneration = ++playbackRequestGeneration;
  stopCurrentPlayer();
  try {
    await duckForAlert();
    if (
      requestGeneration !== playbackRequestGeneration ||
      expectedGeneration != null &&
      (!canDeliverForegroundAlert() || !isCurrentAlertGeneration(expectedGeneration))
    ) return;
    const player = getCachedPlayer(key);
    if (player) {
      currentPlayer = player;
      player.volume = 0.5;
      await player.seekTo(0);
      if (
        requestGeneration !== playbackRequestGeneration ||
        expectedGeneration != null &&
        (!canDeliverForegroundAlert() || !isCurrentAlertGeneration(expectedGeneration))
      ) {
        if (
          requestGeneration === playbackRequestGeneration &&
          currentPlayer === player
        ) {
          try { player.pause(); } catch {}
          currentPlayer = null;
        }
        return;
      }
      watchPlaybackCompletion(player);
      player.play();
      return;
    }
    if (!API_BASE) return;
    const remotePlayer = createAudioPlayer(
      { uri: `${API_BASE}/tts?text=${encodeURIComponent(`${key} ahead`)}` },
      { downloadFirst: true },
    );
    currentPlayer = remotePlayer;
    remotePlayer.volume = 0.5;
    if (
      requestGeneration !== playbackRequestGeneration ||
      expectedGeneration != null &&
      (!canDeliverForegroundAlert() || !isCurrentAlertGeneration(expectedGeneration))
    ) {
      if (currentPlayer === remotePlayer) currentPlayer = null;
      try {
        remotePlayer.pause();
        remotePlayer.remove();
      } catch {}
      return;
    }
    watchPlaybackCompletion(remotePlayer);
    remotePlayer.play();
  } catch (error) {
    if (requestGeneration === playbackRequestGeneration) stopCurrentPlayer();
    console.warn("[androidAlertTts] Playback failed:", error);
  }
}

/**
 * Resolve a speed-limit-specific audio key for camera/zone alerts.
 * Returns e.g. "camera_80" when bundled; falls back to the plain type key.
 */
export function resolveAlertKey(type: string, speedLimit?: number | null): string {
  if ((type === "camera" || type === "zone") && speedLimit != null) {
    const key = `${type}_${speedLimit}`;
    if (ALERT_AUDIO[key]) return key;
  }
  return type;
}

export async function speakAlert(type: string): Promise<void> {
  await playKey(type, getAlertOwnershipGeneration());
}

export async function speakAlertMulti(type: string): Promise<void> {
  const multiKey = `${type}_multi`;
  await playKey(ALERT_AUDIO[multiKey] ? multiKey : type, getAlertOwnershipGeneration());
}

export function prewarmAlertAudio(): void {
  // Intentionally load on demand. Creating every native player at startup can
  // exhaust Android's decoder/player pool and leave all alert clips silent.
}

export function prewarmNavAudio(): void {
  prewarmAlertAudio();
}

export async function speakNavStart(): Promise<void> {
  await playKey("nav_start");
}

export async function speakNavEnd(): Promise<void> {
  await playKey("nav_end");
}

export async function speakNavCancel(): Promise<void> {
  await playKey("nav_cancel");
}

export async function speakAlertPhrase(text: string): Promise<void> {
  if (voiceDisabled || !API_BASE) return;
  const generation = getAlertOwnershipGeneration();
  if (!canDeliverForegroundAlert()) return;
  const requestGeneration = ++playbackRequestGeneration;
  stopCurrentPlayer();
  try {
    await duckForAlert();
    if (
      requestGeneration !== playbackRequestGeneration ||
      !canDeliverForegroundAlert() ||
      !isCurrentAlertGeneration(generation)
    ) return;
    const player = createAudioPlayer(
      { uri: `${API_BASE}/tts?text=${encodeURIComponent(text)}` },
      { downloadFirst: true },
    );
    currentPlayer = player;
    player.volume = 0.5;
    if (
      requestGeneration !== playbackRequestGeneration ||
      !canDeliverForegroundAlert() ||
      !isCurrentAlertGeneration(generation)
    ) {
      if (currentPlayer === player) currentPlayer = null;
      try {
        player.pause();
        player.remove();
      } catch {}
      return;
    }
    watchPlaybackCompletion(player);
    player.play();
  } catch (error) {
    if (requestGeneration === playbackRequestGeneration) stopCurrentPlayer();
    console.warn("[androidAlertTts] Phrase playback failed:", error);
  }
}