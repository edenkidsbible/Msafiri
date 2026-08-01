// ── Crash telemetry (Sentry) ──────────────────────────────────────────────────
// Native + JS crash capture for the mobile app. All access goes through this
// module so call sites never need to know whether telemetry is enabled:
// every helper is a safe no-op when no DSN is configured or on web.
//
// DSN comes from EXPO_PUBLIC_SENTRY_DSN at build/export time. Without it the
// SDK is never initialised (zero runtime cost beyond the module import).

import { Platform } from "react-native";
import * as Sentry from "@sentry/react-native";

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

let initialized = false;

/** Initialise Sentry as early as possible (module scope of the root layout).
 *  No-op on web (native crash capture is meaningless there and the RN SDK's
 *  web shim adds noise) and when no DSN is configured. */
export function initTelemetry(): boolean {
  if (initialized || Platform.OS === "web" || !DSN) return initialized;
  try {
    Sentry.init({
      dsn: DSN,
      // Native crash handlers (NDK / Mach exceptions) — the whole point of
      // this integration is catching react-native-maps native crashes.
      enableNative: true,
      enableNativeCrashHandling: true,
      enableNativeNagger: false,
      // Watchdog/ANR-style terminations often masquerade as "crashes" during
      // navigation — capture them too.
      enableAppHangTracking: true,
      // Breadcrumb budget: GPS fixes are throttled below, but nav sessions are
      // long — keep a generous trail so the moments before a crash are visible.
      maxBreadcrumbs: 150,
      // No performance tracing — we only want crashes and errors.
      tracesSampleRate: 0,
      sendDefaultPii: false,
    });
    initialized = true;
  } catch (e) {
    console.warn("[telemetry] Sentry init failed:", e);
  }
  return initialized;
}

export function telemetryEnabled(): boolean {
  return initialized;
}

/** Record a navigation/map lifecycle breadcrumb. Safe no-op when disabled. */
export function navBreadcrumb(
  category:
    | "nav"        // start/stop/reroute/faster-route
    | "gps"        // fixes, signal loss, watchdog resubscribes
    | "map.camera" // animateCamera / animateToRegion / fitToCoordinates
    | "map.render",// marker freeze toggles, polyline rebuilds
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!initialized) return;
  try {
    Sentry.addBreadcrumb({ category, message, data, level: "info" });
  } catch { /* never let telemetry break the app */ }
}

// GPS fixes arrive at 1 Hz during navigation — record at most one breadcrumb
// every GPS_CRUMB_INTERVAL_MS so the trail covers the last several minutes
// instead of the last two.
const GPS_CRUMB_INTERVAL_MS = 5_000;
let lastGpsCrumbAt = 0;

/** Throttled breadcrumb for GPS fixes (last-known positions before a crash). */
export function gpsBreadcrumb(lat: number, lng: number, speedKmh: number, accuracy?: number | null): void {
  if (!initialized) return;
  const now = Date.now();
  if (now - lastGpsCrumbAt < GPS_CRUMB_INTERVAL_MS) return;
  lastGpsCrumbAt = now;
  navBreadcrumb("gps", "fix", {
    lat: Number(lat.toFixed(5)),
    lng: Number(lng.toFixed(5)),
    speedKmh: Math.round(speedKmh),
    accuracy: accuracy != null ? Math.round(accuracy) : undefined,
  });
}

/** Capture a handled error with optional context. Safe no-op when disabled. */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  try {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch { /* ignore */ }
}

/** Deliberate end-to-end test: sends a tagged error so the team can confirm
 *  events flow from a device build into the Sentry project. */
export function sendTelemetryTestError(): boolean {
  if (!initialized) return false;
  Sentry.captureException(new Error("Msafiri telemetry test error — safe to ignore"));
  return true;
}

/** Wrap the root component (touch-event breadcrumbs, profiler). Identity
 *  function when telemetry is disabled so web/dev builds are untouched. */
export function wrapRoot<P extends Record<string, unknown>>(
  component: React.ComponentType<P>,
): React.ComponentType<P> {
  if (!initialized) return component;
  try {
    return Sentry.wrap(component);
  } catch {
    return component;
  }
}
