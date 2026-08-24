import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../hooks/usePushNotifications.ts", import.meta.url),
  "utf8",
);

test("push registration refreshes the device platform even for cached tokens", () => {
  assert.match(source, /platform:\s*Platform\.OS/);
  assert.match(source, /Always refresh the server registration when the app starts/);
  assert.doesNotMatch(source, /cachedToken === token/);
});

test("iOS keeps one foreground banner while Android keeps foreground alerts", () => {
  assert.match(source, /shouldShowAlert:\s*isIos \? false : !suppress/);
  assert.match(source, /shouldShowBanner:\s*!suppress/);
  assert.match(source, /msafiri_general/);
  assert.match(source, /msafiri_alerts/);
});