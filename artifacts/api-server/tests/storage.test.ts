/**
 * Tests for the storage routes and r2ObjectAcl helpers.
 *
 * Security properties verified:
 *   1. POST /storage/uploads/request-url requires valid admin JWT.
 *   2. POST /storage/uploads/request-url returns a presigned R2 URL and an
 *      owner-keyed objectPath (uploads/<adminId>/<uuid>).
 *   3. GET /storage/objects/* for a new R2 path: owner can download.
 *   4. GET /storage/objects/* for a new R2 path: non-owner receives 403.
 *   5. GET /storage/objects/* for a legacy GCS path (uploads/<uuid>, no owner
 *      segment) is routed to Replit Object Storage, not R2.
 *   6. GET /storage/objects/* for a missing R2 key returns 404 (not 500).
 *
 * r2ObjectAcl unit tests:
 *   7. parseUploadKeyOwner rejects two-segment legacy keys.
 *   8. parseUploadKeyOwner rejects keys with non-UUID segments.
 *   9. isNewR2UploadKey correctly classifies new vs legacy keys.
 *  10. objectPathToR2Key returns null for legacy paths.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import supertest from "supertest";
import app from "../src/app.js";
import jwt from "jsonwebtoken";

// ── Helpers ────────────────────────────────────────────────────────────────────

const OWNER_ID   = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_ID   = "bbbbbbbb-0000-4000-8000-000000000002";
const OBJ_UUID   = "cccccccc-0000-4000-8000-000000000003";
// A legacy GCS-style uuid-only key (no ownerId segment).
const LEGACY_UUID = "dddddddd-0000-4000-8000-000000000004";

const R2_KEY_OWNER = `uploads/${OWNER_ID}/${OBJ_UUID}`;
const LEGACY_GCS_KEY = `uploads/${LEGACY_UUID}`;

/** Mint a signed admin JWT (uses the same secret as adminAuthMiddleware). */
function makeAdminToken(id: string): string {
  const secret = process.env.ADMIN_JWT_SECRET ?? "test-secret";
  return jwt.sign({ id, email: `${id}@test.com`, name: "Test", role: "admin" }, secret, {
    expiresIn: "1h",
  });
}

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", async () => {
  const { eq: _eq } = await import("drizzle-orm");
  return {
    db: { select: () => ({ from: () => ({ where: () => [] }) }) },
    adminUsersTable: { id: "id", email: "email", name: "name", role: "role", mustChangePassword: "mcp", permissions: "permissions" },
    eq: _eq,
  };
});

const mockGetPresignedUploadUrl = vi.fn();
const mockHeadObject = vi.fn();
const mockGetObjectStream = vi.fn();
const mockIsR2Configured = vi.fn().mockReturnValue(true);

vi.mock("../src/lib/r2Storage.js", () => ({
  isR2Configured: () => mockIsR2Configured(),
  getPresignedUploadUrl: (...a: any[]) => mockGetPresignedUploadUrl(...a),
  headObject: (...a: any[]) => mockHeadObject(...a),
  getObjectStream: (...a: any[]) => mockGetObjectStream(...a),
}));

// Mock the Replit ObjectStorageService so legacy GCS path tests stay offline.
const mockGetObjectEntityFile = vi.fn();
const mockDownloadObject = vi.fn();
const mockSearchPublicObject = vi.fn();

vi.mock("../src/lib/objectStorage.js", () => {
  class ObjectNotFoundError extends Error {
    constructor() { super("not found"); this.name = "ObjectNotFoundError"; }
  }
  class ObjectStorageService {
    getObjectEntityFile(...a: any[]) { return mockGetObjectEntityFile(...a); }
    downloadObject(...a: any[])      { return mockDownloadObject(...a); }
    searchPublicObject(...a: any[])  { return mockSearchPublicObject(...a); }
  }
  return { ObjectNotFoundError, ObjectStorageService };
});

// ── Helpers: session-based auth ────────────────────────────────────────────────

/**
 * Minimal supertest agent that injects a Passport-style session into `req`
 * by monkey-patching the app.  We override `req.isAuthenticated` to return
 * true and attach a synthetic `req.user` with the given id so the session
 * auth branch in extractStoragePrincipal is exercised without a real Passport
 * setup.
 */
async function withSessionUser(userId: string, fn: (agent: supertest.SuperTest<supertest.Test>) => Promise<void>): Promise<void> {
  // Patch the router's session extraction inside optionalAdminAuth:
  // Since we can't install Passport in tests, inject isAuthenticated + user
  // by using app.use middleware before the route.
  const express = (await import("express")).default;
  const sessionApp = express();
  sessionApp.use((_req: any, _res: any, next: any) => {
    _req.isAuthenticated = () => true;
    _req.user = { id: userId };
    next();
  });
  sessionApp.use(app);
  await fn(supertest(sessionApp) as any);
}

// ── Tests: POST /storage/uploads/request-url ─────────────────────────────────

describe("POST /api/storage/uploads/request-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsR2Configured.mockReturnValue(true);
    mockGetPresignedUploadUrl.mockResolvedValue("https://r2.example.com/presigned");
  });

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await supertest(app)
      .post("/api/storage/uploads/request-url")
      .send({ name: "test.pdf", size: 1024, contentType: "application/pdf" });
    expect(res.status).toBe(401);
  });

  it("returns 400 for missing required body fields", async () => {
    const token = makeAdminToken(OWNER_ID);
    const res = await supertest(app)
      .post("/api/storage/uploads/request-url")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "test.pdf" }); // missing size and contentType
    expect(res.status).toBe(400);
  });

  it("returns a presigned R2 URL with an owner-keyed objectPath", async () => {
    const token = makeAdminToken(OWNER_ID);
    const res = await supertest(app)
      .post("/api/storage/uploads/request-url")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "test.pdf", size: 1024, contentType: "application/pdf" });

    expect(res.status).toBe(200);
    expect(res.body.uploadURL).toBe("https://r2.example.com/presigned");
    // objectPath must start with /objects/uploads/<ownerId>/
    expect(res.body.objectPath).toMatch(
      new RegExp(`^/objects/uploads/${OWNER_ID}/[0-9a-f-]{36}$`),
    );
    expect(res.body.metadata).toMatchObject({
      name: "test.pdf",
      size: 1024,
      contentType: "application/pdf",
    });
  });

  it("returns 503 when R2 is not configured", async () => {
    mockIsR2Configured.mockReturnValue(false);
    const token = makeAdminToken(OWNER_ID);
    const res = await supertest(app)
      .post("/api/storage/uploads/request-url")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "test.pdf", size: 1024, contentType: "application/pdf" });
    expect(res.status).toBe(503);
  });

  it("accepts a session-based principal (non-admin caller path)", async () => {
    await withSessionUser(OWNER_ID, async (agent) => {
      const res = await agent
        .post("/api/storage/uploads/request-url")
        .send({ name: "doc.pdf", size: 2048, contentType: "application/pdf" });

      expect(res.status).toBe(200);
      // objectPath must encode the session user's id.
      expect(res.body.objectPath).toMatch(
        new RegExp(`^/objects/uploads/${OWNER_ID}/[0-9a-f-]{36}$`),
      );
    });
  });

  it("normalises a non-UUID session principal ID to a UUID in the objectPath", async () => {
    const nonUuidId = "user:alice@example.com";
    await withSessionUser(nonUuidId, async (agent) => {
      const res = await agent
        .post("/api/storage/uploads/request-url")
        .send({ name: "note.txt", size: 100, contentType: "text/plain" });

      expect(res.status).toBe(200);
      // objectPath must be /objects/uploads/<UUID>/<UUID> — fully UUID-format.
      expect(res.body.objectPath).toMatch(
        /^\/objects\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f-]{36}$/,
      );
      // The owner UUID must be deterministic (same for the same input).
      const path1 = res.body.objectPath as string;
      const ownerSegment1 = path1.split("/")[3];

      const res2 = await agent
        .post("/api/storage/uploads/request-url")
        .send({ name: "note2.txt", size: 100, contentType: "text/plain" });
      const ownerSegment2 = (res2.body.objectPath as string).split("/")[3];
      expect(ownerSegment1).toBe(ownerSegment2);
    });
  });
});

// ── Tests: GET /api/storage/objects/* — R2 paths ─────────────────────────────

describe("GET /api/storage/objects/* — R2 owner-keyed paths", () => {
  const ownerObjectPath = `uploads/${OWNER_ID}/${OBJ_UUID}`;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsR2Configured.mockReturnValue(true);
  });

  it("allows the object owner to download", async () => {
    mockHeadObject.mockResolvedValue({ size: 512, contentType: "application/pdf" });
    const { Readable } = await import("node:stream");
    mockGetObjectStream.mockResolvedValue({
      body: Readable.from(["data"]),
      contentLength: 4,
      contentType: "application/pdf",
    });

    const token = makeAdminToken(OWNER_ID);
    const res = await supertest(app)
      .get(`/api/storage/objects/${ownerObjectPath}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(mockHeadObject).toHaveBeenCalledWith(R2_KEY_OWNER);
    expect(mockGetObjectStream).toHaveBeenCalledWith(R2_KEY_OWNER);
    // Legacy GCS service must NOT have been called.
    expect(mockGetObjectEntityFile).not.toHaveBeenCalled();
  });

  it("returns 403 for a different authenticated admin (non-owner)", async () => {
    const token = makeAdminToken(OTHER_ID);
    const res = await supertest(app)
      .get(`/api/storage/objects/${ownerObjectPath}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
    // R2 presence check and GCS must NOT have been called.
    expect(mockHeadObject).not.toHaveBeenCalled();
    expect(mockGetObjectEntityFile).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await supertest(app).get(
      `/api/storage/objects/${ownerObjectPath}`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when the R2 object does not exist", async () => {
    mockHeadObject.mockResolvedValue(null);
    const token = makeAdminToken(OWNER_ID);
    const res = await supertest(app)
      .get(`/api/storage/objects/${ownerObjectPath}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Object not found");
  });

  it("returns 500 (not silently broken) when headObject throws", async () => {
    mockHeadObject.mockRejectedValue(new Error("R2 network failure"));
    const token = makeAdminToken(OWNER_ID);
    const res = await supertest(app)
      .get(`/api/storage/objects/${ownerObjectPath}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── Tests: GET /api/storage/objects/* — legacy GCS paths ────────────────────

describe("GET /api/storage/objects/* — legacy GCS paths route to Object Storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsR2Configured.mockReturnValue(true);
  });

  it("routes a two-segment uploads/<uuid> path to GCS, not R2", async () => {
    // Simulate a GCS File object returned by getObjectEntityFile.
    const fakeFile = { name: LEGACY_UUID };
    mockGetObjectEntityFile.mockResolvedValue(fakeFile);
    const { Readable } = await import("node:stream");
    const fakeResponse = new Response(Readable.toWeb(Readable.from(["legacy"])) as ReadableStream, {
      headers: { "Content-Type": "text/plain" },
      status: 200,
    });
    mockDownloadObject.mockResolvedValue(fakeResponse);

    const token = makeAdminToken(OWNER_ID);
    const res = await supertest(app)
      .get(`/api/storage/objects/${LEGACY_GCS_KEY}`)
      .set("Authorization", `Bearer ${token}`);

    // Served via GCS path.
    expect(mockGetObjectEntityFile).toHaveBeenCalledWith(
      `/objects/${LEGACY_GCS_KEY}`,
    );
    // R2 must NOT have been touched.
    expect(mockHeadObject).not.toHaveBeenCalled();
    expect(mockGetObjectStream).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
});

// ── Unit tests: r2ObjectAcl helpers ──────────────────────────────────────────

import {
  parseUploadKeyOwner,
  isNewR2UploadKey,
  objectPathToR2Key,
  buildUploadKey,
} from "../src/lib/r2ObjectAcl.js";

describe("r2ObjectAcl helpers", () => {
  describe("parseUploadKeyOwner", () => {
    it("returns ownerId for a valid three-segment key", () => {
      expect(parseUploadKeyOwner(R2_KEY_OWNER)).toBe(OWNER_ID);
    });

    it("returns null for a two-segment legacy key", () => {
      expect(parseUploadKeyOwner(LEGACY_GCS_KEY)).toBeNull();
    });

    it("returns null when ownerId is not a UUID", () => {
      expect(parseUploadKeyOwner(`uploads/not-a-uuid/${OBJ_UUID}`)).toBeNull();
    });

    it("returns null when objectId is not a UUID", () => {
      expect(parseUploadKeyOwner(`uploads/${OWNER_ID}/not-a-uuid`)).toBeNull();
    });

    it("returns null for a key with no uploads prefix", () => {
      expect(parseUploadKeyOwner(`other/${OWNER_ID}/${OBJ_UUID}`)).toBeNull();
    });
  });

  describe("isNewR2UploadKey", () => {
    it("returns true for a valid new R2 key", () => {
      expect(isNewR2UploadKey(R2_KEY_OWNER)).toBe(true);
    });

    it("returns false for a legacy two-segment key", () => {
      expect(isNewR2UploadKey(LEGACY_GCS_KEY)).toBe(false);
    });
  });

  describe("objectPathToR2Key", () => {
    it("returns the R2 key for a new-format objectPath", () => {
      expect(objectPathToR2Key(`/objects/${R2_KEY_OWNER}`)).toBe(R2_KEY_OWNER);
    });

    it("returns null for a legacy GCS objectPath", () => {
      expect(objectPathToR2Key(`/objects/${LEGACY_GCS_KEY}`)).toBeNull();
    });

    it("returns null for paths without the /objects/ prefix", () => {
      expect(objectPathToR2Key(R2_KEY_OWNER)).toBeNull();
    });
  });

  describe("buildUploadKey", () => {
    it("produces a key parseable by parseUploadKeyOwner", () => {
      const key = buildUploadKey(OWNER_ID);
      expect(parseUploadKeyOwner(key)).toBe(OWNER_ID);
    });

    it("produces a key with three segments starting with uploads/", () => {
      const key = buildUploadKey(OWNER_ID);
      const parts = key.split("/");
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe("uploads");
    });
  });
});
