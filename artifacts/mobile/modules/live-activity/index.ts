/**
 * Live Activity native module — public JS interface.
 *
 * All methods are no-ops on Android and web; the iOS implementation uses
 * ActivityKit to render a Dynamic Island / Lock Screen Live Activity while
 * the driver is navigating or sharing their trip.
 */
export {
  startActivity,
  updateActivity,
  endActivity,
  onPushTokenUpdate,
} from "./src/LiveActivityModule";
export type { LiveActivityState } from "./src/LiveActivityModule";
