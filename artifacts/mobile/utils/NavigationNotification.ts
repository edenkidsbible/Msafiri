/**
 * Android-only persistent navigation status notification.
 *
 * Renders as a single sticky, silently-updating notification in the
 * notification shade — identical in concept to Google Maps' navigation bar —
 * whenever the driver is navigating or sharing their trip while backgrounded.
 *
 * All exported functions are no-ops on iOS and web; iOS uses the Live
 * Activity (Task #44) instead.
 *
 * The notification never stacks: every call schedules with the same stable
 * identifier, so the OS replaces the existing tile rather than creating a
 * new one.
 */
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const NAV_NOTIFICATION_ID = "msafiri-nav-status";

export interface NavNotificationState {
  speedKmh: number;
  speedLimitKmh: number | null;
  /** Next turn instruction, e.g. "Turn right onto Mombasa Road" */
  nextInstruction: string | null;
  distToNextM: number | null;
  destinationName: string | null;
  isSharingTrip: boolean;
  durationRemainingS: number | null;
  /** Whether turn-by-turn navigation is active (as opposed to share-only). */
  navigationActive: boolean;
}

// ── Action identifiers ────────────────────────────────────────────────────────
// These string constants are shared with the notification response listener in
// usePushNotifications.ts so both sides stay in sync.
export const ACTION_STOP_NAVIGATION = "STOP_NAVIGATION";
export const ACTION_STOP_SHARING    = "STOP_SHARING";

// ── Notification category IDs ─────────────────────────────────────────────────
// Each category carries a different action button label:
//   nav_active   → "Stop Navigation"  (nav is running, possibly also sharing)
//   sharing_only → "Stop Sharing"     (only the trip-share session is live)
const CATEGORY_NAV_ACTIVE   = "nav_active";
const CATEGORY_SHARING_ONLY = "sharing_only";

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtDist(m: number | null): string {
  if (m == null) return "";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function fmtEta(s: number | null): string {
  if (s == null) return "";
  const mins = Math.round(s / 60);
  if (mins < 1) return "< 1 min";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function buildContent(
  state: NavNotificationState,
): { title: string; body: string; categoryIdentifier: string } {
  const {
    speedKmh,
    speedLimitKmh,
    nextInstruction,
    distToNextM,
    destinationName,
    isSharingTrip,
    durationRemainingS,
    navigationActive,
  } = state;

  // Title: distance-to-manoeuvre + instruction, or destination on final stretch
  let title: string;
  if (nextInstruction) {
    const prefix = distToNextM != null ? `${fmtDist(distToNextM)} — ` : "";
    title = prefix + nextInstruction;
  } else {
    title = destinationName ?? "Navigating";
  }

  // Body: speed · limit · share dot · ETA
  const parts: string[] = [`${Math.round(speedKmh)} km/h`];
  if (speedLimitKmh != null) parts.push(`Limit ${speedLimitKmh} km/h`);
  if (isSharingTrip) parts.push("● Sharing");
  const eta = fmtEta(durationRemainingS);
  if (eta) parts.push(eta);

  // Action button: nav running → "Stop Navigation"; share-only → "Stop Sharing"
  const categoryIdentifier = navigationActive
    ? CATEGORY_NAV_ACTIVE
    : CATEGORY_SHARING_ONLY;

  return { title, body: parts.join("  ·  "), categoryIdentifier };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register the notification categories that carry the action buttons.
 * Must be called once during app startup (before any nav notification fires).
 * Safe to call multiple times — expo-notifications is idempotent.
 */
export async function registerNavNotificationCategories(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Promise.all([
    Notifications.setNotificationCategoryAsync(CATEGORY_NAV_ACTIVE, [
      {
        identifier: ACTION_STOP_NAVIGATION,
        buttonTitle: "Stop Navigation",
        options: {
          // Foreground the app so the response listener can call stopNavigation()
          opensAppToForeground: true,
          isDestructive: false,
          isAuthenticationRequired: false,
        },
      },
    ]),
    Notifications.setNotificationCategoryAsync(CATEGORY_SHARING_ONLY, [
      {
        identifier: ACTION_STOP_SHARING,
        buttonTitle: "Stop Sharing",
        options: {
          opensAppToForeground: true,
          isDestructive: false,
          isAuthenticationRequired: false,
        },
      },
    ]),
  ]);
}

/**
 * Show (or replace) the persistent navigation notification.
 * Safe to call repeatedly — always updates the same tile.
 */
export async function showNavNotification(
  state: NavNotificationState,
): Promise<void> {
  if (Platform.OS !== "android") return;

  const { title, body, categoryIdentifier } = buildContent(state);

  await Notifications.scheduleNotificationAsync({
    identifier: NAV_NOTIFICATION_ID,
    content: {
      title,
      body,
      data: { type: "nav_status" },
      // categoryIdentifier links this notification to the registered category
      // so the OS renders the correct action button in the shade and lock screen.
      categoryIdentifier,
      // sticky prevents the notification from being cleared when the user
      // swipes away the notification shade; it persists until explicitly
      // dismissed by the app (via dismissNavNotification).
      sticky: true,
      color: "#00C853",
    },
    // channelId routes the notification to the silent msafiri_nav channel so
    // it produces no sound, vibration, or heads-up banner.
    trigger: { channelId: "msafiri_nav" } as any,
  });
}

/** Replace the existing tile with updated content. Identical to showNavNotification. */
export async function updateNavNotification(
  state: NavNotificationState,
): Promise<void> {
  return showNavNotification(state);
}

/** Remove the navigation notification. Called when nav and sharing both end. */
export async function dismissNavNotification(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.dismissNotificationAsync(NAV_NOTIFICATION_ID).catch(
    () => {},
  );
}
