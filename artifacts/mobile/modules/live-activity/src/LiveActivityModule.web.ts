/**
 * Web stub — Live Activities are an iOS-only feature.
 * All exports are async no-ops so web builds compile without errors.
 */
export interface LiveActivityState {
  speedKmh: number;
  speedLimitKmh: number | null;
  nextInstruction: string | null;
  distToNextM: number | null;
  destinationName: string | null;
  isSharingTrip: boolean;
}

export async function startActivity(_state: LiveActivityState): Promise<void> {}
export async function updateActivity(_state: LiveActivityState): Promise<void> {}
export async function endActivity(): Promise<void> {}
