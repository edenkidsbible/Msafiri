---
name: Dashcam permission handoff
description: Rules for coordinating first-time camera permission, quick start, and background Dashcam startup.
---

First-time camera and microphone permission prompts belong to the explicit Home Start Driving action, immediately before the pre-trip checklist. Quick start may bypass the checklist only when Dashcam auto-start is off or camera access was already granted before the tap.

**Why:** This timing gives the permission prompt clear driver intent without loading the native camera module during cold start. It also lets the checklist reflect the real grant and preview the Dashcam before Drive mounts its recording camera.

**How to apply:** Request from Start Driving before checklist navigation; keep automatic Drive recording non-prompting; re-read the OS grant before starting; bound the camera-ready handshake with a visible retry/settings path.