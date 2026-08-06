---
name: Crash Assistant feature
description: Full Crash Assistant feature — DB schema, API routes, mobile flow, PDF generation.
---

## Tables (lib/db)
- `accident_records` — core record (GPS, speed, weather JSON, other_driver JSON, police JSON, statement, pdf_url)
- `accident_photos` — per-photo by category; fileKey = GCS path from ObjectStorageService.getUploadInfo()
- `accident_witnesses` — name/phone/notes per accident
- `accident_timeline_events` — chronological events (auto-inserted + driver-triggered)

## API server
- Routes in `artifacts/api-server/src/routes/accidents.ts`, mounted in routes/index.ts
- Weather fetched from Open-Meteo free API on record creation (server-side, fire-and-forget)
- PDF generated with `pdfkit` (marked external in build.mjs — fontkit/brotli/@swc/helpers crash esbuild)
- Photo upload: `getUploadInfo()` returns `{ uploadUrl, fileKey }`; client PUTs blob; then confirm endpoint
- PDF stored via `objectStorage.uploadBuffer(fileKey, buffer, contentType)` (new server-side upload helper)

**Why pdfkit must be external in build.mjs:**
fontkit → brotli → @swc/helpers CJS path; esbuild can't resolve @swc/helpers/cjs/_define_property.cjs
at runtime. Added `"pdfkit"` and `"fontkit"` to externals.

## Mobile
- `app/crash-assistant/[id].tsx` — 7-step flow (evidence → photos → witnesses → other_driver → police → statement → report)
- `app/crash-vault.tsx` — list of past records; accessible from Settings > Crash Vault card
- Photo upload: `expo-image-picker` → `fetch(uri).blob()` → `fetch(uploadUrl, { method: 'PUT', body: blob })`
- Uses `apiPatch` for PATCH /accidents/:id; `apiDelete` requires empty `{}` as second arg
- `date-fns` must be installed in `artifacts/mobile` (not in workspace root)

## AppContext integration
- On crash detection fires: also calls `POST /accidents` → stores `crashAssistantId` in state
- `crashAssistantId` exposed in context; index.tsx `handleStartCrashReport` navigates to `/crash-assistant/${crashAssistantId}`
- CrashDetectedModal now has `onStartCrashReport?` prop → blue "Start Crash Report" button

**How to apply:** When adding new routes with complex CJS-only deps, check esbuild externals first.
