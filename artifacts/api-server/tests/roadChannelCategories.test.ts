import { describe, expect, it } from "vitest";
import { resolveRoadChannelCategory } from "../src/lib/roadChannelCategories.js";

describe("Road Channel selected categories", () => {
  it("maps every mobile selection to the community report type", () => {
    expect(resolveRoadChannelCategory("speed_camera")).toBe("camera");
    expect(resolveRoadChannelCategory("police_checkpoint")).toBe("police");
    expect(resolveRoadChannelCategory("alcoblow")).toBe("alcoblow");
    expect(resolveRoadChannelCategory("accident")).toBe("accident");
    expect(resolveRoadChannelCategory("traffic")).toBe("traffic");
    expect(resolveRoadChannelCategory("roadblock")).toBe("roadblock");
    expect(resolveRoadChannelCategory("roadworks")).toBe("roadworks");
    expect(resolveRoadChannelCategory("hazard")).toBe("hazard");
    expect(resolveRoadChannelCategory("speed_bump")).toBe("speed_bump");
    expect(resolveRoadChannelCategory("pothole")).toBe("pothole");
    expect(resolveRoadChannelCategory("debris")).toBe("debris");
    expect(resolveRoadChannelCategory("breakdown")).toBe("breakdown");
    expect(resolveRoadChannelCategory("bad_weather")).toBe("weather");
    expect(resolveRoadChannelCategory("road_closed")).toBe("closure");
    expect(resolveRoadChannelCategory("road_clear")).toBe("clear");
    expect(resolveRoadChannelCategory("other")).toBe("other");
  });

  it("rejects missing and unsupported categories", () => {
    expect(resolveRoadChannelCategory(undefined)).toBeNull();
    expect(resolveRoadChannelCategory("")).toBeNull();
    expect(resolveRoadChannelCategory("camera")).toBeNull();
    expect(resolveRoadChannelCategory("flooding")).toBeNull();
  });
});