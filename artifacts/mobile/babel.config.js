module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    // The hermesc Linux binary bundled with React Native does not support
    // private class field syntax (#x, #y …).  These three plugins instruct
    // Babel to downcompile them to plain properties before Hermes sees the
    // bundle, which fixes the "private properties are not supported" error
    // that surfaces when running `eas update` on a Linux machine.
    plugins: [
      ["@babel/plugin-transform-class-properties", { loose: true }],
      ["@babel/plugin-transform-private-methods",  { loose: true }],
      ["@babel/plugin-transform-private-property-in-object", { loose: true }],
    ],
  };
};
