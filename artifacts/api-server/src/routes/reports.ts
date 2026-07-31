import { Router, type Request, type Response } from "express";
import { db, communityReportsTable, pushTokensTable, blockedDevicesTable } from "@workspace/db";
import { eq, and, or, lt, ne, gte, sql, inArray, count, isNotNull } from "drizzle-orm";
import { sendPushNotifications } from "../lib/expoPush.js";
import { logger } from "../lib/logger.js";

const router: Router = Router();

// Report types that must be reviewed by a moderator before they go live to
// drivers. Kept small and deliberate — these are the types most likely to
// cause real harm to drivers if a bad report goes live unreviewed.
const MODERATED_TYPES = new Set(["camera", "police"]);

// ── TTL per report type (seconds; null = never expires) ───────────────────────
// Per-type TTLs reflect how quickly each incident class realistically clears:
// high-churn types (police, alcoblow, traffic) expire in hours; physical
// hazards (pothole, debris) persist for a full day. Cameras are permanent
// physical infrastructure — only an admin can remove them from the map.
// INCIDENT_TTL is kept for the cluster-deduplication TTL extension path.
const INCIDENT_TTL = 12 * 3600; // used by cluster dedup extension only
export const TTL_SECONDS: Record<string, number | null> = {
  camera:    null,            // permanent — admin managed only
  police:    3  * 3600,      // 3 h  — checkpoints relocate frequently
  alcoblow:  3  * 3600,      // 3 h  — mobile checkpoints
  accident:  8  * 3600,      // 8 h
  traffic:   2  * 3600,      // 2 h  — congestion clears quickly
  roadblock: 12 * 3600,      // 12 h
  roadworks: 12 * 3600,      // 12 h
  closure:   12 * 3600,      // 12 h
  hazard:    24 * 3600,      // 24 h — physical hazards persist
  pothole:   24 * 3600,      // 24 h
  debris:    24 * 3600,      // 24 h
  breakdown: 24 * 3600,      // 24 h
  weather:   24 * 3600,      // 24 h
  clear:     INCIDENT_TTL,   // 12 h — ephemeral clearance signal
};

// Camera cluster radius in degrees (~50 m at equatorial latitudes)
const CLUSTER_LAT = 0.00045;
const CLUSTER_LNG = 0.00060;

// Shared TTL extension for driver confirm votes (explicit /confirm endpoint AND
// the cluster-dedup path in POST /reports). Both represent the same signal —
// another driver confirms this incident is still present — so they use identical
// math: +2 h from now, capped at a per-type ceiling from the report's original
// creation time. Camera reports (expiresAt = null) are permanent and always null.
const CONFIRM_EXTEND_MS = 2 * 3600 * 1000; // +2 h per confirm

// Per-type hard ceilings — short-lived event types (police, traffic) must not
// persist for days just because many drivers keep confirming them.
const CONFIRM_MAX_MS_BY_TYPE: Record<string, number> = {
  traffic:   4  * 3600 * 1000, //  4 h — congestion clears quickly
  police:    6  * 3600 * 1000, //  6 h — checkpoints relocate
  alcoblow:  6  * 3600 * 1000, //  6 h — mobile checkpoints
  accident:  12 * 3600 * 1000, // 12 h
  roadblock: 24 * 3600 * 1000, // 24 h
  roadworks: 24 * 3600 * 1000, // 24 h
  closure:   24 * 3600 * 1000, // 24 h
};
const CONFIRM_MAX_MS_DEFAULT = 36 * 3600 * 1000; // everything else

function calcExtendedExpiry(
  currentExpiresAt: Date | null,
  createdAt: Date,
  type: string
): Date | null {
  if (currentExpiresAt == null) return null; // permanent (camera)
  const maxMs = CONFIRM_MAX_MS_BY_TYPE[type] ?? CONFIRM_MAX_MS_DEFAULT;
  return new Date(
    Math.min(
      createdAt.getTime() + maxMs,
      Math.max(currentExpiresAt.getTime(), Date.now()) + CONFIRM_EXTEND_MS
    )
  );
}

// Haversine in metres (JS-side precise check after bounding-box query)
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180, f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180, dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Visible-to-drivers status filter — deliberately an allow-list (rather than
// excluding "expired"/"denied") so any future status is hidden from drivers
// by default until explicitly added here.
// "admin_review" is included so that cameras flagged for removal stay visible
// on the map while pending admin decision — they're real infrastructure until
// an admin confirms the removal.
function isActive() {
  return or(
    eq(communityReportsTable.status, "active"),
    eq(communityReportsTable.status, "confirmed"),
    eq(communityReportsTable.status, "admin_review")
  );
}

// Any report without valid coordinates must never reach the mobile app —
// a null coordinate passed through the RCT bridge crashes iOS immediately.
function hasCoordinates() {
  return and(isNotNull(communityReportsTable.lat), isNotNull(communityReportsTable.lng));
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
        ne(communityReportsTable.status, "pending_review"),
        // Never auto-expire a camera queued for admin removal review.
        ne(communityReportsTable.status, "admin_review")
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
      // Guard against a non-Date value arriving from the DB driver — e.g. a
      // string timestamp on a misconfigured connection — so serialisation never
      // throws an uncaught TypeError.
      createdAt: r.createdAt instanceof Date ? r.createdAt.getTime() : Date.now(),
      expiresAt: r.expiresAt instanceof Date ? r.expiresAt.getTime() : null,
    });

    // When no coordinates are supplied return all active reports so the
    // mobile app can show every incident on the map regardless of location.
    if (isNaN(lat) || isNaN(lng)) {
      const rows = await db
        .select()
        .from(communityReportsTable)
        .where(and(isActive(), hasCoordinates()));
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
          hasCoordinates(),
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
        // A second driver reporting the same incident is a confirm signal —
        // use the same capped extension as the explicit /confirm endpoint.
        const newExpiresAt = calcExtendedExpiry(cluster.expiresAt, cluster.createdAt, cluster.type);
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

    // ── Notify nearby drivers to refresh — only for reports that go live now ──
    // Moderated types (camera, police) stay in pending_review and aren't visible
    // to other drivers yet, so a refresh push would be a no-op for them.
    if (!needsModeration) {
      void notifyNearbyDevices(lat, lng, inserted.id, deviceId).catch((err) =>
        logger.warn({ err, reportId: inserted.id }, "Nearby-driver refresh push failed (non-critical)")
      );
    }

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

// ── Silent push to nearby drivers on new report creation ─────────────────────
// Called fire-and-forget immediately after a new active (non-moderated) report
// is inserted. Devices within ~8 km that have been seen in the last 4 hours
// receive a silent data-only push so they can poll for fresh reports right away,
// rather than waiting up to 60 s for the next scheduled poll cycle.
// The excluded deviceId is the report submitter — they already have the report.
async function notifyNearbyDevices(
  lat: number, lng: number, reportId: string, excludeDeviceId: string
): Promise<void> {
  const RADIUS_M = 8000;
  const latDelta = RADIUS_M / 111320;
  const lngDelta = RADIUS_M / (111320 * Math.cos((lat * Math.PI) / 180));
  const cutoff   = new Date(Date.now() - 4 * 60 * 60 * 1000); // 4 h ago

  const rows = await db
    .select({ token: pushTokensTable.token })
    .from(pushTokensTable)
    .where(
      and(
        isNotNull(pushTokensTable.lastLat),
        isNotNull(pushTokensTable.lastLng),
        gte(pushTokensTable.lastLat,    lat - latDelta),
        sql`${pushTokensTable.lastLat}  <= ${lat + latDelta}`,
        gte(pushTokensTable.lastLng,    lng - lngDelta),
        sql`${pushTokensTable.lastLng}  <= ${lng + lngDelta}`,
        gte(pushTokensTable.lastSeenAt, cutoff),
        ne(pushTokensTable.deviceId,    excludeDeviceId),
      )
    );

  if (rows.length === 0) return;

  // Silent push: empty title/body so no OS banner is shown; data payload
  // carries the refresh signal. priority "normal" avoids aggressive wakeup.
  await sendPushNotifications(rows.map((r) => ({
    to:       r.token,
    title:    "",
    body:     "",
    sound:    null,
    badge:    0,
    priority: "normal" as const,
    data:     { type: "reports_refresh", reportId },
  })));

  logger.info({ count: rows.length, reportId }, "Nearby-driver refresh push sent");
}

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

    // Reports in admin review are frozen — no driver votes until an admin acts.
    if (report.status === "admin_review") {
      return res.status(409).json({ error: "Report is under admin review", status: report.status });
    }

    const confirmedBy = (report.confirmedBy ?? []) as string[];
    if (confirmedBy.includes(deviceId)) {
      return res.status(409).json({ error: "Already voted", confirmCount: report.confirmCount, status: report.status });
    }

    const newCount = report.confirmCount + 1;
    const newConfirmedBy = [...confirmedBy, deviceId];
    // Extend the expiry via the shared helper: +2 h per confirm, capped at
    // 36 h from original creation. Camera reports (expiresAt = null) unchanged.
    const newExpiresAt = calcExtendedExpiry(report.expiresAt, report.createdAt, report.type);

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
    return res.json({ confirmCount: newCount, status: report.status, expiresAt: newExpiresAt?.getTime() ?? null });
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

// Number of distinct deny votes required to auto-remove a non-camera report.
// Set to 1 so the first driver who taps "Gone now" removes the report instantly.
const DENY_THRESHOLD = 1;

// ── POST /reports/:id/deny — "Gone now" ───────────────────────────────────────
// Driver-side vote: signals the incident may no longer be present.
//
// Non-camera reports: when the deny count reaches DENY_THRESHOLD the report is
// automatically removed from the map (status "denied") so stale incidents
// disappear without requiring admin action.
//
// Camera reports: cameras are fixed physical infrastructure that should not
// silently vanish because one or two confused drivers tapped "Gone now". Instead
// the report is moved to "admin_review" so a human can confirm or reject the
// removal. The camera stays visible on the map (isActive() includes admin_review)
// until an admin acts.
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

    // Owner tapping "Gone now" on their own report = owner-resolve, not a vote.
    // Non-camera reports resolve immediately (status "denied") unless the
    // community has confirmed it 3+ times — the same protection the self-delete
    // flow uses. Own camera reports fall through to the normal deny flow below,
    // which routes them to admin_review (cameras never silently vanish).
    if (report.deviceId === deviceId && report.type !== "camera") {
      if ((report.confirmCount ?? 1) >= 3) {
        return res.status(403).json({
          error: "Other drivers have confirmed this is still here, so it can't be removed. Use Flag to ask moderators to review it.",
        });
      }
      const [resolved] = await db
        .update(communityReportsTable)
        .set({ status: "denied", lastVotedAt: new Date() })
        .where(eq(communityReportsTable.id, id))
        .returning({ denyCount: communityReportsTable.denyCount, status: communityReportsTable.status });
      return res.json({ denyCount: resolved?.denyCount ?? report.denyCount, status: resolved?.status ?? "denied" });
    }

    // Atomically append deviceId to denied_by only when it is not already
    // present, and compute the new deny_count + status in the same statement.
    // Using a conditional UPDATE (WHERE NOT denied_by @> ...) means concurrent
    // requests from the same device can never both succeed — PostgreSQL's row
    // lock serialises them and the second finds the WHERE false, returning 0 rows.
    //
    // In the SET clause, column references resolve to the *pre-update* values, so
    //   jsonb_array_length(denied_by) + 1   == new distinct-voter count
    //
    // Status transition rules (mirrors the original logic):
    //   camera active/confirmed  → admin_review
    //   non-camera, new count >= DENY_THRESHOLD, not already denied → denied
    //   everything else          → unchanged
    // COALESCE(denied_by, '[]'::jsonb) guards against any pre-migration rows
    // that still carry a NULL in the column — without it the @> containment
    // check returns NULL (not FALSE) and the WHERE clause silently drops the
    // row, making the duplicate-vote guard a no-op on old data.
    const updated = await db.execute(sql`
      UPDATE community_reports
      SET
        denied_by     = COALESCE(denied_by, '[]'::jsonb) || jsonb_build_array(${deviceId}::text)::jsonb,
        deny_count    = jsonb_array_length(COALESCE(denied_by, '[]'::jsonb)) + 1,
        last_voted_at = now(),
        status        = CASE
          WHEN type = 'camera' AND status IN ('active', 'confirmed')
            THEN 'admin_review'
          WHEN type != 'camera'
            AND jsonb_array_length(COALESCE(denied_by, '[]'::jsonb)) + 1 >= ${DENY_THRESHOLD}
            AND status != 'denied'
            THEN 'denied'
          ELSE status
        END
      WHERE id        = ${id}
        AND NOT (COALESCE(denied_by, '[]'::jsonb) @> jsonb_build_array(${deviceId}::text)::jsonb)
      RETURNING deny_count, status
    `);

    if (updated.rows.length === 0) {
      // Either already voted (no-op) or the report doesn't exist.
      // Re-fetch to distinguish the two cases and return the correct payload.
      const [existing] = await db
        .select({ denyCount: communityReportsTable.denyCount, status: communityReportsTable.status })
        .from(communityReportsTable)
        .where(eq(communityReportsTable.id, id));
      if (!existing) return res.status(404).json({ error: "Not found" });
      return res.json({ denyCount: existing.denyCount, status: existing.status });
    }

    const row = updated.rows[0] as { deny_count: number; status: string };
    return res.json({ denyCount: row.deny_count, status: row.status });
  } catch (err) {
    console.error("POST /reports/:id/deny error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
