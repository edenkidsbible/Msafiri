const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// ── Cache bust ────────────────────────────────────────────────────────────────
// Bump this string any time you change babel.config.js in a way that must
// invalidate all cached file transforms (e.g. adding/removing Babel plugins).
// Metro's per-file cache key incorporates this value, so every module gets
// re-transformed on the next bundle run.
config.cacheVersion = "babel-private-fields-v2";

module.exports = config;
