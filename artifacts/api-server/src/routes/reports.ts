import { Router, type Request, type Response } from "express";
import { db, communityReportsTable, pushTokensTable, blockedDevicesTable } from "@workspace/db";
import { eq, and, or, lt, ne, gte, sql, inArray, count } from "drizzle-orm";
import { sendPushNotifications } from "../lib/expoPush.js";
import { logger } from "../lib/logger.js";

const router: Router = Router();

// Report types that must be reviewed by a moderator before they go live to
// drivers. Kept small and deliberate — these are the types most likely to
// cause real harm to drivers if a bad report goes live unreviewed.
const MODERATED_TYPES = new Set(["camera", "police"]);

// ── TTL per report type (seconds; null = never expires) ───────────────────────
// Every non-camera incident expires after 12 hours unless a driver votes
// "Still here" (which extends the timer by another 12 h from the time of vote).
// Only admin can confirm a report as permanent or delete it outright.
// Speed cameras are physical infrastructure — they never auto-expire; only an
// admin can remove them from the map.
const INCIDENT_TTL = 12 * 3600; // 12 h
export const TTL_SECONDS: Record<string, number | null> = {
  camera:    null,             // permanent — admin managed only
  police:    INCIDENT_TTL,
  accident:  INCIDENT_TTL,
  traffic:   INCIDENT_TTL,
  roadblock: INCIDENT_TTL,
  hazard:    INCIDENT_TTL,
  pothole:   INCIDENT_TTL,
  debris:    INCIDENT_TTL,
  breakdown: INCIDENT_TTL,
  weather:   INCIDENT_TTL,
  closure:   INCIDENT_TTL,
  clear:     INCIDENT_TTL,
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

// A device blocked by an admin (report spamming/abuse) is rejected before
// any mutation runs — submitting, confirming, and denying reports are all
// gated on this so a blocked device can't affect other drivers' data.
async function isDeviceBlocked(deviceId: string): Promise<boolean> {
  const [row] = await db
    .select({ deviceId: blockedDevicesTable.deviceId })
    .from(blockedDevicesTable)
    .where(eq(blockedDevicesTable.deviceId, deviceId));
  return !!row;
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

// ── Report milestone gamification notifications ───────────────────────────────

const MILESTONE_MESSAGES: Record<number, { title: string; body: string }> = {
  10:  { title: "📍 10 reports filed!", body: "You're starting to make a real difference on Kenyan roads. Keep it up!" },
  50:  { title: "🏆 50 reports — impressive!", body: "You're a trusted road guardian. Drivers around you are safer because of you." },
  100: { title: "⭐ Road Hero! 100 reports", body: "You've reached 100 reports. You've earned the Road Hero badge — thank you!" },
  500: { title: "🎖️ 500 reports — legend.", body: "You're one of Msafiri Kenya's most valuable contributors. Incredible dedication!" },
};

async function checkReportMilestone(deviceId: string): Promise<void> {
  const [row] = await db
    .select({ total: count() })
    .from(communityReportsTable)
    .where(eq(communityReportsTable.deviceId, deviceId));

  const total = row?.total ?? 0;
  const milestone = MILESTONE_MESSAGES[total];
  if (!milestone) return;

  const [tokenRow] = await db
    .select({ token: pushTokensTable.token })
    .from(pushTokensTable)
    .where(eq(pushTokensTable.deviceId, deviceId));

  if (!tokenRow) return;

  await sendPushNotifications([{
    to: tokenRow.token,
    title: milestone.title,
    body: milestone.body,
    sound: "default",
    channelId: "msafiri_general",
    data: { type: "milestone", count: total },
  }]);

  logger.info({ deviceId, total }, "Report milestone notification sent");
}

// ── GET /reports — all active community reports ────────────────────────────────
// No lat/lng = return all active reports so the map always shows the full
// dataset. Optional lat/lng/radius params preserved for legacy callers.
router.get("/reports", async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radius = parseFloat((req.query.radius as string) ?? "20000");

    await expireStale();

    const toReport = (r: typeof communityReportsTable.$inferSelect) => ({
      id: r.id,
      type: r.type,
      lat: r.lat,
      lng: r.lng,
      status: r.status,
      confirmCount: r.confirmCount,
      denyCount: r.denyCount,
      speedLimit: r.speedLimit,
      roadName: r.roadName,
      adminVerified: r.adminVerified ?? false,
      createdAt: r.createdAt.getTime(),
      expiresAt: r.expiresAt?.getTime() ?? null,
    });

    // When no coordinates are supplied return all active reports so the
    // mobile app can show every incident on the map regardless of location.
    if (isNaN(lat) || isNaN(lng)) {
      const rows = await db
        .select()
        .from(communityReportsTable)
        .where(isActive());
      return res.json({ reports: rows.map(toReport) });
    }

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
      .map(toReport);

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

    if (await isDeviceBlocked(deviceId)) {
      return res.status(403).json({ error: "This device has been blocked from submitting reports." });
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
        const newConfirmedBy = [...clusterConfirmedBy, deviceId];
        // Extend the TTL by 12 h from now — a second driver reporting the same
        // thing is a strong signal it's still there, so we refresh the window.
        // Camera reports have null expiresAt and stay permanent regardless.
        const newExpiresAt =
          cluster.expiresAt != null
            ? new Date(Math.max(cluster.expiresAt.getTime(), Date.now()) + INCIDENT_TTL * 1000)
            : null;
        await db
          .update(communityReportsTable)
          .set({
            confirmCount: newCount,
            // Status never changes based on driver votes — only admin can confirm.
            confirmedBy: newConfirmedBy,
            lastVotedAt: new Date(),
            ...(newExpiresAt ? { expiresAt: newExpiresAt } : {}),
          })
          .where(eq(communityReportsTable.id, cluster.id));
        return res.json({
          id: cluster.id,
          action: "clustered",
          confirmCount: newCount,
          status: cluster.status,
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

    // ── Gamification milestone check ──────────────────────────────────────────
    void checkReportMilestone(deviceId).catch((err) =>
      logger.warn({ err, deviceId }, "Milestone push check failed")
    );

    // ── Auto-clear nearby incidents when a driver marks the road as clear ────
    // A "clear" report is a positive signal that whatever was blocking or
    // hazardous at this location is no longer present.  Expire every active /
    // confirmed non-camera report within 100 m so drivers immediately see a
    // clean map rather than stale warnings.  Cameras are permanent physical
    // infrastructure and are never touched by a clear report.
    let clearedCount = 0;
    if (type === "clear") {
      const CLEAR_RADIUS_M = 100;
      const latD = CLEAR_RADIUS_M / 111320;
      const lngD = CLEAR_RADIUS_M / (111320 * Math.cos((lat * Math.PI) / 180));

      const nearbyRows = await db
        .select({ id: communityReportsTable.id, lat: communityReportsTable.lat, lng: communityReportsTable.lng })
        .from(communityReportsTable)
        .where(
          and(
            isActive(),
            ne(communityReportsTable.type, "clear"),
            ne(communityReportsTable.type, "camera"),
            ne(communityReportsTable.id, inserted.id),
            gte(communityReportsTable.lat, lat - latD),
            sql`${communityReportsTable.lat} <= ${lat + latD}`,
            gte(communityReportsTable.lng, lng - lngD),
            sql`${communityReportsTable.lng} <= ${lng + lngD}`
          )
        );

      const toExpire = nearbyRows
        .filter((r) => haversine(lat, lng, r.lat, r.lng) <= CLEAR_RADIUS_M)
        .map((r) => r.id);

      if (toExpire.length > 0) {
        await db
          .update(communityReportsTable)
          .set({ status: "cleared" })
          .where(inArray(communityReportsTable.id, toExpire));
        clearedCount = toExpire.length;
      }
    }

    return res.status(201).json({
      id: inserted.id,
      action: "created",
      status: inserted.status,
      confirmCount: inserted.confirmCount,
      clearedCount,
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
      channelId: "msafiri_general",
      data: { type: "moderation_pending" },
    },
  ]);
}

// ── POST /reports/:id/confirm — "Still here" ──────────────────────────────────
// Driver-side vote: signals the incident is still present. This extends the
// report's TTL by 12 h so other drivers keep seeing it, and increments
// confirmCount for display ("X drivers say still here"). It does NOT promote
// the report to "confirmed" status — only an admin can do that. Cameras are
// permanent and never expire, so the TTL extension is a no-op for them.
router.post("/reports/:id/confirm", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const { deviceId } = req.body as { deviceId: string };
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    if (await isDeviceBlocked(deviceId)) {
      return res.status(403).json({ error: "This device has been blocked from voting on reports." });
    }

    const [report] = await db
      .select()
      .from(communityReportsTable)
      .where(eq(communityReportsTable.id, id));

    if (!report) return res.status(404).json({ error: "Not found" });
    if (report.deviceId === deviceId)
      return res.status(403).json({ error: "Cannot vote on own report" });

    const confirmedBy = (report.confirmedBy ?? []) as string[];
    if (confirmedBy.includes(deviceId)) {
      return res.status(409).json({ error: "Already voted", confirmCount: report.confirmCount, status: report.status });
    }

    const newCount = report.confirmCount + 1;
    const newConfirmedBy = [...confirmedBy, deviceId];
    // Extend the window: 12 h from now, or 12 h past the current expiry,
    // whichever is later. Camera reports (expiresAt = null) are unchanged.
    const newExpiresAt =
      report.expiresAt != null
        ? new Date(Math.max(report.expiresAt.getTime(), Date.now()) + INCIDENT_TTL * 1000)
        : null;

    await db
      .update(communityReportsTable)
      .set({
        confirmCount: newCount,
        confirmedBy: newConfirmedBy,
        lastVotedAt: new Date(),
        ...(newExpiresAt ? { expiresAt: newExpiresAt } : {}),
      })
      .where(eq(communityReportsTable.id, id));

    // Status never changes from a driver vote — only admin promotes to "confirmed".
    return res.json({ confirmCount: newCount, status: report.status });
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

// Reasons a driver can give when flagging a report to staff. Kept small and
// user-friendly — this maps 1:1 to the reason picker shown in the app.
export const FLAG_REASONS = new Set([
  "inaccurate_location", "already_gone", "duplicate", "spam", "inappropriate", "other",
]);

// Once this many *different* devices flag the same report, it's pulled off
// the map immediately (rather than waiting on a moderator to get to the
// queue) and handed to an admin to restore or delete. This is what lets
// drivers get a permanent report (e.g. a speed camera, which never expires
// on its own) removed without giving any single user the power to do so.
const FLAG_AUTO_HIDE_THRESHOLD = 2;

// ── POST /reports/:id/flag — "Report to moderators" ────────────────────────────
// Regular drivers cannot delete a report themselves (own or someone else's)
// once it has real weight behind it — this is the escalation path instead:
// flag it for a human moderator to review in the admin dashboard.
router.post("/reports/:id/flag", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const { deviceId, reason } = req.body as { deviceId: string; reason?: string };
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });
    if (reason && !FLAG_REASONS.has(reason)) {
      return res.status(400).json({ error: "Invalid reason" });
    }

    if (await isDeviceBlocked(deviceId)) {
      return res.status(403).json({ error: "This device has been blocked from flagging reports." });
    }

    const [report] = await db
      .select()
      .from(communityReportsTable)
      .where(eq(communityReportsTable.id, id));

    if (!report) return res.status(404).json({ error: "Not found" });

    // One flag per device — resubmitting the same flag is a no-op, but still
    // reports success so the app can show its usual confirmation.
    if (report.flaggedBy.includes(deviceId)) {
      return res.json({ flagCount: report.flagCount, alreadyFlagged: true });
    }

    const newFlagCount = report.flagCount + 1;
    const newFlaggedBy = [...report.flaggedBy, deviceId];
    const newFlagReasons = reason ? [...report.flagReasons, reason] : report.flagReasons;

    // Hide it from drivers the moment a second distinct device flags it —
    // don't wait for a moderator to notice. isActive() only shows
    // active/confirmed reports, so flipping to "flagged" is enough.
    const autoHide =
      newFlagCount >= FLAG_AUTO_HIDE_THRESHOLD &&
      (report.status === "active" || report.status === "confirmed");
    const newStatus = autoHide ? "flagged" : report.status;

    await db
      .update(communityReportsTable)
      .set({
        flagCount: newFlagCount,
        flaggedBy: newFlaggedBy,
        flagReasons: newFlagReasons,
        status: newStatus,
        // A fresh flag resurfaces the report for review even if a moderator
        // previously decided to keep it live.
        flagDismissed: false,
      })
      .where(eq(communityReportsTable.id, id));

    return res.json({ flagCount: newFlagCount, alreadyFlagged: false, status: newStatus, autoHidden: autoHide });
  } catch (err) {
    console.error("POST /reports/:id/flag error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /reports/:id/deny — "Gone now" ───────────────────────────────────────
// Driver-side vote: signals the incident may no longer be present. This records
// the vote (visible to admins in the dashboard) and increments denyCount for
// display to other drivers ("X drivers say it's gone"). The report is NOT
// removed from the map — only an admin can deny/remove a report. The natural
// 12 h TTL handles cleanup for incidents nobody refreshes with "Still here".
// Camera reports are permanent regardless of deny votes; admin removes them.
router.post("/reports/:id/deny", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const { deviceId } = req.body as { deviceId: string };
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    if (await isDeviceBlocked(deviceId)) {
      return res.status(403).json({ error: "This device has been blocked from voting on reports." });
    }

    const [report] = await db
      .select()
      .from(communityReportsTable)
      .where(eq(communityReportsTable.id, id));

    if (!report) return res.status(404).json({ error: "Not found" });

    const newDenyCount = report.denyCount + 1;
    // Status is intentionally NOT changed — only admin can remove a report.
    await db
      .update(communityReportsTable)
      .set({ denyCount: newDenyCount, lastVotedAt: new Date() })
      .where(eq(communityReportsTable.id, id));

    return res.json({ denyCount: newDenyCount, status: report.status });
  } catch (err) {
    console.error("POST /reports/:id/deny error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
