/**
 * Integration tests — Crash Assistant photo/PDF downloads after R2 migration.
 *
 * Properties verified:
 *   1. POST /accidents/:id/photos/request-upload returns an R2 presigned PUT URL.
 *   2. GET  /accidents/:id/photos/:photoId/url   returns a signed R2 GET URL.
 *   3. GET  /accidents/:id/report                generates a PDF, uploads to R2,
 *                                                and returns a signed download URL.
 *   4. GET  /tts                                 serves audio from R2 cache (cache HIT)
 *                                                on a second request without calling ElevenLabs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import supertest from "supertest";
import app from "../src/app.js";

// ── Hoisted mocks (must be declared before vi.mock calls are executed) ─────────

const PRESIGNED_PUT_URL  = "https://r2.example.com/put?sig=upload-token";
const PRESIGNED_GET_URL  = "https://r2.example.com/get?sig=download-token";

const { r2Mock, mockDb } = vi.hoisted(() => {
  const r2Mock = {
    isR2Configured:          vi.fn(() => true),
    getPresignedUploadUrl:   vi.fn().mockResolvedValue("https://r2.example.com/put?sig=upload-token"),
    getPresignedDownloadUrl: vi.fn().mockResolvedValue("https://r2.example.com/get?sig=download-token"),
    uploadBuffer:            vi.fn().mockResolvedValue(undefined),
    headObject:              vi.fn().mockResolvedValue(null),
    getObjectStream:         vi.fn(),
    deleteObject:            vi.fn().mockResolvedValue(undefined),
    clipKey:                 (deviceId: string, clipId: string) =>
      `dashcam/${deviceId}/${clipId}.mp4`,
  };

  const mockDb = {
    select:       vi.fn(),
    insert:       vi.fn(),
    delete_:      vi.fn(),
    update_:      vi.fn(),
    execute_:     vi.fn(),
    transaction_: vi.fn(),
  };

  return { r2Mock, mockDb };
});

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
    accidentRecordsTable:        { id: "id", deviceId: "device_id", pdfUrl: "pdf_url", pdfFileKey: "pdf_file_key", status: "status" },
    accidentPhotosTable:         { id: "id", accidentId: "accident_id", category: "category", fileKey: "file_key", storageUrl: "storage_url" },
    accidentWitnessesTable:      { id: "id", accidentId: "accident_id", createdAt: "created_at" },
    accidentTimelineEventsTable: { id: "id", accidentId: "accident_id", eventType: "event_type", occurredAt: "occurred_at" },
    eq:   vi.fn().mockImplementation((a: any, b: any) => ({ eq: [a, b] })),
    and:  vi.fn().mockImplementation((...args: any[]) => ({ and: args })),
    desc: vi.fn().mockImplementation((a: any) => ({ desc: a })),
  };
});

// ── Mock r2Storage ─────────────────────────────────────────────────────────────

vi.mock("../src/lib/r2Storage.js", () => r2Mock);

// ── DB mock helpers ────────────────────────────────────────────────────────────

function makeSelectBuilder(rows: any[]) {
  return {
    from:    vi.fn().mockReturnThis(),
    where:   vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit:   vi.fn().mockResolvedValue(rows),
    then:    (resolve: (v: any[]) => any) => Promise.resolve(rows).then(resolve),
  };
}

function makeUpdateBuilder() {
  const set   = vi.fn().mockReturnThis();
  const where = vi.fn().mockResolvedValue(undefined);
  return { set, where };
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DEVICE_ID   = "test-device-001";
const ACCIDENT_ID = "acc-abc123";
const PHOTO_ID    = "photo-xyz789";
const FILE_KEY    = `accidents/${ACCIDENT_ID}/photos/${PHOTO_ID}`;

const request = supertest(app);

// ── 1. Photo upload request: presigned PUT URL ─────────────────────────────────

describe("POST /api/accidents/:id/photos/request-upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    r2Mock.isR2Configured.mockReturnValue(true);
    r2Mock.getPresignedUploadUrl.mockResolvedValue(PRESIGNED_PUT_URL);

    // Ownership check: accident exists for this device
    mockDb.select.mockImplementation(() =>
      makeSelectBuilder([{ id: ACCIDENT_ID }])
    );

    // Insert photo row + timeline event
    mockDb.insert.mockImplementation(() => ({
      values: vi.fn().mockResolvedValue([]),
    }));
  });

  it("400 when deviceId is missing", async () => {
    const res = await request
      .post(`/api/accidents/${ACCIDENT_ID}/photos/request-upload`)
      .send({ category: "scene" });
    expect(res.status).toBe(400);
  });

  it("404 when accident does not belong to device", async () => {
    mockDb.select.mockImplementation(() => makeSelectBuilder([]));
    const res = await request
      .post(`/api/accidents/${ACCIDENT_ID}/photos/request-upload`)
      .send({ deviceId: DEVICE_ID, category: "scene" });
    expect(res.status).toBe(404);
  });

  it("503 when R2 is not configured", async () => {
    r2Mock.isR2Configured.mockReturnValue(false);
    const res = await request
      .post(`/api/accidents/${ACCIDENT_ID}/photos/request-upload`)
      .send({ deviceId: DEVICE_ID, category: "scene" });
    expect(res.status).toBe(503);
  });

  it("200 returns an R2 presigned PUT URL and a photoId", async () => {
    const res = await request
      .post(`/api/accidents/${ACCIDENT_ID}/photos/request-upload`)
      .send({ deviceId: DEVICE_ID, category: "scene" });

    expect(res.status).toBe(200);
    expect(res.body.uploadUrl).toBe(PRESIGNED_PUT_URL);
    expect(res.body.photoId).toBeTruthy();
    // Confirm getPresignedUploadUrl was called with a key under accidents/
    expect(r2Mock.getPresignedUploadUrl).toHaveBeenCalledWith(
      expect.stringContaining(`accidents/${ACCIDENT_ID}/photos/`),
      expect.any(String),
    );
  });

  it("200 uses audio/m4a content-type for audio_statement category", async () => {
    const res = await request
      .post(`/api/accidents/${ACCIDENT_ID}/photos/request-upload`)
      .send({ deviceId: DEVICE_ID, category: "audio_statement" });

    expect(res.status).toBe(200);
    expect(r2Mock.getPresignedUploadUrl).toHaveBeenCalledWith(
      expect.any(String),
      "audio/m4a",
    );
  });

  it("200 honours a valid client-supplied contentType from the allowlist", async () => {
    const res = await request
      .post(`/api/accidents/${ACCIDENT_ID}/photos/request-upload`)
      .send({ deviceId: DEVICE_ID, category: "scene", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(r2Mock.getPresignedUploadUrl).toHaveBeenCalledWith(
      expect.any(String),
      "image/png",
    );
  });
});

// ── 2. Photo download URL: signed R2 GET URL ──────────────────────────────────

describe("GET /api/accidents/:id/photos/:photoId/url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    r2Mock.getPresignedDownloadUrl.mockResolvedValue(PRESIGNED_GET_URL);

    let call = 0;
    mockDb.select.mockImplementation(() => {
      call++;
      if (call === 1) {
        // Ownership check: accident record found
        return makeSelectBuilder([{ id: ACCIDENT_ID }]);
      }
      // Photo row with fileKey
      return makeSelectBuilder([{
        id: PHOTO_ID,
        accidentId: ACCIDENT_ID,
        fileKey: FILE_KEY,
        category: "scene",
      }]);
    });
  });

  it("400 when deviceId query param is missing", async () => {
    const res = await request.get(`/api/accidents/${ACCIDENT_ID}/photos/${PHOTO_ID}/url`);
    expect(res.status).toBe(400);
  });

  it("404 when accident not found for this device", async () => {
    mockDb.select.mockImplementation(() => makeSelectBuilder([]));
    const res = await request
      .get(`/api/accidents/${ACCIDENT_ID}/photos/${PHOTO_ID}/url`)
      .query({ deviceId: DEVICE_ID });
    expect(res.status).toBe(404);
  });

  it("200 returns a signed R2 download URL for a stored photo", async () => {
    const res = await request
      .get(`/api/accidents/${ACCIDENT_ID}/photos/${PHOTO_ID}/url`)
      .query({ deviceId: DEVICE_ID });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe(PRESIGNED_GET_URL);
    expect(r2Mock.getPresignedDownloadUrl).toHaveBeenCalledWith(FILE_KEY);
  });
});

// ── 3. PDF report: R2 upload + signed download URL ────────────────────────────

describe("GET /api/accidents/:id/report", () => {
  const baseRecord = {
    id: ACCIDENT_ID,
    deviceId: DEVICE_ID,
    isManual: false,
    status: "draft",
    detectedAt: new Date("2024-01-15T10:00:00Z"),
    lat: "-1.2921",
    lng: "36.8219",
    roadName: "Uhuru Highway",
    county: "Nairobi",
    nearbyLandmark: null,
    speedBeforeKmh: "60",
    speedAtImpactKmh: "0",
    headingDeg: null,
    directionLabel: "Northbound",
    tripStartAt: null,
    destinationName: null,
    distanceM: null,
    durationS: null,
    weatherJson: null,
    otherDriverJson: null,
    policeJson: null,
    driverStatement: null,
    pdfUrl: null,
    pdfFileKey: null,
    dashcamClipId: null,
    createdAt: new Date("2024-01-15T10:00:00Z"),
    updatedAt: new Date("2024-01-15T10:00:00Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    r2Mock.isR2Configured.mockReturnValue(true);
    r2Mock.uploadBuffer.mockResolvedValue(undefined);
    r2Mock.getPresignedDownloadUrl.mockResolvedValue(PRESIGNED_GET_URL);

    let call = 0;
    mockDb.select.mockImplementation(() => {
      call++;
      if (call === 1) return makeSelectBuilder([baseRecord]);   // accident record
      if (call === 2) return makeSelectBuilder([]);              // photos
      if (call === 3) return makeSelectBuilder([]);              // witnesses
      return makeSelectBuilder([]);                              // timeline
    });

    mockDb.update_.mockImplementation(() => makeUpdateBuilder());
    mockDb.insert.mockImplementation(() => ({
      values: vi.fn().mockResolvedValue([]),
    }));
  });

  it("400 when deviceId is missing", async () => {
    const res = await request.get(`/api/accidents/${ACCIDENT_ID}/report`);
    expect(res.status).toBe(400);
  });

  it("404 when accident not found", async () => {
    mockDb.select.mockImplementation(() => makeSelectBuilder([]));
    const res = await request
      .get(`/api/accidents/${ACCIDENT_ID}/report`)
      .query({ deviceId: DEVICE_ID });
    expect(res.status).toBe(404);
  });

  it("503 when R2 is not configured", async () => {
    r2Mock.isR2Configured.mockReturnValue(false);
    const res = await request
      .get(`/api/accidents/${ACCIDENT_ID}/report`)
      .query({ deviceId: DEVICE_ID });
    expect(res.status).toBe(503);
  });

  it("200 generates PDF, uploads to R2, returns a signed URL (cache MISS)", async () => {
    const res = await request
      .get(`/api/accidents/${ACCIDENT_ID}/report`)
      .query({ deviceId: DEVICE_ID });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe(PRESIGNED_GET_URL);
    expect(res.body.cached).toBe(false);

    // Verify the PDF was uploaded to R2 under the expected key
    expect(r2Mock.uploadBuffer).toHaveBeenCalledWith(
      `accidents/${ACCIDENT_ID}/report.pdf`,
      expect.any(Buffer),
      "application/pdf",
    );
    expect(r2Mock.getPresignedDownloadUrl).toHaveBeenCalledWith(
      `accidents/${ACCIDENT_ID}/report.pdf`,
    );
  });

  it("200 returns cached URL when pdfFileKey already set (no re-upload)", async () => {
    const cachedRecord = { ...baseRecord, pdfUrl: "old-url", pdfFileKey: `accidents/${ACCIDENT_ID}/report.pdf` };

    // All four selects return the cached record / empty arrays
    let call = 0;
    mockDb.select.mockImplementation(() => {
      call++;
      if (call === 1) return makeSelectBuilder([cachedRecord]);
      if (call === 2) return makeSelectBuilder([]);
      if (call === 3) return makeSelectBuilder([]);
      return makeSelectBuilder([]);
    });

    const res = await request
      .get(`/api/accidents/${ACCIDENT_ID}/report`)
      .query({ deviceId: DEVICE_ID });

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    // Should NOT re-upload the PDF
    expect(r2Mock.uploadBuffer).not.toHaveBeenCalled();
  });
});

// ── 4. TTS: R2 cache HIT on second call ──────────────────────────────────────

describe("GET /api/tts — R2 cache", () => {
  const TEXT = "Speed camera ahead, slow down";

  // Helper: build a minimal Readable stream from a Buffer
  function makeStream(buf: Buffer) {
    const { Readable } = require("stream");
    const stream = new Readable({ read() {} });
    stream.push(buf);
    stream.push(null);
    return stream;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    r2Mock.isR2Configured.mockReturnValue(true);
    // Default: no cached object
    r2Mock.headObject.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("400 when text param is missing", async () => {
    const res = await request.get("/api/tts");
    expect(res.status).toBe(400);
  });

  it("503 when R2 is not configured", async () => {
    r2Mock.isR2Configured.mockReturnValue(false);

    // Still need ELEVENLABS_API_KEY env so we get past the apiKey check
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");

    const res = await request.get("/api/tts").query({ text: TEXT });
    expect(res.status).toBe(503);
  });

  it("serves from R2 cache (X-TTS-Cache: HIT) when the object already exists", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");

    const audioBuf = Buffer.from("fake-mp3-data");

    // headObject returns metadata → cache hit path
    r2Mock.headObject.mockResolvedValue({ size: audioBuf.length, contentType: "audio/mpeg" });
    r2Mock.getObjectStream.mockResolvedValue({
      body:          makeStream(audioBuf),
      contentLength: audioBuf.length,
      contentType:   "audio/mpeg",
    });

    const res = await request.get("/api/tts").query({ text: TEXT });

    expect(res.status).toBe(200);
    expect(res.headers["x-tts-cache"]).toBe("HIT");
    expect(res.headers["content-type"]).toMatch(/audio\/mpeg/);
    // ElevenLabs must NOT have been called
    expect(r2Mock.uploadBuffer).not.toHaveBeenCalled();
  });

  it("calls ElevenLabs and caches result in R2 on cache MISS (X-TTS-Cache: MISS)", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");

    const audioBuf = Buffer.from("generated-mp3-data");

    // headObject: miss
    r2Mock.headObject.mockResolvedValue(null);
    r2Mock.uploadBuffer.mockResolvedValue(undefined);

    // Stub global fetch to simulate a successful ElevenLabs response
    const fetchSpy = vi.fn().mockResolvedValue({
      ok:          true,
      arrayBuffer: async () => audioBuf.buffer,
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request.get("/api/tts").query({ text: TEXT });

    expect(res.status).toBe(200);
    expect(res.headers["x-tts-cache"]).toBe("MISS");
    expect(res.headers["content-type"]).toMatch(/audio\/mpeg/);

    // ElevenLabs endpoint was called
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("elevenlabs.io"),
      expect.objectContaining({ method: "POST" }),
    );

    // Result was saved to R2 (async, non-blocking — allow a tick for the promise)
    await new Promise((r) => setTimeout(r, 10));
    expect(r2Mock.uploadBuffer).toHaveBeenCalledWith(
      expect.stringContaining("tts/alert/"),
      expect.any(Buffer),
      "audio/mpeg",
    );
  });
});
