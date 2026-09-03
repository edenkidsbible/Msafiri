---
name: Per-platform app version builds
description: Native store build counters and force-update comparison rules for Msafiri.
---

Keep iOS and Android native build counters independent. EAS production remote auto-increment should produce future builds, but a store release that already matches the remote counter must be built once without incrementing. Force-update checks must compare semantic app version first and native build number when the semantic versions match, but only for an explicitly forced Admin release.

**Why:** iOS and Android can have different store build sequences, and comparing only the semantic version lets a same-version forced native build pass without showing the force-update screen. Publishing application code must not silently force an unreleased store build, and EAS remote counters cannot always be lowered after they advance.

**How to apply:** Before a release, confirm each platform's store build and EAS remote counter separately. Configure the release record with the next platform build and mark it as force-update when required.