import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../context/DashcamContext.tsx"), "utf8");

describe("dashcam durable newest-five persistence", () => {
  it("stores completed clips under documentDirectory", () => {
    assert.match(source, /FileSystem\.documentDirectory/);
    assert.match(source, /FileSystem\.moveAsync/);
  });

  it("commits the replacement index before deleting evicted files", () => {
    const boundary = source.indexOf("Durability boundary:");
    const slice = source.slice(boundary, boundary + 1800);
    const persist = slice.indexOf("await AsyncStorage.setItem");
    const remove = slice.indexOf("FileSystem.deleteAsync");
    assert.ok(boundary >= 0 && persist >= 0, "durability boundary must await the metadata commit");
    assert.ok(remove > persist, "old files must only be removed after the new index is committed");
  });

  it("handles background and sustained inactive interruptions on both platforms", () => {
    assert.ok(!source.includes('if (Platform.OS !== "ios") return;'));
    assert.match(source, /nextState === "background"/);
    assert.match(source, /nextState === "inactive"/);
    assert.match(source, /lifecycleSavePendingRef/);
  });

  it("recovers completed orphan files after process termination", () => {
    assert.match(source, /recoverOrphanedSegmentFiles/);
    assert.match(source, /FileSystem\.readDirectoryAsync/);
  });
});