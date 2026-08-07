/**
 * Navigation background location task — REMOVED.
 *
 * Turn-by-turn navigation has been removed from the app. Route display is
 * now preview-only; the background location task that kept GPS flowing while
 * the screen was locked during navigation is no longer needed.
 *
 * Stubs are kept so any lingering import sites don't break while being cleaned up.
 */

export const NAV_BACKGROUND_TASK = "msafiri-nav-bg";

export function getLastBgNavFixAt(): number { return 0; }
export function defineNavBackgroundTask(): void {}
export async function startBackgroundNavTask(): Promise<boolean> { return false; }
export async function stopBackgroundNavTask(): Promise<void> {}
