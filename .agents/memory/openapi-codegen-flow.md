---
name: OpenAPI-first admin endpoint flow
description: Order of operations for adding a new admin API endpoint so generated hooks compile.
---

Adding a new admin endpoint (or field) requires, in order: (1) Drizzle schema + `pnpm run push` in `lib/db`, (2) implement the route, (3) add path/schema to `lib/api-spec/openapi.yaml`, (4) run `pnpm --filter @workspace/api-spec run codegen` (runs orval, then `tsc --build` across libs automatically) to regenerate `lib/api-client-react`/`lib/api-zod` hooks, (5) only then wire up the admin UI against the new `useAdmin*` hooks.

**Why:** skipping the openapi.yaml step means the generated hooks don't exist yet, so admin UI code referencing them fails typecheck; the codegen script's own typecheck step is a reliable canary that the spec and route shapes agree.

**How to apply:** whenever a task adds a new admin-facing endpoint or changes a response shape, touch openapi.yaml and rerun codegen before touching any admin page — don't hand-write fetch calls as a shortcut.
