---
name: expo-file-system v19 legacy import
description: expo-file-system v19 changed to a class-based API; legacy string-path functions throw at runtime unless imported from the /legacy subpath.
---

# expo-file-system v19 Legacy Import

## Rule
Import all legacy file-system functions from `expo-file-system/legacy`, NOT from `expo-file-system`.

```typescript
// WRONG — throws "will throw in runtime" for all these functions
import * as FileSystem from "expo-file-system";
FileSystem.documentDirectory   // undefined
FileSystem.getInfoAsync(...)   // throws
FileSystem.moveAsync(...)      // throws
FileSystem.deleteAsync(...)    // throws
FileSystem.makeDirectoryAsync(...) // throws

// CORRECT
import * as FileSystem from "expo-file-system/legacy";
FileSystem.documentDirectory   // works
FileSystem.getInfoAsync(uri)   // note: InfoOptions has only { md5? } — NO { size: true }
FileSystem.moveAsync({ from, to })  // works
FileSystem.deleteAsync(uri, { idempotent: true }) // works
FileSystem.makeDirectoryAsync(uri, { intermediates: true }) // works
```

## Key Differences from Old API
- `getInfoAsync(uri)` — `InfoOptions` only has `{ md5?: boolean }`, no `size` option.
  The `size` field is on the RESULT (`FileInfo.size`) when `exists: true`.
- `documentDirectory` is still a string (can be null on web).

**Why:** expo-file-system v19 (SDK 54+) migrated to a class-based API (`File`, `Directory`, `Paths`). The legacy string-path API is preserved in `expo-file-system/legacy` for backward compatibility.

**How to apply:** Any time you install or use expo-file-system in an Expo SDK 54+ project, use the `/legacy` import path for all file-system operations that aren't using the new class-based API.
