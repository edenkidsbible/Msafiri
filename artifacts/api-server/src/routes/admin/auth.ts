import { Router, type Request, type Response } from "express";
import bcrypt from "bcrypt";
import { db, adminUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signAdminToken, adminAuthMiddleware } from "../../middleware/adminAuth.js";

const router = Router();

// POST /admin/auth/login
router.post("/auth/login", async (req: Request, res: Response) => {
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

    const token = signAdminToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
        mustChangePassword: user.mustChangePassword,
      },
    });
  } catch (err) {
    console.error("POST /admin/auth/login error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /admin/auth/change-password
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
      },
    });
  } catch (err) {
    console.error("POST /admin/auth/change-password error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
