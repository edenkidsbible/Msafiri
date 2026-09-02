---
name: Android native resource pressure
description: How to triage mixed Android OOM, audio, map-marker, graphics, Binder, and system-service crashes.
---

Treat a broad cluster of Android audio, map, graphics, Binder, and system-service failures as a shared native resource-pressure problem before chasing each framework stack independently.

**Why:** A release can appear to have many unrelated crashes when incompatible Expo native modules, unreleased transient audio players, overlapping playback ownership, and continuously tracked custom map markers are jointly exhausting memory and native threads.

**How to apply:** Run Expo dependency and doctor checks before app-code debugging. Keep cached and transient audio ownership distinct, invalidate in-flight playback during resets, release every transient player, and give custom map markers only a short visual-capture window before disabling `tracksViewChanges`.