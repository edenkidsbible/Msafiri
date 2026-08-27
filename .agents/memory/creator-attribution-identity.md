---
name: Creator benefit trust boundary
description: Durable security rules for creator identity and activity enforcement.
---

Never let a raw client-supplied identifier or unverified report directly determine creator-benefit eligibility. Legacy identity repair must require verified ownership.

**Why:** Client identifiers and report requests can be spoofed; using them directly lets a creator or attacker defeat inactivity enforcement or redirect attribution.

**How to apply:** Count only independently verified activity, authenticate identity changes, allowlist eligible subscription products, and reject out-of-order lifecycle regressions.