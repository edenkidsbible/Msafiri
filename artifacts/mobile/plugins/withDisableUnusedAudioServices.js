const { withAndroidManifest } = require("expo/config-plugins");

// expo-audio's native module unconditionally declares two foreground
// services in its own AndroidManifest.xml: AudioControlsService (lock-screen
// media controls, via androidx.media3 MediaSessionService) and
// AudioRecordingService (microphone recording). This app only plays short
// local chime/alert sounds — it never calls the lock-screen-controls APIs
// (setActiveForLockScreen/updateLockScreenMetadata) and never records audio
// (allowsRecording is always false) — so both services are dead code here.
//
// On Android 15+, Google Play flags them as "restricted foreground service
// types" reachable from a BOOT_COMPLETED broadcast receiver (pulled in
// transitively via androidx.media3), which can crash the app for Android 15
// users. Since the library's own manifest is merged in at Gradle build time
// (after this plugin runs), we can't edit its <service> tags directly — we
// instead declare the same fully-qualified service names in the app's own
// manifest with android:enabled="false" and tools:node/tools:replace hints
// so the Android manifest merger keeps them disabled in the final merged
// manifest, guaranteeing they can never be started by any code path.
const DISABLED_SERVICES = [
  "expo.modules.audio.service.AudioControlsService",
  "expo.modules.audio.service.AudioRecordingService",
];

function withDisableUnusedAudioServices(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";

    const application = manifest.application?.[0];
    if (!application) return config;
    if (!application.service) application.service = [];

    for (const name of DISABLED_SERVICES) {
      let service = application.service.find(
        (s) => s.$?.["android:name"] === name
      );
      if (!service) {
        service = { $: {} };
        application.service.push(service);
      }
      service.$["android:name"] = name;
      service.$["android:enabled"] = "false";
      service.$["tools:node"] = "merge";
      service.$["tools:replace"] = "android:enabled";
    }

    return config;
  });
}

module.exports = withDisableUnusedAudioServices;
