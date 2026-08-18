import { Router } from "express";
import { db, opsFieldTripsTable, opsRoadRecordsTable, opsSettingsTable, opsTransactionsTable, opsTransactionCategoriesTable, opsOperatingWeeksTable } from "@workspace/db";
import { eq, and, desc, asc, sql } from "drizzle-orm";

const router = Router();

// ─── FUEL CALCULATIONS ─────────────────────────────────────────────────────
function calcTripCosts(trip: typeof opsFieldTripsTable.$inferSelect, fuelPrice: number, efficiency: number) {
  const km = trip.actualKm ? parseFloat(trip.actualKm) : (trip.plannedKm ? parseFloat(trip.plannedKm) : 0);
  const litres = efficiency > 0 ? km / efficiency : 0;
  const fuelCost = litres * fuelPrice;
  const parking = parseFloat(trip.parkingKes ?? "0");
  const tolls = parseFloat(trip.tollsKes ?? "0");
  const contingency = parseFloat(trip.contingencyKes ?? "0");
  const actualFuel = trip.actualFuelSpendKes ? parseFloat(trip.actualFuelSpendKes) : fuelCost;
  const total = actualFuel + parking + tolls + contingency;

  const endOdom = trip.endOdometer ? parseFloat(trip.endOdometer) : null;
  const startOdom = trip.startOdometer ? parseFloat(trip.startOdometer) : null;
  const actualKm = (endOdom !== null && startOdom !== null) ? Math.max(0, endOdom - startOdom) : null;

  return {
    estimatedLitres: parseFloat(litres.toFixed(3)),
    estimatedFuelCostKes: fuelCost.toFixed(2),
    totalTripCostKes: total.toFixed(2),
    actualKm: actualKm !== null ? actualKm : (trip.actualKm ? parseFloat(trip.actualKm) : null),
  };
}

// ─── AUTO-TRANSACTION SYNC ────────────────────────────────────────────────

/** Derive the operatingWeek.id from a trip date string (YYYY-MM-DD). */
async function deriveWeekId(tripDate: string): Promise<number | null> {
  const [settings] = await db.select().from(opsSettingsTable).limit(1);
  const firstFundingDate = settings?.firstFundingDate ?? "2026-08-14";
  const first = new Date(firstFundingDate + "T00:00:00+03:00");
  const trip = new Date(tripDate + "T00:00:00+03:00");
  const diffMs = trip.getTime() - first.getTime();
  if (diffMs < 0) return null;
  const weekNum = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
  const [week] = await db.select({ id: opsOperatingWeeksTable.id })
    .from(opsOperatingWeeksTable).where(eq(opsOperatingWeeksTable.weekNumber, weekNum));
  return week?.id ?? null;
}

/** Find-or-create the "Field Operations" expense category. */
async function getFieldOpsCategoryId(): Promise<number | null> {
  const [existing] = await db.select({ id: opsTransactionCategoriesTable.id })
    .from(opsTransactionCategoriesTable)
    .where(eq(opsTransactionCategoriesTable.name, "Field Operations"));
  if (existing) return existing.id;
  const [created] = await db.insert(opsTransactionCategoriesTable).values({
    name: "Field Operations",
    type: "expense",
    description: "Fuel, tolls, parking and contingency for field trips",
    isSystem: true,
  }).returning({ id: opsTransactionCategoriesTable.id });
  return created?.id ?? null;
}

/**
 * After creating or updating a trip, upsert a linked expense transaction so
 * the cost shows up in the weekly money summary automatically.
 */
async function syncTripTransaction(
  trip: typeof opsFieldTripsTable.$inferSelect,
  fuelPrice: number,
  efficiency: number,
) {
  const costs = calcTripCosts(trip, fuelPrice, efficiency);
  const totalKes = parseFloat(costs.totalTripCostKes);

  // Resolve the operating week before any early-return so we can always clean
  // up stale linked transactions, even when cost drops to zero.
  const weekId = trip.weekId ?? (await deriveWeekId(trip.date));

  // No operating week for this date, or no cost to record — soft-delete ALL
  // active linked transactions so the cost never leaks into money totals.
  if (weekId === null || totalKes <= 0) {
    await db.update(opsTransactionsTable)
      .set({ isDeleted: true })
      .where(and(
        eq(opsTransactionsTable.linkedFieldTripId, trip.id),
        eq(opsTransactionsTable.isDeleted, false),
      ));
    return;
  }

  const categoryId = await getFieldOpsCategoryId();

  const txData = {
    date: trip.date,
    type: "expense" as const,
    amountKes: costs.totalTripCostKes,
    description: `Field Trip: ${trip.purpose}${trip.corridor ? ` (${trip.corridor})` : ""}`,
    cleared: trip.status === "completed",
    categoryId,
    weekId,
    linkedFieldTripId: trip.id,
    notes: [
      trip.plannedKm ? `${trip.plannedKm} km planned` : null,
      trip.actualFuelSpendKes ? `Fuel KES ${trip.actualFuelSpendKes}` : `Est. fuel KES ${costs.estimatedFuelCostKes}`,
      trip.parkingKes ? `Parking KES ${trip.parkingKes}` : null,
      trip.tollsKes ? `Tolls KES ${trip.tollsKes}` : null,
      trip.contingencyKes ? `Contingency KES ${trip.contingencyKes}` : null,
    ].filter(Boolean).join(" · ") || null,
  };

  // Upsert: update if a linked transaction already exists, else insert
  const [existing] = await db.select({ id: opsTransactionsTable.id })
    .from(opsTransactionsTable)
    .where(and(eq(opsTransactionsTable.linkedFieldTripId, trip.id), eq(opsTransactionsTable.isDeleted, false)));

  if (existing) {
    await db.update(opsTransactionsTable).set(txData).where(eq(opsTransactionsTable.id, existing.id));
  } else {
    await db.insert(opsTransactionsTable).values(txData);
  }
}

// ─── FIELD TRIPS ───────────────────────────────────────────────────────────
router.get("/field-trips", async (req, res) => {
  try {
    const limit = parseInt(String(req.query.limit ?? 50));
    const offset = parseInt(String(req.query.offset ?? 0));
    const status = req.query.status ? String(req.query.status) : undefined;

    const [settings] = await db.select().from(opsSettingsTable).limit(1);
    const fuelPrice = parseFloat(settings?.fuelPricePerLitreKes ?? "214");
    const efficiency = parseFloat(settings?.vehicleEfficiencyKmPerLitre ?? "12");

    const conditions = [eq(opsFieldTripsTable.isDeleted, false)];
    if (status) conditions.push(eq(opsFieldTripsTable.status, status));

    const trips = await db.select().from(opsFieldTripsTable)
      .where(and(...conditions))
      .orderBy(desc(opsFieldTripsTable.date))
      .limit(limit)
      .offset(offset);

    res.json(trips.map(t => ({ ...t, ...calcTripCosts(t, fuelPrice, efficiency) })));
  } catch (err) {
    req.log.error({ err }, "Failed to list field trips");
    res.status(500).json({ error: "Failed to list field trips" });
  }
});

router.post("/field-trips", async (req, res) => {
  try {
    const { date, purpose, corridor, status, plannedKm, startOdometer, endOdometer, parkingKes, tollsKes, contingencyKes, actualFuelSpendKes, requiredOutputs, assignedTo, notes } = req.body;
    if (!date || !purpose) return res.status(400).json({ error: "date and purpose are required" });

    // Derive weekId from date if not supplied
    const [settings0] = await db.select().from(opsSettingsTable).limit(1);
    const resolvedWeekId = req.body.weekId ?? await deriveWeekId(date);

    const [trip] = await db.insert(opsFieldTripsTable).values({
      date, purpose, corridor, status: status ?? "planned",
      weekId: resolvedWeekId,
      plannedKm: plannedKm?.toString(), startOdometer: startOdometer?.toString(), endOdometer: endOdometer?.toString(),
      parkingKes, tollsKes, contingencyKes, actualFuelSpendKes, requiredOutputs, assignedTo, notes,
      createdBy: (req as any).adminUser?.id,
    }).returning();

    const fuelPrice = parseFloat(settings0?.fuelPricePerLitreKes ?? "214");
    const efficiency = parseFloat(settings0?.vehicleEfficiencyKmPerLitre ?? "12");

    // Auto-create linked expense transaction
    await syncTripTransaction(trip, fuelPrice, efficiency);

    res.status(201).json({ ...trip, ...calcTripCosts(trip, fuelPrice, efficiency) });
  } catch (err) {
    req.log.error({ err }, "Failed to create field trip");
    res.status(500).json({ error: "Failed to create field trip" });
  }
});

router.get("/field-trips/:id", async (req, res) => {
  try {
    const [trip] = await db.select().from(opsFieldTripsTable).where(and(eq(opsFieldTripsTable.id, parseInt(req.params.id)), eq(opsFieldTripsTable.isDeleted, false)));
    if (!trip) return res.status(404).json({ error: "Field trip not found" });
    const [settings] = await db.select().from(opsSettingsTable).limit(1);
    const fuelPrice = parseFloat(settings?.fuelPricePerLitreKes ?? "214");
    const efficiency = parseFloat(settings?.vehicleEfficiencyKmPerLitre ?? "12");
    res.json({ ...trip, ...calcTripCosts(trip, fuelPrice, efficiency) });
  } catch (err) {
    req.log.error({ err }, "Failed to get field trip");
    res.status(500).json({ error: "Failed to get field trip" });
  }
});

router.patch("/field-trips/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const fields = ["date", "purpose", "corridor", "status", "plannedKm", "startOdometer", "endOdometer", "parkingKes", "tollsKes", "contingencyKes", "actualFuelSpendKes", "requiredOutputs", "assignedTo", "notes"];
    const update: Record<string, unknown> = {};
    for (const f of fields) if (req.body[f] !== undefined) update[f] = req.body[f];
    // Re-derive weekId if date changed and weekId not explicitly supplied
    if (update.date && !update.weekId) {
      update.weekId = await deriveWeekId(String(update.date));
    }

    const [trip] = await db.update(opsFieldTripsTable).set(update).where(and(eq(opsFieldTripsTable.id, id), eq(opsFieldTripsTable.isDeleted, false))).returning();
    if (!trip) return res.status(404).json({ error: "Field trip not found" });
    const [settings] = await db.select().from(opsSettingsTable).limit(1);
    const fuelPrice = parseFloat(settings?.fuelPricePerLitreKes ?? "214");
    const efficiency = parseFloat(settings?.vehicleEfficiencyKmPerLitre ?? "12");

    if (trip.status === "cancelled") {
      // Cancelled trips have zero real cost — soft-delete the linked transaction
      await db.update(opsTransactionsTable).set({ isDeleted: true })
        .where(and(eq(opsTransactionsTable.linkedFieldTripId, trip.id), eq(opsTransactionsTable.isDeleted, false)));
    } else {
      // Sync linked expense transaction with updated costs
      await syncTripTransaction(trip, fuelPrice, efficiency);
    }

    res.json({ ...trip, ...calcTripCosts(trip, fuelPrice, efficiency) });
  } catch (err) {
    req.log.error({ err }, "Failed to update field trip");
    res.status(500).json({ error: "Failed to update field trip" });
  }
});

router.delete("/field-trips/:id", async (req, res) => {
  try {
    const tripId = parseInt(req.params.id);
    await db.update(opsFieldTripsTable).set({ isDeleted: true }).where(eq(opsFieldTripsTable.id, tripId));
    // Soft-delete the linked expense transaction so it no longer inflates cash-out totals
    await db.update(opsTransactionsTable).set({ isDeleted: true })
      .where(and(eq(opsTransactionsTable.linkedFieldTripId, tripId), eq(opsTransactionsTable.isDeleted, false)));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete field trip");
    res.status(500).json({ error: "Failed to delete field trip" });
  }
});

// ─── ROAD RECORDS ──────────────────────────────────────────────────────────
router.get("/road-records", async (req, res) => {
  try {
    const limit = parseInt(String(req.query.limit ?? 50));
    const offset = parseInt(String(req.query.offset ?? 0));
    const status = req.query.status ? String(req.query.status) : undefined;
    const confidence = req.query.confidence ? String(req.query.confidence) : undefined;
    const county = req.query.county ? String(req.query.county) : undefined;

    const conditions = [eq(opsRoadRecordsTable.isDeleted, false)];
    if (status) conditions.push(eq(opsRoadRecordsTable.status, status));
    if (confidence) conditions.push(eq(opsRoadRecordsTable.confidence, confidence));
    if (county) conditions.push(eq(opsRoadRecordsTable.county, county));

    const records = await db.select().from(opsRoadRecordsTable)
      .where(and(...conditions))
      .orderBy(desc(opsRoadRecordsTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json(records);
  } catch (err) {
    req.log.error({ err }, "Failed to list road records");
    res.status(500).json({ error: "Failed to list road records" });
  }
});

router.post("/road-records", async (req, res) => {
  try {
    const { county, corridor, dataType, confidence, recordDate, landmark, direction, coordinates, speedLimitKph, sourceType, evidence, verifier, nextAction, status, linkedFieldTripId, notes } = req.body;
    if (!county || !corridor || !dataType || !confidence) {
      return res.status(400).json({ error: "county, corridor, dataType, confidence are required" });
    }
    // Validate: confidence A requires evidence and verifier
    if (confidence === "A" && (!evidence || !verifier)) {
      return res.status(400).json({ error: "Confidence A (Confirmed) requires both evidence and verifier" });
    }
    const [record] = await db.insert(opsRoadRecordsTable).values({
      county, corridor, dataType, confidence, recordDate, landmark, direction, coordinates,
      speedLimitKph, sourceType, evidence, verifier, nextAction, status: status ?? "needs_verification",
      linkedFieldTripId, notes, createdBy: (req as any).adminUser?.id,
    }).returning();
    res.status(201).json(record);
  } catch (err) {
    req.log.error({ err }, "Failed to create road record");
    res.status(500).json({ error: "Failed to create road record" });
  }
});

router.get("/road-records/:id", async (req, res) => {
  try {
    const [record] = await db.select().from(opsRoadRecordsTable).where(and(eq(opsRoadRecordsTable.id, parseInt(req.params.id)), eq(opsRoadRecordsTable.isDeleted, false)));
    if (!record) return res.status(404).json({ error: "Road record not found" });
    res.json(record);
  } catch (err) {
    req.log.error({ err }, "Failed to get road record");
    res.status(500).json({ error: "Failed to get road record" });
  }
});

router.patch("/road-records/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const fields = ["recordDate", "county", "corridor", "landmark", "direction", "dataType", "coordinates", "speedLimitKph", "confidence", "sourceType", "evidence", "verifier", "lastVerifiedDate", "nextAction", "status", "linkedFieldTripId", "notes"];
    const update: Record<string, unknown> = {};
    for (const f of fields) if (req.body[f] !== undefined) update[f] = req.body[f];
    // Validate confidence A requires evidence + verifier
    if (update.confidence === "A") {
      const [existing] = await db.select().from(opsRoadRecordsTable).where(eq(opsRoadRecordsTable.id, id));
      const evidence = (update.evidence ?? existing?.evidence) as string | null;
      const verifier = (update.verifier ?? existing?.verifier) as string | null;
      if (!evidence || !verifier) {
        return res.status(400).json({ error: "Confidence A (Confirmed) requires both evidence and verifier" });
      }
      update.lastVerifiedDate = new Date().toISOString().split("T")[0];
    }
    const [record] = await db.update(opsRoadRecordsTable).set(update).where(and(eq(opsRoadRecordsTable.id, id), eq(opsRoadRecordsTable.isDeleted, false))).returning();
    if (!record) return res.status(404).json({ error: "Road record not found" });
    res.json(record);
  } catch (err) {
    req.log.error({ err }, "Failed to update road record");
    res.status(500).json({ error: "Failed to update road record" });
  }
});

export default router;
