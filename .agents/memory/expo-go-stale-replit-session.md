---
name: Expo Go stale Replit session
description: How to distinguish current source from an Expo Go device reusing an older Metro session.
---

A managed Expo workflow restart can preserve the same Expo endpoint while Expo Go continues using an older project session. Verify the manifest’s exact launch bundle contains the changed UI strings before treating source code as missing.

**Why:** A normal workflow restart left a connected Android Expo Go session showing the old UI even though the source and served bundle were current.

**How to apply:** Clear `/tmp/metro-cache` and the mobile artifact’s `.expo` session cache, restart the managed Expo workflow, then fetch the fresh Android manifest and inspect its exact launch bundle. The device may need to close the old Expo Go project and reopen the current QR session.