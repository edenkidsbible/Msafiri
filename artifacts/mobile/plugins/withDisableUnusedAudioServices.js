const { withAndroidManifest } = require("expo/config-plugins");

// expo-audio's native module unconditionally declares two foreground
// services in its own AndroidManifest.xml: AudioControlsService (lock-screen
// media controls, via androidx.media3 MediaSessionService) and
// AudioRecordingService (microphone recording). This app only plays short
// local chime/alert sounds — it never calls the lock-screen-controls APIs
// and never records audio — so both services are dead code here.
//
// On Android 15+, Google Play flags them as "restricted foreground service
// types" reachable from a BOOT_COMPLETED broadcast receiver (pulled in
// transitively via androidx.media3), which can crash the app for Android 15
// users.
//
// Setting android:enabled="false" (tools:node="merge") is insufficient —
// the services still *exist* in the merged manifest and Play still flags them.
// The correct fix is tools:node="remove", which instructs the Android manifest
// merger to delete these service entries entirely from the final merged
// manifest, so they cannot be started by any code path whatsoever.
const REMOVED_SERVICES = [
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

    for (const name of REMOVED_SERVICES) {
      // Remove any existing entry for this service first (avoids duplicates)
      application.service = application.service.filter(
        (s) => s.$?.["android:name"] !== name
      );
      // Declare the service with tools:node="remove" so the manifest merger
      // strips it — and any matching entry from library manifests — entirely
      // from the final merged AndroidManifest.xml.
      application.service.push({
        $: {
          "android:name": name,
          "tools:node": "remove",
        },
      });
    }

    return config;
  });
}

module.exports = withDisableUnusedAudioServices;
