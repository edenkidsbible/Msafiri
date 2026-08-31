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
- Schema guard: `CREATE TABLE IF NOT EXISTS device_trial_sessions` in `migrateSchema.ts` (idempotent).
- `POST /api/trial/session` — upsert-increment; returns `{ sessionCount, trialExpired }`
- `GET /api/trial/status?stableDeviceId=...` — read-only status check
- Threshold constant: `FREE_TRIAL_SESSIONS = 3` in `artifacts/api-server/src/routes/trial.ts`

## Mobile hook
`artifacts/mobile/hooks/useTrialSessions.ts`  
- `useTrialSessions()` — React hook; reads AsyncStorage cache immediately (< 50ms), then syncs from server in background. Used in `_layout.tsx` (routing gate) and `drive.tsx` (start gate).
- `recordTrialSession()` — standalone async function; optimistic local fallback when offline. Only called from `drive.tsx` for **online** (non-local-prefix) sessions.
- Cache key: `@msafiri/trialSessionCount` — shared between the hook and `flushOfflineSessions`.

## Gate locations
1. **`_layout.tsx` cold-start gate** — `useTrialSessions()` + `useSubscription()`; if `!isSubscribed && trialExpired` → `router.replace("/paywall")`. Waits on `trialLoading` (clears after AsyncStorage read).
2. **`drive.tsx` start gate** — `useFocusEffect` checks `trialExpiredRef.current` before auto-starting a trip. Prevents 4th drive in a live session where the routing gate already fired.
3. **`drive.tsx` online recording** — `recordTrialSession()` called in `endDriveSession().then()` block, fire-and-forget. Skipped when `sid.startsWith(LOCAL_PREFIX)` to avoid double-counting with the flush path.

## Offline session recording (flushOfflineSessions)
`artifacts/mobile/utils/driveSessionApi.ts` — `flushOfflineSessions(deviceId)`  
Two-phase per queued item (both phases idempotent across retries):
1. **POST drive-session** — skipped if `flushedServerId` already set from a prior attempt.
2. **POST /trial/session** — only for sessions ≥ 50 m; direct server call (no optimistic fallback) so failure keeps the item queued. `flushedServerId` is stored on the queue item so Phase 1 is not repeated on retry.

**Why direct call (not `recordTrialSession()`):** The standalone function has an optimistic offline fallback; for durability during flush we need a throw-on-failure path so the queue entry is retried.

**How to apply:** Any new path that saves a completed drive session ≥ 50 m must also trigger trial recording — either via `recordTrialSession()` (online) or by joining the offline queue flow.
