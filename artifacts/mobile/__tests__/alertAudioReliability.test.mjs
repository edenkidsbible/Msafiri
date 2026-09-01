import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const iosVoice = fs.readFileSync(new URL("../utils/alertTts.ts", import.meta.url), "utf8");
const androidVoice = fs.readFileSync(new URL("../utils/alertTts.android.ts", import.meta.url), "utf8");
const iosSound = fs.readFileSync(new URL("../utils/sound.ts", import.meta.url), "utf8");
const androidSound = fs.readFileSync(new URL("../utils/sound.android.ts", import.meta.url), "utf8");

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

  test(`${platform} plays Yna voice alerts at 50 percent volume`, () => {
    assert.match(source, /(?:cached|player|remotePlayer)\.volume\s*=\s*0\.5/);
  });
}

test("foreground alerts pause competing Bluetooth media instead of mixing", () => {
  for (const source of [iosSound, androidSound]) {
    assert.match(source, /interruptionMode:\s*"doNotMix"/);
    assert.match(source, /30_000/);
  }
});

test("music resumes only after the complete Yna clip finishes", () => {
  for (const source of [iosVoice, androidVoice]) {
    assert.match(source, /playbackStatusUpdate/);
    assert.match(source, /status\.didJustFinish/);
    assert.match(source, /releaseAlertAudioFocus/);
  }
});

test("iOS preserves dashcam microphone ownership while taking alert focus", () => {
  assert.match(iosSound, /allowsRecording:\s+dashcamAudioActive/);
  assert.match(
    iosSound,
    /interruptionMode:\s+dashcamAudioActive \? "mixWithOthers" : "duckOthers"/,
  );
});