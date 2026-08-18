/**
 * Ops data backup — export all ops tables as JSON, import/restore from JSON.
 * GET  /api/ops/backup/export   → { version, exportedAt, data: { ... } }
 * POST /api/ops/backup/import   → { imported: { ... counts } }
 * GET  /api/ops/backup/status   → { tables: { name, count }[] }
 */
import { Router } from "express";
import {
  db,
  opsOperatingWeeksTable,
  opsWeeklyPlansTable,
  opsWeeklyReviewsTable,
  opsTransactionCategoriesTable,
  opsTransactionsTable,
  opsRecurringExpensesTable,
  opsTasksTable,
  opsContentItemsTable,
  opsFieldTripsTable,
  opsRoadRecordsTable,
  opsSubscriptionWeekMetricsTable,
  opsSettingsTable,
  opsDepartmentsTable,
  opsTeamMembersTable,
  opsImportBatchesTable,
} from "@workspace/db";
import { eq, sql, asc } from "drizzle-orm";

const router = Router();

// ── Export ─────────────────────────────────────────────────────────────────

router.get("/backup/export", async (req, res) => {
  try {
    const [
      weeks, weeklyPlans, weeklyReviews, categories, transactions, recurringExpenses,
      tasks, content, fieldTrips, roadRecords, subscriptionMetrics,
      settings, departments, teamMembers, importBatches,
    ] = await Promise.all([
      db.select().from(opsOperatingWeeksTable).orderBy(asc(opsOperatingWeeksTable.weekNumber)),
      db.select().from(opsWeeklyPlansTable),
      db.select().from(opsWeeklyReviewsTable),
      db.select().from(opsTransactionCategoriesTable),
      db.select().from(opsTransactionsTable).where(eq(opsTransactionsTable.isDeleted, false)),
      db.select().from(opsRecurringExpensesTable),
      db.select().from(opsTasksTable).where(eq(opsTasksTable.isDeleted, false)),
      db.select().from(opsContentItemsTable).where(eq(opsContentItemsTable.isDeleted, false)),
      db.select().from(opsFieldTripsTable),
      db.select().from(opsRoadRecordsTable),
      db.select().from(opsSubscriptionWeekMetricsTable),
      db.select().from(opsSettingsTable).limit(1),
      db.select().from(opsDepartmentsTable),
      db.select().from(opsTeamMembersTable),
      db.select().from(opsImportBatchesTable),
    ]);

    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      exportedBy: (req as any).adminUser?.name ?? "admin",
      data: {
        weeks, weeklyPlans, weeklyReviews, categories, transactions, recurringExpenses,
        tasks, content, fieldTrips, roadRecords, subscriptionMetrics,
        settings: settings[0] ?? null, departments, teamMembers, importBatches,
      },
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="msafiri-ops-backup-${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.json(payload);
  } catch (err) {
    req.log.error({ err }, "Ops backup export failed");
    res.status(500).json({ error: "Export failed" });
  }
});

// ── Status ─────────────────────────────────────────────────────────────────

router.get("/backup/status", async (req, res) => {
  try {
    const counts = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(opsOperatingWeeksTable),
      db.select({ count: sql<number>`count(*)::int` }).from(opsTransactionsTable).where(eq(opsTransactionsTable.isDeleted, false)),
      db.select({ count: sql<number>`count(*)::int` }).from(opsContentItemsTable).where(eq(opsContentItemsTable.isDeleted, false)),
      db.select({ count: sql<number>`count(*)::int` }).from(opsTasksTable).where(eq(opsTasksTable.isDeleted, false)),
      db.select({ count: sql<number>`count(*)::int` }).from(opsFieldTripsTable),
      db.select({ count: sql<number>`count(*)::int` }).from(opsSubscriptionWeekMetricsTable),
    ]);

    res.json({
      tables: [
        { name: "Operating Weeks", count: counts[0][0].count },
        { name: "Transactions",    count: counts[1][0].count },
        { name: "Content Items",   count: counts[2][0].count },
        { name: "Tasks",           count: counts[3][0].count },
        { name: "Field Trips",     count: counts[4][0].count },
        { name: "Subscription Metrics", count: counts[5][0].count },
      ],
    });
  } catch (err) {
    req.log.error({ err }, "Ops backup status failed");
    res.status(500).json({ error: "Status check failed" });
  }
});

// ── Import ─────────────────────────────────────────────────────────────────

router.post("/backup/import", async (req, res) => {
  const role = (req as any).adminUser?.role;
  if (!["founder", "admin"].includes(role)) {
    return res.status(403).json({ error: "Only founders and admins can restore backups" });
  }

  const { data, version } = req.body ?? {};
  if (!data || !version) {
    return res.status(400).json({ error: "Invalid backup file — missing version or data" });
  }
  if (version < 1 || version > 2) {
    return res.status(400).json({ error: `Unsupported backup version: ${version}` });
  }

  const counts: Record<string, number> = {};

  try {
    // ── Settings (upsert) ────────────────────────────────────────────────
    if (data.settings) {
      const { id: _id, createdAt: _c, updatedAt: _u, ...settingsData } = data.settings;
      await db
        .insert(opsSettingsTable)
        .values(settingsData)
        .onConflictDoNothing();
      counts.settings = 1;
    }

    // ── Categories (upsert by name) ───────────────────────────────────────
    if (Array.isArray(data.categories) && data.categories.length > 0) {
      const oldToNew: Record<number, number> = {};
      for (const cat of data.categories) {
        const { id: oldId, createdAt: _c, ...catData } = cat;
        const [inserted] = await db
          .insert(opsTransactionCategoriesTable)
          .values(catData)
          .onConflictDoNothing()
          .returning({ id: opsTransactionCategoriesTable.id });
        if (inserted) oldToNew[oldId] = inserted.id;
      }
      counts.categories = data.categories.length;

      // ── Weeks (upsert by weekNumber) ──────────────────────────────────
      const weekOldToNew: Record<number, number> = {};
      if (Array.isArray(data.weeks) && data.weeks.length > 0) {
        for (const week of data.weeks) {
          const { id: oldId, createdAt: _c, updatedAt: _u, ...weekData } = week;
          const [existing] = await db
            .select({ id: opsOperatingWeeksTable.id })
            .from(opsOperatingWeeksTable)
            .where(eq(opsOperatingWeeksTable.weekNumber, weekData.weekNumber))
            .limit(1);
          if (existing) {
            weekOldToNew[oldId] = existing.id;
          } else {
            const [inserted] = await db
              .insert(opsOperatingWeeksTable)
              .values(weekData)
              .returning({ id: opsOperatingWeeksTable.id });
            weekOldToNew[oldId] = inserted.id;
          }
        }
        counts.weeks = data.weeks.length;
      }

      const resolveWeekId = (oldId: number | null) =>
        oldId ? (weekOldToNew[oldId] ?? oldId) : null;
      const resolveCatId = (oldId: number | null) =>
        oldId ? (oldToNew[oldId] ?? oldId) : null;

      // ── Weekly plans ──────────────────────────────────────────────────
      if (Array.isArray(data.weeklyPlans) && data.weeklyPlans.length > 0) {
        for (const plan of data.weeklyPlans) {
          const { id: _id, createdAt: _c, updatedAt: _u, weekId, ...planData } = plan;
          const resolved = resolveWeekId(weekId);
          if (!resolved) continue;
          const [existing] = await db
            .select({ id: opsWeeklyPlansTable.id })
            .from(opsWeeklyPlansTable)
            .where(eq(opsWeeklyPlansTable.weekId, resolved))
            .limit(1);
          if (!existing) {
            await db.insert(opsWeeklyPlansTable).values({ ...planData, weekId: resolved });
          }
        }
        counts.weeklyPlans = data.weeklyPlans.length;
      }

      // ── Weekly reviews ─────────────────────────────────────────────────
      if (Array.isArray(data.weeklyReviews) && data.weeklyReviews.length > 0) {
        for (const review of data.weeklyReviews) {
          const { id: _id, createdAt: _c, updatedAt: _u, weekId, ...reviewData } = review;
          const resolved = resolveWeekId(weekId);
          if (!resolved) continue;
          await db.insert(opsWeeklyReviewsTable).values({ ...reviewData, weekId: resolved }).onConflictDoNothing();
        }
        counts.weeklyReviews = data.weeklyReviews.length;
      }

      // ── Transactions ──────────────────────────────────────────────────
      if (Array.isArray(data.transactions) && data.transactions.length > 0) {
        const txRows = data.transactions.map((t: any) => {
          const { id: _id, createdAt: _c, updatedAt: _u, weekId, categoryId, ...rest } = t;
          return { ...rest, weekId: resolveWeekId(weekId), categoryId: resolveCatId(categoryId) };
        });
        await db.insert(opsTransactionsTable).values(txRows).onConflictDoNothing();
        counts.transactions = txRows.length;
      }

      // ── Recurring expenses ─────────────────────────────────────────────
      if (Array.isArray(data.recurringExpenses) && data.recurringExpenses.length > 0) {
        const expRows = data.recurringExpenses.map((e: any) => {
          const { id: _id, createdAt: _c, updatedAt: _u, categoryId, ...rest } = e;
          return { ...rest, categoryId: resolveCatId(categoryId) };
        });
        await db.insert(opsRecurringExpensesTable).values(expRows).onConflictDoNothing();
        counts.recurringExpenses = expRows.length;
      }

      // ── Tasks ─────────────────────────────────────────────────────────
      if (Array.isArray(data.tasks) && data.tasks.length > 0) {
        const taskRows = data.tasks.map((t: any) => {
          const { id: _id, createdAt: _c, updatedAt: _u, weekId, ...rest } = t;
          return { ...rest, weekId: resolveWeekId(weekId) };
        });
        await db.insert(opsTasksTable).values(taskRows).onConflictDoNothing();
        counts.tasks = taskRows.length;
      }

      // ── Content items ─────────────────────────────────────────────────
      if (Array.isArray(data.content) && data.content.length > 0) {
        const contentRows = data.content.map((c: any) => {
          const { id: _id, createdAt: _c, updatedAt: _u, weekId, weekNumber: _wn, ...rest } = c;
          return { ...rest, weekId: resolveWeekId(weekId) };
        });
        await db.insert(opsContentItemsTable).values(contentRows).onConflictDoNothing();
        counts.content = contentRows.length;
      }

      // ── Field trips ──────────────────────────────────────────────────
      if (Array.isArray(data.fieldTrips) && data.fieldTrips.length > 0) {
        const ftRows = data.fieldTrips.map((f: any) => {
          const { id: _id, createdAt: _c, updatedAt: _u, weekId, ...rest } = f;
          return { ...rest, weekId: resolveWeekId(weekId) };
        });
        await db.insert(opsFieldTripsTable).values(ftRows).onConflictDoNothing();
        counts.fieldTrips = ftRows.length;
      }

      // ── Subscription metrics ──────────────────────────────────────────
      if (Array.isArray(data.subscriptionMetrics) && data.subscriptionMetrics.length > 0) {
        const smRows = data.subscriptionMetrics.map((s: any) => {
          const { id: _id, createdAt: _c, updatedAt: _u, weekId, ...rest } = s;
          return { ...rest, weekId: resolveWeekId(weekId) };
        });
        await db.insert(opsSubscriptionWeekMetricsTable).values(smRows).onConflictDoNothing();
        counts.subscriptionMetrics = smRows.length;
      }

      // ── Departments ───────────────────────────────────────────────────
      if (Array.isArray(data.departments) && data.departments.length > 0) {
        const deptRows = data.departments.map((d: any) => {
          const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = d;
          return rest;
        });
        await db.insert(opsDepartmentsTable).values(deptRows).onConflictDoNothing();
        counts.departments = deptRows.length;
      }
    }

    res.json({ success: true, imported: counts });
  } catch (err) {
    req.log.error({ err }, "Ops backup import failed");
    res.status(500).json({ error: "Import failed", detail: String(err) });
  }
});

export default router;
