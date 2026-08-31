const fs = require("node:fs/promises");
const path = require("node:path");
const { withDangerousMod } = require("expo/config-plugins");

/**
 * expo-notifications copies every configured custom sound to Android res/raw.
 * Android identifies raw resources by basename only, so paired files such as
 * camera.caf and camera.mp3 both become raw/camera and break resource merging.
 *
 * Keep MP3 files for Android notification channels and remove only the CAF
 * copies from the generated Android project. The iOS bundle is untouched.
 */
module.exports = function withAndroidNotificationSounds(config) {
  return withDangerousMod(config, [
    "android",
    async (mod) => {
      const rawResourcesDir = path.join(
        mod.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "raw",
      );

      let entries;
      try {
        entries = await fs.readdir(rawResourcesDir, { withFileTypes: true });
      } catch (error) {
        if (error?.code === "ENOENT") return mod;
        throw error;
      }

      await Promise.all(
        entries
          .filter(
            (entry) =>
              entry.isFile() && path.extname(entry.name).toLowerCase() === ".caf",
          )
          .map((entry) => fs.unlink(path.join(rawResourcesDir, entry.name))),
      );

      return mod;
    },
  ]);
};