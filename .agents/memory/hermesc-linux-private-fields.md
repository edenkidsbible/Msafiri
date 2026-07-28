---
name: hermesc Linux private-field error
description: The hermesc linux64 binary shipped with RN 0.81.5 rejects JS private class field syntax (#x, #y…) — surfaces as "private properties are not supported" when running eas update on Linux (Replit). Fix is Babel-level downcompilation.
---

# hermesc Linux private-field error

## The error
Running `eas update` on Linux (Replit) fails with:
```
Failed to generate Hermes bytecode
error: private properties are not supported
    #x;
```

## Why
The `hermesc` linux64 binary bundled with `react-native@0.81.5` does not support private class field syntax (`#field`). Third-party packages that use `#` fields are bundled by Metro but then fail Hermes compilation.

## Fix
Add three Babel plugins to `babel.config.js` so private fields are downcompiled before Hermes sees the bundle:

```js
plugins: [
  ["@babel/plugin-transform-class-properties",          { loose: true }],
  ["@babel/plugin-transform-private-methods",           { loose: true }],
  ["@babel/plugin-transform-private-property-in-object",{ loose: true }],
],
```

Also add them as explicit devDependencies (they exist as transitive deps but pnpm hoisting is unreliable):
```
pnpm add -D @babel/plugin-transform-class-properties @babel/plugin-transform-private-methods @babel/plugin-transform-private-property-in-object
```

**Why loose:true:** Required for all three to be consistent — mixing strict and loose mode across class transforms causes a Babel error.
