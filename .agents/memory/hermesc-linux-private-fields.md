---
name: hermesc private-field error (RN 0.81 — all platforms)
description: hermesc in RN 0.81.5 rejects #field private class syntax on BOTH linux64 (eas update) AND macOS (eas build iOS). Fix is pnpm patches on the affected packages — do NOT use Babel plugins, they break react-native-reanimated's worklets plugin.
---

# hermesc private-field error (RN 0.81 — all platforms)

## The error
Both `eas update` (linux hermesc) and `eas build` (macOS hermesc) fail with:
```
error: private properties are not supported
    #focused;
```

## Affected packages (all patched)
Four packages use private class fields that hermesc rejects. All are patched via `pnpm patch`
and the patches live in `/workspace/patches/`:

| Package | Files patched |
|---|---|
| `react-native@0.81.5` | 23 files across `Libraries/` and `src/private/` |
| `@tanstack/query-core@5.101.0` | 12 files in `build/modern/` |
| `react-native-reanimated@4.1.7` | 4 files in `lib/module/` |
| `react-native-worklets@0.5.1` | 1 file in `lib/module/` |

Patches registered in `pnpm-workspace.yaml` under `patchedDependencies` — applied automatically on every `pnpm install`.

## Transform applied
`#fieldName` → `__priv_fieldName` across all affected files using `/tmp/transform-private-fields.js` (a simple regex replacement script — can be recreated if needed).

## Why NOT Babel plugins
The obvious fix (add `@babel/plugin-transform-class-properties` etc. to `babel.config.js`) breaks
`react-native-reanimated@4.1.7` + `react-native-worklets@0.5.1`: their Worklets Babel plugin crashes
with `Cannot read properties of undefined (reading 'length')` when class-property transforms mutate
the AST before it runs. Babel's `overrides.exclude` does NOT reliably prevent this in Metro's context.
Patching the source files directly is the only clean fix.

## If a new package appears
Run:
```bash
pnpm patch <package>@<version> --edit-dir /tmp/pkg-patch
node /tmp/transform-private-fields.js $(find /tmp/pkg-patch -name "*.js" | xargs grep -l "^\s*#[a-zA-Z]")
pnpm patch-commit /tmp/pkg-patch
```
