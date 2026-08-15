import { describe, it, expect } from "vitest";
import { detectCarrier } from "../src/lib/smsleopard";

describe("detectCarrier", () => {
  // ── Safaricom ────────────────────────────────────────────────────────────────
  describe("Safaricom", () => {
    it.each([
      // Full 070x range
      "+254700123456", "+254705123456", "+254709123456",
      // Full 071x range
      "+254710123456", "+254715123456", "+254719123456",
      // Full 072x range
      "+254720123456", "+254725123456", "+254729123456",
      // 0740–0743 (Safaricom share of 074x)
      "+254740123456", "+254741123456", "+254742123456", "+254743123456",
      // 079x
      "+254790123456", "+254795123456", "+254799123456",
      // 011x
      "+254110123456", "+254115123456", "+254119123456",
    ])("classifies %s as Safaricom", (num) => {
      expect(detectCarrier(num)).toBe("Safaricom");
    });

    it("handles local 07xx format", () => {
      expect(detectCarrier("0722123456")).toBe("Safaricom");
      expect(detectCarrier("0711123456")).toBe("Safaricom");
    });

    it("handles 254 prefix (no leading +)", () => {
      expect(detectCarrier("254700123456")).toBe("Safaricom");
    });
  });

  // ── Airtel ───────────────────────────────────────────────────────────────────
  describe("Airtel", () => {
    it.each([
      // 073x
      "+254730123456", "+254733123456", "+254739123456",
      // 0744–0749 (Airtel share of 074x)
      "+254744123456", "+254746123456", "+254749123456",
      // Full 075x range
      "+254750123456", "+254755123456", "+254759123456",
      // 078x
      "+254780123456", "+254785123456", "+254789123456",
      // 010x
      "+254100123456", "+254105123456", "+254109123456",
    ])("classifies %s as Airtel", (num) => {
      expect(detectCarrier(num)).toBe("Airtel");
    });

    it("handles local 073x format", () => {
      expect(detectCarrier("0733123456")).toBe("Airtel");
    });
  });

  // ── Telkom ───────────────────────────────────────────────────────────────────
  describe("Telkom", () => {
    it.each([
      // 076x
      "+254760123456", "+254763123456", "+254769123456",
      // 077x
      "+254770123456", "+254773123456",
      "+254776123456", "+254779123456",
    ])("classifies %s as Telkom", (num) => {
      expect(detectCarrier(num)).toBe("Telkom");
    });

    it("handles local 076x format", () => {
      expect(detectCarrier("0768123456")).toBe("Telkom");
    });

    it("handles local 077x format", () => {
      expect(detectCarrier("0771123456")).toBe("Telkom");
    });
  });

  // ── 074x boundary — must not bleed across carriers ──────────────────────────
  describe("074x split boundary", () => {
    it("0743 is Safaricom", () => expect(detectCarrier("+254743000000")).toBe("Safaricom"));
    it("0744 is Airtel",    () => expect(detectCarrier("+254744000000")).toBe("Airtel"));
  });

  // ── 010x / 011x boundary — must not bleed across carriers ───────────────────
  describe("010x / 011x boundary", () => {
    it("0100 is Airtel",    () => expect(detectCarrier("+254100000000")).toBe("Airtel"));
    it("0109 is Airtel",    () => expect(detectCarrier("+254109000000")).toBe("Airtel"));
    it("0110 is Safaricom", () => expect(detectCarrier("+254110000000")).toBe("Safaricom"));
    it("0119 is Safaricom", () => expect(detectCarrier("+254119000000")).toBe("Safaricom"));
  });

  // ── Unallocated / non-Kenyan ─────────────────────────────────────────────────
  describe("unknown carrier", () => {
    it("returns 'unknown carrier' for non-Kenyan number", () => {
      expect(detectCarrier("+12025550100")).toBe("unknown carrier");
    });
    it("returns 'unknown carrier' for empty string", () => {
      expect(detectCarrier("")).toBe("unknown carrier");
    });
  });
});
