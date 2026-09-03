---
name: Speed-bump infrastructure alerts
description: Boundaries for permanent, route-aware speed-bump data and alerts.
---

Speed bumps are durable road infrastructure, not community incidents or speed-limit zones. Keep their storage, API, mobile cache, route projection, admin management, and foreground/background alert evaluation separate from both systems.

**Why:** Community reports expire and use voting/moderation, while speed zones influence the gauge. Speed bumps need neither behavior. Mixing them into either pipeline causes permanent records to disappear or contaminates displayed speed limits.

**How to apply:** Import OSM traffic-calming objects into the dedicated catalogue. Alert only enabled bump-like categories, require projection ahead on the selected route and corridor/direction checks, and preserve administrator verification/status/alert changes during idempotent seed sync.