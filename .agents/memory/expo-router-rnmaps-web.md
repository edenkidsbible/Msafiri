---
name: expo-router react-native-maps web bundling fix
description: How to prevent native-only modules (react-native-maps) from breaking web bundle in expo-router apps
---

## Rule
Never put platform-specific `.native.tsx` files inside `app/` (the expo-router routes directory). Expo-router's `require.context` will include ALL files in the app directory in the web bundle, regardless of the `.native.tsx` extension — breaking the build with "Importing native-only module on web".

**Why:** `require.context` scans the entire `app/` directory tree and feeds every matched file into Metro for web bundling, overriding Metro's normal platform-extension resolution.

**How to apply:**
1. Keep route files (`app/(tabs)/map.tsx`) simple — just re-export from a component.
2. Put platform-split logic in `components/`:
   - `components/MapViewScreen.native.tsx` — uses react-native-maps
   - `components/MapViewScreen.tsx` — re-exports the web version (or is itself the web version)
   - `components/MapViewScreen.web.tsx` — web-safe fallback (FlatList, no MapView)
3. Metro correctly resolves `.native.tsx` → native and `.web.tsx` / `.tsx` → web when the file is outside `app/`.

**Also:** expo-keep-awake and expo-sms ship as v56.x by default but need ~15.0.x and ~14.0.x for Expo SDK 54. Pin them explicitly: `expo-keep-awake@~15.0.8 expo-sms@~14.0.8`.
