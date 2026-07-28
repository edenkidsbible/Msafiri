/**
 * Sentry initialisation for the Msafiri admin app.
 *
 * Gated on VITE_SENTRY_DSN — without it (local dev, preview without the
 * secret) this module is a no-op and the ErrorBoundary still renders fine.
 *
 * Philosophy mirrors the API server and mobile app: errors only (no
 * performance tracing on the free plan), and minimal PII — we tag the
 * logged-in admin's id and role only, never name/email.
 */
import * as Sentry from "@sentry/react";
import { getUser } from "./auth";

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

export function initSentry(): void {
  if (!DSN) return;

  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    // Errors only — no performance tracing on the free plan
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      // Tag the logged-in admin by id/role only (no name or email), resolved
      // at send time so it's always the current session's user.
      const user = getUser();
      if (user) {
        event.user = { id: String(user.id) };
        event.tags = { ...event.tags, admin_role: user.role ?? "unknown" };
      } else {
        delete event.user;
      }
      return event;
    },
  });
}

export { Sentry };
