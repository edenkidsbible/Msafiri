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
  startActivity(state: LiveActivityState): Promise<void>;
  updateActivity(state: LiveActivityState): Promise<void>;
  endActivity(): Promise<void>;
}

// requireNativeModule throws on web — see LiveActivityModule.web.ts for the
// web stub. On Android, the native module is a no-op Kotlin stub.
const LiveActivityModule =
  requireNativeModule<LiveActivityModuleInterface>("LiveActivityModule");

export async function startActivity(state: LiveActivityState): Promise<void> {
  return LiveActivityModule.startActivity(state);
}

export async function updateActivity(state: LiveActivityState): Promise<void> {
  return LiveActivityModule.updateActivity(state);
}

export async function endActivity(): Promise<void> {
  return LiveActivityModule.endActivity();
}
