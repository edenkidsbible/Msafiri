// Web no-op variant of the crash-telemetry module. Native crash capture is
// meaningless in the browser preview, and keeping @sentry/react-native out of
// the web bundle avoids any bundling/runtime surprises there. Metro picks
// this file on web via the .web.ts platform suffix; native uses telemetry.ts.

export function initTelemetry(): boolean {
  return false;
}

export function telemetryEnabled(): boolean {
  return false;
}

export function navBreadcrumb(
  _category: "nav" | "gps" | "map.camera" | "map.render",
  _message: string,
  _data?: Record<string, unknown>,
): void {}

export function gpsBreadcrumb(
  _lat: number,
  _lng: number,
  _speedKmh: number,
  _accuracy?: number | null,
): void {}

export function captureError(_error: unknown, _context?: Record<string, unknown>): void {}

export function sendTelemetryTestError(): boolean {
  return false;
}

export function wrapRoot<P extends Record<string, unknown>>(
  component: React.ComponentType<P>,
): React.ComponentType<P> {
  return component;
}
