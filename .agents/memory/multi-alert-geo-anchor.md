---
name: Multi-alert geo-anchor pattern
description: When and how cluster-zone suppression applies in the drive alert selection logic.
---

# Multi-alert geo-anchor pattern

## The rule
A **cluster** (lead alert + at least one extra incident within 1 km) sets a geo-anchor when it first fires. While the anchor is active, **only new clusters** are suppressed — single-hazard activations bypass the anchor entirely so drivers never miss an isolated hazard inside the cluster radius.

**Why:** A cluster should announce once, not re-fire every time the driver approaches a different lead ID in the same area. But suppressing all alerts would silence legitimate single hazards that appear after the cluster is dismissed — an unacceptable safety gap.

## How to apply
- Gate: `(!anchorActive || extraCandidates.length === 0)` — only clusters respect the anchor.
- Anchor set when: new cluster activates (`extraCandidates.length > 0`).
- Anchor cleared when: driver travels > 1 km from anchor point, OR driver manually dismisses.
- Single alerts (`extraCandidates.length === 0`) always use the standard 60 s per-ID cooldown on dismiss.
