---
name: Incident re-notify rotation
description: How the "is this still here?" confirmation job rotates which drivers get asked across repeated 2-hour sweeps
---

The confirmation-check job (`artifacts/api-server/src/jobs/pushNotifications.ts::checkIncidentConfirmations`) re-asks every 2 hours (via `lastNotifiedAt` cooldown) regardless of prior confirms — a confirm no longer permanently silences the report, it only gets a 30-minute grace period (`lastVotedAt` check) before the next sweep can fire.

To avoid re-pinging the same handful of drivers every cycle, `community_reports.notifiedTokens` (jsonb string array, added to `lib/db/src/schema/reports.ts`) accumulates every push token ever notified for that report. Each sweep excludes those tokens from the nearby-device candidate pool, then picks the closest remaining devices (ties within 0.5km broken by most-recent `push_tokens.lastSeenAt`, as a proxy for "currently driving" since no location history exists).

**Why:** There is no location-history/trips table in this project — `push_tokens` only stores the single latest lat/lng + lastSeenAt per device — so "ask the next-closest or most-recently-route-using drivers" had to be approximated with proximity exclusion + recency tiebreak rather than real route-usage data.

**How to apply:** If a future report needs its notified-driver pool reset (e.g. report reactivated after a long time), clear `notifiedTokens` back to `[]`; otherwise it only grows for the life of the report.
