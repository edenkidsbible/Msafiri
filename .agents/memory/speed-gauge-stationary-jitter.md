---
name: Speed gauge shows phantom motion while stationary
description: GPS-derived speed reads a few km/h while the phone is sitting still — cause and the fix pattern
---

## Rule
A speed readout derived from either device-reported GPS speed or a haversine distance/time delta between consecutive fixes will show phantom non-zero values (commonly ~3-15 km/h) while genuinely stationary, because raw fix coordinates drift by a few metres from GPS noise alone — proportional to the fix's own horizontal accuracy.

**Why:** A naive `distance / time * 3.6` calc treats any coordinate drift as motion. Reported symptom was "~10km/h shown while parked."

**How to apply:** Three complementary guards, applied together (any one alone is insufficient):
1. Discount device-reported speed when horizontal accuracy is poor (e.g. accuracy > 25m) — don't trust Doppler speed from a bad fix.
2. Before trusting a computed distance/time speed, require the moved distance to exceed a noise floor tied to the fix's accuracy (e.g. `max(4m, accuracy * 0.6)`), otherwise treat it as 0.
3. Add a stationary dead-band (snap to 0 after 2+ consecutive near-zero readings) plus a short rolling median (last 2-3 samples) to absorb one-off spikes without adding perceptible lag to real speed changes.

Requires passing `coords.accuracy` through from `watchPositionAsync`/`watchPosition` alongside lat/lng/speed — it's easy to only wire the three original fields and forget accuracy exists.
