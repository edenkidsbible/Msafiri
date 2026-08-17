/**
 * Admin — Vehicle Ownership Claims
 *
 * When a user submits option 3 ("Someone else is using my plate") from the
 * duplicate-plate flow in vehicle-setup, a row is inserted into vehicle_claims.
 * These endpoints let the admin team list, investigate, and resolve those claims,
 * including transferring ownership to the rightful owner or deleting the vehicle.
 */
import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { vehicleClaimsTable, sharedVehiclesTable, vehicleMembersTable } from "@workspace/db";
import { requireFeature } from "../../middleware/adminAuth.js";
import { logAudit, createNotification } from "../../lib/audit.js";

const router = Router();

// ── GET /vehicle-claims ───────────────────────────────────────────────────────
// Returns all claims, newest first. Optionally filter by ?status=pending|reviewed|resolved
router.get("/vehicle-claims", requireFeature("reports"), async (req, res) => {
  const { status } = req.query as { status?: string };

  const query = db
    .select({
      id:               vehicleClaimsTable.id,
      status:           vehicleClaimsTable.status,
      claimNote:        vehicleClaimsTable.claimNote,
      adminNote:        vehicleClaimsTable.adminNote,
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
    .orderBy(desc(vehicleClaimsTable.createdAt));

  const rows = status
    ? await query.where(eq(vehicleClaimsTable.status, status))
    : await query;

  return res.json({ claims: rows });
});

// ── PATCH /vehicle-claims/:id ─────────────────────────────────────────────────
// Update status and/or admin investigation notes on a claim.
router.patch("/vehicle-claims/:id", requireFeature("reports"), async (req, res) => {
  const { id } = req.params as { id: string };
  const { status, adminNote } = req.body as { status?: string; adminNote?: string };

  const validStatuses = ["pending", "reviewed", "resolved"];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });
  }

  const patch: Record<string, unknown> = {};
  if (status    !== undefined) patch.status    = status;
  if (adminNote !== undefined) patch.adminNote = adminNote;
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: "Provide at least one of: status, adminNote" });
  }

  const [updated] = await db
    .update(vehicleClaimsTable)
    .set(patch)
    .where(eq(vehicleClaimsTable.id, id))
    .returning();

  if (!updated) return res.status(404).json({ error: "Claim not found" });

  if (status) {
    await logAudit({
      actor:      { id: req.adminUser?.id ?? "unknown", name: req.adminUser?.name ?? "Admin", role: req.adminUser?.role ?? "admin" },
      action:     `vehicle_claim.${status}`,
      targetType: "vehicle_claim",
      targetId:   id,
      details:    { vehicleId: updated.vehicleId, newStatus: status },
    });
  }

  return res.json({ claim: updated });
});

// ── POST /vehicle-claims/:id/transfer-owner ───────────────────────────────────
// Reassigns the vehicle to the claimant:
//   1. Updates shared_vehicles.owner_device_id to the claimant's device.
//   2. Flips the old owner's vehicle_members row to role "driver" (or removes it).
//   3. Upserts a vehicle_members row for the claimant with role "owner".
//   4. Marks the claim as "resolved" with an auto admin note.
router.post("/vehicle-claims/:id/transfer-owner", requireFeature("reports"), async (req, res) => {
  const { id } = req.params as { id: string };

  // Fetch the claim
  const [claim] = await db
    .select()
    .from(vehicleClaimsTable)
    .where(eq(vehicleClaimsTable.id, id));

  if (!claim) return res.status(404).json({ error: "Claim not found" });

  const { vehicleId, claimantDeviceId } = claim;

  // Fetch vehicle to get current owner
  const [vehicle] = await db
    .select()
    .from(sharedVehiclesTable)
    .where(eq(sharedVehiclesTable.id, vehicleId));

  if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });

  const previousOwnerDeviceId = vehicle.ownerDeviceId;

  await db.transaction(async (tx) => {
    // 1. Reassign vehicle owner
    await tx
      .update(sharedVehiclesTable)
      .set({ ownerDeviceId: claimantDeviceId, updatedAt: new Date() })
      .where(eq(sharedVehiclesTable.id, vehicleId));

    // 2. Demote previous owner's member row to "driver" (keeps their membership but strips ownership)
    await tx
      .update(vehicleMembersTable)
      .set({ role: "driver" })
      .where(
        eq(vehicleMembersTable.vehicleId, vehicleId),
      );
    // Specifically set previous owner row
    await tx
      .update(vehicleMembersTable)
      .set({ role: "driver" })
      .where(eq(vehicleMembersTable.memberDeviceId, previousOwnerDeviceId));

    // 3. Upsert the claimant as owner in vehicle_members
    //    If they already have a row, promote to owner; otherwise insert.
    const [existing] = await tx
      .select({ id: vehicleMembersTable.id })
      .from(vehicleMembersTable)
      .where(eq(vehicleMembersTable.memberDeviceId, claimantDeviceId));

    if (existing) {
      await tx
        .update(vehicleMembersTable)
        .set({ role: "owner", status: "active" })
        .where(eq(vehicleMembersTable.id, existing.id));
    } else {
      await tx.insert(vehicleMembersTable).values({
        vehicleId,
        memberDeviceId: claimantDeviceId,
        role:           "owner",
        status:         "active",
      });
    }

    // 4. Resolve the claim with an explanatory admin note
    await tx
      .update(vehicleClaimsTable)
      .set({
        status:    "resolved",
        adminNote: `Ownership transferred to claimant (${claimantDeviceId.slice(0, 12)}…) by ${req.adminUser?.name ?? "admin"} on ${new Date().toISOString().slice(0, 10)}.`,
      })
      .where(eq(vehicleClaimsTable.id, id));
  });

  await logAudit({
    actor:      { id: req.adminUser?.id ?? "unknown", name: req.adminUser?.name ?? "Admin", role: req.adminUser?.role ?? "admin" },
    action:     "vehicle.ownership_transferred",
    targetType: "shared_vehicle",
    targetId:   vehicleId,
    details:    { claimId: id, fromDevice: previousOwnerDeviceId, toDevice: claimantDeviceId },
  });

  await createNotification({
    title:   "Vehicle ownership transferred",
    message: `${vehicle.displayName} (${vehicle.plateNumber ?? "no plate"}) was reassigned from ${previousOwnerDeviceId.slice(0, 12)}… to ${claimantDeviceId.slice(0, 12)}…`,
    type:    "success",
  });

  return res.json({ success: true, vehicleId, newOwnerDeviceId: claimantDeviceId });
});

// ── DELETE /vehicles/:vehicleId ──────────────────────────────────────────────
// Hard-deletes a vehicle directly by its ID (no claim required).
// Useful for one-off admin cleanup when no ownership claim exists.
router.delete("/vehicles/:vehicleId", requireFeature("reports"), async (req, res) => {
  const { vehicleId } = req.params as { vehicleId: string };

  const [vehicle] = await db
    .select({ displayName: sharedVehiclesTable.displayName, plateNumber: sharedVehiclesTable.plateNumber })
    .from(sharedVehiclesTable)
    .where(eq(sharedVehiclesTable.id, vehicleId));

  if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });

  // CASCADE handles vehicle_members, vehicle_join_requests, vehicle_claims
  await db.delete(sharedVehiclesTable).where(eq(sharedVehiclesTable.id, vehicleId));

  await logAudit({
    actor:   { id: req.adminUser?.id ?? "unknown", name: req.adminUser?.name ?? "Admin", role: req.adminUser?.role ?? "admin" },
    action:  "vehicle.deleted_by_admin",
    targetType: "shared_vehicle",
    targetId:   vehicleId,
    details: { plate: vehicle.plateNumber, name: vehicle.displayName },
  });

  await createNotification({
    title:   "Vehicle deleted by admin",
    message: `${vehicle.displayName ?? vehicleId} (${vehicle.plateNumber ?? "no plate"}) was deleted by admin.`,
    type:    "warning",
  });

  return res.json({ success: true, plate: vehicle.plateNumber });
});

// ── DELETE /vehicle-claims/:id/vehicle ───────────────────────────────────────
// Hard-deletes the vehicle and all its members/claims (ON DELETE CASCADE).
// Use when the registered account is clearly fraudulent and the real owner
// should re-register from scratch.
router.delete("/vehicle-claims/:id/vehicle", requireFeature("reports"), async (req, res) => {
  const { id } = req.params as { id: string };

  const [claim] = await db
    .select({ vehicleId: vehicleClaimsTable.vehicleId })
    .from(vehicleClaimsTable)
    .where(eq(vehicleClaimsTable.id, id));

  if (!claim) return res.status(404).json({ error: "Claim not found" });

  const [vehicle] = await db
    .select({ displayName: sharedVehiclesTable.displayName, plateNumber: sharedVehiclesTable.plateNumber })
    .from(sharedVehiclesTable)
    .where(eq(sharedVehiclesTable.id, claim.vehicleId));

  // CASCADE handles vehicle_members, vehicle_join_requests, vehicle_claims
  await db
    .delete(sharedVehiclesTable)
    .where(eq(sharedVehiclesTable.id, claim.vehicleId));

  await logAudit({
    actor:      { id: req.adminUser?.id ?? "unknown", name: req.adminUser?.name ?? "Admin", role: req.adminUser?.role ?? "admin" },
    action:     "vehicle.deleted_by_admin",
    targetType: "shared_vehicle",
    targetId:   claim.vehicleId,
    details:    { claimId: id, plate: vehicle?.plateNumber, name: vehicle?.displayName },
  });

  await createNotification({
    title:   "Vehicle deleted by admin",
    message: `${vehicle?.displayName ?? claim.vehicleId} (${vehicle?.plateNumber ?? "no plate"}) was deleted following an ownership claim investigation.`,
    type:    "warning",
  });

  return res.json({ success: true });
});

export default router;
