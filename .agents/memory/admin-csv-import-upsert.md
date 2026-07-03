---
name: Admin CSV import/export upsert pattern
description: How CSV backup/restore for admin-managed tables (e.g. community_reports) is implemented without file-upload middleware.
---

For admin dashboards needing CSV export+import (backup/restore), import is implemented as `POST` with JSON body `{ csv: string }` rather than multipart file upload — avoids adding multer/csv-parse deps, reuses existing `express.json()` middleware. Frontend reads the File via FileReader/`readFileAsText` and sends its text content as a JSON field.

Import semantics: parse CSV, validate each row's enum/numeric fields, then upsert by primary key (`id`) — if the id exists, update the row ("restore" semantics); if not, insert with the provided id (if a valid UUID) or generate a new one. Return a structured summary `{ created, updated, skipped, errors }` (with per-row error messages) rather than failing the whole batch on one bad row.

**Why:** Admin CSV re-import needs to be idempotent (safe to re-run the same export as a restore) and partially-tolerant of bad data (skip+report bad rows, don't abort).

**How to apply:** When adding CSV import to any admin CRUD table that already has CSV export, mirror the export's exact column order so round-trip export→import works, and reuse the same enum validation used by the create/update endpoints.
