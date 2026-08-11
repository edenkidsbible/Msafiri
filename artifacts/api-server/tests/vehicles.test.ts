/**
 * API tests — shared vehicle join flows.
 *
 * Properties verified:
 *
 *   POST /vehicles/register:
 *   1.  Returns a valid shareCode (5 unambiguous alphanumeric chars).
 *   2.  shareCode is formatted as "MSF-XXXXX" when prefixed on the client.
 *   3.  Idempotent — same owner + plate returns the exact same shareCode.
 *   4.  Returns 400 when deviceId or displayName is missing.
 *   5.  Registers without a plate (plate-less vehicle).
 *
 *   POST /vehicles/join-by-code:
 *   6.  Valid code → 200, member row inserted, owner receives push notification.
 *   7.  Invalid / unknown code → 404, not 500.
 *   8.  Missing required fields → 400.
 *   9.  When the caller is the vehicle owner → alreadyOwner: true, no insert.
 *
 *   POST /vehicles/join-request:
 *  10.  Creates a pending request and pushes the owner.
 *  11.  Returns 404 when vehicleId doesn't exist.
 *  12.  Returns 409 when the requester is already an active member.
 *  13.  Returns 409 when a pending request already exists.
 *  14.  Missing required fields → 400.
 *
 *   PATCH /vehicles/join-request/:id/approve:
 *  15.  Approves the request, inserts active member row, notifies requester.
 *  16.  Returns 404 when the request id doesn't exist.
 *  17.  Returns 403 when the caller is not the vehicle owner.
 *  18.  Missing deviceId → 400.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import supertest from "supertest";
import app from "../src/app.js";

// ── Stable IDs used throughout ─────────────────────────────────────────────────

const OWNER_DEVICE   = "device-owner-001";
const DRIVER_DEVICE  = "device-driver-002";
const VEHICLE_ID     = "aaaaaaaa-0000-4000-8000-000000000010";
const REQUEST_ID     = "bbbbbbbb-0000-4000-8000-000000000020";
const SHARE_CODE     = "AB3C2";          // 5-char, unambiguous charset
const OWNER_TOKEN    = "ExponentPushToken[owner-token]";
const REQUESTER_TOKEN = "ExponentPushToken[driver-token]";

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const { mockDb, mockPush } = vi.hoisted(() => {
  // Chainable select builder factory.
  function makeSelectBuilder(rows: any[]) {
    const builder: any = {
      from:    vi.fn().mockReturnThis(),
      where:   vi.fn().mockReturnThis(),
      limit:   vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      // Awaiting the builder resolves to the rows array.
      then: (resolve: (v: any[]) => void, reject: (e: any) => void) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return builder;
  }

  // Chainable insert builder factory.
  function makeInsertBuilder(returning: any[] = []) {
    const builder: any = {
      values:            vi.fn().mockReturnThis(),
      returning:         vi.fn().mockResolvedValue(returning),
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    };
    return builder;
  }

  // Chainable update builder factory.
  function makeUpdateBuilder() {
    const builder: any = {
      set:   vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    return builder;
  }

  const mockDb = {
    _selectQueue: [] as any[],
    _insertQueue: [] as any[],
    _updateQueue: [] as any[],
    makeSelectBuilder,
    makeInsertBuilder,
    makeUpdateBuilder,

    select(fields?: any) {
      const rows = mockDb._selectQueue.shift() ?? [];
      return makeSelectBuilder(rows);
    },
    insert(table: any) {
      const builder = mockDb._insertQueue.shift() ?? makeInsertBuilder([]);
      return builder;
    },
    update(table: any) {
      return makeUpdateBuilder();
    },
  };

  const mockPush = {
    sendPushNotifications: vi.fn().mockResolvedValue(undefined),
  };

  return { mockDb, mockPush };
});

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock("@workspace/db", async () => {
  const { eq, and, or } = await import("drizzle-orm");
  return {
    db: mockDb,
    eq,
    and,
    or,
    // Table objects — real column names not needed by routes (they use Drizzle
    // column references returned by drizzle-orm, which we pass through).
    sharedVehiclesTable:     { id: "id", ownerDeviceId: "owner_device_id", plateNumber: "plate_number", displayName: "display_name", vehicleType: "vehicle_type", shareCode: "share_code", createdAt: "created_at", updatedAt: "updated_at" },
    vehicleMembersTable:     { id: "id", vehicleId: "vehicle_id", memberDeviceId: "member_device_id", role: "role", status: "status", createdAt: "created_at" },
    vehicleJoinRequestsTable:{ id: "id", vehicleId: "vehicle_id", requesterDeviceId: "requester_device_id", requesterName: "requester_name", status: "status", createdAt: "created_at", resolvedAt: "resolved_at" },
    pushTokensTable:         { id: "id", deviceId: "device_id", token: "token" },
  };
});

vi.mock("../src/lib/expoPush.js", () => mockPush);

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Push rows that the next db.select() calls will return, in order. */
function queueSelects(...rowArrays: any[][]): void {
  mockDb._selectQueue.push(...rowArrays);
}

/** Push insert builders that the next db.insert() calls will use, in order. */
function queueInserts(...builders: any[]): void {
  mockDb._insertQueue.push(...builders);
}

function vehicleRow(overrides?: Partial<any>) {
  return {
    id:            VEHICLE_ID,
    ownerDeviceId: OWNER_DEVICE,
    plateNumber:   "KDA 123A",
    displayName:   "Toyota Fielder",
    vehicleType:   "car",
    shareCode:     SHARE_CODE,
    createdAt:     new Date(),
    updatedAt:     new Date(),
    ...overrides,
  };
}

function requestRow(overrides?: Partial<any>) {
  return {
    id:                REQUEST_ID,
    vehicleId:         VEHICLE_ID,
    requesterDeviceId: DRIVER_DEVICE,
    requesterName:     "John Doe",
    status:            "pending",
    createdAt:         new Date(),
    resolvedAt:        null,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Drain any leftover queue items from prior tests.
  mockDb._selectQueue.length = 0;
  mockDb._insertQueue.length = 0;
  mockDb._updateQueue.length = 0;
});

// ────────────────────────────────────────────────────────────────────────────
// POST /vehicles/register
// ────────────────────────────────────────────────────────────────────────────

describe("POST /api/vehicles/register", () => {

  it("returns a valid 5-char shareCode on first registration", async () => {
    // 1st select — uniqueShareCode uniqueness check (empty = code is available)
    queueSelects(
      [],  // no existing code collision
      [],  // no existing owner+plate record
    );
    // insert(sharedVehiclesTable) returning new row
    queueInserts(
      mockDb.makeInsertBuilder([vehicleRow()]),
    );
    // insert(vehicleMembersTable) onConflictDoNothing — default builder is fine

    const res = await supertest(app)
      .post("/api/vehicles/register")
      .send({ deviceId: OWNER_DEVICE, plateNumber: "KDA 123A", displayName: "Toyota Fielder", vehicleType: "car" });

    expect(res.status).toBe(201);
    expect(res.body.vehicleId).toBe(VEHICLE_ID);
    expect(res.body.shareCode).toBe(SHARE_CODE);
    // Verify the code is exactly 5 chars from the unambiguous charset (no 0/O/1/I/L)
    expect(res.body.shareCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
  });

  it("shareCode is compatible with the MSF-XXXXX display format", async () => {
    queueSelects([], []);
    queueInserts(mockDb.makeInsertBuilder([vehicleRow()]));

    const res = await supertest(app)
      .post("/api/vehicles/register")
      .send({ deviceId: OWNER_DEVICE, displayName: "Toyota Fielder" });

    expect(res.status).toBe(201);
    const displayCode = `MSF-${res.body.shareCode}`;
    expect(displayCode).toMatch(/^MSF-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
  });

  it("is idempotent — second call with same owner+plate returns the existing shareCode", async () => {
    // First select finds the existing record (plate+owner lookup)
    queueSelects([vehicleRow()]);  // existing record found → return early

    const res = await supertest(app)
      .post("/api/vehicles/register")
      .send({ deviceId: OWNER_DEVICE, plateNumber: "KDA 123A", displayName: "Toyota Fielder" });

    expect(res.status).toBe(200);
    expect(res.body.shareCode).toBe(SHARE_CODE);
    expect(res.body.vehicleId).toBe(VEHICLE_ID);
    // No insert should have been called
    expect(mockDb._insertQueue.length).toBe(0);
  });

  it("returns 400 when deviceId is missing", async () => {
    const res = await supertest(app)
      .post("/api/vehicles/register")
      .send({ displayName: "Toyota Fielder" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns 400 when displayName is missing", async () => {
    const res = await supertest(app)
      .post("/api/vehicles/register")
      .send({ deviceId: OWNER_DEVICE });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("registers successfully without a plate number", async () => {
    // No plate ⇒ no plate+owner lookup; goes straight to uniqueShareCode check
    queueSelects([]); // uniqueShareCode: no collision
    queueInserts(mockDb.makeInsertBuilder([vehicleRow({ plateNumber: null })]));

    const res = await supertest(app)
      .post("/api/vehicles/register")
      .send({ deviceId: OWNER_DEVICE, displayName: "Mystery Car" });

    expect(res.status).toBe(201);
    expect(res.body.shareCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /vehicles/join-by-code
// ────────────────────────────────────────────────────────────────────────────

describe("POST /api/vehicles/join-by-code", () => {

  it("valid code → 200, member row inserted, owner notified", async () => {
    queueSelects(
      [vehicleRow()],                                   // vehicle lookup by shareCode
      [],                                               // existingMember check (new member)
      [{ token: OWNER_TOKEN }],                         // owner push token
    );

    const res = await supertest(app)
      .post("/api/vehicles/join-by-code")
      .send({ deviceId: DRIVER_DEVICE, shareCode: SHARE_CODE, requesterName: "Jane" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.vehicle).toMatchObject({
      id:          VEHICLE_ID,
      displayName: "Toyota Fielder",
    });
    // Owner must receive a push notification
    expect(mockPush.sendPushNotifications).toHaveBeenCalledOnce();
    const [notifications] = mockPush.sendPushNotifications.mock.calls[0];
    expect(notifications[0].to).toBe(OWNER_TOKEN);
    expect(notifications[0].data).toMatchObject({ type: "vehicle_joined", vehicleId: VEHICLE_ID });
  });

  it("accepts code with MSF- prefix — server strips prefix before DB lookup", async () => {
    // The mobile screen displays codes as "MSF-AB3C2" and users may paste the
    // full string. The server must strip "MSF" + optional dash before querying
    // so it looks up "AB3C2" (5 chars), not "MSFAB3C2" (8 chars, never found).
    queueSelects(
      [vehicleRow()],  // vehicle found with the 5-char code
      [],              // no push token (irrelevant to this assertion)
    );

    const res = await supertest(app)
      .post("/api/vehicles/join-by-code")
      .send({ deviceId: DRIVER_DEVICE, shareCode: `MSF-${SHARE_CODE}` });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("also strips MSF prefix without a dash (e.g. 'MSFAB3C2')", async () => {
    queueSelects([vehicleRow()], []);

    const res = await supertest(app)
      .post("/api/vehicles/join-by-code")
      .send({ deviceId: DRIVER_DEVICE, shareCode: `MSF${SHARE_CODE}` });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("invalid 8-char code (MSF not stripped) → 404, proving prefix stripping is required", async () => {
    // If the server did NOT strip the MSF prefix, "MSFAB3C2" would be queried
    // and return no rows → 404. This test verifies that when the lookup truly
    // fails (no row queued), the response is 404.
    queueSelects([]); // no vehicle found

    const res = await supertest(app)
      .post("/api/vehicles/join-by-code")
      .send({ deviceId: DRIVER_DEVICE, shareCode: "INVALIDCODE" });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/invalid share code/i);
  });

  it("invalid / unknown share code → 404, not 500", async () => {
    queueSelects([]); // no vehicle found

    const res = await supertest(app)
      .post("/api/vehicles/join-by-code")
      .send({ deviceId: DRIVER_DEVICE, shareCode: "XXXXX" });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/invalid share code/i);
    // Must not throw a 500
    expect(res.status).not.toBe(500);
    expect(mockPush.sendPushNotifications).not.toHaveBeenCalled();
  });

  it("returns 400 when deviceId is missing", async () => {
    const res = await supertest(app)
      .post("/api/vehicles/join-by-code")
      .send({ shareCode: SHARE_CODE });
    expect(res.status).toBe(400);
  });

  it("returns 400 when shareCode is missing", async () => {
    const res = await supertest(app)
      .post("/api/vehicles/join-by-code")
      .send({ deviceId: DRIVER_DEVICE });
    expect(res.status).toBe(400);
  });

  it("returns alreadyOwner when the caller is the vehicle owner", async () => {
    queueSelects([vehicleRow()]);  // vehicle found, ownerDeviceId === caller

    const res = await supertest(app)
      .post("/api/vehicles/join-by-code")
      .send({ deviceId: OWNER_DEVICE, shareCode: SHARE_CODE });

    expect(res.status).toBe(200);
    expect(res.body.alreadyOwner).toBe(true);
    expect(mockPush.sendPushNotifications).not.toHaveBeenCalled();
  });

  it("does not send a push notification when owner has no push token", async () => {
    queueSelects(
      [vehicleRow()],  // vehicle found
      [],              // no push token for owner
    );

    const res = await supertest(app)
      .post("/api/vehicles/join-by-code")
      .send({ deviceId: DRIVER_DEVICE, shareCode: SHARE_CODE });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockPush.sendPushNotifications).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /vehicles/join-request
// ────────────────────────────────────────────────────────────────────────────

describe("POST /api/vehicles/join-request", () => {

  it("creates a pending request and notifies the owner", async () => {
    queueSelects(
      [vehicleRow()],               // vehicle exists
      [],                           // not already a member
      [],                           // no existing pending request
      [{ token: OWNER_TOKEN }],     // owner push token
    );
    queueInserts(
      mockDb.makeInsertBuilder([requestRow()]),  // insert request → returning row
    );

    const res = await supertest(app)
      .post("/api/vehicles/join-request")
      .send({ deviceId: DRIVER_DEVICE, vehicleId: VEHICLE_ID, requesterName: "John Doe" });

    expect(res.status).toBe(201);
    expect(res.body.requestId).toBe(REQUEST_ID);
    expect(mockPush.sendPushNotifications).toHaveBeenCalledOnce();
    const [notifications] = mockPush.sendPushNotifications.mock.calls[0];
    expect(notifications[0].to).toBe(OWNER_TOKEN);
    expect(notifications[0].data).toMatchObject({ type: "vehicle_join_request", vehicleId: VEHICLE_ID });
  });

  it("returns 404 when vehicleId does not exist", async () => {
    queueSelects([]); // vehicle not found

    const res = await supertest(app)
      .post("/api/vehicles/join-request")
      .send({ deviceId: DRIVER_DEVICE, vehicleId: "nonexistent-id" });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 409 when the requester is already an active member", async () => {
    queueSelects(
      [vehicleRow()],                      // vehicle found
      [{ id: "member-row-id" }],           // already a member
    );

    const res = await supertest(app)
      .post("/api/vehicles/join-request")
      .send({ deviceId: DRIVER_DEVICE, vehicleId: VEHICLE_ID });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already a co-driver/i);
  });

  it("returns 409 when a pending request already exists", async () => {
    queueSelects(
      [vehicleRow()],           // vehicle found
      [],                       // not yet a member
      [{ id: REQUEST_ID }],     // existing pending request
    );

    const res = await supertest(app)
      .post("/api/vehicles/join-request")
      .send({ deviceId: DRIVER_DEVICE, vehicleId: VEHICLE_ID });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/pending request/i);
  });

  it("returns 400 when deviceId is missing", async () => {
    const res = await supertest(app)
      .post("/api/vehicles/join-request")
      .send({ vehicleId: VEHICLE_ID });
    expect(res.status).toBe(400);
  });

  it("returns 400 when vehicleId is missing", async () => {
    const res = await supertest(app)
      .post("/api/vehicles/join-request")
      .send({ deviceId: DRIVER_DEVICE });
    expect(res.status).toBe(400);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PATCH /vehicles/join-request/:id/approve
// ────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/vehicles/join-request/:id/approve", () => {

  it("approves the request, creates active member row, notifies requester", async () => {
    queueSelects(
      [requestRow()],                        // join request found
      [vehicleRow()],                        // vehicle found (owner check passes)
      [],                                    // existingMember check (new member)
      [{ token: REQUESTER_TOKEN }],          // requester push token
    );

    const res = await supertest(app)
      .patch(`/api/vehicles/join-request/${REQUEST_ID}/approve`)
      .send({ deviceId: OWNER_DEVICE });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Requester should receive a notification
    expect(mockPush.sendPushNotifications).toHaveBeenCalledOnce();
    const [notifications] = mockPush.sendPushNotifications.mock.calls[0];
    expect(notifications[0].to).toBe(REQUESTER_TOKEN);
    expect(notifications[0].data).toMatchObject({ type: "vehicle_request_approved", vehicleId: VEHICLE_ID });
  });

  it("returns 404 when the request id does not exist", async () => {
    queueSelects([]); // request not found

    const res = await supertest(app)
      .patch(`/api/vehicles/join-request/nonexistent-id/approve`)
      .send({ deviceId: OWNER_DEVICE });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 403 when the caller is not the vehicle owner", async () => {
    queueSelects(
      [requestRow()],             // request found
      [vehicleRow()],             // vehicle found — ownerDeviceId is OWNER_DEVICE, not DRIVER_DEVICE
    );

    const res = await supertest(app)
      .patch(`/api/vehicles/join-request/${REQUEST_ID}/approve`)
      .send({ deviceId: DRIVER_DEVICE }); // wrong caller

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/owner/i);
    expect(mockPush.sendPushNotifications).not.toHaveBeenCalled();
  });

  it("returns 400 when deviceId is missing", async () => {
    const res = await supertest(app)
      .patch(`/api/vehicles/join-request/${REQUEST_ID}/approve`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("does not notify when the requester has no push token", async () => {
    queueSelects(
      [requestRow()],   // request found
      [vehicleRow()],   // vehicle + owner check ok
      [],               // no requester push token
    );

    const res = await supertest(app)
      .patch(`/api/vehicles/join-request/${REQUEST_ID}/approve`)
      .send({ deviceId: OWNER_DEVICE });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockPush.sendPushNotifications).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Rate limiting — POST /api/vehicles/join-by-code
// ────────────────────────────────────────────────────────────────────────────
//
// The limiter is keyed by client IP (via ipKeyGenerator) so that caller-supplied
// deviceId cannot be rotated to bypass the limit.  We control req.ip by setting
// X-Forwarded-For on each request; app.ts already sets trust proxy = 1.
//
// Dedicated test IPs in the documentation range (RFC 5737 / 192.0.2.0/24) are
// used so these tests do not share a bucket with any other test in this file.
// ────────────────────────────────────────────────────────────────────────────

describe("Rate limiting — POST /api/vehicles/join-by-code", () => {
  // Each IP is unique to this describe block — no cross-test interference.
  const IP_LIMIT_TEST    = "192.0.2.201";
  const IP_ROTATION_TEST = "192.0.2.202";

  it("blocks the 11th attempt from the same IP with 429 and Retry-After", async () => {
    // The first 10 requests are allowed (vehicle not found → 404 is fine; the
    // rate limiter counts all requests, including ones the route rejects).
    // No DB mocks needed for the 11th — the limiter fires before the handler.
    for (let i = 0; i < 10; i++) {
      const r = await supertest(app)
        .post("/api/vehicles/join-by-code")
        .set("X-Forwarded-For", IP_LIMIT_TEST)
        .send({ deviceId: `rl-device-${i}`, shareCode: "ZZZZZ" });
      expect(r.status).not.toBe(429);
    }

    const res = await supertest(app)
      .post("/api/vehicles/join-by-code")
      .set("X-Forwarded-For", IP_LIMIT_TEST)
      .send({ deviceId: "rl-device-99", shareCode: "ZZZZZ" });

    expect(res.status).toBe(429);
    // Retry-After must be present so callers know when to retry
    expect(res.headers["retry-after"]).toBeDefined();
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(res.body.error).toMatch(/too many join attempts/i);
  });

  it("rotating deviceId in the request body does not evade the IP-based limit", async () => {
    // Send 10 requests each with a distinct deviceId — simulating an attacker
    // who changes their claimed identity to get a fresh bucket.  The limiter
    // must still block the 11th because the key is IP, not deviceId.
    for (let i = 0; i < 10; i++) {
      await supertest(app)
        .post("/api/vehicles/join-by-code")
        .set("X-Forwarded-For", IP_ROTATION_TEST)
        .send({ deviceId: `rotate-${Date.now()}-${i}`, shareCode: "ZZZZZ" });
    }

    const res = await supertest(app)
      .post("/api/vehicles/join-by-code")
      .set("X-Forwarded-For", IP_ROTATION_TEST)
      .send({ deviceId: "rotate-brand-new-never-seen", shareCode: "ZZZZZ" });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many join attempts/i);
  });
});
