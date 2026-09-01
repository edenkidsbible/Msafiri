import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const iosVoice = fs.readFileSync(new URL("../utils/alertTts.ts", import.meta.url), "utf8");
const androidVoice = fs.readFileSync(new URL("../utils/alertTts.android.ts", import.meta.url), "utf8");

for (const [platform, source] of [["iOS", iosVoice], ["Android", androidVoice]]) {
  test(`${platform} alert audio uses a bounded native-player cache`, () => {
    assert.match(source, /MAX_CACHED_PLAYERS\s*=\s*4/);
    assert.match(source, /playerCache\.size\s*>\s*MAX_CACHED_PLAYERS/);
    assert.doesNotMatch(
      source,
      /for\s*\(const key of Object\.keys\(ALERT_AUDIO\)\)\s*(?:\{)?\s*getCachedPlayer/,
    );
  });

  test(`${platform} waits for rewind before playing a cached alert`, () => {
    assert.match(source, /await (?:cached|player)\.seekTo\(0\)/);
  });

  test(`${platform} plays foreground voice alerts at full volume`, () => {
    assert.match(source, /(?:cached|player)\.volume\s*=\s*1/);
  });
}