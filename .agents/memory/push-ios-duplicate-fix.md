---
name: iOS push notification duplicate fix
description: Root cause and fix for iOS users receiving two identical notifications simultaneously from the Expo push system.
---

## Root cause

After an iOS reinstall, AsyncStorage is wiped → app generates a **new deviceId** + gets a **new APNs token** from Expo. A new row is inserted in `push_tokens`. The **old row** (different `deviceId`, old but still-valid APNs token) stays until the 30-min receipt purge confirms it dead. During that window, both tokens deliver to the same physical iPhone — one notification per row.

The previous cleanup in `/push/register` only handled the reverse case (same token, different deviceId) and missed this one.

## Fix — three layers

1. **vendorId at registration time** (primary fix): Mobile passes iOS `identifierForVendor` (IDFV) or Android `getAndroidId()` as `vendorId` in `/push/register`. Server deletes any other row with the same `vendorId` before inserting, evicting the stale old row immediately.
   - Schema: `vendor_id TEXT` column on `push_tokens` (nullable, older clients don't send it).
   - Migration: `ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS vendor_id TEXT` + partial index on `vendor_id WHERE vendor_id IS NOT NULL`.
   - Mobile: `Application.getIosIdForVendorAsync()` on iOS, `Application.getAndroidId()` on Android (both in `expo-application` v7, already installed).

2. **DISTINCT ON at send time** (belt-and-suspenders): `sendActiveCampaign` and `sendAutoCampaign` use `SELECT DISTINCT ON (device_id) token FROM push_tokens ORDER BY device_id, last_seen_at DESC` instead of a plain SELECT. Guarantees at most one token per logical deviceId even if stale rows slip through.

3. **`setNotificationHandler` iOS flag** (pre-existing, already correct): `shouldShowAlert: isIos ? false : !suppress` — setting both `shouldShowAlert` AND `shouldShowBanner` to true on iOS 14+ causes the OS to render the notification twice as a foreground banner.

**Why:**
IDFV persists across reinstalls within the same app vendor on iOS. Android ID persists across reinstalls (resets only on factory reset). Both give us a stable cross-reinstall fingerprint we can use server-side to evict stale rows immediately.
