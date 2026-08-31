import { describe, expect, it } from "vitest";
import {
  PILOT_CORRIDORS,
  pilotDirection,
  resolvePilotCorridor,
  shouldHandoff,
} from "../src/lib/roadChannelPilot.js";

describe("Road Channels pilot catalog", () => {
  it("contains only the configured pilot corridors", () => {
    expect(PILOT_CORRIDORS.map((road) => road.id)).toEqual([
      "thika-superhighway",
      "mombasa-road",
      "nairobi-expressway",
      "waiyaki-way",
      "ngong-road",
      "langata-road",
      "kiambu-road",
      "limuru-road",
      "eastern-bypass",
      "northern-bypass",
      "southern-bypass",
      "kangundo-road",
    ]);
  });

  it("resolves common road names and route aliases", () => {
    expect(resolvePilotCorridor("Thika Road")?.id).toBe("thika-superhighway");
    expect(resolvePilotCorridor("A109")?.id).toBe("mombasa-road");
    expect(resolvePilotCorridor("Lang'ata Road")?.id).toBe("langata-road");
    expect(resolvePilotCorridor("Kisumu Busia Road")).toBeNull();
  });

  it("classifies inbound, outbound, and uncertain headings", () => {
    const thika = resolvePilotCorridor("Thika Road")!;
    expect(pilotDirection(thika, 20)).toBe("outbound");
    expect(pilotDirection(thika, 205)).toBe("inbound");
    expect(pilotDirection(thika, 110)).toBe("unknown");
  });

  it("requires stable repeated evidence before a handoff", () => {
    expect(shouldHandoff("thika-superhighway", ["mombasa-road"])).toBe(false);
    expect(shouldHandoff("thika-superhighway", ["mombasa-road", "thika-superhighway"])).toBe(false);
    expect(shouldHandoff("thika-superhighway", ["mombasa-road", "mombasa-road"])).toBe(true);
  });
});