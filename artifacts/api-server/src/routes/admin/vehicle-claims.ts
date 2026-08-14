/**
 * Admin — Vehicle Ownership Claims
 *
 * When a user submits option 3 ("Someone else is using my plate") from the
 * duplicate-plate flow in vehicle-setup, a row is inserted into vehicle_claims.
 * These endpoints let the admin team list and resolve those claims.
 */
import { Router } from "express";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { vehicleClaimsTable, sharedVehiclesTable } from "@workspace/db";
import { requireFeature } from "../../middleware/adminAuth.js";
import { logAudit } from "../../lib/audit.js";

const router = Router();

// ── GET /vehicle-claims ───────────────────────────────────────────────────────
// Returns all claims, newest first. Optionally filter by ?status=pending|reviewed|resolved
router.get("/vehicle-claims", requireFeature("reports"), async (req, res) => {
  const { status } = req.query as { status?: string };

  const rows = await db
    .select({
      id:               vehicleClaimsTable.id,
      status:           vehicleClaimsTable.status,
      claimNote:        vehicleClaimsTable.claimNote,
      claimantDeviceId: vehicleClaimsTable.claimantDeviceId,
      createdAt:        vehicleClaimsTable.createdAt,
      vehicleId:        vehicleClaimsTable.vehicleId,
      vehiclePlate:     sharedVehiclesTable.plateNumber,
      vehicleName:      sharedVehiclesTable.displayName,
      vehicleType:      sharedVehiclesTable.vehicleType,
      ownerDeviceId:    sharedVehiclesTable.ownerDeviceId,
    })
    .from(vehicleClaimsTable)
    .innerJoin(sharedVehiclesTable, eq(vehicleClaimsTable.vehicleId, sharedVehiclesTable.id))
    .where(status ? eq(vehicleClaimsTable.status, status) : undefined)
    .orderBy(desc(vehicleClaimsTable.createdAt));

  return res.json({ claims: rows });
});

// ── PATCH /vehicle-claims/:id ─────────────────────────────────────────────────
// Update a claim's status: "reviewed" | "resolved"
router.patch("/vehicle-claims/:id", requireFeature("reports"), async (req, res) => {
  const { id } = req.params as { id: string };
  const { status } = req.body as { status: string };

  const valid = ["pending", "reviewed", "resolved"];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${valid.join(", ")}` });
  }

  const [updated] = await db
    .update(vehicleClaimsTable)
    .set({ status })
    .where(eq(vehicleClaimsTable.id, id))
    .returning();

  if (!updated) {
    return res.status(404).json({ error: "Claim not found" });
  }

  await logAudit({
    actor: {
      id:   req.adminUser?.id   ?? "unknown",
      name: req.adminUser?.name ?? "Admin",
      role: req.adminUser?.role ?? "admin",
    },
    action:     `vehicle_claim.${status}`,
    targetType: "vehicle_claim",
    targetId:   id,
    details:    { vehicleId: updated.vehicleId, newStatus: status },
  });

  return res.json({ claim: updated });
});

export default router;
