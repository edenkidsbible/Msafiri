import { Router, type Request, type Response } from "express";
import bcrypt from "bcrypt";
import { db, adminUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// GET /admin/users
router.get("/users", async (_req: Request, res: Response) => {
  try {
    const users = await db.select().from(adminUsersTable);
    return res.json({
      users: users.map((u) => ({
        id:        u.id,
        email:     u.email,
        name:      u.name,
        role:      u.role,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("GET /admin/users error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /admin/users
router.post("/users", async (req: Request, res: Response) => {
  try {
    const { email, name, password, role } = req.body as {
      email: string; name: string; password: string; role: string;
    };

    if (!email || !name || !password || !role) {
      return res.status(400).json({ error: "email, name, password, role required" });
    }
    if (!["admin", "staff"].includes(role)) {
      return res.status(400).json({ error: "role must be 'admin' or 'staff'" });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [inserted] = await db
      .insert(adminUsersTable)
      .values({ email: email.toLowerCase().trim(), name, passwordHash, role })
      .returning();

    return res.status(201).json({
      id:        inserted.id,
      email:     inserted.email,
      name:      inserted.name,
      role:      inserted.role,
      createdAt: inserted.createdAt.toISOString(),
    });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Email already exists" });
    }
    console.error("POST /admin/users error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /admin/users/:id
router.patch("/users/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const { email, name, password, role } = req.body as {
      email?: string; name?: string; password?: string; role?: string;
    };

    const [existing] = await db
      .select()
      .from(adminUsersTable)
      .where(eq(adminUsersTable.id, id));

    if (!existing) return res.status(404).json({ error: "Not found" });

    const updates: Record<string, unknown> = {};
    if (email)    updates["email"] = email.toLowerCase().trim();
    if (name)     updates["name"]  = name;
    if (role)     updates["role"]  = role;
    if (password) updates["passwordHash"] = await bcrypt.hash(password, 12);

    const [updated] = await db
      .update(adminUsersTable)
      .set(updates as any)
      .where(eq(adminUsersTable.id, id))
      .returning();

    return res.json({
      id:        updated.id,
      email:     updated.email,
      name:      updated.name,
      role:      updated.role,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Email already exists" });
    }
    console.error("PATCH /admin/users/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /admin/users/:id
router.delete("/users/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;

    const [existing] = await db
      .select()
      .from(adminUsersTable)
      .where(eq(adminUsersTable.id, id));

    if (!existing) return res.status(404).json({ error: "Not found" });

    const caller = (req as any).adminUser;
    if (caller?.id === id) {
      return res.status(400).json({ error: "Cannot delete your own account" });
    }

    await db.delete(adminUsersTable).where(eq(adminUsersTable.id, id));
    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /admin/users/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
