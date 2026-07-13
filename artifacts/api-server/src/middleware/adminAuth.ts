import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, adminUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getEffectivePermissions, parseStoredPermissions, type FeatureKey } from "@workspace/permissions";

function requireJwtSecret(): string {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) {
    throw new Error("ADMIN_JWT_SECRET environment variable is required but not set.");
  }
  return secret;
}

export interface AdminJwtPayload {
  id: string;
  email: string;
  name: string;
  role: string;
  mustChangePassword?: boolean;
  // Populated by loadAdminPermissionsMiddleware from a fresh DB read — never
  // trust a value baked into the JWT for this, since permission edits must
  // take effect immediately without waiting for the token to expire.
  effectivePermissions?: FeatureKey[];
}

export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, requireJwtSecret()) as AdminJwtPayload;
    (req as any).adminUser = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Runs right after adminAuthMiddleware on every authenticated admin request.
// Re-reads the user's current role + custom permission list from the
// database (not the JWT, which is stale for up to 7 days) and attaches the
// resolved effective permission set to req.adminUser so requireFeature()
// and route handlers can check it without a fresh query.
export async function loadAdminPermissionsMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const jwtUser = (req as any).adminUser as AdminJwtPayload | undefined;
  if (!jwtUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const [row] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, jwtUser.id));
    if (!row) {
      res.status(401).json({ error: "Unauthorized — account no longer exists" });
      return;
    }
    const effectivePermissions = getEffectivePermissions(row.role, parseStoredPermissions(row.permissions));
    (req as any).adminUser = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      mustChangePassword: row.mustChangePassword,
      effectivePermissions,
    } satisfies AdminJwtPayload;
    next();
  } catch (err) {
    console.error("loadAdminPermissionsMiddleware error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// Gate a route (or an entire router) on a single feature key. Must run after
// loadAdminPermissionsMiddleware.
export function requireFeature(feature: FeatureKey) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as any).adminUser as AdminJwtPayload | undefined;
    if (!user?.effectivePermissions?.includes(feature)) {
      res.status(403).json({ error: `Forbidden — missing "${feature}" permission` });
      return;
    }
    next();
  };
}

export function signAdminToken(payload: { id: string; email: string; name: string; role: string; mustChangePassword?: boolean }): string {
  return jwt.sign(payload, requireJwtSecret(), { expiresIn: "7d" });
}
