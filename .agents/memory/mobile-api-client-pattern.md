---
name: Mobile app API client pattern
description: How artifacts/mobile talks to the API server — not the generated api-client-react hooks used by web artifacts.
---

The Expo mobile app (`artifacts/mobile`) does NOT use the generated `@workspace/api-client-react` hooks that the admin/marketing web artifacts use. It has its own hand-written thin wrapper in `artifacts/mobile/utils/apiClient.ts` (`apiGet`/`apiPost`/`apiPatch`/`apiDelete`), calling raw REST paths against `API_BASE` (built from `EXPO_PUBLIC_DOMAIN`).

**Why:** the mobile app predates/bypasses the OpenAPI codegen wiring for hooks; consumers just declare inline response types at the call site instead of importing generated types.

**How to apply:** when adding a new API-backed feature to the mobile app, do NOT look for or add generated React Query hooks there — add a plain `apiGet<T>(...)` call in `context/AppContext.tsx` (or wherever state lives) with an inline response interface, following the existing `/reports` polling pattern (poll on an interval using a ref-cached last-known location, merge into state, swallow network errors to keep the offline-friendly UX).
