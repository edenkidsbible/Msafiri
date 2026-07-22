/**
 * Tracks how many roundabout arms the driver has swept past during the
 * active roundabout navigation step.
 *
 * Strategy: accumulate absolute bearing change from consecutive GPS fixes.
 * For a roundabout with N exits, each arm is ~360/N degrees apart.
 * exitsPassedCount = floor(cumulativeRotation / (360/N)), clamped below N-1
 * so the driver never "passes" the exit they're supposed to take.
 *
 * Resets automatically when:
 *   - Navigation is not active
 *   - The step index changes (moved past this step)
 *   - targetExitNumber becomes null (non-roundabout step)
 */

import { useEffect, useRef, useState } from "react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function bearingDeg(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const f1 = (lat1 * Math.PI) / 180;
  const f2 = (lat2 * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function haversineM(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180, f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180, dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Hook ────────────────────────────────────────────────────────────────────

interface RoundaboutExitCounterInput {
  currentLat: number | null;
  currentLng: number | null;
  currentStepIdx: number;
  navigationActive: boolean;
  /** exitNumber from the current RouteStep; null when the step is not a roundabout. */
  targetExitNumber: number | null;
}

interface RoundaboutExitCounterOutput {
  /** How many exits the driver has already swept past (0-based count). */
  exitsPassed: number;
  /** True when the very next exit ahead is the one to take. */
  targetExitIsNext: boolean;
}

export function useRoundaboutExitCounter({
  currentLat,
  currentLng,
  currentStepIdx,
  navigationActive,
  targetExitNumber,
}: RoundaboutExitCounterInput): RoundaboutExitCounterOutput {
  const [exitsPassed, setExitsPassed] = useState(0);

  const prevLatRef      = useRef<number | null>(null);
  const prevLngRef      = useRef<number | null>(null);
  const lastBearingRef  = useRef<number | null>(null);
  const cumulRotRef     = useRef(0);
  const lastStepRef     = useRef<number | null>(null);

  useEffect(() => {
    const isRoundabout = navigationActive && targetExitNumber != null && targetExitNumber >= 1;

    if (!isRoundabout) {
      // Leaving or not in a roundabout — reset counter
      if (lastStepRef.current !== null) {
        setExitsPassed(0);
        lastBearingRef.current = null;
        cumulRotRef.current    = 0;
        lastStepRef.current    = null;
      }
      prevLatRef.current = currentLat;
      prevLngRef.current = currentLng;
      return;
    }

    // Driver entered a new roundabout step — full reset
    if (lastStepRef.current !== currentStepIdx) {
      lastStepRef.current    = currentStepIdx;
      cumulRotRef.current    = 0;
      lastBearingRef.current = null;
      setExitsPassed(0);
    }

    if (currentLat == null || currentLng == null) return;

    const prevLat = prevLatRef.current;
    const prevLng = prevLngRef.current;

    if (prevLat != null && prevLng != null) {
      const dist = haversineM(prevLat, prevLng, currentLat, currentLng);

      // Require at least 3 m of movement to suppress stationary GPS jitter
      if (dist >= 3) {
        const bearing = bearingDeg(prevLat, prevLng, currentLat, currentLng);

        if (lastBearingRef.current !== null) {
          // Signed angular delta in (−180, +180]
          const rawDelta = ((bearing - lastBearingRef.current + 540) % 360) - 180;

          // Sanity gate: ignore jumps >90° (GPS noise / tunnel dropout)
          if (Math.abs(rawDelta) < 90) {
            cumulRotRef.current += Math.abs(rawDelta);

            const degreesPerExit = 360 / targetExitNumber;
            const passed = Math.min(
              Math.floor(cumulRotRef.current / degreesPerExit),
              targetExitNumber - 1, // never count the exit to take as "passed"
            );
            setExitsPassed(passed);
          }
        }

        lastBearingRef.current = bearing;
      }
    }

    prevLatRef.current = currentLat;
    prevLngRef.current = currentLng;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLat, currentLng, currentStepIdx, navigationActive, targetExitNumber]);

  const targetExitIsNext =
    targetExitNumber != null &&
    targetExitNumber >= 1 &&
    exitsPassed === targetExitNumber - 1;

  return { exitsPassed, targetExitIsNext };
}
