import { Router, type Request, type Response } from "express";
import { db, communityReportsTable, blockedDevicesTable } from "@workspace/db";
import { eq, sql, ilike, or, and, desc, inArray } from "drizzle-orm";
import { logAudit, createNotification } from "../../lib/audit.js";
import type { AdminJwtPayload } from "../../middleware/adminAuth.js";
import { requireFeature } from "../../middleware/adminAuth.js";
import { TTL_SECONDS } from "../reports.js";

const router = Router();

// Fetch the current blocklist as a Set for O(1) lookups when annotating a
// page of reports with a "deviceBlocked" flag.
async function getBlockedDeviceIds(): Promise<Set<string>> {
  const rows = await db.select({ deviceId: blockedDevicesTable.deviceId }).from(blockedDevicesTable);
  return new Set(rows.map((r) => r.deviceId));
}

// ── GET /admin/reports/blocked-devices — list currently blocked devices ────────
router.get("/reports/blocked-devices", requireFeature("reports"), async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(blockedDevicesTable)
      .orderBy(desc(blockedDevicesTable.createdAt));

    return res.json({
      devices: rows.map((r) => ({
        deviceId:  r.deviceId,
        reason:    r.reason,
        blockedBy: r.blockedBy,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("GET /admin/reports/blocked-devices error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /admin/reports/blocked-devices — block a device (upsert) ──────────────
router.post("/reports/blocked-devices", requireFeature("reports"), async (req: Request, res: Response) => {
  try {
    const { deviceId, reason } = req.body as { deviceId?: string; reason?: string };
    if (!deviceId || typeof deviceId !== "string" || !deviceId.trim()) {
      return res.status(400).json({ error: "deviceId is required" });
    }

    const actor = (req as any).adminUser as AdminJwtPayload;

    const [blocked] = await db
      .insert(blockedDevicesTable)
      .values({ deviceId: deviceId.trim(), reason: reason?.trim() || null, blockedBy: actor.name })
      .onConflictDoUpdate({
        target: blockedDevicesTable.deviceId,
        set: { reason: reason?.trim() || null, blockedBy: actor.name },
      })
      .returning();

    await logAudit({
      actor,
      action: "device.block",
      targetType: "device",
      targetId: blocked.deviceId,
      details: { reason: blocked.reason },
    });

    return res.status(201).json({
      deviceId:  blocked.deviceId,
      reason:    blocked.reason,
      blockedBy: blocked.blockedBy,
      createdAt: blocked.createdAt.toISOString(),
    });
  } catch (err) {
    console.error("POST /admin/reports/blocked-devices error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /admin/reports/blocked-devices/:deviceId — unblock a device ─────────
router.delete("/reports/blocked-devices/:deviceId", requireFeature("reports"), async (req: Request, res: Response) => {
  try {
    const deviceId = req.params["deviceId"] as string;

    const [existing] = await db
      .select()
      .from(blockedDevicesTable)
      .where(eq(blockedDevicesTable.deviceId, deviceId));

    if (!existing) return res.status(404).json({ error: "Not found" });

    await db.delete(blockedDevicesTable).where(eq(blockedDevicesTable.deviceId, deviceId));

    const actor = (req as any).adminUser as AdminJwtPayload;
    await logAudit({ actor, action: "device.unblock", targetType: "device", targetId: deviceId });

    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /admin/reports/blocked-devices/:deviceId error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /admin/reports/moderation-queue ────────────────────────────────────────
// Two groups an operator needs to act on: reports that just expired (may be
// worth restoring with one tap) and new camera/checkpoint reports still
// awaiting first review before they reach drivers.
router.get("/reports/moderation-queue", requireFeature("reports"), async (_req: Request, res: Response) => {
  try {
    const [expired, pendingReview, flagged, blockedIds] = await Promise.all([
      db
        .select()
        .from(communityReportsTable)
        .where(and(eq(communityReportsTable.status, "expired"), eq(communityReportsTable.moderationDismissed, false)))
        .orderBy(desc(communityReportsTable.expiresAt))
        .limit(200),
      db
        .select()
        .from(communityReportsTable)
        .where(eq(communityReportsTable.status, "pending_review"))
        .orderBy(communityReportsTable.createdAt)
        .limit(200),
      // Reports drivers have flagged as inaccurate/inappropriate — regular
      // users cannot remove reports themselves, so this is the queue that
      // routes their concern to a human moderator.
      db
        .select()
        .from(communityReportsTable)
        .where(and(sql`${communityReportsTable.flagCount} > 0`, eq(communityReportsTable.flagDismissed, false)))
        .orderBy(desc(communityReportsTable.flagCount))
        .limit(200),
      getBlockedDeviceIds(),
    ]);

    const serialize = (r: typeof expired[number]) => ({
      id:           r.id,
      type:         r.type,
      lat:          r.lat,
      lng:          r.lng,
      deviceId:     r.deviceId,
      deviceBlocked: blockedIds.has(r.deviceId),
      status:       r.status,
      confirmCount: r.confirmCount,
      denyCount:    r.denyCount,
      speedLimit:   r.speedLimit,
      roadName:     r.roadName,
      createdAt:    r.createdAt.toISOString(),
      expiresAt:    r.expiresAt?.toISOString() ?? null,
      flagCount:    r.flagCount,
      flagReasons:  r.flagReasons,
    });

    return res.json({
      expired: expired.map(serialize),
      pendingReview: pendingReview.map(serialize),
      flagged: flagged.map(serialize),
    });
  } catch (err) {
    console.error("GET /admin/reports/moderation-queue error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /admin/reports/:id/flags/keep — moderator reviewed a flagged report
// and decided to keep it live; clears it from the flagged queue until a new
// flag arrives. ──────────────────────────────────────────────────────────────
router.post("/reports/:id/flags/keep", requireFeature("reports"), async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;

    const [existing] = await db
      .select()
      .from(communityReportsTable)
      .where(eq(communityReportsTable.id, id));

    if (!existing) return res.status(404).json({ error: "Not found" });

    // If flags auto-hid the report (status "flagged"), restore it to
    // "active" so it reappears for drivers; a report that only picked up a
    // single flag and never left "active"/"confirmed" is left as-is.
    const restoredStatus = existing.status === "flagged" ? "active" : existing.status;

    const [updated] = await db
      .update(communityReportsTable)
      .set({ flagDismissed: true, status: restoredStatus })
      .where(eq(communityReportsTable.id, id))
      .returning();

    const actor = (req as any).adminUser as AdminJwtPayload;
    await logAudit({
      actor,
      action: "report.moderation_keep_flagged",
      targetType: "report",
      targetId: id,
      details: { type: existing.type, roadName: existing.roadName, flagCount: existing.flagCount, restoredStatus },
    });

    return res.json({ id: updated.id, flagDismissed: updated.flagDismissed, status: updated.status });
  } catch (err) {
    console.error("POST /admin/reports/:id/flags/keep error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /admin/reports/:id/flags/remove — moderator agrees with the flag(s)
// and removes the report from drivers' view. ────────────────────────────────
router.post("/reports/:id/flags/remove", requireFeature("reports"), async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;

    const [existing] = await db
      .select()
      .from(communityReportsTable)
      .where(eq(communityReportsTable.id, id));

    if (!existing) return res.status(404).json({ error: "Not found" });

    const [updated] = await db
      .update(communityReportsTable)
      .set({ status: "denied", flagDismissed: true })
      .where(eq(communityReportsTable.id, id))
      .returning();

    const actor = (req as any).adminUser as AdminJwtPayload;
    await logAudit({
      actor,
      action: "report.moderation_remove_flagged",
      targetType: "report",
      targetId: id,
      details: { type: existing.type, roadName: existing.roadName, flagCount: existing.flagCount },
    });

    return res.json({ id: updated.id, status: updated.status });
  } catch (err) {
    console.error("POST /admin/reports/:id/flags/remove error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /admin/reports/:id/approve — restore an expired report or publish a
// pending-review submission; both cases bring the report back to "active"
// with a freshly computed expiry. ───────────────────────────────────────────
router.post("/reports/:id/approve", requireFeature("reports"), async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;

    const [existing] = await db
      .select()
      .from(communityReportsTable)
      .where(eq(communityReportsTable.id, id));

    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.status !== "expired" && existing.status !== "pending_review") {
      return res.status(400).json({ error: "Only expired or pending-review reports can be approved" });
    }

    const ttl = TTL_SECONDS[existing.type] ?? null;
    const expiresAt = ttl ? new Date(Date.now() + ttl * 1000) : null;
    const wasNew = existing.status === "pending_review";

    const [updated] = await db
      .update(communityReportsTable)
      .set({ status: "active", expiresAt, moderationDismissed: false })
      .where(eq(communityReportsTable.id, id))
      .returning();

    const actor = (req as any).adminUser as AdminJwtPayload;
    await logAudit({
      actor,
      action: wasNew ? "report.moderation_approve_new" : "report.moderation_restore_expired",
      targetType: "report",
      targetId: id,
      details: { type: existing.type, roadName: existing.roadName },
    });

    return res.json({
      id:           updated.id,
      type:         updated.type,
      status:       updated.status,
      expiresAt:    updated.expiresAt?.toISOString() ?? null,
    });
  } catch (err) {
    console.error("POST /admin/reports/:id/approve error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /admin/reports/:id/reject — dismiss a queued report. A pending-review
// submission is denied outright (never goes live); an expired report is just
// dismissed from the queue (stays "expired"). ──────────────────────────────
router.post("/reports/:id/reject", requireFeature("reports"), async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;

    const [existing] = await db
      .select()
      .from(communityReportsTable)
      .where(eq(communityReportsTable.id, id));

    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.status !== "expired" && existing.status !== "pending_review") {
      return res.status(400).json({ error: "Only expired or pending-review reports can be rejected" });
    }

    const wasNew = existing.status === "pending_review";
    const [updated] = await db
      .update(communityReportsTable)
      .set(wasNew ? { status: "denied" } : { moderationDismissed: true })
      .where(eq(communityReportsTable.id, id))
      .returning();

    const actor = (req as any).adminUser as AdminJwtPayload;
    await logAudit({
      actor,
      action: wasNew ? "report.moderation_reject_new" : "report.moderation_dismiss_expired",
      targetType: "report",
      targetId: id,
      details: { type: existing.type, roadName: existing.roadName },
    });

    return res.json({ id: updated.id, status: updated.status });
  } catch (err) {
    console.error("POST /admin/reports/:id/reject error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/reports?page=&limit=&type=&status=&search=
router.get("/reports", requireFeature("reports"), async (req: Request, res: Response) => {
  try {
    const page  = Math.max(1, parseInt((req.query.page  as string) ?? "1"));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? "50")));
    const offset = (page - 1) * limit;
    const type   = req.query.type   as string | undefined;
    const status = req.query.status as string | undefined;
    const search = req.query.search as string | undefined;

    const conditions: any[] = [];
    if (type)   conditions.push(eq(communityReportsTable.type, type));
    if (status) conditions.push(eq(communityReportsTable.status, status));
    if (search) {
      conditions.push(
        or(
          ilike(communityReportsTable.roadName, `%${search}%`),
          ilike(communityReportsTable.type, `%${search}%`),
          sql`${communityReportsTable.id}::text ILIKE ${`%${search}%`}`
        )
      );
    }

    const where = conditions.length > 0
      ? sql`${conditions.reduce((a, b) => sql`${a} AND ${b}`)}`
      : undefined;

    const [countResult, rows, blockedIds] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` })
        .from(communityReportsTable)
        .where(where),
      db.select()
        .from(communityReportsTable)
        .where(where)
        .orderBy(desc(communityReportsTable.createdAt))
        .limit(limit)
        .offset(offset),
      getBlockedDeviceIds(),
    ]);

    const total = countResult[0]?.count ?? 0;

    return res.json({
      reports: rows.map((r) => ({
        id:           r.id,
        type:         r.type,
        lat:          r.lat,
        lng:          r.lng,
        deviceId:     r.deviceId,
        deviceBlocked: blockedIds.has(r.deviceId),
        status:       r.status,
        confirmCount: r.confirmCount,
        denyCount:    r.denyCount,
        speedLimit:   r.speedLimit,
        roadName:     r.roadName,
        createdAt:    r.createdAt.toISOString(),
        expiresAt:    r.expiresAt?.toISOString() ?? null,
      })),
      total,
      page,
      limit,
    });
  } catch (err) {
    console.error("GET /admin/reports error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/reports/export — CSV download
router.get("/reports/export", requireFeature("reports_export"), async (req: Request, res: Response) => {
  try {
    const type   = req.query.type   as string | undefined;
    const status = req.query.status as string | undefined;

    const conditions: any[] = [];
    if (type)   conditions.push(eq(communityReportsTable.type, type));
    if (status) conditions.push(eq(communityReportsTable.status, status));

    const where = conditions.length > 0
      ? sql`${conditions.reduce((a, b) => sql`${a} AND ${b}`)}`
      : undefined;

    const rows = await db
      .select()
      .from(communityReportsTable)
      .where(where)
      .orderBy(desc(communityReportsTable.createdAt))
      .limit(10000);

    const headers = ["id", "type", "status", "roadName", "lat", "lng", "speedLimit", "confirmCount", "denyCount", "createdAt", "expiresAt"];
    const csvLines = [
      headers.join(","),
      ...rows.map((r) =>
        [
          r.id,
          r.type,
          r.status,
          `"${(r.roadName ?? "").replace(/"/g, '""')}"`,
          r.lat,
          r.lng,
          r.speedLimit ?? "",
          r.confirmCount,
          r.denyCount,
          r.createdAt.toISOString(),
          r.expiresAt?.toISOString() ?? "",
        ].join(",")
      ),
    ];

    const actor = (req as any).adminUser as AdminJwtPayload;
    await logAudit({ actor, action: "report.export", details: { count: rows.length, type, status } });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="reports-${Date.now()}.csv"`);
    return res.send(csvLines.join("\n"));
  } catch (err) {
    console.error("GET /admin/reports/export error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /admin/reports
router.post("/reports", requireFeature("reports"), async (req: Request, res: Response) => {
  try {
    const { type, lat, lng, deviceId, status, speedLimit, roadName } = req.body as {
      type: string; lat: number; lng: number;
      deviceId?: string; status?: string;
      speedLimit?: number; roadName?: string;
    };

    if (!type || lat == null || lng == null) {
      return res.status(400).json({ error: "type, lat, lng required" });
    }

    const [inserted] = await db
      .insert(communityReportsTable)
      .values({
        type,
        lat,
        lng,
        deviceId: deviceId ?? "admin",
        status: status ?? "active",
        speedLimit: speedLimit ?? null,
        roadName: roadName ?? null,
      })
      .returning();

    const actor = (req as any).adminUser as AdminJwtPayload;
    await logAudit({ actor, action: "report.create", targetType: "report", targetId: inserted.id, details: { type, roadName } });

    return res.status(201).json({
      id:           inserted.id,
      type:         inserted.type,
      lat:          inserted.lat,
      lng:          inserted.lng,
      deviceId:     inserted.deviceId,
      status:       inserted.status,
      confirmCount: inserted.confirmCount,
      denyCount:    inserted.denyCount,
      speedLimit:   inserted.speedLimit,
      roadName:     inserted.roadName,
      createdAt:    inserted.createdAt.toISOString(),
      expiresAt:    inserted.expiresAt?.toISOString() ?? null,
    });
  } catch (err) {
    console.error("POST /admin/reports error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

const VALID_TYPES = new Set([
  "camera", "police", "alcoblow", "accident", "traffic", "roadblock",
  "roadworks", "hazard", "pothole", "debris", "breakdown", "weather",
  "closure", "clear",
]);
const VALID_STATUSES = new Set(["active", "confirmed", "expired", "denied", "pending_review"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Minimal RFC-4180 CSV parser: handles quoted fields, embedded commas/newlines, and "" escaping.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (char === "\r") {
      i++;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += char;
    i++;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

// POST /admin/reports/import — CSV upload (creates new rows, restores/updates existing rows by id)
router.post("/reports/import", requireFeature("reports_bulk"), async (req: Request, res: Response) => {
  try {
    const { csv } = req.body as { csv?: string };
    if (!csv || typeof csv !== "string" || !csv.trim()) {
      return res.status(400).json({ error: "csv (string) is required" });
    }

    const rows = parseCsv(csv.trim());
    if (rows.length === 0) {
      return res.status(400).json({ error: "CSV is empty" });
    }

    const header = rows[0]!.map((h) => h.trim());
    const dataRows = rows.slice(1);
    if (dataRows.length === 0) {
      return res.status(400).json({ error: "CSV has no data rows" });
    }

    const colIndex = (name: string) => header.indexOf(name);
    const idx = {
      id:           colIndex("id"),
      type:         colIndex("type"),
      status:       colIndex("status"),
      roadName:     colIndex("roadName"),
      lat:          colIndex("lat"),
      lng:          colIndex("lng"),
      speedLimit:   colIndex("speedLimit"),
      confirmCount: colIndex("confirmCount"),
      denyCount:    colIndex("denyCount"),
      createdAt:    colIndex("createdAt"),
      expiresAt:    colIndex("expiresAt"),
    };

    if (idx.type === -1 || idx.lat === -1 || idx.lng === -1) {
      return res.status(400).json({ error: "CSV must include at least type, lat, lng columns" });
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: Array<{ row: number; message: string }> = [];

    const existingIds = new Set(
      (await db.select({ id: communityReportsTable.id }).from(communityReportsTable)).map((r) => r.id)
    );

    for (let i = 0; i < dataRows.length; i++) {
      const cols = dataRows[i]!;
      const rowNum = i + 2; // account for header + 1-indexing

      try {
        const type = cols[idx.type]?.trim();
        const lat = idx.lat >= 0 ? Number(cols[idx.lat]) : NaN;
        const lng = idx.lng >= 0 ? Number(cols[idx.lng]) : NaN;

        if (!type || !VALID_TYPES.has(type)) {
          errors.push({ row: rowNum, message: `Invalid or missing type "${type ?? ""}"` });
          skipped++;
          continue;
        }
        if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
          errors.push({ row: rowNum, message: "Invalid or missing lat/lng" });
          skipped++;
          continue;
        }

        const rawStatus = idx.status >= 0 ? cols[idx.status]?.trim() : undefined;
        const status = rawStatus && VALID_STATUSES.has(rawStatus) ? rawStatus : "active";

        const rawId = idx.id >= 0 ? cols[idx.id]?.trim() : undefined;
        const validId = rawId && UUID_RE.test(rawId) ? rawId : undefined;

        const roadName = idx.roadName >= 0 ? (cols[idx.roadName]?.trim() || null) : null;
        const speedLimitRaw = idx.speedLimit >= 0 ? cols[idx.speedLimit]?.trim() : "";
        const speedLimit = speedLimitRaw ? Number(speedLimitRaw) : null;
        const confirmCountRaw = idx.confirmCount >= 0 ? cols[idx.confirmCount]?.trim() : "";
        const confirmCount = confirmCountRaw && Number.isFinite(Number(confirmCountRaw)) ? Number(confirmCountRaw) : 1;
        const denyCountRaw = idx.denyCount >= 0 ? cols[idx.denyCount]?.trim() : "";
        const denyCount = denyCountRaw && Number.isFinite(Number(denyCountRaw)) ? Number(denyCountRaw) : 0;

        const createdAtRaw = idx.createdAt >= 0 ? cols[idx.createdAt]?.trim() : "";
        const createdAtDate = createdAtRaw ? new Date(createdAtRaw) : undefined;
        const expiresAtRaw = idx.expiresAt >= 0 ? cols[idx.expiresAt]?.trim() : "";
        const expiresAtDate = expiresAtRaw ? new Date(expiresAtRaw) : null;

        const values = {
          type,
          lat,
          lng,
          status,
          roadName,
          speedLimit: speedLimit != null && Number.isFinite(speedLimit) ? speedLimit : null,
          confirmCount,
          denyCount,
          expiresAt: expiresAtDate && !Number.isNaN(expiresAtDate.getTime()) ? expiresAtDate : null,
        };

        if (validId && existingIds.has(validId)) {
          await db
            .update(communityReportsTable)
            .set(values)
            .where(eq(communityReportsTable.id, validId));
          updated++;
        } else {
          await db.insert(communityReportsTable).values({
            ...(validId ? { id: validId } : {}),
            ...values,
            deviceId: "csv-import",
            ...(createdAtDate && !Number.isNaN(createdAtDate.getTime()) ? { createdAt: createdAtDate } : {}),
          });
          if (validId) existingIds.add(validId);
          created++;
        }
      } catch (rowErr) {
        errors.push({ row: rowNum, message: rowErr instanceof Error ? rowErr.message : "Unknown error" });
        skipped++;
      }
    }

    const actor = (req as any).adminUser as AdminJwtPayload;
    await logAudit({ actor, action: "report.import", details: { created, updated, skipped, errorCount: errors.length } });
    if (created + updated > 0) {
      await createNotification({
        title:   `CSV import: ${created + updated} reports processed`,
        message: `${actor.name} (${actor.role}) imported ${created} new and restored/updated ${updated} incident report${created + updated !== 1 ? "s" : ""}.`,
        type:    "info",
      });
    }

    return res.json({ success: true, created, updated, skipped, errors });
  } catch (err) {
    console.error("POST /admin/reports/import error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /admin/reports/bulk — bulk action
router.post("/reports/bulk", requireFeature("reports_bulk"), async (req: Request, res: Response) => {
  try {
    const { action, ids } = req.body as { action: "confirm" | "deny" | "delete"; ids: string[] };

    if (!action || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "action and ids[] required" });
    }
    if (!["confirm", "deny", "delete"].includes(action)) {
      return res.status(400).json({ error: "action must be confirm|deny|delete" });
    }

    let affected = 0;
    if (action === "delete") {
      const result = await db
        .delete(communityReportsTable)
        .where(inArray(communityReportsTable.id, ids));
      affected = ids.length;
    } else {
      const newStatus = action === "confirm" ? "confirmed" : "denied";
      await db
        .update(communityReportsTable)
        .set({ status: newStatus })
        .where(inArray(communityReportsTable.id, ids));
      affected = ids.length;
    }

    const actor = (req as any).adminUser as AdminJwtPayload;
    await logAudit({ actor, action: `report.bulk_${action}`, details: { ids, count: affected } });

    const actionLabel = action === "delete" ? "deleted" : action === "confirm" ? "confirmed" : "denied";
    await createNotification({
      title:   `Bulk action: ${affected} reports ${actionLabel}`,
      message: `${actor.name} (${actor.role}) ${actionLabel} ${affected} incident report${affected !== 1 ? "s" : ""}.`,
      type:    action === "delete" ? "warning" : "success",
    });

    return res.json({ success: true, affected });
  } catch (err) {
    console.error("POST /admin/reports/bulk error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /admin/reports/:id
router.patch("/reports/:id", requireFeature("reports"), async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const { type, lat, lng, status, speedLimit, roadName, confirmCount, denyCount } = req.body as {
      type?: string; lat?: number; lng?: number; status?: string;
      speedLimit?: number | null; roadName?: string | null;
      confirmCount?: number; denyCount?: number;
    };

    const [existing] = await db
      .select()
      .from(communityReportsTable)
      .where(eq(communityReportsTable.id, id));

    if (!existing) return res.status(404).json({ error: "Not found" });

    const updates: Record<string, unknown> = {};
    if (type         !== undefined) updates["type"]         = type;
    if (lat          !== undefined) updates["lat"]          = lat;
    if (lng          !== undefined) updates["lng"]          = lng;
    if (status       !== undefined) updates["status"]       = status;
    if (speedLimit   !== undefined) updates["speedLimit"]   = speedLimit;
    if (roadName     !== undefined) updates["roadName"]     = roadName;
    if (confirmCount !== undefined) updates["confirmCount"] = confirmCount;
    if (denyCount    !== undefined) updates["denyCount"]    = denyCount;

    const [updated] = await db
      .update(communityReportsTable)
      .set(updates as any)
      .where(eq(communityReportsTable.id, id))
      .returning();

    const actor = (req as any).adminUser as AdminJwtPayload;
    await logAudit({ actor, action: "report.update", targetType: "report", targetId: id, details: updates });

    return res.json({
      id:           updated.id,
      type:         updated.type,
      lat:          updated.lat,
      lng:          updated.lng,
      deviceId:     updated.deviceId,
      status:       updated.status,
      confirmCount: updated.confirmCount,
      denyCount:    updated.denyCount,
      speedLimit:   updated.speedLimit,
      roadName:     updated.roadName,
      createdAt:    updated.createdAt.toISOString(),
      expiresAt:    updated.expiresAt?.toISOString() ?? null,
    });
  } catch (err) {
    console.error("PATCH /admin/reports/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /admin/reports/:id
router.delete("/reports/:id", requireFeature("reports"), async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;

    const [existing] = await db
      .select()
      .from(communityReportsTable)
      .where(eq(communityReportsTable.id, id));

    if (!existing) return res.status(404).json({ error: "Not found" });

    await db
      .delete(communityReportsTable)
      .where(eq(communityReportsTable.id, id));

    const actor = (req as any).adminUser as AdminJwtPayload;
    await logAudit({ actor, action: "report.delete", targetType: "report", targetId: id, details: { type: existing.type } });

    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /admin/reports/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
