---
name: Expo tsconfig platform-file resolution
description: tsc fails to resolve imports of components that only exist as .native.tsx/.web.tsx (no plain .tsx), even though Metro resolves them fine at runtime.
---

## Rule
When a component only has `Foo.native.tsx` and `Foo.web.tsx` (no plain `Foo.tsx`), Metro resolves `import Foo from "@/components/Foo"` fine at runtime via platform extensions, but `tsc --noEmit` does not do platform-specific resolution by default and reports `Cannot find module`.

**Why:** TypeScript's module resolution doesn't know about React Native's platform-extension convention unless told. This silently accumulates as a "pre-existing" typecheck error in RN/Expo projects that use the `.native.tsx`/`.web.tsx` split pattern.

**How to apply:** Add `"moduleSuffixes": [".native", ".web", ""]` to the app's `tsconfig.json` `compilerOptions`. This makes `tsc` try each suffix in order when resolving bare imports, matching (approximately) Metro's behavior for typecheck purposes. It doesn't affect the actual bundler resolution, only `tsc`'s view of which file backs the import.
