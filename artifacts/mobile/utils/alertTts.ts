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
import { duckForAlert, releaseAlertAudioFocus } from "@/utils/sound";
import {
  canDeliverForegroundAlert,
  getAlertOwnershipGeneration,
  isCurrentAlertGeneration,
} from "@/utils/alertOwnership";
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
  clear:      require("@/assets/sounds/alerts/clear.mp3"),
  speed_bump: require("@/assets/sounds/alerts/speed_bump.mp3"),

  // Speed-limit-specific camera alerts
  camera_30:  require("@/assets/sounds/alerts/camera_30.mp3"),
  camera_50:  require("@/assets/sounds/alerts/camera_50.mp3"),
  camera_60:  require("@/assets/sounds/alerts/camera_60.mp3"),
  camera_80:  require("@/assets/sounds/alerts/camera_80.mp3"),
  camera_100: require("@/assets/sounds/alerts/camera_100.mp3"),
  camera_110: require("@/assets/sounds/alerts/camera_110.mp3"),

  // Speed-limit-specific zone alerts
  zone_30:  require("@/assets/sounds/alerts/zone_30.mp3"),
  zone_50:  require("@/assets/sounds/alerts/zone_50.mp3"),
  zone_60:  require("@/assets/sounds/alerts/zone_60.mp3"),
  zone_80:  require("@/assets/sounds/alerts/zone_80.mp3"),
  zone_100: require("@/assets/sounds/alerts/zone_100.mp3"),
  zone_110: require("@/assets/sounds/alerts/zone_110.mp3"),

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
  clear_multi:      require("@/assets/sounds/alerts/clear_multi.mp3"),
  speed_bump_multi: require("@/assets/sounds/alerts/speed_bump_multi.mp3"),

  // Report confirmation
  report_submitted: require("@/assets/sounds/alerts/report_submitted.mp3"),

  // Navigation lifecycle
  nav_start:  require("@/assets/sounds/alerts/nav_start.mp3"),
  nav_end:    require("@/assets/sounds/alerts/nav_end.mp3"),
  nav_cancel: require("@/assets/sounds/alerts/nav_cancel.mp3"),
};

// ─── Player cache ─────────────────────────────────────────────────────────────
// Keep only a few recently-used native players alive. Pre-creating a player for
// every bundled clip can exhaust the platform decoder/player pool and leave all
// subsequent play() calls silently doing nothing.

const playerCache = new Map<string, AudioPlayer>();
const MAX_CACHED_PLAYERS = 4;

function getCachedPlayer(key: string): AudioPlayer | null {
  const bundled = ALERT_AUDIO[key];
  if (!bundled) return null;
  let player = playerCache.get(key);
  if (player) {
    // Refresh insertion order so eviction behaves like a small LRU cache.
    playerCache.delete(key);
    playerCache.set(key, player);
  }
  if (!player) {
    try {
      player = createAudioPlayer(bundled as Parameters<typeof createAudioPlayer>[0]);
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
    } catch {
      return null;
    }
  }
  return player;
}

/**
 * Drop all cached AudioPlayer instances so they are recreated fresh on the
 * next alert.
 *
 * Call this whenever the app returns to foreground after a system audio
 * interruption (phone call, Siri, Google Assistant, etc.).  iOS and Android
 * can leave native player objects in an error/interrupted state after such
 * events; `seekTo(0); play()` on a stale player silently fails — the code
 * looks correct but no sound ever comes out.  Clearing the cache forces
 * `getCachedPlayer()` to call `createAudioPlayer()` again, giving every
 * alert a brand-new native player that is guaranteed to be in a clean state.
 *
 * After clearing, call `prewarmAlertAudio()` to pre-initialize replacements
 * in the background so the very next alert still plays without a 1-3 s delay.
 */
export function resetAlertPlayerCache(): void {
  if (Platform.OS === "web") return;
  // Stop and discard every cached player. Expo Audio players hold native
  // resources; pausing before dropping the reference prevents them from
  // continuing to play (or holding audio focus) after the cache is cleared.
  for (const player of playerCache.values()) {
    try {
      player.pause();
      player.remove();
    } catch {}
  }
  playerCache.clear();
  currentPlayer = null;
}

// ─── State ────────────────────────────────────────────────────────────────────

let currentPlayer: AudioPlayer | null = null;
let currentPlaybackSubscription: { remove(): void } | null = null;
let voiceDisabled = false;

function watchPlaybackCompletion(player: AudioPlayer): void {
  currentPlaybackSubscription?.remove();
  currentPlaybackSubscription = player.addListener("playbackStatusUpdate", (status) => {
    if (!status.didJustFinish) return;
    currentPlaybackSubscription?.remove();
    currentPlaybackSubscription = null;
    if (currentPlayer === player) currentPlayer = null;
    // Let the decoder render its final frame before changing AVAudioSession.
    setTimeout(() => { void releaseAlertAudioFocus(); }, 250);
  });
}

export function setAlertVoiceDisabled(disabled: boolean) {
  voiceDisabled = disabled;
  if (disabled) stopAlertVoice();
}

export function getAlertVoiceDisabled(): boolean {
  return voiceDisabled;
}

export function stopAlertVoice() {
  currentPlaybackSubscription?.remove();
  currentPlaybackSubscription = null;
  try { currentPlayer?.pause(); } catch {}
  currentPlayer = null;
}

/** True while an alert or phrase is actively playing. Used by callers that
 *  want to avoid interrupting a turn instruction or other in-progress cue. */
export function isAlertVoicePlaying(): boolean {
  try { return currentPlayer?.playing ?? false; } catch { return false; }
}

// ─── Internal playback helper ─────────────────────────────────────────────────

async function playKey(key: string, expectedGeneration?: number): Promise<void> {
  if (!key || voiceDisabled || Platform.OS === "web") return;
  const ownsAlert =
    expectedGeneration == null ||
    (canDeliverForegroundAlert() && isCurrentAlertGeneration(expectedGeneration));
  if (!ownsAlert) return;
  stopAlertVoice();
  await duckForAlert(); // ducks BT music during dashcam recording; no-op on web
  if (
    expectedGeneration != null &&
    (!canDeliverForegroundAlert() || !isCurrentAlertGeneration(expectedGeneration))
  ) return;

  try {
    const cached = getCachedPlayer(key);
    if (cached) {
      // Reuse the pre-initialized player — seek to start and play immediately.
      // This path has no native initialization cost so audio starts in <50 ms.
      currentPlayer = cached;
      cached.volume = 0.5;
      await cached.seekTo(0);
      if (
        expectedGeneration != null &&
        (!canDeliverForegroundAlert() || !isCurrentAlertGeneration(expectedGeneration))
      ) return;
      watchPlaybackCompletion(cached);
      cached.play();
    } else {
      // Unknown key — fall back to the on-demand TTS proxy (no pre-generated asset).
      if (!API_BASE) return;
      const player = createAudioPlayer(
        { uri: `${API_BASE}/tts?text=${encodeURIComponent(key + " ahead")}` }
      );
      currentPlayer = player;
      player.volume = 0.5;
      if (
        expectedGeneration != null &&
        (!canDeliverForegroundAlert() || !isCurrentAlertGeneration(expectedGeneration))
      ) return;
      watchPlaybackCompletion(player);
      player.play();
    }
  } catch (err) {
    console.warn("[alertTts] playback failed:", err);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve a speed-limit-specific audio key for camera/zone alerts.
 *
 * Returns `camera_80` (or `zone_50`, etc.) when the type is "camera" or
 * "zone" AND a matching speed-limit asset is bundled.  Falls back to the
 * plain type key so the generic phrase still plays when no limit is known.
 */
export function resolveAlertKey(type: string, speedLimit?: number | null): string {
  if ((type === "camera" || type === "zone") && speedLimit != null) {
    const key = `${type}_${speedLimit}`;
    if (ALERT_AUDIO[key]) return key;
  }
  return type;
}

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
  await playKey(type, getAlertOwnershipGeneration());
}

/**
 * Play the multi-alert variant phrase for the given lead incident type.
 * Falls back to the single-alert phrase if the _multi bundle is missing.
 */
export async function speakAlertMulti(type: string): Promise<void> {
  const multiKey = `${type}_multi`;
  await playKey(ALERT_AUDIO[multiKey] ? multiKey : type, getAlertOwnershipGeneration());
}

// ─── Navigation lifecycle phrases ────────────────────────────────────────────
// Bundled MP3s (Yna Agalo, generated once via ElevenLabs Multilingual v2).
// Registered in ALERT_AUDIO above so playKey() resolves them from disk —
// no network call, no latency, plays on first trip.

/**
 * Alert clips are intentionally loaded on demand. Eagerly creating every
 * bundled player at startup can exhaust native audio resources and silence the
 * whole alert path. Kept as a no-op for call-site compatibility.
 */
export function prewarmAlertAudio(): void {
  // Intentionally empty.
}

/** @deprecated Use prewarmAlertAudio() — this alias kept for call-site compat. */
export function prewarmNavAudio(): void { prewarmAlertAudio(); }

/** Play the navigation-start briefing (bundled MP3, instant playback). */
export async function speakNavStart(): Promise<void> {
  await playKey("nav_start");
}

/** Play the arrival sign-off (bundled MP3, instant playback). */
export async function speakNavEnd(): Promise<void> {
  await playKey("nav_end");
}

/** Play the manual-cancel reminder to update road reports (bundled MP3). */
export async function speakNavCancel(): Promise<void> {
  await playKey("nav_cancel");
}

/**
 * Speak an arbitrary phrase via the /api/tts server proxy (Yna Agalo voice).
 * Used for ad-hoc alerts that don't have a pre-generated bundled file.
 */
export async function speakAlertPhrase(text: string): Promise<void> {
  if (voiceDisabled || Platform.OS === "web" || !API_BASE) return;
  const generation = getAlertOwnershipGeneration();
  if (!canDeliverForegroundAlert()) return;
  stopAlertVoice();
  await duckForAlert();
  if (!canDeliverForegroundAlert() || !isCurrentAlertGeneration(generation)) return;
  try {
    const player = createAudioPlayer({ uri: `${API_BASE}/tts?text=${encodeURIComponent(text)}` });
    currentPlayer = player;
    player.volume = 0.5;
    if (!canDeliverForegroundAlert() || !isCurrentAlertGeneration(generation)) return;
    watchPlaybackCompletion(player);
    player.play();
  } catch (err) {
    console.warn("[alertTts] speakAlertPhrase failed:", err);
  }
}
