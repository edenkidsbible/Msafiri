import { Router } from "express";
import { db, opsTasksTable, opsOperatingWeeksTable } from "@workspace/db";
import { eq, and, desc, asc, sql } from "drizzle-orm";

const router = Router();

router.get("/tasks", async (req, res) => {
  try {
    const limit = parseInt(String(req.query.limit ?? 50));
    const offset = parseInt(String(req.query.offset ?? 0));
    const status = req.query.status ? String(req.query.status) : undefined;
    const weekId = req.query.weekId ? parseInt(String(req.query.weekId)) : undefined;
    const module = req.query.module ? String(req.query.module) : undefined;
    const priority = req.query.priority ? String(req.query.priority) : undefined;

    const conditions = [eq(opsTasksTable.isDeleted, false)];
    if (status) conditions.push(eq(opsTasksTable.status, status));
    if (weekId) conditions.push(eq(opsTasksTable.weekId, weekId));
    if (module) conditions.push(eq(opsTasksTable.module, module));
    if (priority) conditions.push(eq(opsTasksTable.priority, priority));

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(opsTasksTable)
      .where(and(...conditions));

    const items = await db
      .select({
        id: opsTasksTable.id,
        title: opsTasksTable.title,
        description: opsTasksTable.description,
        status: opsTasksTable.status,
        priority: opsTasksTable.priority,
        module: opsTasksTable.module,
        type: opsTasksTable.type,
        dueDate: opsTasksTable.dueDate,
        weekId: opsTasksTable.weekId,
        weekNumber: opsOperatingWeeksTable.weekNumber,
        estimatedHours: opsTasksTable.estimatedHours,
        actualHours: opsTasksTable.actualHours,
        assignedTo: opsTasksTable.assignedTo,
        acceptanceCriteria: opsTasksTable.acceptanceCriteria,
        isRecurring: opsTasksTable.isRecurring,
        position: opsTasksTable.position,
        createdAt: opsTasksTable.createdAt,
        updatedAt: opsTasksTable.updatedAt,
      })
      .from(opsTasksTable)
      .leftJoin(opsOperatingWeeksTable, eq(opsTasksTable.weekId, opsOperatingWeeksTable.id))
      .where(and(...conditions))
      .orderBy(
        asc(opsTasksTable.position),
        desc(opsTasksTable.createdAt)
      )
      .limit(limit)
      .offset(offset);

    res.json({ items, total: countResult?.count ?? 0 });
  } catch (err) {
    req.log.error({ err }, "Failed to list tasks");
    res.status(500).json({ error: "Failed to list tasks" });
  }
});

router.post("/tasks", async (req, res) => {
  try {
    const { title, description, status, priority, module, type, dueDate, weekId, estimatedHours, assignedTo, acceptanceCriteria } = req.body;
    if (!title || !priority || !module) return res.status(400).json({ error: "title, priority, module are required" });

    // Assign the next position within the target status column
    const targetStatus = status ?? "todo";
    const [maxRow] = await db
      .select({ maxPos: sql<number>`COALESCE(MAX(position), -1)::int` })
      .from(opsTasksTable)
      .where(and(eq(opsTasksTable.isDeleted, false), eq(opsTasksTable.status, targetStatus)));
    const nextPosition = (maxRow?.maxPos ?? -1) + 1;

    const [task] = await db.insert(opsTasksTable).values({
      title, description, status: targetStatus, priority, module, type, dueDate, weekId,
      estimatedHours, assignedTo, acceptanceCriteria, createdBy: (req as any).adminUser?.id,
      position: nextPosition,
    }).returning();

    return res.status(201).json(task);
  } catch (err) {
    req.log.error({ err }, "Failed to create task");
    return res.status(500).json({ error: "Failed to create task" });
  }
});

router.get("/tasks/stats", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const byStatus = await db
      .select({ status: opsTasksTable.status, count: sql<number>`count(*)::int` })
      .from(opsTasksTable)
      .where(eq(opsTasksTable.isDeleted, false))
      .groupBy(opsTasksTable.status);
    const byPriority = await db
      .select({ priority: opsTasksTable.priority, count: sql<number>`count(*)::int` })
      .from(opsTasksTable)
      .where(eq(opsTasksTable.isDeleted, false))
      .groupBy(opsTasksTable.priority);
    const byModule = await db
      .select({ module: opsTasksTable.module, count: sql<number>`count(*)::int` })
      .from(opsTasksTable)
      .where(eq(opsTasksTable.isDeleted, false))
      .groupBy(opsTasksTable.module);
    const [overdue] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(opsTasksTable)
      .where(and(
        eq(opsTasksTable.isDeleted, false),
        sql`${opsTasksTable.dueDate} < ${today}`,
        sql`${opsTasksTable.status} NOT IN ('done', 'cancelled')`
      ));

    res.json({
      byStatus: Object.fromEntries(byStatus.map(r => [r.status, r.count])),
      byPriority: Object.fromEntries(byPriority.map(r => [r.priority, r.count])),
      byModule: Object.fromEntries(byModule.map(r => [r.module, r.count])),
      totalOverdue: overdue?.count ?? 0,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get task stats");
    res.status(500).json({ error: "Failed to get task stats" });
  }
});

// Bulk reorder: update positions for multiple tasks in one shot
router.patch("/tasks/reorder", async (req, res) => {
  const role = (req as any).adminUser?.role;
  if (!['founder', 'admin'].includes(role)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const { items } = req.body as { items: { id: number; position: number }[] };
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items array is required" });
    }
    await db.transaction(async (tx) => {
      for (const { id, position } of items) {
        await tx
          .update(opsTasksTable)
          .set({ position, updatedBy: (req as any).adminUser?.id })
          .where(and(eq(opsTasksTable.id, id), eq(opsTasksTable.isDeleted, false)));
      }
    });
    return res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to reorder tasks");
    return res.status(500).json({ error: "Failed to reorder tasks" });
  }
});

router.get("/tasks/:id", async (req, res) => {
  try {
    const [task] = await db.select().from(opsTasksTable).where(and(eq(opsTasksTable.id, parseInt(req.params.id)), eq(opsTasksTable.isDeleted, false)));
    if (!task) return res.status(404).json({ error: "Task not found" });
    return res.json(task);
  } catch (err) {
    req.log.error({ err }, "Failed to get task");
    return res.status(500).json({ error: "Failed to get task" });
  }
});

router.patch("/tasks/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const fields = ["title", "description", "status", "priority", "module", "type", "dueDate", "weekId", "estimatedHours", "actualHours", "assignedTo", "acceptanceCriteria", "position"];
    const update: Record<string, unknown> = {};
    for (const f of fields) if (req.body[f] !== undefined) update[f] = req.body[f];

    // Read current task once — used for status-column reorder
    const [currentTask] = await db
      .select({ status: opsTasksTable.status, assignedTo: opsTasksTable.assignedTo, title: opsTasksTable.title })
      .from(opsTasksTable)
      .where(and(eq(opsTasksTable.id, id), eq(opsTasksTable.isDeleted, false)));

    // When moving to a different status column, assign to the end of that column
    if (update.status !== undefined && currentTask && currentTask.status !== update.status) {
      const [maxRow] = await db
        .select({ maxPos: sql<number>`COALESCE(MAX(position), -1)::int` })
        .from(opsTasksTable)
        .where(and(eq(opsTasksTable.isDeleted, false), eq(opsTasksTable.status, update.status as string)));
      update.position = (maxRow?.maxPos ?? -1) + 1;
    }

    update.updatedBy = (req as any).adminUser?.id;
    const [task] = await db.update(opsTasksTable).set(update).where(and(eq(opsTasksTable.id, id), eq(opsTasksTable.isDeleted, false))).returning();
    if (!task) return res.status(404).json({ error: "Task not found" });

    return res.json(task);
  } catch (err) {
    req.log.error({ err }, "Failed to update task");
    return res.status(500).json({ error: "Failed to update task" });
  }
});

router.delete("/tasks/:id", async (req, res) => {
  try {
    await db.update(opsTasksTable).set({ isDeleted: true, updatedBy: (req as any).adminUser?.id }).where(eq(opsTasksTable.id, parseInt(req.params.id)));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete task");
    res.status(500).json({ error: "Failed to delete task" });
  }
});

export default router;
