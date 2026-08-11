---
name: Report clustering architecture
description: How community report markers are clustered on the native map and the count-badge pattern.
---

## Clustering rules (as of 2026-08-11)
- **Same-type only** — only reports of identical `type` are merged into one cluster.
- **100 m haversine radius** — `CLUSTER_RADIUS_M = 100`; a bounding-box pre-filter of `CLUSTER_BBOX_DEG = 0.0009°` runs first for performance.
- **Anchor placement** — the cluster sits at the most-confirmed member's coordinates (highest `confirmCount`), not the first submission.

## Marker rendering
- **Single member** — normal emoji blob (`emojiMarker` style) or red camera circle for `camera` type.
- **Multi-member cluster** (all same type) — ONE emoji blob + `clusterCountBadge` count pill in the top-right corner. No grid of identical emoji.
- `clusterCountBadge` style: absolute position `top: -6, right: -6`, white pill, `Inter_700Bold` size 10.

## Key function
`clusterReports()` in `artifacts/mobile/components/MapViewScreen.native.tsx`.  
`haversineM()` is defined locally (not imported from a shared util).

## What NOT to do
- Do not revert to bounding-box-only clustering (old `CLUSTER_RADIUS = 0.003` ≈ 300 m) — it merged different incident types and showed confusing mixed grids.
- Do not show a 2×2 emoji grid for same-type clusters — they're all the same emoji, which is visually useless.
