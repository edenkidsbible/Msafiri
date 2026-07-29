---
name: SDK-major package mismatch crash
description: DOMException startup crash caused by SDK 55-era packages on Expo SDK 54 / RN 0.81 Hermes
---

Rule: keep every expo-* and Sentry package on the versions `npx expo install --check` expects for the installed Expo SDK; packages built for a newer SDK/RN assume newer Hermes globals (e.g. `DOMException`, provided from RN 0.82) and crash at module load on iOS with `[runtime not ready]: ReferenceError: Property 'DOMException' doesn't exist`.

**Why:** expo-file-system@57 and @sentry/react-native@8 (SDK 55 / RN 0.82-era) were installed on SDK 54 / RN 0.81.5; the crash surfaced only on real Hermes at startup. Correct SDK 54 pins: expo-file-system ~19.x, @sentry/react-native ~7.2.

**How to apply:** after adding/upgrading any native-adjacent dependency, run `expo install --check`. Debugging tips that worked: fetch the dev bundle from Metro with device params (`transform.engine=hermes&unstable_transformProfile=hermes-stable`) and evaluate it in a node `vm` context (which lacks DOMException) with proxy-stubbed native modules to reproduce module-scope global crashes.

Related gotchas hit during the same fix:
- `expo-speech` was an undeclared phantom dep (hoisted via another package's store entry); a peer re-resolve broke it — declare all imports in package.json.
- expo-file-system ships TS sources; with `moduleSuffixes [".native",".web",""]` tsc mis-resolves its internal `./ExponentFileSystem` to the .web shim and fails typecheck. Fix: tsconfig `paths` mapping `expo-file-system/legacy` → `./node_modules/expo-file-system/build/legacy/index.d.ts`.
