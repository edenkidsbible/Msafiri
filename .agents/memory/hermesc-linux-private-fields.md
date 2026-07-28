---
name: hermesc private-field error (RN 0.81 — all platforms)
description: hermesc in RN 0.81.5 rejects #field private class syntax on BOTH linux64 (eas update) AND macOS (eas build iOS). Multiple packages affected. Fix is a global Babel override that excludes react-native-reanimated.
---

# hermesc private-field error (RN 0.81 — all platforms)

## The error
Both `eas update` (linux hermesc) and `eas build` (macOS hermesc) fail with:
```
error: private properties are not supported
    #registry;
```

## Affected packages (confirmed)
- `react-native/src/private/webapis/geometry/DOMRectReadOnly.js` — `#x`, `#y`, `#width`, `#height`
- Other packages using `#registry`, `#listenerCount`, `#updateSubscription` (expo-modules-core and others)
- Multiple packages — the scope is **global**, not limited to one file

## Why the transform is tricky
Adding the three Babel plugins globally breaks `react-native-reanimated@4.x` + `react-native-worklets@0.5.1`:
the Worklets Babel plugin crashes with `Cannot read properties of undefined (reading 'length')` when
the class-property transforms mutate the AST before it runs. Reanimated's plugin needs to see the
original AST. Reanimated itself does NOT use private fields that hermesc rejects, so excluding it is safe.

## Working fix — babel.config.js
```js
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
```

## Also required — metro.config.js
```js
config.cacheVersion = "babel-private-fields-v4"; // bump when babel.config.js changes
```
Metro caches per-file transforms keyed on config hash. Without a cacheVersion bump the
old (untransformed) cached output is reused and the plugins appear to have no effect.

## devDependencies needed
```
pnpm add -D @babel/plugin-transform-class-properties @babel/plugin-transform-private-methods @babel/plugin-transform-private-property-in-object babel-preset-expo
```
(`babel-preset-expo` was missing as an explicit dep despite being used in babel.config.js)

**Why:** EAS hermesc (both platforms) claims Hermes 0.12 support (which includes private fields) but the
binary shipped in the react-native npm package has a bug — it rejects the syntax at compile time.
