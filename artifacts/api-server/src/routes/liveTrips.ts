/**
 * liveTrips.ts — Drive Session (driving-score) endpoints.
 *
 * A "drive session" is created when the driver taps Start Drive, updated
 * every 30 s with live sensor stats, and finalised when they tap End Trip.
 * The server computes the driving score on finalisation so the algorithm
 * lives in one place and can be tuned without a mobile-app release.
 *
 * All endpoints are device-authenticated via `deviceId` (the same stable
 * anonymous identifier used by community reports / push tokens).
 */

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

// ── Scoring algorithm ─────────────────────────────────────────────────────────

function computeScore(stats: {
  harshBrakes: number;
  harshAccels: number;
  sharpTurns: number;
  speedingMinutes: number;
  smoothMinutes: number;
}): number {
  const penalty =
    stats.harshBrakes * 2 +
    stats.harshAccels * 1 +
    stats.sharpTurns * 1 +
    stats.speedingMinutes * 2;
  // +1 per every 15 smooth minutes, capped at +5
  const bonus = Math.min(Math.floor(stats.smoothMinutes / 15), 5);
  return Math.max(0, Math.min(100, 100 - penalty + bonus));
}

// ── POST /drive-sessions — start a session ────────────────────────────────────

router.post("/drive-sessions", async (req: Request, res: Response) => {
  try {
    const { deviceId, startLat, startLng } = req.body as {
      deviceId?: string;
      startLat?: number | null;
      startLng?: number | null;
    };

    if (!deviceId?.trim()) {
      return res.status(400).json({ error: "deviceId is required" });
    }

    const result = await db.execute<{ id: string; started_at: string }>(sql`
      INSERT INTO live_trips (device_id, start_lat, start_lng, started_at)
      VALUES (
        ${deviceId.trim()},
        ${typeof startLat === "number" ? startLat : null},
        ${typeof startLng === "number" ? startLng : null},
        NOW()
      )
      RETURNING id, started_at
    `);

    const row = result.rows[0];
    return res.status(201).json({ id: row.id, startedAt: row.started_at });
  } catch (err) {
    console.error("POST /drive-sessions error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /drive-sessions/:id — update in-progress stats ─────────────────────

router.patch("/drive-sessions/:id", async (req: Request, res: Response) => {
  try {
    const id = (req.params as { id: string }).id;
    const body = req.body as Record<string, unknown>;
    const { deviceId } = body;

    if (!deviceId || typeof deviceId !== "string") {
      return res.status(400).json({ error: "deviceId is required" });
    }

    const n = (v: unknown) => (v != null && !isNaN(Number(v)) ? Number(v) : null);

    await db.execute(sql`
      UPDATE live_trips SET
        distance_m          = COALESCE(${n(body.distanceM)},          distance_m),
        max_speed_kmh       = COALESCE(${n(body.maxSpeedKmh)},        max_speed_kmh),
        avg_speed_kmh       = COALESCE(${n(body.avgSpeedKmh)},        avg_speed_kmh),
        harsh_brakes        = COALESCE(${n(body.harshBrakes)},        harsh_brakes),
        harsh_accels        = COALESCE(${n(body.harshAccels)},        harsh_accels),
        sharp_turns         = COALESCE(${n(body.sharpTurns)},         sharp_turns),
        speeding_minutes    = COALESCE(${n(body.speedingMinutes)},    speeding_minutes),
        smooth_minutes      = COALESCE(${n(body.smoothMinutes)},      smooth_minutes),
        speed_camera_alerts = COALESCE(${n(body.speedCameraAlerts)},  speed_camera_alerts),
        police_alerts       = COALESCE(${n(body.policeAlerts)},       police_alerts),
        hazards_encountered = COALESCE(${n(body.hazardsEncountered)}, hazards_encountered)
      WHERE id = ${id}
        AND device_id = ${(deviceId as string).trim()}
        AND ended_at IS NULL
    `);

    return res.json({ ok: true });
  } catch (err) {
    console.error("PATCH /drive-sessions/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /drive-sessions/:id/end — finalise + score ──────────────────────────

router.post("/drive-sessions/:id/end", async (req: Request, res: Response) => {
  try {
    const id = (req.params as { id: string }).id;
    const body = req.body as Record<string, unknown>;
    const { deviceId } = body;

    if (!deviceId || typeof deviceId !== "string") {
      return res.status(400).json({ error: "deviceId is required" });
    }

    const n = (v: unknown, def = 0) =>
      v != null && !isNaN(Number(v)) ? Number(v) : def;

    const harshBrakes     = n(body.harshBrakes);
    const harshAccels     = n(body.harshAccels);
    const sharpTurns      = n(body.sharpTurns);
    const speedingMinutes = n(body.speedingMinutes);
    const smoothMinutes   = n(body.smoothMinutes);

    const score = computeScore({
      harshBrakes, harshAccels, sharpTurns, speedingMinutes, smoothMinutes,
    });

    const endLat = typeof body.endLat === "number" ? body.endLat : null;
    const endLng = typeof body.endLng === "number" ? body.endLng : null;

    await db.execute(sql`
      UPDATE live_trips SET
        ended_at            = NOW(),
        end_lat             = ${endLat},
        end_lng             = ${endLng},
        distance_m          = ${n(body.distanceM)},
        duration_s          = ${n(body.durationS)},
        avg_speed_kmh       = ${n(body.avgSpeedKmh)},
        max_speed_kmh       = ${n(body.maxSpeedKmh)},
        harsh_brakes        = ${harshBrakes},
        harsh_accels        = ${harshAccels},
        sharp_turns         = ${sharpTurns},
        speeding_minutes    = ${speedingMinutes},
        smooth_minutes      = ${smoothMinutes},
        speed_camera_alerts = ${n(body.speedCameraAlerts)},
        police_alerts       = ${n(body.policeAlerts)},
        hazards_encountered = ${n(body.hazardsEncountered)},
        score               = ${score}
      WHERE id = ${id}
        AND device_id = ${(deviceId as string).trim()}
        AND ended_at IS NULL
    `);

    return res.json({ id, score, endedAt: new Date().toISOString() });
  } catch (err) {
    console.error("POST /drive-sessions/:id/end error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /drive-sessions/:id — fetch a single session for a device ────────────

router.get("/drive-sessions/:id", async (req: Request, res: Response) => {
  try {
    const id = (req.params as { id: string }).id;
    const deviceId = (req.query as Record<string, string>).deviceId;

    if (!deviceId?.trim()) {
      return res.status(400).json({ error: "deviceId is required" });
    }

    // live_trips.id is a UUID — reject malformed ids up front so Postgres
    // doesn't raise a cast error (which would surface as a 500).
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(404).json({ error: "Session not found" });
    }

    const result = await db.execute<Record<string, unknown>>(sql`
      SELECT id, device_id, started_at, ended_at,
             start_lat, start_lng, end_lat, end_lng,
             distance_m, duration_s, avg_speed_kmh, max_speed_kmh,
             score, harsh_brakes, harsh_accels, sharp_turns,
             speeding_minutes, smooth_minutes,
             speed_camera_alerts, police_alerts, hazards_encountered,
             created_at
      FROM live_trips
      WHERE id = ${id}
        AND device_id = ${deviceId.trim()}
    `);

    const r = result.rows[0];
    if (!r) return res.status(404).json({ error: "Session not found" });

    return res.json({
      id:                 r.id,
      deviceId:           r.device_id,
      startedAt:          r.started_at,
      endedAt:            r.ended_at,
      startLat:           r.start_lat,
      startLng:           r.start_lng,
      endLat:             r.end_lat,
      endLng:             r.end_lng,
      distanceM:          r.distance_m          ?? 0,
      durationS:          r.duration_s,
      avgSpeedKmh:        r.avg_speed_kmh,
      maxSpeedKmh:        r.max_speed_kmh,
      score:              r.score,
      harshBrakes:        r.harsh_brakes        ?? 0,
      harshAccels:        r.harsh_accels        ?? 0,
      sharpTurns:         r.sharp_turns         ?? 0,
      speedingMinutes:    r.speeding_minutes     ?? 0,
      smoothMinutes:      r.smooth_minutes       ?? 0,
      speedCameraAlerts:  r.speed_camera_alerts  ?? 0,
      policeAlerts:       r.police_alerts        ?? 0,
      hazardsEncountered: r.hazards_encountered  ?? 0,
      createdAt:          r.created_at,
    });
  } catch (err) {
    console.error("GET /drive-sessions/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /drive-sessions — list completed sessions for a device ────────────────

router.get("/drive-sessions", async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const { deviceId } = q;

    if (!deviceId?.trim()) {
      return res.status(400).json({ error: "deviceId is required" });
    }

    const limit  = Math.min(50, Math.max(1, parseInt(q.limit  ?? "20") || 20));
    const offset = Math.max(0,              parseInt(q.offset ?? "0")  || 0);

    const [rows, countResult] = await Promise.all([
      db.execute<Record<string, unknown>>(sql`
        SELECT id, device_id, started_at, ended_at,
               start_lat, start_lng, end_lat, end_lng,
               distance_m, duration_s, avg_speed_kmh, max_speed_kmh,
               score, harsh_brakes, harsh_accels, sharp_turns,
               speeding_minutes, smooth_minutes,
               speed_camera_alerts, police_alerts, hazards_encountered,
               created_at
        FROM live_trips
        WHERE device_id = ${deviceId.trim()}
          AND ended_at IS NOT NULL
        ORDER BY started_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count
        FROM live_trips
        WHERE device_id = ${deviceId.trim()}
          AND ended_at IS NOT NULL
      `),
    ]);

    const sessions = rows.rows.map((r) => ({
      id:                 r.id,
      deviceId:           r.device_id,
      startedAt:          r.started_at,
      endedAt:            r.ended_at,
      startLat:           r.start_lat,
      startLng:           r.start_lng,
      endLat:             r.end_lat,
      endLng:             r.end_lng,
      distanceM:          r.distance_m          ?? 0,
      durationS:          r.duration_s,
      avgSpeedKmh:        r.avg_speed_kmh,
      maxSpeedKmh:        r.max_speed_kmh,
      score:              r.score,
      harshBrakes:        r.harsh_brakes        ?? 0,
      harshAccels:        r.harsh_accels        ?? 0,
      sharpTurns:         r.sharp_turns         ?? 0,
      speedingMinutes:    r.speeding_minutes     ?? 0,
      smoothMinutes:      r.smooth_minutes       ?? 0,
      speedCameraAlerts:  r.speed_camera_alerts  ?? 0,
      policeAlerts:       r.police_alerts        ?? 0,
      hazardsEncountered: r.hazards_encountered  ?? 0,
      createdAt:          r.created_at,
    }));

    const total = parseInt((countResult.rows[0]?.count as string) ?? "0", 10);

    return res.json({ sessions, total });
  } catch (err) {
    console.error("GET /drive-sessions error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
