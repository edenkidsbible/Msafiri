---
name: Dashcam permission handoff
description: Rules for coordinating first-time camera permission, quick start, and background Dashcam startup.
---

First-time camera and microphone permission prompts belong to the pre-trip checklist, not the Home button's navigation transition. Quick start may bypass the checklist only when Dashcam auto-start is off or camera access is already granted.

**Why:** Prompting during navigation can leave the driver without a clear chance to grant access, while background recording waits for a native camera-ready callback and can otherwise remain visibly stuck in “Starting…”.

**How to apply:** Keep automatic drive-start recording non-prompting, re-read the OS camera grant before starting, and put a bounded timeout around the pending native-camera handshake that clears pending state and offers a visible retry/settings path.