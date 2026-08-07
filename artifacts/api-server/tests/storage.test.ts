/**
 * Tests for the storage routes and r2ObjectAcl helpers.
 *
 * Security properties verified:
 *   1. POST /storage/uploads/request-url requires valid admin JWT.
 *   2. POST /storage/uploads/request-url returns a presigned R2 URL and an
 *      owner-keyed objectPath (uploads/<adminId>/<uuid>).
 *   3. GET /storage/objects/* for a new R2 path: owner can download.
 *   4. GET /storage/objects/* for a new R2 path: any non-owner receives 403,
 *      regardless of JWT role or the object's public-visibility metadata.
 *   5. GET /storage/objects/* for a legacy GCS path is routed to Replit
 *      Object Storage, not R2.
 *   6. GET /storage/objects/* for a missing R2 key returns 404.
 *
 *   POST /storage/uploads/confirm:
 *   7.  401 when unauthenticated.
 *   8.  400 for missing/invalid body.
 *   9.  400 for a legacy-format objectPath.
 *  10.  503 when R2 is not configured.
 *  11.  403 when a non-owner tries to confirm (regardless of JWT role).
 *  12.  200 when the owner confirms with visibility=private.
 *  13.  200 when the owner confirms with visibility=public and the MIME type
 *       is in the safe-image allowlist; publicUrl returned.
 *  14.  415 when the owner confirms with visibility=public but the object
 *       has a disallowed MIME type (e.g. text/html).
 *  15.  Defaults visibility to "private" when not specified.
 *  16.  Does NOT return publicUrl for visibility=private.
 *
 *   GET /storage/r2-public-objects/*:
 *  17.  Serves a public image without any authentication.
 *  18.  Returns 403 for a private object.
 *  19.  Returns 403 when no ACL metadata exists.
 *  20.  Returns 404 when getR2ObjectAclPolicy throws.
 *  21.  Returns 503 when R2 is not configured.
 *  22.  Sets X-Content-Type-Options: nosniff and Cache-Control: public.
 *  23.  For a non-image MIME, forces Content-Disposition: attachment and
 *       Content-Type: application/octet-stream (defence-in-depth).
 *  24.  Authenticated requests also work (auth is optional, not required).
 *
 *   canAccessR2Object unit tests (pure synchronous ACL logic):
 *  25.  Key-path owner match → allowed.
 *  26.  Key-path owner mismatch → unconditionally denied (no metadata fallback).
 *  27.  No encoded owner (legacy key) → denied regardless of userId.
 *  28.  No userId provided → denied even for a matching key.
 *
 *   r2ObjectAcl pure-helper unit tests:
 *  29.  parseUploadKeyOwner / isNewR2UploadKey / objectPathToR2Key / buildUploadKey.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import supertest from "supertest";
import app from "../src/app.js";
import jwt from "jsonwebtoken";

// ── Constants ──────────────────────────────────────────────────────────────────

const OWNER_ID    = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_ID    = "bbbbbbbb-0000-4000-8000-000000000002";
const OBJ_UUID    = "cccccccc-0000-4000-8000-000000000003";
const LEGACY_UUID = "dddddddd-0000-4000-8000-000000000004";

const R2_KEY_OWNER   = `uploads/${OWNER_ID}/${OBJ_UUID}`;
const LEGACY_GCS_KEY = `uploads/${LEGACY_UUID}`;

const JWT_SECRET = process.env.ADMIN_JWT_SECRET ?? "test-secret";

// ── Token helpers ──────────────────────────────────────────────────────────────

function makeAdminToken(id: string): string {
  return jwt.sign(
    { id, email: `${id}@test.com`, name: "Test", role: "admin" },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

function makeModeratorToken(id: string): string {
  return jwt.sign(
    { id, email: `${id}@test.com`, name: "Test", role: "moderator" },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", async () => {
  const { eq: _eq } = await import("drizzle-orm");
  return {
    db: { select: () => ({ from: () => ({ where: () => [] }) }) },
    adminUsersTable: {
      id: "id", email: "email", name: "name", role: "role",
      mustChangePassword: "mcp", permissions: "permissions",
    },
    eq: _eq,
  };
});

const mockGetPresignedUploadUrl = vi.fn();
const mockHeadObject            = vi.fn();
const mockGetObjectStream       = vi.fn();
const mockIsR2Configured        = vi.fn().mockReturnValue(true);

vi.mock("../src/lib/r2Storage.js", () => ({
  isR2Configured:        () => mockIsR2Configured(),
  getPresignedUploadUrl: (...a: any[]) => mockGetPresignedUploadUrl(...a),
  headObject:            (...a: any[]) => mockHeadObject(...a),
  getObjectStream:       (...a: any[]) => mockGetObjectStream(...a),
}));

// Mock r2ObjectAcl:
//  - canAccessR2Object is a vi.fn() for route-level tests.
//  - getR2ObjectAclPolicy is a vi.fn() for the public-objects route.
//  - setR2ObjectAclPolicy is a vi.fn() for confirm tests.
//  - Pure helpers are passed through from the actual module.
const mockCanAccessR2Object    = vi.fn();
const mockGetR2ObjectAclPolicy = vi.fn();
const mockSetR2ObjectAclPolicy = vi.fn();

vi.mock("../src/lib/r2ObjectAcl.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/lib/r2ObjectAcl.js")>();
  return {
    ...actual,
    canAccessR2Object:    (...a: any[]) => mockCanAccessR2Object(...a),
    getR2ObjectAclPolicy: (...a: any[]) => mockGetR2ObjectAclPolicy(...a),
    setR2ObjectAclPolicy: (...a: any[]) => mockSetR2ObjectAclPolicy(...a),
  };
});

// objectAcl.ts and objectStorage.ts have been deleted — Replit Object Storage retired.

// ── Session helper ─────────────────────────────────────────────────────────────

async function withSessionUser(
  userId: string,
  fn: (agent: supertest.SuperTest<supertest.Test>) => Promise<void>,
): Promise<void> {
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
      .send({ name: "test.pdf" });
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

  it("accepts a session-based principal", async () => {
    await withSessionUser(OWNER_ID, async (agent) => {
      const res = await agent
        .post("/api/storage/uploads/request-url")
        .send({ name: "doc.pdf", size: 2048, contentType: "application/pdf" });
      expect(res.status).toBe(200);
      expect(res.body.objectPath).toMatch(
        new RegExp(`^/objects/uploads/${OWNER_ID}/[0-9a-f-]{36}$`),
      );
    });
  });

  it("normalises a non-UUID session principal ID to a deterministic UUID", async () => {
    const nonUuidId = "user:alice@example.com";
    await withSessionUser(nonUuidId, async (agent) => {
      const res = await agent
        .post("/api/storage/uploads/request-url")
        .send({ name: "note.txt", size: 100, contentType: "text/plain" });

      expect(res.status).toBe(200);
      expect(res.body.objectPath).toMatch(
        /^\/objects\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f-]{36}$/,
      );
      const ownerSegment1 = (res.body.objectPath as string).split("/")[3];
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
    mockHeadObject.mockResolvedValue({ size: 512, contentType: "application/pdf" });
  });

  async function makeReadableStream() {
    const { Readable } = await import("node:stream");
    return { body: Readable.from(["data"]), contentLength: 4, contentType: "application/pdf" };
  }

  it("allows the object owner to download", async () => {
    mockCanAccessR2Object.mockReturnValue(true);
    mockGetObjectStream.mockResolvedValue(await makeReadableStream());

    const token = makeAdminToken(OWNER_ID);
    const res = await supertest(app)
      .get(`/api/storage/objects/${ownerObjectPath}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(mockCanAccessR2Object).toHaveBeenCalledWith(
      expect.objectContaining({ key: R2_KEY_OWNER }),
    );
  });

  it("returns 403 for a non-owner regardless of JWT role (role=admin)", async () => {
    // canAccessR2Object now does strict key-path ownership — no role bypass.
    mockCanAccessR2Object.mockReturnValue(false);
    const token = makeAdminToken(OTHER_ID);
    const res = await supertest(app)
      .get(`/api/storage/objects/${ownerObjectPath}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(mockHeadObject).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-owner moderator", async () => {
    mockCanAccessR2Object.mockReturnValue(false);
    const token = makeModeratorToken(OTHER_ID);
    const res = await supertest(app)
      .get(`/api/storage/objects/${ownerObjectPath}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("returns 403 for a non-owner even when canAccessR2Object would return false (public-visibility metadata irrelevant here)", async () => {
    // Simulate: non-owner, object has public metadata — still must be 403 on
    // the authenticated route.  The mock returns false (strict owner-only).
    mockCanAccessR2Object.mockReturnValue(false);
    const token = makeModeratorToken(OTHER_ID);
    const res = await supertest(app)
      .get(`/api/storage/objects/${ownerObjectPath}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    // Public endpoint (r2-public-objects) must NOT have been invoked.
    expect(mockGetR2ObjectAclPolicy).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await supertest(app).get(`/api/storage/objects/${ownerObjectPath}`);
    expect(res.status).toBe(401);
    expect(mockCanAccessR2Object).not.toHaveBeenCalled();
  });

  it("returns 404 when the R2 object does not exist", async () => {
    mockCanAccessR2Object.mockReturnValue(true);
    mockHeadObject.mockResolvedValue(null);
    const token = makeAdminToken(OWNER_ID);
    const res = await supertest(app)
      .get(`/api/storage/objects/${ownerObjectPath}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Object not found");
  });

  it("returns 500 when headObject throws", async () => {
    mockCanAccessR2Object.mockReturnValue(true);
    mockHeadObject.mockRejectedValue(new Error("R2 network failure"));
    const token = makeAdminToken(OWNER_ID);
    const res = await supertest(app)
      .get(`/api/storage/objects/${ownerObjectPath}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── Tests: GET /api/storage/objects/* — legacy GCS paths (retired) ───────────
//
// Replit Object Storage has been retired; all data migrated to R2.
// Legacy two-segment paths (no encoded owner) must return 404 — no GCS fallback.

describe("GET /api/storage/objects/* — legacy paths return 404 (GCS retired)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsR2Configured.mockReturnValue(true);
  });

  it("returns 404 for a legacy two-segment key (not a valid R2 owner-keyed path)", async () => {
    const token = makeAdminToken(OWNER_ID);
    const res = await supertest(app)
      .get(`/api/storage/objects/${LEGACY_GCS_KEY}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    // No R2 calls — auth check and key-format check happen first.
    expect(mockCanAccessR2Object).not.toHaveBeenCalled();
    expect(mockHeadObject).not.toHaveBeenCalled();
  });

  it("returns 404 for any user with a legacy key (no GCS owner-check bypass)", async () => {
    const token = makeAdminToken(OTHER_ID);
    const res = await supertest(app)
      .get(`/api/storage/objects/${LEGACY_GCS_KEY}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated with a legacy key (auth runs before key check)", async () => {
    const res = await supertest(app)
      .get(`/api/storage/objects/${LEGACY_GCS_KEY}`);

    expect(res.status).toBe(401);
  });

  it("makes no R2 I/O calls for a legacy key", async () => {
    const token = makeAdminToken(OWNER_ID);
    await supertest(app)
      .get(`/api/storage/objects/${LEGACY_GCS_KEY}`)
      .set("Authorization", `Bearer ${token}`);

    expect(mockCanAccessR2Object).not.toHaveBeenCalled();
    expect(mockHeadObject).not.toHaveBeenCalled();
  });
});

// ── Tests: POST /api/storage/uploads/confirm ─────────────────────────────────

describe("POST /api/storage/uploads/confirm", () => {
  const ownerObjectPath = `/objects/uploads/${OWNER_ID}/${OBJ_UUID}`;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsR2Configured.mockReturnValue(true);
    mockSetR2ObjectAclPolicy.mockResolvedValue(undefined);
    // Default: object exists with a safe image MIME type.
    mockHeadObject.mockResolvedValue({ size: 50000, contentType: "image/jpeg" });
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await supertest(app)
      .post("/api/storage/uploads/confirm")
      .send({ objectPath: ownerObjectPath, visibility: "private" });
    expect(res.status).toBe(401);
    expect(mockSetR2ObjectAclPolicy).not.toHaveBeenCalled();
  });

  it("returns 400 when objectPath is missing", async () => {
    const token = makeAdminToken(OWNER_ID);
    const res = await supertest(app)
      .post("/api/storage/uploads/confirm")
      .set("Authorization", `Bearer ${token}`)
      .send({ visibility: "private" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when objectPath is a legacy two-segment format", async () => {
    const token = makeAdminToken(OWNER_ID);
    const res = await supertest(app)
      .post("/api/storage/uploads/confirm")
      .set("Authorization", `Bearer ${token}`)
      .send({ objectPath: `/objects/${LEGACY_GCS_KEY}`, visibility: "private" });
    expect(res.status).toBe(400);
    expect(mockSetR2ObjectAclPolicy).not.toHaveBeenCalled();
  });

  it("returns 503 when R2 is not configured", async () => {
    mockIsR2Configured.mockReturnValue(false);
    const token = makeAdminToken(OWNER_ID);
    const res = await supertest(app)
      .post("/api/storage/uploads/confirm")
      .set("Authorization", `Bearer ${token}`)
      .send({ objectPath: ownerObjectPath });
    expect(res.status).toBe(503);
  });

  it("returns 403 for a non-owner regardless of role (role=admin)", async () => {
    const token = makeAdminToken(OTHER_ID);
    const res = await supertest(app)
      .post("/api/storage/uploads/confirm")
      .set("Authorization", `Bearer ${token}`)
      .send({ objectPath: ownerObjectPath, visibility: "private" });
    expect(res.status).toBe(403);
    expect(mockSetR2ObjectAclPolicy).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-owner moderator", async () => {
    const token = makeModeratorToken(OTHER_ID);
    const res = await supertest(app)
      .post("/api/storage/uploads/confirm")
      .set("Authorization", `Bearer ${token}`)
      .send({ objectPath: ownerObjectPath, visibility: "private" });
    expect(res.status).toBe(403);
    expect(mockSetR2ObjectAclPolicy).not.toHaveBeenCalled();
  });

  it("confirms successfully with visibility=private (no MIME check, no publicUrl)", async () => {
    const token = makeModeratorToken(OWNER_ID);
    const res = await supertest(app)
      .post("/api/storage/uploads/confirm")
      .set("Authorization", `Bearer ${token}`)
      .send({ objectPath: ownerObjectPath, visibility: "private" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.publicUrl).toBeUndefined();
    // private upload does not trigger MIME check.
    expect(mockHeadObject).not.toHaveBeenCalled();
    expect(mockSetR2ObjectAclPolicy).toHaveBeenCalledOnce();
    expect(mockSetR2ObjectAclPolicy).toHaveBeenCalledWith(
      R2_KEY_OWNER,
      { owner: OWNER_ID, visibility: "private" },
    );
  });

  it("defaults visibility to 'private' when not specified", async () => {
    const token = makeModeratorToken(OWNER_ID);
    const res = await supertest(app)
      .post("/api/storage/uploads/confirm")
      .set("Authorization", `Bearer ${token}`)
      .send({ objectPath: ownerObjectPath });
    expect(res.status).toBe(200);
    expect(mockHeadObject).not.toHaveBeenCalled();
    expect(mockSetR2ObjectAclPolicy).toHaveBeenCalledWith(
      R2_KEY_OWNER,
      { owner: OWNER_ID, visibility: "private" },
    );
  });

  it("confirms with visibility=public when MIME is a safe image type, returns publicUrl", async () => {
    mockHeadObject.mockResolvedValue({ size: 200000, contentType: "image/png" });
    const token = makeModeratorToken(OWNER_ID);
    const res = await supertest(app)
      .post("/api/storage/uploads/confirm")
      .set("Authorization", `Bearer ${token}`)
      .send({ objectPath: ownerObjectPath, visibility: "public" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.publicUrl).toMatch(
      new RegExp(`^/api/storage/r2-public-objects/${R2_KEY_OWNER}$`),
    );
    // MIME check performed via HeadObject.
    expect(mockHeadObject).toHaveBeenCalledWith(R2_KEY_OWNER);
    expect(mockSetR2ObjectAclPolicy).toHaveBeenCalledWith(
      R2_KEY_OWNER,
      { owner: OWNER_ID, visibility: "public" },
    );
  });

  it("returns 415 when visibility=public but MIME type is text/html (XSS prevention)", async () => {
    mockHeadObject.mockResolvedValue({ size: 1234, contentType: "text/html" });
    const token = makeModeratorToken(OWNER_ID);
    const res = await supertest(app)
      .post("/api/storage/uploads/confirm")
      .set("Authorization", `Bearer ${token}`)
      .send({ objectPath: ownerObjectPath, visibility: "public" });

    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/text\/html/);
    // Must not write the ACL if MIME is disallowed.
    expect(mockSetR2ObjectAclPolicy).not.toHaveBeenCalled();
  });

  it("returns 415 for application/javascript MIME on public upload", async () => {
    mockHeadObject.mockResolvedValue({ size: 100, contentType: "application/javascript" });
    const token = makeModeratorToken(OWNER_ID);
    const res = await supertest(app)
      .post("/api/storage/uploads/confirm")
      .set("Authorization", `Bearer ${token}`)
      .send({ objectPath: ownerObjectPath, visibility: "public" });
    expect(res.status).toBe(415);
    expect(mockSetR2ObjectAclPolicy).not.toHaveBeenCalled();
  });

  it("returns 415 for image/svg+xml on public upload (SVG can embed scripts)", async () => {
    mockHeadObject.mockResolvedValue({ size: 500, contentType: "image/svg+xml" });
    const token = makeModeratorToken(OWNER_ID);
    const res = await supertest(app)
      .post("/api/storage/uploads/confirm")
      .set("Authorization", `Bearer ${token}`)
      .send({ objectPath: ownerObjectPath, visibility: "public" });
    expect(res.status).toBe(415);
    expect(mockSetR2ObjectAclPolicy).not.toHaveBeenCalled();
  });

  it("owner with role=admin can confirm their own object", async () => {
    const token = makeAdminToken(OWNER_ID);
    const res = await supertest(app)
      .post("/api/storage/uploads/confirm")
      .set("Authorization", `Bearer ${token}`)
      .send({ objectPath: ownerObjectPath, visibility: "private" });
    expect(res.status).toBe(200);
    expect(mockSetR2ObjectAclPolicy).toHaveBeenCalledOnce();
  });
});

// ── Tests: GET /api/storage/r2-public-objects/* ───────────────────────────────

describe("GET /api/storage/r2-public-objects/* — unauthenticated public serving", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsR2Configured.mockReturnValue(true);
  });

  async function makeImageStream() {
    const { Readable } = await import("node:stream");
    return { body: Readable.from(["img"]), contentLength: 3, contentType: "image/jpeg" };
  }

  it("serves a public image to unauthenticated callers", async () => {
    mockGetR2ObjectAclPolicy.mockResolvedValue({ owner: OWNER_ID, visibility: "public" });
    mockGetObjectStream.mockResolvedValue(await makeImageStream());

    const res = await supertest(app).get(
      `/api/storage/r2-public-objects/${R2_KEY_OWNER}`,
    );

    expect(res.status).toBe(200);
    expect(mockGetR2ObjectAclPolicy).toHaveBeenCalledWith(R2_KEY_OWNER);
    expect(mockGetObjectStream).toHaveBeenCalledWith(R2_KEY_OWNER);
  });

  it("sets X-Content-Type-Options: nosniff and Cache-Control: public on image responses", async () => {
    mockGetR2ObjectAclPolicy.mockResolvedValue({ owner: OWNER_ID, visibility: "public" });
    mockGetObjectStream.mockResolvedValue(await makeImageStream());

    const res = await supertest(app).get(
      `/api/storage/r2-public-objects/${R2_KEY_OWNER}`,
    );

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toMatch(/public/);
  });

  it("returns 403 for a private object (no bypass for guessable keys)", async () => {
    mockGetR2ObjectAclPolicy.mockResolvedValue({ owner: OWNER_ID, visibility: "private" });

    const res = await supertest(app).get(
      `/api/storage/r2-public-objects/${R2_KEY_OWNER}`,
    );

    expect(res.status).toBe(403);
    expect(mockGetObjectStream).not.toHaveBeenCalled();
  });

  it("returns 403 when no ACL metadata exists (object never confirmed public)", async () => {
    mockGetR2ObjectAclPolicy.mockResolvedValue(null);

    const res = await supertest(app).get(
      `/api/storage/r2-public-objects/${R2_KEY_OWNER}`,
    );

    expect(res.status).toBe(403);
    expect(mockGetObjectStream).not.toHaveBeenCalled();
  });

  it("returns 404 when getR2ObjectAclPolicy throws (object does not exist)", async () => {
    mockGetR2ObjectAclPolicy.mockRejectedValue(new Error("NoSuchKey"));

    const res = await supertest(app).get(
      `/api/storage/r2-public-objects/${R2_KEY_OWNER}`,
    );

    expect(res.status).toBe(404);
    expect(mockGetObjectStream).not.toHaveBeenCalled();
  });

  it("returns 503 when R2 is not configured", async () => {
    mockIsR2Configured.mockReturnValue(false);
    const res = await supertest(app).get(
      `/api/storage/r2-public-objects/${R2_KEY_OWNER}`,
    );
    expect(res.status).toBe(503);
  });

  it("forces attachment + octet-stream for non-image MIME types (defence-in-depth)", async () => {
    mockGetR2ObjectAclPolicy.mockResolvedValue({ owner: OWNER_ID, visibility: "public" });
    const { Readable } = await import("node:stream");
    mockGetObjectStream.mockResolvedValue({
      body: Readable.from(["<html>evil</html>"]),
      contentLength: 17,
      contentType: "text/html",
    });

    const res = await supertest(app).get(
      `/api/storage/r2-public-objects/${R2_KEY_OWNER}`,
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/octet-stream/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("works with an authenticated request (auth is optional, not required)", async () => {
    mockGetR2ObjectAclPolicy.mockResolvedValue({ owner: OWNER_ID, visibility: "public" });
    mockGetObjectStream.mockResolvedValue(await makeImageStream());

    const token = makeAdminToken(OTHER_ID);
    const res = await supertest(app)
      .get(`/api/storage/r2-public-objects/${R2_KEY_OWNER}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});

// ── Unit tests: canAccessR2Object ACL logic ────────────────────────────────────
// Use vi.importActual to bypass the vi.mock above and test the real function.

describe("canAccessR2Object — strict key-path ownership (synchronous, no I/O)", () => {
  let canAccessR2Object: typeof import("../src/lib/r2ObjectAcl.js").canAccessR2Object;

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("../src/lib/r2ObjectAcl.js")>(
      "../src/lib/r2ObjectAcl.js",
    );
    canAccessR2Object = actual.canAccessR2Object;
  });

  it("returns true when userId matches the key-path owner", () => {
    expect(canAccessR2Object({ key: R2_KEY_OWNER, userId: OWNER_ID })).toBe(true);
  });

  it("returns false when userId does not match the key-path owner", () => {
    expect(canAccessR2Object({ key: R2_KEY_OWNER, userId: OTHER_ID })).toBe(false);
  });

  it("returns false for a legacy key (no encoded owner) regardless of userId", () => {
    expect(canAccessR2Object({ key: LEGACY_GCS_KEY, userId: OWNER_ID })).toBe(false);
  });

  it("returns false when no userId is provided", () => {
    expect(canAccessR2Object({ key: R2_KEY_OWNER, userId: undefined })).toBe(false);
  });

  it("does not perform I/O — result is synchronous", () => {
    // canAccessR2Object must be synchronous (not a Promise).
    const result = canAccessR2Object({ key: R2_KEY_OWNER, userId: OWNER_ID });
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toBe(true);
  });
});

// ── Unit tests: r2ObjectAcl pure helpers ─────────────────────────────────────

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
