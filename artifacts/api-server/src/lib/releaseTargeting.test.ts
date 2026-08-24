import { describe, expect, it } from "vitest";
import { releaseTargetsDevice } from "./releaseTargeting.js";

describe("releaseTargetsDevice", () => {
  it("targets only iOS devices for an iOS release", () => {
    expect(releaseTargetsDevice("ios", "ios")).toBe(true);
    expect(releaseTargetsDevice("ios", "android")).toBe(false);
    expect(releaseTargetsDevice("ios", "unknown")).toBe(false);
  });

  it("targets only Android devices for an Android release", () => {
    expect(releaseTargetsDevice("android", "android")).toBe(true);
    expect(releaseTargetsDevice("android", "ios")).toBe(false);
    expect(releaseTargetsDevice("android", null)).toBe(false);
  });

  it("keeps deliberate all-platform releases compatible with every device", () => {
    expect(releaseTargetsDevice("all", "ios")).toBe(true);
    expect(releaseTargetsDevice("all", "android")).toBe(true);
    expect(releaseTargetsDevice("all", "unknown")).toBe(true);
  });
});