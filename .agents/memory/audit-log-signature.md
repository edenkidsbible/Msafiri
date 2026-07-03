---
name: logAudit call-site signature
description: The api-server's logAudit() helper takes a single options object with a nested actor and object details — some call sites drifted to an older flat/positional shape.
---

## Rule
`logAudit` (in `artifacts/api-server/src/lib/audit.ts`) signature is:
```ts
logAudit(params: { actor: { id: string; name: string; role: string }; action: string; targetType?: string; targetId?: string; details?: object })
```

Found three call-site drift patterns in the same codebase, all silently type-broken:
1. Positional args `logAudit(userId, action, detailsObj)` — leftover from an older signature.
2. Flat `actorId`/`actorName`/`actorRole` fields instead of a nested `actor: {...}` object.
3. A template-string `details` instead of an object (the field is typed `object`).

**Why:** These accumulate because `logAudit`'s own body doesn't throw at runtime for a mismatched shape in JS-land — it's purely a TS compile error, so it's easy to miss until a full `pnpm -r run typecheck` is run and to keep waving off as "pre-existing, unrelated."

**How to apply:** When adding a new admin route that calls `logAudit`, always pass `actor: { id, name, role }` (fall back to `{ id: "system", name: "Admin", role: "admin" }` when the acting user is optional) and wrap free-text audit messages in `{ message: "..." }` rather than passing a raw string.
