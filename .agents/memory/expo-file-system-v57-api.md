---
name: expo-file-system v57 API change
description: expo-file-system@57 dropped the legacy functional API; use the /legacy subpath or the new File/Directory/Paths class-based API.
---

# expo-file-system v57 — Breaking API Change

## The Rule
`expo-file-system@57` (installed when you run `pnpm add expo-file-system` against Expo SDK 54) removed `cacheDirectory`, `getInfoAsync`, `writeAsStringAsync`, `makeDirectoryAsync`, and friends from the main package export. They now **throw at runtime** if called from the main import.

## Why
The package was redesigned around a class-based API: `File`, `Directory`, `Paths` from `expo-file-system`.  
The old functional API lives at `expo-file-system/legacy` (explicit subpath export) and still works without runtime errors — it just logs deprecation warnings.

## How to Apply

**Use the legacy subpath** when you need the old API (e.g. cacheDirectory, getInfoAsync, writeAsStringAsync):
```ts
import * as FileSystem from "expo-file-system/legacy";
// FileSystem.cacheDirectory, FileSystem.getInfoAsync, FileSystem.writeAsStringAsync all work
```

**Use the new API** for new code:
```ts
import { File, Directory, Paths } from "expo-file-system";
const dir = new Directory(Paths.cache, "my-subdir");
if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
const f = new File(dir, "audio.mp3");
f.write(new Uint8Array(buffer));   // write bytes
const uri = f.uri;                  // file:// URI for playback
const exists = f.exists;            // boolean
```

## Caveat on TypeScript types
The public `File` and `Directory` classes inherit from native module base classes. Some inherited methods (`exists`, `uri`, `write`, `create`) may not appear in the TypeScript types for the public class itself — they come from the native SharedObject base. If tsc complains, use the `/legacy` path instead.
