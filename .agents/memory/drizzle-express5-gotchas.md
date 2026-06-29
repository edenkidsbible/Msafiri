---
name: Drizzle + Express 5 gotchas
description: Type issues encountered with drizzle-orm v0.45 and Express 5 TypeScript types
---

## not(inArray(...)) broken in drizzle-orm v0.45

The pattern `not(inArray(column, ["a", "b"]))` fails TypeScript type checking in drizzle-orm v0.45.x. Use `ne()` calls instead:

```typescript
// BAD — type error in v0.45
not(inArray(table.status, ["expired", "denied"]))

// GOOD — works correctly
and(ne(table.status, "expired"), ne(table.status, "denied"))
```

**Why:** The `not()` and `inArray()` overload resolution in v0.45 has a type narrowing bug.

## Express 5 req.params types

In `@types/express@^5.0.6`, `req.params[key]` is typed as `string | string[]` (not just `string`). This breaks drizzle column comparisons like `eq(table.id, req.params.id)`.

Fix: explicitly cast to string:
```typescript
const id = req.params["id"] as string;
// or
const { id } = req.params as { id: string };
```

**Why:** Express 5 types model query/param values more broadly than Express 4.

**How to apply:** Any route handler using `req.params.X` in a drizzle `.where()` clause needs the cast.
