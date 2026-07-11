---
name: Camera validation circular-anchor trap
description: Why validateCameras.mjs can report false "within 100m" passes, and how to place/verify road anchors so it can't.
---

# Circular-anchor trap in camera validation

`validateCameras.mjs` builds each road's centerline by OSRM-routing between hand-placed
`ROAD_ANCHORS` waypoints, then measures each camera's distance to that polyline. If an
anchor is placed **at (or near) a camera's own coordinates**, the route is forced through
that point and the camera validates against itself — it reports ~0m off even when it is
>1km off the real road.

**Real incident (A109 / Mombasa Rd):** an A109 anchor `[36.9878,-1.4562]` had been placed
on top of the "Athi River Camera" (sz002). Validation said 0m; the camera was actually
**1430m** off the real highway. Same class of bug hid sz004 (EPZ Syokimau, 875m off) and
sz035b (Sameer Business Park end, 835m off) behind an anchor `[36.8895,-1.3215]` that was
itself ~800m off the road.

**Why:** anchors ARE the ground truth the check trusts. A wrong/self-referential anchor
corrupts the centerline silently, and every camera near it inherits the false pass.

**How to apply:**
- Keep anchors FAR from any camera. Never copy a camera coord into `ROAD_ANCHORS`.
- Verify every anchor against an independent source before trusting it. In-sandbox,
  Photon geocoding + OSRM routing work (Overpass/Nominatim are blocked). Geocode named
  landmarks on the road (e.g. "Mombasa Road Nairobi" 16m, "Mlolongo" 123m, "Syokimau"
  154m, "Sameer Business Park" 63m) and confirm they snap tight to the routed polyline.
- To re-verify a camera independently of the script, route a CLEAN centerline between
  well-separated on-road endpoints (no anchor near the camera) and snap the camera to it.
- Placement by name: trust the camera's name/description over its stored coords when they
  conflict (sz004 was named "Syokimau" but sat 7km away in central Nairobi's industrial
  area — the name was right, the coords were wrong).
