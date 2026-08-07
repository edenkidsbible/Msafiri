/**
 * Navigation status notification — REMOVED.
 *
 * Turn-by-turn navigation has been removed from the app. This file is kept as
 * a stub so any remaining import sites don't break immediately.
 */
import { Platform } from "react-native";

export interface NavNotificationState {
  speedKmh: number;
  speedLimitKmh: number | null;
  nextInstruction: string | null;
  distToNextM: number | null;
  destinationName: string | null;
  isSharingTrip: boolean;
  durationRemainingS: number | null;
  navigationActive: boolean;
}

export const ACTION_STOP_NAVIGATION = "STOP_NAVIGATION";
export const ACTION_STOP_SHARING    = "STOP_SHARING";

export async function registerNavNotificationCategories(): Promise<void> {}
export async function showNavNotification(_state: NavNotificationState): Promise<void> {}
export async function updateNavNotification(_state: NavNotificationState): Promise<void> {}
export async function dismissNavNotification(): Promise<void> {}
