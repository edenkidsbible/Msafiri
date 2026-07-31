import { Router, type Request, type Response } from "express";
import { getHereIncidents } from "../jobs/hereTraffic.js";

const router = Router();

// ── GET /api/traffic/incidents ─────────────────────────────────────────────────
// Returns the current in-memory HERE live-traffic incident list.
// The list is refreshed every 5 minutes by the background job.
// Returns an empty array while the first fetch is still in-flight.
router.get("/traffic/incidents", (_req: Request, res: Response) => {
  res.json({ incidents: getHereIncidents() });
});

export default router;
