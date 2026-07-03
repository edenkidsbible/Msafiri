---
name: On-demand route status check (Saved Places / Planned Trips)
description: Pattern for checking road conditions to an arbitrary destination outside of active navigation, reusing the same incident-matching logic as the live "incidents ahead" panel.
---

`checkRouteStatus(destLat, destLng)` in AppContext fetches a fresh OSRM route from the driver's current location to any destination and runs it through the same static-zone + community-report corridor-matching logic (`buildCumulativeDistances` + `projectOntoRoute`, 250m corridor) used for the active-navigation `routeIncidentsAhead`. It is intentionally decoupled from `activeRoute`/navigation state so it can be called from anywhere (e.g. tapping a Saved Place or Planned Trip) without disturbing live navigation.

**Why:** Saved Places and Planned Trips previously had no way to show current road conditions before the user actually started driving — the incident/traffic-delay logic only ran against `activeRoute`. Duplicating the corridor-matching math per screen would drift; a single on-demand function keeps both call sites consistent.

**How to apply:** When a feature needs "what's the road like on the way to X" without starting navigation, call `checkRouteStatus` rather than re-implementing route/incident fetching. It returns `{ distanceM, durationS, trafficDelayS, incidents }` or `null` (no location / no route found). Icon/label/delay-formatting helpers (`incidentVisual`, `distLabel`, `delayMinutesLabel`, `incidentDelayMin`) are exported from `components/RouteIncidentsPanel.tsx` for reuse in any new incident-list UI.
