import { Router, type Request, type Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { db, adminUsersTable, opsTeamMembersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  signAdminToken,
  adminAuthMiddleware,
  loadAdminPermissionsMiddleware,
  type AdminJwtPayload,
} from "../../middleware/adminAuth.js";
import { getEffectivePermissions, parseStoredPermissions } from "@workspace/permissions";
import {
  generateTotpSecret,
  buildOtpAuthUrl,
  buildQrCodeDataUrl,
  verifyTotpCode,
} from "../../lib/totp.js";

const router = Router();

/**
 * Idempotently ensures the given admin user has an ops_team_members row.
 * Called on every successful login so accounts created after the last server
 * startup are linked before the user ever reaches the Team page.
 * Role mapping: founder → founder | admin → admin | moderator → member | * → member
 * Failures are swallowed — a missing member row is non-fatal for login itself.
 */
async function ensureOpsTeamMember(userId: string, role: string): Promise<void> {
  const opsRole =
    role === "founder" ? "founder"
    : role === "admin" ? "admin"
    : "member";
  try {
    await db.execute(sql`
      INSERT INTO ops_team_members (admin_user_id, role)
      VALUES (${userId}, ${opsRole})
      ON CONFLICT (admin_user_id) DO NOTHING
    `);
  } catch {
    // Non-fatal: the unique index may not exist yet on a fresh DB that has not
    // run migrateSchema yet, or the table itself may be mid-creation.
  }
}

// ── Brute-force protection for admin login ────────────────────────────────────
// 5 attempts per IP per 15 minutes — tight because this grants full admin access.
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ""),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    res.set("Retry-After", "900");
    res.status(429).json({
      error: "Too many login attempts. Wait 15 minutes and try again.",
    });
  },
});

// ── Pending-TOTP token helpers ─────────────────────────────────────────────────
// A short-lived JWT emitted when the user's password is correct but TOTP is
// still required.  It carries only the user ID and a `pending` claim so it
// cannot be used as a real session token anywhere else in the app.
function requireJwtSecret(): string {
  const s = process.env.ADMIN_JWT_SECRET;
  if (!s) throw new Error("ADMIN_JWT_SECRET environment variable is required");
  return s;
}

function signPendingToken(userId: string): string {
  return jwt.sign({ pending: true, userId }, requireJwtSecret(), { expiresIn: "5m" });
}

function verifyPendingToken(token: string): { userId: string } | null {
  try {
    const payload = jwt.verify(token, requireJwtSecret()) as any;
    if (!payload.pending || !payload.userId) return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

// ── GET /admin/auth/me ────────────────────────────────────────────────────────
router.get(
  "/auth/me",
  adminAuthMiddleware,
  loadAdminPermissionsMiddleware,
  async (req: Request, res: Response) => {
    const user = (req as any).adminUser as AdminJwtPayload;
    // Include live totpEnabled from DB so the frontend always has the truth.
    const [row] = await db
      .select({ totpEnabled: adminUsersTable.totpEnabled })
      .from(adminUsersTable)
      .where(eq(adminUsersTable.id, user.id));
    return res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mustChangePassword: user.mustChangePassword ?? false,
      totpEnabled: row?.totpEnabled ?? false,
      effectivePermissions: user.effectivePermissions ?? [],
    });
  }
);

// ── POST /admin/auth/login ────────────────────────────────────────────────────
// Step 1: validate email + password.
// • If 2FA is disabled → return full JWT (existing behaviour).
// • If 2FA is enabled  → return { totpRequired: true, pendingToken } so the
//   client can collect the TOTP code and call /auth/totp/confirm.
router.post("/auth/login", adminLoginLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    if (!email || !password) {
      return res.status(400).json({ error: "email and password required" });
    }

    const [user] = await db
      .select()
      .from(adminUsersTable)
      .where(eq(adminUsersTable.email, email.toLowerCase().trim()));

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // 2FA gate — credentials correct but TOTP still required.
    if (user.totpEnabled && user.totpSecret) {
      const pendingToken = signPendingToken(user.id);
      return res.json({ totpRequired: true, pendingToken });
    }

    // No 2FA — issue full session token immediately.
    const token = signAdminToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    });

    // Ensure this admin has an ops team member row (idempotent).
    await ensureOpsTeamMember(user.id, user.role);

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
        mustChangePassword: user.mustChangePassword,
        effectivePermissions: getEffectivePermissions(
          user.role,
          parseStoredPermissions(user.permissions)
        ),
      },
    });
  } catch (err) {
    console.error("POST /admin/auth/login error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /admin/auth/totp/confirm ─────────────────────────────────────────────
// Step 2 when 2FA is enabled: exchange a pending token + TOTP code for a full
// session JWT.
router.post("/auth/totp/confirm", adminLoginLimiter, async (req: Request, res: Response) => {
  try {
    const { pendingToken, code } = req.body as { pendingToken?: string; code?: string };
    if (!pendingToken || !code) {
      return res.status(400).json({ error: "pendingToken and code are required" });
    }

    const decoded = verifyPendingToken(pendingToken);
    if (!decoded) {
      return res.status(401).json({ error: "Session expired. Please sign in again." });
    }

    const [user] = await db
      .select()
      .from(adminUsersTable)
      .where(eq(adminUsersTable.id, decoded.userId));

    if (!user || !user.totpEnabled || !user.totpSecret) {
      return res.status(401).json({ error: "Invalid session." });
    }

    if (!verifyTotpCode(code, user.totpSecret)) {
      return res.status(401).json({ error: "Incorrect code. Check your authenticator app and try again." });
    }

    const token = signAdminToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    });

    // Ensure this admin has an ops team member row (idempotent).
    await ensureOpsTeamMember(user.id, user.role);

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
        mustChangePassword: user.mustChangePassword,
        effectivePermissions: getEffectivePermissions(
          user.role,
          parseStoredPermissions(user.permissions)
        ),
      },
    });
  } catch (err) {
    console.error("POST /admin/auth/totp/confirm error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /admin/auth/totp/setup ───────────────────────────────────────────────
// Generate a fresh TOTP secret and return the QR code.  Does NOT persist
// anything — the secret is only saved when /verify-setup succeeds.
router.post(
  "/auth/totp/setup",
  adminAuthMiddleware,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).adminUser as AdminJwtPayload;
      const [row] = await db
        .select({ email: adminUsersTable.email })
        .from(adminUsersTable)
        .where(eq(adminUsersTable.id, user.id));
      if (!row) return res.status(401).json({ error: "Unauthorized" });

      const secret = generateTotpSecret();
      const otpAuthUrl = buildOtpAuthUrl(row.email, secret);
      const qrCode = await buildQrCodeDataUrl(otpAuthUrl);

      return res.json({ secret, otpAuthUrl, qrCode });
    } catch (err) {
      console.error("POST /admin/auth/totp/setup error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ── POST /admin/auth/totp/verify-setup ───────────────────────────────────────
// Validate the TOTP code the user typed after scanning the QR.  On success,
// save the secret and flip totpEnabled to true.
router.post(
  "/auth/totp/verify-setup",
  adminAuthMiddleware,
  async (req: Request, res: Response) => {
    try {
      const { code, secret } = req.body as { code?: string; secret?: string };
      if (!code || !secret) {
        return res.status(400).json({ error: "code and secret are required" });
      }

      if (!verifyTotpCode(code, secret)) {
        return res.status(400).json({
          error: "Code didn't match. Make sure your device clock is correct and try again.",
        });
      }

      const user = (req as any).adminUser as AdminJwtPayload;
      await db
        .update(adminUsersTable)
        .set({ totpSecret: secret, totpEnabled: true })
        .where(eq(adminUsersTable.id, user.id));

      return res.json({ ok: true, totpEnabled: true });
    } catch (err) {
      console.error("POST /admin/auth/totp/verify-setup error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ── POST /admin/auth/totp/disable ─────────────────────────────────────────────
// Disable 2FA.  Requires the current account password as a second check so
// 2FA can't be silently stripped from a hijacked session.
router.post(
  "/auth/totp/disable",
  adminAuthMiddleware,
  async (req: Request, res: Response) => {
    try {
      const { password } = req.body as { password?: string };
      if (!password) {
        return res.status(400).json({ error: "password is required" });
      }

      const user = (req as any).adminUser as AdminJwtPayload;
      const [row] = await db
        .select()
        .from(adminUsersTable)
        .where(eq(adminUsersTable.id, user.id));

      if (!row) return res.status(401).json({ error: "Unauthorized" });

      const valid = await bcrypt.compare(password, row.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: "Incorrect password." });
      }

      await db
        .update(adminUsersTable)
        .set({ totpSecret: null, totpEnabled: false })
        .where(eq(adminUsersTable.id, user.id));

      return res.json({ ok: true, totpEnabled: false });
    } catch (err) {
      console.error("POST /admin/auth/totp/disable error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ── POST /admin/auth/change-password ─────────────────────────────────────────
router.post("/auth/change-password", adminAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "currentPassword and newPassword required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "newPassword must be at least 8 characters" });
    }

    const adminUser = (req as any).adminUser as { id: string };
    const [user] = await db
      .select()
      .from(adminUsersTable)
      .where(eq(adminUsersTable.id, adminUser.id));

    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    await db
      .update(adminUsersTable)
      .set({
        passwordHash: newPasswordHash,
        mustChangePassword: false,
        passwordUpdatedAt: new Date(),
      })
      .where(eq(adminUsersTable.id, user.id));

    const token = signAdminToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mustChangePassword: false,
    });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
        mustChangePassword: false,
        effectivePermissions: getEffectivePermissions(user.role, parseStoredPermissions(user.permissions)),
      },
    });
  } catch (err) {
    console.error("POST /admin/auth/change-password error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
