import { describe, expect, it } from "vitest";
import { detectVoiceReportType } from "../src/lib/roadChannelKeywords.js";

describe("Road Channel voice keywords", () => {
  it("uses camera as a speed-camera report even in mixed-language speech", () => {
    expect(detectVoiceReportType("Niko kwa barabara, camera iko mbele please")).toEqual({
      type: "camera",
      keyword: "camera",
    });
  });

  it("recognizes common Swahili keywords", () => {
    expect(detectVoiceReportType("Kuna ajali mbele")).toEqual({ type: "accident", keyword: "ajali" });
    expect(detectVoiceReportType("Kuna foleni kubwa")).toEqual({ type: "traffic", keyword: "foleni" });
    expect(detectVoiceReportType("Gari imeharibika")).toEqual({ type: "breakdown", keyword: "gari imeharibika" });
  });

  it("prefers a specific report keyword over broad traffic words", () => {
    expect(detectVoiceReportType("Traffic jam near the speed camera")).toEqual({
      type: "camera",
      keyword: "speed camera",
    });
  });

  it("does not match keywords inside unrelated words", () => {
    expect(detectVoiceReportType("The camera road is clear")).toEqual({ type: "camera", keyword: "camera" });
    expect(detectVoiceReportType("Everything is normal today")).toBeNull();
  });
});