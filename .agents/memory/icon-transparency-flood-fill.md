---
name: Making an icon background transparent when bg-removal tool fails
description: remove_image_background_tool can fail on icons where a solid card/background fills edge-to-edge with no surrounding empty margin; ImageMagick flood-fill from edge/corner seed points works instead.
---

When an app icon's background is a solid shape (e.g. a rounded-square card) that touches all four edges of the canvas with no margin, `remove_image_background_tool` may not detect it as "background" and leave it untouched — there's no surrounding empty region for the model to key off.

**Fix:** Use ImageMagick flood-fill seeded from multiple points along the image edges/corners (not just one corner, since rounded corners can require several seeds to fully spread):

```
magick icon.png -alpha set -fuzz 12% -fill none \
  -draw "color X1,Y1 floodfill" -draw "color X2,Y2 floodfill" ... \
  output.png
```

Seed from all 4 corners plus 4 edge midpoints. A `-fuzz` of ~10-15% usually spreads through anti-aliased edges without bleeding into a distinctly-colored foreground (e.g. a green icon border blocks fill from reaching the icon's interior details). Verify with `magick output.png -format "%[pixel:p{X,Y}]" info:` sampled at many points (corners, edge midpoints, near the rounded-corner curve) to confirm `srgba(0,0,0,0)` everywhere outside the foreground — a transparent PNG previewed in a generic viewer/tool often renders the transparent area as solid black, which can look like the fill didn't work when it actually did.

**Why:** Wasted a remove_image_background_tool call on an icon with no background margin before realizing flood-fill was needed; also nearly misjudged a successful transparent result as a failure because the viewer rendered transparency as black.

**How to apply:** When asked to make an icon/logo background transparent and the bg-removal tool doesn't change anything, check whether the background touches all edges — if so, go straight to the ImageMagick multi-seed flood-fill approach instead of retrying the tool.
