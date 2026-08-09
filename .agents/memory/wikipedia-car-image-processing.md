---
name: Wikipedia car image background processing
description: Approach for processing Wikipedia press photos for R2 storage; fuzz + flatten pattern.
---

## Rule
Wikipedia manufacturer press photos (white/grey studio background) are processed with:
1. **ImageMagick flood-fill at 8% fuzz** from all 4 corners — removes uniform background without eating the car body (20% was too aggressive for white/silver cars)
2. **sharp flatten to white (#ffffff)** — fills any remaining transparency so the image is never transparent; prevents dark-mode bleed-through on dark garage cards

Result: images stored as opaque white-background PNGs, look like crisp product cards on any surface.

**Why 8% fuzz:** 20% removed white car body pixels (car body has shadows/reflections slightly off pure white but still close). 8% only hits the pure white flat backgrounds at the photo edges.

**Why flatten to white:** Transparent background + dark garage card = invisible car. Flattening to white makes it look like a product photo card — consistent on green hero, dark garage, any background.

**How to apply:** `fetchAndStoreCarImage` in `customVehicles.ts`: removeBackground(png) → sharp().flatten({ background: {r:255,g:255,b:255} }).png(). Never skip the flatten step.

## Re-processing
To re-process existing images: `UPDATE custom_vehicles SET image_status = 'pending' WHERE image_status = 'done';` then restart API server (retryPendingCarImages runs on startup).
