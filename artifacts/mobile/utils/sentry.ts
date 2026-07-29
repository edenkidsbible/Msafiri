/**
 * Sentry shim — crash reporting removed.
 * @sentry/react-native's Metro serializer is incompatible with Expo SDK 54's
 * bundle format and causes iOS builds to fail. All calls are no-ops so the
 * rest of the codebase needs no changes.
 */

export function initSentry(): void {}

export const Sentry = {
  /** Transparent passthrough — just returns the component unchanged. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wrap: <T>(component: T): T => component,
  captureException: (_err: unknown): void => {},
  captureMessage: (_msg: string): void => {},
};
