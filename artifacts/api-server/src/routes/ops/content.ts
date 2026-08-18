import { Router } from "express";
import { db, opsContentItemsTable, opsOperatingWeeksTable } from "@workspace/db";
import { eq, and, desc, asc, sql } from "drizzle-orm";

const router = Router();

router.get("/content", async (req, res) => {
  try {
    const limit = parseInt(String(req.query.limit ?? 50));
    const offset = parseInt(String(req.query.offset ?? 0));
    const status = req.query.status ? String(req.query.status) : undefined;
    const weekId = req.query.weekId ? parseInt(String(req.query.weekId)) : undefined;
    const isCore = req.query.isCore !== undefined ? req.query.isCore === "true" : undefined;

    const conditions = [eq(opsContentItemsTable.isDeleted, false)];
    if (status) conditions.push(eq(opsContentItemsTable.status, status));
    if (weekId) conditions.push(eq(opsContentItemsTable.weekId, weekId));
    if (isCore !== undefined) conditions.push(eq(opsContentItemsTable.isCore, isCore));

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(opsContentItemsTable)
      .where(and(...conditions));

    const items = await db
      .select({
        id: opsContentItemsTable.id,
        title: opsContentItemsTable.title,
        status: opsContentItemsTable.status,
        weekId: opsContentItemsTable.weekId,
        weekNumber: opsOperatingWeeksTable.weekNumber,
        isCore: opsContentItemsTable.isCore,
        platforms: opsContentItemsTable.platforms,
        pillar: opsContentItemsTable.pillar,
        format: opsContentItemsTable.format,
        angle: opsContentItemsTable.angle,
        hook: opsContentItemsTable.hook,
        captionSeed: opsContentItemsTable.captionSeed,
        cta: opsContentItemsTable.cta,
        scheduledDate: opsContentItemsTable.scheduledDate,
        postedDate: opsContentItemsTable.postedDate,
        linkedFieldTripId: opsContentItemsTable.linkedFieldTripId,
        views: opsContentItemsTable.views,
        clicks: opsContentItemsTable.clicks,
        installs: opsContentItemsTable.installs,
        paidSubscribersAttributed: opsContentItemsTable.paidSubscribersAttributed,
        founderMinutes: opsContentItemsTable.founderMinutes,
        notes: opsContentItemsTable.notes,
        complianceNotes: opsContentItemsTable.complianceNotes,
        hasComplianceWarning: opsContentItemsTable.hasComplianceWarning,
        createdAt: opsContentItemsTable.createdAt,
      })
      .from(opsContentItemsTable)
      .leftJoin(opsOperatingWeeksTable, eq(opsContentItemsTable.weekId, opsOperatingWeeksTable.id))
      .where(and(...conditions))
      .orderBy(asc(opsContentItemsTable.scheduledDate), desc(opsContentItemsTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ items, total: countResult?.count ?? 0 });
  } catch (err) {
    req.log.error({ err }, "Failed to list content items");
    res.status(500).json({ error: "Failed to list content items" });
  }
});

router.post("/content", async (req, res) => {
  try {
    const { title, status, weekId, isCore, platforms, pillar, format, angle, hook, captionSeed, cta, scheduledDate, linkedFieldTripId, founderMinutes, notes, complianceNotes } = req.body;
    if (!title) return res.status(400).json({ error: "title is required" });

    // Enforce 4-core limit per week
    if (isCore && weekId) {
      const [coreCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(opsContentItemsTable)
        .where(and(eq(opsContentItemsTable.weekId, weekId), eq(opsContentItemsTable.isCore, true), eq(opsContentItemsTable.isDeleted, false)));
      if ((coreCount?.count ?? 0) >= 4) {
        return res.status(400).json({ error: "Maximum 4 core content items per week" });
      }
    }

    const [item] = await db.insert(opsContentItemsTable).values({
      title, status: status ?? "idea", weekId, isCore: isCore ?? false, platforms,
      pillar, format, angle, hook, captionSeed, cta, scheduledDate, linkedFieldTripId,
      founderMinutes, notes, complianceNotes, createdBy: (req as any).adminUser?.id,
    }).returning();
    res.status(201).json(item);
  } catch (err) {
    req.log.error({ err }, "Failed to create content item");
    res.status(500).json({ error: "Failed to create content item" });
  }
});

router.get("/content/week/:weekId", async (req, res) => {
  try {
    const weekId = parseInt(req.params.weekId);
    const [week] = await db.select().from(opsOperatingWeeksTable).where(eq(opsOperatingWeeksTable.id, weekId));
    if (!week) return res.status(404).json({ error: "Week not found" });

    const all = await db.select().from(opsContentItemsTable)
      .where(and(eq(opsContentItemsTable.weekId, weekId), eq(opsContentItemsTable.isDeleted, false)))
      .orderBy(asc(opsContentItemsTable.scheduledDate), desc(opsContentItemsTable.createdAt));

    const coreItems = all.filter(i => i.isCore);
    const optionalItems = all.filter(i => !i.isCore);

    res.json({ weekNumber: week.weekNumber, coreCapacity: 4, coreItems, optionalItems });
  } catch (err) {
    req.log.error({ err }, "Failed to get weekly content");
    res.status(500).json({ error: "Failed to get weekly content" });
  }
});

router.get("/content/:id", async (req, res) => {
  try {
    const [item] = await db.select().from(opsContentItemsTable).where(and(eq(opsContentItemsTable.id, parseInt(req.params.id)), eq(opsContentItemsTable.isDeleted, false)));
    if (!item) return res.status(404).json({ error: "Content item not found" });
    res.json(item);
  } catch (err) {
    req.log.error({ err }, "Failed to get content item");
    res.status(500).json({ error: "Failed to get content item" });
  }
});

router.patch("/content/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const fields = ["title", "status", "weekId", "isCore", "platforms", "pillar", "format", "angle", "hook", "captionSeed", "cta", "scheduledDate", "postedDate", "linkedFieldTripId", "views", "clicks", "installs", "paidSubscribersAttributed", "founderMinutes", "notes", "complianceNotes", "hasComplianceWarning"];
    const update: Record<string, unknown> = {};
    for (const f of fields) if (req.body[f] !== undefined) update[f] = req.body[f];
    update.updatedBy = (req as any).adminUser?.id;
    const [item] = await db.update(opsContentItemsTable).set(update).where(and(eq(opsContentItemsTable.id, id), eq(opsContentItemsTable.isDeleted, false))).returning();
    if (!item) return res.status(404).json({ error: "Content item not found" });
    res.json(item);
  } catch (err) {
    req.log.error({ err }, "Failed to update content item");
    res.status(500).json({ error: "Failed to update content item" });
  }
});

router.delete("/content/:id", async (req, res) => {
  try {
    await db.update(opsContentItemsTable).set({ isDeleted: true, updatedBy: (req as any).adminUser?.id }).where(eq(opsContentItemsTable.id, parseInt(req.params.id)));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete content item");
    res.status(500).json({ error: "Failed to delete content item" });
  }
});

export default router;
