---
name: Traffic delay estimation on routes
description: How "expect X min delay" is computed when there's no live traffic API
---

OSRM (the free routing API this app uses) only returns free-flow `duration` — there is no live-traffic data source wired up. `routeTrafficDelayS` in `AppContext.tsx` approximates a delay by summing per-minute weights for congestion-causing community report types (`traffic`, `accident`, `roadblock`, `closure`, `roadworks`, `breakdown`, `weather`) found in `routeIncidentsAhead`, scaled by each report's `confirmCount` (unconfirmed reports discounted to 70% weight, confirmed reports scaled up), capped at 45 min total.

**Why:** Static zones (speed cameras, police checkpoints) don't slow traffic, so they're excluded from the weight table — only deliberately picked types contribute. The cap exists because a worst-case sum of many simultaneous reports could otherwise produce an absurd ETA.

**How to apply:** Any new screen showing a route's duration to the user (ETA, alt-route pills, nav bar) should add `routeTrafficDelayS` to `activeRoute.durationS` for consistency — it does not propagate automatically into `durationStr()` calls. Search for `durationStr(` / `.durationS` when auditing for missed spots, same pattern as the vehicle-type capping audit.
