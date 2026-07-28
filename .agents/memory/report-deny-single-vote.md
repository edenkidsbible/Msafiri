---
name: Community report "Gone now" deny semantics
description: deny endpoint — 2-vote threshold for others' reports, instant owner-resolve on own non-camera report (guarded by 3-confirm), cameras always to admin_review.
---

The server's `POST /reports/:id/deny` ("Gone now") has three distinct paths:

- **Another device's non-camera report:** distinct-device deny votes accumulate; report becomes `denied` at `DENY_THRESHOLD` (2). One vote alone does NOT remove it.
- **Owner's own non-camera report (as of 2026-07-28):** treated as owner-resolve — status set to `denied` immediately, UNLESS `confirmCount >= 3` (same community-protection rule as self-delete `DELETE /reports/:id`), in which case 403 with a human-readable message pointing to Flag.
- **Camera reports:** deny (own or others') routes to `admin_review`; cameras never silently vanish.

Client side, `denyReport` in the mobile AppContext returns `{ ok, message? }` (not a bare boolean) so UI alerts show the server's real reason instead of a generic "check your connection". Unsynced own reports (no serverId) are resolved locally instead of POSTing the local id (which would 404).

**How to apply:** "Gone now", self-delete, flag, and admin removal are four different mechanisms with different actors and thresholds — don't conflate them. If changing vote error handling, keep propagating real ApiError messages to the UI.
