/**
 * Tests for the purgePhotoOrphans job and its admin trigger endpoint.
 *
 * Properties verified:
 *   Job logic (runPurgePhotoOrphans):
 *     1. Skips when R2 is not configured.
 *     2. Returns zeros when there are no eligible candidates.
 *     3. Leaves rows whose R2 object is present.
 *     4. Deletes rows whose R2 object is absent.
 *     5. Skips a delete when the row was confirmed concurrently.
 *     6. Tolerates a HEAD failure and counts it as an error without crashing.
 *
 *   Admin endpoint (POST /jobs/:jobName via isolated test app):
 *     7. 401 when no admin identity is injected.
 *     8. 404 for an unknown job name.
 *     9. 200 + { ok, job, result } for purge-photo-orphans with no orphans.
 *    10. 200 + result.orphansRemoved = 1 when an absent-object row is found.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import supertest from "supertest";
import express, { type Request, type Response, type NextFunction } from "express";

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const { r2Mock, dbMock } = vi.hoisted(() => {
  const r2Mock = {
    isR2Configured:          vi.fn(() => true),
    headObject:              vi.fn(),
    // stubs needed by other modules loaded transitively
    getPresignedUploadUrl:   vi.fn(),
    getPresignedDownloadUrl: vi.fn(),
    uploadBuffer:            vi.fn(),
    deleteObject:            vi.fn(),
    getObjectStream:         vi.fn(),
    clipKey:                 (d: string, c: string) => `dashcam/${d}/${c}.mp4`,
  };

  const dbMock = {
    select_:  vi.fn(),
    delete_:  vi.fn(),
    insert_:  vi.fn(),
    update_:  vi.fn(),
  };

  return { r2Mock, dbMock };
});

// ── @workspace/db mock ─────────────────────────────────────────────────────────

vi.mock("@workspace/db", async () => {
  const stub = {};
  const accidentPhotosTable = {
    id: "id", accidentId: "accident_id", category: "category",
    fileKey: "file_key", storageUrl: "storage_url", createdAt: "created_at",
  };

  return {
    db: {
      select:  (...a: any[]) => dbMock.select_(...a),
      delete:  (...a: any[]) => dbMock.delete_(...a),
      insert:  (...a: any[]) => dbMock.insert_(...a),
      update:  (...a: any[]) => dbMock.update_(...a),
    },
    accidentPhotosTable,
    // Stubs for every other table imported by routes loaded via app.ts
    accidentRecordsTable:         stub,
    accidentWitnessesTable:       stub,
    accidentTimelineEventsTable:  stub,
    communityReportsTable:        stub,
    adminUsersTable:              stub,
    dashcamClipsTable:            stub,
    pushTokensTable:              stub,
    courseLessonsTable:           stub,
    courseLessonProgressTable:    stub,
    speedZonesTable:              stub,
    poisTable:                    stub,
    auditLogTable:                stub,
    appSettingsTable:             stub,
    blogPostsTable:               stub,
    creatorProfilesTable:         stub,
    pushCampaignsTable:           stub,
    appReleasesTable:             stub,
    subscribersTable:             stub,
    hazardClustersTable:          stub,
    hereTrafficTable:             stub,
    // Drizzle helper fns
    eq:         vi.fn((a: any, b: any) => ({ eq: [a, b] })),
    and:        vi.fn((...a: any[]) => ({ and: a })),
    or:         vi.fn((...a: any[]) => ({ or: a })),
    isNull:     vi.fn((c: any) => ({ isNull: c })),
    isNotNull:  vi.fn((c: any) => ({ isNotNull: c })),
    lt:         vi.fn((a: any, b: any) => ({ lt: [a, b] })),
    ne:         vi.fn(),
    desc:       vi.fn(),
    asc:        vi.fn(),
    gte:        vi.fn(),
    lte:        vi.fn(),
    sql:        vi.fn(),
    inArray:    vi.fn(),
    notInArray: vi.fn(),
  };
});

// ── r2Storage mock ─────────────────────────────────────────────────────────────

vi.mock("../src/lib/r2Storage.js", () => r2Mock);

// ── DB builder helpers ─────────────────────────────────────────────────────────

function selectReturning(rows: any[]) {
  return {
    from:      vi.fn().mockReturnThis(),
    where:     vi.fn().mockReturnThis(),
    orderBy:   vi.fn().mockReturnThis(),
    limit:     vi.fn().mockReturnThis(),
    then:      (resolve: (v: any) => any) => Promise.resolve(rows).then(resolve),
  };
}

function deleteReturning(deleted: any[]) {
  return {
    where:     vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(deleted),
  };
}

// ── Candidate row factory ──────────────────────────────────────────────────────

const OLD_DATE = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 h ago — outside 1-h grace window

function makeRow(overrides: Partial<{ id: string; fileKey: string; createdAt: Date }> = {}) {
  return {
    id:        "photo-abc",
    fileKey:   "accidents/acc-1/photos/photo-abc",
    createdAt: OLD_DATE,
    ...overrides,
  };
}

// ── Import the functions under test (after mocks are registered) ──────────────

const { runPurgePhotoOrphans } = await import("../src/jobs/purgePhotoOrphans.js");
const { default: jobsRouter }  = await import("../src/routes/admin/jobs.js");

// ── Minimal test app that mounts only the jobs router ─────────────────────────

function makeTestApp(authenticated: boolean) {
  const testApp = express();
  testApp.use(express.json());

  // Inject a mock admin identity for authenticated requests
  testApp.use((req: Request, _res: Response, next: NextFunction) => {
    if (authenticated) (req as any).adminUser = { id: "admin-1", email: "admin@test.com" };
    next();
  });

  // Minimal feature gate — mirrors what requireFeature does in production
  testApp.use("/jobs", (req: Request, res: Response, next: NextFunction) => {
    if (!(req as any).adminUser) return void res.status(401).json({ error: "Unauthorised" });
    next();
  });

  testApp.use("/jobs", jobsRouter);
  return testApp;
}

const authedRequest   = supertest(makeTestApp(true));
const unauthedRequest = supertest(makeTestApp(false));

// ══════════════════════════════════════════════════════════════════════════════
// 1-6: runPurgePhotoOrphans() unit tests
// ══════════════════════════════════════════════════════════════════════════════

describe("runPurgePhotoOrphans()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    r2Mock.isR2Configured.mockReturnValue(true);
  });

  it("1. returns zeros immediately when R2 is not configured", async () => {
    r2Mock.isR2Configured.mockReturnValue(false);
    const result = await runPurgePhotoOrphans();
    expect(result).toEqual({ checked: 0, orphansRemoved: 0, errors: 0 });
    expect(dbMock.select_).not.toHaveBeenCalled();
  });

  it("2. returns zeros when there are no eligible candidates", async () => {
    dbMock.select_.mockReturnValue(selectReturning([]));
    const result = await runPurgePhotoOrphans();
    expect(result).toEqual({ checked: 0, orphansRemoved: 0, errors: 0 });
    expect(r2Mock.headObject).not.toHaveBeenCalled();
  });

  it("3. leaves rows whose R2 object is present", async () => {
    dbMock.select_.mockReturnValue(selectReturning([makeRow()]));
    r2Mock.headObject.mockResolvedValue({ size: 512, contentType: "image/jpeg" });

    const result = await runPurgePhotoOrphans();

    expect(r2Mock.headObject).toHaveBeenCalledWith(makeRow().fileKey);
    expect(dbMock.delete_).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, orphansRemoved: 0, errors: 0 });
  });

  it("4. deletes a row when the R2 object is absent", async () => {
    const row = makeRow();
    dbMock.select_.mockReturnValue(selectReturning([row]));
    r2Mock.headObject.mockResolvedValue(null);
    dbMock.delete_.mockReturnValue(deleteReturning([{ id: row.id }]));

    const result = await runPurgePhotoOrphans();

    expect(r2Mock.headObject).toHaveBeenCalledWith(row.fileKey);
    expect(dbMock.delete_).toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, orphansRemoved: 1, errors: 0 });
  });

  it("5. does not count as removed when delete returns empty (concurrent confirm)", async () => {
    const row = makeRow();
    dbMock.select_.mockReturnValue(selectReturning([row]));
    r2Mock.headObject.mockResolvedValue(null);
    dbMock.delete_.mockReturnValue(deleteReturning([]));

    const result = await runPurgePhotoOrphans();

    expect(result).toEqual({ checked: 1, orphansRemoved: 0, errors: 0 });
  });

  it("6. counts HEAD errors without crashing and continues processing", async () => {
    const rows = [
      makeRow({ id: "p1", fileKey: "accidents/a/photos/p1" }),
      makeRow({ id: "p2", fileKey: "accidents/a/photos/p2" }),
    ];
    dbMock.select_.mockReturnValue(selectReturning(rows));
    r2Mock.headObject
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(null);
    dbMock.delete_.mockReturnValue(deleteReturning([{ id: "p2" }]));

    const result = await runPurgePhotoOrphans();

    expect(result).toEqual({ checked: 2, orphansRemoved: 1, errors: 1 });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7-10: Admin endpoint tests (isolated test app)
// ══════════════════════════════════════════════════════════════════════════════

describe("POST /jobs/:jobName (admin endpoint)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    r2Mock.isR2Configured.mockReturnValue(true);
    dbMock.select_.mockReturnValue(selectReturning([]));
  });

  it("7. 401 when no admin identity is present", async () => {
    const res = await unauthedRequest.post("/jobs/purge-photo-orphans");
    expect(res.status).toBe(401);
  });

  it("8. 404 for an unknown job name", async () => {
    const res = await authedRequest.post("/jobs/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Unknown job/);
  });

  it("9. 200 + { ok, job, result } for purge-photo-orphans with no orphans", async () => {
    const res = await authedRequest.post("/jobs/purge-photo-orphans");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.job).toBe("purge-photo-orphans");
    expect(res.body.result).toMatchObject({ checked: 0, orphansRemoved: 0, errors: 0 });
  });

  it("10. 200 + orphansRemoved = 1 when an absent-object row is found", async () => {
    dbMock.select_.mockReturnValue(selectReturning([makeRow()]));
    r2Mock.headObject.mockResolvedValue(null);
    dbMock.delete_.mockReturnValue(deleteReturning([{ id: "photo-abc" }]));

    const res = await authedRequest.post("/jobs/purge-photo-orphans");

    expect(res.status).toBe(200);
    expect(res.body.result.orphansRemoved).toBe(1);
  });
});
