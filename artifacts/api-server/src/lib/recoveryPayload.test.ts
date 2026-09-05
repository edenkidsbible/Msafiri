import { describe, expect, it } from "vitest";
import {
  parseSettingsSnapshot,
  parseVehiclesSnapshot,
  mergeRestorableBackups,
  selectRestorableBackup,
} from "./recoveryPayload.js";

const vehicle = {
  id: "vehicle-1",
  vehicleType: "car",
  makeId: "toyota",
  modelId: "corolla",
};

describe("recovery backup selection", () => {
  it("prefers an older complete snapshot over the newest empty snapshot", () => {
    const selected = selectRestorableBackup([
      { id: "new-empty", vehicles_json: "[]", settings_json: "{}" },
      { id: "old-complete", vehicles_json: JSON.stringify([vehicle]), settings_json: "{}" },
    ]);

    expect(selected?.backup.id).toBe("old-complete");
    expect(selected?.vehicles).toEqual([vehicle]);
  });

  it("keeps a parseable empty snapshot as a partial-recovery fallback", () => {
    const selected = selectRestorableBackup([
      { id: "empty", vehicles_json: "[]", settings_json: "{}" },
    ]);

    expect(selected?.backup.id).toBe("empty");
    expect(selected?.vehicles).toEqual([]);
  });

  it("rejects malformed and structurally invalid vehicle snapshots", () => {
    expect(parseVehiclesSnapshot("{broken")).toBeNull();
    expect(parseVehiclesSnapshot(JSON.stringify([{ id: "missing-type" }]))).toBeNull();
  });

  it("uses an empty settings object for malformed settings", () => {
    expect(parseSettingsSnapshot("[]")).toEqual({});
    expect(parseSettingsSnapshot("{broken")).toEqual({});
  });

  it("merges distinct legacy snapshots and keeps the newest vehicle version", () => {
    const newerVehicle = { ...vehicle, modelId: "newer-model" };
    const secondVehicle = { ...vehicle, id: "vehicle-2", modelId: "hilux" };
    const malformed = { id: "malformed", vehicles_json: "{broken", settings_json: "{}" };
    const merged = mergeRestorableBackups([
      { id: "newer", vehicles_json: JSON.stringify([newerVehicle]), settings_json: "{}" },
      { id: "older", vehicles_json: JSON.stringify([vehicle, secondVehicle]), settings_json: "{}" },
      malformed,
    ]);

    expect(merged?.vehicles).toEqual([newerVehicle, secondVehicle]);
    expect(merged?.validBackups.map((backup) => backup.id)).toEqual(["newer", "older"]);
    expect(merged?.malformedBackups).toEqual([malformed]);
  });
});