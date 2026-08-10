// Telemetry no-ops. All call sites are kept so nothing needs to change.

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
