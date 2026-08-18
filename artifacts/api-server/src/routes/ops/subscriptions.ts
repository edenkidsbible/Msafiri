import { Router } from "express";
import { db, opsSubscriptionWeekMetricsTable, opsOperatingWeeksTable, opsSettingsTable } from "@workspace/db";
import { eq, desc, asc } from "drizzle-orm";

const router = Router();

function deriveMetrics(
  row: typeof opsSubscriptionWeekMetricsTable.$inferSelect,
  priorActivePaid: number,
  baselineActivePaid: number,
  subPrice: string
) {
  const activePaid = row.activePaidEnd;
  const price = parseFloat(subPrice ?? "0");
  const gross = parseFloat(row.grossSalesKes ?? "0");
  const fees = parseFloat(row.processorFeesKes ?? "0");
  const refunds = parseFloat(row.refundsKes ?? "0");
  const newPaid = row.newPaid ?? 0;
  const renewals = row.renewals ?? 0;
  const cancellations = row.cancellations ?? 0;
  const trials = row.trialsStarted ?? 0;
  const downloads = row.newDownloads ?? 0;

  const netAccrued = gross - fees - refunds;
  const mrr = activePaid * price;
  const trialToPaid = trials > 0 ? newPaid / trials : null;
  const downloadToPaid = downloads > 0 ? newPaid / downloads : null;
  const grossArppu = (newPaid + renewals) > 0 ? gross / (newPaid + renewals) : null;
  const prior = priorActivePaid > 0 ? priorActivePaid : baselineActivePaid;
  const churnRate = prior > 0 ? cancellations / prior : null;

  return {
    netAccruedRevenueKes: netAccrued.toFixed(2),
    mrrKes: mrr.toFixed(2),
    trialToPaidRate: trialToPaid,
    downloadToPaidRate: downloadToPaid,
    grossArppuKes: grossArppu !== null ? grossArppu.toFixed(2) : null,
    churnRate,
  };
}

router.get("/subscriptions", async (req, res) => {
  try {
    const [settings] = await db.select().from(opsSettingsTable).limit(1);
    const subPrice = settings?.monthlySubscriptionPriceKes ?? "0";
    const baselineActive = settings?.baselineActivePaid ?? 0;

    const metrics = await db
      .select({ m: opsSubscriptionWeekMetricsTable, w: opsOperatingWeeksTable })
      .from(opsSubscriptionWeekMetricsTable)
      .leftJoin(opsOperatingWeeksTable, eq(opsSubscriptionWeekMetricsTable.weekId, opsOperatingWeeksTable.id))
      .orderBy(asc(opsOperatingWeeksTable.weekNumber));

    let priorActivePaid = baselineActive;
    const result = metrics.map(({ m, w }) => {
      const derived = deriveMetrics(m, priorActivePaid, baselineActive, subPrice);
      priorActivePaid = m.activePaidEnd;
      return { ...m, weekNumber: w?.weekNumber ?? null, ...derived };
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to list subscription metrics");
    res.status(500).json({ error: "Failed to list subscription metrics" });
  }
});

router.post("/subscriptions", async (req, res) => {
  try {
    const { weekId, activePaidEnd, periodStartDate, newDownloads, trialsStarted, newPaid, renewals, cancellations, grossSalesKes, processorFeesKes, refundsKes, cashReceivedKes, notes } = req.body;
    if (!weekId || activePaidEnd === undefined) return res.status(400).json({ error: "weekId and activePaidEnd are required" });

    const [row] = await db.insert(opsSubscriptionWeekMetricsTable).values({
      weekId, activePaidEnd, periodStartDate, newDownloads, trialsStarted, newPaid, renewals,
      cancellations, grossSalesKes, processorFeesKes, refundsKes, cashReceivedKes, notes,
      createdBy: (req as any).adminUser?.id,
    }).returning();

    const [settings] = await db.select().from(opsSettingsTable).limit(1);
    const subPrice = settings?.monthlySubscriptionPriceKes ?? "0";
    const baselineActive = settings?.baselineActivePaid ?? 0;
    const derived = deriveMetrics(row, baselineActive, baselineActive, subPrice);

    res.status(201).json({ ...row, ...derived });
  } catch (err) {
    req.log.error({ err }, "Failed to create subscription metric");
    res.status(500).json({ error: "Failed to create subscription metric" });
  }
});

router.patch("/subscriptions/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const fields = ["newDownloads", "trialsStarted", "newPaid", "renewals", "cancellations", "activePaidEnd", "grossSalesKes", "processorFeesKes", "refundsKes", "cashReceivedKes", "notes"];
    const update: Record<string, unknown> = {};
    for (const f of fields) if (req.body[f] !== undefined) update[f] = req.body[f];
    const [row] = await db.update(opsSubscriptionWeekMetricsTable).set(update).where(eq(opsSubscriptionWeekMetricsTable.id, id)).returning();
    if (!row) return res.status(404).json({ error: "Not found" });

    const [settings] = await db.select().from(opsSettingsTable).limit(1);
    const subPrice = settings?.monthlySubscriptionPriceKes ?? "0";
    const baselineActive = settings?.baselineActivePaid ?? 0;
    const derived = deriveMetrics(row, baselineActive, baselineActive, subPrice);
    res.json({ ...row, ...derived });
  } catch (err) {
    req.log.error({ err }, "Failed to update subscription metric");
    res.status(500).json({ error: "Failed to update subscription metric" });
  }
});

router.get("/subscriptions/summary", async (req, res) => {
  try {
    const [settings] = await db.select().from(opsSettingsTable).limit(1);
    const subPrice = settings?.monthlySubscriptionPriceKes ?? "0";
    const baselineActive = settings?.baselineActivePaid ?? 0;
    const baselineDownloads = settings?.baselineDownloads ?? 0;

    const metrics = await db
      .select({ m: opsSubscriptionWeekMetricsTable, w: opsOperatingWeeksTable })
      .from(opsSubscriptionWeekMetricsTable)
      .leftJoin(opsOperatingWeeksTable, eq(opsSubscriptionWeekMetricsTable.weekId, opsOperatingWeeksTable.id))
      .orderBy(asc(opsOperatingWeeksTable.weekNumber));

    let currentActivePaid = baselineActive;
    let totalDownloads = baselineDownloads;
    let cumulativeGross = 0;
    let cumulativeCash = 0;
    let latestChurn = null as number | null;
    let latestTrial = null as number | null;
    let latestDownload = null as number | null;
    let priorActivePaid = baselineActive;

    const trend = metrics.map(({ m, w }) => {
      const derived = deriveMetrics(m, priorActivePaid, baselineActive, subPrice);
      priorActivePaid = m.activePaidEnd;
      currentActivePaid = m.activePaidEnd;
      totalDownloads += (m.newDownloads ?? 0);
      cumulativeGross += parseFloat(m.grossSalesKes ?? "0");
      cumulativeCash += parseFloat(m.cashReceivedKes ?? "0");
      latestChurn = derived.churnRate;
      latestTrial = derived.trialToPaidRate;
      latestDownload = derived.downloadToPaidRate;
      return { ...m, weekNumber: w?.weekNumber ?? null, ...derived };
    });

    const mrr = currentActivePaid * parseFloat(subPrice);

    res.json({
      currentActivePaid,
      currentMrrKes: settings?.currentMrrOverrideKes ?? mrr.toFixed(2),
      totalDownloads,
      latestChurnRate: latestChurn,
      latestTrialToPaid: latestTrial,
      latestDownloadToPaid: latestDownload,
      cumulativeGrossSalesKes: cumulativeGross.toFixed(2),
      cumulativeCashReceivedKes: cumulativeCash.toFixed(2),
      trend,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get subscription summary");
    res.status(500).json({ error: "Failed to get subscription summary" });
  }
});

export default router;
