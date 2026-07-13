---
name: Admin API permission gating
description: Express admin router feature-gating pattern and a subtle mounting bug it must avoid.
---

Admin API permissions must be resolved fresh from the DB on every request (`admin_users.role` + `admin_users.permissions`), never trusted from the JWT — JWTs are long-lived with no refresh endpoint, so baking permissions into the token would mean a revoked feature stays usable until the token expires.

**Why:** the task requirement was that granting/revoking a feature in Team Members takes effect on the very next request, without the affected user re-logging in.

**How to apply:** a `loadAdminPermissionsMiddleware` re-reads the user row by id and computes `effectivePermissions` (custom `permissions` list always overrides role defaults) before any feature check runs; a `requireFeature(key)` middleware then checks membership.

## Mounting-order trap: `router.use(featureCheckMw, subRouter)` with no path leaks

`router.use(middleware, subRouter)` **without a path prefix** runs `middleware` for every request that reaches that point in the chain — not just requests that will actually match `subRouter`'s own internal routes. If several such `(featureCheck, subRouter)` pairs are chained back-to-back (one per feature area), a request destined for a *later* router in the chain will get rejected by an *earlier* router's unrelated feature check before ever reaching its own.

**Why:** manifests as a user granted feature A but not feature B getting a 403 for feature B on a route that only needs A — because an earlier, unrelated router's feature check in the chain ran unconditionally first.

**How to apply:** either mount the sub-router at an explicit path prefix (`router.use("/blog", requireFeature(...), blogRouter)`) so Express only enters that branch for matching paths, or wrap the feature check in a guard that no-ops unless `req.path` starts with that router's own prefix. Per-route `requireFeature` calls placed directly on `router.get/post(...)` inside a route file are unaffected — the bug only bites root-mounted `router.use(mw, subRouter)` pairs.

## Frontend default-route/redirect must be permission-aware too

Once routes are gated per feature key, any hardcoded "send them to /dashboard or else /reports" redirect (post-login, root redirect, denied-route fallback) becomes wrong for any custom permission grant that omits both. Getting server-side gating right is not sufficient.

**Why:** a custom-permission user (e.g. granted only `blog`) hitting a hardcoded fallback can get redirected straight into another denied route and see a blank/blocked screen.

**How to apply:** compute the landing route by walking a priority-ordered feature→route list and picking the first feature the user actually has (see `getDefaultRoute` pattern); apply it identically in the login success handler, the root redirect, and the denied-route fallback. If no feature matches at all, show an explicit "no access" state instead of redirecting (redirecting to another denied route loops). Also prime the permissions cache with the login response's own effective-permissions field rather than waiting on a second `/auth/me` round trip — avoids a stale one-request-old redirect decision.
