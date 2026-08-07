/**
 * useDriveScore — driving-behaviour sensor hook.
 *
 * Subscribes to the device accelerometer at 20 Hz when `active=true` and
 * classifies sustained G-force patterns into three event types:
 *   • harsh_brake  — sustained longitudinal deceleration > threshold,
 *                    confirmed by GPS speed drop within 5 s
 *   • harsh_accel  — sustained longitudinal acceleration > threshold,
 *                    confirmed by GPS speed rise within 5 s
 *   • sharp_turn   — sustained lateral acceleration > threshold,
 *                    confirmed by GPS heading change within 6 s
 *
 * Also tracks:
 *   • speedingMinutes  — minutes where GPS speed exceeded the posted limit
 *   • smoothMinutes    — minutes with no harsh events (for score bonus)
 *   • distanceM        — cumulative trip distance via haversine GPS diff
 *   • maxSpeedKmh      — peak GPS speed during the trip
 *
 * ── False-positive mitigations ────────────────────────────────────────────────
 *
 * Phone handling (picking up, putting down, throwing across the seat) is the
 * primary source of false positives. Four layered guards are applied:
 *
 *   1. Direction consistency: all samples in the detection window must point
 *      in the same horizontal half-space (dot product with the mean direction
 *      must be positive for every sample). Phone movement produces forces in
 *      several changing directions within 300–500 ms; a real driving event
 *      produces sustained force in one consistent direction.
 *
 *   2. GPS confirmation for turns: a sharp-turn candidate is only counted if
 *      the GPS heading (track bearing) changed ≥ GPS_BEARING_MIN_DELTA degrees
 *      in the surrounding GPS_BEARING_WINDOW_MS window. Phone movement does
 *      not change the vehicle's track.
 *
 *   3. GPS confirmation for brake/accel: candidates are placed in a pending
 *      queue and confirmed only if GPS speed changes by ≥ GPS_SPEED_DELTA_*
 *      within GPS_SPEED_CONFIRM_MS. Phone movement does not change GPS speed.
 *
 *   4. Turn-specific higher thresholds: sharp turns require a stricter net-G
 *      threshold, longer sustained window, and minimum vehicle speed. At low
 *      speed the lateral G of a real turn is small; high-G low-speed lateral
 *      forces almost always come from phone handling.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Platform } from "react-native";
import { Accelerometer } from "expo-sensors";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Gravity (m/s²). */
const G = 9.80665;

/**
 * Net-G threshold for brake / accel events.
 * net-G = |√(x²+y²+z²) − 9.8|
 *
 * Hard-brake at −5.5 m/s²: rawG ≈ 11.2 → netG ≈ 1.45
 * Normal braking −2.0 m/s²: rawG ≈ 10.0 → netG ≈ 0.20
 * Using 0.8 catches harsh events while ignoring normal driving.
 */
const HARSH_NET_G = 0.8;

/**
 * Stricter net-G threshold used exclusively for sharp-turn classification.
 * Raised vs. HARSH_NET_G to reject marginal lateral G events that are more
 * likely to be phone movement than a genuine tight corner.
 */
const HARSH_NET_G_TURN = 1.0;

/**
 * Lateral-to-longitudinal dominance ratio for turn classification.
 * absY must exceed absX by this factor before a reading is called a turn.
 * Raised from 1.2 → 1.5 so that slight lateral bias in brake/accel is not
 * mis-classified as a turn when the phone is tilted.
 */
const TURN_AXIS_RATIO = 1.5;

/** Minimum GPS speed (km/h) required to classify a sharp turn. Real sharp
 *  turns at <25 km/h produce low lateral G; high-G at low speed is almost
 *  always phone handling. */
const TURN_MIN_SPEED_KMH = 25;

/** Number of 50 ms samples that must ALL exceed HARSH_NET_G → 300 ms sustained.
 *  Used for brake and accel events. */
const WINDOW_SIZE = 6;

/** Longer window specifically for turn events → 500 ms sustained lateral G.
 *  A phone thrown across a seat typically resolves in < 300–400 ms; a real
 *  sharp corner holds high lateral G for the full duration of the corner. */
const TURN_WINDOW_SIZE = 10;

/** Minimum ms between events of the same type (debounce). */
const DEBOUNCE_MS = 5_000;

/** Speeding: km/h buffer above the posted limit before counting. */
const SPEEDING_BUFFER_KMH = 5;

// ── GPS confirmation parameters ────────────────────────────────────────────────

/** How many ms of GPS history to keep for confirmation checks. */
const GPS_HISTORY_WINDOW_MS = 12_000;

/** GPS bearing change (degrees) required within GPS_BEARING_WINDOW_MS to
 *  confirm a sharp-turn candidate. Phone movement does not alter track bearing. */
const GPS_BEARING_MIN_DELTA = 18;

/** Time window (ms) around a turn detection in which the GPS heading must
 *  show a real directional change. Uses past GPS data only (no delay). */
const GPS_BEARING_WINDOW_MS = 6_000;

/** ms after a brake/accel candidate before checking GPS speed confirmation. */
const GPS_SPEED_CONFIRM_MS = 5_000;

/** Minimum GPS speed drop (km/h) within GPS_SPEED_CONFIRM_MS to confirm a
 *  harsh-brake event. */
const GPS_SPEED_DELTA_BRAKE = 10;

/** Minimum GPS speed rise (km/h) within GPS_SPEED_CONFIRM_MS to confirm a
 *  harsh-accel event. */
const GPS_SPEED_DELTA_ACCEL = 8;

// ── Scoring weights ────────────────────────────────────────────────────────────

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

interface GpsPoint {
  t:       number;
  lat:     number;
  lng:     number;
  speed:   number;
}

interface PendingEvent {
  type:              "brake" | "accel";
  detectedAt:        number;
  speedAtDetection:  number;
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

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

/** Returns the bearing (0–360°) from point 1 to point 2. */
function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1   = (lat1 * Math.PI) / 180;
  const φ2   = (lat2 * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const y    = Math.sin(dLng) * Math.cos(φ2);
  const x    = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Smallest signed angular difference between two bearings (−180…+180). */
function bearingDelta(a: number, b: number): number {
  let d = ((b - a + 540) % 360) - 180;
  return d;
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

  // ── Mutable refs (safe inside event listeners / intervals) ──────────────
  const harshBrakesRef     = useRef(0);
  const harshAccelsRef     = useRef(0);
  const sharpTurnsRef      = useRef(0);
  const speedingMinutesRef = useRef(0);
  const smoothMinutesRef   = useRef(0);
  const maxSpeedRef        = useRef(0);
  const distanceRef        = useRef(0);

  const lastLatRef       = useRef<number | null>(null);
  const lastLngRef       = useRef<number | null>(null);
  const lastEventRef     = useRef<Record<string, number>>({});
  const lastHarshRef     = useRef(0); // timestamp of last confirmed harsh event

  // Rolling accelerometer window: last TURN_WINDOW_SIZE samples
  const windowRef = useRef<Array<{ netG: number; ax: number; ay: number }>>([]);

  // Speeding / smooth second counters
  const speedingSecsRef = useRef(0);
  const smoothSecsRef   = useRef(0);

  // Refs for speed / limit (so the 1 s interval never sees stale closures)
  const speedRef = useRef(0);
  const limitRef = useRef<number | null>(null);
  useEffect(() => { speedRef.current = currentSpeed; },      [currentSpeed]);
  useEffect(() => { limitRef.current = currentSpeedLimit; }, [currentSpeedLimit]);

  // ── GPS history (for event confirmation) ─────────────────────────────────
  const gpsHistoryRef    = useRef<GpsPoint[]>([]);
  const pendingEventsRef = useRef<PendingEvent[]>([]);

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
      gpsHistoryRef.current      = [];
      pendingEventsRef.current   = [];

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

  // ── GPS heading-change check (for turn confirmation) ─────────────────────
  const hasRealHeadingChange = useCallback((windowMs: number, minDeltaDeg: number): boolean => {
    const hist  = gpsHistoryRef.current;
    const since = Date.now() - windowMs;
    // Gather GPS track points in the confirmation window with enough displacement
    // between consecutive points to trust the computed bearing.
    const bearings: number[] = [];
    for (let i = 1; i < hist.length; i++) {
      if (hist[i].t < since) continue;
      const dist = haversineM(hist[i - 1].lat, hist[i - 1].lng, hist[i].lat, hist[i].lng);
      if (dist < 10) continue; // < 10 m between fixes → bearing unreliable
      bearings.push(bearingDeg(hist[i - 1].lat, hist[i - 1].lng, hist[i].lat, hist[i].lng));
    }
    if (bearings.length < 2) return false;

    // Sum absolute angular changes across consecutive bearings in the window.
    let totalDelta = 0;
    for (let i = 1; i < bearings.length; i++) {
      totalDelta += Math.abs(bearingDelta(bearings[i - 1], bearings[i]));
    }
    return totalDelta >= minDeltaDeg;
  }, []);

  // ── Accelerometer subscription ────────────────────────────────────────────
  useEffect(() => {
    if (!active || Platform.OS === "web") return;

    Accelerometer.setUpdateInterval(50); // 20 Hz

    const sub = Accelerometer.addListener(({ x, y, z }) => {
      // Only score while moving
      if (speedRef.current < 10) return;

      const rawMag = Math.sqrt(x * x + y * y + z * z);
      const netG   = Math.abs(rawMag - G);

      // Append to rolling window (keep TURN_WINDOW_SIZE samples so we can
      // evaluate both the shorter brake/accel window and the longer turn window)
      const win = windowRef.current;
      win.push({ netG, ax: x, ay: y });
      if (win.length > TURN_WINDOW_SIZE) win.shift();

      // ── Guard 1: enough samples for at least the shorter window ────────
      if (win.length < WINDOW_SIZE) return;

      // ── Guard 2: determine candidate event type using the most recent
      //    WINDOW_SIZE samples (always available once win.length ≥ WINDOW_SIZE)
      const shortWin = win.slice(-WINDOW_SIZE);
      const meanX    = shortWin.reduce((s, e) => s + e.ax, 0) / WINDOW_SIZE;
      const meanY    = shortWin.reduce((s, e) => s + e.ay, 0) / WINDOW_SIZE;
      const absX     = Math.abs(meanX);
      const absY     = Math.abs(meanY);

      const isTurnCandidate  = absY > absX * TURN_AXIS_RATIO;
      const isBrakeCandidate = !isTurnCandidate && meanX < -0.3 * G;
      const isAccelCandidate = !isTurnCandidate && !isBrakeCandidate;

      // ── Guard 3: pick the appropriate window size ───────────────────────
      // Turns require a longer sustained window (TURN_WINDOW_SIZE).
      // Brake/accel use the shorter WINDOW_SIZE.
      const evalWin = isTurnCandidate
        ? (win.length >= TURN_WINDOW_SIZE ? win : null)
        : shortWin;

      if (!evalWin) return; // turn candidate but not enough samples yet

      // ── Guard 4: all samples in the eval window must exceed threshold ──
      const threshold = isTurnCandidate ? HARSH_NET_G_TURN : HARSH_NET_G;
      if (!evalWin.every((s) => s.netG >= threshold)) return;

      // ── Guard 5: direction consistency ─────────────────────────────────
      // All samples must point in the same horizontal half-space as the
      // mean direction. Phone handling produces forces in multiple changing
      // directions (pick-up, mid-air, landing). Real driving events (brake,
      // accel, corner) maintain a consistent force direction throughout.
      const evalMeanX = evalWin.reduce((s, e) => s + e.ax, 0) / evalWin.length;
      const evalMeanY = evalWin.reduce((s, e) => s + e.ay, 0) / evalWin.length;
      const meanHorizMag = Math.sqrt(evalMeanX * evalMeanX + evalMeanY * evalMeanY);
      if (meanHorizMag < 0.15) return; // no clear horizontal direction → vertical or random
      const allConsistent = evalWin.every(({ ax, ay }) => {
        const dot = ax * evalMeanX + ay * evalMeanY;
        return dot > 0; // same half-space as mean direction
      });
      if (!allConsistent) return;

      // ── Guard 6: minimum speed for turns ───────────────────────────────
      if (isTurnCandidate && speedRef.current < TURN_MIN_SPEED_KMH) return;

      // ── Guard 7: debounce per event type ───────────────────────────────
      const type = isTurnCandidate ? "turn" : isBrakeCandidate ? "brake" : "accel";
      const now  = Date.now();
      const last = lastEventRef.current[type] ?? 0;
      if (now - last < DEBOUNCE_MS) return;
      lastEventRef.current[type] = now;

      // ── Classify: turns use GPS bearing confirmation (synchronous, past data)
      //    Brake/accel go into a pending queue for GPS speed confirmation ──────
      if (type === "turn") {
        // GPS heading must have changed within the surrounding window.
        // We use past GPS history only — no delay required.
        if (!hasRealHeadingChange(GPS_BEARING_WINDOW_MS, GPS_BEARING_MIN_DELTA)) {
          // No real heading change → phone movement, not a genuine corner.
          return;
        }
        sharpTurnsRef.current += 1;
        setSharpTurns(sharpTurnsRef.current);
        lastHarshRef.current = now;
        recompute();
      } else {
        // Queue brake/accel for GPS speed confirmation in the 1 s tick.
        pendingEventsRef.current.push({
          type:             type as "brake" | "accel",
          detectedAt:       now,
          speedAtDetection: speedRef.current,
        });
      }
    });

    return () => sub.remove();
  }, [active, hasRealHeadingChange, recompute]);

  // ── 1-second tick: speed tracking, speeding/smooth minutes, GPS confirm ──
  useEffect(() => {
    if (!active) return;

    const id = setInterval(() => {
      const spd   = speedRef.current;
      const limit = limitRef.current;
      const now   = Date.now();

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

      // Smooth driving: only count while moving (≥ 10 km/h)
      if (spd >= 10) smoothSecsRef.current += 1;
      if (smoothSecsRef.current >= 60) {
        smoothSecsRef.current = 0;
        if (now - lastHarshRef.current >= 60_000) {
          smoothMinutesRef.current += 1;
          setSmoothMinutes(smoothMinutesRef.current);
          recompute();
        }
      }

      // ── GPS speed confirmation for pending brake/accel events ───────────
      // Events older than GPS_SPEED_CONFIRM_MS are resolved here: if GPS speed
      // changed by the expected amount, the event is confirmed and counted;
      // otherwise it is silently discarded as a false positive (phone handling).
      const stillPending: PendingEvent[] = [];
      for (const ev of pendingEventsRef.current) {
        const age = now - ev.detectedAt;
        if (age < GPS_SPEED_CONFIRM_MS) {
          stillPending.push(ev); // not ready to evaluate yet
          continue;
        }
        // Evaluate: compare speed at detection to current GPS speed
        const speedDrop = ev.speedAtDetection - spd;
        const speedRise = spd - ev.speedAtDetection;

        if (ev.type === "brake" && speedDrop >= GPS_SPEED_DELTA_BRAKE) {
          harshBrakesRef.current += 1;
          setHarshBrakes(harshBrakesRef.current);
          lastHarshRef.current = ev.detectedAt; // use detection time for smooth-minute gating
          recompute();
        } else if (ev.type === "accel" && speedRise >= GPS_SPEED_DELTA_ACCEL) {
          harshAccelsRef.current += 1;
          setHarshAccels(harshAccelsRef.current);
          lastHarshRef.current = ev.detectedAt;
          recompute();
        }
        // Expired without confirmation → silently discarded (phone movement)
      }
      pendingEventsRef.current = stillPending;
    }, 1_000);

    return () => clearInterval(id);
  }, [active, recompute]);

  // ── GPS: distance accumulation + history for event confirmation ───────────
  useEffect(() => {
    if (!active || currentLat == null || currentLng == null) return;

    const prevLat = lastLatRef.current;
    const prevLng = lastLngRef.current;
    const now     = Date.now();

    // Append to GPS history (capped at GPS_HISTORY_WINDOW_MS)
    gpsHistoryRef.current.push({
      t: now, lat: currentLat, lng: currentLng, speed: currentSpeed,
    });
    const cutoff = now - GPS_HISTORY_WINDOW_MS;
    gpsHistoryRef.current = gpsHistoryRef.current.filter(p => p.t >= cutoff);

    if (prevLat != null && prevLng != null) {
      const d = haversineM(prevLat, prevLng, currentLat, currentLng);
      // Ignore GPS jumps > 500 m (signal-loss artefacts);
      // only accumulate when the vehicle is moving (≥ 10 km/h)
      if (d > 0 && d < 500 && currentSpeed >= 10) {
        distanceRef.current += d;
        setDistanceM(Math.round(distanceRef.current));
      }
    }

    lastLatRef.current = currentLat;
    lastLngRef.current = currentLng;
  }, [active, currentLat, currentLng, currentSpeed]);

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
