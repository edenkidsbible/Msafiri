---
name: Auto Hazard Detection System
description: Architecture of the silent road hazard detection pipeline (braking events → clustering job → auto community reports)
---

# Auto Hazard Detection System (Disabled)

## Rule
Automatic hazard detection is disabled. Driver feeds must exclude every
`community_reports` row with `source='auto'`; older cached rows are also
identified by the legacy `Auto-detected:` road-name prefix. Mobile must not
collect or upload hard-braking, pothole, or swerve sensor batches.

**Why:** Sensor-generated pothole/hazard pins were removed from the map by product
decision. Only explicit driver-submitted community reports should appear.

## How to apply
- Keep the legacy braking-events endpoint as a successful no-op so old clients do
  not retry, while storing nothing.
- Do not restart or recreate the clustering background job.
- Preserve manual pothole and hazard reporting.
- Historical auto-detection records may remain visible to administrators for
  audit purposes, but never in driver-facing map/report/alert feeds.

## Schema
- `braking_events` — id, device_id, event_type, lat, lng, speed_kmh, g_force, heading, created_at
- `hazard_clusters` — id, report_id (→ community_reports), cluster_lat/lng, dominant_type, device_count, event_count, created_at
- `community_reports.source` — new column, default 'manual'; 'auto' for clustering-created reports
