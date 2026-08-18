---
name: Ops Platform Integration
description: How the Msafiri Founder OS operations platform was integrated into the admin dashboard
---

## Architecture decisions

**DB tables**: All ops tables are prefixed `ops_` to avoid collision. Schema in `lib/db/src/schema/ops.ts`, CREATE TABLE IF NOT EXISTS statements in `migrateSchema.ts`.

**Auth**: Ops routes use existing `adminAuthMiddleware` (JWT). No second login. `req.user` → `(req as any).adminUser`. adminUsers have `name` field (not firstName/lastName), roles: `founder|admin|moderator|viewer`.

**API routes**: All ops endpoints under `/api/ops/` prefix. Mounted in `artifacts/api-server/src/routes/index.ts` with `router.use("/ops", adminAuthMiddleware, opsRouter)`. Route files in `artifacts/api-server/src/routes/ops/`.

**Frontend routes**: All ops pages under `/ops/` prefix. Lazy-loaded in admin `App.tsx`. Pages in `artifacts/admin/src/pages/ops/`.

**Navigation**: Admin sidebar has "Operations" section at top with 11 items: Command, This Week, Money, Tasks, Content, Field & Road, Subscribers, Team, Chat, Import, Ops Settings. Chat badge shows unread count polled every 30s from `/api/ops/chat/unread`.

**Form components**: Ops form components (`DepartmentForm`, `TeamMemberForm`, `TransactionForm`, etc.) are dialog-style — they take `open` and `onClose` props and render their own `FormDialog` wrapper. Do NOT wrap them in additional `<Dialog>` tags.

**formatKes**: Added to `artifacts/admin/src/lib/utils.ts` — always import from there in ops pages, don't define inline.

**Chat**: WebSocket not implemented yet. Chat page shows REST-fetched conversation list + message view with 5s polling. Full real-time WebSocket deferred to follow-up.

**Invitations**: Accept-by-token endpoint removed (required Replit SSO, not applicable). Invite flow creates a token and returns it in the API response so admin can share the link manually.

## File locations
- Schema: `lib/db/src/schema/ops.ts`
- Route files: `artifacts/api-server/src/routes/ops/*.ts` (index.ts + 11 route files)
- Pages: `artifacts/admin/src/pages/ops/*.tsx` (11 pages)
- Form components: `artifacts/admin/src/components/ops/*.tsx`
- Sidebar: `artifacts/admin/src/components/layout/admin-layout.tsx`

## Why
Merged standalone ops platform into admin to avoid maintaining two separate auth systems and two deployments. All admin users automatically have access to ops (no role gating needed initially).
