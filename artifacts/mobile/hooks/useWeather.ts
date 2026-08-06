/**
 * useWeather — live current weather + locality for the driver's GPS position.
 *
 * Fetches `/weather?lat=&lng=` once when a GPS fix first becomes available and
 * then refreshes every 15 minutes. The continuously-updating lat/lng values are
 * read through a ref so the effect never re-runs on every GPS tick (see the
 * modal-refetch-gps-dependency lesson) — only the "has a fix at all" boolean
 * transition triggers the initial fetch.
 *
 * Returns nulls until data arrives or when the endpoint fails, so callers can
 * fall back gracefully (e.g. hide the chip or show placeholders).
 */

import { useEffect, useRef, useState } from "react";
import { apiGet } from "@/utils/apiClient";

export interface WeatherData {
  tempC: number | null;
  description: string | null;
  weatherCode: number | null;
  locality: string | null;
}

const REFRESH_MS = 15 * 60 * 1000;

/** Ionicons name for a WMO weather code (fallback: partly sunny). */
export function weatherIcon(code: number | null): string {
  if (code == null) return "partly-sunny-outline";
  if (code === 0) return "sunny-outline";
  if (code <= 3) return "partly-sunny-outline";
  if (code <= 48) return "cloud-outline";
  if (code <= 67) return "rainy-outline";
  if (code <= 77) return "snow-outline";
  if (code <= 86) return "rainy-outline";
  if (code >= 95) return "thunderstorm-outline";
  return "cloudy-outline";
}

export function useWeather(lat: number | null, lng: number | null): WeatherData | null {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const coordsRef = useRef<{ lat: number; lng: number } | null>(null);
  coordsRef.current = lat != null && lng != null ? { lat, lng } : coordsRef.current;

  const hasFix = lat != null && lng != null;

  useEffect(() => {
    if (!hasFix) return;
    let alive = true;

    const load = async () => {
      const c = coordsRef.current;
      if (!c) return;
      try {
        const data = await apiGet<WeatherData>(
          `/weather?lat=${c.lat.toFixed(4)}&lng=${c.lng.toFixed(4)}`,
        );
        if (alive && data && data.tempC != null) setWeather(data);
      } catch {
        // keep previous value (or null) — chip falls back gracefully
      }
    };

    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(interval); };
  }, [hasFix]);

  return weather;
}
