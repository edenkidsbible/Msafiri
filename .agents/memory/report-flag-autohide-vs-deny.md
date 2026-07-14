---
name: Report flag auto-hide vs deny
description: How the driver "report as inappropriate" flag flow now removes reports from the map, and how it differs from the pre-existing single-vote deny/"Gone now" path
---

`community_reports` already had `flagCount`/`flaggedBy`/`flagReasons`/`flagDismissed` and an admin moderation-queue "Flagged by Drivers" section (keep/remove), but flagging never changed report `status` — a report stayed live until an admin happened to review the queue.

Added: once `flagCount` reaches 2 from 2 *different* devices (POST `/reports/:id/flag` in `artifacts/api-server/src/routes/reports.ts`), status flips to a new value `"flagged"`. The existing `isActive()` allow-list (only `active`/`confirmed` visible to drivers) hides it immediately with no other code changes needed. Admin "Keep" (`/admin/reports/:id/flags/keep`) restores status to `"active"` only if it was auto-hidden (was `"flagged"`); "Remove" (`/admin/reports/:id/flags/remove`) sets `"denied"` as before.

**Why:** This is deliberately a *separate* mechanism from the pre-existing single-vote `deny` ("Gone now") path, which instantly denies on the very first vote regardless of type. `deny` means "this is no longer physically there"; the flag threshold means "this report itself is wrong/abusive" and needed a 2-person bar precisely because a single user should not be able to unilaterally remove a permanent report (e.g. a speed camera, TTL `null`) by claiming it's inappropriate.

**How to apply:** Any future report-visibility logic should keep checking `isActive()`/status rather than `flagCount` directly — status is the single source of truth for map visibility, flags are just what mutates it. If the auto-hide threshold ever needs to differ per report type (e.g. cameras only), gate it in the flag route where `FLAG_AUTO_HIDE_THRESHOLD` is checked, not in the map/query layer.
