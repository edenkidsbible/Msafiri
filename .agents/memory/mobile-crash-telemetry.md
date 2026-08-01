---
name: Mobile crash telemetry (Sentry)
description: How crash reporting is wired in the mobile app — DSN gating, web no-op, breadcrumb conventions, and what still needs the user's Sentry account.
---

# Mobile crash telemetry

All Sentry access goes through `utils/telemetry.ts`; nothing else imports `@sentry/react-native` directly.

**Rules:**
- Init is gated on `EXPO_PUBLIC_SENTRY_DSN` and skipped on web. Every helper (navBreadcrumb, gpsBreadcrumb, captureError, wrapRoot) is a safe no-op when disabled — call sites never check.
- `utils/telemetry.web.ts` is a full no-op twin so `@sentry/react-native` never enters the web bundle (Metro platform suffix).
- `initTelemetry()` runs at the very top of `app/_layout.tsx`, BEFORE the custom ErrorUtils/Hermes crash-net blocks, so Sentry's handlers are installed first and the custom ones chain on top. The Hermes promise-rejection tracker overrides Sentry's (last registration wins) — the custom onUnhandled forwards to `captureError` manually.
- Metro uses `getSentryExpoConfig` (wraps expo default, injects debug IDs); app.config.js has the `@sentry/react-native/expo` plugin with org/project from `SENTRY_ORG`/`SENTRY_PROJECT` env (only needed for source-map upload with `SENTRY_AUTH_TOKEN`; builds succeed without).

**Breadcrumb categories:** `nav` (start/stop/reroute/faster-route), `gps` (throttled fixes 1/5s, signal lost/regained, watchdog resubscribe), `map.camera` (nav-start zoom, zoom-band change, recenter, post-nav restore — NOT the per-fix follow animate, which would flood), `map.render` (marker freeze, active-polyline rebuilds).

**Why:** repeated blind fixes for the in-nav native crash failed; the telemetry exists to get a real native stack. Escalation path if evidence blames react-native-maps: migrate drive map to Mapbox (token already in secrets).

**Pending:** the user must supply `EXPO_PUBLIC_SENTRY_DSN` (their Sentry project) — until then init no-ops. End-to-end test helper: `sendTelemetryTestError()` in telemetry.ts.
