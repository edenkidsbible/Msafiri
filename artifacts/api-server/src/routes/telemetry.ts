import { Router, type Request, type Response } from "express";
import { db, crashTriggerEventsTable } from "@workspace/db";

const router = Router();

// Auto hazard detection is disabled. Keep this route as an explicit no-op for
// older app versions so they stop sending sensor batches without retrying or
// storing any new location telemetry.
router.post("/telemetry/braking-events", (_req: Request, res: Response) => {
  return res.status(200).json({ inserted: 0, disabled: true });
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
