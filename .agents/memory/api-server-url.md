---
name: API server URL pattern
description: How the mobile Expo app reaches the Express API server in the Replit monorepo
---

The API server artifact (`artifacts/api-server`) is registered with `paths = ["/api"]` in `.replit-artifact/artifact.toml`, bound to port 8080.

The Replit reverse proxy maps `https://{REPLIT_DEV_DOMAIN}/api/*` → `http://localhost:8080/api/*` (path prefix is kept intact — not stripped).

The Express app mounts its router at `/api` (`app.use("/api", router)`), so routes are accessible at `/api/healthz`, `/api/reports`, etc.

**Mobile app API base:** `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`

`EXPO_PUBLIC_DOMAIN` is injected as `$REPLIT_DEV_DOMAIN` by the Expo workflow command.

**Why:** Replit path-based routing — each artifact gets a configured path prefix; API artifact uses `/api`.

**How to apply:** Any new backend endpoint lives at `/api/<route>` in Express. Mobile `apiClient.ts` already constructs the correct base URL from `EXPO_PUBLIC_DOMAIN`.
