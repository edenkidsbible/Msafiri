import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.ADMIN_JWT_SECRET ?? "fallback-dev-secret";

export interface AdminJwtPayload {
  id: string;
  email: string;
  name: string;
  role: string;
}

export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AdminJwtPayload;
    (req as any).adminUser = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function adminOnlyMiddleware(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).adminUser as AdminJwtPayload | undefined;
  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden — admin only" });
  }
  next();
}

export function signAdminToken(payload: AdminJwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}
