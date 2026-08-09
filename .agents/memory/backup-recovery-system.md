---
name: Backup & Recovery system
description: How the device data backup/restore feature works — recovery codes, plate verification, data migration.
---

## Architecture

- **`device_backups` DB table** (PostgreSQL): `recovery_code` (5-char unique, uppercase alphanumeric A-Z + 2-9), `device_id` (unique), `vehicles_json`, `settings_json`, `last_backup_at`, `created_at`.
- **API routes** (all under `/backup`):
  - `POST /backup/init` — idempotent, creates record + code for a device; called by AppContext on startup
  - `POST /backup/sync` — uploads vehicle list + settings snapshot (debounced 5 min client-side)
  - `GET /backup/code` — returns code for a device
  - `POST /backup/verify` — verifies code + plate, migrates server-side deviceId rows, returns vehicles/settings
- **Mobile util**: `artifacts/mobile/utils/backupSync.ts` — `initBackup`, `syncBackup`, `verifyAndRestore`, `getLocalRecoveryCode`
- **Recovery screen**: `artifacts/mobile/app/restore-data.tsx`
- **Settings**: "Data & Recovery" section above "Privacy & Data" — shows code card + "Back Up Now" + "Restore" buttons
- **Vehicle setup**: `vehicle-setup.tsx` Step 3 now includes a "Number plate" field (before odometer)

## Security model

Restore requires BOTH the 5-char code AND at least one matching plate number from the backed-up vehicle list. Plate matching normalises (uppercase, strip spaces/hyphens) before comparing.

## Auto-sync trigger

AppContext has a `useEffect` watching `vehicles` from `useVehicle()` that calls `syncBackup` (debounced 5 min) whenever the vehicle list changes.

## DeviceId migration on restore

`/backup/verify` updates server-side rows in: `push_tokens`, `saved_places`, `planned_trips`, and uses raw SQL (`db.execute(sql\`UPDATE...\``) for: `emergency_contacts`, `trips`, `live_trips`, `dashcam_clips`, `braking_events`, `crash_events`, `accidents`. Best-effort — failures don't abort the restore.

## Why

Recovery code alone is too easy to guess-and-dump; plate requirement makes social-engineering attacks impractical without physical access to the car.
