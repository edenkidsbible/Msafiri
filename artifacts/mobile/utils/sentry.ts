/**
 * Sentry initialisation for the Msafiri mobile app.
 *
 * Gated on EXPO_PUBLIC_SENTRY_DSN — if the variable is absent (local dev,
 * CI without the secret) the module is a no-op and Sentry.wrap() still works
 * safely (it becomes a transparent passthrough).
 *
 * GPS scrubbing: the beforeSend hook strips lat/lng fields from every event
 * context and extra dict before the payload leaves the device, so no precise
 * location data reaches the Sentry dashboard.
 */

import * as Sentry from "@sentry/react-native";
import type { ErrorEvent } from "@sentry/react-native";
import Constants from "expo-constants";
import { Platform } from "react-native";

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

/** GPS-related field names to remove from Sentry event payloads. */
const GPS_FIELDS = new Set([
  "lat", "lng", "latitude", "longitude",
  "location", "coords", "gps", "accuracy",
  "heading", "altitude",
]);

/** Returns true when the top stack frame originates from Metro HMR machinery. */
function isHmrNoise(event: ErrorEvent): boolean {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames;
  if (!frames?.length) return false;
  // Frames are ordered innermost-last; the "top" frame is the last one.
  const top = frames[frames.length - 1];
  const fn = top?.function ?? "";
  const file = top?.filename ?? top?.abs_path ?? "";
  return fn.includes("HMRClient") || file.includes("HMRClient");
}

function scrubGps(event: ErrorEvent, _hint: unknown): ErrorEvent | null {
  // Drop Metro HMR noise — these events are dev-only bundle reload errors,
  // not real application crashes.
  if (isHmrNoise(event)) return null;

  // Strip from contexts (device, runtime, custom contexts)
  if (event.contexts) {
    for (const ctx of Object.values(event.contexts)) {
      if (ctx && typeof ctx === "object") {
        for (const field of GPS_FIELDS) {
          delete (ctx as Record<string, unknown>)[field];
        }
      }
    }
  }
  // Strip from top-level extra
  if (event.extra) {
    for (const field of GPS_FIELDS) {
      delete event.extra[field];
    }
  }
  return event;
}

export function initSentry(): void {
  if (!DSN) return;

  Sentry.init({
    dsn: DSN,
    environment: __DEV__ ? "development" : "production",
    // Use app version from Expo config so events correlate with releases
    release: Constants.expoConfig?.version ?? "unknown",
    dist: Platform.OS,
    // Errors only — no performance tracing on the free plan
    tracesSampleRate: 0,
    beforeSend: scrubGps,
  });
}

// Re-export so callers can do `import { Sentry } from "@/utils/sentry"` for
// manual captureException calls without pulling in the full package directly.
export { Sentry };
