---
name: lib/db composite build gotcha
description: New Drizzle schema exports in lib/db aren't visible to consumers until the composite TS build is rebuilt
---

`lib/db` is a TypeScript project-reference package with `composite: true` and `emitDeclarationOnly: true` (outputs to `dist/*.d.ts`). Consumers like `@workspace/api-server` resolve `@workspace/db` types from these emitted `.d.ts` files, not directly from `src/`.

**Why:** After adding a new table/export to `lib/db/src/schema/*.ts` and running `drizzle-kit push` (which only pushes the DB schema, not TS declarations), consumers will fail typecheck with "has no exported member" even though the source is correct — the stale `dist/*.d.ts` doesn't know about the new export yet.

**How to apply:** After adding/changing exports in `lib/db/src`, run `npx tsc -b` inside `lib/db` to regenerate `dist/*.d.ts` before typechecking or building any consumer package (api-server, admin, etc).
