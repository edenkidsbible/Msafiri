import { Router, type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { db, communityReportsTable, speedZonesTable, speedBumpsTable } from "@workspace/db";
import { and, eq, isNotNull, inArray, desc } from "drizzle-orm";
import { patchStaticZoneFile } from "../startup/syncStaticZones";

// UUID v4 pattern — static zones use "sz"-prefixed IDs instead
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();

function mobileSpeedBump(row: typeof speedBumpsTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/admin-mobile/speed-bumps", adminMobileAuth, async (req: Request, res: Response) => {
  try {
    const conditions = [];
    if (req.query.status) conditions.push(eq(speedBumpsTable.status, String(req.query.status)));
    if (req.query.featureType) conditions.push(eq(speedBumpsTable.featureType, String(req.query.featureType)));
    const rows = await db.select().from(speedBumpsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(speedBumpsTable.updatedAt))
      .limit(Math.min(500, Number(req.query.limit) || 500));
    return res.json({ bumps: rows.map(mobileSpeedBump) });
  } catch (err) {
    console.error("[admin-mobile/speed-bumps/list]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin-mobile/speed-bumps/:id", adminMobileAuth, async (req: Request, res: Response) => {
  try {
    const allowed = ["name", "road", "description", "featureType", "lat", "lng", "direction", "alertEnabled", "verified", "status"] as const;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of allowed) if (key in req.body) patch[key] = req.body[key];
    const [row] = await db.update(speedBumpsTable).set(patch)
      .where(eq(speedBumpsTable.id, req.params.id as string)).returning();
    if (!row) return res.status(404).json({ error: "Speed bump not found" });
    return res.json(mobileSpeedBump(row));
  } catch (err) {
    console.error("[admin-mobile/speed-bumps/update]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin-mobile/speed-bumps/:id", adminMobileAuth, async (req: Request, res: Response) => {
  try {
    const [row] = await db.update(speedBumpsTable)
      .set({ status: "inactive", alertEnabled: false, updatedAt: new Date() })
      .where(eq(speedBumpsTable.id, req.params.id as string))
      .returning();
    if (!row) return res.status(404).json({ error: "Speed bump not found" });
    return res.json(mobileSpeedBump(row));
  } catch (err) {
    console.error("[admin-mobile/speed-bumps/remove]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── Brute-force protection for mobile PIN ─────────────────────────────────────
// 5 attempts per IP per 15 minutes.
const pinAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ""),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    res.set("Retry-After", "900");
    res.status(429).json({
      error: "Too many PIN attempts. Wait 15 minutes and try again.",
    });
  },
});

function requireSessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET environment variable is required");
  return s;
}

interface AdminMobileJwtPayload {
  role: "admin_mobile";
  iat: number;
  exp: number;
}

function adminMobileAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const payload = jwt.verify(auth.slice(7), requireSessionSecret()) as AdminMobileJwtPayload;
    if (payload.role !== "admin_mobile") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ─── POST /admin-mobile/auth ──────────────────────────────────────────────────
// Verify PIN, return a 30-day JWT for admin-mobile operations.
router.post("/admin-mobile/auth", pinAuthLimiter, (req: Request, res: Response) => {
  const { pin } = req.body as { pin?: string };
  if (!pin || typeof pin !== "string") {
    return res.status(400).json({ error: "PIN required" });
  }
  const correctPin = process.env.ADMIN_MOBILE_PIN;
  if (!correctPin) {
    return res.status(503).json({
      error: "Admin PIN not configured. Set the ADMIN_MOBILE_PIN environment variable.",
    });
  }
  if (pin !== correctPin) {
    return res.status(401).json({ error: "Incorrect PIN" });
  }
  try {
    const token = jwt.sign(
      { role: "admin_mobile" } as Omit<AdminMobileJwtPayload, "iat" | "exp">,
      requireSessionSecret(),
      { expiresIn: "30d" }
    );
    return res.json({ token });
  } catch (err) {
    console.error("[admin-mobile/auth]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /admin-mobile/reports/:id/verify ───────────────────────────────────
// ─── GET /admin-mobile/reports ───────────────────────────────────────────────
// Returns reports by status (default: pending_review) for the admin listings
// screen.  Also supports status=active to inspect live reports.
router.get("/admin-mobile/reports", adminMobileAuth, async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as string) || "pending_review";
    const VALID = ["pending_review", "active", "confirmed", "denied", "expired", "flagged"];
    const safeStatus = VALID.includes(status) ? status : "pending_review";

    // Optional type filter — used by the Cameras section to fetch pending
    // camera community reports separately from general reports.
    const typeFilter = req.query.type as string | undefined;
    const VALID_TYPES = ["camera", "police", "alcoblow", "accident", "traffic",
      "roadblock", "roadworks", "hazard", "pothole", "debris", "breakdown",
      "weather", "closure", "clear"];
    const safeType = typeFilter && VALID_TYPES.includes(typeFilter) ? typeFilter : null;

    const whereConditions = safeType
      ? and(
          eq(communityReportsTable.status, safeStatus as any),
          eq(communityReportsTable.type, safeType)
        )
      : eq(communityReportsTable.status, safeStatus as any);

    const rows = await db
      .select({
        id: communityReportsTable.id,
        type: communityReportsTable.type,
        status: communityReportsTable.status,
        lat: communityReportsTable.lat,
        lng: communityReportsTable.lng,
        roadName: communityReportsTable.roadName,
        confirmCount: communityReportsTable.confirmCount,
        denyCount: communityReportsTable.denyCount,
        adminVerified: communityReportsTable.adminVerified,
        speedLimit:  communityReportsTable.speedLimit,
        cameraType:  communityReportsTable.cameraType,
        createdAt:   communityReportsTable.createdAt,
        expiresAt:   communityReportsTable.expiresAt,
      })
      .from(communityReportsTable)
      .where(whereConditions)
      .orderBy(desc(communityReportsTable.createdAt))
      .limit(100);

    return res.json({
      reports: rows.map((r) => ({
        id:           r.id,
        type:         r.type,
        status:       r.status,
        lat:          r.lat,
        lng:          r.lng,
        roadName:     r.roadName   ?? null,
        speedLimit:   r.speedLimit ?? null,
        cameraType:   r.cameraType ?? null,
        confirmCount: r.confirmCount,
        denyCount:    r.denyCount,
        adminVerified: r.adminVerified,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
        expiresAt: r.expiresAt instanceof Date ? r.expiresAt.toISOString() : (r.expiresAt ?? null),
      })),
    });
  } catch (err) {
    console.error("GET /admin-mobile/reports error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Mark a report as admin-verified: adminVerified=true, status=confirmed,
// confirmCount=random 5-49, expiresAt=null (no expiry).
router.post(
  "/admin-mobile/reports/:id/verify",
  adminMobileAuth,
  async (req: Request, res: Response) => {
    try {
      const id = req.params["id"] as string;
      const rows = await db.select().from(communityReportsTable).where(eq(communityReportsTable.id, id));
      if (!rows.length) return res.status(404).json({ error: "Report not found" });

      const [updated] = await db
        .update(communityReportsTable)
        .set({ adminVerified: true, status: "confirmed", confirmCount: Math.floor(Math.random() * 45) + 5, expiresAt: null })
        .where(eq(communityReportsTable.id, id))
        .returning();

      return res.json({
        id: updated.id,
        status: updated.status,
        adminVerified: updated.adminVerified,
        confirmCount: updated.confirmCount,
      });
    } catch (err) {
      console.error("[admin-mobile/verify]", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── POST /admin-mobile/reports/:id/deny ─────────────────────────────────────
// Admin-deny a report (removes it from the map immediately).
router.post(
  "/admin-mobile/reports/:id/deny",
  adminMobileAuth,
  async (req: Request, res: Response) => {
    try {
      const id = req.params["id"] as string;
      const rows = await db.select().from(communityReportsTable).where(eq(communityReportsTable.id, id));
      if (!rows.length) return res.status(404).json({ error: "Report not found" });

      const [updated] = await db
        .update(communityReportsTable)
        .set({ status: "denied" })
        .where(eq(communityReportsTable.id, id))
        .returning();

      return res.json({ id: updated.id, status: updated.status });
    } catch (err) {
      console.error("[admin-mobile/deny]", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── PATCH /admin-mobile/reports/:id/location ────────────────────────────────
// Fix the lat/lng/roadName for a report.
router.patch(
  "/admin-mobile/reports/:id/location",
  adminMobileAuth,
  async (req: Request, res: Response) => {
    try {
      const id = req.params["id"] as string;
      const { lat, lng, roadName } = req.body as {
        lat?: number;
        lng?: number;
        roadName?: string | null;
      };

      const rows = await db.select().from(communityReportsTable).where(eq(communityReportsTable.id, id));
      if (!rows.length) return res.status(404).json({ error: "Report not found" });

      const updates: Partial<typeof communityReportsTable.$inferInsert> = {};
      if (lat != null) updates.lat = lat;
      if (lng != null) updates.lng = lng;
      if (roadName !== undefined) updates.roadName = roadName ?? null;

      const [updated] = await db
        .update(communityReportsTable)
        .set(updates)
        .where(eq(communityReportsTable.id, id))
        .returning();

      return res.json({
        id: updated.id,
        lat: updated.lat,
        lng: updated.lng,
        roadName: updated.roadName,
      });
    } catch (err) {
      console.error("[admin-mobile/location]", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── POST /admin-mobile/zones/:id/verify ─────────────────────────────────────
// Mark a speed zone as admin-verified (physically confirmed on site).
// For DB zones (UUID): sets verified=true on the existing row.
// For static zones (sz-prefixed): upserts a DB record with verified=true.
router.post(
  "/admin-mobile/zones/:id/verify",
  adminMobileAuth,
  async (req: Request, res: Response) => {
    try {
      const id = req.params["id"] as string;
      const { staticData } = req.body as {
        staticData?: { name: string; road?: string; type: string; speedLimit?: number; description?: string };
      };

      if (UUID_RE.test(id)) {
        // Standard DB zone — set verified by primary key
        const rows = await db.select().from(speedZonesTable).where(eq(speedZonesTable.id, id));
        if (!rows.length) return res.status(404).json({ error: "Zone not found" });
        await db
          .update(speedZonesTable)
          .set({ verified: true, updatedAt: new Date() })
          .where(eq(speedZonesTable.id, id));
        return res.json({ id, verified: true });
      }

      // Static zone — upsert by staticId
      const existing = await db
        .select()
        .from(speedZonesTable)
        .where(eq(speedZonesTable.staticId, id));

      if (existing.length) {
        await db
          .update(speedZonesTable)
          .set({ verified: true, status: "active", updatedAt: new Date() })
          .where(eq(speedZonesTable.staticId, id));
        return res.json({ id, verified: true });
      }

      // First-time promotion of a static zone
      if (!staticData) return res.status(400).json({ error: "staticData required to promote a static zone" });
      const [created] = await db
        .insert(speedZonesTable)
        .values({
          name: staticData.name,
          road: staticData.road ?? null,
          type: staticData.type,
          mode: "point",
          speedLimit: staticData.speedLimit ?? null,
          description: staticData.description ?? null,
          lat: null,
          lng: null,
          staticId: id,
          status: "active",
          verified: true,
        })
        .returning();
      return res.json({ id: created.id, staticId: id, verified: true });
    } catch (err) {
      console.error("[admin-mobile/zones/verify]", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── PATCH /admin-mobile/zones/:id/location ──────────────────────────────────
// Fix the lat/lng of a speed zone marker.
// For DB zones (UUID id): updates the existing row.
// For static zones (sz-prefixed id): upserts a DB record keyed by staticId.
router.patch(
  "/admin-mobile/zones/:id/location",
  adminMobileAuth,
  async (req: Request, res: Response) => {
    try {
      const id = req.params["id"] as string;
      const { lat, lng, staticData } = req.body as {
        lat?: number; lng?: number;
        staticData?: { name: string; road?: string; type: string; speedLimit?: number; description?: string };
      };
      if (lat == null || lng == null) return res.status(400).json({ error: "lat and lng required" });

      if (UUID_RE.test(id)) {
        // Standard DB zone — update by primary key
        const rows = await db.select().from(speedZonesTable).where(eq(speedZonesTable.id, id));
        if (!rows.length) return res.status(404).json({ error: "Zone not found" });
        const [updated] = await db
          .update(speedZonesTable)
          .set({ lat, lng, updatedAt: new Date() })
          .where(eq(speedZonesTable.id, id))
          .returning();
        // If this DB zone was promoted from a static zone, sync the source file too.
        if (updated.staticId) patchStaticZoneFile(updated.staticId, lat, lng);
        return res.json({ id: updated.id, staticId: updated.staticId, lat: updated.lat, lng: updated.lng });
      }

      // Static zone — upsert by staticId
      const existing = await db
        .select()
        .from(speedZonesTable)
        .where(eq(speedZonesTable.staticId, id));

      if (existing.length) {
        const [updated] = await db
          .update(speedZonesTable)
          .set({ lat, lng, status: "active", updatedAt: new Date() })
          .where(eq(speedZonesTable.staticId, id))
          .returning();
        // Sync new coordinates into speedZones.ts for permanent cross-environment persistence.
        patchStaticZoneFile(id, lat, lng);
        return res.json({ id: updated.id, staticId: updated.staticId, lat: updated.lat, lng: updated.lng });
      }

      // First-time promotion of a static zone
      if (!staticData) return res.status(400).json({ error: "staticData required to promote a static zone" });
      const [created] = await db
        .insert(speedZonesTable)
        .values({
          name: staticData.name,
          road: staticData.road ?? null,
          type: staticData.type,
          mode: "point",
          speedLimit: staticData.speedLimit ?? null,
          description: staticData.description ?? null,
          lat,
          lng,
          staticId: id,
          status: "active",
        })
        .returning();
      // Sync into speedZones.ts so future builds have the corrected coordinates baked in.
      patchStaticZoneFile(id, lat, lng);
      return res.json({ id: created.id, staticId: created.staticId, lat: created.lat, lng: created.lng });
    } catch (err) {
      console.error("[admin-mobile/zones/location]", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── DELETE /admin-mobile/zones/:id ──────────────────────────────────────────
// Deactivate (soft-delete) a speed zone.
// For static zones, upserts a suppression record with status=inactive.
router.delete(
  "/admin-mobile/zones/:id",
  adminMobileAuth,
  async (req: Request, res: Response) => {
    try {
      const id = req.params["id"] as string;
      const { staticData } = req.body as {
        staticData?: { name: string; road?: string; type: string; speedLimit?: number; description?: string };
      };

      if (UUID_RE.test(id)) {
        // Standard DB zone — soft-delete by primary key
        const rows = await db.select().from(speedZonesTable).where(eq(speedZonesTable.id, id));
        if (!rows.length) return res.status(404).json({ error: "Zone not found" });
        await db
          .update(speedZonesTable)
          .set({ status: "inactive", updatedAt: new Date() })
          .where(eq(speedZonesTable.id, id));
        return res.json({ id, status: "inactive" });
      }

      // Static zone — upsert suppression by staticId
      const existing = await db
        .select()
        .from(speedZonesTable)
        .where(eq(speedZonesTable.staticId, id));

      if (existing.length) {
        await db
          .update(speedZonesTable)
          .set({ status: "inactive", updatedAt: new Date() })
          .where(eq(speedZonesTable.staticId, id));
        return res.json({ id, status: "inactive" });
      }

      // First-time suppression of a static zone with no prior DB record
      if (!staticData) return res.status(400).json({ error: "staticData required to suppress a static zone" });
      const [created] = await db
        .insert(speedZonesTable)
        .values({
          name: staticData.name,
          road: staticData.road ?? null,
          type: staticData.type,
          mode: "point",
          speedLimit: staticData.speedLimit ?? null,
          description: staticData.description ?? null,
          lat: null,
          lng: null,
          staticId: id,
          status: "inactive",
        })
        .returning();
      return res.json({ id: created.id, staticId: id, status: "inactive" });
    } catch (err) {
      console.error("[admin-mobile/zones/delete]", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── PATCH /admin-mobile/zones/:id/meta ──────────────────────────────────────
// Edit zone metadata: name, road, speedLimit, type, description.
// For static zones (sz-prefixed) that have no prior DB record, staticData is
// required to bootstrap the upsert row.
router.patch(
  "/admin-mobile/zones/:id/meta",
  adminMobileAuth,
  async (req: Request, res: Response) => {
    try {
      const id = req.params["id"] as string;
      const { name, road, speedLimit, type, description, staticData } = req.body as {
        name?: string; road?: string; speedLimit?: number | null;
        type?: string; description?: string;
        staticData?: { name: string; road?: string; type: string; speedLimit?: number; description?: string };
      };

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (name        != null)      patch.name        = name;
      if (road        != null)      patch.road        = road;
      if (speedLimit  !== undefined) patch.speedLimit  = speedLimit;
      if (type        != null)      patch.type        = type;
      if (description != null)      patch.description = description;

      if (UUID_RE.test(id)) {
        const rows = await db.select().from(speedZonesTable).where(eq(speedZonesTable.id, id));
        if (!rows.length) return res.status(404).json({ error: "Zone not found" });
        const [updated] = await db.update(speedZonesTable).set(patch).where(eq(speedZonesTable.id, id)).returning();
        return res.json({ id: updated.id, name: updated.name, road: updated.road, speedLimit: updated.speedLimit, type: updated.type, description: updated.description });
      }

      // Static zone — upsert by staticId
      const existing = await db.select().from(speedZonesTable).where(eq(speedZonesTable.staticId, id));
      if (existing.length) {
        const [updated] = await db.update(speedZonesTable).set(patch).where(eq(speedZonesTable.staticId, id)).returning();
        return res.json({ id: updated.id, name: updated.name, road: updated.road, speedLimit: updated.speedLimit, type: updated.type, description: updated.description });
      }

      // First promotion of a static zone
      if (!staticData) return res.status(400).json({ error: "staticData required to promote a static zone" });
      const [created] = await db.insert(speedZonesTable).values({
        name:        name        ?? staticData.name,
        road:        road        ?? staticData.road        ?? null,
        type:        type        ?? staticData.type,
        mode:        "point",
        speedLimit:  speedLimit  !== undefined ? speedLimit : (staticData.speedLimit ?? null),
        description: description ?? staticData.description ?? null,
        lat: null, lng: null,
        staticId: id,
        status: "active",
      }).returning();
      return res.status(201).json({ id: created.id, name: created.name, road: created.road, speedLimit: created.speedLimit, type: created.type, description: created.description });
    } catch (err) {
      console.error("[admin-mobile/zones/meta]", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── PATCH /admin-mobile/reports/:id/meta ────────────────────────────────────
// Edit report metadata: type, roadName, speedLimit, cameraType.
router.patch(
  "/admin-mobile/reports/:id/meta",
  adminMobileAuth,
  async (req: Request, res: Response) => {
    try {
      const id = req.params["id"] as string;
      const { type, roadName, speedLimit, cameraType } = req.body as {
        type?: string;
        roadName?: string | null;
        speedLimit?: number | null;
        cameraType?: "fixed" | "mobile" | null;
      };
      const patch: Record<string, unknown> = {};
      if (type       !== undefined) patch.type       = type;
      if (roadName   !== undefined) patch.roadName   = roadName   ?? null;
      if (speedLimit !== undefined) patch.speedLimit = speedLimit ?? null;
      if (cameraType !== undefined) patch.cameraType = (type ?? "camera") === "camera" ? (cameraType ?? null) : null;
      if (!Object.keys(patch).length) return res.status(400).json({ error: "No fields to update" });
      const [updated] = await db
        .update(communityReportsTable)
        .set(patch)
        .where(eq(communityReportsTable.id, id))
        .returning();
      if (!updated) return res.status(404).json({ error: "Report not found" });
      return res.json({
        id:         updated.id,
        type:       updated.type,
        roadName:   updated.roadName,
        speedLimit: updated.speedLimit,
        cameraType: updated.cameraType,
      });
    } catch (err) {
      console.error("[admin-mobile/reports/meta]", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── GET /admin-mobile/reports/queue ─────────────────────────────────────────
// Returns flagged / pending-review / admin-review reports for the moderation queue.
router.get(
  "/admin-mobile/reports/queue",
  adminMobileAuth,
  async (_req: Request, res: Response) => {
    try {
      const rows = await db
        .select()
        .from(communityReportsTable)
        .where(inArray(communityReportsTable.status, ["flagged", "pending_review", "admin_review"]))
        .orderBy(desc(communityReportsTable.createdAt))
        .limit(50);
      return res.json({
        reports: rows.map((r) => ({
          id:           r.id,
          type:         r.type,
          lat:          r.lat,
          lng:          r.lng,
          status:       r.status,
          roadName:     r.roadName   ?? null,
          speedLimit:   r.speedLimit ?? null,
          cameraType:   r.cameraType ?? null,
          flagCount:    r.flagCount,
          confirmCount: r.confirmCount,
          denyCount:    r.denyCount,
          adminVerified: r.adminVerified,
          createdAt:    r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        })),
      });
    } catch (err) {
      console.error("[admin-mobile/reports/queue]", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── POST /admin-mobile/zones ─────────────────────────────────────────────────
// Create a new speed zone at given coordinates (admin-created = auto-verified).
router.post(
  "/admin-mobile/zones",
  adminMobileAuth,
  async (req: Request, res: Response) => {
    try {
      const { name, road, lat, lng, speedLimit, type, description } = req.body as {
        name?: string; road?: string; lat?: number; lng?: number;
        speedLimit?: number; type?: string; description?: string;
      };
      if (!name || !type || lat == null || lng == null) {
        return res.status(400).json({ error: "name, type, lat, lng are required" });
      }
      if (!["camera", "police", "zone"].includes(type)) {
        return res.status(400).json({ error: "type must be camera, police, or zone" });
      }
      const [created] = await db.insert(speedZonesTable).values({
        name,
        road:        road        ?? null,
        type,
        mode:        "point",
        speedLimit:  speedLimit  ?? null,
        description: description ?? null,
        lat:         Number(lat),
        lng:         Number(lng),
        status:      "active",
        verified:    true, // admin-created zones are auto-verified
      }).returning();
      return res.status(201).json({
        id:          created.id,
        name:        created.name,
        road:        created.road,
        lat:         created.lat,
        lng:         created.lng,
        speedLimit:  created.speedLimit,
        type:        created.type,
        description: created.description,
        verified:    created.verified,
      });
    } catch (err) {
      console.error("[admin-mobile/zones/create]", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── GET /admin-mobile/reports/all ───────────────────────────────────────────
// Paginated admin view of ALL community reports (any status).
// Query params: status, type, page (1-based), limit (default 30).
router.get(
  "/admin-mobile/reports/all",
  adminMobileAuth,
  async (req: Request, res: Response) => {
    try {
      const { status, type, page = "1", limit = "30" } = req.query as Record<string, string>;
      const pageNum  = Math.max(1, parseInt(page,  10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
      const offset   = (pageNum - 1) * limitNum;

      const { and, eq: eqOp, sql: sqlExpr, count: countFn } = await import("drizzle-orm");
      const filters = [];
      if (status && status !== "all") filters.push(eqOp(communityReportsTable.status, status));
      if (type   && type   !== "all") filters.push(eqOp(communityReportsTable.type,   type));
      const where = filters.length ? and(...filters) : undefined;

      const [{ total }] = await db
        .select({ total: countFn() })
        .from(communityReportsTable)
        .where(where);

      const rows = await db
        .select()
        .from(communityReportsTable)
        .where(where)
        .orderBy(desc(communityReportsTable.createdAt))
        .limit(limitNum)
        .offset(offset);

      return res.json({
        total:   Number(total),
        page:    pageNum,
        limit:   limitNum,
        reports: rows.map((r) => ({
          id:           r.id,
          type:         r.type,
          lat:          r.lat,
          lng:          r.lng,
          status:       r.status,
          roadName:     r.roadName,
          speedLimit:   r.speedLimit,
          flagCount:    r.flagCount,
          confirmCount: r.confirmCount,
          denyCount:    r.denyCount,
          adminVerified: r.adminVerified,
          createdAt:    r.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      console.error("[admin-mobile/reports/all]", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── GET /admin-mobile/zones ─────────────────────────────────────────────────
// Paginated list of speed zones for the admin listings screen.
// Query params: type (camera|police|zone|all), status (active|inactive|all),
//               page (1-based, default 1), limit (default 50, max 100).
router.get(
  "/admin-mobile/zones",
  adminMobileAuth,
  async (req: Request, res: Response) => {
    try {
      const { type, status = "active", page = "1", limit = "50" } =
        req.query as Record<string, string>;
      const pageNum  = Math.max(1, parseInt(page,  10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
      const offset   = (pageNum - 1) * limitNum;

      const { and, eq: eqOp, count: countFn, ne } = await import("drizzle-orm");
      const filters: ReturnType<typeof eqOp>[] = [];

      if (status && status !== "all") {
        filters.push(eqOp(speedZonesTable.status, status as any));
      }
      if (type && type !== "all" && ["camera", "police", "zone"].includes(type)) {
        filters.push(eqOp(speedZonesTable.type, type as any));
      }
      const where = filters.length ? and(...filters) : undefined;

      const [{ total }] = await db
        .select({ total: countFn() })
        .from(speedZonesTable)
        .where(where);

      const rows = await db
        .select()
        .from(speedZonesTable)
        .where(where)
        .orderBy(desc(speedZonesTable.createdAt))
        .limit(limitNum)
        .offset(offset);

      return res.json({
        total:  Number(total),
        page:   pageNum,
        limit:  limitNum,
        zones:  rows.map((z) => ({
          id:          z.id,
          name:        z.name,
          road:        z.road        ?? null,
          speedLimit:  z.speedLimit  ?? null,
          type:        z.type,
          description: z.description ?? null,
          lat:         z.lat,
          lng:         z.lng,
          status:      z.status,
          verified:    z.verified,
          staticId:    z.staticId    ?? null,
          createdAt:   z.createdAt instanceof Date ? z.createdAt.toISOString() : String(z.createdAt),
          updatedAt:   z.updatedAt instanceof Date ? z.updatedAt.toISOString() : String(z.updatedAt ?? z.createdAt),
        })),
      });
    } catch (err) {
      console.error("[admin-mobile/zones]", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── POST /admin-mobile/zones/sync-static ────────────────────────────────────
// One-time backfill: reads every speedZonesTable row that has a staticId and
// calls patchStaticZoneFile for each one.  This bakes all past admin relocations
// into speedZones.ts so that fresh installs (offline first-launch) see the
// corrected coordinates without needing an API round-trip.
router.post(
  "/admin-mobile/zones/sync-static",
  adminMobileAuth,
  async (_req: Request, res: Response) => {
    try {
      const rows = await db
        .select()
        .from(speedZonesTable)
        .where(isNotNull(speedZonesTable.staticId));

      let synced = 0;
      for (const row of rows) {
        if (row.staticId && row.lat != null && row.lng != null) {
          patchStaticZoneFile(row.staticId, row.lat, row.lng);
          synced++;
        }
      }

      console.info(`[zone-sync] bulk sync complete — ${synced} zone(s) patched`);
      return res.json({ synced, total: rows.length });
    } catch (err) {
      console.error("[admin-mobile/zones/sync-static]", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
