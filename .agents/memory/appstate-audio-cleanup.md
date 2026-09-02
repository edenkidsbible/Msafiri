---
name: AppState audio cleanup
description: Preventing optional audio cleanup from crashing lifecycle transitions.
---

AppState transition handlers must not depend on nonessential sound-effect cleanup calls. Stop critical owned playback through its canonical owner, and let cached effect players be paused or reset elsewhere.

**Why:** A runtime export mismatch made an optional sound-stop helper undefined inside a background handler. The thrown TypeError became fatal and interrupted unrelated camera and drive lifecycle work.

**How to apply:** Keep AppState handlers non-throwing and minimal. Do not add direct calls to optional audio helpers unless their runtime availability is guarded and failure cannot escape the handler.