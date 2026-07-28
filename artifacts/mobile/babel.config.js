module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    // The hermesc Linux binary bundled with React Native does not support
    // private class field syntax (#x, #y …).  These three plugins instruct
    // Babel to downcompile them to plain properties before Hermes sees the
    // bundle, which fixes the "private properties are not supported" error
    // that surfaces when running `eas update` on a Linux machine.
    // Force Babel to downcompile private class field syntax (#x, #y …) before
    // the bundle reaches hermesc. The linux64 hermesc binary shipped with
    // react-native 0.81 rejects native private fields even though it claims
    // Hermes 0.12 support. Explicit plugins override @babel/preset-env's
    // target-based decision to leave them untouched.
    // NOTE: all three must be present and share the same loose setting to
    // avoid Babel's "loose mode must be consistent" error.
    plugins: [
      // react-native-reanimated's worklets plugin must run FIRST — before any
      // class-property transforms — so it sees the original AST.  If it runs
      // after the transforms below, it crashes with "Cannot read properties of
      // undefined (reading 'length')" on the already-mutated nodes.
      "react-native-reanimated/plugin",
      // Downcompile private class field syntax (#x, #y …) so the hermesc
      // linux64 binary in react-native 0.81 can compile the bundle.  These
      // must share the same (default) loose setting to avoid Babel's
      // "loose mode must be consistent" error.
      "@babel/plugin-transform-class-properties",
      "@babel/plugin-transform-private-methods",
      "@babel/plugin-transform-private-property-in-object",
    ],
  };
};
