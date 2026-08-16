import React, { createContext, useContext } from "react";

/**
 * Narrow, high-frequency location context.
 *
 * GPS position/speed/heading update up to every 5 s while driving. Keeping
 * them in the monolithic AppContext forced every `useApp()` consumer (60+
 * screens) to re-render on each fix. This context isolates the hot values so
 * only components that actually read live position re-render on a GPS tick.
 *
 * Provided by AppProvider (context/AppContext.tsx) — the GPS pipeline still
 * lives there; this file only defines the context + hook so consumers can
 * import it without pulling in the provider.
 */
export interface LiveLocationValue {
  currentLat: number | null;
  currentLng: number | null;
  /** Smoothed speed in km/h (rolling-median filtered, integer-gated). */
  currentSpeed: number;
  /** Driver heading in degrees (0–360°), derived from consecutive GPS fixes.
   *  Null until at least two fixes are available or movement is below the
   *  5 m noise threshold. */
  driverHeading: number | null;
}

export const LocationContext = createContext<LiveLocationValue | null>(null);

export function useLiveLocation(): LiveLocationValue {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error("useLiveLocation must be used inside AppProvider");
  return ctx;
}
