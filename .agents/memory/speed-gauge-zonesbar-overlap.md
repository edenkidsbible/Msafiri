---
name: Speed gauge vs zones-bar overlap
description: Why the drive-screen speed number clipped and what the pale pill above it actually was
---

On the mobile drive screen (`app/(tabs)/index.tsx`), the pale cream/pink pill with a camera icon + bold limit number + grey distance sitting "above" the big speed digit was the **additional zones strip** (`zonesBar`/`zoneChip`, rendered when `nearbyZones.length > 1`), NOT `AlertBanner` (which is a solid-color banner with white text and only appears for `activeAlert`). The zones strip's `bottom` offset placed it visually just above the primary `speedStrip`, crowding the gauge.

The big speed digit's right-edge clipping came from `speedGroup` (the digit's wrapper `View`) having no `flexShrink: 0` — RN Views default to `flexShrink: 1`, so when the row (`speedStrip`: speedGroup + optional limitRing + divider + zone-content) ran tight, the digit's box got squeezed below its intrinsic glyph width and visually clipped against the neighboring divider.

**Why:** Removed the whole zones strip per explicit user request (it duplicated info already shown in the primary strip's contextual center and blocked the gauge); fixed clipping by adding `flexShrink: 0` + a generous `minWidth` to `speedGroup` and enlarged `speedNum` fontSize since removing the strip freed vertical/visual room.

**How to apply:** When touching this screen's speed display again, remember there are two speed blocks — normal-mode `speedStrip`/`speedNum` (large, ~88px) and nav-mode `navSpeedBlock`/`navSpeedNum` (small, fixed 68px width) — they are separate style objects and only the normal-mode one was changed here.
