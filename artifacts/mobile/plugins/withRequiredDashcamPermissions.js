const { withAndroidManifest } = require("expo/config-plugins");

// expo-image-picker is configured without its own camera/microphone flows, so
// it emits tools:node="remove" entries for both permissions. Those removals are
// global and accidentally strip the permissions needed by expo-camera's
// dashcam and Crash Assistant features. Re-add them after all Expo plugins
// have run, without changing any iOS configuration.
const REQUIRED_PERMISSIONS = [
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
];

module.exports = function withRequiredDashcamPermissions(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const permissions = manifest["uses-permission"] ?? [];

    manifest["uses-permission"] = permissions.filter(
      (permission) => !REQUIRED_PERMISSIONS.includes(permission.$?.["android:name"] ?? ""),
    );

    for (const permission of REQUIRED_PERMISSIONS) {
      manifest["uses-permission"].push({
        $: { "android:name": permission },
      });
    }

    return mod;
  });
};