import { Router } from "express";
import { db, opsSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

async function ensureSettings() {
  const rows = await db.select().from(opsSettingsTable).limit(1);
  if (rows.length === 0) {
    const [row] = await db.insert(opsSettingsTable).values({}).returning();
    return row;
  }
  return rows[0];
}

router.get("/settings", async (req, res) => {
  try {
    const settings = await ensureSettings();
    res.json(settings);
  } catch (err) {
    req.log.error({ err }, "Failed to get settings");
    res.status(500).json({ error: "Failed to get settings" });
  }
});

router.patch("/settings", async (req, res) => {
  try {
    const settings = await ensureSettings();
    const {
      firstFundingDate,
      weeklyFundingAmountKes,
      exchangeRateKesPerUsd,
      fuelPricePerLitreKes,
      vehicleEfficiencyKmPerLitre,
      cashFloorKes,
      reserveTransferTargetKes,
      monthlySubscriptionPriceKes,
      replitMonthlyUsd,
      replitNextBillingDate,
      baselineActivePaid,
      baselineDownloads,
      currentMrrOverrideKes,
    } = req.body;

    const update: Record<string, unknown> = {};
    if (firstFundingDate !== undefined) update.firstFundingDate = firstFundingDate;
    if (weeklyFundingAmountKes !== undefined) update.weeklyFundingAmountKes = weeklyFundingAmountKes;
    if (exchangeRateKesPerUsd !== undefined) update.exchangeRateKesPerUsd = exchangeRateKesPerUsd;
    if (fuelPricePerLitreKes !== undefined) update.fuelPricePerLitreKes = fuelPricePerLitreKes;
    if (vehicleEfficiencyKmPerLitre !== undefined) update.vehicleEfficiencyKmPerLitre = vehicleEfficiencyKmPerLitre;
    if (cashFloorKes !== undefined) update.cashFloorKes = cashFloorKes;
    if (reserveTransferTargetKes !== undefined) update.reserveTransferTargetKes = reserveTransferTargetKes;
    if (monthlySubscriptionPriceKes !== undefined) update.monthlySubscriptionPriceKes = monthlySubscriptionPriceKes;
    if (replitMonthlyUsd !== undefined) update.replitMonthlyUsd = replitMonthlyUsd;
    if (replitNextBillingDate !== undefined) update.replitNextBillingDate = replitNextBillingDate;
    if (baselineActivePaid !== undefined) update.baselineActivePaid = baselineActivePaid;
    if (baselineDownloads !== undefined) update.baselineDownloads = baselineDownloads;
    if (currentMrrOverrideKes !== undefined) update.currentMrrOverrideKes = currentMrrOverrideKes;

    const [updated] = await db
      .update(opsSettingsTable)
      .set(update)
      .where(eq(opsSettingsTable.id, settings.id))
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update settings");
    res.status(500).json({ error: "Failed to update settings" });
  }
});

export default router;
