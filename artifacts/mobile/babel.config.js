module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],

    // react-native 0.81 introduced private class fields (#x, #y, #width,
    // #height) in its DOM geometry APIs (src/private/webapis/).  The hermesc
    // linux64 binary shipped in the npm package rejects that syntax, causing
    // "private properties are not supported" when running `eas update` on Linux.
    //
    // We use `overrides` + a path-scoped `include` so the transform applies
    // ONLY to that specific react-native path and never to
    // react-native-reanimated (which has its own Worklets Babel plugin that
    // crashes if class-property transforms run on its files first).
    overrides: [
      {
        include: /react-native[/\\]src[/\\]private/,
        plugins: [
          "@babel/plugin-transform-class-properties",
          "@babel/plugin-transform-private-methods",
          "@babel/plugin-transform-private-property-in-object",
        ],
      },
    ],
  };
};
