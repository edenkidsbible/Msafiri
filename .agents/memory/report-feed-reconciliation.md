---
name: Report feed reconciliation
description: Durable rules for keeping community incidents and cameras stable across polling, caching, and background alerts.
---

Do not replace or age-prune server-backed community reports merely because a radius-scoped poll omits them. Reconcile every cached server ID separately: active rows refresh status/expiry, while terminal or deleted rows return explicit tombstones.

**Why:** Successful but incomplete/radius-changing polls made markers disappear and return, temporarily removing the same reports from foreground and background audio-alert candidate sets.

**How to apply:** Batch reconciliation IDs in request bodies, not URL query strings. Preserve cached server rows when reconciliation fails. Apply tombstones before ownership exceptions. Treat null expiry as permanent and missing expiry as unknown until reconciled; use creation-age caps only for unsynced local rows.

Mobile-camera “Gone now” removes the marker/audio candidate optimistically, but restores it on request failure. Fixed or unclassified cameras remain visible during admin review.

**Why:** Temporary mobile cameras need immediate driver feedback, while permanent infrastructure keeps the stronger moderation protection.

**How to apply:** Only successful denial or authoritative not-found keeps an optimistically removed mobile camera hidden.