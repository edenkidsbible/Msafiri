/**
 * Unit tests for smsleopard.sendSms
 *
 * Verifies that every failure mode (HTTP error, success:false, bad recipient
 * status, restricted_send_time, missing credentials) is captured and surfaced
 * with full detail — so nothing is silently swallowed.
 *
 * All tests stub global fetch via vi.stubGlobal so no real network call is
 * made.  Env vars are set/reset per test to avoid cross-test leakage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendSms, SmsRestrictedTimeError, detectCarrier } from "../src/lib/smsleopard";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFetchOk(body: object) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  });
}

function makeFetchHttpError(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: async () => body,
    json: async () => { throw new Error("not json"); },
  });
}

const CREDS = {
  SMSLEOPARD_API_KEY:    "test-key",
  SMSLEOPARD_API_SECRET: "test-secret",
  SMSLEOPARD_SENDER_ID:  "TEST",
};

function setEnv(extra: Record<string, string> = {}) {
  Object.assign(process.env, CREDS, extra);
}

function clearEnv() {
  for (const k of ["SMSLEOPARD_API_KEY", "SMSLEOPARD_API_SECRET", "SMSLEOPARD_SENDER_ID"]) {
    delete process.env[k];
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("sendSms", () => {
  beforeEach(() => { setEnv(); });
  afterEach(() => { clearEnv(); vi.restoreAllMocks(); });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it("returns true when SMSLeopard responds with success + queued status", async () => {
    const successBody = {
      success: true,
      message: "Success",
      recipients: [{ id: "1", cost: 1, number: "+254712345678", status: "queued" }],
    };
    vi.stubGlobal("fetch", makeFetchOk(successBody));

    const result = await sendSms("+254712345678", "Test OTP: 123456");
    expect(result).toBe(true);
  });

  it("returns true when recipient status is 'sent'", async () => {
    const successBody = {
      success: true,
      message: "Sent",
      recipients: [{ id: "2", cost: 1, number: "+254733123456", status: "sent" }],
    };
    vi.stubGlobal("fetch", makeFetchOk(successBody));

    const result = await sendSms("+254733123456", "Test OTP: 654321");
    expect(result).toBe(true);
  });

  // ── Missing credentials ─────────────────────────────────────────────────────

  it("returns false (no throw) when API key is missing", async () => {
    delete process.env.SMSLEOPARD_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendSms("+254712345678", "OTP");
    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns false (no throw) when API secret is missing", async () => {
    delete process.env.SMSLEOPARD_API_SECRET;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendSms("+254712345678", "OTP");
    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── HTTP-level errors ───────────────────────────────────────────────────────

  it("throws with HTTP status and full body on 400 response", async () => {
    vi.stubGlobal("fetch", makeFetchHttpError(400, '{"error":"Bad request"}'));

    await expect(sendSms("+254712345678", "OTP")).rejects.toThrow(
      /SMSLeopard HTTP 400/
    );
  });

  it("throws with HTTP status and full body on 401 response", async () => {
    vi.stubGlobal("fetch", makeFetchHttpError(401, "Unauthorized"));

    await expect(sendSms("+254712345678", "OTP")).rejects.toThrow(
      /SMSLeopard HTTP 401/
    );
  });

  it("throws with HTTP status and full body on 500 response", async () => {
    vi.stubGlobal("fetch", makeFetchHttpError(500, "Internal Server Error — upstream timeout"));

    await expect(sendSms("+254712345678", "OTP")).rejects.toThrow(
      /SMSLeopard HTTP 500/
    );
  });

  it("includes the raw body in the thrown error for HTTP errors", async () => {
    vi.stubGlobal("fetch", makeFetchHttpError(422, "invalid_sender_id"));

    try {
      await sendSms("+254712345678", "OTP");
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.message).toContain("invalid_sender_id");
    }
  });

  // ── success:false paths ─────────────────────────────────────────────────────

  it("throws with SMSLeopard message when success is false", async () => {
    const body = {
      success: false,
      message: "Insufficient credit",
      recipients: [],
    };
    vi.stubGlobal("fetch", makeFetchOk(body));

    await expect(sendSms("+254712345678", "OTP")).rejects.toThrow(
      /Insufficient credit/
    );
  });

  it("includes recipient status in error when success is false and status is present", async () => {
    const body = {
      success: false,
      message: "Delivery failed",
      recipients: [{ id: "3", cost: 0, number: "+254712345678", status: "blacklisted" }],
    };
    vi.stubGlobal("fetch", makeFetchOk(body));

    await expect(sendSms("+254712345678", "OTP")).rejects.toThrow(
      /blacklisted/
    );
  });

  it("throws SmsRestrictedTimeError when success:false + restricted_send_time status", async () => {
    const body = {
      success: false,
      message: "Cannot send at this time",
      recipients: [{ id: "4", cost: 0, number: "+254712345678", status: "restricted_send_time" }],
    };
    vi.stubGlobal("fetch", makeFetchOk(body));

    await expect(sendSms("+254712345678", "OTP")).rejects.toBeInstanceOf(
      SmsRestrictedTimeError
    );
  });

  // ── Post-success recipient delivery failures ────────────────────────────────

  it("throws when success:true but a recipient has a non-queued/sent status", async () => {
    const body = {
      success: true,
      message: "Partial",
      recipients: [{ id: "5", cost: 0, number: "+254712345678", status: "failed" }],
    };
    vi.stubGlobal("fetch", makeFetchOk(body));

    await expect(sendSms("+254712345678", "OTP")).rejects.toThrow(
      /delivery failed.*failed/i
    );
  });

  it("includes the number in the error when delivery fails post-success", async () => {
    const number = "+254760123456";
    const body = {
      success: true,
      message: "Partial",
      recipients: [{ id: "6", cost: 0, number, status: "expired" }],
    };
    vi.stubGlobal("fetch", makeFetchOk(body));

    try {
      await sendSms(number, "OTP");
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.message).toContain(number);
    }
  });

  it("throws SmsRestrictedTimeError when a recipient status is restricted_send_time (success:true path)", async () => {
    const body = {
      success: true,
      message: "Queued",
      recipients: [{ id: "7", cost: 0, number: "+254712345678", status: "restricted_send_time" }],
    };
    vi.stubGlobal("fetch", makeFetchOk(body));

    await expect(sendSms("+254712345678", "OTP")).rejects.toBeInstanceOf(
      SmsRestrictedTimeError
    );
  });

  // ── Carrier coverage (validates real sends would hit correct carrier log) ───

  it.each([
    ["+254712345678", "Safaricom"],
    ["+254733123456", "Airtel"],
    ["+254760123456", "Telkom"],
  ])("identifies %s as %s for logging", (number, expectedCarrier) => {
    // detectCarrier is used for logging inside sendSms; verify it's correct
    // so the carrier label in error messages is accurate.
    expect(detectCarrier(number)).toBe(expectedCarrier);
  });
});

// ── End-to-end OTP route contract (no DB, no real fetch) ─────────────────────

describe("sendSms error capture — OTP route contract", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("propagates the full SMSLeopard error so the OTP route can log it", async () => {
    setEnv();

    const errorBody = '{"error":"sender_id_not_approved","sender_id":"MSAFIRI"}';
    vi.stubGlobal("fetch", makeFetchHttpError(403, errorBody));

    let caught: Error | null = null;
    try {
      await sendSms("+254712345678", "OTP: 111222");
    } catch (e: any) {
      caught = e;
    }

    expect(caught).not.toBeNull();
    // The OTP route logs err.message — verify it contains actionable detail
    expect(caught!.message).toContain("403");
    expect(caught!.message).toContain("sender_id_not_approved");
    clearEnv();
  });
});
