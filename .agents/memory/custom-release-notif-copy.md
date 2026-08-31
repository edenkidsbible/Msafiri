---
name: Custom release notification copy
description: Admin-editable push notification title/body for app_releases; overrides auto-generated copy in releasePush.ts.
---

# Custom release notification copy

## Schema
`app_releases` table has two new nullable columns:
- `notif_title TEXT` — custom push title (NULL = auto-generate)
- `notif_body TEXT` — custom push body (NULL = auto-generate)

## Server logic (`artifacts/api-server/src/lib/releasePush.ts`)
```typescript
const notifTitle = release.notifTitle ?? (release.isForceUpdate ? "Msafiri just got better 🚀" : `What's new in Msafiri v${release.version} ✨`);
const notifBody  = release.notifBody  ?? (auto-generated from releaseNotes);
```
Custom values flow through to the `push_campaigns` log row too.

## Admin UI (`artifacts/admin/src/pages/releases.tsx`)
- `ReleaseDialog` has a "Push notification copy" collapsible section with title + body inputs
- Shows a live `NotifPreviewCard` preview when either field is filled in
- `buildNotifCopy()` uses custom values only for the **active variant** (`force === release.isForceUpdate`); the hypothetical "other variant" preview in `PublishConfirmDialog` always shows auto-generated copy

**Why:** Admin can't preview the notification after sending; seeing the custom copy in the publish-confirm dialog reduces mistakes.
