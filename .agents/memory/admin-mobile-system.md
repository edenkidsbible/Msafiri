---
name: Admin Mobile System
description: PIN-based admin mode in the mobile app — auth flow, report verify/deny/relocate, map pin picker for new reports.
---

# Admin Mobile System

## Architecture
- Server: `/admin-mobile/*` router (`artifacts/api-server/src/routes/admin-mobile.ts`)
- Auth: `POST /admin-mobile/auth` — accepts `ADMIN_MOBILE_PIN` env secret, returns 30-day JWT signed with `SESSION_SECRET` (`role: "admin_mobile"` payload)
- Protected endpoints use `Authorization: Bearer <token>`
- DB: `admin_verified BOOLEAN NOT NULL DEFAULT false` column on `community_reports` table
- Mobile JWT: verified client-side with `isAdminTokenValid()` in AppContext; stored in AsyncStorage under key `admin_mobile_token`

## Admin API Endpoints
- `POST /admin-mobile/auth` — PIN → JWT
- `POST /admin-mobile/reports/:id/verify` — sets `adminVerified=true`, `status="confirmed"`, `confirmCount=999`, `expiresAt=null`
- `POST /admin-mobile/reports/:id/deny` — sets `status="denied"`
- `PATCH /admin-mobile/reports/:id/location` — updates `lat`, `lng`, `roadName`

## Mobile State (AppContext)
Admin mode lives inside `AppContext` (not a separate context):
- `adminToken` state + `adminTokenRef` for stale-closure-safe access
- `isAdmin`: boolean derived from token validity
- `adminLogin(pin)`, `adminLogout()`, `adminVerifyReport(id)`, `adminDenyReport(id)`, `adminUpdateReportLocation(id, lat, lng, roadName?)`
- `adminApiFetch` is an inline async helper inside AppProvider that reads from `adminTokenRef.current`

**Why:** Avoids a separate AdminModeContext; admin state is small enough to live in the existing context.

## Components Created
- `AdminPinModal.tsx` — PIN entry modal; calls `adminLogin` from AppContext
- `AdminLocationPickerModal.native.tsx` — full-screen MapView modal with draggable pin + Nominatim reverse-geocode; accepts `onSave` callback
- `MapPinPicker.native.tsx` — embedded 220px-height map with tap-to-place + draggable pin; used inside ReportModal
- `MapPinPicker.tsx` — web stub (always rendered as inert placeholder since ReportModal is not platform-split)

## UI Entry Points
- **Settings screen**: "ADMIN" section with login button (when logged out) or green "Active" row + Logout (when in admin mode)
- **DriveMapView popup**: When `isAdmin`, every incident shows a row of admin buttons below the vote row: "Verify" (green), "Remove" (red), "Fix Pin" (blue)
  - "Verify" → `adminVerifyReport` → optimistically patches local cluster members
  - "Remove" → `adminDenyReport` → filters member from cluster, closes sheet if empty
  - "Fix Pin" → opens `AdminLocationPickerModal`
- **ReportModal**: Third toggle tab "Pin on Map" (native only via `Platform.OS !== "web"`) → renders `MapPinPicker`; submitted location used as `pickedMapLocation`

## Badges
- `r.adminVerified === true` → blue "Admin Verified" badge (shield-checkmark icon)
- `!r.adminVerified && status === "confirmed"` → original green "Verified" badge (kept intact)

## Public Reports API
`/api/reports` `toReport()` now includes `adminVerified: r.adminVerified ?? false`, and the AppContext poll mapper includes `adminVerified`, `speedLimit`, `roadName` (previously these were in the API response but not mapped into CommunityReport objects).

**Why:** `speedLimit` and `roadName` were already returned by the server but silently dropped at the poll mapper — fixing this as part of the same change.

## Env Secrets Required
- `ADMIN_MOBILE_PIN` — the PIN the admin enters in the app (set in Replit Secrets)
- `SESSION_SECRET` — already exists; reused to sign admin-mobile JWTs
