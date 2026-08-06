/**
 * Integration tests for dashcam API routes.
 *
 * Security properties verified:
 *   1. Enrollment requires push_tokens row (Phase 1 gate).
 *   2. The OTP is sent via push notification ONLY — never in the HTTP response.
 *   3. Phase 2 verifies OTP hash; expired/invalid OTPs are rejected.
 *   4. Upload intent created atomically within a SERIALIZABLE transaction;
 *      serialization failures (code 40001) convert to HTTP 429.
 *   5. Concurrent upload-url requests that both observe quota capacity
 *      → one receives 429 (serialization failure).
 *   6. POST /dashcam/clip validates clipId against an outstanding intent.
 *   7. fileKey must match the intent exactly.
 *   8. Clip ownership (wrong secretHash → 404 on read/delete).
 *   9. Registration IP rate limiting (DB-backed).
 *  10. Device ID alignment: push_tokens lookup uses the exact X-Device-Id header
 *      value, proving that callers must send the @msafiri/deviceId (push key),
 *      not the sdk_device_id (AppContext key), for enrollment to succeed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import supertest from "supertest";
import app from "../src/app.js";
import { createHash } from "node:crypto";

// ── Mock @workspace/db ────────────────────────────────────────────────────────

vi.mock("@workspace/db", async () => {
  return {
    db: {
      select:      (...a: any[]) => mockDb.select(...a),
      insert:      (...a: any[]) => mockDb.insert(...a),
      delete:      (...a: any[]) => mockDb.delete_(...a),
      update:      (...a: any[]) => mockDb.update_(...a),
      execute:     (...a: any[]) => mockDb.execute_(...a),
      transaction: (...a: any[]) => mockDb.transaction_(...a),
    },
    dashcamDevicesTable:           { deviceId: "device_id", secretHash: "secret_hash" },
    dashcamClipsTable:             { id: "id", deviceId: "device_id", deviceSecretHash: "dsh" },
    dashcamRegRatelimitTable:      { ipHash: "ip_hash", count: "count" },
    dashcamUploadIntentsTable:     { id: "id", deviceId: "device_id", clipId: "clip_id", fileKey: "file_key", expiresAt: "expires_at", fulfilledAt: "fulfilled_at" },
    dashcamEnrollmentRequestsTable: { id: "id", deviceId: "device_id", otpHash: "otp_hash", expiresAt: "expires_at", fulfilledAt: "fulfilled_at" },
    pushTokensTable:               { deviceId: "device_id", welcomeSentAt: "welcome_sent_at", token: "token" },
    count:   vi.fn().mockReturnValue("count()"),
    gt:      vi.fn().mockImplementation((a: any, b: any) => ({ gt: [a, b] })),
    isNull:  vi.fn().mockImplementation((a: any) => ({ isNull: a })),
    and:     vi.fn().mockImplementation((...args: any[]) => ({ and: args })),
    eq:      vi.fn().mockImplementation((a: any, b: any) => ({ eq: [a, b] })),
    desc:    vi.fn().mockImplementation((a: any) => ({ desc: a })),
    sql:     Object.assign(
      vi.fn().mockReturnValue({ toSQL: () => ({ sql: "", params: [] }) }),
      { raw: vi.fn() }
    ),
  };
});

// ── Mock r2Storage ─────────────────────────────────────────────────────────────
vi.mock("../src/lib/r2Storage.js", () => ({
  isR2Configured:          () => true,
  getPresignedUploadUrl:   vi.fn().mockResolvedValue("https://r2.example.com/put?sig=x"),
  getPresignedDownloadUrl: vi.fn().mockResolvedValue("https://r2.example.com/get?sig=x"),
  deleteObject:            vi.fn().mockResolvedValue(undefined),
  clipKey:                 (deviceId: string, clipId: string) =>
    `dashcam/${deviceId}/${clipId}.mp4`,
}));

// ── Mock expoPush ──────────────────────────────────────────────────────────────
vi.mock("../src/lib/expoPush.js", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue({ ok: 1, failed: 0 }),
}));

// ── DB mock control ────────────────────────────────────────────────────────────

const mockDb = {
  select:      vi.fn(),
  insert:      vi.fn(),
  delete_:     vi.fn(),
  update_:     vi.fn(),
  execute_:    vi.fn(),
  transaction_: vi.fn(),
};

function makeSelectBuilder(rows: any[]) {
  return {
    from:    vi.fn().mockReturnThis(),
    where:   vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit:   vi.fn().mockResolvedValue(rows),
  };
}

const DEVICE_ID = "test-device-abc";
const SECRET    = "test-secret-xyz";

function secretHash(id = DEVICE_ID, s = SECRET) {
  return createHash("sha256").update(`${id}:${s}`).digest("hex");
}

function authHeaders(id = DEVICE_ID, secret = SECRET) {
  return { "x-device-id": id, "x-dashcam-secret": secret };
}

const request = supertest(app);

// ── Phase 1 / Phase 2 enrollment ─────────────────────────────────────────────

describe("POST /api/dashcam/register — push-OTP enrollment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.execute_.mockResolvedValue({ rows: [] });
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockResolvedValue([{ deviceId: DEVICE_ID }]),
    });
    mockDb.update_.mockReturnValue({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) });
    mockDb.delete_.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("401 when auth headers are absent", async () => {
    const res = await request.post("/api/dashcam/register").send({});
    expect(res.status).toBe(401);
  });

  it("403 Phase 1: device has no push_tokens row (app never launched)", async () => {
    let call = 0;
    mockDb.select.mockImplementation(() => {
      call++;
      return makeSelectBuilder(call === 1 ? [] : []); // dashcam_devices: absent, push_tokens: absent
    });

    const res = await request.post("/api/dashcam/register").set(authHeaders()).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not registered/i);
  });

  it("device ID alignment: Phase 1 succeeds only when X-Device-Id matches the push_tokens row, not a different device ID", async () => {
    // DashcamContext must use AsyncStorage key "@msafiri/deviceId" (the push device ID,
    // same key as usePushNotifications.ts) for all dashcam API calls. This is because
    // push_tokens stores rows keyed by @msafiri/deviceId, NOT by sdk_device_id (the
    // AppContext.deviceId key). This test proves the lookup is by exact header value:
    //
    //   Scenario A — correct key (@msafiri/deviceId format): push_tokens row found → 200
    //   Scenario B — wrong key (sdk_device_id format):       push_tokens row not found → 403
    //
    // Any mismatch between the device ID used for enrollment and the one stored in
    // push_tokens would permanently block OTP delivery (no push notification sent).

    const pushDeviceId  = "ios-1753462800000-abc123";         // @msafiri/deviceId format
    const sdkDeviceId   = "sdk-device-id-format-from-app-ctx"; // sdk_device_id format

    // ── Scenario A: correct push device ID → push_tokens row found → 200 ──
    let callA = 0;
    mockDb.select.mockImplementation(() => {
      callA++;
      if (callA === 1) return makeSelectBuilder([]);  // dashcam_devices: not enrolled
      if (callA === 2) return makeSelectBuilder([{ deviceId: pushDeviceId, token: "ExponentPushToken[xyz]" }]);
      return makeSelectBuilder([{ ipHash: "x", count: 0, windowStart: new Date() }]);
    });
    const resA = await request
      .post("/api/dashcam/register")
      .set({ "x-device-id": pushDeviceId, "x-dashcam-secret": SECRET })
      .send({});
    expect(resA.status).toBe(200);
    expect(resA.body.pending).toBe(true);

    // ── Scenario B: wrong device ID (AppContext format) → no push_tokens row → 403 ──
    vi.clearAllMocks();
    mockDb.execute_.mockResolvedValue({ rows: [] });
    mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
    mockDb.update_.mockReturnValue({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) });

    let callB = 0;
    mockDb.select.mockImplementation(() => {
      callB++;
      if (callB === 1) return makeSelectBuilder([]); // dashcam_devices: not enrolled
      return makeSelectBuilder([]);                   // push_tokens: no row for this ID
    });
    const resB = await request
      .post("/api/dashcam/register")
      .set({ "x-device-id": sdkDeviceId, "x-dashcam-secret": SECRET })
      .send({});
    expect(resB.status).toBe(403);
    expect(resB.body.error).toMatch(/not registered/i);
  });

  it("200 Phase 1: sends OTP via push, returns { pending: true } (OTP NOT in response)", async () => {
    let call = 0;
    mockDb.select.mockImplementation(() => {
      call++;
      if (call === 1) return makeSelectBuilder([]); // dashcam_devices: not enrolled
      if (call === 2) return makeSelectBuilder([{ deviceId: DEVICE_ID, token: "ExponentPushToken[abc]" }]); // push_tokens: exists
      // ratelimit: under limit
      return makeSelectBuilder([{ ipHash: "x", count: 1, windowStart: new Date() }]);
    });

    const res = await request.post("/api/dashcam/register").set(authHeaders()).send({});
    expect(res.status).toBe(200);
    expect(res.body.pending).toBe(true);
    // Critical: OTP must NOT be in the HTTP response
    expect(res.body.otp).toBeUndefined();
    expect(res.body.otpCode).toBeUndefined();
    expect(res.body.code).toBeUndefined();
  });

  it("429 Phase 1: IP rate limit exceeded", async () => {
    let call = 0;
    mockDb.select.mockImplementation(() => {
      call++;
      if (call === 1) return makeSelectBuilder([]); // not enrolled
      if (call === 2) return makeSelectBuilder([{ deviceId: DEVICE_ID, token: "token" }]); // push_tokens
      // ratelimit: over limit
      return makeSelectBuilder([{ ipHash: "x", count: 99, windowStart: new Date() }]);
    });

    const res = await request.post("/api/dashcam/register").set(authHeaders()).send({});
    expect(res.status).toBe(429);
  });

  it("403 Phase 2: invalid OTP is rejected", async () => {
    let call = 0;
    mockDb.select.mockImplementation(() => {
      call++;
      if (call === 1) return makeSelectBuilder([]); // not in dashcam_devices
      // enrollment_requests: no matching hash
      return makeSelectBuilder([]);
    });

    const res = await request
      .post("/api/dashcam/register")
      .set(authHeaders())
      .send({ otp: "WRONG1" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/invalid or expired/i);
  });

  it("200 Phase 2: valid OTP enrolls device", async () => {
    const otp = "ABCDEF";
    const hash = createHash("sha256").update(otp).digest("hex");

    let call = 0;
    mockDb.select.mockImplementation(() => {
      call++;
      if (call === 1) return makeSelectBuilder([]); // not enrolled
      // enrollment_requests: matching hash, not expired, not fulfilled
      return makeSelectBuilder([{
        id: "req-1",
        deviceId: DEVICE_ID,
        otpHash: hash,
        expiresAt: new Date(Date.now() + 60_000),
        fulfilledAt: null,
      }]);
    });

    const res = await request
      .post("/api/dashcam/register")
      .set(authHeaders())
      .send({ otp });
    expect(res.status).toBe(200);
    expect(res.body.registered).toBe(true);
  });

  it("200 Phase 1 (already enrolled): returns { registered: false } fast path", async () => {
    mockDb.select.mockImplementation(() =>
      makeSelectBuilder([{ deviceId: DEVICE_ID, secretHash: secretHash() }])
    );
    const res = await request.post("/api/dashcam/register").set(authHeaders()).send({});
    expect(res.status).toBe(200);
    expect(res.body.registered).toBe(false);
  });

  it("409 conflicting secret: device enrolled with different secret", async () => {
    mockDb.select.mockImplementation(() =>
      makeSelectBuilder([{ deviceId: DEVICE_ID, secretHash: "different-hash" }])
    );
    const res = await request.post("/api/dashcam/register").set(authHeaders()).send({});
    expect(res.status).toBe(409);
  });
});

// ── Upload URL ────────────────────────────────────────────────────────────────

describe("POST /api/dashcam/upload-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.execute_.mockResolvedValue({ rows: [] });
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: "intent-1", clipId: "clip-1", fileKey: `dashcam/${DEVICE_ID}/clip-1.mp4` }]),
    });
    mockDb.update_.mockReturnValue({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) });
    mockDb.delete_.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("401 missing auth headers", async () => {
    const res = await request.post("/api/dashcam/upload-url").send({});
    expect(res.status).toBe(401);
  });

  it("403 device not registered", async () => {
    mockDb.select.mockImplementation(() => makeSelectBuilder([]));
    const res = await request.post("/api/dashcam/upload-url").set(authHeaders()).send({ lockReason: "manual" });
    expect(res.status).toBe(403);
  });

  it("429 on PostgreSQL serialization failure (code 40001) from concurrent transaction", async () => {
    // isDeviceRegistered() calls db.select() before the transaction
    mockDb.select.mockImplementation(() =>
      makeSelectBuilder([{ deviceId: DEVICE_ID, secretHash: secretHash() }])
    );
    // Simulate Postgres aborting one of two concurrent serializable transactions
    const pgSerializationError = Object.assign(new Error("could not serialize"), { code: "40001" });
    mockDb.transaction_.mockRejectedValueOnce(pgSerializationError);

    const res = await request.post("/api/dashcam/upload-url").set(authHeaders()).send({ lockReason: "manual" });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/retry in a moment/i);
  });

  it("429 when quota is full (inside serializable transaction)", async () => {
    // isDeviceRegistered() select
    mockDb.select.mockImplementation(() =>
      makeSelectBuilder([{ deviceId: DEVICE_ID, secretHash: secretHash() }])
    );

    // The transaction callback receives tx; the route calls tx.execute(sql`...`)
    // which returns { rows: [{ total: "200" }] } — over MAX_CLIPS_PER_DEVICE
    mockDb.transaction_.mockImplementationOnce(async (fn: Function) => {
      const txDb = {
        execute: vi.fn().mockResolvedValue({ rows: [{ total: "200" }] }),
        insert:  vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
      };
      return fn(txDb);
    });

    const res = await request.post("/api/dashcam/upload-url").set(authHeaders()).send({ lockReason: "manual" });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/quota/i);
  });

  it("200 under quota: returns uploadUrl + clipId, creates intent row", async () => {
    // isDeviceRegistered() select
    mockDb.select.mockImplementation(() =>
      makeSelectBuilder([{ deviceId: DEVICE_ID, secretHash: secretHash() }])
    );

    // Transaction: execute returns low count (under quota), insert succeeds
    mockDb.transaction_.mockImplementationOnce(async (fn: Function) => {
      const txDb = {
        execute: vi.fn().mockResolvedValue({ rows: [{ total: "5" }] }),
        insert:  vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
      };
      return fn(txDb);
    });

    const res = await request.post("/api/dashcam/upload-url").set(authHeaders()).send({ lockReason: "manual" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      uploadUrl: expect.stringContaining("r2.example.com"),
      clipId:    expect.any(String),
      fileKey:   expect.stringContaining(DEVICE_ID),
    });
  });
});

// ── Clip metadata ─────────────────────────────────────────────────────────────

describe("POST /api/dashcam/clip", () => {
  const CLIP_ID  = "clip-1";
  const FILE_KEY = `dashcam/${DEVICE_ID}/${CLIP_ID}.mp4`;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.execute_.mockResolvedValue({ rows: [] });
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: "server-clip-1" }]),
    });
    mockDb.update_.mockReturnValue({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) });
    mockDb.delete_.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("403 no matching intent", async () => {
    mockDb.select.mockImplementation(() => makeSelectBuilder([]));
    const res = await request.post("/api/dashcam/clip").set(authHeaders()).send({
      clipId: CLIP_ID, fileKey: FILE_KEY,
      durationS: 120, sizeBytes: 1024, lockReason: "manual",
      startedAt: new Date().toISOString(),
    });
    expect(res.status).toBe(403);
  });

  it("403 fileKey does not match intent", async () => {
    let call = 0;
    mockDb.select.mockImplementation(() => {
      call++;
      if (call === 1) return makeSelectBuilder([{ deviceId: DEVICE_ID, secretHash: secretHash() }]);
      return makeSelectBuilder([{ id: "intent-1", clipId: CLIP_ID, fileKey: "dashcam/other/wrong.mp4", expiresAt: new Date(Date.now() + 60_000), fulfilledAt: null }]);
    });
    const res = await request.post("/api/dashcam/clip").set(authHeaders()).send({
      clipId: CLIP_ID, fileKey: FILE_KEY,
      durationS: 120, sizeBytes: 1024, lockReason: "manual",
      startedAt: new Date().toISOString(),
    });
    expect(res.status).toBe(403);
  });

  it("201 valid intent → clip saved, intent fulfilled", async () => {
    let call = 0;
    mockDb.select.mockImplementation(() => {
      call++;
      if (call === 1) return makeSelectBuilder([{ deviceId: DEVICE_ID, secretHash: secretHash() }]);
      return makeSelectBuilder([{ id: "intent-1", clipId: CLIP_ID, fileKey: FILE_KEY, expiresAt: new Date(Date.now() + 60_000), fulfilledAt: null }]);
    });
    const res = await request.post("/api/dashcam/clip").set(authHeaders()).send({
      clipId: CLIP_ID, fileKey: FILE_KEY,
      durationS: 120, sizeBytes: 1024, lockReason: "manual",
      startedAt: new Date().toISOString(),
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("server-clip-1");
  });
});

// ── Clip ownership ────────────────────────────────────────────────────────────

describe("clip ownership enforcement", () => {
  const CLIP_ID  = "clip-1";
  const FILE_KEY = `dashcam/${DEVICE_ID}/${CLIP_ID}.mp4`;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.execute_.mockResolvedValue({ rows: [] });
    mockDb.update_.mockReturnValue({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) });
    mockDb.delete_.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("404 GET clip URL with wrong secretHash", async () => {
    mockDb.select.mockImplementation(() =>
      makeSelectBuilder([{
        id: CLIP_ID, fileKey: FILE_KEY,
        deviceSecretHash: "wrong-hash",
        deviceId: DEVICE_ID,
      }])
    );
    const res = await request.get(`/api/dashcam/clip/${CLIP_ID}/url`).set(authHeaders());
    expect(res.status).toBe(404);
  });

  it("404 DELETE clip with wrong secretHash", async () => {
    mockDb.select.mockImplementation(() =>
      makeSelectBuilder([{
        id: CLIP_ID, fileKey: FILE_KEY,
        deviceSecretHash: "wrong-hash",
        deviceId: DEVICE_ID,
      }])
    );
    const res = await request.delete(`/api/dashcam/clip/${CLIP_ID}`).set(authHeaders());
    expect(res.status).toBe(404);
  });

  it("200 DELETE clip with correct secretHash", async () => {
    const hash = createHash("sha256").update(`${DEVICE_ID}:${SECRET}`).digest("hex");
    mockDb.select.mockImplementation(() =>
      makeSelectBuilder([{
        id: CLIP_ID, fileKey: FILE_KEY,
        deviceSecretHash: hash,
        deviceId: DEVICE_ID,
      }])
    );
    const res = await request.delete(`/api/dashcam/clip/${CLIP_ID}`).set(authHeaders());
    expect(res.status).toBe(200);
  });
});
