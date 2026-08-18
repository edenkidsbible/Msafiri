import { Router } from "express";
import { db, opsTransactionsTable, opsTransactionCategoriesTable, opsRecurringExpensesTable, opsSettingsTable, opsOperatingWeeksTable } from "@workspace/db";
import { eq, and, desc, asc, isNull, isNotNull, or, sql, lte, gte } from "drizzle-orm";

/** Return the operating week id whose date range contains the given date string (YYYY-MM-DD), or null if none match. */
async function resolveWeekId(date: string): Promise<number | null> {
  const [week] = await db
    .select({ id: opsOperatingWeeksTable.id })
    .from(opsOperatingWeeksTable)
    .where(and(lte(opsOperatingWeeksTable.startDate, date), gte(opsOperatingWeeksTable.endDate, date)))
    .limit(1);
  return week?.id ?? null;
}

const router = Router();

// ─── CATEGORIES ────────────────────────────────────────────────────────────

router.get("/categories", async (req, res) => {
  try {
    const cats = await db.select().from(opsTransactionCategoriesTable).orderBy(asc(opsTransactionCategoriesTable.name));
    res.json(cats);
  } catch (err) {
    req.log.error({ err }, "Failed to list categories");
    res.status(500).json({ error: "Failed to list categories" });
  }
});

router.post("/categories", async (req, res) => {
  try {
    const { name, type, description } = req.body;
    if (!name || !type) return res.status(400).json({ error: "name and type are required" });
    const [cat] = await db.insert(opsTransactionCategoriesTable).values({ name, type, description }).returning();
    res.status(201).json(cat);
  } catch (err) {
    req.log.error({ err }, "Failed to create category");
    res.status(500).json({ error: "Failed to create category" });
  }
});

// ─── TRANSACTIONS ──────────────────────────────────────────────────────────

router.get("/transactions", async (req, res) => {
  try {
    const limit = parseInt(String(req.query.limit ?? 50));
    const offset = parseInt(String(req.query.offset ?? 0));
    const weekId = req.query.weekId ? parseInt(String(req.query.weekId)) : undefined;
    const type = req.query.type ? String(req.query.type) : undefined;

    const conditions = [eq(opsTransactionsTable.isDeleted, false)];
    if (weekId) conditions.push(eq(opsTransactionsTable.weekId, weekId));
    if (type) conditions.push(eq(opsTransactionsTable.type, type));

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(opsTransactionsTable)
      .where(and(...conditions));

    const items = await db
      .select({
        id: opsTransactionsTable.id,
        date: opsTransactionsTable.date,
        type: opsTransactionsTable.type,
        amountKes: opsTransactionsTable.amountKes,
        description: opsTransactionsTable.description,
        cleared: opsTransactionsTable.cleared,
        categoryId: opsTransactionsTable.categoryId,
        categoryName: opsTransactionCategoriesTable.name,
        weekId: opsTransactionsTable.weekId,
        paymentMethod: opsTransactionsTable.paymentMethod,
        reference: opsTransactionsTable.reference,
        notes: opsTransactionsTable.notes,
        linkedFieldTripId: opsTransactionsTable.linkedFieldTripId,
        linkedContentId: opsTransactionsTable.linkedContentId,
        createdAt: opsTransactionsTable.createdAt,
      })
      .from(opsTransactionsTable)
      .leftJoin(opsTransactionCategoriesTable, eq(opsTransactionsTable.categoryId, opsTransactionCategoriesTable.id))
      .where(and(...conditions))
      .orderBy(desc(opsTransactionsTable.date), desc(opsTransactionsTable.createdAt))
      .limit(limit)
      .offset(offset);

    // Enrich with weekNumber
    const weekIds = [...new Set(items.map(i => i.weekId).filter(Boolean))];
    const weeks = weekIds.length > 0
      ? await db.select({ id: opsOperatingWeeksTable.id, weekNumber: opsOperatingWeeksTable.weekNumber }).from(opsOperatingWeeksTable)
      : [];
    const weekMap = new Map(weeks.map(w => [w.id, w.weekNumber]));

    res.json({
      items: items.map(i => ({ ...i, weekNumber: i.weekId ? (weekMap.get(i.weekId) ?? null) : null })),
      total: countResult?.count ?? 0,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list transactions");
    res.status(500).json({ error: "Failed to list transactions" });
  }
});

router.post("/transactions", async (req, res) => {
  try {
    const { date, type, amountKes, description, categoryId, cleared, paymentMethod, reference, notes, linkedFieldTripId, linkedContentId } = req.body;
    if (!date || !type || !amountKes || !description) {
      return res.status(400).json({ error: "date, type, amountKes, description are required" });
    }
    const weekId = await resolveWeekId(date);
    const [tx] = await db.insert(opsTransactionsTable).values({
      date, type, amountKes, description, categoryId, cleared: cleared ?? false,
      paymentMethod, reference, notes, linkedFieldTripId, linkedContentId,
      weekId: weekId ?? undefined,
      createdBy: (req as any).adminUser?.id,
    }).returning();
    res.status(201).json(tx);
  } catch (err) {
    req.log.error({ err }, "Failed to create transaction");
    res.status(500).json({ error: "Failed to create transaction" });
  }
});

router.get("/transactions/summary", async (req, res) => {
  try {
    const [settings] = await db.select().from(opsSettingsTable).limit(1);

    // Get total operating cash (sum of income + refund_in - expense - refund_out) and reserve
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

    // Get all weeks from Week 1 in ascending order
    const allWeeks = await db.select().from(opsOperatingWeeksTable)
      .orderBy(asc(opsOperatingWeeksTable.weekNumber));

    res.json({
      operatingCashKes: operatingCash.toFixed(2),
      reserveCashKes: reserveCash.toFixed(2),
      runwayWeeks: null,
      weeks: allWeeks.map(w => ({
        weekId: w.id,
        weekNumber: w.weekNumber,
        startDate: w.startDate,
        plannedInKes: w.plannedCashInKes,
        plannedOutKes: w.plannedCashOutKes,
        plannedEndingKes: w.plannedEndingCashKes,
        actualInKes: w.actualCashInKes,
        actualOutKes: w.actualCashOutKes,
        actualEndingKes: w.actualEndingCashKes,
        varianceKes: w.varianceKes,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get transaction summary");
    res.status(500).json({ error: "Failed to get transaction summary" });
  }
});

// ── Cash position: balances by account + revenue by source + expenses by category ──
router.get("/transactions/cash-position", async (_req, res) => {
  try {
    const cleared = and(eq(opsTransactionsTable.isDeleted, false), eq(opsTransactionsTable.cleared, true));

    // Balance per payment method (income adds, expenses subtract)
    const accountRows = await db
      .select({
        account: opsTransactionsTable.paymentMethod,
        type: opsTransactionsTable.type,
        total: sql<string>`COALESCE(SUM(${opsTransactionsTable.amountKes}), 0)::text`,
      })
      .from(opsTransactionsTable)
      .where(and(cleared, isNotNull(opsTransactionsTable.paymentMethod)))
      .groupBy(opsTransactionsTable.paymentMethod, opsTransactionsTable.type);

    const accountMap: Record<string, number> = {};
    for (const row of accountRows) {
      const acc = row.account!;
      const amt = parseFloat(row.total);
      if (!(acc in accountMap)) accountMap[acc] = 0;
      if (row.type === "income" || row.type === "refund_in") accountMap[acc] += amt;
      else if (row.type === "expense" || row.type === "refund_out") accountMap[acc] -= amt;
      // reserve_transfer kept separate
    }

    // Income grouped by category
    const incomeRows = await db
      .select({
        category: opsTransactionCategoriesTable.name,
        total: sql<string>`COALESCE(SUM(${opsTransactionsTable.amountKes}), 0)::text`,
      })
      .from(opsTransactionsTable)
      .leftJoin(opsTransactionCategoriesTable, eq(opsTransactionsTable.categoryId, opsTransactionCategoriesTable.id))
      .where(and(cleared, or(eq(opsTransactionsTable.type, "income"), eq(opsTransactionsTable.type, "refund_in"))))
      .groupBy(opsTransactionCategoriesTable.name)
      .orderBy(desc(sql<number>`SUM(${opsTransactionsTable.amountKes})`));

    // Expenses grouped by category
    const expenseRows = await db
      .select({
        category: opsTransactionCategoriesTable.name,
        total: sql<string>`COALESCE(SUM(${opsTransactionsTable.amountKes}), 0)::text`,
      })
      .from(opsTransactionsTable)
      .leftJoin(opsTransactionCategoriesTable, eq(opsTransactionsTable.categoryId, opsTransactionCategoriesTable.id))
      .where(and(cleared, or(eq(opsTransactionsTable.type, "expense"), eq(opsTransactionsTable.type, "refund_out"))))
      .groupBy(opsTransactionCategoriesTable.name)
      .orderBy(desc(sql<number>`SUM(${opsTransactionsTable.amountKes})`));

    res.json({
      byAccount: Object.entries(accountMap)
        .map(([account, balance]) => ({ account, balanceKes: balance.toFixed(2) }))
        .sort((a, b) => parseFloat(b.balanceKes) - parseFloat(a.balanceKes)),
      byIncomeSource: incomeRows.map(r => ({
        category: r.category ?? "Uncategorised",
        totalKes: r.total,
      })),
      byExpenseCategory: expenseRows.map(r => ({
        category: r.category ?? "Uncategorised",
        totalKes: r.total,
      })),
    });
  } catch (err) {
    _req.log.error({ err }, "Failed to get cash position");
    res.status(500).json({ error: "Failed to get cash position" });
  }
});

router.get("/transactions/:id", async (req, res) => {
  try {
    const [tx] = await db.select().from(opsTransactionsTable).where(and(eq(opsTransactionsTable.id, parseInt(req.params.id)), eq(opsTransactionsTable.isDeleted, false)));
    if (!tx) return res.status(404).json({ error: "Transaction not found" });
    res.json(tx);
  } catch (err) {
    req.log.error({ err }, "Failed to get transaction");
    res.status(500).json({ error: "Failed to get transaction" });
  }
});

router.patch("/transactions/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { date, type, amountKes, description, categoryId, cleared, paymentMethod, reference, notes } = req.body;
    const update: Record<string, unknown> = {};
    if (date !== undefined) {
      update.date = date;
      // Re-derive weekId whenever the date changes
      const weekId = await resolveWeekId(date);
      update.weekId = weekId ?? null;
    }
    if (type !== undefined) update.type = type;
    if (amountKes !== undefined) update.amountKes = amountKes;
    if (description !== undefined) update.description = description;
    if (categoryId !== undefined) update.categoryId = categoryId;
    if (cleared !== undefined) update.cleared = cleared;
    if (paymentMethod !== undefined) update.paymentMethod = paymentMethod;
    if (reference !== undefined) update.reference = reference;
    if (notes !== undefined) update.notes = notes;
    update.updatedBy = (req as any).adminUser?.id;

    const [tx] = await db.update(opsTransactionsTable).set(update).where(and(eq(opsTransactionsTable.id, id), eq(opsTransactionsTable.isDeleted, false))).returning();
    if (!tx) return res.status(404).json({ error: "Transaction not found" });
    res.json(tx);
  } catch (err) {
    req.log.error({ err }, "Failed to update transaction");
    res.status(500).json({ error: "Failed to update transaction" });
  }
});

router.delete("/transactions/:id", async (req, res) => {
  try {
    await db.update(opsTransactionsTable).set({ isDeleted: true, updatedBy: (req as any).adminUser?.id }).where(eq(opsTransactionsTable.id, parseInt(req.params.id)));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete transaction");
    res.status(500).json({ error: "Failed to delete transaction" });
  }
});

// ─── RECURRING EXPENSES ────────────────────────────────────────────────────

router.get("/recurring", async (req, res) => {
  try {
    const items = await db.select({
      id: opsRecurringExpensesTable.id,
      name: opsRecurringExpensesTable.name,
      amountKes: opsRecurringExpensesTable.amountKes,
      currencyType: opsRecurringExpensesTable.currencyType,
      amountUsd: opsRecurringExpensesTable.amountUsd,
      frequency: opsRecurringExpensesTable.frequency,
      categoryId: opsRecurringExpensesTable.categoryId,
      categoryName: opsTransactionCategoriesTable.name,
      nextBillingDate: opsRecurringExpensesTable.nextBillingDate,
      isActive: opsRecurringExpensesTable.isActive,
      notes: opsRecurringExpensesTable.notes,
    }).from(opsRecurringExpensesTable)
      .leftJoin(opsTransactionCategoriesTable, eq(opsRecurringExpensesTable.categoryId, opsTransactionCategoriesTable.id))
      .orderBy(asc(opsRecurringExpensesTable.name));
    res.json(items);
  } catch (err) {
    req.log.error({ err }, "Failed to list recurring expenses");
    res.status(500).json({ error: "Failed to list recurring expenses" });
  }
});

router.post("/recurring", async (req, res) => {
  try {
    const { name, amountKes, currencyType, amountUsd, frequency, categoryId, nextBillingDate, notes } = req.body;
    if (!name || !frequency || !currencyType) return res.status(400).json({ error: "name, frequency, currencyType are required" });
    const [item] = await db.insert(opsRecurringExpensesTable).values({ name, amountKes, currencyType, amountUsd, frequency, categoryId, nextBillingDate, notes }).returning();
    res.status(201).json(item);
  } catch (err) {
    req.log.error({ err }, "Failed to create recurring expense");
    res.status(500).json({ error: "Failed to create recurring expense" });
  }
});

router.patch("/recurring/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const update: Record<string, unknown> = {};
    const fields = ["name", "amountKes", "currencyType", "amountUsd", "frequency", "categoryId", "nextBillingDate", "isActive", "notes"];
    for (const f of fields) if (req.body[f] !== undefined) update[f] = req.body[f];
    const [item] = await db.update(opsRecurringExpensesTable).set(update).where(eq(opsRecurringExpensesTable.id, id)).returning();
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (err) {
    req.log.error({ err }, "Failed to update recurring expense");
    res.status(500).json({ error: "Failed to update recurring expense" });
  }
});

router.delete("/recurring/:id", async (req, res) => {
  try {
    await db.delete(opsRecurringExpensesTable).where(eq(opsRecurringExpensesTable.id, parseInt(req.params.id)));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete recurring expense");
    res.status(500).json({ error: "Failed to delete recurring expense" });
  }
});

export default router;
