---
name: Android notification channel importance caching
description: Android permanently ignores importance updates on existing channel IDs. expo-notifications auto-creates "default" at IMPORTANCE_DEFAULT before JS runs. Using "default" as channelId = silent notifications forever.
---

## The Rule
Never reuse an existing Android notification channel ID to change its importance. Android permanently caches channel importance after first creation — `setNotificationChannelAsync` with a different importance on an existing ID is silently ignored by the OS (Android 8+, by design).

**Why:** `expo-notifications` creates a `"default"` channel at `IMPORTANCE_DEFAULT` at native startup, before any JS runs. Any call to `setNotificationChannelAsync("default", { importance: HIGH })` is a no-op — the channel already exists with the wrong importance. All notifications sent to that channel arrive silently with no banner and no sound.

**How to apply:**
- Use channel IDs that have never existed on any device: `"msafiri_general"` and `"msafiri_alerts"` are the current production IDs.
- Never go back to `"default"` or `"incident-alerts"` — those IDs are permanently poisoned on existing installs.
- When creating a new channel type in future, pick a unique ID like `"msafiri_<purpose>"`.
- Delete old channels via `deleteNotificationChannelAsync` on startup to clean up the user's notification settings.
- Update BOTH the mobile channel creation (usePushNotifications.ts) AND every server-side send (pushNotifications.ts, reports.ts, push-campaigns.ts) to use the same IDs.

## Current channel IDs (production)
| ID | Name | Purpose |
|---|---|---|
| `msafiri_general` | General Notifications | Daily nudges, trip advice, campaign broadcasts |
| `msafiri_alerts` | Incident Alerts | Incident confirmation requests (nearby drivers) |

## Files that contain channelId
- `artifacts/mobile/hooks/usePushNotifications.ts` — channel creation + deletion of legacy channels
- `artifacts/api-server/src/jobs/pushNotifications.ts` — all automated sends
- `artifacts/api-server/src/routes/reports.ts` — moderation notification
- `artifacts/api-server/src/routes/admin/push-campaigns.ts` — manual broadcasts
