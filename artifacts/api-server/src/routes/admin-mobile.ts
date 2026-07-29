import { Router, type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, communityReportsTable, speedZonesTable } from "@workspace/db";
import { eq, isNotNull } from "drizzle-orm";
import { patchStaticZoneFile } from "../startup/syncStaticZones";

// UUID v4 pattern — static zones use "sz"-prefixed IDs instead
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();

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
router.post("/admin-mobile/auth", (req: Request, res: Response) => {
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
// Mark a report as admin-verified: adminVerified=true, status=confirmed,
// confirmCount=999, expiresAt=null (no expiry).
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
        .set({ adminVerified: true, status: "confirmed", confirmCount: 999, expiresAt: null })
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
