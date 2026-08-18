import { Router } from "express";
import { db, opsOperatingWeeksTable, opsWeeklyPlansTable, opsWeeklyReviewsTable, opsSettingsTable, opsTransactionsTable } from "@workspace/db";
import { eq, asc, and, sql } from "drizzle-orm";

const router = Router();

// Calculate the current operating week number from first funding date
function getCurrentWeekNumber(firstFundingDate: string): number {
  // Africa/Nairobi is UTC+3
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Nairobi" }));
  const first = new Date(firstFundingDate + "T00:00:00+03:00");
  const diffMs = now.getTime() - first.getTime();
  if (diffMs < 0) return 1;
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}

// Ensure operating weeks exist up to currentWeek + 4
async function ensureWeeks(firstFundingDate: string) {
  const currentWeekNum = getCurrentWeekNumber(firstFundingDate);
  const maxWeek = Math.max(24, currentWeekNum + 4);

  const existing = await db.select().from(opsOperatingWeeksTable).orderBy(asc(opsOperatingWeeksTable.weekNumber));
  const existingNums = new Set(existing.map((w) => w.weekNumber));

  const toInsert = [];
  for (let wn = 1; wn <= maxWeek; wn++) {
    if (!existingNums.has(wn)) {
      const startMs = new Date(firstFundingDate + "T00:00:00+03:00").getTime() + (wn - 1) * 7 * 24 * 60 * 60 * 1000;
      const endMs = startMs + 6 * 24 * 60 * 60 * 1000;
      const startDate = new Date(startMs).toISOString().split("T")[0];
      const endDate = new Date(endMs).toISOString().split("T")[0];
      toInsert.push({ weekNumber: wn, startDate, endDate });
    }
  }
  if (toInsert.length > 0) {
    await db.insert(opsOperatingWeeksTable).values(toInsert).onConflictDoNothing();
  }
  return await db.select().from(opsOperatingWeeksTable).orderBy(asc(opsOperatingWeeksTable.weekNumber));
}

/**
 * Aggregate actual cash in and out from cleared transactions, grouped by weekId.
 * Returns a map of weekId → { actualIn, actualOut }.
 * Weeks absent from the map had zero cleared transaction activity.
 */
async function computeWeekActuals(): Promise<Map<number, { actualIn: number; actualOut: number }>> {
  const rows = await db
    .select({
      weekId: opsTransactionsTable.weekId,
      type: opsTransactionsTable.type,
      total: sql<string>`COALESCE(SUM(${opsTransactionsTable.amountKes}), 0)::text`,
    })
    .from(opsTransactionsTable)
    .where(and(eq(opsTransactionsTable.isDeleted, false), eq(opsTransactionsTable.cleared, true)))
    .groupBy(opsTransactionsTable.weekId, opsTransactionsTable.type);

  const map = new Map<number, { actualIn: number; actualOut: number }>();
  for (const row of rows) {
    if (row.weekId == null) continue;
    if (!map.has(row.weekId)) map.set(row.weekId, { actualIn: 0, actualOut: 0 });
    const entry = map.get(row.weekId)!;
    const amt = parseFloat(row.total);
    if (row.type === "income" || row.type === "refund_in") entry.actualIn += amt;
    else if (row.type === "expense" || row.type === "refund_out" || row.type === "reserve_transfer") entry.actualOut += amt;
  }
  return map;
}

router.get("/weeks", async (req, res) => {
  try {
    const [settings] = await db.select().from(opsSettingsTable).limit(1);
    const firstFundingDate = settings?.firstFundingDate ?? "2026-08-14";
    const currentWeekNum = getCurrentWeekNumber(firstFundingDate);
    const [weeks, actuals] = await Promise.all([ensureWeeks(firstFundingDate), computeWeekActuals()]);

    // Walk weeks in ascending order to build a running cumulative ending balance.
    // This matches the product cash model: ending(week N) = ending(week N-1) + in(N) - out(N).
    let runningEnding = 0;
    let hasAnyActivity = false;

    // weeks is already sorted ascending by weekNumber (ensureWeeks returns asc order)
    const result = weeks.map((w) => {
      // Use live-computed values as the sole source of truth; no fallback to stale stored actuals.
      const a = actuals.get(w.id);
      const actualIn = a?.actualIn ?? 0;
      const actualOut = a?.actualOut ?? 0;

      if (actualIn > 0 || actualOut > 0) hasAnyActivity = true;

      runningEnding = runningEnding + actualIn - actualOut;

      const plannedEnding = w.plannedEndingCashKes != null ? parseFloat(w.plannedEndingCashKes) : null;
      const variance = plannedEnding !== null ? runningEnding - plannedEnding : null;

      // Suppress actual columns for weeks before any financial activity has been recorded —
      // otherwise future empty weeks would show a 0 balance as if the business has no cash.
      const exposeActuals = hasAnyActivity;

      return {
        ...w,
        isCurrent: w.weekNumber === currentWeekNum,
        // Always overwrite stored actual columns with the live-computed values so they
        // reflect the latest transactions immediately after any mutation.
        actualCashInKes: exposeActuals ? actualIn.toFixed(2) : null,
        actualCashOutKes: exposeActuals ? actualOut.toFixed(2) : null,
        actualEndingCashKes: exposeActuals ? runningEnding.toFixed(2) : null,
        varianceKes: exposeActuals && variance !== null ? variance.toFixed(2) : null,
      };
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to list weeks");
    res.status(500).json({ error: "Failed to list weeks" });
  }
});

router.get("/weeks/current", async (req, res) => {
  try {
    const [settings] = await db.select().from(opsSettingsTable).limit(1);
    const firstFundingDate = settings?.firstFundingDate ?? "2026-08-14";
    const currentWeekNum = getCurrentWeekNumber(firstFundingDate);
    await ensureWeeks(firstFundingDate);
    const [week] = await db.select().from(opsOperatingWeeksTable).where(eq(opsOperatingWeeksTable.weekNumber, currentWeekNum));
    if (!week) return res.status(404).json({ error: "Week not found" });
    res.json({ ...week, isCurrent: true });
  } catch (err) {
    req.log.error({ err }, "Failed to get current week");
    res.status(500).json({ error: "Failed to get current week" });
  }
});

router.get("/weeks/:weekId", async (req, res) => {
  try {
    const [settings] = await db.select().from(opsSettingsTable).limit(1);
    const firstFundingDate = settings?.firstFundingDate ?? "2026-08-14";
    const currentWeekNum = getCurrentWeekNumber(firstFundingDate);
    const [week] = await db.select().from(opsOperatingWeeksTable).where(eq(opsOperatingWeeksTable.id, parseInt(req.params.weekId)));
    if (!week) return res.status(404).json({ error: "Week not found" });
    res.json({ ...week, isCurrent: week.weekNumber === currentWeekNum });
  } catch (err) {
    req.log.error({ err }, "Failed to get week");
    res.status(500).json({ error: "Failed to get week" });
  }
});

router.get("/weeks/:weekId/plan", async (req, res) => {
  try {
    const weekId = parseInt(req.params.weekId);
    const [week] = await db.select().from(opsOperatingWeeksTable).where(eq(opsOperatingWeeksTable.id, weekId));
    if (!week) return res.status(404).json({ error: "Week not found" });
    const [plan] = await db.select().from(opsWeeklyPlansTable).where(eq(opsWeeklyPlansTable.weekId, weekId));
    res.json(plan ?? { weekId, weekNumber: week.weekNumber, mainObjective: null, requiredOutcomes: [], completedOutcomes: [], cashDecision: null, productPriority: null, userPriority: null, fieldSprint: null, contentPlan: null, updatedAt: null });
  } catch (err) {
    req.log.error({ err }, "Failed to get weekly plan");
    res.status(500).json({ error: "Failed to get weekly plan" });
  }
});

router.put("/weeks/:weekId/plan", async (req, res) => {
  try {
    const weekId = parseInt(req.params.weekId);
    const [week] = await db.select().from(opsOperatingWeeksTable).where(eq(opsOperatingWeeksTable.id, weekId));
    if (!week) return res.status(404).json({ error: "Week not found" });

    const { mainObjective, requiredOutcomes, cashDecision, productPriority, userPriority, fieldSprint, contentPlan } = req.body;
    const existing = await db.select().from(opsWeeklyPlansTable).where(eq(opsWeeklyPlansTable.weekId, weekId));

    if (existing.length > 0) {
      const [updated] = await db.update(opsWeeklyPlansTable)
        .set({ mainObjective, requiredOutcomes, cashDecision, productPriority, userPriority, fieldSprint, contentPlan })
        .where(eq(opsWeeklyPlansTable.weekId, weekId))
        .returning();
      return res.json({ ...updated, weekNumber: week.weekNumber });
    } else {
      const [created] = await db.insert(opsWeeklyPlansTable)
        .values({ weekId, mainObjective, requiredOutcomes, cashDecision, productPriority, userPriority, fieldSprint, contentPlan, completedOutcomes: [] })
        .returning();
      return res.json({ ...created, weekNumber: week.weekNumber });
    }
  } catch (err) {
    req.log.error({ err }, "Failed to upsert weekly plan");
    res.status(500).json({ error: "Failed to upsert weekly plan" });
  }
});

// ── Update week-level planned budget figures ──────────────────────────────────
router.patch("/weeks/:weekId", async (req, res) => {
  try {
    const weekId = parseInt(req.params.weekId);
    const [week] = await db.select().from(opsOperatingWeeksTable).where(eq(opsOperatingWeeksTable.id, weekId));
    if (!week) return res.status(404).json({ error: "Week not found" });

    const { plannedCashInKes, plannedCashOutKes, plannedEndingCashKes } = req.body;
    const [updated] = await db
      .update(opsOperatingWeeksTable)
      .set({
        ...(plannedCashInKes !== undefined && { plannedCashInKes: String(plannedCashInKes) }),
        ...(plannedCashOutKes !== undefined && { plannedCashOutKes: String(plannedCashOutKes) }),
        ...(plannedEndingCashKes !== undefined && { plannedEndingCashKes: String(plannedEndingCashKes) }),
        updatedAt: new Date(),
      })
      .where(eq(opsOperatingWeeksTable.id, weekId))
      .returning();
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update week budget");
    res.status(500).json({ error: "Failed to update week budget" });
  }
});

// ── Toggle completed outcomes (lightweight, no full plan re-save) ─────────────
router.patch("/weeks/:weekId/plan/outcomes-done", async (req, res) => {
  try {
    const weekId = parseInt(req.params.weekId);
    const { completedOutcomes } = req.body;
    if (!Array.isArray(completedOutcomes)) {
      return res.status(400).json({ error: "completedOutcomes must be an array" });
    }
    const existing = await db.select({ id: opsWeeklyPlansTable.id }).from(opsWeeklyPlansTable).where(eq(opsWeeklyPlansTable.weekId, weekId));
    if (existing.length > 0) {
      await db.update(opsWeeklyPlansTable).set({ completedOutcomes, updatedBy: (req as any).adminUser?.id }).where(eq(opsWeeklyPlansTable.weekId, weekId));
    } else {
      await db.insert(opsWeeklyPlansTable).values({ weekId, completedOutcomes });
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update completed outcomes");
    res.status(500).json({ error: "Failed to update completed outcomes" });
  }
});

router.get("/weeks/:weekId/review", async (req, res) => {
  try {
    const weekId = parseInt(req.params.weekId);
    const [week] = await db.select().from(opsOperatingWeeksTable).where(eq(opsOperatingWeeksTable.id, weekId));
    if (!week) return res.status(404).json({ error: "Week not found" });
    const [review] = await db.select().from(opsWeeklyReviewsTable).where(eq(opsWeeklyReviewsTable.weekId, weekId));
    res.json(review ?? { weekId, weekNumber: week.weekNumber, whatWorked: null, whatDidntWork: null, keyLearning: null, nextWeekFocus: null, reviewedAt: null });
  } catch (err) {
    req.log.error({ err }, "Failed to get weekly review");
    res.status(500).json({ error: "Failed to get weekly review" });
  }
});

router.put("/weeks/:weekId/review", async (req, res) => {
  try {
    const weekId = parseInt(req.params.weekId);
    const [week] = await db.select().from(opsOperatingWeeksTable).where(eq(opsOperatingWeeksTable.id, weekId));
    if (!week) return res.status(404).json({ error: "Week not found" });

    const { whatWorked, whatDidntWork, keyLearning, nextWeekFocus } = req.body;
    const existing = await db.select().from(opsWeeklyReviewsTable).where(eq(opsWeeklyReviewsTable.weekId, weekId));

    if (existing.length > 0) {
      const [updated] = await db.update(opsWeeklyReviewsTable)
        .set({ whatWorked, whatDidntWork, keyLearning, nextWeekFocus, reviewedAt: new Date() })
        .where(eq(opsWeeklyReviewsTable.weekId, weekId))
        .returning();
      return res.json({ ...updated, weekNumber: week.weekNumber });
    } else {
      const [created] = await db.insert(opsWeeklyReviewsTable)
        .values({ weekId, whatWorked, whatDidntWork, keyLearning, nextWeekFocus, reviewedAt: new Date() })
        .returning();
      return res.json({ ...created, weekNumber: week.weekNumber });
    }
  } catch (err) {
    req.log.error({ err }, "Failed to upsert weekly review");
    res.status(500).json({ error: "Failed to upsert weekly review" });
  }
});

export default router;
export { ensureWeeks, getCurrentWeekNumber };
