/**
 * Sentry shim — crash reporting removed.
 * @sentry/react was removed because the Metro serializer in @sentry/react-native
 * was incompatible with the build toolchain. All exports are no-ops.
 */

export function initSentry(): void {}
