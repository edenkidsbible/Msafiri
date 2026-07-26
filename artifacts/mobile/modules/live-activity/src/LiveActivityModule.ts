import { NativeModule, requireNativeModule } from "expo-modules-core";

export interface LiveActivityState {
  /** Driver's current speed in km/h */
  speedKmh: number;
  /** Posted speed limit in km/h, or null if unknown */
  speedLimitKmh: number | null;
  /** Next turn instruction string, e.g. "Turn right onto Mombasa Road" */
  nextInstruction: string | null;
  /** Distance to the next manoeuvre in metres */
  distToNextM: number | null;
  /** Destination display name */
  destinationName: string | null;
  /** Whether the driver's live-sharing session is active */
  isSharingTrip: boolean;
  /**
   * Unix timestamp (seconds) of this update.  The Live Activity widget uses
   * this to detect when iOS has suspended the app and the speed value is
   * frozen — if the age exceeds 15 s the widget shows a stale-data indicator
   * instead of the (potentially misleading) last-known speed.
   */
  lastUpdatedAt: number;
}

interface LiveActivityModuleInterface extends NativeModule {
  /**
   * Start a Live Activity and return the APNs push token (hex-encoded)
   * that the server can use to push ContentState updates directly when the
   * app is suspended.  Returns null if ActivityKit has not yet issued a
   * token within the two-second wait window.
   */
  startActivity(state: LiveActivityState): Promise<string | null>;
  updateActivity(state: LiveActivityState): Promise<void>;
  endActivity(): Promise<void>;

  /** Fired by the native layer whenever ActivityKit rotates the push token. */
  addListener(event: "onPushTokenUpdate", handler: (payload: { token: string }) => void): { remove(): void };
}

// requireNativeModule throws on web — see LiveActivityModule.web.ts for the
// web stub. On Android, the native module is a no-op Kotlin stub.
const LiveActivityModule =
  requireNativeModule<LiveActivityModuleInterface>("LiveActivityModule");

/**
 * Start the Live Activity.  Returns the APNs push token (hex string) that
 * can be uploaded to the server for remote updates, or null if the OS has
 * not yet assigned one.
 */
export async function startActivity(state: LiveActivityState): Promise<string | null> {
  return LiveActivityModule.startActivity(state);
}

export async function updateActivity(state: LiveActivityState): Promise<void> {
  return LiveActivityModule.updateActivity(state);
}

export async function endActivity(): Promise<void> {
  return LiveActivityModule.endActivity();
}

/**
 * Subscribe to push-token rotations.  ActivityKit may rotate the token
 * during a long activity; each new token should be uploaded to the server
 * so it can continue sending remote updates.
 */
export function onPushTokenUpdate(
  handler: (token: string) => void
): { remove(): void } {
  return LiveActivityModule.addListener("onPushTokenUpdate", ({ token }) => handler(token));
}
