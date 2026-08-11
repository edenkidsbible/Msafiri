import { Router } from "express";
import { and, eq, or } from "drizzle-orm";
import { db, pushTokensTable } from "@workspace/db";
import {
  sharedVehiclesTable,
  vehicleMembersTable,
  vehicleJoinRequestsTable,
} from "@workspace/db";
import { sendPushNotifications } from "../lib/expoPush.js";

const router = Router();

// ── Share code generation ─────────────────────────────────────────────────────
// Unambiguous charset: no 0/O, 1/I/L confusion
const CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateShareCode(): string {
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }
  return code;
}

async function uniqueShareCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateShareCode();
    const existing = await db
      .select({ id: sharedVehiclesTable.id })
      .from(sharedVehiclesTable)
      .where(eq(sharedVehiclesTable.shareCode, code))
      .limit(1);
    if (existing.length === 0) return code;
  }
  // Fallback: append timestamp suffix for uniqueness
  return generateShareCode() + Date.now().toString(36).toUpperCase().slice(-3);
}

// ── POST /vehicles/register ───────────────────────────────────────────────────
// Owner registers a vehicle for sharing; returns the share code.
// Idempotent — same owner + plate returns the existing record.
router.post("/vehicles/register", async (req, res) => {
  const { deviceId, plateNumber, displayName, vehicleType } = req.body as {
    deviceId: string;
    plateNumber?: string;
    displayName: string;
    vehicleType?: string;
  };

  if (!deviceId || !displayName) {
    return res.status(400).json({ error: "deviceId and displayName are required" });
  }

  // Look for an existing registration by this owner for this plate (if plate provided)
  if (plateNumber) {
    const existing = await db
      .select()
      .from(sharedVehiclesTable)
      .where(
        and(
          eq(sharedVehiclesTable.ownerDeviceId, deviceId),
          eq(sharedVehiclesTable.plateNumber, plateNumber),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return res.json({
        vehicleId: existing[0].id,
        shareCode: existing[0].shareCode,
        displayName: existing[0].displayName,
      });
    }
  }

  const shareCode = await uniqueShareCode();

  const [row] = await db
    .insert(sharedVehiclesTable)
    .values({
      ownerDeviceId: deviceId,
      plateNumber:   plateNumber ?? null,
      displayName,
      vehicleType:   vehicleType ?? "car",
      shareCode,
    })
    .returning();

  // Insert owner member row
  await db.insert(vehicleMembersTable).values({
    vehicleId:      row.id,
    memberDeviceId: deviceId,
    role:           "owner",
    status:         "active",
  }).onConflictDoNothing();

  return res.status(201).json({
    vehicleId: row.id,
    shareCode: row.shareCode,
    displayName: row.displayName,
  });
});

// ── GET /vehicles/search?plate= ───────────────────────────────────────────────
// Search for a shared vehicle by plate. Returns make/model/type — NOT owner identity.
router.get("/vehicles/search", async (req, res) => {
  const { plate, deviceId } = req.query as { plate?: string; deviceId?: string };

  if (!plate) {
    return res.status(400).json({ error: "plate query param required" });
  }

  const rows = await db
    .select({
      id:          sharedVehiclesTable.id,
      plateNumber: sharedVehiclesTable.plateNumber,
      displayName: sharedVehiclesTable.displayName,
      vehicleType: sharedVehiclesTable.vehicleType,
    })
    .from(sharedVehiclesTable)
    .where(eq(sharedVehiclesTable.plateNumber, plate.toUpperCase()))
    .limit(1);

  if (rows.length === 0) {
    return res.json({ found: false });
  }

  const vehicle = rows[0];

  // Check if requester is already a member
  let alreadyMember = false;
  if (deviceId && vehicle) {
    const membership = await db
      .select({ id: vehicleMembersTable.id })
      .from(vehicleMembersTable)
      .where(
        and(
          eq(vehicleMembersTable.vehicleId, vehicle.id),
          eq(vehicleMembersTable.memberDeviceId, deviceId),
          eq(vehicleMembersTable.status, "active"),
        ),
      )
      .limit(1);
    alreadyMember = membership.length > 0;
  }

  // Check if there's already a pending request from this device
  let hasPendingRequest = false;
  if (deviceId && vehicle) {
    const pending = await db
      .select({ id: vehicleJoinRequestsTable.id })
      .from(vehicleJoinRequestsTable)
      .where(
        and(
          eq(vehicleJoinRequestsTable.vehicleId, vehicle.id),
          eq(vehicleJoinRequestsTable.requesterDeviceId, deviceId),
          eq(vehicleJoinRequestsTable.status, "pending"),
        ),
      )
      .limit(1);
    hasPendingRequest = pending.length > 0;
  }

  return res.json({
    found: true,
    vehicle,
    alreadyMember,
    hasPendingRequest,
  });
});

// ── POST /vehicles/join-by-code ───────────────────────────────────────────────
// Instant join using a share code — no approval needed.
router.post("/vehicles/join-by-code", async (req, res) => {
  const { deviceId, shareCode, requesterName } = req.body as {
    deviceId: string;
    shareCode: string;
    requesterName?: string;
  };

  if (!deviceId || !shareCode) {
    return res.status(400).json({ error: "deviceId and shareCode are required" });
  }

  // Strip the optional "MSF" prefix (displayed as "MSF-XXXXX" on-screen) then
  // remove all non-alphanumeric chars so both "MSF-AB3C2" and "AB3C2" work.
  const normalizedCode = shareCode
    .toUpperCase()
    .replace(/^MSF[-\s]?/, "")
    .replace(/[^A-Z0-9]/g, "");

  const rows = await db
    .select()
    .from(sharedVehiclesTable)
    .where(eq(sharedVehiclesTable.shareCode, normalizedCode))
    .limit(1);

  if (rows.length === 0) {
    return res.status(404).json({ error: "Invalid share code" });
  }

  const vehicle = rows[0];

  // Don't add the owner again as a driver
  if (vehicle.ownerDeviceId === deviceId) {
    return res.json({ alreadyOwner: true, vehicle });
  }

  // Upsert membership — idempotent
  await db
    .insert(vehicleMembersTable)
    .values({
      vehicleId:      vehicle.id,
      memberDeviceId: deviceId,
      role:           "driver",
      status:         "active",
    })
    .onConflictDoNothing();

  // Notify the owner that someone joined
  const ownerTokenRow = await db
    .select({ token: pushTokensTable.token })
    .from(pushTokensTable)
    .where(eq(pushTokensTable.deviceId, vehicle.ownerDeviceId))
    .limit(1);

  if (ownerTokenRow.length > 0) {
    const joinerName = requesterName?.trim() || "Someone";
    await sendPushNotifications([{
      to:      ownerTokenRow[0].token,
      title:   "New co-driver joined! 🚗",
      body:    `${joinerName} joined your ${vehicle.displayName} using the share code.`,
      sound:   "default",
      data:    { type: "vehicle_joined", vehicleId: vehicle.id },
    }]);
  }

  return res.json({
    success: true,
    vehicle: {
      id:          vehicle.id,
      plateNumber: vehicle.plateNumber,
      displayName: vehicle.displayName,
      vehicleType: vehicle.vehicleType,
    },
  });
});

// ── POST /vehicles/join-request ───────────────────────────────────────────────
// Request to join a vehicle found via plate search. Owner must approve.
router.post("/vehicles/join-request", async (req, res) => {
  const { deviceId, vehicleId, requesterName } = req.body as {
    deviceId: string;
    vehicleId: string;
    requesterName?: string;
  };

  if (!deviceId || !vehicleId) {
    return res.status(400).json({ error: "deviceId and vehicleId are required" });
  }

  const vehicleRows = await db
    .select()
    .from(sharedVehiclesTable)
    .where(eq(sharedVehiclesTable.id, vehicleId))
    .limit(1);

  if (vehicleRows.length === 0) {
    return res.status(404).json({ error: "Vehicle not found" });
  }

  const vehicle = vehicleRows[0];

  // Check already a member
  const existing = await db
    .select({ id: vehicleMembersTable.id })
    .from(vehicleMembersTable)
    .where(
      and(
        eq(vehicleMembersTable.vehicleId, vehicleId),
        eq(vehicleMembersTable.memberDeviceId, deviceId),
        eq(vehicleMembersTable.status, "active"),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return res.status(409).json({ error: "Already a co-driver of this vehicle" });
  }

  // Check for an existing pending request
  const existingRequest = await db
    .select({ id: vehicleJoinRequestsTable.id })
    .from(vehicleJoinRequestsTable)
    .where(
      and(
        eq(vehicleJoinRequestsTable.vehicleId, vehicleId),
        eq(vehicleJoinRequestsTable.requesterDeviceId, deviceId),
        eq(vehicleJoinRequestsTable.status, "pending"),
      ),
    )
    .limit(1);

  if (existingRequest.length > 0) {
    return res.status(409).json({ error: "You already have a pending request for this vehicle" });
  }

  const [requestRow] = await db
    .insert(vehicleJoinRequestsTable)
    .values({
      vehicleId,
      requesterDeviceId: deviceId,
      requesterName:     requesterName?.trim() || null,
      status:            "pending",
    })
    .returning();

  // Push notification to the owner
  const ownerTokenRow = await db
    .select({ token: pushTokensTable.token })
    .from(pushTokensTable)
    .where(eq(pushTokensTable.deviceId, vehicle.ownerDeviceId))
    .limit(1);

  if (ownerTokenRow.length > 0) {
    const name = requesterName?.trim() || "Someone";
    const plateDisplay = vehicle.plateNumber ? ` (${vehicle.plateNumber})` : "";
    await sendPushNotifications([{
      to:      ownerTokenRow[0].token,
      title:   "Co-driver request 🚗",
      body:    `${name} wants to join your ${vehicle.displayName}${plateDisplay}`,
      sound:   "default",
      data:    { type: "vehicle_join_request", requestId: requestRow.id, vehicleId },
    }]);
  }

  return res.status(201).json({ requestId: requestRow.id });
});

// ── PATCH /vehicles/join-request/:id/approve ─────────────────────────────────
router.patch("/vehicles/join-request/:id/approve", async (req, res) => {
  const { id } = req.params as { id: string };
  const { deviceId } = req.body as { deviceId: string };

  if (!deviceId) return res.status(400).json({ error: "deviceId required" });

  const requestRows = await db
    .select()
    .from(vehicleJoinRequestsTable)
    .where(eq(vehicleJoinRequestsTable.id, id))
    .limit(1);

  if (requestRows.length === 0) {
    return res.status(404).json({ error: "Request not found" });
  }

  const request = requestRows[0];

  // Only the vehicle owner may approve
  const vehicleRows = await db
    .select()
    .from(sharedVehiclesTable)
    .where(eq(sharedVehiclesTable.id, request.vehicleId))
    .limit(1);

  if (vehicleRows.length === 0 || vehicleRows[0].ownerDeviceId !== deviceId) {
    return res.status(403).json({ error: "Only the vehicle owner can approve requests" });
  }

  const vehicle = vehicleRows[0];

  // Mark request approved
  await db
    .update(vehicleJoinRequestsTable)
    .set({ status: "approved", resolvedAt: new Date() })
    .where(eq(vehicleJoinRequestsTable.id, id));

  // Add to vehicle_members
  await db
    .insert(vehicleMembersTable)
    .values({
      vehicleId:      request.vehicleId,
      memberDeviceId: request.requesterDeviceId,
      role:           "driver",
      status:         "active",
    })
    .onConflictDoNothing();

  // Notify the requester
  const requesterTokenRow = await db
    .select({ token: pushTokensTable.token })
    .from(pushTokensTable)
    .where(eq(pushTokensTable.deviceId, request.requesterDeviceId))
    .limit(1);

  if (requesterTokenRow.length > 0) {
    const plateDisplay = vehicle.plateNumber ? ` ${vehicle.plateNumber}` : "";
    await sendPushNotifications([{
      to:    requesterTokenRow[0].token,
      title: "Request approved! ✅",
      body:  `You're now a co-driver of ${vehicle.displayName}${plateDisplay}`,
      sound: "default",
      data:  { type: "vehicle_request_approved", vehicleId: vehicle.id },
    }]);
  }

  return res.json({ success: true });
});

// ── PATCH /vehicles/join-request/:id/decline ──────────────────────────────────
router.patch("/vehicles/join-request/:id/decline", async (req, res) => {
  const { id } = req.params as { id: string };
  const { deviceId } = req.body as { deviceId: string };

  if (!deviceId) return res.status(400).json({ error: "deviceId required" });

  const requestRows = await db
    .select()
    .from(vehicleJoinRequestsTable)
    .where(eq(vehicleJoinRequestsTable.id, id))
    .limit(1);

  if (requestRows.length === 0) {
    return res.status(404).json({ error: "Request not found" });
  }

  const request = requestRows[0];

  const vehicleRows = await db
    .select()
    .from(sharedVehiclesTable)
    .where(eq(sharedVehiclesTable.id, request.vehicleId))
    .limit(1);

  if (vehicleRows.length === 0 || vehicleRows[0].ownerDeviceId !== deviceId) {
    return res.status(403).json({ error: "Only the vehicle owner can decline requests" });
  }

  await db
    .update(vehicleJoinRequestsTable)
    .set({ status: "declined", resolvedAt: new Date() })
    .where(eq(vehicleJoinRequestsTable.id, id));

  return res.json({ success: true });
});

// ── GET /vehicles/join-requests/incoming?deviceId= ───────────────────────────
// Owner sees pending join requests for all their shared vehicles.
router.get("/vehicles/join-requests/incoming", async (req, res) => {
  const { deviceId } = req.query as { deviceId?: string };

  if (!deviceId) return res.status(400).json({ error: "deviceId required" });

  // Find all vehicles owned by this device
  const ownedVehicles = await db
    .select({ id: sharedVehiclesTable.id, plateNumber: sharedVehiclesTable.plateNumber, displayName: sharedVehiclesTable.displayName })
    .from(sharedVehiclesTable)
    .where(eq(sharedVehiclesTable.ownerDeviceId, deviceId));

  if (ownedVehicles.length === 0) {
    return res.json({ requests: [] });
  }

  const vehicleMap = new Map(ownedVehicles.map(v => [v.id, v]));
  const vehicleIds = ownedVehicles.map(v => v.id);

  // Fetch pending requests for all owned vehicles
  const requests = await db
    .select()
    .from(vehicleJoinRequestsTable)
    .where(
      and(
        or(...vehicleIds.map(id => eq(vehicleJoinRequestsTable.vehicleId, id))),
        eq(vehicleJoinRequestsTable.status, "pending"),
      ),
    )
    .orderBy(vehicleJoinRequestsTable.createdAt);

  return res.json({
    requests: requests.map(r => ({
      id:            r.id,
      vehicleId:     r.vehicleId,
      vehicleName:   vehicleMap.get(r.vehicleId)?.displayName ?? "",
      vehiclePlate:  vehicleMap.get(r.vehicleId)?.plateNumber ?? null,
      requesterName: r.requesterName,
      createdAt:     r.createdAt,
    })),
  });
});

export default router;
