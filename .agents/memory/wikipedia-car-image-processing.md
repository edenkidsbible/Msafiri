---
name: Wikipedia car image background processing
description: AI-powered background removal for custom vehicle Wikipedia press photos stored in R2.
---

## Rule
Wikipedia manufacturer press photos are processed with:
1. **sharp resize to ≤800px wide** — reduces pixel count 4× for faster AI inference
2. **rembg (u2netp model) via Python subprocess** — semantic AI segmentation, works on ANY background (brick walls, roads, studios, parking lots)
3. **Result is transparent PNG** — stored in R2 as-is; no flattening needed; car "floats" on any surface

**Why NOT ImageMagick flood-fill:** Only works on uniform white/grey studio backgrounds. Wikipedia press photos often have real-world backgrounds (brick walls, streets, etc.) where flood-fill does nothing.

**Why NOT white-flatten:** Makes it an opaque white rectangle that looks wrong on coloured backgrounds (green hero tile, dark garage card).

**Why u2netp over u2net:** u2netp is ~4MB (vs 176MB for u2net), 3–5× faster on CPU (30–60s vs 3–5min per image). Quality is adequate for car silhouettes.

**Script:** `artifacts/api-server/scripts/remove_bg.py` — takes `<input_file> <output_file>` args (temp files, NOT stdin/stdout — stdin pipe close issue causes Python process to hang indefinitely).

**Key gotcha — stdin/stdout pipe:** execFileAsync with `{ encoding: 'buffer', input: Buffer }` does NOT correctly close stdin. The Python process hangs waiting for EOF on stdin. Always use temp files.

**How to apply:**
- `removeBackground(input: Buffer)` in `customVehicles.ts`: resize with sharp → write tmpIn → execFileAsync(python3, [REMBG_SCRIPT, tmpIn, tmpOut]) → read tmpOut → cleanup
- Allow 5-minute timeout for the execFileAsync call
- `process.cwd()` for script path resolution (server always runs from `artifacts/api-server/`)

## Re-processing
To re-process: `UPDATE custom_vehicles SET image_status = 'pending' WHERE image_status = 'done';` then restart API server (retryPendingCarImages runs on startup, processes sequentially).

## Rendering
`DefaultVehicleImage.tsx` uses `resizeMode="contain"` with transparent PNG — car floats naturally on any background. No special container styling needed; the "border frame" visible in earlier screenshots was the opaque photo background, not a CSS border.
