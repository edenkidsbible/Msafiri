module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],

    // The hermesc binary shipped with react-native 0.81 (both linux64 and
    // macOS) rejects private class field syntax (#field).  Multiple packages
    // use private fields: react-native's DOM geometry APIs, expo-modules-core,
    // and others.  We transform them all — but we must EXCLUDE
    // react-native-reanimated because its Worklets Babel plugin crashes with
    // "Cannot read properties of undefined (reading 'length')" when class-
    // property transforms mutate the AST before the worklets plugin runs.
    // Reanimated does not itself use private fields that hermesc rejects, so
    // excluding it is safe.
    overrides: [
      {
        exclude: /react-native-reanimated|react-native-worklets/,
        plugins: [
          "@babel/plugin-transform-class-properties",
          "@babel/plugin-transform-private-methods",
          "@babel/plugin-transform-private-property-in-object",
        ],
      },
    ],
  };
};
