/**
 * useDriveScore — lightweight driving-behaviour sensor hook.
 *
 * Subscribes to the device accelerometer at 20 Hz when `active=true` and
 * classifies sustained G-force deviations into three event types:
 *   • harsh_brake  — sustained longitudinal deceleration > threshold
 *   • harsh_accel  — sustained longitudinal acceleration > threshold
 *   • sharp_turn   — sustained lateral acceleration > threshold
 *
 * Also tracks:
 *   • speedingMinutes  — minutes where GPS speed exceeded the speed limit
 *   • smoothMinutes    — minutes with no harsh events (for score bonus)
 *   • distanceM        — cumulative trip distance via haversine GPS diff
 *   • maxSpeedKmh      — peak GPS speed during the trip
 *
 * The live score is computed client-side using the same formula as the server
 * (so the driver sees a real-time number).  The server recomputes on /end for
 * the permanent record to keep the algorithm in one authoritative place.
 *
 * Phone orientation note: accelerometer axes depend on how the phone is
 * mounted.  We use the dominant horizontal axis to classify events, which
 * works well for typical dashboard/cupholder mounts.  Accuracy improves with
 * a windshield mount (phone upright, facing driver).
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Platform } from "react-native";
import { Accelerometer } from "expo-sensors";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Gravity in m/s² (standard). */
const G = 9.80665;

/**
 * Net-G threshold for a harsh driving event.
 * Net-G = |√(x²+y²+z²) − 9.8|  (deviation from 1g magnitude).
 *
 * Hard-brake at −5.5 m/s²: rawG ≈ 11.2 → netG ≈ 1.45
 * Rapid-accel at  +5.0 m/s²: rawG ≈ 11.0 → netG ≈ 1.25
 * Sharp turn at  ±4.0 m/s²: rawG ≈ 10.6 → netG ≈ 0.85
 * Normal braking −2.0 m/s²: rawG ≈ 10.0 → netG ≈ 0.20
 *
 * Using 0.8 catches sharp turns while ignoring normal driving.
 */
const HARSH_NET_G = 0.8;

/** Lateral G dominant over longitudinal G by this ratio → classify as turn. */
const TURN_AXIS_RATIO = 1.2;

/** Minimum ms between events of the same type (debounce). */
const DEBOUNCE_MS = 5_000;

/** Number of 50 ms samples that must ALL exceed HARSH_NET_G (= 300 ms). */
const WINDOW_SIZE = 6;

/** Speeding: km/h buffer above the posted limit before counting. */
const SPEEDING_BUFFER_KMH = 5;

/** Scoring formula weights (mirrors server-side computeScore). */
const W = {
  harshBrake:     2,
  harshAccel:     1,
  sharpTurn:      1,
  speedingMinute: 2,
  smoothBonus:    1,   // per 15 smooth minutes, capped at +5
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DriveScoreSnapshot {
  score:           number;
  harshBrakes:     number;
  harshAccels:     number;
  sharpTurns:      number;
  speedingMinutes: number;
  smoothMinutes:   number;
  maxSpeedKmh:     number;
  distanceM:       number;
}

// ── Haversine helper ──────────────────────────────────────────────────────────

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R    = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Score formula ─────────────────────────────────────────────────────────────

function computeLiveScore(snap: Omit<DriveScoreSnapshot, "score">): number {
  const penalty =
    snap.harshBrakes     * W.harshBrake +
    snap.harshAccels     * W.harshAccel +
    snap.sharpTurns      * W.sharpTurn  +
    snap.speedingMinutes * W.speedingMinute;
  const bonus = Math.min(Math.floor(snap.smoothMinutes / 15), 5) * W.smoothBonus;
  return Math.max(0, Math.min(100, 100 - penalty + bonus));
}

// ── Hook ──────────────────────────────────────────────────────────────────────

interface UseDriveScoreOptions {
  active:            boolean;
  currentSpeed:      number;          // km/h (from GPS)
  currentSpeedLimit: number | null;   // km/h or null when unknown
  currentLat:        number | null;
  currentLng:        number | null;
}

export function useDriveScore({
  active,
  currentSpeed,
  currentSpeedLimit,
  currentLat,
  currentLng,
}: UseDriveScoreOptions) {
  // ── Reactive state (drives UI) ──────────────────────────────────────────
  const [score,           setScore]           = useState(100);
  const [harshBrakes,     setHarshBrakes]     = useState(0);
  const [harshAccels,     setHarshAccels]     = useState(0);
  const [sharpTurns,      setSharpTurns]      = useState(0);
  const [speedingMinutes, setSpeedingMinutes] = useState(0);
  const [smoothMinutes,   setSmoothMinutes]   = useState(0);
  const [maxSpeedKmh,     setMaxSpeedKmh]     = useState(0);
  const [distanceM,       setDistanceM]       = useState(0);

  // ── Mutable refs (safe to read inside event listeners / intervals) ───────
  const harshBrakesRef     = useRef(0);
  const harshAccelsRef     = useRef(0);
  const sharpTurnsRef      = useRef(0);
  const speedingMinutesRef = useRef(0);
  const smoothMinutesRef   = useRef(0);
  const maxSpeedRef        = useRef(0);
  const distanceRef        = useRef(0);

  const lastLatRef     = useRef<number | null>(null);
  const lastLngRef     = useRef<number | null>(null);
  const lastEventRef   = useRef<Record<string, number>>({});
  const lastHarshRef   = useRef(0); // timestamp of last harsh event

  // Rolling window: last WINDOW_SIZE net-G samples + raw axes
  const windowRef = useRef<Array<{ netG: number; ax: number; ay: number }>>([]);

  // Speeding / smooth second counters (reset on each minute boundary)
  const speedingSecsRef = useRef(0);
  const smoothSecsRef   = useRef(0);

  // Refs for speed / limit (so the 1-second interval never sees stale closures)
  const speedRef      = useRef(0);
  const limitRef      = useRef<number | null>(null);
  useEffect(() => { speedRef.current = currentSpeed; }, [currentSpeed]);
  useEffect(() => { limitRef.current = currentSpeedLimit; }, [currentSpeedLimit]);

  // ── Score recompute ───────────────────────────────────────────────────────
  const recompute = useCallback(() => {
    const s = computeLiveScore({
      harshBrakes:     harshBrakesRef.current,
      harshAccels:     harshAccelsRef.current,
      sharpTurns:      sharpTurnsRef.current,
      speedingMinutes: speedingMinutesRef.current,
      smoothMinutes:   smoothMinutesRef.current,
      maxSpeedKmh:     maxSpeedRef.current,
      distanceM:       Math.round(distanceRef.current),
    });
    setScore(s);
  }, []);

  // ── Reset state for a new trip ────────────────────────────────────────────
  const wasActive = useRef(false);
  useEffect(() => {
    if (active && !wasActive.current) {
      harshBrakesRef.current     = 0;
      harshAccelsRef.current     = 0;
      sharpTurnsRef.current      = 0;
      speedingMinutesRef.current = 0;
      smoothMinutesRef.current   = 0;
      maxSpeedRef.current        = 0;
      distanceRef.current        = 0;
      lastLatRef.current         = null;
      lastLngRef.current         = null;
      lastEventRef.current       = {};
      lastHarshRef.current       = 0;
      windowRef.current          = [];
      speedingSecsRef.current    = 0;
      smoothSecsRef.current      = 0;

      setScore(100);
      setHarshBrakes(0);
      setHarshAccels(0);
      setSharpTurns(0);
      setSpeedingMinutes(0);
      setSmoothMinutes(0);
      setMaxSpeedKmh(0);
      setDistanceM(0);
    }
    wasActive.current = active;
  }, [active]);

  // ── Accelerometer subscription ────────────────────────────────────────────
  useEffect(() => {
    if (!active || Platform.OS === "web") return;

    Accelerometer.setUpdateInterval(50); // 20 Hz

    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const rawMag = Math.sqrt(x * x + y * y + z * z);
      const netG   = Math.abs(rawMag - G);

      // Append to rolling window; keep last WINDOW_SIZE samples
      const win = windowRef.current;
      win.push({ netG, ax: x, ay: y });
      if (win.length > WINDOW_SIZE) win.shift();
      if (win.length < WINDOW_SIZE) return;

      // All samples must exceed the threshold (sustained event)
      if (!win.every((s) => s.netG >= HARSH_NET_G)) return;

      const now   = Date.now();
      const meanX = win.reduce((s, e) => s + e.ax, 0) / WINDOW_SIZE;
      const meanY = win.reduce((s, e) => s + e.ay, 0) / WINDOW_SIZE;
      const absX  = Math.abs(meanX);
      const absY  = Math.abs(meanY);

      // Classify by dominant horizontal axis
      let type: "brake" | "accel" | "turn";
      if (absY > absX * TURN_AXIS_RATIO) {
        type = "turn";
      } else if (meanX < -0.3 * G) {
        type = "brake";
      } else {
        type = "accel";
      }

      // Debounce
      const last = lastEventRef.current[type] ?? 0;
      if (now - last < DEBOUNCE_MS) return;
      lastEventRef.current[type] = now;
      lastHarshRef.current = now;

      if (type === "brake") {
        harshBrakesRef.current += 1;
        setHarshBrakes(harshBrakesRef.current);
      } else if (type === "accel") {
        harshAccelsRef.current += 1;
        setHarshAccels(harshAccelsRef.current);
      } else {
        sharpTurnsRef.current += 1;
        setSharpTurns(sharpTurnsRef.current);
      }

      recompute();
    });

    return () => sub.remove();
  }, [active, recompute]);

  // ── 1-second tick: speed tracking, speeding minutes, smooth minutes ───────
  useEffect(() => {
    if (!active) return;

    const id = setInterval(() => {
      const spd   = speedRef.current;
      const limit = limitRef.current;

      // Max speed
      if (spd > maxSpeedRef.current) {
        maxSpeedRef.current = spd;
        setMaxSpeedKmh(spd);
      }

      // Speeding: accumulate seconds above limit + buffer
      if (limit != null && limit > 0 && spd > limit + SPEEDING_BUFFER_KMH) {
        speedingSecsRef.current += 1;
      } else {
        speedingSecsRef.current = 0;
      }
      if (speedingSecsRef.current >= 60) {
        speedingSecsRef.current = 0;
        speedingMinutesRef.current += 1;
        setSpeedingMinutes(speedingMinutesRef.current);
        recompute();
      }

      // Smooth driving: count seconds since last harsh event
      smoothSecsRef.current += 1;
      if (smoothSecsRef.current >= 60) {
        smoothSecsRef.current = 0;
        // Only credit a smooth minute if no harsh event in the last 60 s
        if (Date.now() - lastHarshRef.current >= 60_000) {
          smoothMinutesRef.current += 1;
          setSmoothMinutes(smoothMinutesRef.current);
          recompute();
        }
      }
    }, 1_000);

    return () => clearInterval(id);
  }, [active, recompute]);

  // ── GPS distance accumulation ─────────────────────────────────────────────
  useEffect(() => {
    if (!active || currentLat == null || currentLng == null) return;

    const prevLat = lastLatRef.current;
    const prevLng = lastLngRef.current;

    if (prevLat != null && prevLng != null) {
      const d = haversineM(prevLat, prevLng, currentLat, currentLng);
      // Ignore GPS jumps > 500 m (signal-loss artefacts)
      if (d > 0 && d < 500) {
        distanceRef.current += d;
        setDistanceM(Math.round(distanceRef.current));
      }
    }

    lastLatRef.current = currentLat;
    lastLngRef.current = currentLng;
  }, [active, currentLat, currentLng]);

  // ── Snapshot (stable — reads refs, not state) ─────────────────────────────
  const getSnapshot = useCallback((): DriveScoreSnapshot => ({
    score:           computeLiveScore({
      harshBrakes:     harshBrakesRef.current,
      harshAccels:     harshAccelsRef.current,
      sharpTurns:      sharpTurnsRef.current,
      speedingMinutes: speedingMinutesRef.current,
      smoothMinutes:   smoothMinutesRef.current,
      maxSpeedKmh:     maxSpeedRef.current,
      distanceM:       Math.round(distanceRef.current),
    }),
    harshBrakes:     harshBrakesRef.current,
    harshAccels:     harshAccelsRef.current,
    sharpTurns:      sharpTurnsRef.current,
    speedingMinutes: speedingMinutesRef.current,
    smoothMinutes:   smoothMinutesRef.current,
    maxSpeedKmh:     maxSpeedRef.current,
    distanceM:       Math.round(distanceRef.current),
  }), []); // stable — all reads from refs

  return {
    score, harshBrakes, harshAccels, sharpTurns,
    speedingMinutes, smoothMinutes, maxSpeedKmh, distanceM,
    getSnapshot,
  };
}
