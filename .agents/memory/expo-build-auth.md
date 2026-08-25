---
name: Expo standalone build authorization
description: EAS submissions require a token authorized for the app's Expo owner and project.
---

An `EXPO_ACCESS_TOKEN` can exist in Replit Secrets yet still be rejected by EAS when it belongs to another Expo account or lacks access to the project. The failure appears as an entity authorization error before a build is queued.

**Why:** A standalone Android APK is required for native camera and remote-push validation, and Expo Go cannot substitute for it.

**How to apply:** Before submitting a preview or production build, confirm the configured Expo token can read the project owner and project ID; never expose the token in logs or chat.