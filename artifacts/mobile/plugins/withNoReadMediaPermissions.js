/**
 * withNoReadMediaPermissions
 *
 * expo-media-library unconditionally injects READ_MEDIA_IMAGES and
 * READ_MEDIA_VIDEO into the AndroidManifest even when the app only uses
 * saveToLibraryAsync (write-only).  On Android 13+ (API 33+) Google Play
 * rejects apps that declare these broad storage permissions unless they can
 * prove a photo/video picker is technically insufficient.
 *
 * Our app only ever WRITES to the gallery (dashcam clip export).  The system
 * photo picker (used by expo-image-picker) and MediaLibrary.saveToLibraryAsync
 * with writeOnly:true do not need read access at all.
 *
 * This plugin runs after all other plugins and removes the two offending
 * <uses-permission> entries from the manifest.
 */

const { withAndroidManifest } = require("expo/config-plugins");

const BANNED = [
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
];

/** @param {import("expo/config-plugins").ExpoConfig} config */
module.exports = function withNoReadMediaPermissions(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;
    const permissions = manifest.manifest["uses-permission"] ?? [];

    manifest.manifest["uses-permission"] = permissions.filter((perm) => {
      const name = perm.$?.["android:name"] ?? "";
      return !BANNED.includes(name);
    });

    return mod;
  });
};
