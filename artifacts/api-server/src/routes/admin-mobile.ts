import { Router, type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, communityReportsTable, speedZonesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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

// ─── PATCH /admin-mobile/zones/:id/location ──────────────────────────────────
// Fix the lat/lng of a speed zone marker.
router.patch(
  "/admin-mobile/zones/:id/location",
  adminMobileAuth,
  async (req: Request, res: Response) => {
    try {
      const id = req.params["id"] as string;
      const { lat, lng } = req.body as { lat?: number; lng?: number };
      if (lat == null || lng == null) return res.status(400).json({ error: "lat and lng required" });

      const rows = await db.select().from(speedZonesTable).where(eq(speedZonesTable.id, id));
      if (!rows.length) return res.status(404).json({ error: "Zone not found" });

      const [updated] = await db
        .update(speedZonesTable)
        .set({ lat, lng, updatedAt: new Date() })
        .where(eq(speedZonesTable.id, id))
        .returning();

      return res.json({ id: updated.id, lat: updated.lat, lng: updated.lng });
    } catch (err) {
      console.error("[admin-mobile/zones/location]", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── DELETE /admin-mobile/zones/:id ──────────────────────────────────────────
// Deactivate (soft-delete) a speed zone.
router.delete(
  "/admin-mobile/zones/:id",
  adminMobileAuth,
  async (req: Request, res: Response) => {
    try {
      const id = req.params["id"] as string;
      const rows = await db.select().from(speedZonesTable).where(eq(speedZonesTable.id, id));
      if (!rows.length) return res.status(404).json({ error: "Zone not found" });

      await db
        .update(speedZonesTable)
        .set({ status: "inactive", updatedAt: new Date() })
        .where(eq(speedZonesTable.id, id));

      return res.json({ id, status: "inactive" });
    } catch (err) {
      console.error("[admin-mobile/zones/delete]", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
