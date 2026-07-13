import { Router, type Request, type Response } from "express";
import { db, communityReportsTable, pushTokensTable } from "@workspace/db";
import { eq, and, or, lt, ne, gte, sql } from "drizzle-orm";
import { sendPushNotifications } from "../lib/expoPush.js";
import { logger } from "../lib/logger.js";

const router: Router = Router();

// Report types that must be reviewed by a moderator before they go live to
// drivers. Kept small and deliberate — these are the types most likely to
// cause real harm to drivers if a bad report goes live unreviewed.
const MODERATED_TYPES = new Set(["camera", "police"]);

// ── TTL per report type (seconds; null = never expires) ───────────────────────
export const TTL_SECONDS: Record<string, number | null> = {
  camera:    null,        // permanent until denied
  police:    4 * 3600,    // 4 h
  accident:  2 * 3600,    // 2 h
  traffic:   1 * 3600,    // 1 h
  roadblock: 12 * 3600,   // 12 h
  hazard:    12 * 3600,   // 12 h
  pothole:   7 * 86400,   // 7 days
  debris:    4 * 3600,    // 4 h
  breakdown: 2 * 3600,    // 2 h
  weather:   1 * 3600,    // 1 h
  closure:   8 * 3600,    // 8 h
  clear:     1 * 3600,    // 1 h
};

// Camera cluster radius in degrees (~50 m at equatorial latitudes)
const CLUSTER_LAT = 0.00045;
const CLUSTER_LNG = 0.00060;

// Haversine in metres (JS-side precise check after bounding-box query)
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180, f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180, dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Visible-to-drivers status filter — deliberately an allow-list (rather than
// excluding "expired"/"denied") so any future status, including
// "pending_review", is hidden from drivers by default until explicitly added here.
function isActive() {
  return or(eq(communityReportsTable.status, "active"), eq(communityReportsTable.status, "confirmed"));
}

// Lazily expire old reports before any read (no cron needed)
async function expireStale() {
  await db
    .update(communityReportsTable)
    .set({ status: "expired" })
    .where(
      and(
        lt(communityReportsTable.expiresAt, new Date()),
        ne(communityReportsTable.status, "expired"),
        ne(communityReportsTable.status, "denied"),
        // Never auto-expire a report still awaiting its first moderator
        // decision — it must stay in the moderation queue until acted on.
        ne(communityReportsTable.status, "pending_review")
      )
    );
}

// ── GET /reports?lat=&lng=&radius= ────────────────────────────────────────────
router.get("/reports", async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radius = parseFloat((req.query.radius as string) ?? "20000");

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: "lat and lng are required" });
    }

    await expireStale();

    // Bounding box (degrees) for the requested radius
    const latDelta = radius / 111320;
    const lngDelta = radius / (111320 * Math.cos((lat * Math.PI) / 180));

    const rows = await db
      .select()
      .from(communityReportsTable)
      .where(
        and(
          isActive(),
          gte(communityReportsTable.lat, lat - latDelta),
          sql`${communityReportsTable.lat} <= ${lat + latDelta}`,
          gte(communityReportsTable.lng, lng - lngDelta),
          sql`${communityReportsTable.lng} <= ${lng + lngDelta}`
        )
      );

    // Precise haversine distance filter
    const result = rows
      .filter((r) => haversine(lat, lng, r.lat, r.lng) <= radius)
      .map((r) => ({
        id: r.id,
        type: r.type,
        lat: r.lat,
        lng: r.lng,
        status: r.status,
        confirmCount: r.confirmCount,
        denyCount: r.denyCount,
        speedLimit: r.speedLimit,
        roadName: r.roadName,
        createdAt: r.createdAt.getTime(),
        expiresAt: r.expiresAt?.getTime() ?? null,
      }));

    return res.json({ reports: result });
  } catch (err) {
    console.error("GET /reports error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /reports — submit a new report ───────────────────────────────────────
router.post("/reports", async (req: Request, res: Response) => {
  try {
    const { type, lat, lng, deviceId, speedLimit, roadName } = req.body as {
      type: string; lat: number; lng: number;
      deviceId: string; speedLimit?: number; roadName?: string;
    };

    if (!type || lat == null || lng == null || !deviceId) {
      return res.status(400).json({ error: "type, lat, lng, deviceId required" });
    }

    const ttl = TTL_SECONDS[type] ?? null;
    const expiresAt = ttl ? new Date(Date.now() + ttl * 1000) : null;

    // ── Deduplication: find an existing active report of the same type within 50 m ──
    {
      const nearby = await db
        .select()
        .from(communityReportsTable)
        .where(
          and(
            eq(communityReportsTable.type, type),
            isActive(),
            gte(communityReportsTable.lat, lat - CLUSTER_LAT),
            sql`${communityReportsTable.lat} <= ${lat + CLUSTER_LAT}`,
            gte(communityReportsTable.lng, lng - CLUSTER_LNG),
            sql`${communityReportsTable.lng} <= ${lng + CLUSTER_LNG}`
          )
        );

      const cluster = nearby.find(
        (r) => haversine(lat, lng, r.lat, r.lng) < 50
      );

      if (cluster) {
        // Original creator OR device that already confirmed → no-op, return existing report
        const isCreator = cluster.deviceId === deviceId;
        const clusterConfirmedBy = (cluster.confirmedBy ?? []) as string[];
        const alreadyConfirmed = isCreator || clusterConfirmedBy.includes(deviceId);
        if (alreadyConfirmed) {
          return res.json({
            id: cluster.id,
            action: "clustered",
            confirmCount: cluster.confirmCount,
            status: cluster.status,
          });
        }
        const newCount = cluster.confirmCount + 1;
        const newStatus =
          newCount >= 2 && cluster.status === "active" ? "confirmed" : cluster.status;
        const newConfirmedBy = [...clusterConfirmedBy, deviceId];
        await db
          .update(communityReportsTable)
          .set({ confirmCount: newCount, status: newStatus, confirmedBy: newConfirmedBy, lastVotedAt: new Date() })
          .where(eq(communityReportsTable.id, cluster.id));
        return res.json({
          id: cluster.id,
          action: "clustered",
          confirmCount: newCount,
          status: newStatus,
        });
      }
    }

    // ── Insert new report ────────────────────────────────────────────────────
    // Camera/checkpoint reports hold for moderator review before they reach
    // drivers; every other type keeps going live immediately as before.
    const needsModeration = MODERATED_TYPES.has(type);
    const [inserted] = await db
      .insert(communityReportsTable)
      .values({
        type, lat, lng, deviceId, speedLimit, roadName, expiresAt,
        status: needsModeration ? "pending_review" : "active",
      })
      .returning();

    if (needsModeration) {
      notifyReporterUnderReview(deviceId, inserted.type).catch((err) =>
        logger.warn({ err, reportId: inserted.id }, "Failed to send moderation push notice")
      );
    }

    return res.status(201).json({
      id: inserted.id,
      action: "created",
      status: inserted.status,
      confirmCount: inserted.confirmCount,
    });
  } catch (err) {
    console.error("POST /reports error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Best-effort push notice to the reporting device that their submission is
// held for moderator review before it goes live to other drivers.
async function notifyReporterUnderReview(deviceId: string, type: string): Promise<void> {
  const [tokenRow] = await db
    .select({ token: pushTokensTable.token })
    .from(pushTokensTable)
    .where(eq(pushTokensTable.deviceId, deviceId));

  if (!tokenRow) return;

  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
  await sendPushNotifications([
    {
      to: tokenRow.token,
      title: "Report under review",
      body: `Your ${typeLabel} report is being reviewed by our team and will go live once approved.`,
      sound: "default",
      data: { type: "moderation_pending" },
    },
  ]);
}

// ── POST /reports/:id/confirm — "Still there" ─────────────────────────────────
router.post("/reports/:id/confirm", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const { deviceId } = req.body as { deviceId: string };
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    const [report] = await db
      .select()
      .from(communityReportsTable)
      .where(eq(communityReportsTable.id, id));

    if (!report) return res.status(404).json({ error: "Not found" });
    if (report.deviceId === deviceId)
      return res.status(403).json({ error: "Cannot confirm own report" });

    const confirmedBy = (report.confirmedBy ?? []) as string[];
    if (confirmedBy.includes(deviceId)) {
      return res.status(409).json({ error: "Already confirmed", confirmCount: report.confirmCount, status: report.status });
    }

    const newCount = report.confirmCount + 1;
    const newStatus =
      newCount >= 2 && report.status === "active" ? "confirmed" : report.status;
    const newConfirmedBy = [...confirmedBy, deviceId];

    await db
      .update(communityReportsTable)
      .set({ confirmCount: newCount, status: newStatus, confirmedBy: newConfirmedBy, lastVotedAt: new Date() })
      .where(eq(communityReportsTable.id, id));

    return res.json({ confirmCount: newCount, status: newStatus });
  } catch (err) {
    console.error("POST /reports/:id/confirm error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /reports/:id — remove own report ────────────────────────────────────
router.delete("/reports/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const { deviceId } = req.body as { deviceId: string };
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    const [report] = await db
      .select()
      .from(communityReportsTable)
      .where(eq(communityReportsTable.id, id));

    if (!report) return res.status(404).json({ error: "Not found" });
    if (report.deviceId !== deviceId) return res.status(403).json({ error: "Not your report" });
    if (report.confirmCount >= 3)
      return res.status(403).json({ error: "Report is protected — 3 or more users have confirmed this location" });

    await db
      .update(communityReportsTable)
      .set({ status: "expired" })
      .where(eq(communityReportsTable.id, id));

    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /reports/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /reports/:id — update own camera report ──────────────────────────────
router.patch("/reports/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const { deviceId, speedLimit, roadName } = req.body as {
      deviceId: string; speedLimit?: number; roadName?: string;
    };
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    const [report] = await db
      .select()
      .from(communityReportsTable)
      .where(eq(communityReportsTable.id, id));

    if (!report) return res.status(404).json({ error: "Not found" });
    if (report.deviceId !== deviceId) return res.status(403).json({ error: "Not your report" });
    if (report.type !== "camera") return res.status(400).json({ error: "Only camera reports can be updated" });

    const updates: Record<string, unknown> = {};
    if (speedLimit !== undefined) updates["speedLimit"] = speedLimit;
    if (roadName !== undefined) updates["roadName"] = roadName;

    const [updated] = await db
      .update(communityReportsTable)
      .set(updates as any)
      .where(eq(communityReportsTable.id, id))
      .returning();

    return res.json({ success: true, speedLimit: updated.speedLimit, roadName: updated.roadName });
  } catch (err) {
    console.error("PATCH /reports/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /reports/:id/deny — "Gone now" ───────────────────────────────────────
router.post("/reports/:id/deny", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const { deviceId } = req.body as { deviceId: string };
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    const [report] = await db
      .select()
      .from(communityReportsTable)
      .where(eq(communityReportsTable.id, id));

    if (!report) return res.status(404).json({ error: "Not found" });

    const newDenyCount = report.denyCount + 1;
    const newStatus = "denied";

    await db
      .update(communityReportsTable)
      .set({ denyCount: newDenyCount, status: newStatus, lastVotedAt: new Date() })
      .where(eq(communityReportsTable.id, id));

    return res.json({ denyCount: newDenyCount, status: newStatus });
  } catch (err) {
    console.error("POST /reports/:id/deny error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
