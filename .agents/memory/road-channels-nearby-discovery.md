---
name: Road Channels nearby discovery
description: Durable rules for coordinate-based channel discovery and stable microphone availability during live GPS updates.
---

Road Channels discovery must combine reverse-geocoded aliases with coordinate distance to supported corridor centre lines. Return every supported corridor within 5 km, sorted by distance; do not interpret a secondary road-name candidate as physical proximity.

**Why:** Reverse geocoding can return decorated, adjacent, or no road name even while a driver is on a supported corridor. Name-only discovery therefore hid valid channels and disabled voice reporting.

**How to apply:** Keep corridor geometry server-side, include coordinates in discovery, return distance metadata, and retain alias matching as an additional signal.

Do not key mobile discovery directly to raw latitude, longitude, or heading values. Bucket those values and preserve the last valid channel while a refresh is in flight.

**Why:** Live GPS and compass updates can restart and cancel the asynchronous discovery request every second, leaving the UI permanently loading and the microphone disabled.

**How to apply:** Rediscover only after a meaningful location/heading change. Tapping the microphone should establish the active aggregate-presence lease before recording so the later staged upload passes membership validation.