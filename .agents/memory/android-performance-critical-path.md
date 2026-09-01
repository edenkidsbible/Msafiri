---
name: Android performance critical path
description: Startup and active-drive work that must stay off the Android first-render and hot GPS paths.
---

The native splash screen may wait for bundled font registration, but not for OTA checks or other network work. Bulk alert-audio prewarming should run only after initial interactions settle. Initial routing checks need bounded network timeouts.

**Why:** On weak mobile connections and lower-end Android hardware, OTA requests, audio-player creation, and long routing checks made a healthy app look frozen during launch.

**How to apply:** Keep nonessential startup work after first paint. During active drives, poll configuration infrequently and allow ordinary Android GPS delivery gaps before tearing down and recreating the native location subscription.