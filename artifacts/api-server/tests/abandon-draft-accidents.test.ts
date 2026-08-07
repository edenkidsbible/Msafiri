/**
 * Tests for abandonDraftAccidents job and its admin trigger endpoint.
 *
 * Job logic (runAbandonDraftAccidents):
 *   1. Issues exactly one UPDATE — no N+1 per row.
 *   2. WHERE clause includes eq(status, "draft").
 *   3. WHERE clause includes lt(createdAt, <7-day cutoff>).
 *   4. Returns { abandoned: 0 } when the UPDATE touches no rows.
 *   5. Returns the correct count when stale drafts are updated.
 *
 * Abandoned records blocked at item-level endpoints (via full app):
 *   6.  GET  /api/accidents/:id           → 404 when abandoned.
 *   7.  PATCH /api/accidents/:id          → 404 when abandoned.
 *   8.  POST /api/accidents/:id/photos/request-upload → 404 when abandoned.
 *   9.  POST /api/accidents/:id/photos/:pid/confirm   → 404 when abandoned.
 *   10. GET  /api/accidents/:id/photos/:pid/url       → 404 when abandoned.
 *   11. DELETE /api/accidents/:id/photos/:pid         → 404 when abandoned.
 *   12. POST /api/accidents/:id/witnesses             → 404 when abandoned.
 *   13. DELETE /api/accidents/:id/witnesses/:wid      → 404 when abandoned.
 *   14. POST /api/accidents/:id/timeline-event        → 404 when abandoned.
 *   15. GET  /api/accidents/:id/report/url            → 404 when abandoned.
 *
 * Admin endpoint (POST /jobs/abandon-draft-accidents via isolated test app):
 *   16. 401 when unauthenticated.
 *   17. 404 for unknown job name.
 *   18. 200 + { ok, job, result } with no stale drafts.
 *   19. 200 + result.abandoned = 2 when two eligible drafts are updated.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import supertest from "supertest";
import express, { type Request, type Response, type NextFunction } from "express";

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const { r2Mock, mockDb, eqSpy, ltSpy, neSpy } = vi.hoisted(() => {
  // These spy on drizzle-orm's eq/lt/ne so WHERE-clause contents can be asserted.
  const eqSpy  = vi.fn((a: any, b: any) => ({ eq:  [a, b] }));
  const ltSpy  = vi.fn((a: any, b: any) => ({ lt:  [a, b] }));
  const neSpy  = vi.fn((a: any, b: any) => ({ ne:  [a, b] }));

  const r2Mock = {
    isR2Configured:          vi.fn(() => false),
    headObject:              vi.fn(),
    getPresignedUploadUrl:   vi.fn().mockResolvedValue("https://r2.example.com/put"),
    getPresignedDownloadUrl: vi.fn().mockResolvedValue("https://r2.example.com/get"),
    uploadBuffer:            vi.fn(),
    deleteObject:            vi.fn(),
    getObjectStream:         vi.fn(),
    clipKey:                 (d: string, c: string) => `dashcam/${d}/${c}.mp4`,
  };

  const mockDb = {
    select_:      vi.fn(),
    update_:      vi.fn(),
    insert_:      vi.fn(),
    delete_:      vi.fn(),
    execute_:     vi.fn(),
    transaction_: vi.fn(),
  };

  return { r2Mock, mockDb, eqSpy, ltSpy, neSpy };
});

// ── @workspace/db mock ─────────────────────────────────────────────────────────

vi.mock("@workspace/db", async () => {
  const stub = {};
  return {
    db: {
      select:      (...a: any[]) => mockDb.select_(...a),
      update:      (...a: any[]) => mockDb.update_(...a),
      insert:      (...a: any[]) => mockDb.insert_(...a),
      delete:      (...a: any[]) => mockDb.delete_(...a),
      execute:     (...a: any[]) => mockDb.execute_(...a),
      transaction: (...a: any[]) => mockDb.transaction_(...a),
    },
    accidentRecordsTable: {
      id: "id", deviceId: "device_id", status: "status",
      createdAt: "created_at", pdfUrl: "pdf_url", pdfFileKey: "pdf_file_key",
    },
    accidentPhotosTable:         { id: "id", accidentId: "accident_id", category: "category", fileKey: "file_key", storageUrl: "storage_url" },
    accidentWitnessesTable:      { id: "id", accidentId: "accident_id", createdAt: "created_at" },
    accidentTimelineEventsTable: { id: "id", accidentId: "accident_id", eventType: "event_type", occurredAt: "occurred_at" },
    communityReportsTable:       stub,
    adminUsersTable:             stub,
    dashcamClipsTable:           stub,
    pushTokensTable:             stub,
    speedZonesTable:             stub,
    poisTable:                   stub,
    auditLogTable:               stub,
    appSettingsTable:            stub,
    blogPostsTable:              stub,
    creatorProfilesTable:        stub,
    pushCampaignsTable:          stub,
    appReleasesTable:            stub,
    subscribersTable:            stub,
    hazardClustersTable:         stub,
    courseLessonsTable:          stub,
    courseLessonProgressTable:   stub,
    hereTrafficTable:            stub,
    eq:         eqSpy,
    and:        vi.fn((...a: any[]) => ({ and: a })),
    ne:         neSpy,
    lt:         ltSpy,
    or:         vi.fn(),
    desc:       vi.fn((a: any) => ({ desc: a })),
    asc:        vi.fn(),
    isNull:     vi.fn((c: any) => ({ isNull: c })),
    isNotNull:  vi.fn((c: any) => ({ isNotNull: c })),
    gte:        vi.fn(), lte: vi.fn(), sql: vi.fn(),
    inArray:    vi.fn(), notInArray: vi.fn(),
  };
});

vi.mock("../src/lib/r2Storage.js", () => r2Mock);

// Mock drizzle-orm so eq/lt/ne calls from the job are interceptable.
// The real `and` is kept as a simple combiner so chaining still works.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq:  eqSpy,
    lt:  ltSpy,
    ne:  neSpy,
    and: vi.fn((...args: any[]) => ({ and: args })),
  };
});

// ── DB builder helpers ─────────────────────────────────────────────────────────

function makeSelectBuilder(rows: any[]) {
  return {
    from:    vi.fn().mockReturnThis(),
    where:   vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit:   vi.fn().mockResolvedValue(rows),
    then:    (resolve: (v: any[]) => any) => Promise.resolve(rows).then(resolve),
  };
}

function makeUpdateBuilder(returning: any[] = []) {
  return {
    set:       vi.fn().mockReturnThis(),
    where:     vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returning),
  };
}

function makeInsertBuilder(returning: any[] = []) {
  return {
    values:    vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returning),
  };
}

// ── Import functions under test (after mocks are registered) ──────────────────

const { runAbandonDraftAccidents } = await import("../src/jobs/abandonDraftAccidents.js");
const { default: jobsRouter }      = await import("../src/routes/admin/jobs.js");
const { default: app }             = await import("../src/app.js");

const request = supertest(app);

// ── Isolated admin test app ────────────────────────────────────────────────────

function makeAdminApp(authenticated: boolean) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    if (authenticated) (req as any).adminUser = { id: "admin-1", email: "admin@test.com" };
    next();
  });
  a.use("/jobs", (req: Request, res: Response, next: NextFunction) => {
    if (!(req as any).adminUser) return void res.status(401).json({ error: "Unauthorised" });
    next();
  });
  a.use("/jobs", jobsRouter);
  return a;
}

const authedAdmin   = supertest(makeAdminApp(true));
const unauthedAdmin = supertest(makeAdminApp(false));

// ── Constants ──────────────────────────────────────────────────────────────────

const DEVICE_ID   = "device-001";
const ACCIDENT_ID = "acc-abc";
const PHOTO_ID    = "photo-xyz";
const WITNESS_ID  = "wit-001";

// ══════════════════════════════════════════════════════════════════════════════
// 1-5: Job logic
// ══════════════════════════════════════════════════════════════════════════════

describe("runAbandonDraftAccidents()", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("1. issues exactly one UPDATE regardless of row count", async () => {
    mockDb.update_.mockReturnValue(makeUpdateBuilder([]));
    await runAbandonDraftAccidents();
    expect(mockDb.update_).toHaveBeenCalledTimes(1);
  });

  it("2. WHERE clause filters on status = 'draft'", async () => {
    mockDb.update_.mockReturnValue(makeUpdateBuilder([]));
    await runAbandonDraftAccidents();
    // eqSpy is called for every eq() — one of the calls must be (status_col, "draft")
    const draftCall = eqSpy.mock.calls.find(([_col, val]) => val === "draft");
    expect(draftCall).toBeDefined();
  });

  it("3. WHERE clause filters with a 7-day cutoff via lt(createdAt, date)", async () => {
    mockDb.update_.mockReturnValue(makeUpdateBuilder([]));
    const before = Date.now();
    await runAbandonDraftAccidents();
    const after = Date.now();

    expect(ltSpy).toHaveBeenCalledTimes(1);
    const [_col, cutoff] = ltSpy.mock.calls[0]!;
    const cutoffMs = cutoff instanceof Date ? cutoff.getTime() : 0;
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    // cutoff should be approximately 7 days before the run
    expect(cutoffMs).toBeGreaterThanOrEqual(before - sevenDays - 1000);
    expect(cutoffMs).toBeLessThanOrEqual(after  - sevenDays + 1000);
  });

  it("4. returns { abandoned: 0 } when no rows are updated", async () => {
    mockDb.update_.mockReturnValue(makeUpdateBuilder([]));
    expect(await runAbandonDraftAccidents()).toEqual({ abandoned: 0 });
  });

  it("5. returns the correct count when stale drafts are updated", async () => {
    mockDb.update_.mockReturnValue(makeUpdateBuilder([{ id: "a1" }, { id: "a2" }]));
    expect(await runAbandonDraftAccidents()).toEqual({ abandoned: 2 });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Helpers for transaction-based endpoint mocks
// ══════════════════════════════════════════════════════════════════════════════

/** Transaction whose inner SELECT returns no rows — simulates abandoned parent. */
function makeAbandonedTx() {
  return async (callback: any) => {
    const tx = {
      select: () => makeSelectBuilder([]),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    };
    await callback(tx);
  };
}

/** Transaction whose inner SELECT returns the parent — simulates active record. */
function makeActiveTx(parentRow: any = { id: ACCIDENT_ID }) {
  return async (callback: any) => {
    const tx = {
      select: () => makeSelectBuilder([parentRow]),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([parentRow]),
      }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    };
    return callback(tx);
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 6-15: Abandoned records are blocked at item-level driver endpoints
//
// Endpoints that use db.select() for the ownership check (GET/:id, confirm,
// photo URL, report/url) are covered by select_ returning [].
//
// PATCH uses an atomic db.update().returning() — mocked to return [].
//
// Child mutation endpoints (photo upload, photo delete, witnesses, timeline)
// use db.transaction() with an inner tx.select — mocked via makeAbandonedTx().
// ══════════════════════════════════════════════════════════════════════════════

describe("Abandoned record → 404 on driver-facing item endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Endpoints that still call db.select() for parent ownership (GET/:id, confirm,
    // photo URL, report/url): return empty to simulate abandoned record.
    mockDb.select_.mockReturnValue(makeSelectBuilder([]));
    // PATCH uses an atomic UPDATE with ne(status,'abandoned') — returning [] means
    // the record was not found (either absent or abandoned).
    mockDb.update_.mockReturnValue({
      set:       vi.fn().mockReturnThis(),
      where:     vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    });
    // Child mutation endpoints use db.transaction(); route abandoned state via tx.select.
    mockDb.transaction_.mockImplementation(makeAbandonedTx());
  });

  it("6. GET /api/accidents/:id → 404", async () => {
    const res = await request.get(`/api/accidents/${ACCIDENT_ID}?deviceId=${DEVICE_ID}`);
    expect(res.status).toBe(404);
  });

  it("7. PATCH /api/accidents/:id → 404 (atomic UPDATE returns 0 rows)", async () => {
    const res = await request
      .patch(`/api/accidents/${ACCIDENT_ID}`)
      .send({ deviceId: DEVICE_ID });
    expect(res.status).toBe(404);
  });

  it("8. POST /api/accidents/:id/photos/request-upload → 404", async () => {
    r2Mock.isR2Configured.mockReturnValue(true);
    r2Mock.getPresignedUploadUrl.mockResolvedValue("https://r2.example.com/put");
    const res = await request
      .post(`/api/accidents/${ACCIDENT_ID}/photos/request-upload`)
      .send({ deviceId: DEVICE_ID, category: "scene" });
    expect(res.status).toBe(404);
  });

  it("9. POST /api/accidents/:id/photos/:pid/confirm → 404", async () => {
    const res = await request
      .post(`/api/accidents/${ACCIDENT_ID}/photos/${PHOTO_ID}/confirm`)
      .send({ deviceId: DEVICE_ID });
    expect(res.status).toBe(404);
  });

  it("10. GET /api/accidents/:id/photos/:pid/url → 404", async () => {
    const res = await request.get(
      `/api/accidents/${ACCIDENT_ID}/photos/${PHOTO_ID}/url?deviceId=${DEVICE_ID}`,
    );
    expect(res.status).toBe(404);
  });

  it("11. DELETE /api/accidents/:id/photos/:pid → 404 (inside transaction)", async () => {
    const res = await request.delete(
      `/api/accidents/${ACCIDENT_ID}/photos/${PHOTO_ID}?deviceId=${DEVICE_ID}`,
    );
    expect(res.status).toBe(404);
  });

  it("12. POST /api/accidents/:id/witnesses → 404 (inside transaction)", async () => {
    const res = await request
      .post(`/api/accidents/${ACCIDENT_ID}/witnesses`)
      .send({ deviceId: DEVICE_ID, name: "John" });
    expect(res.status).toBe(404);
  });

  it("13. DELETE /api/accidents/:id/witnesses/:wid → 404 (inside transaction)", async () => {
    const res = await request.delete(
      `/api/accidents/${ACCIDENT_ID}/witnesses/${WITNESS_ID}?deviceId=${DEVICE_ID}`,
    );
    expect(res.status).toBe(404);
  });

  it("14. POST /api/accidents/:id/timeline-event → 404 (inside transaction)", async () => {
    const res = await request
      .post(`/api/accidents/${ACCIDENT_ID}/timeline-event`)
      .send({ deviceId: DEVICE_ID, eventType: "note" });
    expect(res.status).toBe(404);
  });

  it("15. GET /api/accidents/:id/report/url → 404", async () => {
    const res = await request.get(
      `/api/accidents/${ACCIDENT_ID}/report/url?deviceId=${DEVICE_ID}`,
    );
    expect(res.status).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 20-22: TOCTOU — record abandoned *between* initial validation and final mutation
//
// These tests model the concurrent sweep scenario: the record appears active
// at request-start, but the sweep runs before the final write, so the final
// mutation must detect and reject the stale state.
// ══════════════════════════════════════════════════════════════════════════════

describe("TOCTOU: record abandoned between initial validation and final mutation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("20. PATCH: 404 when sweep marks record abandoned before the UPDATE commits", async () => {
    // The single atomic UPDATE would have matched before the sweep, but the
    // ne(status,'abandoned') predicate finds 0 rows after concurrent abandonment.
    mockDb.update_.mockReturnValue({
      set:       vi.fn().mockReturnThis(),
      where:     vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]), // sweep already ran
    });
    const res = await request
      .patch(`/api/accidents/${ACCIDENT_ID}`)
      .send({ deviceId: DEVICE_ID, status: "complete" });
    expect(res.status).toBe(404);
    // Confirm the returning check is what gates the 404 (not a prior SELECT)
    expect(mockDb.update_).toHaveBeenCalledTimes(1);
    expect(mockDb.select_).not.toHaveBeenCalled();
  });

  it("21. Photo upload: 404 even after presign when sweep abandons record inside tx", async () => {
    r2Mock.isR2Configured.mockReturnValue(true);
    r2Mock.getPresignedUploadUrl.mockResolvedValue("https://r2.example.com/put");
    // Presign succeeds (external I/O before transaction), but the transaction
    // sees the abandoned record and sets notFound = true.
    mockDb.transaction_.mockImplementation(makeAbandonedTx());
    const res = await request
      .post(`/api/accidents/${ACCIDENT_ID}/photos/request-upload`)
      .send({ deviceId: DEVICE_ID, category: "scene" });
    // 404 despite the presign completing — the wasted presigned URL is harmless.
    expect(res.status).toBe(404);
    expect(r2Mock.getPresignedUploadUrl).toHaveBeenCalledTimes(1);
  });

  it("22. Witness add: 404 when sweep abandons record inside the transaction", async () => {
    mockDb.transaction_.mockImplementation(makeAbandonedTx());
    const res = await request
      .post(`/api/accidents/${ACCIDENT_ID}/witnesses`)
      .send({ deviceId: DEVICE_ID, name: "Jane Doe" });
    expect(res.status).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 16-19: Admin trigger endpoint
// ══════════════════════════════════════════════════════════════════════════════

describe("POST /jobs/abandon-draft-accidents (admin endpoint)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.update_.mockReturnValue(makeUpdateBuilder([]));
  });

  it("16. 401 when no admin identity is present", async () => {
    expect((await unauthedAdmin.post("/jobs/abandon-draft-accidents")).status).toBe(401);
  });

  it("17. 404 for unknown job name", async () => {
    const res = await authedAdmin.post("/jobs/not-a-real-job");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Unknown job/);
  });

  it("18. 200 + { ok, job, result } with no stale drafts", async () => {
    const res = await authedAdmin.post("/jobs/abandon-draft-accidents");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, job: "abandon-draft-accidents", result: { abandoned: 0 } });
  });

  it("19. 200 + result.abandoned = 2 when two drafts are updated", async () => {
    mockDb.update_.mockReturnValue(makeUpdateBuilder([{ id: "a1" }, { id: "a2" }]));
    const res = await authedAdmin.post("/jobs/abandon-draft-accidents");
    expect(res.status).toBe(200);
    expect(res.body.result.abandoned).toBe(2);
  });
});
