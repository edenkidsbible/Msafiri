import { Router, type Request, type Response, type NextFunction } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { and, eq, ne, or } from "drizzle-orm";
import { db, pushTokensTable } from "@workspace/db";
import {
  sharedVehiclesTable,
  vehicleMembersTable,
  vehicleJoinRequestsTable,
  vehicleClaimsTable,
} from "@workspace/db";
import { sendPushNotifications } from "../lib/expoPush.js";

const router = Router();

// ── HMAC member-token helpers ─────────────────────────────────────────────────
// generateMemberToken produces a short-lived server-signed credential.
// The client receives it only via the register/join-by-code responses and
// stores it locally. DELETE (owner-removes-member) endpoints require it in the
// Authorization header so that knowing a vehicleId + deviceId alone is not
// sufficient to invoke privileged operations.
// ── HMAC secret — must be explicitly configured ──────────────────────────────
// SESSION_SECRET must be set by the operator.  In production its absence is a
// configuration error; in development we log a loud warning but continue.  We
// never fall back to a hard-coded string so tokens can't be forged by a public
// attacker who knows the code.
const SIGNING_SECRET = process.env.SESSION_SECRET;
if (!SIGNING_SECRET) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("[vehicles] SESSION_SECRET is not set. Refusing to start in production without a signing secret.");
  } else {
    console.warn("[vehicles][dev] SESSION_SECRET not set — member tokens will always fail verification; set the secret to test this flow.");
  }
}

function generateMemberToken(vehicleId: string, deviceId: string): string {
  if (!SIGNING_SECRET) throw new Error("SESSION_SECRET not configured");
  return createHmac("sha256", SIGNING_SECRET)
    .update(`vehicle-member:${vehicleId}:${deviceId}`)
    .digest("hex");
}

function verifyMemberToken(vehicleId: string, deviceId: string, token: string): boolean {
  if (!SIGNING_SECRET) return false; // Not configured — reject all
  try {
    const expected = Buffer.from(generateMemberToken(vehicleId, deviceId), "hex");
    const actual   = Buffer.from(token, "hex");
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Extract the Bearer token from an Authorization header, or return "". */
function extractBearerToken(authHeader: string | undefined): string {
  if (!authHeader?.startsWith("Bearer ")) return "";
  return authHeader.slice(7).trim();
}

// ── Rate limiters ─────────────────────────────────────────────────────────────
// Both limiters are keyed on deviceId (body / query) so legitimate users share
// a bucket rather than colliding with other devices behind the same NAT IP.
// Falls back to req.ip when no deviceId is present so unauthenticated probes
// are still bounded.

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes

// Key by normalized client IP — attacker-uncontrolled, unlike deviceId which is
// caller-supplied and can be rotated arbitrarily to defeat per-device limits.
// ipKeyGenerator normalizes IPv6 to a /64 subnet so a single host can't evade
// limits by cycling through addresses in their allocated block.
// trust proxy is set to 1 in app.ts so req.ip reflects the real client address.

/** 10 join-by-code attempts per client IP per 10 minutes. */
const joinByCodeLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 10,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ""),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    const retryAfter = Math.ceil(WINDOW_MS / 1000);
    res.set("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "Too many join attempts. Please wait 10 minutes before trying again.",
    });
  },
});

/** 5 join-request attempts per client IP per 10 minutes. */
const joinRequestLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 5,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ""),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    const retryAfter = Math.ceil(WINDOW_MS / 1000);
    res.set("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "Too many join requests. Please wait 10 minutes before trying again.",
    });
  },
});

/** 30 plate-search attempts per client IP per 10 minutes. */
const plateSearchLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 30,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ""),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    const retryAfter = Math.ceil(WINDOW_MS / 1000);
    res.set("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "Too many plate searches. Please wait 10 minutes before trying again.",
    });
  },
});

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
      // Idempotent — ensure the owner member row exists even for legacy registrations
      // that pre-date the vehicle_members table being created with an owner row.
      await db.insert(vehicleMembersTable).values({
        vehicleId:      existing[0].id,
        memberDeviceId: deviceId,
        role:           "owner",
        status:         "active",
      }).onConflictDoNothing();

      return res.json({
        vehicleId:   existing[0].id,
        shareCode:   existing[0].shareCode,
        displayName: existing[0].displayName,
        memberToken: generateMemberToken(existing[0].id, deviceId),
      });
    }

    // Global plate uniqueness check — same plate under a DIFFERENT owner is not
    // allowed. Return 409 with enough info for the client to offer join/claim flows.
    const conflict = await db
      .select({
        id:          sharedVehiclesTable.id,
        displayName: sharedVehiclesTable.displayName,
        vehicleType: sharedVehiclesTable.vehicleType,
      })
      .from(sharedVehiclesTable)
      .where(
        and(
          eq(sharedVehiclesTable.plateNumber, plateNumber),
          ne(sharedVehiclesTable.ownerDeviceId, deviceId),
        ),
      )
      .limit(1);

    if (conflict.length > 0) {
      return res.status(409).json({
        error:     "This plate is already registered on Msafiri under a different account.",
        duplicate: true,
        vehicle:   conflict[0],
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
    vehicleId:   row.id,
    shareCode:   row.shareCode,
    displayName: row.displayName,
    memberToken: generateMemberToken(row.id, deviceId),
  });
});

// ── GET /vehicles/search?plate= ───────────────────────────────────────────────
// Search for a shared vehicle by plate. Returns make/model/type — NOT owner identity.
router.get("/vehicles/search", plateSearchLimiter, async (req, res) => {
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

// ── POST /vehicles/claim ──────────────────────────────────────────────────────
// User believes a plate already registered under another account is actually
// their vehicle. Stores the claim for Msafiri support to review.
// Rate-limited to 3 claims per IP per 10 minutes to prevent abuse.
const claimLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 3,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ""),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    res.set("Retry-After", String(Math.ceil(WINDOW_MS / 1000)));
    res.status(429).json({ error: "Too many claim requests. Please wait 10 minutes." });
  },
});

router.post("/vehicles/claim", claimLimiter, async (req, res) => {
  const { deviceId, vehicleId, claimNote } = req.body as {
    deviceId: string;
    vehicleId: string;
    claimNote?: string;
  };

  if (!deviceId || !vehicleId) {
    return res.status(400).json({ error: "deviceId and vehicleId are required" });
  }

  // Confirm the vehicle exists
  const vehicle = await db
    .select({ id: sharedVehiclesTable.id, plateNumber: sharedVehiclesTable.plateNumber })
    .from(sharedVehiclesTable)
    .where(eq(sharedVehiclesTable.id, vehicleId))
    .limit(1);

  if (vehicle.length === 0) {
    return res.status(404).json({ error: "Vehicle not found" });
  }

  // One pending claim per device per vehicle is enough
  const existing = await db
    .select({ id: vehicleClaimsTable.id })
    .from(vehicleClaimsTable)
    .where(
      and(
        eq(vehicleClaimsTable.vehicleId, vehicleId),
        eq(vehicleClaimsTable.claimantDeviceId, deviceId),
        eq(vehicleClaimsTable.status, "pending"),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return res.status(409).json({ error: "You already have a pending claim for this vehicle." });
  }

  await db.insert(vehicleClaimsTable).values({
    vehicleId,
    claimantDeviceId: deviceId,
    claimNote:        claimNote?.trim() || null,
  });

  return res.status(201).json({ success: true });
});

// ── POST /vehicles/join-by-code ───────────────────────────────────────────────
// Instant join using a share code — no approval needed.
router.post("/vehicles/join-by-code", joinByCodeLimiter, async (req, res) => {
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

  // Upsert membership — idempotent; restore only if the member left voluntarily.
  // Members expelled by the owner (removalReason = "owner_removed") cannot
  // rejoin via the share code — they need the owner to explicitly re-invite.
  const existingMember = await db
    .select({ id: vehicleMembersTable.id, status: vehicleMembersTable.status, removalReason: vehicleMembersTable.removalReason })
    .from(vehicleMembersTable)
    .where(and(eq(vehicleMembersTable.vehicleId, vehicle.id), eq(vehicleMembersTable.memberDeviceId, deviceId)))
    .limit(1);

  if (existingMember.length > 0) {
    if (existingMember[0].status === "removed") {
      if (existingMember[0].removalReason === "owner_removed") {
        return res.status(403).json({
          error: "You were removed from this vehicle by the owner and cannot rejoin using the share code. Ask the owner to re-invite you.",
        });
      }
      // Voluntarily left — welcome back
      await db.update(vehicleMembersTable)
        .set({ status: "active", memberName: requesterName?.trim() || null, removalReason: null })
        .where(eq(vehicleMembersTable.id, existingMember[0].id));
    }
    // else already active — do nothing
  } else {
    await db.insert(vehicleMembersTable).values({
      vehicleId:      vehicle.id,
      memberDeviceId: deviceId,
      role:           "driver",
      status:         "active",
      memberName:     requesterName?.trim() || null,
    });
  }

  // Notify the owner that someone joined
  const ownerTokenRow = await db
    .select({ token: pushTokensTable.token })
    .from(pushTokensTable)
    .where(eq(pushTokensTable.deviceId, vehicle.ownerDeviceId))
    .limit(1);

  if (ownerTokenRow.length > 0) {
    const joinerName = requesterName?.trim() || "Someone";
    await sendPushNotifications([{
      to:        ownerTokenRow[0].token,
      title:     "New co-driver joined! 🚗",
      body:      `${joinerName} joined your ${vehicle.displayName} using the share code.`,
      sound:     "default",
      channelId: "msafiri_general",
      data:      { type: "vehicle_joined", vehicleId: vehicle.id },
    }]);
  }

  return res.json({
    success:     true,
    memberToken: generateMemberToken(vehicle.id, deviceId),
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
router.post("/vehicles/join-request", joinRequestLimiter, async (req, res) => {
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
      to:        ownerTokenRow[0].token,
      title:     "Co-driver request 🚗",
      body:      `${name} wants to join your ${vehicle.displayName}${plateDisplay}`,
      sound:     "default",
      channelId: "msafiri_general",
      data:      { type: "vehicle_join_request", requestId: requestRow.id, vehicleId },
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

  // Add to vehicle_members. Since this is an explicit owner-approved request,
  // owner_removed members CAN be re-admitted this way (owner is consenting).
  const existingMember = await db
    .select({ id: vehicleMembersTable.id, status: vehicleMembersTable.status })
    .from(vehicleMembersTable)
    .where(and(eq(vehicleMembersTable.vehicleId, request.vehicleId), eq(vehicleMembersTable.memberDeviceId, request.requesterDeviceId)))
    .limit(1);

  if (existingMember.length > 0) {
    if (existingMember[0].status === "removed") {
      await db.update(vehicleMembersTable)
        .set({ status: "active", memberName: request.requesterName?.trim() || null, removalReason: null })
        .where(eq(vehicleMembersTable.id, existingMember[0].id));
    }
  } else {
    await db.insert(vehicleMembersTable).values({
      vehicleId:      request.vehicleId,
      memberDeviceId: request.requesterDeviceId,
      role:           "driver",
      status:         "active",
      memberName:     request.requesterName?.trim() || null,
    });
  }

  // Notify the requester
  const requesterTokenRow = await db
    .select({ token: pushTokensTable.token })
    .from(pushTokensTable)
    .where(eq(pushTokensTable.deviceId, request.requesterDeviceId))
    .limit(1);

  if (requesterTokenRow.length > 0) {
    const plateDisplay = vehicle.plateNumber ? ` ${vehicle.plateNumber}` : "";
    await sendPushNotifications([{
      to:        requesterTokenRow[0].token,
      title:     "Request approved! ✅",
      body:      `You're now a co-driver of ${vehicle.displayName}${plateDisplay}`,
      sound:     "default",
      channelId: "msafiri_general",
      data:      {
        type:        "vehicle_request_approved",
        vehicleId:   vehicle.id,
        displayName: vehicle.displayName,
        vehicleType: vehicle.vehicleType,
        plateNumber: vehicle.plateNumber ?? null,
        memberToken: generateMemberToken(vehicle.id, request.requesterDeviceId),
      },
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

// ── GET /vehicles/:vehicleId/members ─────────────────────────────────────────
// Owner sees all active members (including themselves).
// Co-driver sees only their own row (for status check).
router.get("/vehicles/:vehicleId/members", async (req, res) => {
  const { vehicleId } = req.params as { vehicleId: string };
  const { deviceId } = req.query as { deviceId?: string };

  if (!deviceId) return res.status(400).json({ error: "deviceId required" });

  // Check membership/ownership
  const vehicleRows = await db
    .select({ ownerDeviceId: sharedVehiclesTable.ownerDeviceId })
    .from(sharedVehiclesTable)
    .where(eq(sharedVehiclesTable.id, vehicleId))
    .limit(1);

  if (vehicleRows.length === 0) return res.status(404).json({ error: "Vehicle not found" });

  const isOwner = vehicleRows[0].ownerDeviceId === deviceId;

  // Non-owner: only allowed to see their own membership row
  // Non-owners can only see their own membership row; owners see all active members.
  const baseCondition = and(
    eq(vehicleMembersTable.vehicleId, vehicleId),
    eq(vehicleMembersTable.status, "active"),
  );
  const members = await db
    .select({
      id:             vehicleMembersTable.id,
      memberDeviceId: vehicleMembersTable.memberDeviceId,
      role:           vehicleMembersTable.role,
      status:         vehicleMembersTable.status,
      memberName:     vehicleMembersTable.memberName,
      createdAt:      vehicleMembersTable.createdAt,
    })
    .from(vehicleMembersTable)
    .where(
      isOwner
        ? baseCondition
        : and(baseCondition, eq(vehicleMembersTable.memberDeviceId, deviceId)),
    )
    .orderBy(vehicleMembersTable.createdAt);

  return res.json({
    members: members.map(m => ({
      id:             m.id,
      role:           m.role,
      memberName:     m.memberName,
      isCurrentDevice: m.memberDeviceId === deviceId,
      joinedAt:       m.createdAt.toISOString(),
    })),
  });
});

// ── DELETE /vehicles/:vehicleId/members/:memberDeviceId ───────────────────────
// Owner can remove any member. Co-driver can remove themselves (leave).
//
// Auth model:
//   - Self-leave (memberDeviceId === deviceId): uses the project-wide deviceId
//     identity model. DB membership is verified to prove the device is an active
//     member of this specific vehicle. Self-leave has no privilege-escalation
//     risk — the worst outcome is a force-leave on a reversible membership.
//   - Owner removal (!isSelf): requires a server-issued HMAC bearer token in the
//     Authorization header. The token is obtained only from the register/join-by-
//     code API responses and is stored on the device. No renewal endpoint exists
//     so an attacker who knows only the owner's deviceId cannot mint this token.
router.delete("/vehicles/:vehicleId/members/:memberDeviceId", async (req, res) => {
  const { vehicleId, memberDeviceId } = req.params as { vehicleId: string; memberDeviceId: string };
  const { deviceId } = req.body as { deviceId: string };

  if (!deviceId) return res.status(400).json({ error: "deviceId required" });

  // Load vehicle to check ownership
  const vehicleRows = await db
    .select({ ownerDeviceId: sharedVehiclesTable.ownerDeviceId, displayName: sharedVehiclesTable.displayName })
    .from(sharedVehiclesTable)
    .where(eq(sharedVehiclesTable.id, vehicleId))
    .limit(1);

  if (vehicleRows.length === 0) return res.status(404).json({ error: "Vehicle not found" });

  const vehicle = vehicleRows[0];
  const isOwner = vehicle.ownerDeviceId === deviceId;
  const isSelf  = memberDeviceId === deviceId;

  // Permission checks
  if (!isOwner && !isSelf) {
    return res.status(403).json({ error: "Only the vehicle owner can remove other members" });
  }
  if (isOwner && memberDeviceId === vehicle.ownerDeviceId) {
    return res.status(400).json({ error: "The owner cannot leave their own vehicle." });
  }

  // Owner-removal requires the server-issued HMAC bearer token.
  // Self-leave relies on the DB membership check below (project-wide pattern).
  if (!isSelf) {
    const token = extractBearerToken(req.headers["authorization"] as string | undefined);
    if (!token || !verifyMemberToken(vehicleId, deviceId, token)) {
      return res.status(401).json({ error: "Invalid or missing member token. Re-open Share Vehicle to refresh." });
    }
  }

  // DB membership check — the deviceId in the request must have an active row.
  // This binds the operation to the vehicle: an arbitrary deviceId not found in
  // the membership table is rejected, regardless of whether it matches the claimed identity.
  const callerRow = await db
    .select({ id: vehicleMembersTable.id })
    .from(vehicleMembersTable)
    .where(and(
      eq(vehicleMembersTable.vehicleId, vehicleId),
      eq(vehicleMembersTable.memberDeviceId, deviceId),
      eq(vehicleMembersTable.status, "active"),
    ))
    .limit(1);

  if (callerRow.length === 0) {
    return res.status(403).json({ error: "You are not an active member of this vehicle" });
  }

  const reason = isSelf ? "left" : "owner_removed";
  const updated = await db
    .update(vehicleMembersTable)
    .set({ status: "removed", removalReason: reason })
    .where(
      and(
        eq(vehicleMembersTable.vehicleId, vehicleId),
        eq(vehicleMembersTable.memberDeviceId, memberDeviceId),
        ne(vehicleMembersTable.status, "removed"),
      ),
    )
    .returning({ id: vehicleMembersTable.id });

  if (updated.length === 0) return res.status(404).json({ error: "Member not found or already removed" });

  // Notify the removed member (if it's not them leaving themselves)
  if (!isSelf) {
    const removedTokenRow = await db
      .select({ token: pushTokensTable.token })
      .from(pushTokensTable)
      .where(eq(pushTokensTable.deviceId, memberDeviceId))
      .limit(1);

    if (removedTokenRow.length > 0) {
      const { sendPushNotifications } = await import("../lib/expoPush.js");
      await sendPushNotifications([{
        to:        removedTokenRow[0].token,
        title:     "Removed from shared vehicle",
        body:      `You have been removed from ${vehicle.displayName}.`,
        sound:     "default",
        channelId: "msafiri_general",
        data:      { type: "vehicle_member_removed", vehicleId },
      }]);
    }
  }

  return res.json({ ok: true });
});

// ── DELETE /vehicles/:vehicleId/members-by-row/:rowId ────────────────────────
// Alternate remove endpoint keyed by member-row UUID instead of deviceId,
// used by the Share screen (which sees row IDs, not raw device IDs).
// Caller's deviceId is validated against the DB to ensure they are the owner.
router.delete("/vehicles/:vehicleId/members-by-row/:rowId", async (req, res) => {
  const { vehicleId, rowId } = req.params as { vehicleId: string; rowId: string };
  const { deviceId } = req.body as { deviceId: string };

  if (!deviceId) return res.status(400).json({ error: "deviceId required" });

  // Load vehicle to verify requester is the owner
  const vehicleRows = await db
    .select({ ownerDeviceId: sharedVehiclesTable.ownerDeviceId, displayName: sharedVehiclesTable.displayName })
    .from(sharedVehiclesTable)
    .where(eq(sharedVehiclesTable.id, vehicleId))
    .limit(1);

  if (vehicleRows.length === 0) return res.status(404).json({ error: "Vehicle not found" });

  const vehicle = vehicleRows[0];
  // Require the caller's deviceId to exactly match the owner stored in the DB.
  // Ownership is the only allowed action on this endpoint.
  if (vehicle.ownerDeviceId !== deviceId) {
    return res.status(403).json({ error: "Only the vehicle owner can remove members" });
  }

  // Verify caller holds a valid server-issued HMAC token — this is owner-only
  // so the HMAC is always required here.
  const rowToken = extractBearerToken(req.headers["authorization"] as string | undefined);
  if (!rowToken || !verifyMemberToken(vehicleId, deviceId, rowToken)) {
    return res.status(401).json({ error: "Invalid or missing member token. Re-open Share Vehicle to refresh." });
  }

  // Verify caller has an active owner-role member row.
  const ownerMemberRow = await db
    .select({ id: vehicleMembersTable.id })
    .from(vehicleMembersTable)
    .where(and(
      eq(vehicleMembersTable.vehicleId, vehicleId),
      eq(vehicleMembersTable.memberDeviceId, deviceId),
      eq(vehicleMembersTable.role, "owner"),
      eq(vehicleMembersTable.status, "active"),
    ))
    .limit(1);

  if (ownerMemberRow.length === 0) {
    return res.status(403).json({ error: "Ownership could not be verified" });
  }

  // Look up the row to get the member's deviceId (needed for push notification)
  const memberRows = await db
    .select({ memberDeviceId: vehicleMembersTable.memberDeviceId, status: vehicleMembersTable.status })
    .from(vehicleMembersTable)
    .where(and(eq(vehicleMembersTable.id, rowId), eq(vehicleMembersTable.vehicleId, vehicleId)))
    .limit(1);

  if (memberRows.length === 0) return res.status(404).json({ error: "Member not found" });

  const member = memberRows[0];
  if (member.memberDeviceId === vehicle.ownerDeviceId) {
    return res.status(400).json({ error: "Cannot remove the owner" });
  }

  if (member.status === "removed") return res.status(404).json({ error: "Member already removed" });

  await db
    .update(vehicleMembersTable)
    .set({ status: "removed", removalReason: "owner_removed" })
    .where(eq(vehicleMembersTable.id, rowId));

  // Notify the removed member
  const tokenRow = await db
    .select({ token: pushTokensTable.token })
    .from(pushTokensTable)
    .where(eq(pushTokensTable.deviceId, member.memberDeviceId))
    .limit(1);

  if (tokenRow.length > 0) {
    const { sendPushNotifications } = await import("../lib/expoPush.js");
    await sendPushNotifications([{
      to:        tokenRow[0].token,
      title:     "Removed from shared vehicle",
      body:      `You have been removed from ${vehicle.displayName}.`,
      sound:     "default",
      channelId: "msafiri_general",
      data:      { type: "vehicle_member_removed", vehicleId },
    }]);
  }

  return res.json({ ok: true });
});

export default router;
