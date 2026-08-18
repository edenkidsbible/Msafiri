import { Router } from "express";
import { db, opsSettingsTable, opsSubscriptionWeekMetricsTable, opsTasksTable, opsContentItemsTable, opsFieldTripsTable, opsTransactionsTable, opsRecurringExpensesTable, opsOperatingWeeksTable, opsWeeklyPlansTable } from "@workspace/db";
import { eq, and, asc, desc, gte, sql, lte, isNull } from "drizzle-orm";

const router = Router();

function getCurrentWeekNumber(firstFundingDate: string): number {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Nairobi" }));
  const first = new Date(firstFundingDate + "T00:00:00+03:00");
  const diffMs = now.getTime() - first.getTime();
  if (diffMs < 0) return 1;
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}

router.get("/dashboard/summary", async (req, res) => {
  try {
    const [settings] = await db.select().from(opsSettingsTable).limit(1);
    const firstFundingDate = settings?.firstFundingDate ?? "2026-08-14";
    const currentWeekNum = getCurrentWeekNumber(firstFundingDate);
    const subPrice = parseFloat(settings?.monthlySubscriptionPriceKes ?? "0");
    const baselineActive = settings?.baselineActivePaid ?? 0;
    const today = new Date().toISOString().split("T")[0];

    // Cash: sum of cleared transactions
    const cashRows = await db
      .select({ type: opsTransactionsTable.type, amount: sql<string>`COALESCE(SUM(${opsTransactionsTable.amountKes}), 0)::text` })
      .from(opsTransactionsTable)
      .where(and(eq(opsTransactionsTable.isDeleted, false), eq(opsTransactionsTable.cleared, true)))
      .groupBy(opsTransactionsTable.type);

    let operatingCash = 0;
    let reserveCash = 0;
    for (const row of cashRows) {
      const amt = parseFloat(row.amount);
      if (row.type === "income" || row.type === "refund_in") operatingCash += amt;
      else if (row.type === "expense" || row.type === "refund_out") operatingCash -= amt;
      else if (row.type === "reserve_transfer") { operatingCash -= amt; reserveCash += amt; }
    }

    // Active paid subscribers from latest metric
    const [latestMetric] = await db
      .select()
      .from(opsSubscriptionWeekMetricsTable)
      .orderBy(desc(opsSubscriptionWeekMetricsTable.id))
      .limit(1);
    const activePaid = latestMetric?.activePaidEnd ?? baselineActive;
    const mrr = activePaid * subPrice;

    // Overdue tasks
    const [overdueCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(opsTasksTable)
      .where(and(
        eq(opsTasksTable.isDeleted, false),
        sql`${opsTasksTable.dueDate} < ${today}`,
        sql`${opsTasksTable.status} NOT IN ('done', 'cancelled')`
      ));

    // Today tasks
    const todayTasks = await db.select().from(opsTasksTable)
      .where(and(
        eq(opsTasksTable.isDeleted, false),
        eq(opsTasksTable.dueDate, today),
        sql`${opsTasksTable.status} NOT IN ('done', 'cancelled')`
      ))
      .orderBy(asc(sql`CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`))
      .limit(5);

    // This week tasks — get current week ID
    const [currentWeek] = await db.select().from(opsOperatingWeeksTable).where(eq(opsOperatingWeeksTable.weekNumber, currentWeekNum));
    const thisWeekTasks = currentWeek
      ? await db.select().from(opsTasksTable)
          .where(and(eq(opsTasksTable.isDeleted, false), eq(opsTasksTable.weekId, currentWeek.id), sql`${opsTasksTable.status} NOT IN ('done', 'cancelled')`))
          .orderBy(asc(sql`CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`))
          .limit(10)
      : [];

    // Next content item
    const [nextContent] = await db.select().from(opsContentItemsTable)
      .where(and(
        eq(opsContentItemsTable.isDeleted, false),
        sql`${opsContentItemsTable.status} NOT IN ('posted', 'archive')`,
      ))
      .orderBy(asc(opsContentItemsTable.scheduledDate))
      .limit(1);

    // Next field trip
    const [nextTrip] = await db.select().from(opsFieldTripsTable)
      .where(and(eq(opsFieldTripsTable.isDeleted, false), eq(opsFieldTripsTable.status, "planned"), gte(opsFieldTripsTable.date, today)))
      .orderBy(asc(opsFieldTripsTable.date))
      .limit(1);

    // Next payment (recurring expense)
    const [nextPaymentExpense] = await db.select().from(opsRecurringExpensesTable)
      .where(and(eq(opsRecurringExpensesTable.isActive, true)))
      .orderBy(asc(opsRecurringExpensesTable.nextBillingDate))
      .limit(1);

    let nextPayment = null;
    if (nextPaymentExpense) {
      nextPayment = {
        name: nextPaymentExpense.name,
        amountKes: nextPaymentExpense.amountKes ?? nextPaymentExpense.amountUsd
          ? (parseFloat(nextPaymentExpense.amountUsd ?? "0") * parseFloat(settings?.exchangeRateKesPerUsd ?? "129.36")).toFixed(2)
          : "0.00",
        dueDate: nextPaymentExpense.nextBillingDate ?? today,
      };
    }

    // Business priority from current week plan
    let businessPriority = "Log this week's metrics and plan your priorities.";

    res.json({
      currentWeekNumber: currentWeekNum,
      businessPriority,
      operatingCashKes: operatingCash.toFixed(2),
      reserveCashKes: reserveCash.toFixed(2),
      activePaidSubscribers: activePaid,
      mrrKes: mrr.toFixed(2),
      overdueTaskCount: overdueCount?.count ?? 0,
      nextContentItem: nextContent ?? null,
      nextFieldTrip: nextTrip ?? null,
      nextPayment,
      todayTasks,
      thisWeekTasks,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get dashboard summary");
    res.status(500).json({ error: "Failed to get dashboard summary" });
  }
});

// ─── FOCUS BOARD ─────────────────────────────────────────────────────────────
// Returns everything the founder needs to see on the home command-centre.

router.get("/dashboard/focus", async (req, res) => {
  try {
    const [settings] = await db.select().from(opsSettingsTable).limit(1);
    const firstFundingDate = settings?.firstFundingDate ?? "2026-08-14";
    const currentWeekNum = getCurrentWeekNumber(firstFundingDate);
    const cashFloor = parseFloat(settings?.cashFloorKes ?? "2500");

    const naiNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Nairobi" }));
    const today = naiNow.toISOString().split("T")[0];
    const in7 = new Date(naiNow.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const priOrder = sql`CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;

    // Run all queries in parallel
    const [
      cashRows,
      [currentWeek],
      overdueTasks,
      todayTasks,
      upcomingTasks,
      upcomingTrips,
      contentDueSoon,
      contentSuggestions,
      [nextPaymentRow],
    ] = await Promise.all([
      db.select({ type: opsTransactionsTable.type, amount: sql<string>`COALESCE(SUM(${opsTransactionsTable.amountKes}), 0)::text` })
        .from(opsTransactionsTable)
        .where(and(eq(opsTransactionsTable.isDeleted, false), eq(opsTransactionsTable.cleared, true)))
        .groupBy(opsTransactionsTable.type),

      db.select().from(opsOperatingWeeksTable).where(eq(opsOperatingWeeksTable.weekNumber, currentWeekNum)),

      db.select().from(opsTasksTable)
        .where(and(eq(opsTasksTable.isDeleted, false), sql`${opsTasksTable.dueDate} < ${today}`, sql`${opsTasksTable.status} NOT IN ('done','cancelled')`))
        .orderBy(asc(priOrder), asc(opsTasksTable.dueDate))
        .limit(10),

      db.select().from(opsTasksTable)
        .where(and(eq(opsTasksTable.isDeleted, false), eq(opsTasksTable.dueDate, today), sql`${opsTasksTable.status} NOT IN ('done','cancelled')`))
        .orderBy(asc(priOrder))
        .limit(10),

      db.select().from(opsTasksTable)
        .where(and(eq(opsTasksTable.isDeleted, false), sql`${opsTasksTable.dueDate} > ${today}`, sql`${opsTasksTable.dueDate} <= ${in7}`, sql`${opsTasksTable.status} NOT IN ('done','cancelled')`))
        .orderBy(asc(opsTasksTable.dueDate), asc(priOrder))
        .limit(10),

      db.select().from(opsFieldTripsTable)
        .where(and(eq(opsFieldTripsTable.isDeleted, false), sql`${opsFieldTripsTable.date} >= ${today}`, sql`${opsFieldTripsTable.date} <= ${in7}`, sql`${opsFieldTripsTable.status} NOT IN ('cancelled')`))
        .orderBy(asc(opsFieldTripsTable.date))
        .limit(5),

      db.select().from(opsContentItemsTable)
        .where(and(eq(opsContentItemsTable.isDeleted, false), sql`${opsContentItemsTable.scheduledDate} >= ${today}`, sql`${opsContentItemsTable.scheduledDate} <= ${in7}`, sql`${opsContentItemsTable.status} NOT IN ('posted','archive')`))
        .orderBy(asc(opsContentItemsTable.scheduledDate))
        .limit(5),

      db.select({ id: opsContentItemsTable.id, title: opsContentItemsTable.title, pillar: opsContentItemsTable.pillar, angle: opsContentItemsTable.angle, hook: opsContentItemsTable.hook, isCore: opsContentItemsTable.isCore })
        .from(opsContentItemsTable)
        .where(and(
          eq(opsContentItemsTable.isDeleted, false),
          eq(opsContentItemsTable.status, "idea"),
          sql`${opsContentItemsTable.pillar} NOT LIKE 'Hook Bank%'`,
          sql`${opsContentItemsTable.pillar} NOT LIKE 'CTA Bank%'`,
          sql`${opsContentItemsTable.pillar} NOT LIKE 'Series Playbook%'`,
        ))
        .orderBy(asc(sql`CASE WHEN ${opsContentItemsTable.isCore} THEN 0 ELSE 1 END`), asc(opsContentItemsTable.id))
        .limit(3),

      db.select().from(opsRecurringExpensesTable)
        .where(and(eq(opsRecurringExpensesTable.isActive, true), sql`${opsRecurringExpensesTable.nextBillingDate} >= ${today}`))
        .orderBy(asc(opsRecurringExpensesTable.nextBillingDate))
        .limit(1),
    ]);

    // Cash balance
    let cashKes = 0;
    for (const row of cashRows) {
      const amt = parseFloat(row.amount);
      if (row.type === "income" || row.type === "refund_in") cashKes += amt;
      else if (row.type === "expense" || row.type === "refund_out") cashKes -= amt;
    }

    // Week plan (objective / theme)
    let weekPlan = null;
    if (currentWeek) {
      const [plan] = await db.select().from(opsWeeklyPlansTable).where(eq(opsWeeklyPlansTable.weekId, currentWeek.id));
      weekPlan = plan ?? null;
    }

    // High-priority week tasks with no due date (catch-all)
    const weekTasks = currentWeek
      ? await db.select().from(opsTasksTable)
          .where(and(
            eq(opsTasksTable.isDeleted, false),
            eq(opsTasksTable.weekId, currentWeek.id),
            isNull(opsTasksTable.dueDate),
            sql`${opsTasksTable.status} NOT IN ('done','cancelled')`,
            sql`${opsTasksTable.priority} IN ('critical','high')`,
          ))
          .orderBy(asc(priOrder))
          .limit(5)
      : [];

    let nextPayment = null;
    if (nextPaymentRow) {
      const kes = nextPaymentRow.amountKes
        ? parseFloat(nextPaymentRow.amountKes)
        : parseFloat(nextPaymentRow.amountUsd ?? "0") * parseFloat(settings?.exchangeRateKesPerUsd ?? "129.36");
      nextPayment = { name: nextPaymentRow.name, amountKes: kes.toFixed(2), dueDate: nextPaymentRow.nextBillingDate };
    }

    res.json({
      today,
      weekNumber: currentWeekNum,
      weekObjective: weekPlan?.mainObjective ?? null,
      weekOutcomes: weekPlan?.requiredOutcomes ?? [],
      cashKes: cashKes.toFixed(2),
      cashFloor: cashFloor.toFixed(2),
      cashLow: cashKes < cashFloor,
      overdueTasks,
      todayTasks,
      upcomingTasks,
      weekTasks,
      upcomingTrips,
      contentDueSoon,
      contentSuggestions,
      nextPayment,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get dashboard focus");
    res.status(500).json({ error: "Failed to get dashboard focus" });
  }
});

export default router;
