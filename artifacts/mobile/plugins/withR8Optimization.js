const { withGradleProperties } = require("expo/config-plugins");

// Enables R8 full-mode optimization for Android release builds.
//
// R8 is Google's code shrinker and obfuscator (replacement for ProGuard).
// "Full mode" applies more aggressive optimizations beyond the ProGuard-
// compatible subset: better dead-code elimination, inlining, and class
// merging, which reduces APK/AAB size and improves runtime performance.
//
// Google Play surfaces a warning ("Your app is not optimized") when R8
// full mode is absent from the build. While R8 itself is the default
// minifier in modern AGP, full mode must be opted in explicitly via
// gradle.properties. This plugin injects the required property at EAS
// build time so no manual android/ directory edits are needed.
//
// iOS: no equivalent — Apple's compiler/linker handles dead-code stripping
// automatically via bitcode/LLVM; no action needed there.
function withR8Optimization(config) {
  return withGradleProperties(config, (config) => {
    const props = config.modResults;

    function setProperty(key, value) {
      const existing = props.find(
        (p) => p.type === "property" && p.key === key
      );
      if (existing) {
        existing.value = value;
      } else {
        props.push({ type: "property", key, value });
      }
    }

    // Enable R8 (should already be the default in AGP 7+, but make it explicit)
    setProperty("android.enableR8", "true");
    // Full mode: aggressive optimizations beyond ProGuard-compat subset
    setProperty("android.enableR8.fullMode", "true");

    return config;
  });
}

module.exports = withR8Optimization;
