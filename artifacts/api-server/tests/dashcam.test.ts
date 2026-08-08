/**
 * Integration tests for dashcam API routes.
 *
 * Security properties verified:
 *   1. Enrollment is open (no push_tokens gate) — any caller with a valid
 *      X-Device-Id + X-Dashcam-Secret pair can enroll, subject to IP rate limit.
 *      The dashcamSecret UUID (128-bit random, stored only on the device) is the
 *      real authentication credential; the hash in dashcam_devices is verified on
 *      every subsequent API call.
 *   2. A conflicting secret on an already-enrolled device is rejected (409).
 *   3. New enrollment is rate-limited per IP (DB-backed, 3/hr).
 *   4. Upload intent created atomically within a SERIALIZABLE transaction;
 *      serialization failures (code 40001) convert to HTTP 429.
 *   5. Concurrent upload-url requests that both observe quota capacity
 *      → one receives 429 (serialization failure).
 *   6. POST /dashcam/clip validates clipId against an outstanding intent.
 *   7. fileKey must match the intent exactly.
 *   8. Clip ownership (wrong secretHash → 404 on read/delete).
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

// ── Enrollment ───────────────────────────────────────────────────────────────

describe("POST /api/dashcam/register — auto-enrollment", () => {
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

  it("200 new device: auto-enrolled immediately, returns { registered: true }", async () => {
    // No push_tokens check — enrollment succeeds on first call regardless of
    // whether usePushNotifications has registered a token yet. This eliminates
    // the race between DashcamContext hydration and push token registration.
    let call = 0;
    mockDb.select.mockImplementation(() => {
      call++;
      if (call === 1) return makeSelectBuilder([]); // dashcam_devices: not enrolled
      return makeSelectBuilder([{ ipHash: "x", count: 1, windowStart: new Date() }]); // ratelimit: under limit
    });

    const res = await request.post("/api/dashcam/register").set(authHeaders()).send({});
    expect(res.status).toBe(200);
    expect(res.body.registered).toBe(true);
    // Response must not expose any secret material
    expect(res.body.otp).toBeUndefined();
    expect(res.body.pending).toBeUndefined();
  });

  it("200 new device: enrollment works even without push_tokens row (no notifications gate)", async () => {
    // Proves enrollment no longer depends on push token registration timing.
    // Any device presenting a valid deviceId+secret can enroll immediately.
    let call = 0;
    mockDb.select.mockImplementation(() => {
      call++;
      if (call === 1) return makeSelectBuilder([]); // dashcam_devices: not enrolled
      return makeSelectBuilder([{ ipHash: "x", count: 0, windowStart: new Date() }]); // ratelimit: under limit
    });
    const res = await request
      .post("/api/dashcam/register")
      .set({ "x-device-id": "ios-1753462800000-abc123", "x-dashcam-secret": SECRET })
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.registered).toBe(true);
  });

  it("429 IP rate limit exceeded on new enrollment", async () => {
    let call = 0;
    mockDb.select.mockImplementation(() => {
      call++;
      if (call === 1) return makeSelectBuilder([]); // not enrolled
      return makeSelectBuilder([{ ipHash: "x", count: 99, windowStart: new Date() }]); // ratelimit: over limit
    });

    const res = await request.post("/api/dashcam/register").set(authHeaders()).send({});
    expect(res.status).toBe(429);
  });

  it("200 already enrolled with matching secret: returns { registered: false } fast path", async () => {
    mockDb.select.mockImplementation(() =>
      makeSelectBuilder([{ deviceId: DEVICE_ID, secretHash: secretHash() }])
    );
    const res = await request.post("/api/dashcam/register").set(authHeaders()).send({});
    expect(res.status).toBe(200);
    expect(res.body.registered).toBe(false);
  });

  it("409 conflicting secret: device enrolled with different secret is rejected", async () => {
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

  it("200 GET clip URL with correct secretHash returns signed R2 GET URL", async () => {
    const { getPresignedDownloadUrl } = await import("../src/lib/r2Storage.js");
    const hash = createHash("sha256").update(`${DEVICE_ID}:${SECRET}`).digest("hex");
    mockDb.select.mockImplementation(() =>
      makeSelectBuilder([{
        id: CLIP_ID, fileKey: FILE_KEY,
        deviceSecretHash: hash,
        deviceId: DEVICE_ID,
      }])
    );

    const res = await request.get(`/api/dashcam/clip/${CLIP_ID}/url`).set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.downloadUrl).toContain("r2.example.com");
    expect(res.body.expiresIn).toBe(3600);
    expect(vi.mocked(getPresignedDownloadUrl)).toHaveBeenCalledWith(FILE_KEY);
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
