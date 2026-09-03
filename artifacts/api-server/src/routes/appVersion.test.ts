import { describe, expect, it } from "vitest";
import { isReleaseNewer } from "./appVersion.js";

describe("native release comparison", () => {
  it("requires Android build 51 when the installed build is 50", () => {
    expect(isReleaseNewer("2.0.3", 50, "2.0.3", 51)).toBe(true);
  });

  it("requires iOS build 50 when the installed build is 49", () => {
    expect(isReleaseNewer("2.0.3", 49, "2.0.3", 50)).toBe(true);
  });

  it("does not require an update for the same build", () => {
    expect(isReleaseNewer("2.0.3", 50, "2.0.3", 50)).toBe(false);
  });

  it("still prioritizes semantic version changes over build numbers", () => {
    expect(isReleaseNewer("2.0.3", 50, "2.0.4", 1)).toBe(true);
    expect(isReleaseNewer("2.0.4", 1, "2.0.3", 99)).toBe(false);
  });
});