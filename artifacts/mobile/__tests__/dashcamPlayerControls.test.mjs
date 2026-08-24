import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../components/VideoPlayerModal.tsx", import.meta.url),
  "utf8",
);

test("dashcam player keeps the core controls available during playback", () => {
  assert.match(source, /accessibilityLabel="Back to clips"/);
  assert.match(source, /accessibilityLabel=\{playing \? "Pause clip" : "Play clip"\}/);
  assert.match(source, /accessibilityLabel="Rewind 15 seconds"/);
  assert.match(source, /accessibilityLabel="Forward 15 seconds"/);
  assert.match(source, /onPress=\{togglePlayback\}/);
  assert.match(source, /onPress=\{\(\) => seekBy\(-15\)\}/);
  assert.match(source, /onPress=\{\(\) => seekBy\(15\)\}/);
});

test("the player handles Android back and replay from the end", () => {
  assert.match(source, /onRequestClose=\{onClose\}/);
  assert.match(source, /if \(dur > 0 && ct >= dur - 0\.15\) player\.currentTime = 0/);
  assert.doesNotMatch(source, /setTimeout\(timerRef/);
});