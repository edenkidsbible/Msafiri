---
name: Landmark + two-point geocoding for camera placement
description: How to correct along-road camera coordinates using landmark geocoding, and the traps that make it go wrong
---

Correcting speed-camera coordinates in `speedZones.ts` when they are on the right road name but km-off along the road.

**Approach that works:** geocode the *landmark(s)* in the zone name (Photon `photon.komoot.io`, Kenya bbox `33.9,-4.9,41.9,5.5`), biased toward the zone's OWN stored coord (`&lat=&lon=`) — region is trusted even when the exact spot is wrong. For two-point names ("A / B Section") geocode both and take the OSRM route-midpoint. Place at the real landmark point, never via coarse hand anchors.

**Why:** centerline-snap validators only fix *cross-road* offset; they pass a camera that is on the right road but km too far along. Landmarks give the along-road position.

**Traps (all hit in practice):**
- **Off-road verification gate cannot catch along-road errors.** A same-named place (e.g. an "ABC Place" supermarket branch) can land ON the named road but at the wrong along-road spot — the road-proximity check happily passes it. You must verify the landmark's *true* location independently, not just that it sits on the road.
- **Short proper nouns get dropped.** min-4-char tokenization silently discards "ABC", "Taj", so name-match filtering keeps a wrong same-named outlier and rejects the real feature. Use min-3 + a generic-word stoplist instead.
- **Circular anchors.** Hand ROAD_ANCHORS placed at a camera's own (wrong) stored coord make the off-road check meaningless — it validates against the wrong point. Bypass/expressway cameras were the worst.
- **Junk landmark types** (supermarket, residential, "yes", path, boundary_stone) are usually businesses named after an area, not the area — exclude from auto-apply.
- **My own geographic memory was wrong** more than once (thought ABC Place was at 36.803; it's at 36.777). Trust the geocode cluster + OSRM geometry over recollection.

**For interchanges, use the OSRM road polyline, not anchors.** Route the actual road (`router.project-osrm.org`, `overview=full&geometries=geojson`) and snap to the nearest polyline vertex. Beware OSRM routing *through* the target road when both endpoints are near it — that produces false near-zero "crossings"; route each road independently and inspect vertices in the relevant lon/lat band.

**Process:** report first, hand-vet, apply only a curated auto-accepted set + explicit manual corrections with cited reasons. High false-positive rate makes blind `--fix` unsafe. Tools live in `artifacts/mobile/scripts/` (auditByLandmark, fixByLandmark, applyManualFixes).

**Perpendicular road-snap (validateCameras.mjs) needs a max-distance cap too.** When a camera lies beyond the end of its road's anchor line, "nearest point on polyline" clamps to the line's endpoint, producing offsets of hundreds of meters to >10km that look like real errors but are actually anchor-coverage gaps. Blind `--fix` would relocate real cameras. Added a `--maxfix=N` flag so only small (sub-anchor-gap) corrections auto-apply; large ones are reported and skipped pending anchor-line extension.
