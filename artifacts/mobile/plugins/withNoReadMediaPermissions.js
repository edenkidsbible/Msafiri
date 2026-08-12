/**
 * withNoReadMediaPermissions
 *
 * expo-media-library's Android AAR declares READ_MEDIA_IMAGES and
 * READ_MEDIA_VIDEO in its own bundled AndroidManifest.xml. Simply removing
 * them from the app-level manifest is not enough — Gradle's manifest merger
 * re-adds them from the library's manifest at build time.
 *
 * The correct approach is to add override entries with tools:node="remove",
 * which instructs the manifest merger to drop those permissions from the
 * final merged manifest regardless of where they came from.
 *
 * Reference: https://developer.android.com/studio/build/manifest-merge#node_markers
 */

const { withAndroidManifest } = require("expo/config-plugins");

const REMOVE_PERMISSIONS = [
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
];

/** @param {import("expo/config-plugins").ExpoConfig} config */
module.exports = function withNoReadMediaPermissions(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;

    // 1. Ensure the tools namespace is declared on the root <manifest> element
    //    so tools:node="remove" is a valid attribute.
    manifest.$ = manifest.$ ?? {};
    manifest.$["xmlns:tools"] =
      manifest.$["xmlns:tools"] ?? "http://schemas.android.com/tools";

    // 2. Remove any existing <uses-permission> entries for these permissions
    //    (in case they were added by a plugin before us).
    manifest["uses-permission"] = (manifest["uses-permission"] ?? []).filter(
      (perm) => !REMOVE_PERMISSIONS.includes(perm.$?.["android:name"] ?? "")
    );

    // 3. Add override entries with tools:node="remove" so Gradle's manifest
    //    merger strips these permissions even if a library AAR re-adds them.
    for (const permission of REMOVE_PERMISSIONS) {
      manifest["uses-permission"].push({
        $: {
          "android:name": permission,
          "tools:node": "remove",
        },
      });
    }

    return mod;
  });
};
