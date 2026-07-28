---
name: Sentry + OpenTelemetry bundling in api-server
description: How @sentry/node v10 interacts with the esbuild bundler and pnpm peer-dep resolution for drizzle-orm
---

## The rule
`@sentry/node` v10 uses OpenTelemetry internally. Do NOT put `@opentelemetry/*` in the esbuild external list — these are pure-JS packages that bundle cleanly, and externalizing them causes `ERR_MODULE_NOT_FOUND` at runtime because pnpm's strict node_modules means they aren't resolvable from the dist bundle.

## The drizzle-orm duplicate-instance problem
When `@sentry/node` is added to `@workspace/api-server`, pnpm creates a second peer-variant of drizzle-orm (`drizzle-orm@0.45.2_@opentelemetry+api@1.9.1_@types+pg@8.20.0_pg@8.22.0`) because `@opentelemetry/api` is now in scope. TypeScript then sees two incompatible drizzle instances and throws 497 errors across every route file.

**Fix:** install `@opentelemetry/api` into both `@workspace/api-server` AND `@workspace/db`. This forces pnpm to use the otel-aware variant of drizzle-orm consistently in both packages.

**Why:** drizzle-orm has optional `@opentelemetry/api` peer support; pnpm creates a different "flavor" hash when the peer is present vs absent. Both packages must agree on the same flavor.

## Sentry init pattern (both sides)
- Mobile (`@sentry/react-native` v8): `initSentry()` in `_layout.tsx` top-level, `Sentry.wrap(RootLayout)` as default export, `beforeSend(event: ErrorEvent, _hint: unknown)` signature.
- API server (`@sentry/node` v10): `Sentry.init()` before any middleware in `app.ts`, `Sentry.setupExpressErrorHandler(app)` after all routes. Both gated on env var presence.
- `EventHint` is NOT exported from `@sentry/react-native` v8 — use `unknown` for the hint param type.
