import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";

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

export function adminOnlyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const user = (req as any).adminUser as AdminJwtPayload | undefined;
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Forbidden — admin only" });
    return;
  }
  next();
}

export function signAdminToken(payload: AdminJwtPayload): string {
  return jwt.sign(payload, requireJwtSecret(), { expiresIn: "7d" });
}
