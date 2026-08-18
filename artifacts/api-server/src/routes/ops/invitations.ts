import { Router } from "express";
import { db, opsInvitationsTable, opsDepartmentsTable, adminUsersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { randomBytes } from "crypto";
// Note: invitation emails not implemented — invitations use the admin panel directly

const router = Router();

// ─── CREATE INVITATION (founder/admin only) ───────────────────────────────────

router.post("/invitations", async (req, res) => {
  const role = (req as any).adminUser?.role;
  if (!['founder', 'admin'].includes(role)) return res.status(403).json({ error: 'Forbidden' });

  const { email, role: inviteRole, departmentId, message: _msg } = req.body;
  if (!email?.trim()) return res.status(400).json({ error: "email is required" });

  // Check for existing pending invitation
  const [existing] = await db
    .select()
    .from(opsInvitationsTable)
    .where(and(eq(opsInvitationsTable.email, email.toLowerCase().trim()), eq(opsInvitationsTable.status, "pending")));
  if (existing) {
    return res.status(400).json({ error: "An active invitation already exists for this email" });
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const [inv] = await db
    .insert(opsInvitationsTable)
    .values({
      email: email.toLowerCase().trim(),
      role: inviteRole ?? "member",
      departmentId: departmentId ?? null,
      token,
      invitedBy: (req as any).adminUser?.id,
      expiresAt,
    })
    .returning();

  // Resolve department name for email
  return res.status(201).json({
    id: inv.id,
    email: inv.email,
    role: inv.role,
    expiresAt: inv.expiresAt,
    status: inv.status,
    token: inv.token, // returned so admin can share the invite link manually
  });
});

// ─── LIST INVITATIONS ─────────────────────────────────────────────────────────

router.get("/invitations", async (req, res) => {
  const role = (req as any).adminUser?.role;
  if (!['founder', 'admin'].includes(role)) return res.status(403).json({ error: 'Forbidden' });

  const invs = await db
    .select({
      id: opsInvitationsTable.id,
      email: opsInvitationsTable.email,
      role: opsInvitationsTable.role,
      departmentId: opsInvitationsTable.departmentId,
      departmentName: opsDepartmentsTable.name,
      status: opsInvitationsTable.status,
      expiresAt: opsInvitationsTable.expiresAt,
      acceptedAt: opsInvitationsTable.acceptedAt,
      createdAt: opsInvitationsTable.createdAt,
    })
    .from(opsInvitationsTable)
    .leftJoin(opsDepartmentsTable, eq(opsInvitationsTable.departmentId, opsDepartmentsTable.id))
    .orderBy(opsInvitationsTable.createdAt);

  res.json(invs.reverse());
});

// ─── REVOKE INVITATION ────────────────────────────────────────────────────────

router.delete("/invitations/:id", async (req, res) => {
  const role = (req as any).adminUser?.role;
  if (!['founder', 'admin'].includes(role)) return res.status(403).json({ error: 'Forbidden' });

  const id = parseInt(req.params.id);
  await db.update(opsInvitationsTable).set({ status: "revoked" }).where(eq(opsInvitationsTable.id, id));
  res.status(204).send();
});

// ─── GET INVITATION INFO BY TOKEN (public info endpoint) ──────────────────────

router.get("/invitations/token/:token", async (req, res) => {
  const { token } = req.params;
  const [inv] = await db
    .select({
      email: opsInvitationsTable.email,
      role: opsInvitationsTable.role,
      status: opsInvitationsTable.status,
      expiresAt: opsInvitationsTable.expiresAt,
      departmentName: opsDepartmentsTable.name,
    })
    .from(opsInvitationsTable)
    .leftJoin(opsDepartmentsTable, eq(opsInvitationsTable.departmentId, opsDepartmentsTable.id))
    .where(eq(opsInvitationsTable.token, token));
  if (!inv) return res.status(404).json({ error: "Invitation not found" });
  res.json(inv);
});

export default router;
