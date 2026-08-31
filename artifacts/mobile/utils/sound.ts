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

/**
 * Reset the cached audio-mode promise so the next `ensureAudioMode()` call
 * re-establishes the AVAudioSession from scratch.
 *
 * Call this whenever the app returns to foreground after a backgrounding event
 * that may have caused an iOS/Android audio-session interruption (phone call,
 * Siri, Google Assistant, navigation apps taking audio focus, etc.).  Without
 * this reset, `ensureAudioMode()` sees a resolved promise and skips
 * `setAudioModeAsync` — leaving all subsequent alert playback silent even
 * though the code path looks correct.
 */
export function resetAudioMode(): void {
  audioModePromise = null;
  // Also reset the duck-mode singleton so concurrent dashcam-path callers
  // don't join a stale in-flight call that can never resolve.
  duckModePromise  = null;
  // Clear the dashcam audio lock so ensureAudioMode() can reconfigure the
  // session cleanly after any background / foreground transition.  The dashcam
  // recording loop re-asserts dashcamAudioActive via setDashcamAudioMode(true)
  // within its next iteration if recording is still active.  Without this
  // reset, a recording session that ended abnormally (crash, permission revoke,
  // AVCaptureSession interruption) leaves dashcamAudioActive stuck true, which
  // makes every subsequent ensureAudioMode() a no-op — silencing all alerts.
  dashcamAudioActive = false;
}

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

/** Re-apply the canonical navigation/alert playback mode after a microphone
 * owner (for example Road Channels) has temporarily changed AVAudioSession. */
export async function restoreAudioMode(): Promise<void> {
  resetAudioMode();
  await ensureAudioMode();
}

// Debounce timer that restores MixWithOthers after the last alert finishes.
let duckRestoreTimer: ReturnType<typeof setTimeout> | null = null;
// Monotonically-increasing counter used to detect whether a restore timer has
// been superseded by a later alert before it fires.  Prevents two concurrent
// duckForAlert() calls from each scheduling a restore and having one of them
// leak and fire unexpectedly.
let duckRestoreGeneration = 0;
// Singleton promise for the duck setAudioModeAsync() call.  Without this,
// two simultaneous duckForAlert() invocations (e.g. the alert chime and the
// TTS voice firing at the same instant) both call setAudioModeAsync() at the
// same time.  iOS treats that as two concurrent AVAudioSession reconfigurations
// and can fail both — silencing every sound in the batch.  The singleton lets
// concurrent callers join the same in-flight call instead of racing it.
let duckModePromise: Promise<void> | null = null;

/**
 * Duck Bluetooth music momentarily for an alert, then restore full volume.
 *
 * When the dashcam is NOT recording: delegates to ensureAudioMode() which
 * already uses duckOthers — no change in behaviour.
 *
 * When the dashcam IS recording: the session is in PlayAndRecord+MixWithOthers
 * so that Bluetooth A2DP music plays alongside the camera microphone.  Alerts
 * in this mode previously mixed at full volume with the music, causing
 * clipping/distortion through the car speakers.
 *
 * This function temporarily switches to PlayAndRecord+DuckOthers (same
 * AVAudioSession CATEGORY — only the option changes, which is safe for the
 * active AVCaptureSession), lets the alert duck the music, then schedules a
 * restore back to MixWithOthers ~5 s after the last alert fires so music
 * returns to full volume automatically.  Rapid back-to-back alerts debounce
 * the restore so the mode never flips mid-alert.
 */
export async function duckForAlert(): Promise<void> {
  if (Platform.OS === "web") return;

  if (!dashcamAudioActive) {
    // Normal path: ensureAudioMode already serialises concurrent callers via
    // its own audioModePromise singleton — no additional protection needed.
    await ensureAudioMode();
    return;
  }

  // Dashcam path: temporarily duck while keeping the camera session alive.

  // Cancel any pending restore and bump the generation so any already-
  // scheduled restore timer knows it has been superseded.
  if (duckRestoreTimer !== null) {
    clearTimeout(duckRestoreTimer);
    duckRestoreTimer = null;
  }
  duckRestoreGeneration += 1;
  const myGeneration = duckRestoreGeneration;

  // Serialise concurrent calls — only one setAudioModeAsync() fires even if
  // the alert chime and the TTS voice are triggered in the same JS tick.
  if (!duckModePromise) {
    duckModePromise = setAudioModeAsync({
      // Switching interruptionMode within PlayAndRecord does NOT change the
      // AVAudioSession category (allowsRecording stays true) so the active
      // AVCaptureSession is unaffected.  This only adjusts the session option
      // that controls how other apps' audio output is treated.
      playsInSilentMode:          true,
      interruptionMode:           "duckOthers",
      allowsRecording:            true,   // keep PlayAndRecord — camera stays live
      shouldPlayInBackground:     true,
      shouldRouteThroughEarpiece: false,
    }).catch(() => {
      // Non-fatal: alert plays mixed rather than ducked; camera continues.
    }).finally(() => {
      duckModePromise = null;
    });
  }
  await duckModePromise;

  // Only the caller that holds the current generation schedules the restore
  // timer.  If another alert arrived while we were awaiting (bumping the
  // generation), we skip — the newer caller already owns the timer.
  if (myGeneration !== duckRestoreGeneration) return;

  // Restore MixWithOthers ~5 s after the last alert fires.  Debounced so
  // rapid consecutive alerts don't flip the session back between cues.
  duckRestoreTimer = setTimeout(async () => {
    duckRestoreTimer = null;
    if (!dashcamAudioActive) return; // dashcam stopped while we were waiting
    try {
      await setAudioModeAsync({
        playsInSilentMode:          true,
        interruptionMode:           "mixWithOthers",
        allowsRecording:            true,
        shouldPlayInBackground:     true,
        shouldRouteThroughEarpiece: false,
      });
    } catch { /* non-critical */ }
  }, 5_000);
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
  await duckForAlert();
  const player = getPlayer(key);
  if (!player) return;
  try {
    player.seekTo(0);
    player.play();
  } catch (e) {
    console.warn(`[sound] Failed to play "${key}":`, e);
  }
}

