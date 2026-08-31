---
name: Session-based trial architecture
description: How the 3-drive free trial works — stable device ID, server table, mobile hook, and gate locations.
---

# Session-based trial architecture

## The rule
Non-subscribers get **3 completed drive sessions** free. After that they see `/paywall`.

## Stable device ID
`Purchases.getCustomerInfo().originalAppUserId` — RevenueCat's anonymous ID.  
Survives reinstall on iOS (tied to Apple ID / iCloud) and Android (tied to Play account).  
**Why:** No Keychain setup needed; RC is already initialized, and this field is always populated.

## Server-side
- Table: `device_trial_sessions` (`stable_device_id TEXT UNIQUE`, `session_count INT`)
- `POST /api/trial/session` — upsert-increment; returns `{ sessionCount, trialExpired }`
- `GET /api/trial/status?stableDeviceId=...` — read-only status check
- Threshold constant: `FREE_TRIAL_SESSIONS = 3` in `artifacts/api-server/src/routes/trial.ts`

## Mobile hook
`artifacts/mobile/hooks/useTrialSessions.ts`  
- `useTrialSessions()` — React hook; reads AsyncStorage cache immediately (< 50ms), then syncs from server in background. Used in `_layout.tsx` (routing gate) and `drive.tsx` (start gate).
- `recordTrialSession()` — standalone async function called after `endDriveSession().then()` in `drive.tsx`. Updates server count + AsyncStorage cache.
- Cache key: `@msafiri/trialSessionCount`

## Gate locations
1. **`_layout.tsx` cold-start gate** — `useTrialSessions()` + `useSubscription()`; if `!isSubscribed && trialExpired` → `router.replace("/paywall")`. Waits on `trialLoading` (clears after AsyncStorage read).
2. **`drive.tsx` start gate** — `useFocusEffect` checks `trialExpiredRef.current` before auto-starting a trip. Prevents 4th drive in a live session where the routing gate already fired.
3. **`drive.tsx` recording** — `recordTrialSession()` called in `endDriveSession().then()` block, fire-and-forget.

## Known gap
Offline sessions flushed via `flushOfflineSessions` (AppContext.tsx) do NOT call `recordTrialSession()`. Offline drivers can exceed 3 sessions without hitting the server count. See follow-up task.

**How to apply:** Any new path that saves a completed drive session must also call `recordTrialSession()`.
