import { Router, type Request, type Response } from "express";
import bcrypt from "bcrypt";
import { db, adminUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signAdminToken } from "../../middleware/adminAuth.js";

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
    });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("POST /admin/auth/login error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
