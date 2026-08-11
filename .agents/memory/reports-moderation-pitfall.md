---
name: Reports moderation pitfall
description: Why community reports disappeared from the production map, and what types require moderation.
---

## The problem
`MODERATED_TYPES` in `artifacts/api-server/src/routes/reports.ts` previously contained `["camera", "police"]`. Every police checkpoint report therefore went to `pending_review` and **never appeared on the map** until an admin manually approved it — but police checkpoints are time-sensitive, so they were always stale or ignored.

**Why:** Police checkpoints were added to MODERATED_TYPES early in development when the moderation flow was being tested. They should never have been there.

## Fix
`MODERATED_TYPES = new Set(["camera"])` — cameras only. Cameras are permanent physical infrastructure that warrant verification; police/alcoblow/traffic are crowd-verified and must go live immediately.

## How to apply
- If adding a new report type, only put it in MODERATED_TYPES if it is **permanent infrastructure** requiring admin sign-off before appearing on the map.
- Crowd-sourced transient incidents (police, traffic, hazard) must go directly to `active`.

## Additional findings from production query (2026-08-11)
- Reports denied with `deny_count=0` are admin-denied (admin deny endpoint does not increment denyCount — this is intentional).
- Reports with `deny_count=1` are user "Gone now" single-vote denials (by design).
- `pending_review` reports with expired `expiresAt` stay stuck — `expireStale()` explicitly skips them. Admin must process them manually.
