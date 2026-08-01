// getSentryExpoConfig wraps expo/metro-config's getDefaultConfig and injects
// debug IDs into bundles so crash stacks can be matched to source maps.
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

// react-native-worklets 0.5.x ships pre-compiled JS that contains ES2022
// private class fields (#workletsModuleProxy etc.) in lib/module/.
// The hermesc compiler bundled with React Native 0.81.x cannot compile
// private class fields, so production / EAS / OTA builds fail at the
// Hermes bytecode step. Setting transformIgnorePatterns forces Metro to
// run Babel over those packages first, downlevelling the syntax before
// hermesc ever sees it. babel-preset-expo already includes the class
// properties transform, so no extra Babel plugin is needed.
config.transformer.transformIgnorePatterns = [
  "node_modules/(?!(react-native|@react-native(-community)?|react-native-worklets|react-native-reanimated|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|native-base|react-native-svg|react-native-gesture-handler|react-native-screens|react-native-safe-area-context|react-native-maps|react-native-keyboard-controller|react-native-purchases)/).*",
];

// expo-dev-client installs expo-dev-menu-interface, which creates a randomly-
// numbered _tmp_ directory for native source watching. Metro tries to watch
// that path before the directory is fully initialised, causing an ENOENT
// crash on startup. Block those temp paths so Metro never watches them.
config.resolver = config.resolver ?? {};
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : config.resolver.blockList
    ? [config.resolver.blockList]
    : []),
  /expo-dev-menu-interface_tmp_/,
];

module.exports = config;
