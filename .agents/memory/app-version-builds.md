---
name: Per-platform app version builds
description: Native store build counters and force-update comparison rules for Msafiri.
---

Keep iOS and Android native build counters independent. The current store builds are the baseline; EAS production remote auto-increment must produce the next build for each platform. Force-update checks must compare semantic app version first and native build number when the semantic versions match.

**Why:** iOS and Android can have different store build sequences, and comparing only the semantic version lets a same-version forced native build pass without showing the force-update screen.

**How to apply:** Before a release, confirm each platform's store build and EAS remote counter separately. Configure the release record with the next platform build and mark it as force-update when required.