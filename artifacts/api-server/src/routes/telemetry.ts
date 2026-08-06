import { Router, type Request, type Response } from "express";
import { db, brakingEventsTable, crashTriggerEventsTable } from "@workspace/db";

const router = Router();

// ── POST /telemetry/braking-events ────────────────────────────────────────────
// Accepts a batch of accelerometer-detected driving events from a mobile device.
// No auth required — device_id is the same stable anonymous identifier used by
// the community reports system. Bulk-inserts to keep data-usage low (one
// request per 60 s rather than one per event).
router.post("/telemetry/braking-events", async (req: Request, res: Response) => {
  try {
    const { events } = req.body as {
      events?: Array<{
        deviceId: string;
        eventType: string;
        lat: number;
        lng: number;
        speedKmh?: number;
        gForce: number;
        heading?: number;
      }>;
    };

    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: "events array is required and must not be empty" });
    }

    if (events.length > 200) {
      return res.status(400).json({ error: "events array must not exceed 200 items" });
    }

    const VALID_TYPES = new Set(["hard_braking", "pothole", "swerve"]);

    const rows = events
      .filter((e) =>
        e && typeof e.deviceId === "string" && e.deviceId.trim() &&
        typeof e.eventType === "string" && VALID_TYPES.has(e.eventType) &&
        typeof e.lat === "number" && typeof e.lng === "number" &&
        typeof e.gForce === "number"
      )
      .map((e) => ({
        deviceId:  e.deviceId.trim(),
        eventType: e.eventType,
        lat:       e.lat,
        lng:       e.lng,
        speedKmh:  e.speedKmh ?? 0,
        gForce:    e.gForce,
        heading:   e.heading ?? null,
      }));

    if (rows.length === 0) {
      return res.status(400).json({ error: "No valid events after validation" });
    }

    await db.insert(brakingEventsTable).values(rows);

    return res.status(201).json({ inserted: rows.length });
  } catch (err) {
    console.error("POST /telemetry/braking-events error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});


// ── POST /telemetry/crash-trigger ─────────────────────────────────────────────
// Logged the moment the crash modal fires on the device, before the driver
// responds. Paired against emergency_alerts_log to measure false-positive rate:
//   false-positive rate = (triggers − real alerts) / triggers
router.post("/telemetry/crash-trigger", async (req: Request, res: Response) => {
  try {
    const { deviceId, lat, lng, peakG, sensitivity } = req.body as {
      deviceId:    string;
      lat?:        number | null;
      lng?:        number | null;
      peakG:       number;
      sensitivity?: string;
    };

    if (!deviceId || typeof peakG !== "number") {
      return res.status(400).json({ error: "deviceId and peakG are required" });
    }

    const VALID_SENSITIVITIES = new Set(["low", "medium", "high"]);
    const sens = VALID_SENSITIVITIES.has(sensitivity ?? "") ? sensitivity! : "medium";

    await db.insert(crashTriggerEventsTable).values({
      deviceId:    deviceId.trim(),
      lat:         lat != null ? String(lat)   : null,
      lng:         lng != null ? String(lng)   : null,
      peakG:       String(peakG),
      sensitivity: sens,
    });

    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error("POST /telemetry/crash-trigger error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
