import { Router } from "express";
import { db, adminUsersTable, opsDepartmentsTable, opsTeamMembersTable } from "@workspace/db";
import { eq, asc, sql } from "drizzle-orm";

const router = Router();

// ─── DEPARTMENTS ──────────────────────────────────────────────────────────────

router.get("/team/departments", async (req, res) => {
  try {
    const departments = await db
      .select()
      .from(opsDepartmentsTable)
      .orderBy(asc(opsDepartmentsTable.name));
    res.json(departments);
  } catch (err) {
    req.log.error({ err }, "Failed to list departments");
    res.status(500).json({ error: "Failed to list departments" });
  }
});

router.post("/team/departments", async (req, res) => {
  const role = (req as any).adminUser?.role;
  if (!['founder', 'admin'].includes(role)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const { name, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });

    const [dept] = await db
      .insert(opsDepartmentsTable)
      .values({ name: name.trim(), description })
      .returning();

    return res.status(201).json(dept);
  } catch (err) {
    req.log.error({ err }, "Failed to create department");
    return res.status(500).json({ error: "Failed to create department" });
  }
});

router.patch("/team/departments/:id", async (req, res) => {
  const role = (req as any).adminUser?.role;
  if (!['founder', 'admin'].includes(role)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const id = parseInt(req.params.id as string);
    const { name, description, isActive } = req.body;
    const update: Record<string, unknown> = {};
    if (name !== undefined) update.name = name.trim();
    if (description !== undefined) update.description = description;
    if (isActive !== undefined) update.isActive = isActive;

    const [dept] = await db
      .update(opsDepartmentsTable)
      .set(update)
      .where(eq(opsDepartmentsTable.id, id))
      .returning();
    if (!dept) return res.status(404).json({ error: "Department not found" });
    return res.json(dept);
  } catch (err) {
    req.log.error({ err }, "Failed to update department");
    return res.status(500).json({ error: "Failed to update department" });
  }
});

router.delete("/team/departments/:id", async (req, res) => {
  const role = (req as any).adminUser?.role;
  if (!['founder', 'admin'].includes(role)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const id = parseInt(req.params.id as string);
    await db.delete(opsDepartmentsTable).where(eq(opsDepartmentsTable.id, id));
    return res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete department");
    return res.status(500).json({ error: "Failed to delete department" });
  }
});

// ─── USERS (admin users) ──────────────────────────────────────────────────────

router.get("/team/users", async (req, res) => {
  try {
    const users = await db
      .select({
        id: adminUsersTable.id,
        email: adminUsersTable.email,
        name: adminUsersTable.name,
        role: adminUsersTable.role,
      })
      .from(adminUsersTable)
      .orderBy(asc(adminUsersTable.name));
    res.json(users);
  } catch (err) {
    req.log.error({ err }, "Failed to list users");
    res.status(500).json({ error: "Failed to list users" });
  }
});

// ─── TEAM MEMBERS ─────────────────────────────────────────────────────────────

async function getTeamMembersWithUsers() {
  return db
    .select({
      id: opsTeamMembersTable.id,
      adminUserId: opsTeamMembersTable.adminUserId,
      role: opsTeamMembersTable.role,
      departmentId: opsTeamMembersTable.departmentId,
      departmentName: opsDepartmentsTable.name,
      isActive: opsTeamMembersTable.isActive,
      notes: opsTeamMembersTable.notes,
      createdAt: opsTeamMembersTable.createdAt,
      updatedAt: opsTeamMembersTable.updatedAt,
      email: adminUsersTable.email,
      name: adminUsersTable.name,
    })
    .from(opsTeamMembersTable)
    .leftJoin(adminUsersTable, sql`${opsTeamMembersTable.adminUserId} = ${adminUsersTable.id}::text`)
    .leftJoin(opsDepartmentsTable, eq(opsTeamMembersTable.departmentId, opsDepartmentsTable.id))
    .orderBy(asc(adminUsersTable.name));
}

router.get("/team/members", async (req, res) => {
  try {
    const members = await getTeamMembersWithUsers();
    res.json(members);
  } catch (err) {
    req.log.error({ err }, "Failed to list team members");
    res.status(500).json({ error: "Failed to list team members" });
  }
});

router.post("/team/members", async (req, res) => {
  const role = (req as any).adminUser?.role;
  if (!['founder', 'admin'].includes(role)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const { userId, role: memberRole, departmentId, notes } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    // Verify the user exists
    const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, userId));
    if (!user) return res.status(400).json({ error: "User not found" });

    // Check for duplicate
    const [existing] = await db
      .select()
      .from(opsTeamMembersTable)
      .where(eq(opsTeamMembersTable.adminUserId, userId));
    if (existing) return res.status(400).json({ error: "User is already a team member" });

    const [member] = await db
      .insert(opsTeamMembersTable)
      .values({
        adminUserId: userId,
        role: memberRole ?? "member",
        departmentId: departmentId ?? null,
        notes,
        invitedBy: (req as any).adminUser?.id,
      })
      .returning();

    // Return with joined user info
    const [full] = await db
      .select({
        id: opsTeamMembersTable.id,
        adminUserId: opsTeamMembersTable.adminUserId,
        role: opsTeamMembersTable.role,
        departmentId: opsTeamMembersTable.departmentId,
        departmentName: opsDepartmentsTable.name,
        isActive: opsTeamMembersTable.isActive,
        notes: opsTeamMembersTable.notes,
        createdAt: opsTeamMembersTable.createdAt,
        updatedAt: opsTeamMembersTable.updatedAt,
        email: adminUsersTable.email,
        name: adminUsersTable.name,
      })
      .from(opsTeamMembersTable)
      .leftJoin(adminUsersTable, sql`${opsTeamMembersTable.adminUserId} = ${adminUsersTable.id}::text`)
      .leftJoin(opsDepartmentsTable, eq(opsTeamMembersTable.departmentId, opsDepartmentsTable.id))
      .where(eq(opsTeamMembersTable.id, member.id));

    return res.status(201).json(full);
  } catch (err) {
    req.log.error({ err }, "Failed to add team member");
    return res.status(500).json({ error: "Failed to add team member" });
  }
});

router.patch("/team/members/:id", async (req, res) => {
  const role = (req as any).adminUser?.role;
  if (!['founder', 'admin'].includes(role)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const id = parseInt(req.params.id as string);
    const { role: memberRole, departmentId, isActive, notes } = req.body;
    const update: Record<string, unknown> = {};
    if (memberRole !== undefined) update.role = memberRole;
    if (departmentId !== undefined) update.departmentId = departmentId;
    if (isActive !== undefined) update.isActive = isActive;
    if (notes !== undefined) update.notes = notes;

    const [member] = await db
      .update(opsTeamMembersTable)
      .set(update)
      .where(eq(opsTeamMembersTable.id, id))
      .returning();
    if (!member) return res.status(404).json({ error: "Team member not found" });

    const [full] = await db
      .select({
        id: opsTeamMembersTable.id,
        adminUserId: opsTeamMembersTable.adminUserId,
        role: opsTeamMembersTable.role,
        departmentId: opsTeamMembersTable.departmentId,
        departmentName: opsDepartmentsTable.name,
        isActive: opsTeamMembersTable.isActive,
        notes: opsTeamMembersTable.notes,
        createdAt: opsTeamMembersTable.createdAt,
        updatedAt: opsTeamMembersTable.updatedAt,
        email: adminUsersTable.email,
        name: adminUsersTable.name,
      })
      .from(opsTeamMembersTable)
      .leftJoin(adminUsersTable, sql`${opsTeamMembersTable.adminUserId} = ${adminUsersTable.id}::text`)
      .leftJoin(opsDepartmentsTable, eq(opsTeamMembersTable.departmentId, opsDepartmentsTable.id))
      .where(eq(opsTeamMembersTable.id, member.id));

    return res.json(full);
  } catch (err) {
    req.log.error({ err }, "Failed to update team member");
    return res.status(500).json({ error: "Failed to update team member" });
  }
});

router.delete("/team/members/:id", async (req, res) => {
  const role = (req as any).adminUser?.role;
  if (!['founder', 'admin'].includes(role)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const id = parseInt(req.params.id as string);
    await db.delete(opsTeamMembersTable).where(eq(opsTeamMembersTable.id, id));
    return res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to remove team member");
    return res.status(500).json({ error: "Failed to remove team member" });
  }
});

export default router;
