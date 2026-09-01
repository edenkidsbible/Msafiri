---
name: Active-drive map heading
description: Preventing upside-down map rotation while preserving a forward-looking heading-up drive view.
---

During an active drive, keep the map heading-up but apply the smoothed heading with a direct camera update rather than an animated heading transition. Continue using the heading for the forward look-ahead centre offset.

**Why:** Native map renderers can interpolate an animated heading across the long side of the 0°/360° boundary, visibly spinning or flipping the map even when centre and heading updates are separated.

**How to apply:** Preview/browse modes may animate heading changes. Active-drive camera code must cancel delayed preview rotations, use direct heading updates behind the existing dead-band, and keep position animations centre-only.