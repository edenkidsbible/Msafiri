---
name: Road Channels nearby discovery
description: Durable rules for coordinate-based channel discovery and stable microphone availability during live GPS updates.
---

Road Channels discovery must combine reverse-geocoded aliases with coordinate distance to supported corridor centre lines. Return every supported corridor within 5 km, sorted by distance; do not interpret a secondary road-name candidate as physical proximity.

**Why:** Reverse geocoding can return decorated, adjacent, or no road name even while a driver is on a supported corridor. Name-only discovery therefore hid valid channels and disabled voice reporting.

**How to apply:** Keep corridor geometry server-side, include coordinates in discovery, return distance metadata, and retain alias matching as an additional signal.

Nearby Road Channels are listen-only unless the driver's GPS fix is on that corridor. A driver within 5 km may join and hear a channel, but voice reports must target the road/corridor under the driver or remain a location-based community report.

**Why:** Nearby discovery is useful for advance awareness, but selecting a channel several kilometres away must not let a driver publish an incident onto a road they are not driving on.

**How to apply:** Keep listening selection separate from report targeting. Enforce the nearby listening radius and the tighter on-corridor contribution distance on the server as well as in the mobile UI.

Do not key mobile discovery directly to raw latitude, longitude, or heading values. Bucket those values and preserve the last valid channel while a refresh is in flight.

**Why:** Live GPS and compass updates can restart and cancel the asynchronous discovery request every second, leaving the UI permanently loading and the microphone disabled.

**How to apply:** Rediscover only after a meaningful location/heading change. Tapping the microphone should establish the active aggregate-presence lease before recording so the later staged upload passes membership validation.