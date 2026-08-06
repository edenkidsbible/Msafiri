---
name: Auto Hazard Detection System
description: Architecture of the silent road hazard detection pipeline (braking events → clustering job → auto community reports)
---

# Auto Hazard Detection System

## Rule
The pipeline is: mobile accelerometer → `POST /telemetry/braking-events` (batch) → `braking_events` table → `clusterHazards` job (every 30 min) → `hazard_clusters` + `community_reports` with `source='auto'`.

**Why:** Drivers become passive road sensors without any UI interaction; network effect makes the map smarter over time.

## How to apply
- Mobile only captures events when `navigationActive || dashcamActive`; events are batched in `hazardBatchRef` and flushed every 60s or on drive end via `flushHazardBatch()`.
- Three event types: `hard_braking` (|y|>1.5g + speed drop >25 km/h in 2.5s), `pothole` (|z-9.8|>2.5g + speed change <10 km/h), `swerve` (|x|>1.8g). Debounce: 5s per type.
- Clustering is in-process greedy (O(n·k)); threshold = 5 distinct devices within 60m radius over 7 days.
- Auto-created reports have `source='auto'` and `deviceId='auto-detection-system'`; they appear on the driver map immediately.
- Admin "Auto-Detected" tab in Reports page: separate `useQuery` with `authFetch` using `?source=auto` param (avoids OpenAPI type constraints).
- Hazard stats card on dashboard: `GET /admin/hazard-stats` (inside `admin/stats.ts`).

## Schema
- `braking_events` — id, device_id, event_type, lat, lng, speed_kmh, g_force, heading, created_at
- `hazard_clusters` — id, report_id (→ community_reports), cluster_lat/lng, dominant_type, device_count, event_count, created_at
- `community_reports.source` — new column, default 'manual'; 'auto' for clustering-created reports
