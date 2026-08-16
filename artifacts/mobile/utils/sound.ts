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
// Set to true while the dashcam is actively recording with audio so that
// ensureAudioMode() doesn't override back to allowsRecording:false mid-clip.
let dashcamAudioActive = false;

// Promise singleton for the audio-mode setup.  Using a boolean "ready" flag
// had a race condition: the flag was set to true BEFORE the async
// setAudioModeAsync call completed, so a second concurrent caller would see
// the flag and skip the await — then immediately start playing before the
// session was actually configured.  A promise lets every concurrent caller
// await the *same* setup, so the first one performs the work and all others
// just join the wait.
let audioModePromise: Promise<void> | null = null;

/** Configure the iOS/Android audio session for alert playback.
 *  Idempotent — all concurrent callers await the same promise.
 *  No-ops while dashcam audio is active (dashcam owns the session then). */
export async function ensureAudioMode() {
  if (Platform.OS === "web" || dashcamAudioActive) return;
  if (!audioModePromise) {
    audioModePromise = setAudioModeAsync({
      // Play alerts even if the phone's ringer is silenced (like nav apps do).
      playsInSilentMode: true,
      // Duck music/podcasts while the alert plays, then restore volume.
      interruptionMode: "duckOthers",
      allowsRecording: false,
      shouldPlayInBackground: true,
      shouldRouteThroughEarpiece: false,
    }).catch(() => {
      // On failure reset so the next call retries rather than permanently
      // blocking on a rejected promise.
      audioModePromise = null;
    });
  }
  await audioModePromise;
}

/**
 * Switch the iOS AVAudioSession so the dashcam microphone and Bluetooth A2DP
 * music can coexist.
 *
 * recording = true  → PlayAndRecord + MixWithOthers
 *   iOS keeps the A2DP (high-quality BT audio) route active, the device
 *   microphone records alongside it, and in-app alerts play over the top.
 *
 * recording = false → restore the baseline PlayAndRecord-off / DuckOthers mode
 *   so alert sounds duck music again and no recording route is held open.
 *
 * On Android, the OS audio-focus system already allows simultaneous A2DP + mic;
 * this call is still safe to make there (expo-audio passes the options through)
 * but has no behavioural effect on most Android devices.
 */
export async function setDashcamAudioMode(recording: boolean): Promise<void> {
  if (Platform.OS === "web") return;
  dashcamAudioActive = recording;
  try {
    if (recording) {
      // While the dashcam is rolling, reset the alert-mode promise so that
      // when recording stops and ensureAudioMode() is called again it will
      // actually re-run setAudioModeAsync (the dashcam may have overwritten it).
      audioModePromise = null;
      await setAudioModeAsync({
        playsInSilentMode:          true,
        // mixWithOthers: don't interrupt other apps' audio output (BT music).
        interruptionMode:           "mixWithOthers",
        // allowsRecording:true → iOS uses AVAudioSessionCategoryPlayAndRecord,
        // which keeps the microphone open without killing the A2DP output route.
        allowsRecording:            true,
        shouldPlayInBackground:     true,
        shouldRouteThroughEarpiece: false,
      });
    } else {
      await setAudioModeAsync({
        playsInSilentMode:          true,
        interruptionMode:           "duckOthers",
        allowsRecording:            false,
        shouldPlayInBackground:     true,
        shouldRouteThroughEarpiece: false,
      });
      // Mode is now set to duckOthers; cache a resolved promise so that
      // ensureAudioMode() becomes a no-op until the dashcam overrides it again.
      audioModePromise = Promise.resolve();
    }
  } catch {
    // Non-critical — recording continues, music may be briefly interrupted.
    //
    // IMPORTANT: do NOT reset dashcamAudioActive to false on failure when
    // recording=true.  If we do, every subsequent ensureAudioMode() call from
    // an alert sound will try to set DuckOthers on the live audio session —
    // each of those reconfigurations can interrupt the camera's AVCaptureSession
    // and cause recordAsync() to return null or throw, draining retry budgets
    // and eventually stopping the dashcam.  Keeping dashcamAudioActive=true
    // means ensureAudioMode() stays a no-op for the duration of the recording;
    // the session reverts to DuckOthers when setDashcamAudioMode(false) is
    // called explicitly at recording end.
    if (!recording) {
      dashcamAudioActive = false;
    }
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

